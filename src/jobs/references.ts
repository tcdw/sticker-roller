import type { AssetReferenceSnapshot, ImageReferenceSnapshot, Repositories } from '../db/repositories';
import type { AssetRow, UploadRow } from '../db/schema';
import { InputError } from '../errors';
import { isUuid } from '../ids';

/** A reference that did not resolve to exactly one library row. Extends InputError so the API still answers 400. */
export class ReferenceLookupError extends InputError {
  readonly code: 'NOT_FOUND' | 'AMBIGUOUS';
  /** Names of the rows that made the reference ambiguous, for the CLI candidate list. */
  readonly candidates: string[];
  constructor(code: 'NOT_FOUND' | 'AMBIGUOUS', message: string, candidates: string[] = []) {
    super(message);
    this.code = code;
    this.candidates = candidates;
  }
}

export interface ResolveRefOptions {
  /** Accept library names and unique name fragments in addition to IDs. The CLI enables this; the API does not. */
  allowNames?: boolean;
  /** Reject archived rows so a generation never references something the library treats as gone. */
  requireActive?: boolean;
}

/** Prefer exact (case-insensitive) name matches, then unique name fragments. */
function pickByName<T extends { name: string }>(rows: readonly T[], value: string): { match?: T; matches: T[] } {
  const needle = value.toLowerCase();
  const exact = rows.filter((row) => row.name.toLowerCase() === needle);
  if (exact.length) {
    return { match: exact.length === 1 ? exact[0] : undefined, matches: exact };
  }
  const partial = rows.filter((row) => row.name.toLowerCase().includes(needle));
  return { match: partial.length === 1 ? partial[0] : undefined, matches: partial };
}

function requireActive<T extends { name: string; archivedAt: string | null }>(
  row: T,
  kind: 'asset' | 'image',
  options: ResolveRefOptions,
): T {
  if (options.requireActive && row.archivedAt) {
    // Legacy API wording: the HTTP contract is asserted by server/api.test.ts.
    const message = options.allowNames
      ? `${kind} is archived: ${row.name}`
      : kind === 'asset'
        ? 'asset not found'
        : 'referenced image not found';
    throw new ReferenceLookupError('NOT_FOUND', message, options.allowNames ? [row.name] : []);
  }
  return row;
}

/** Resolve one asset reference by ID, or by name when the caller allows it. */
export function resolveAssetRef(repo: Repositories, ref: string, options: ResolveRefOptions = {}): AssetRow {
  const value = ref.trim();
  if (!value) {
    throw new ReferenceLookupError('NOT_FOUND', 'asset reference is empty');
  }
  if (isUuid(value)) {
    const asset = repo.getAsset(value);
    if (asset) {
      return requireActive(asset, 'asset', options);
    }
  }
  if (!options.allowNames) {
    // Legacy API wording: the HTTP contract is asserted by server/api.test.ts.
    throw new ReferenceLookupError('NOT_FOUND', 'asset not found');
  }
  const { match, matches } = pickByName(repo.listAssets(true), value);
  if (!match) {
    if (matches.length > 1) {
      throw new ReferenceLookupError(
        'AMBIGUOUS',
        `asset reference "${value}" matches ${matches.length} assets`,
        matches.map((row) => row.name),
      );
    }
    throw new ReferenceLookupError('NOT_FOUND', `asset not found: "${value}"`);
  }
  return requireActive(match, 'asset', options);
}

/** Resolve one uploaded-image reference by ID, or by name when the caller allows it. */
export function resolveUploadRef(repo: Repositories, ref: string, options: ResolveRefOptions = {}): UploadRow {
  const value = ref.trim();
  if (!value) {
    throw new ReferenceLookupError('NOT_FOUND', 'image reference is empty');
  }
  if (isUuid(value)) {
    const upload = repo.getUpload(value);
    if (upload) {
      return requireActive(upload, 'image', options);
    }
  }
  if (!options.allowNames) {
    throw new ReferenceLookupError('NOT_FOUND', 'referenced image not found');
  }
  const { match, matches } = pickByName(repo.listUploads(true), value);
  if (!match) {
    if (matches.length > 1) {
      throw new ReferenceLookupError(
        'AMBIGUOUS',
        `image reference "${value}" matches ${matches.length} images`,
        matches.map((row) => row.name),
      );
    }
    throw new ReferenceLookupError('NOT_FOUND', `image not found: "${value}"`);
  }
  const full = repo.getUpload(match.id);
  if (!full) {
    throw new ReferenceLookupError('NOT_FOUND', `image not found: "${value}"`);
  }
  return requireActive(full, 'image', options);
}

export interface JobInputRefs {
  authoredPrompt: string;
  referencedAssetIds?: unknown[];
  referencedImageIds?: unknown[];
}

/** Everything the API and the CLI both need before calling repo.createJob. */
export interface ResolvedJobInput {
  assetId?: string;
  assetName: string;
  authoredPrompt: string;
  /** Authored prompt with image tokens replaced by file names, then text asset blocks appended. */
  prompt: string;
  assetRefs: AssetReferenceSnapshot[];
  imageRefs: ImageReferenceSnapshot[];
  /** Asset snapshots followed by image snapshots, in the shape repo.createJob persists. */
  references: Array<AssetReferenceSnapshot | ImageReferenceSnapshot>;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Resolve asset and image references and expand the prompt exactly the way the web API does.
 * Both entry points share this so the stored prompt snapshot can never drift between them.
 */
export function resolveJobInput(
  repo: Repositories,
  input: JobInputRefs,
  options: ResolveRefOptions = {},
): ResolvedJobInput {
  const rawRefs = input.referencedAssetIds ?? [];
  if (!Array.isArray(rawRefs)) {
    throw new InputError('referencedAssetIds must be an array');
  }
  const assetSnapshots: AssetReferenceSnapshot[] = rawRefs.map((raw) => {
    const asset = resolveAssetRef(repo, String(raw), { ...options, requireActive: true });
    return {
      id: asset.id,
      name: asset.name,
      prompt: asset.prompt,
      category: asset.category,
      metadata: JSON.parse(asset.metadata || '{}'),
    };
  });
  const rawImageIds = input.referencedImageIds ?? [];
  if (!Array.isArray(rawImageIds)) {
    throw new InputError('referencedImageIds must be an array');
  }
  const imageRefs: ImageReferenceSnapshot[] = rawImageIds.map((raw) => {
    const upload = resolveUploadRef(repo, String(raw), { ...options, requireActive: true });
    return { kind: 'image', id: upload.id, name: upload.name, mimeType: upload.mimeType };
  });
  // Reference images travel as provider content parts, so replace their
  // inline tokens with the plain image name in the expanded prompt.
  let promptText = input.authoredPrompt;
  for (const ref of imageRefs) {
    promptText = promptText.replace(
      new RegExp(`!\\[[^\\]]*\\]\\(image:${escapeRegExp(ref.id)}\\)`, 'g'),
      () => ref.name,
    );
  }
  const prompt = assetSnapshots.length
    ? `${promptText}\n\n${assetSnapshots.map((ref) => `[${ref.name}]\n${ref.prompt}`).join('\n\n')}`
    : promptText;
  return {
    assetId: assetSnapshots[0]?.id,
    assetName: assetSnapshots[0]?.name ?? 'text',
    authoredPrompt: input.authoredPrompt,
    prompt,
    assetRefs: assetSnapshots,
    imageRefs,
    references: [...assetSnapshots, ...imageRefs],
  };
}
