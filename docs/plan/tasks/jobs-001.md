---
id: jobs-001
scope: Durable single-item generation worker
status: done
depends-on: [db-001]
---

# Objective

Implement a server-owned worker that continues after browser disconnect, persists each LLM request's lifecycle, and resumes queued/stale work after restart.

## Context

- `docs/INDEX.md`
- `docs/web/README.md`
- `docs/plan/analysis/web-ui.md`
- `docs/plan/tasks/db-001.md`
- Existing provider logic in `src/generator.ts`.

## Path

- `src/jobs/**`
- `src/generator.ts`
- `src/db/**` only when required to complete the database contract
- `src/web-types.ts`
- `package.json`
- `docs/plan/tasks/jobs-001.md`

Do not modify `stickers/` or `stickers_archived/`.

## Requirements

- Add a single-image generation API while preserving existing CLI batch behavior.
- Worker concurrency defaults to 1 and queue truth is SQLite.
- Per item: claim, create request, heartbeat/progress updates, invoke provider, safely write output, register file, transition item/job.
- Support cancellation of queued/not-started items and retry of failed items without rerunning successes.
- Recover stale running work at startup, handling registered output files idempotently.
- Bound retries and avoid persisting credentials, absolute paths, or raw sensitive provider headers.

## Verification

Use a fake generator/provider in tests while exercising real database repositories. Prove browser lifecycle is irrelevant, per-item progress is persisted, success/failure/retry behavior is correct, cancellation boundaries are correct, and restart recovery is idempotent. Run `bun test` and TypeScript check.
