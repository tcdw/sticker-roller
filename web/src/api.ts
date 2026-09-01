import { create } from "zustand";
import type { AssetRow, JobRow, ItemRow, FileRow } from "../../src/web-types";

export type Job = JobRow & { options: Record<string, unknown>; items: (ItemRow & { files?: FileRow[] })[]; events: unknown[] };
export type Options = { model: string; aspectRatio: string; imageSize: string; removeBackground: boolean; count: number };
const defaults: Options = { model: "gemini-3-pro-image", aspectRatio: "1:1", imageSize: "1K", removeBackground: true, count: 1 };
export const api = {
  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    const data: any = await response.json();
    if (!response.ok) throw new Error(data?.error?.message ?? "Request failed");
    return data as T;
  },
  assets: () => api.request<AssetRow[]>("/api/assets"),
  createAsset: (body: { name: string; prompt: string }) => api.request<AssetRow>("/api/assets", { method: "POST", body: JSON.stringify(body) }),
  updateAsset: (id: string, body: Partial<Pick<AssetRow, "name" | "prompt">>) => api.request<AssetRow>(`/api/assets/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  archiveAsset: (id: string) => api.request<AssetRow>(`/api/assets/${id}/archive`, { method: "POST", body: "{}" }),
  jobs: () => api.request<JobRow[]>("/api/jobs"),
  job: (id: string) => api.request<Job>(`/api/jobs/${id}`),
  createJob: (body: { assetId?: string; assetName: string; prompt: string } & Options) => api.request<Job>("/api/jobs", { method: "POST", body: JSON.stringify(body) }),
  cancel: (id: string) => api.request<Job>(`/api/jobs/${id}/cancel`, { method: "POST", body: "{}" }),
  retry: (id: string) => api.request<Job>(`/api/jobs/${id}/retry-failed`, { method: "POST", body: "{}" }),
};

export const saveAsset = (assetId: string | undefined, body: { name: string; prompt: string }) => assetId ? api.updateAsset(assetId, body) : api.createAsset(body);

type DraftState = { assetId?: string; assetName: string; prompt: string; options: Options; set: (p: Partial<DraftState>) => void; reset: () => void };
export const useDraft = create<DraftState>((set) => ({ assetName: "New text asset", prompt: "", options: { ...defaults }, set: (patch) => set(patch), reset: () => set({ assetId: undefined, assetName: "New text asset", prompt: "", options: { ...defaults } }) }));
export const isActive = (status: string) => status === "queued" || status === "running";
