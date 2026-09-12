/**
 * 生成链路：CLI 与 web 共用同一套 prompt 语义（见 src/jobs/references.ts），
 * 区别只在于 CLI 允许用名字/路径指定引用，并在写库前把 token 规范成 id。
 */

import { join, resolve } from 'node:path';
import type { ItemStatus, Repositories } from './db/repositories';
import { InputError } from './errors';
import { isUuid } from './ids';
import { MAX_COUNT, MAX_PROMPT, validateOptions } from './jobs/options';
import { resolveAssetRef, resolveJobInput, resolveUploadRef } from './jobs/references';
import { createWorker, type SingleImageGenerator } from './jobs/worker';
import { ASSET_TOKEN, IMAGE_TOKEN, referencedIdsFromPrompt, referencedImageIdsFromPrompt } from './prompt-tokens';
import { uploadFileFromPath } from './uploads';

export interface GenerateInput {
  prompt?: string;
  promptFile?: string;
  /** Asset names or ids; equivalents of the web `referencedAssetIds` field. */
  assets?: string[];
  /** Local image paths or library ids/names; equivalents of the web `referencedImageIds` field. */
  images?: string[];
  count?: number;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  removeBackground?: boolean;
  /** Output directory. Defaults to $OUTPUT_DIR, then <repo>/output. */
  out?: string;
}

export interface GeneratedItem {
  ordinal: number;
  status: ItemStatus;
  /** Absolute path, present only for succeeded items. */
  filePath?: string;
  error?: string;
}

export interface GenerationOutcome {
  jobId: string;
  outputDir: string;
  items: GeneratedItem[];
  succeeded: number;
  failed: number;
}

export interface GenerationDeps {
  /** Injected by tests so a run never calls the real provider. */
  generator?: SingleImageGenerator;
  onProgress?: (done: number, total: number) => void;
}

export const defaultOutputDir = (): string => resolve(process.env.OUTPUT_DIR ?? join(import.meta.dir, '..', 'output'));

/** Read `--prompt` / `--prompt-file` into the authored prompt text. */
export async function resolvePromptSource(input: Pick<GenerateInput, 'prompt' | 'promptFile'>): Promise<string> {
  if (input.prompt !== undefined && input.promptFile !== undefined) {
    throw new InputError('use either --prompt or --prompt-file, not both');
  }
  if (input.promptFile !== undefined) {
    const file = Bun.file(input.promptFile);
    if (!(await file.exists())) {
      throw new InputError(`prompt file not found: ${input.promptFile}`);
    }
    const text = (await file.text()).trim();
    if (!text) {
      throw new InputError(`prompt file is empty: ${input.promptFile}`);
    }
    return text;
  }
  const text = input.prompt?.trim();
  if (!text) {
    throw new InputError('--prompt is required (or use --prompt-file)');
  }
  if (text.length > MAX_PROMPT) {
    throw new InputError(`--prompt must be at most ${MAX_PROMPT} characters`);
  }
  return text;
}

/** A local file wins over a library lookup, so `--image ./ref.png` always means that file. */
async function resolveImageArgument(repo: Repositories, value: string): Promise<string> {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new InputError('--image requires a path or id');
  }
  if (await Bun.file(trimmed).exists()) {
    return uploadFileFromPath(repo, trimmed).then((upload) => upload.id);
  }
  if (isUuid(trimmed)) {
    return resolveUploadRef(repo, trimmed, { requireActive: true }).id;
  }
  try {
    return resolveUploadRef(repo, trimmed, { allowNames: true, requireActive: true }).id;
  } catch {
    throw new InputError(`no such image file, id, or library image: ${trimmed}`);
  }
}

/**
 * Rewrite prompt tokens to canonical `id` tokens, exactly like the web composer inserts them.
 * A token that cannot be resolved is an error: silently dropping it would generate the wrong image.
 */
async function normalizeTokens(repo: Repositories, prompt: string): Promise<string> {
  const withAssets = await replaceAsync(prompt, ASSET_TOKEN, async (_match, _label, ref) => {
    const asset = resolveAssetRef(repo, ref, { allowNames: true, requireActive: true });
    return `@[${asset.name}](asset:${asset.id})`;
  });
  return replaceAsync(withAssets, IMAGE_TOKEN, async (_match, _label, ref) => {
    const id = await resolveImageArgument(repo, ref);
    const upload = resolveUploadRef(repo, id, { requireActive: true });
    return `![${upload.name}](image:${upload.id})`;
  });
}

