import { stat } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { DEFAULT_MODEL, DEFAULT_REMOVE_BACKGROUND, SUPPORTED_MODELS } from '../src/config';
import type { Repositories } from '../src/db/repositories';
import { AUTO, isSupportedAspectRatio, isSupportedImageSize } from '../src/image-options';

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PROMPT = 10000;
const MAX_COUNT = 20;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };

type Deps = { repositories: Repositories; outputDir?: string };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: jsonHeaders });
const error = (status: number, code: string, message: string) => response({ error: { code, message } }, status);
const ok = (data: unknown, status = 200) => response(data, status);
function validId(value: string | undefined): value is string {
  return !!value && idPattern.test(value);
}
function text(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new InputError(`${field} is required and must be at most ${max} characters`);
  }
  return value.trim();
}
class InputError extends Error {}
const IMAGE_SIGNATURES: Array<{ mimeType: string; test: (bytes: Uint8Array) => boolean }> = [
  {
    mimeType: 'image/png',
    test: (b) => b.length > 3 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  { mimeType: 'image/jpeg', test: (b) => b.length > 2 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mimeType: 'image/webp',
    test: (b) => b.length > 11 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  },
];
/** Trust bytes over the client-provided content type when deciding what was uploaded. */
function sniffImageMimeType(bytes: Uint8Array): string | null {
  return IMAGE_SIGNATURES.find((signature) => signature.test(bytes))?.mimeType ?? null;
}
function parseMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputError('metadata must be an object');
  }
  return value as Record<string, unknown>;
}
async function body(req: Request): Promise<Record<string, unknown>> {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new InputError('JSON content type is required');
  }
  let value: unknown;
  try {
    value = await req.json();
  } catch {
    throw new InputError('invalid JSON body');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputError('JSON object is required');
  }
  return value as Record<string, unknown>;
}
function publicAsset(asset: any) {
  return asset ? { ...asset, metadata: JSON.parse(asset.metadata || '{}') } : asset;
}
function publicJob(repo: Repositories, id: string) {
  const result = repo.getJob(id);
  if (!result.job) {
    return undefined;
  }
  return {
    ...result.job,
    options: JSON.parse(result.job.optionsSnapshot),
    authoredPrompt: result.job.authoredPromptSnapshot,
    references: JSON.parse(result.job.referencesSnapshot),
    items: result.items.map((item) => ({ ...item, files: repo.getFileByItem(item.id) })),
    events: result.events,
  };
}
function publicJobs(repo: Repositories, limit: number, offset: number) {
  return repo.listJobs(limit, offset).map((job) => ({
    ...job,
    options: JSON.parse(job.optionsSnapshot),
    authoredPrompt: job.authoredPromptSnapshot,
    references: JSON.parse(job.referencesSnapshot),
  }));
}

