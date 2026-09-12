import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from './client';
import { nowUtc } from './client';
import {
  type AssetRow,
  assets,
  type EventRow,
  events,
  type FileRow,
  files,
  type ItemRow,
  items,
  type JobRow,
  jobs,
  type RequestRow,
  requests,
  type UploadRow,
  type UploadSummary,
  uploads,
} from './schema';

export type ItemStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type RequestStatus = 'running' | 'succeeded' | 'failed';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export interface AssetReferenceSnapshot {
  kind?: 'text';
  id: string;
  name: string;
  prompt: string;
  category: string | null;
  metadata: Record<string, unknown>;
}
export interface ImageReferenceSnapshot {
  kind: 'image';
  id: string;
  name: string;
  mimeType: string;
}
export interface JobCreate {
  assetId?: string;
  assetName?: string;
  prompt: string;
  authoredPrompt?: string;
  referencedAssets?: AssetReferenceSnapshot[];
  referencedImages?: ImageReferenceSnapshot[];
  options: Record<string, unknown>;
  count: number;
}
const id = () => randomUUID();
const json = (v: unknown) => JSON.stringify(v);
const transitionError = (message: string): never => {
  throw new Error(`invalid transition: ${message}`);
};
const requireRow = <T>(row: T | undefined, message: string): T => {
  if (row === undefined) {
    throw new Error(`invalid transition: ${message}`);
  }
  return row;
};

