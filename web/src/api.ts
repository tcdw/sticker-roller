import { create } from 'zustand';
import {
  decodeSelectionSnapshot,
  type GenerationSelection,
  type LegacyProviderId,
  normalizeSelectionInput,
} from '../../src/image-providers';
import { referencedIdsFromPrompt } from '../../src/prompt-tokens';
import type { AssetRow, FileRow, ItemRow, JobRow, UploadSummary } from '../../src/web-types';
export type JobReference = { kind?: string; id: string; name?: string };
export type JobSummary = JobRow & {
  options?: Record<string, unknown>;
  authoredPrompt?: string;
  references?: JobReference[];
};
export type Job = JobSummary & {
  items: (ItemRow & { files?: FileRow[] })[];
  events: unknown[];
};
export type Options = { selection: GenerationSelection; count: number };
/** The count-only dialog must merge into current options, never its opening selection. */
export function applyCount(current: Options, count: number): Options {
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    throw new Error('生成张数必须是 1–20 的整数');
  }
  return { ...current, count };
}
export function newOptions(providerId = 'google', modelId = 'gemini-3-pro-image', count = 1): Options {
  const result = normalizeSelectionInput({ providerId, modelId, options: {} });
  if (!result.ok) {
    throw new Error('无法使用此渠道或模型');
  }
  return { selection: result.value, count };
}
const defaults = newOptions();
export const DEFAULT_OPTIONS: Readonly<Options> = defaults;
/** Unknown snapshots stay visible in history but cannot silently become another model. */
export function optionsFromSnapshot(snapshot: unknown, count = 1, legacyProviderId?: LegacyProviderId): Options {
  const isV2 = snapshot !== null && typeof snapshot === 'object' && 'version' in snapshot;
  if (!isV2 && !legacyProviderId) {
    throw new Error('旧任务需要服务端解析当前渠道后才能复用');
  }
  const result = decodeSelectionSnapshot(snapshot, { legacyProviderId: legacyProviderId ?? 'google' });
  if (!result.ok) {
    throw new Error(`无法复用此任务配置：${result.error.code}`);
  }
  return { selection: result.value.selection, count: Number.isInteger(count) ? Math.min(20, Math.max(1, count)) : 1 };
}
// Token parsing lives in a shared, node-free module so the CLI resolves the same tokens the UI does.
export {
  ASSET_TOKEN,
  IMAGE_TOKEN,
  referencedIdsFromPrompt,
  referencedImageIdsFromPrompt,
  unreferencedUploads,
} from '../../src/prompt-tokens';
export interface ReusedDraft {
  prompt: string;
  referencedAssetIds: string[];
  options: Options;
  /** Names of reference images from the job that are no longer available as active uploads. */
  missingImageNames: string[];
}
/** Restore one history job into the composer: authored prompt, image references, and generation options. */
export function draftFromJob(
  job: JobSummary,
  assets: AssetRow[],
  uploads: UploadSummary[],
  legacyProviderId?: LegacyProviderId,
): ReusedDraft {
  const authoredPrompt = job.authoredPrompt ?? job.promptSnapshot ?? '';
  const available = new Set(uploads.map((upload) => upload.id));
  const missingImages = (job.references ?? []).filter(
    (reference) => reference.kind === 'image' && !available.has(reference.id),
  );
  const missingImageNames = missingImages.map((reference) => reference.name ?? reference.id);
  // Archived reference images cannot be resolved on submit, so drop their tokens
  // instead of leaving dead text in the composer.
  const missingIds = new Set(missingImages.map((reference) => reference.id));
  const prompt = missingIds.size
    ? authoredPrompt.replace(/!\[[^\]]*\]\(image:([^)]+)\)\s?/g, (match, id: string) =>
        missingIds.has(id) ? '' : match,
      )
    : authoredPrompt;
  return {
    prompt,
    referencedAssetIds: referencedIdsFromPrompt(prompt, assets),
    options: optionsFromSnapshot(job.options, job.requestedCount, legacyProviderId),
    missingImageNames,
  };
}
/** History is paged on the server, so the client always requests exactly one page. */
export const HISTORY_PAGE_SIZE = 10;
export type JobPage = { items: JobSummary[]; total: number; limit: number; offset: number };
/** Total number of pages for a job count; an empty history still reports one page. */
export const pageCount = (total: number, size = HISTORY_PAGE_SIZE) => Math.max(1, Math.ceil(total / size));
export const pageOffset = (page: number, size = HISTORY_PAGE_SIZE) => (page - 1) * size;
export const api = {
  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
    const data = await r.json();
    if (!r.ok) {
      throw new Error(data?.error?.message ?? '请求失败');
    }
    return data;
  },
  providers: () =>
    api.request<{
      legacyProviderId: LegacyProviderId;
      providers: Array<{ id: string; configured: boolean; reason: string; missingEnv: string[] }>;
    }>('/api/image-providers'),
  assets: () => api.request<AssetRow[]>('/api/assets'),
  createAsset: (body: { name: string; prompt: string; category?: string }) =>
    api.request<AssetRow>('/api/assets', { method: 'POST', body: JSON.stringify(body) }),
  updateAsset: (id: string, body: Partial<Pick<AssetRow, 'name' | 'prompt' | 'category'>>) =>
    api.request<AssetRow>(`/api/assets/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  archiveAsset: (id: string) => api.request<AssetRow>(`/api/assets/${id}`, { method: 'DELETE', body: '{}' }),
  jobs: (page = 1) => api.request<JobPage>(`/api/jobs?limit=${HISTORY_PAGE_SIZE}&offset=${pageOffset(page)}`),
  job: (id: string) => api.request<Job>(`/api/jobs/${id}`),
  createJob: (
    body: { authoredPrompt: string; referencedAssetIds: string[]; referencedImageIds?: string[] } & Options,
  ) => api.request<Job>('/api/jobs', { method: 'POST', body: JSON.stringify(body) }),
  cancel: (id: string) => api.request<Job>(`/api/jobs/${id}/cancel`, { method: 'POST', body: '{}' }),
  retry: (id: string) => api.request<Job>(`/api/jobs/${id}/retry-failed`, { method: 'POST', body: '{}' }),
  uploads: () => api.request<UploadSummary[]>('/api/uploads'),
  createUpload: async (file: File): Promise<UploadSummary> => {
    // Multipart upload: the browser sets the multipart boundary, so no JSON headers here.
    const form = new FormData();
    form.append('file', file);
    const r = await fetch('/api/uploads', { method: 'POST', body: form });
    const data = await r.json();
    if (!r.ok) {
      throw new Error(data?.error?.message ?? '上传失败');
    }
    return data as UploadSummary;
  },
  archiveUpload: (id: string) => api.request<UploadSummary>(`/api/uploads/${id}`, { method: 'DELETE', body: '{}' }),
};
export const saveAsset = (id: string | undefined, body: { name: string; prompt: string; category?: string }) =>
  id ? api.updateAsset(id, body) : api.createAsset(body);
type DraftState = {
  prompt: string;
  referencedAssetIds: string[];
  options: Options;
  set: (p: Partial<DraftState>) => void;
  /** Clear only the prompt so the rest of the form survives a submitted job. */
  clearPrompt: () => void;
};
export const useDraft = create<DraftState>((set) => ({
  prompt: '',
  referencedAssetIds: [],
  options: { ...defaults },
  set: (patch) => set(patch),
  clearPrompt: () => set({ prompt: '', referencedAssetIds: [] }),
}));
export const isActive = (s: string) => s === 'queued' || s === 'running';
