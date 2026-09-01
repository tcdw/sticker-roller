import type { Db } from "./client";
import { assets, jobs, items, requests, files, events, type AssetRow, type JobRow, type ItemRow, type RequestRow, type FileRow, type EventRow } from "./schema";
import { and, asc, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { nowUtc } from "./client";
import { randomUUID } from "node:crypto";

export type ItemStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type RequestStatus = "running" | "succeeded" | "failed";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export interface JobCreate { assetId?: string; assetName: string; prompt: string; options: Record<string, unknown>; count: number; }
const id = () => randomUUID();
const json = (v: unknown) => JSON.stringify(v);

export function createRepositories(db: Db) {
  const event = (jobId: string, type: string, itemId?: string, detail?: string) => db.insert(events).values({ jobId, itemId, type, detail, createdAt: nowUtc() }).run();
  const refreshJob = (executor: any, jobId: string) => executor.run(sql`UPDATE jobs SET completed_count=(SELECT count(*) FROM job_items WHERE job_id=${jobId} AND status='succeeded'), failed_count=(SELECT count(*) FROM job_items WHERE job_id=${jobId} AND status='failed'), updated_at=${nowUtc()} WHERE id=${jobId}`);
  return {
    listAssets: (includeArchived = false) => db.select().from(assets).where(includeArchived ? undefined : isNull(assets.archivedAt)).orderBy(asc(assets.name)).all(),
    getAsset: (assetId: string) => db.select().from(assets).where(eq(assets.id, assetId)).get(),
    createAsset: (input: { name: string; prompt: string }) => { const t=nowUtc(), row={id:id(),name:input.name,prompt:input.prompt,createdAt:t,updatedAt:t}; db.insert(assets).values(row).run(); return row; },
    updateAsset: (assetId: string, input: { name?: string; prompt?: string }) => { const row=db.update(assets).set({...input,updatedAt:nowUtc()}).where(eq(assets.id,assetId)).returning().get(); return row; },
    archiveAsset: (assetId: string) => db.update(assets).set({archivedAt:nowUtc(),updatedAt:nowUtc()}).where(eq(assets.id,assetId)).returning().get(),
    createJob: (input: JobCreate) => db.transaction((tx) => { const t=nowUtc(), jobId=id(); tx.insert(jobs).values({id:jobId,assetId:input.assetId,assetName:input.assetName,promptSnapshot:input.prompt,optionsSnapshot:json(input.options),requestedCount:input.count,status:"queued",createdAt:t,updatedAt:t}).run(); for(let n=1;n<=input.count;n++) tx.insert(items).values({id:id(),jobId:jobId,ordinal:n,status:"queued"}).run(); tx.insert(events).values({jobId:jobId,type:"job.created",detail:`${input.count} items`,createdAt:t}).run(); return tx.select().from(jobs).where(eq(jobs.id,jobId)).get()!; }),
    getJob: (jobId: string) => ({ job: db.select().from(jobs).where(eq(jobs.id,jobId)).get(), items: db.select().from(items).where(eq(items.jobId,jobId)).orderBy(asc(items.ordinal)).all(), events: db.select().from(events).where(eq(events.jobId,jobId)).orderBy(asc(events.id)).all() }),
    listJobs: (limit=50, offset=0) => db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(limit).offset(offset).all(),
    claimNextItem: () => db.transaction((tx) => { const candidate=tx.select().from(items).where(eq(items.status,"queued")).orderBy(asc(items.ordinal)).limit(1).get(); if(!candidate) return; const t=nowUtc(); const changed=tx.update(items).set({status:"running",startedAt:t,heartbeatAt:t}).where(and(eq(items.id,candidate.id),eq(items.status,"queued"))).returning().get(); if(changed){tx.update(jobs).set({status:"running",updatedAt:t}).where(eq(jobs.id,candidate.jobId)).run(); tx.insert(events).values({jobId:candidate.jobId,itemId:candidate.id,type:"item.claimed",createdAt:t}).run();} return changed; }),
    startRequest: (itemId: string) => { const previous=db.select({max:sql<number>`max(${requests.attempt})`}).from(requests).where(eq(requests.itemId,itemId)).get(); const attempt=(previous?.max ?? 0)+1, row={id:id(),itemId,attempt,status:"running" as const,startedAt:nowUtc()}; db.insert(requests).values(row).run(); return row; },
    finishRequest: (requestId: string, status: RequestStatus, error?: string) => db.update(requests).set({status,error,finishedAt:nowUtc()}).where(eq(requests.id,requestId)).returning().get(),
    finishItem: (itemId: string, status: Exclude<ItemStatus,"queued"|"running">, error?: string) => db.transaction(tx=>{const row=tx.update(items).set({status,error,finishedAt:nowUtc(),heartbeatAt:null}).where(eq(items.id,itemId)).returning().get(); if(row){refreshJob(tx,row.jobId); tx.insert(events).values({jobId:row.jobId,itemId,type:`item.${status}`,detail:error,createdAt:nowUtc()}).run();} return row;}),
    registerFile: (input: { itemId:string; fileName:string; mimeType:string; sizeBytes:number }) => { if(input.fileName.includes("/") || input.fileName.includes("\\") || input.fileName.startsWith(".")) throw new Error("invalid file name"); const row={id:id(),...input,createdAt:nowUtc()}; db.insert(files).values(row).run(); return row; },
    cancelJob: (jobId:string) => db.transaction(tx=>{const t=nowUtc(); tx.update(items).set({status:"cancelled",finishedAt:t}).where(and(eq(items.jobId,jobId),eq(items.status,"queued"))).run(); const row=tx.update(jobs).set({status:"cancelled",cancelledAt:t,updatedAt:t}).where(eq(jobs.id,jobId)).returning().get(); tx.insert(events).values({jobId,type:"job.cancelled",createdAt:t}).run(); return row;}),
    retryFailed: (jobId:string) => db.transaction(tx=>{const t=nowUtc(); tx.update(items).set({status:"queued",error:null,startedAt:null,finishedAt:null,heartbeatAt:null}).where(and(eq(items.jobId,jobId),eq(items.status,"failed"))).run(); const row=tx.update(jobs).set({status:"queued",updatedAt:t}).where(eq(jobs.id,jobId)).returning().get(); tx.insert(events).values({jobId,type:"job.retry-failed",createdAt:t}).run(); return row;}),
    recoverStale: (before: string) => db.transaction(tx=>{const stale=tx.update(items).set({status:"queued",startedAt:null,heartbeatAt:null}).where(and(eq(items.status,"running"),lt(items.heartbeatAt,before))).returning().all(); for(const item of stale) tx.insert(events).values({jobId:item.jobId,itemId:item.id,type:"item.recovered",createdAt:nowUtc()}).run(); return stale;}),
    updateHeartbeat: (itemId:string) => db.update(items).set({heartbeatAt:nowUtc()}).where(and(eq(items.id,itemId),eq(items.status,"running"))).run(),
  };
}
export type Repositories = ReturnType<typeof createRepositories>;
export type Records = { AssetRow: AssetRow; JobRow: JobRow; ItemRow: ItemRow; RequestRow: RequestRow; FileRow: FileRow; EventRow: EventRow };