export function createRepositories(db: Db) {
  const refreshJob = (executor: any, jobId: string, at = nowUtc()) => {
    const rows = executor.select({ status: items.status }).from(items).where(eq(items.jobId, jobId)).all() as {
      status: ItemStatus;
    }[];
    const completedCount = rows.filter((row) => row.status === 'succeeded').length;
    const failedCount = rows.filter((row) => row.status === 'failed').length;
    const hasQueued = rows.some((row) => row.status === 'queued');
    const hasRunning = rows.some((row) => row.status === 'running');
    const hasCancelled = rows.some((row) => row.status === 'cancelled');
    const status: JobStatus =
      hasRunning || hasQueued
        ? hasRunning
          ? 'running'
          : 'queued'
        : failedCount > 0
          ? 'failed'
          : hasCancelled
            ? 'cancelled'
            : 'succeeded';
    return executor
      .update(jobs)
      .set({ completedCount, failedCount, status, updatedAt: at })
      .where(eq(jobs.id, jobId))
      .run();
  };
  const addEvent = (executor: any, jobId: string, type: string, itemId?: string, detail?: string) =>
    executor.insert(events).values({ jobId, itemId, type, detail, createdAt: nowUtc() }).run();
  return {
    listAssets: (includeArchived = false) =>
      db
        .select()
        .from(assets)
        .where(includeArchived ? undefined : isNull(assets.archivedAt))
        .orderBy(asc(assets.name))
        .all(),
    getAsset: (assetId: string) => db.select().from(assets).where(eq(assets.id, assetId)).get(),
    createAsset: (input: {
      name: string;
      prompt: string;
      category?: string | null;
      metadata?: Record<string, unknown>;
    }) => {
      const t = nowUtc(),
        row = {
          id: id(),
          name: input.name,
          prompt: input.prompt,
          category: input.category ?? null,
          metadata: json(input.metadata ?? {}),
          createdAt: t,
          updatedAt: t,
        };
      db.insert(assets).values(row).run();
      return row;
    },
    updateAsset: (
      assetId: string,
      input: { name?: string; prompt?: string; category?: string | null; metadata?: Record<string, unknown> },
    ) => {
      const { metadata, ...rest } = input;
      const values = { ...rest, ...(metadata === undefined ? {} : { metadata: json(metadata) }), updatedAt: nowUtc() };
      const row = db.update(assets).set(values).where(eq(assets.id, assetId)).returning().get();
      return row;
    },
    archiveAsset: (assetId: string) =>
      db
        .update(assets)
        .set({ archivedAt: nowUtc(), updatedAt: nowUtc() })
        .where(eq(assets.id, assetId))
        .returning()
        .get(),
    createUpload: (input: { name: string; mimeType: string; sizeBytes: number; data: string }): UploadSummary => {
      const t = nowUtc(),
        row = {
          id: id(),
          name: input.name,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          data: input.data,
          archivedAt: null,
          createdAt: t,
          updatedAt: t,
        };
      db.insert(uploads).values(row).run();
      const { data: _data, ...summary } = row;
      return summary;
    },
    listUploads: (includeArchived = false): UploadSummary[] =>
      db
        .select({
          id: uploads.id,
          name: uploads.name,
          mimeType: uploads.mimeType,
          sizeBytes: uploads.sizeBytes,
          archivedAt: uploads.archivedAt,
          createdAt: uploads.createdAt,
          updatedAt: uploads.updatedAt,
        })
        .from(uploads)
        .where(includeArchived ? undefined : isNull(uploads.archivedAt))
        .orderBy(desc(uploads.createdAt))
        .all(),
    getUpload: (uploadId: string): UploadRow | undefined =>
      db.select().from(uploads).where(eq(uploads.id, uploadId)).get(),
    archiveUpload: (uploadId: string): UploadSummary | undefined => {
      const row = db
        .update(uploads)
        .set({ archivedAt: nowUtc(), updatedAt: nowUtc() })
        .where(eq(uploads.id, uploadId))
        .returning()
        .get();
      if (!row) {
        return undefined;
      }
      const { data: _data, ...summary } = row;
      return summary;
    },
    createJob: (input: JobCreate) =>
      db.transaction((tx) => {
        const t = nowUtc(),
          jobId = id(),
          refs = [
            ...(input.referencedAssets ?? []).map((ref) => ({ ...ref, kind: 'text' as const })),
            ...(input.referencedImages ?? []),
          ];
        tx.insert(jobs)
          .values({
            id: jobId,
            assetId: input.assetId,
            assetName: input.assetName ?? refs.find((ref) => ref.kind === 'text')?.name ?? 'text',
            authoredPromptSnapshot: input.authoredPrompt ?? input.prompt,
            referencesSnapshot: json(refs),
            promptSnapshot: input.prompt,
            optionsSnapshot: json(input.options),
            requestedCount: input.count,
            status: 'queued',
            createdAt: t,
            updatedAt: t,
          })
          .run();
        for (let n = 1; n <= input.count; n++) {
          tx.insert(items).values({ id: id(), jobId: jobId, ordinal: n, status: 'queued' }).run();
        }
        addEvent(tx, jobId, 'job.created', undefined, `${input.count} items`);
        return tx.select().from(jobs).where(eq(jobs.id, jobId)).get()!;
      }),
    getJob: (jobId: string) => ({
      job: db.select().from(jobs).where(eq(jobs.id, jobId)).get(),
      items: db.select().from(items).where(eq(items.jobId, jobId)).orderBy(asc(items.ordinal)).all(),
      events: db.select().from(events).where(eq(events.jobId, jobId)).orderBy(asc(events.id)).all(),
    }),
    getItem: (itemId: string) => db.select().from(items).where(eq(items.id, itemId)).get(),
    listRequests: (itemId: string) =>
      db.select().from(requests).where(eq(requests.itemId, itemId)).orderBy(desc(requests.attempt)).all(),
    listJobs: (limit = 50, offset = 0) =>
      db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(limit).offset(offset).all(),
    /** Claim the oldest queued item, optionally restricted to one job so a caller never drains another job's work. */
    claimNextItem: (jobId?: string) =>
      db.transaction((tx) => {
        const candidate = tx
          .select()
          .from(items)
          .where(jobId ? and(eq(items.status, 'queued'), eq(items.jobId, jobId)) : eq(items.status, 'queued'))
          .orderBy(asc(items.ordinal))
          .limit(1)
          .get();
        if (!candidate) {
          return;
        }
        const t = nowUtc();
        const changed = tx
          .update(items)
          .set({ status: 'running', startedAt: t, heartbeatAt: t })
          .where(and(eq(items.id, candidate.id), eq(items.status, 'queued')))
          .returning()
          .get();
        if (changed) {
          tx.update(jobs).set({ status: 'running', updatedAt: t }).where(eq(jobs.id, candidate.jobId)).run();
          addEvent(tx, candidate.jobId, 'item.claimed', candidate.id);
        }
        return changed;
      }),
    startRequest: (itemId: string) =>
      db.transaction((tx) => {
        const item = tx.select().from(items).where(eq(items.id, itemId)).get();
        const existingItem = requireRow(item, `item ${itemId} not found`);
        if (existingItem.status !== 'running') {
          transitionError(`start request requires running item, got ${existingItem.status}`);
        }
        const job = requireRow(
          tx.select().from(jobs).where(eq(jobs.id, existingItem.jobId)).get(),
          `job ${existingItem.jobId} not found`,
        );
        if (job.status === 'cancelled') {
          transitionError('start request rejected for cancelled job');
        }
        const previous = tx
          .select({ max: sql<number>`max(${requests.attempt})` })
          .from(requests)
          .where(eq(requests.itemId, itemId))
          .get();
        const attempt = (previous?.max ?? 0) + 1,
          row = { id: id(), itemId, attempt, status: 'running' as const, startedAt: nowUtc() };
        tx.insert(requests).values(row).run();
        return row;
      }),
    finishRequest: (requestId: string, status: Exclude<RequestStatus, 'running'>, error?: string) =>
      db.transaction((tx) => {
        const current = tx.select().from(requests).where(eq(requests.id, requestId)).get();
        const existingRequest = requireRow(current, `request ${requestId} not found`);
        if (existingRequest.status !== 'running') {
          transitionError(`finish request requires running request, got ${existingRequest.status}`);
        }
        return tx
          .update(requests)
          .set({ status, error, finishedAt: nowUtc() })
          .where(and(eq(requests.id, requestId), eq(requests.status, 'running')))
          .returning()
          .get();
      }),
    finishItem: (itemId: string, status: Exclude<ItemStatus, 'queued' | 'running'>, error?: string) =>
      db.transaction((tx) => {
        const current = tx.select().from(items).where(eq(items.id, itemId)).get();
        const existingItem = requireRow(current, `item ${itemId} not found`);
        if (existingItem.status !== 'running') {
          transitionError(`finish item requires running item, got ${existingItem.status}`);
        }
        const row = tx
          .update(items)
          .set({ status, error, finishedAt: nowUtc(), heartbeatAt: null })
          .where(and(eq(items.id, itemId), eq(items.status, 'running')))
          .returning()
          .get();
        if (row) {
          const at = nowUtc();
          refreshJob(tx, row.jobId, at);
          addEvent(tx, row.jobId, `item.${status}`, itemId, error);
        }
        return row;
      }),
    finalizeRequest: (input: {
      requestId: string;
      itemId: string;
      status: Exclude<RequestStatus, 'running'>;
      error?: string;
      file?: { fileName: string; mimeType: string; sizeBytes: number };
    }) =>
      db.transaction((tx) => {
        const request = requireRow(
          tx.select().from(requests).where(eq(requests.id, input.requestId)).get(),
          `request ${input.requestId} not found`,
        );
        const item = requireRow(
          tx.select().from(items).where(eq(items.id, input.itemId)).get(),
          `item ${input.itemId} not found`,
        );
        if (request.itemId !== input.itemId || request.status !== 'running') {
          transitionError('finalize requires running request for item');
        }
        if (item.status !== 'running') {
          transitionError(`finalize requires running item, got ${item.status}`);
        }
        const at = nowUtc();
        tx.update(requests)
          .set({ status: input.status, error: input.error, finishedAt: at })
          .where(and(eq(requests.id, input.requestId), eq(requests.status, 'running')))
          .run();
        if (input.status === 'succeeded' && input.file) {
          if (
            input.file.fileName.includes('/') ||
            input.file.fileName.includes('\\') ||
            input.file.fileName.startsWith('.') ||
            input.file.sizeBytes < 0
          ) {
            throw new Error('invalid generated file');
          }
          const registered = tx
            .select()
            .from(files)
            .where(and(eq(files.itemId, input.itemId), eq(files.fileName, input.file.fileName)))
            .get();
          if (!registered) {
            tx.insert(files)
              .values({ id: id(), itemId: input.itemId, ...input.file, createdAt: at })
              .run();
          }
        }
        const itemRow = tx
          .update(items)
          .set({ status: input.status, error: input.error, finishedAt: at, heartbeatAt: null })
          .where(and(eq(items.id, input.itemId), eq(items.status, 'running')))
          .returning()
          .get();
        if (!itemRow) {
          transitionError('item changed during finalize');
        }
        refreshJob(tx, itemRow.jobId, at);
        addEvent(tx, itemRow.jobId, `item.${input.status}`, itemRow.id, input.error);
        return itemRow;
      }),
    completeRegisteredItem: (itemId: string, fileName: string) =>
      db.transaction((tx) => {
        const item = requireRow(tx.select().from(items).where(eq(items.id, itemId)).get(), `item ${itemId} not found`);
        if (item.status !== 'running') {
          transitionError(`complete registered item requires running item, got ${item.status}`);
        }
        const registered = tx
          .select()
          .from(files)
          .where(and(eq(files.itemId, itemId), eq(files.fileName, fileName)))
          .get();
        if (!registered) {
          transitionError('registered file not found');
        }
        const at = nowUtc();
        const row = tx
          .update(items)
          .set({ status: 'succeeded', error: null, finishedAt: at, heartbeatAt: null })
          .where(and(eq(items.id, itemId), eq(items.status, 'running')))
          .returning()
          .get();
        if (!row) {
          transitionError('item changed during registered completion');
        }
        refreshJob(tx, row.jobId, at);
        addEvent(tx, row.jobId, 'item.succeeded', itemId, 'registered output reused');
        return row;
      }),
    registerFile: (input: { itemId: string; fileName: string; mimeType: string; sizeBytes: number }) => {
      if (
        input.fileName.includes('/') ||
        input.fileName.includes('\\') ||
        input.fileName.startsWith('.') ||
        input.sizeBytes < 0
      ) {
        throw new Error('invalid generated file');
      }
      const row = { id: id(), ...input, createdAt: nowUtc() };
      db.insert(files).values(row).run();
      return row;
    },
    getFile: (fileId: string) => db.select().from(files).where(eq(files.id, fileId)).get(),
    getFileByName: (fileName: string) => db.select().from(files).where(eq(files.fileName, fileName)).all(),
    getFileByItem: (itemId: string) => db.select().from(files).where(eq(files.itemId, itemId)).all(),
    getFileByJob: (jobId: string) =>
      db
        .select({ file: files, itemId: items.id, jobId: items.jobId })
        .from(files)
        .innerJoin(items, eq(files.itemId, items.id))
        .where(eq(items.jobId, jobId))
        .all(),
    getFileByNameAndJob: (fileName: string, jobId: string) =>
      db
        .select({ file: files, itemId: items.id, jobId: items.jobId })
        .from(files)
        .innerJoin(items, eq(files.itemId, items.id))
        .where(and(eq(files.fileName, fileName), eq(items.jobId, jobId)))
        .all(),
    cancelJob: (jobId: string) =>
      db.transaction((tx) => {
        const current = tx.select().from(jobs).where(eq(jobs.id, jobId)).get();
        if (!current) {
          return undefined;
        }
        if (!['queued', 'running'].includes(current.status)) {
          return current;
        }
        const t = nowUtc();
        tx.update(items)
          .set({ status: 'cancelled', finishedAt: t, heartbeatAt: null })
          .where(
            and(
              eq(items.jobId, jobId),
              sql`${items.status} = 'queued' OR (${items.status} = 'running' AND NOT EXISTS (SELECT 1 FROM llm_requests WHERE llm_requests.item_id = ${items.id} AND llm_requests.status = 'running'))`,
            ),
          )
          .run();
        tx.update(jobs).set({ status: 'cancelled', cancelledAt: t, updatedAt: t }).where(eq(jobs.id, jobId)).run();
        addEvent(tx, jobId, 'job.cancelled');
        refreshJob(tx, jobId, t);
        return tx.select().from(jobs).where(eq(jobs.id, jobId)).get();
      }),
    retryFailed: (jobId: string) =>
      db.transaction((tx) => {
        const current = tx.select().from(jobs).where(eq(jobs.id, jobId)).get();
        if (current?.status !== 'failed') {
          return undefined;
        }
        const t = nowUtc();
        const changed = tx
          .update(items)
          .set({ status: 'queued', error: null, startedAt: null, finishedAt: null, heartbeatAt: null })
          .where(and(eq(items.jobId, jobId), eq(items.status, 'failed')))
          .returning()
          .all();
        if (!changed.length) {
          return current;
        }
        tx.update(jobs).set({ status: 'queued', updatedAt: t }).where(eq(jobs.id, jobId)).run();
        addEvent(tx, jobId, 'job.retry-failed');
        return tx.select().from(jobs).where(eq(jobs.id, jobId)).get();
      }),
    recoverStale: (before: string) =>
      db.transaction((tx) => {
        const stale = tx
          .select()
          .from(items)
          .where(and(eq(items.status, 'running'), lt(items.heartbeatAt, before)))
          .all();
        const recoveredRequests: RequestRow[] = [];
        for (const item of stale) {
          const running = tx
            .update(requests)
            .set({ status: 'failed', error: 'interrupted by stale recovery', finishedAt: nowUtc() })
            .where(and(eq(requests.itemId, item.id), eq(requests.status, 'running')))
            .returning()
            .all();
          recoveredRequests.push(...running);
          for (const request of running) {
            addEvent(tx, item.jobId, 'request.recovered', item.id, request.id);
          }
          tx.update(items)
            .set({ status: 'queued', startedAt: null, heartbeatAt: null })
            .where(and(eq(items.id, item.id), eq(items.status, 'running')))
            .run();
          addEvent(tx, item.jobId, 'item.recovered', item.id);
          refreshJob(tx, item.jobId);
        }
        return { items: stale, requests: recoveredRequests };
      }),
    updateHeartbeat: (itemId: string) =>
      db
        .update(items)
        .set({ heartbeatAt: nowUtc() })
        .where(and(eq(items.id, itemId), eq(items.status, 'running')))
        .run(),
  };
}
export type Repositories = ReturnType<typeof createRepositories>;
export type Records = {
  AssetRow: AssetRow;
  JobRow: JobRow;
  ItemRow: ItemRow;
  RequestRow: RequestRow;
  FileRow: FileRow;
  EventRow: EventRow;
  UploadRow: UploadRow;
};
