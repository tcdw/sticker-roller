export type {
  AssetReferenceSnapshot,
  ImageReferenceSnapshot,
  ItemStatus,
  JobCreate,
  JobStatus,
  RequestStatus,
} from './db/repositories';
export type { AssetRow, EventRow, FileRow, ItemRow, JobRow, RequestRow, UploadRow, UploadSummary } from './db/schema';

export interface CreateJobRequest {
  authoredPrompt: string;
  referencedAssetIds: string[];
  referencedImageIds?: string[];
  count?: number;
  [key: string]: unknown;
}