function validateOptions(input: Record<string, unknown>) {
  const options: Record<string, unknown> = {};
  const model = input.model ?? DEFAULT_MODEL;
  if (typeof model !== 'string' || !SUPPORTED_MODELS.includes(model)) {
    throw new InputError('invalid model');
  }
  const aspectRatio = input.aspectRatio;
  if (
    aspectRatio !== undefined &&
    (typeof aspectRatio !== 'string' || (aspectRatio !== AUTO && !isSupportedAspectRatio(model, aspectRatio)))
  ) {
    throw new InputError('invalid aspectRatio for model');
  }
  const imageSize = input.imageSize;
  if (
    imageSize !== undefined &&
    (typeof imageSize !== 'string' || (imageSize !== AUTO && !isSupportedImageSize(model, imageSize)))
  ) {
    throw new InputError('invalid imageSize for model');
  }
  if (input.removeBackground !== undefined && typeof input.removeBackground !== 'boolean') {
    throw new InputError('invalid removeBackground');
  }
  options.model = model;
  if (aspectRatio !== undefined && aspectRatio !== AUTO) {
    options.aspectRatio = aspectRatio;
  }
  if (imageSize !== undefined && imageSize !== AUTO) {
    options.imageSize = imageSize;
  }
  options.removeBackground = input.removeBackground ?? DEFAULT_REMOVE_BACKGROUND;
  return options;
}
export function createApiHandler(deps: Deps) {
  const repo = deps.repositories;
  const outputDir = resolve(deps.outputDir ?? process.env.OUTPUT_DIR ?? join(import.meta.dir, '../output'));
  return async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const parts = path.split('/').filter(Boolean);
    try {
      if (req.method === 'GET' && path === '/api/health') {
        return ok({ ok: true });
      }
      if (parts[0] !== 'api') {
        return error(404, 'NOT_FOUND', 'not found');
      }
      if (parts[1] === 'assets') {
        if (req.method === 'GET' && parts.length === 2) {
          return ok(repo.listAssets(url.searchParams.get('includeArchived') === 'true').map(publicAsset));
        }
        if (req.method === 'POST' && parts.length === 2) {
          const b = await body(req);
          const metadata = b.metadata === undefined ? {} : parseMetadata(b.metadata);
          return ok(
            repo.createAsset({
              name: text(b.name, 'name', 200),
              prompt: text(b.prompt, 'prompt', MAX_PROMPT),
              category: b.category === undefined ? null : text(b.category, 'category', 100),
              metadata,
            }),
            201,
          );
        }
        if (parts.length >= 3 && validId(parts[2])) {
          if (req.method === 'GET' && parts.length === 3) {
            const a = repo.getAsset(parts[2]);
            return a ? ok(publicAsset(a)) : error(404, 'NOT_FOUND', 'asset not found');
          }
          if (req.method === 'PATCH' && parts.length === 3) {
            const b = await body(req);
            const input: {
              name?: string;
              prompt?: string;
              category?: string | null;
              metadata?: Record<string, unknown>;
            } = {};
            if (b.name !== undefined) {
              input.name = text(b.name, 'name', 200);
            }
            if (b.prompt !== undefined) {
              input.prompt = text(b.prompt, 'prompt', MAX_PROMPT);
            }
            if (b.category !== undefined) {
              input.category = text(b.category, 'category', 100);
            }
            if (b.metadata !== undefined) {
              input.metadata = parseMetadata(b.metadata);
            }
            if (!Object.keys(input).length) {
              throw new InputError('at least one field is required');
            }
            const a = repo.updateAsset(parts[2], input);
            return a ? ok(publicAsset(a)) : error(404, 'NOT_FOUND', 'asset not found');
          }
          if (req.method === 'POST' && parts.length === 4 && parts[3] === 'archive') {
            const a = repo.archiveAsset(parts[2]);
            return a ? ok(a) : error(404, 'NOT_FOUND', 'asset not found');
          }
          if (req.method === 'DELETE' && parts.length === 3) {
            const a = repo.archiveAsset(parts[2]);
            return a ? ok(a) : error(404, 'NOT_FOUND', 'asset not found');
          }
        }
      }
      if (parts[1] === 'uploads') {
        if (req.method === 'GET' && parts.length === 2) {
          return ok(repo.listUploads(url.searchParams.get('includeArchived') === 'true'));
        }
        if (req.method === 'POST' && parts.length === 2) {
          if (!req.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
            throw new InputError('multipart/form-data content type is required');
          }
          let form: FormData;
          try {
            form = await req.formData();
          } catch {
            throw new InputError('invalid multipart body');
          }
          const file = form.get('file');
          if (!(file instanceof File)) {
            throw new InputError('file field is required');
          }
          if (file.size > MAX_UPLOAD_BYTES) {
            throw new InputError(`image must be at most ${MAX_UPLOAD_BYTES} bytes`);
          }
          const bytes = new Uint8Array(await file.arrayBuffer());
          const mimeType = sniffImageMimeType(bytes);
          if (!mimeType) {
            throw new InputError('only PNG, JPEG, or WebP images are supported');
          }
          return ok(
            repo.createUpload({
              name: text(file.name || 'image', 'name', 200),
              mimeType,
              sizeBytes: file.size,
              data: Buffer.from(bytes).toString('base64'),
            }),
            201,
          );
        }
        if (parts.length >= 3 && validId(parts[2])) {
          if (req.method === 'GET' && parts.length === 3) {
            const upload = repo.getUpload(parts[2]);
            if (!upload) {
              return error(404, 'NOT_FOUND', 'upload not found');
            }
            return new Response(Buffer.from(upload.data, 'base64'), {
              headers: { 'content-type': upload.mimeType, 'cache-control': 'private, max-age=86400' },
            });
          }
          if (req.method === 'DELETE' && parts.length === 3) {
            const upload = repo.archiveUpload(parts[2]);
            return upload ? ok(upload) : error(404, 'NOT_FOUND', 'upload not found');
          }
        }
      }
      if (parts[1] === 'jobs') {
        if (req.method === 'GET' && parts.length === 2) {
          const limit = Number(url.searchParams.get('limit') ?? 50),
            offset = Number(url.searchParams.get('offset') ?? 0);
          if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) {
            throw new InputError('invalid pagination');
          }
          return ok(publicJobs(repo, limit, offset));
        }
        if (req.method === 'POST' && parts.length === 2) {
          const b = await body(req);
          if (b.referenceImages !== undefined || b.referenceImage !== undefined) {
            throw new InputError('inline reference images are not supported; upload images and use referencedImageIds');
          }
          const count = b.count ?? 1;
          if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
            throw new InputError(`count must be between 1 and ${MAX_COUNT}`);
          }
          const authoredPrompt = text(b.authoredPrompt ?? b.prompt, 'authoredPrompt', MAX_PROMPT);
          const rawRefs = b.referencedAssetIds ?? b.assetIds ?? [];
          if (!Array.isArray(rawRefs) || rawRefs.some((v) => !validId(String(v)))) {
            throw new InputError('referencedAssetIds must contain valid asset IDs');
          }
          const refs = rawRefs.map((v) => {
            const a = repo.getAsset(String(v));
            if (!a || a.archivedAt) {
              throw new InputError('asset not found');
            }
            return {
              id: a.id,
              name: a.name,
              prompt: a.prompt,
              category: a.category,
              metadata: JSON.parse(a.metadata || '{}'),
            };
          });
          const rawImageIds = b.referencedImageIds ?? [];
          if (!Array.isArray(rawImageIds) || rawImageIds.some((v) => !validId(String(v)))) {
            throw new InputError('referencedImageIds must contain valid upload IDs');
          }
          const imageRefs = rawImageIds.map((v) => {
            const u = repo.getUpload(String(v));
            if (!u || u.archivedAt) {
              throw new InputError('referenced image not found');
            }
            return { kind: 'image' as const, id: u.id, name: u.name, mimeType: u.mimeType };
          });
          // Reference images travel as provider content parts, so replace their
          // inline tokens with the plain image name in the expanded prompt.
          let promptText = authoredPrompt;
          for (const ref of imageRefs) {
            promptText = promptText.replace(new RegExp(`!\\[[^\\]]*\\]\\(image:${ref.id}\\)`, 'g'), () => ref.name);
          }
          const expandedPrompt = refs.length
            ? `${promptText}\n\n${refs.map((r) => `[${r.name}]\n${r.prompt}`).join('\n\n')}`
            : promptText;
          const options = validateOptions(b);
          const job = repo.createJob({
            assetId: refs[0]?.id,
            assetName: refs[0]?.name ?? 'text',
            authoredPrompt,
            referencedAssets: refs,
            referencedImages: imageRefs,
            prompt: expandedPrompt,
            options,
            count,
          });
          return ok(publicJob(repo, job?.id), 202);
        }
        if (parts.length >= 3 && validId(parts[2])) {
          const jobId = parts[2];
          if (req.method === 'GET' && parts.length === 3) {
            return publicJob(repo, jobId) ? ok(publicJob(repo, jobId)) : error(404, 'NOT_FOUND', 'job not found');
          }
          if (req.method === 'POST' && parts.length === 4 && parts[3] === 'cancel') {
            const j = repo.cancelJob(jobId);
            return j ? ok(publicJob(repo, jobId)) : error(404, 'NOT_FOUND', 'job not found');
          }
          if (req.method === 'POST' && parts.length === 4 && parts[3] === 'retry-failed') {
            const j = repo.retryFailed(jobId);
            return j ? ok(publicJob(repo, jobId)) : error(409, 'INVALID_STATE', 'job is not failed');
          }
        }
      }
      if (req.method === 'GET' && parts[1] === 'output' && parts.length === 3 && parts[2]) {
        let fileName: string;
        try {
          fileName = decodeURIComponent(parts[2]);
        } catch {
          return error(400, 'INVALID_INPUT', 'invalid output path encoding');
        }
        if (
          basename(fileName) !== fileName ||
          fileName.startsWith('.') ||
          !/^[\w.-]+\.(png|jpg|jpeg|webp)$/i.test(fileName)
        ) {
          return error(404, 'NOT_FOUND', 'output not found');
        }
        const records = repo.getFileByName(fileName);
        if (!records.length) {
          return error(404, 'NOT_FOUND', 'output not found');
        }
        const target = resolve(outputDir, fileName);
        if (!target.startsWith(outputDir + sep)) {
          return error(404, 'NOT_FOUND', 'output not found');
        }
        try {
          await stat(target);
          const mimeType = records[0]?.mimeType;
          return mimeType
            ? new Response(Bun.file(target), { headers: { 'content-type': mimeType } })
            : new Response(Bun.file(target));
        } catch {
          return error(404, 'NOT_FOUND', 'output not found');
        }
      }
      return error(404, 'NOT_FOUND', 'not found');
    } catch (e) {
      if (e instanceof InputError) {
        return error(400, 'INVALID_INPUT', e.message);
      }
      if (e instanceof SyntaxError) {
        return error(400, 'INVALID_INPUT', 'invalid request');
      }
      return error(500, 'INTERNAL_ERROR', 'internal server error');
    }
  };
}
