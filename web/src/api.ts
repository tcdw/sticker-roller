import { create } from 'zustand';
import type { AssetRow, JobRow, ItemRow, FileRow } from '../../src/web-types';
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
  model: 'gemini-3-pro-image',
  aspectRatio: '1:1',
  imageSize: '1K',
  removeBackground: true,
  count: 1,
};
export const ASSET_TOKEN = /@\[([^\]]+)\]\(asset:([^\)]+)\)/g;
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
export const api = {
  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message ?? '请求失败');
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
  createJob: (body: { authoredPrompt: string; referencedAssetIds: string[] } & Options) =>
    api.request<Job>('/api/jobs', { method: 'POST', body: JSON.stringify(body) }),
  cancel: (id: string) => api.request<Job>(`/api/jobs/${id}/cancel`, { method: 'POST', body: '{}' }),
  retry: (id: string) => api.request<Job>(`/api/jobs/${id}/retry-failed`, { method: 'POST', body: '{}' }),
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
