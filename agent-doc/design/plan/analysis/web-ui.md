# Web UI delivery analysis

## Module decomposition

### db-001 — Durable SQLite data layer

- Scope: Drizzle schema, migration, Bun SQLite client, repositories for assets/jobs/items/requests/files/events.
- Inputs: validated repository command objects.
- Outputs: typed records and atomic state transitions.
- Dependencies: `drizzle-orm`, `bun:sqlite`.
- Verification: isolated SQLite database tests for persistence, constraints, transactions, pagination, and recovery transitions.

### jobs-001 — Durable generation worker

- Scope: single-image generator boundary, queue claim, per-item LLM request lifecycle, heartbeat, retry/cancel, crash recovery.
- Inputs: queued jobs from repository and generator adapter.
- Outputs: generated files plus durable progress state.
- Dependencies: db-001, existing generator/provider implementation.
- Verification: fake generator integration tests exercising real repository transitions; no browser dependency.

### api-001 — Bun HTTP API

- Scope: route parsing, JSON validation, asset/job CRUD/control, safe output delivery, error envelope.
- Inputs: HTTP requests.
- Outputs: HTTP responses and durable commands.
- Dependencies: db-001, jobs-001.
- Verification: request-level tests using real server handler/repositories; invalid input and path safety tests.

### ui-002 — Prototype-faithful material-reference workspace

- Scope: reusable material semantics, server-side reference expansion, actual shadcn/ui component system, prototype-faithful two-region workspace.
- Inputs: material references and authored prompt text.
- Outputs: immutable expanded job prompt and material-reference UI.
- Dependencies: db-001, api-001.
- Verification: repository/API snapshot tests, caret insertion/store tests, production build and browser visual smoke.

## Integration enumeration

1. `web UI -> POST /api/assets -> asset repository -> SQLite assets`.
2. `web UI -> GET /api/assets/:id -> asset repository -> prompt editor`.
3. `web UI -> POST /api/jobs -> API validator -> job repository transaction -> SQLite job/items/events`.
4. `job repository -> worker claim -> single-image generator -> provider -> output file -> generated_files transaction`.
5. `worker -> job/item/request event updates -> GET /api/jobs/:id -> TanStack Query polling -> progress UI`.
6. `worker -> startup recovery -> SQLite queued state -> worker continuation`, independent of browser lifecycle.
7. `web UI -> cancel/retry routes -> repository transitions -> worker behavior`.
8. `image result URL -> output registry validation -> Bun file response -> image card/download`.
9. `Bun server startup -> Drizzle migration -> empty SQLite database`; explicitly no `stickers/` or `stickers_archived/` import.

## Task dependency graph

```text
db-001 ──────┐
             ├── jobs-001 ──┐
             └── api-001 ───┼── ui-001 ── e2e-001
                            │
                            └── api integration
```

`api-001` and `jobs-001` both depend on the database contract. They may be developed in parallel only with isolated worktrees; integration and UI wait for both.