/** `String.replace` cannot await, so walk the matches manually and rebuild the string. */
async function replaceAsync(
  input: string,
  pattern: RegExp,
  replacer: (match: string, label: string, ref: string) => Promise<string>,
): Promise<string> {
  const regex = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  const parts: string[] = [];
  let lastIndex = 0;
  for (const match of input.matchAll(regex)) {
    if (match.index === undefined) {
      continue;
    }
    parts.push(input.slice(lastIndex, match.index));
    parts.push(await replacer(match[0], match[1] ?? '', match[2] ?? ''));
    lastIndex = match.index + match[0].length;
  }
  parts.push(input.slice(lastIndex));
  return parts.join('');
}

/** Run one generation and wait for its own items only, so a busy web server keeps its queue. */
export async function runGeneration(
  repo: Repositories,
  input: GenerateInput,
  deps: GenerationDeps = {},
): Promise<GenerationOutcome> {
  const authoredPrompt = await resolvePromptSource(input);
  const normalizedPrompt = await normalizeTokens(repo, authoredPrompt);
  // The web composer sends the ids its tokens point at, so the CLI does the same: prompt tokens
  // come first (that is the order the provider receives reference images in), then extra flags.
  const tokenAssetIds = referencedIdsFromPrompt(normalizedPrompt, repo.listAssets(true));
  const tokenImageIds = referencedImageIdsFromPrompt(normalizedPrompt, repo.listUploads(true));
  const flagAssetIds = [...(input.assets ?? [])]
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => resolveAssetRef(repo, value, { allowNames: true, requireActive: true }).id);
  const flagImageIds: string[] = [];
  for (const value of input.images ?? []) {
    const trimmed = value.trim();
    if (trimmed) {
      flagImageIds.push(await resolveImageArgument(repo, trimmed));
    }
  }
  const assetIds = [...new Set([...tokenAssetIds, ...flagAssetIds])];
  const imageIds = [...new Set([...tokenImageIds, ...flagImageIds])];
  const count = input.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
    throw new InputError(`--count must be an integer between 1 and ${MAX_COUNT}`);
  }
  const resolved = resolveJobInput(
    repo,
    { authoredPrompt: normalizedPrompt, referencedAssetIds: assetIds, referencedImageIds: imageIds },
    { allowNames: true },
  );
  const options = validateOptions({
    model: input.model,
    aspectRatio: input.aspectRatio,
    imageSize: input.imageSize,
    removeBackground: input.removeBackground,
  });
  const job = repo.createJob({
    assetId: resolved.assetId,
    assetName: resolved.assetName,
    authoredPrompt: resolved.authoredPrompt,
    referencedAssets: resolved.assetRefs,
    referencedImages: resolved.imageRefs,
    prompt: resolved.prompt,
    options,
    count,
  });
  if (!job) {
    throw new InputError('failed to create the generation job');
  }
  const outputDir = input.out ? resolve(input.out) : defaultOutputDir();
  const worker = createWorker({ repositories: repo, outputDir, generator: deps.generator });
  const total = repo.getJob(job.id).items.length;
  let done = 0;
  // No stale recovery here: a CLI run must not rewrite the state of jobs it does not own.
  while (await worker.runOnce(job.id)) {
    done++;
    deps.onProgress?.(done, total);
  }
  const items: GeneratedItem[] = repo.getJob(job.id).items.map((item) => {
    const file = repo.getFileByItem(item.id)[0];
    return {
      ordinal: item.ordinal,
      status: item.status as ItemStatus,
      filePath: item.status === 'succeeded' && file ? join(outputDir, file.fileName) : undefined,
      error: item.error ?? undefined,
    };
  });
  return {
    jobId: job.id,
    outputDir,
    items,
    succeeded: items.filter((item) => item.status === 'succeeded').length,
    failed: items.filter((item) => item.status !== 'succeeded').length,
  };
}
