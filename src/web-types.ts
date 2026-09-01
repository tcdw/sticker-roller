export type { AssetReferenceSnapshot, ItemStatus, JobCreate, JobStatus, RequestStatus } from './db/repositories';
export type { AssetRow, EventRow, FileRow, ItemRow, JobRow, RequestRow } from './db/schema';

export interface CreateJobRequest {
  authoredPrompt: string;
  referencedAssetIds: string[];
  count?: number;
  [key: string]: unknown;
}
