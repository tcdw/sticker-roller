import { create } from 'zustand';
import { AUTO, DEFAULT_MODEL } from '../../src/image-options';
import type { AssetRow, FileRow, ItemRow, JobRow, UploadSummary } from '../../src/web-types';
export type Job = JobRow & {
  options: Record<string, unknown>;
  items: (ItemRow & { files?: FileRow[] })[];
  events: unknown[];
  authoredPrompt?: string;
  references?: unknown[];
};
export type Options = {
  model: string;
  aspectRatio: string;
  imageSize: string;
  removeBackground: boolean;
  count: number;
};
const defaults: Options = {
  model: DEFAULT_MODEL,
  aspectRatio: AUTO,
  imageSize: AUTO,
  removeBackground: true,
  count: 1,
};
export const ASSET_TOKEN = /@\[([^\]]+)\]\(asset:([^)]+)\)/g;
export function referencedIdsFromPrompt(prompt: string, assets: AssetRow[]): string[] {
  const known = new Set(assets.map((asset) => asset.id));
  return [
    ...new Set(
      Array.from(prompt.matchAll(ASSET_TOKEN), (match) => match[2]).filter((id): id is string =>
        Boolean(id && known.has(id)),
      ),
    ),
  ];
}
export const IMAGE_TOKEN = /!\[([^\]]+)\]\(image:([^)]+)\)/g;
export function referencedImageIdsFromPrompt(prompt: string, uploads: UploadSummary[]): string[] {
  const known = new Set(uploads.map((upload) => upload.id));
  return [
    ...new Set(
      Array.from(prompt.matchAll(IMAGE_TOKEN), (match) => match[2]).filter((id): id is string =>
        Boolean(id && known.has(id)),
      ),
    ),
  ];
}
export const api = {
  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
    const data = await r.json();
    if (!r.ok) {
      throw new Error(data?.error?.message ?? '请求失败');
    }
    return data;
  },
  assets: () => api.request<AssetRow[]>('/api/assets'),
  createAsset: (body: { name: string; prompt: string; category?: string }) =>
    api.request<AssetRow>('/api/assets', { method: 'POST', body: JSON.stringify(body) }),
  updateAsset: (id: string, body: Partial<Pick<AssetRow, 'name' | 'prompt' | 'category'>>) =>
    api.request<AssetRow>(`/api/assets/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  archiveAsset: (id: string) => api.request<AssetRow>(`/api/assets/${id}`, { method: 'DELETE', body: '{}' }),
  jobs: () => api.request<JobRow[]>('/api/jobs'),
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
  reset: () => void;
};
export const useDraft = create<DraftState>((set) => ({
  prompt: '',
  referencedAssetIds: [],
  options: { ...defaults },
  set: (patch) => set(patch),
  reset: () => set({ prompt: '', referencedAssetIds: [], options: { ...defaults } }),
}));
export const isActive = (s: string) => s === 'queued' || s === 'running';
