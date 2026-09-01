import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const assets = sqliteTable(
  'assets',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    prompt: text('prompt').notNull(),
    category: text('category'),
    metadata: text('metadata').notNull().default('{}'),
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('assets_name_uq').on(t.name)],
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id').references(() => assets.id),
    assetName: text('asset_name').notNull(),
    authoredPromptSnapshot: text('authored_prompt_snapshot').notNull().default(''),
    referencesSnapshot: text('references_snapshot').notNull().default('[]'),
    promptSnapshot: text('prompt_snapshot').notNull(),
    optionsSnapshot: text('options_snapshot').notNull(),
    requestedCount: integer('requested_count').notNull(),
    status: text('status').notNull(),
    completedCount: integer('completed_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    cancelledAt: text('cancelled_at'),
  },
  (t) => [index('jobs_created_idx').on(t.createdAt)],
);

export const items = sqliteTable(
  'job_items',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    status: text('status').notNull(),
    error: text('error'),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    heartbeatAt: text('heartbeat_at'),
  },
  (t) => [uniqueIndex('items_job_ordinal_uq').on(t.jobId, t.ordinal), index('items_queue_idx').on(t.status)],
);

export const requests = sqliteTable(
  'llm_requests',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    attempt: integer('attempt').notNull(),
    status: text('status').notNull(),
    error: text('error'),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
  },
  (t) => [uniqueIndex('requests_item_attempt_uq').on(t.itemId, t.attempt)],
);

export const files = sqliteTable(
  'generated_files',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('files_item_name_uq').on(t.itemId, t.fileName)],
);

export const events = sqliteTable(
  'job_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    itemId: text('item_id').references(() => items.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    detail: text('detail'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('events_job_idx').on(t.jobId, t.id)],
);

export const schema = { assets, jobs, items, requests, files, events };
export type AssetRow = typeof assets.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type ItemRow = typeof items.$inferSelect;
export type RequestRow = typeof requests.$inferSelect;
export type FileRow = typeof files.$inferSelect;
export type EventRow = typeof events.$inferSelect;
