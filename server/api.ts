import { stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  DEFAULT_ASPECT_RATIO,
  DEFAULT_IMAGE_SIZE,
  DEFAULT_MODEL,
  DEFAULT_REMOVE_BACKGROUND,
  SUPPORTED_ASPECT_RATIOS,
  SUPPORTED_IMAGE_SIZES,
  SUPPORTED_MODELS,
} from '../src/config';
import type { Repositories } from '../src/db/repositories';

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PROMPT = 10000;
const MAX_COUNT = 20;
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
  const model = input.model ?? DEFAULT_MODEL,
    aspectRatio = input.aspectRatio ?? DEFAULT_ASPECT_RATIO,
    imageSize = input.imageSize ?? DEFAULT_IMAGE_SIZE;
  if (typeof model !== 'string' || !SUPPORTED_MODELS.includes(model)) {
    throw new InputError('invalid model');
  }
  if (typeof aspectRatio !== 'string' || !SUPPORTED_ASPECT_RATIOS.includes(aspectRatio)) {
    throw new InputError('invalid aspectRatio');
  }
  if (typeof imageSize !== 'string' || !SUPPORTED_IMAGE_SIZES.includes(imageSize)) {
    throw new InputError('invalid imageSize');
  }
  if (input.removeBackground !== undefined && typeof input.removeBackground !== 'boolean') {
    throw new InputError('invalid removeBackground');
  }
  options.model = model;
  options.aspectRatio = aspectRatio;
  options.imageSize = imageSize;
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
            throw new InputError('reference images are not supported in phase 1');
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
          const expandedPrompt = refs.length
            ? `${authoredPrompt}\n\n${refs.map((r) => `[${r.name}]\n${r.prompt}`).join('\n\n')}`
            : authoredPrompt;
          const options = validateOptions(b);
          const job = repo.createJob({
            assetId: refs[0]?.id,
            assetName: refs[0]?.name ?? 'text',
            authoredPrompt,
            referencedAssets: refs,
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
        if (!target.startsWith(`${outputDir}/`)) {
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
