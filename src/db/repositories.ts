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
const transitionError = (message: string): never => { throw new Error(`invalid transition: ${message}`); };
const requireRow = <T>(row: T | undefined, message: string): T => { if (row === undefined) throw new Error(`invalid transition: ${message}`); return row; };

export function createRepositories(db: Db) {
  const refreshJob = (executor: any, jobId: string, at = nowUtc()) => {
    const rows = executor.select({ status: items.status }).from(items).where(eq(items.jobId, jobId)).all() as { status: ItemStatus }[];
    const completedCount = rows.filter((row) => row.status === "succeeded").length;
    const failedCount = rows.filter((row) => row.status === "failed").length;
    const hasQueued = rows.some((row) => row.status === "queued");
    const hasRunning = rows.some((row) => row.status === "running");
    const hasCancelled = rows.some((row) => row.status === "cancelled");
    const status: JobStatus = hasRunning || hasQueued
      ? (hasRunning ? "running" : "queued")
      : failedCount > 0 ? "failed" : hasCancelled ? "cancelled" : "succeeded";
    return executor.update(jobs).set({ completedCount, failedCount, status, updatedAt: at }).where(eq(jobs.id, jobId)).run();
  };
  const addEvent = (executor: any, jobId: string, type: string, itemId?: string, detail?: string) => executor.insert(events).values({ jobId, itemId, type, detail, createdAt: nowUtc() }).run();
  return {
    listAssets: (includeArchived = false) => db.select().from(assets).where(includeArchived ? undefined : isNull(assets.archivedAt)).orderBy(asc(assets.name)).all(),
    getAsset: (assetId: string) => db.select().from(assets).where(eq(assets.id, assetId)).get(),
    createAsset: (input: { name: string; prompt: string }) => { const t=nowUtc(), row={id:id(),name:input.name,prompt:input.prompt,createdAt:t,updatedAt:t}; db.insert(assets).values(row).run(); return row; },
    updateAsset: (assetId: string, input: { name?: string; prompt?: string }) => { const row=db.update(assets).set({...input,updatedAt:nowUtc()}).where(eq(assets.id,assetId)).returning().get(); return row; },
    archiveAsset: (assetId: string) => db.update(assets).set({archivedAt:nowUtc(),updatedAt:nowUtc()}).where(eq(assets.id,assetId)).returning().get(),
    createJob: (input: JobCreate) => db.transaction((tx) => { const t=nowUtc(), jobId=id(); tx.insert(jobs).values({id:jobId,assetId:input.assetId,assetName:input.assetName,promptSnapshot:input.prompt,optionsSnapshot:json(input.options),requestedCount:input.count,status:"queued",createdAt:t,updatedAt:t}).run(); for(let n=1;n<=input.count;n++) tx.insert(items).values({id:id(),jobId:jobId,ordinal:n,status:"queued"}).run(); addEvent(tx, jobId, "job.created", undefined, `${input.count} items`); return tx.select().from(jobs).where(eq(jobs.id,jobId)).get()!; }),
    getJob: (jobId: string) => ({ job: db.select().from(jobs).where(eq(jobs.id,jobId)).get(), items: db.select().from(items).where(eq(items.jobId,jobId)).orderBy(asc(items.ordinal)).all(), events: db.select().from(events).where(eq(events.jobId,jobId)).orderBy(asc(events.id)).all() }),
    listJobs: (limit=50, offset=0) => db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(limit).offset(offset).all(),
    claimNextItem: () => db.transaction((tx) => { const candidate=tx.select().from(items).where(eq(items.status,"queued")).orderBy(asc(items.ordinal)).limit(1).get(); if(!candidate) return; const t=nowUtc(); const changed=tx.update(items).set({status:"running",startedAt:t,heartbeatAt:t}).where(and(eq(items.id,candidate.id),eq(items.status,"queued"))).returning().get(); if(changed){tx.update(jobs).set({status:"running",updatedAt:t}).where(eq(jobs.id,candidate.jobId)).run(); addEvent(tx,candidate.jobId,"item.claimed",candidate.id);} return changed; }),
    startRequest: (itemId: string) => db.transaction((tx) => { const item=tx.select().from(items).where(eq(items.id,itemId)).get(); const existingItem = requireRow(item, `item ${itemId} not found`); if (existingItem.status !== "running") transitionError(`start request requires running item, got ${existingItem.status}`); const previous=tx.select({max:sql<number>`max(${requests.attempt})`}).from(requests).where(eq(requests.itemId,itemId)).get(); const attempt=(previous?.max ?? 0)+1, row={id:id(),itemId,attempt,status:"running" as const,startedAt:nowUtc()}; tx.insert(requests).values(row).run(); return row; }),
    finishRequest: (requestId: string, status: Exclude<RequestStatus,"running">, error?: string) => db.transaction((tx) => { const current=tx.select().from(requests).where(eq(requests.id,requestId)).get(); const existingRequest = requireRow(current, `request ${requestId} not found`); if (existingRequest.status !== "running") transitionError(`finish request requires running request, got ${existingRequest.status}`); return tx.update(requests).set({status,error,finishedAt:nowUtc()}).where(and(eq(requests.id,requestId),eq(requests.status,"running"))).returning().get(); }),
    finishItem: (itemId: string, status: Exclude<ItemStatus,"queued"|"running">, error?: string) => db.transaction(tx=>{const current=tx.select().from(items).where(eq(items.id,itemId)).get(); const existingItem = requireRow(current, `item ${itemId} not found`); if (existingItem.status !== "running") transitionError(`finish item requires running item, got ${existingItem.status}`); const row=tx.update(items).set({status,error,finishedAt:nowUtc(),heartbeatAt:null}).where(and(eq(items.id,itemId),eq(items.status,"running"))).returning().get(); if(row){const at=nowUtc(); refreshJob(tx,row.jobId,at); addEvent(tx,row.jobId,`item.${status}`,itemId,error);} return row;}),
    registerFile: (input: { itemId:string; fileName:string; mimeType:string; sizeBytes:number }) => { if(input.fileName.includes("/") || input.fileName.includes("\\") || input.fileName.startsWith(".") || input.sizeBytes < 0) throw new Error("invalid generated file"); const row={id:id(),...input,createdAt:nowUtc()}; db.insert(files).values(row).run(); return row; },
    getFile: (fileId: string) => db.select().from(files).where(eq(files.id,fileId)).get(),
    getFileByName: (fileName: string) => db.select().from(files).where(eq(files.fileName,fileName)).all(),
    getFileByItem: (itemId: string) => db.select().from(files).where(eq(files.itemId,itemId)).all(),
    getFileByJob: (jobId: string) => db.select({ file: files, itemId: items.id, jobId: items.jobId }).from(files).innerJoin(items, eq(files.itemId, items.id)).where(eq(items.jobId,jobId)).all(),
    getFileByNameAndJob: (fileName: string, jobId: string) => db.select({ file: files, itemId: items.id, jobId: items.jobId }).from(files).innerJoin(items, eq(files.itemId, items.id)).where(and(eq(files.fileName,fileName),eq(items.jobId,jobId))).all(),
    cancelJob: (jobId:string) => db.transaction(tx=>{const current=tx.select().from(jobs).where(eq(jobs.id,jobId)).get(); if (!current) return undefined; if (!["queued","running"].includes(current.status)) return current; const t=nowUtc(); tx.update(items).set({status:"cancelled",finishedAt:t,heartbeatAt:null}).where(and(eq(items.jobId,jobId),eq(items.status,"queued"))).run(); tx.update(jobs).set({status:"cancelled",cancelledAt:t,updatedAt:t}).where(eq(jobs.id,jobId)).run(); addEvent(tx,jobId,"job.cancelled"); refreshJob(tx,jobId,t); return tx.select().from(jobs).where(eq(jobs.id,jobId)).get();}),
    retryFailed: (jobId:string) => db.transaction(tx=>{const current=tx.select().from(jobs).where(eq(jobs.id,jobId)).get(); if (!current || current.status !== "failed") return undefined; const t=nowUtc(); const changed=tx.update(items).set({status:"queued",error:null,startedAt:null,finishedAt:null,heartbeatAt:null}).where(and(eq(items.jobId,jobId),eq(items.status,"failed"))).returning().all(); if (!changed.length) return current; tx.update(jobs).set({status:"queued",updatedAt:t}).where(eq(jobs.id,jobId)).run(); addEvent(tx,jobId,"job.retry-failed"); return tx.select().from(jobs).where(eq(jobs.id,jobId)).get();}),
    recoverStale: (before: string) => db.transaction(tx=>{const stale=tx.select().from(items).where(and(eq(items.status,"running"),lt(items.heartbeatAt,before))).all(); const recoveredRequests: RequestRow[] = []; for(const item of stale){ const running=tx.update(requests).set({status:"failed",error:"interrupted by stale recovery",finishedAt:nowUtc()}).where(and(eq(requests.itemId,item.id),eq(requests.status,"running"))).returning().all(); recoveredRequests.push(...running); for(const request of running) addEvent(tx,item.jobId,"request.recovered",item.id,request.id); tx.update(items).set({status:"queued",startedAt:null,heartbeatAt:null}).where(and(eq(items.id,item.id),eq(items.status,"running"))).run(); addEvent(tx,item.jobId,"item.recovered",item.id); refreshJob(tx,item.jobId); } return { items: stale, requests: recoveredRequests };}),
    updateHeartbeat: (itemId:string) => db.update(items).set({heartbeatAt:nowUtc()}).where(and(eq(items.id,itemId),eq(items.status,"running"))).run(),
  };
}
export type Repositories = ReturnType<typeof createRepositories>;
export type Records = { AssetRow: AssetRow; JobRow: JobRow; ItemRow: ItemRow; RequestRow: RequestRow; FileRow: FileRow; EventRow: EventRow };
