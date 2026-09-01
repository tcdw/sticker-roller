# Web application scope

Status: Approved for implementation

## Purpose and boundary

The web scope provides a local browser UI for creating text assets and running image-generation jobs. The Bun server owns persistence, credentials, job execution, recovery, and output delivery. The browser owns presentation and draft form state.

Phase 1 stores only text assets in SQLite. It does not migrate or scan `stickers/` or `stickers_archived/`; the existing CLI filesystem behavior remains independent.

## Concepts

| Concept | Definition |
|---|---|
| Asset | A user-managed text prompt stored in SQLite. |
| Job | A durable generation request containing immutable prompt and parameter snapshots. |
| Item | One requested output image within a job. |
| LLM request | One provider call for one item, with durable status and attempt tracking. |
| Worker | The server-owned loop that executes queued items independently of browsers. |

## Ownership and lifecycle

```text
Browser ──HTTP──> Bun API ──transaction──> SQLite
                         │                     │
                         └──────> Worker <─────┘
                                      │
                                      └──> LLM provider ──> output file + SQLite record
```

- API routes validate input and write durable state.
- The worker claims queued items from SQLite and updates heartbeat/progress.
- SQLite is the source of truth after refresh or server restart.
- Startup recovery marks stale running provider requests as `failed` with an interruption error, requeues their running items, recomputes the related job, and records recovery events.
- The Bun server lifecycle must call `startGenerationWorker(worker)` after repositories/database initialization and `stopGenerationWorker(worker)` during shutdown. `start()` performs stale recovery before its continuous drain loop; worker execution is independent of browser connections.
- Item heartbeat is the lease contract for both the worker item and its active LLM request; requests do not have a separate heartbeat column. The worker refreshes it while the provider call is active.
- Job status is derived transactionally from item states: any running item means `running`; otherwise any queued item means `queued`; once all items are terminal, any failed item means `failed`, otherwise cancelled items mean `cancelled`, and otherwise the job is `succeeded`.
- Output files are server-owned and exposed only through registered database records; the registry can be queried by file name and associated item/job.

## Public entry points

- `bun run dev`: local development server and frontend.
- `bun run web`: production Bun server serving the built frontend and API.
- `GET /api/assets`, `POST/PATCH /api/assets/:id`: text asset management.
- `POST /api/jobs`, `GET /api/jobs/:id`: durable generation control and progress.
- `POST /api/jobs/:id/cancel`, `POST /api/jobs/:id/retry-failed`: job control.
- `GET /api/output/:fileName`: registered generated image delivery.

## Cross-module decisions

- SQLite schema changes use Drizzle migrations. Filesystem data migration is explicitly out of scope this round.
- The worker has default concurrency 1.
- Closing a browser never cancels a job.
- Cancellation only prevents not-yet-started provider calls.
- Credentials remain in server environment variables and are never serialized to API/database business fields.
- The generator must expose a single-image call so each provider request can be persisted independently.

## Module index

- Database client, schema, and repositories: `src/db/`
- Durable worker: `src/jobs/`
- HTTP API: `server/`
- Shared contracts: `src/web-types.ts`
- Browser UI: `web/`
