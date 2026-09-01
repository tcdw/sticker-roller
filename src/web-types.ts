export type { AssetRow, JobRow, ItemRow, RequestRow, FileRow, EventRow } from "./db/schema";
export type { ItemStatus, RequestStatus, JobStatus, JobCreate, AssetReferenceSnapshot } from "./db/repositories";

export interface CreateJobRequest {
  authoredPrompt: string;
  referencedAssetIds: string[];
  count?: number;
  [key: string]: unknown;
}
