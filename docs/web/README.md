# Web workspace contract correction

Status: Approved correction

## Core semantic model

An **asset is reusable source material**, not a prompt record.

```text
Asset: "雪乃碗" ──reference──┐
Asset: "二次元人物" ──reference─┼──> prompt composer ──> one generation job
Asset: "cronfox" ──reference──┘
```

Each asset has a display name and reusable content. The content may be text in Phase 1. When the user selects an asset in the left sidebar, the UI inserts a reference token into the prompt composer, for example `@雪乃碗`, rather than replacing the entire editor with the asset content. The generated job stores an immutable expanded prompt snapshot.

Phase 1 does not migrate or scan `stickers/` or `stickers_archived/`. Web assets are created and managed in SQLite only. Future asset kinds may contain images, but the asset-reference contract is already distinct from the current text-only storage limitation.

## Corrected concepts

| Concept | Definition |
|---|---|
| Asset | Reusable named material that can be referenced from a prompt. It is not itself the task prompt. |
| Asset reference | A user-visible token such as `@雪乃碗` inserted into the prompt composer. |
| Prompt composer | The complete editable task prompt containing prose and zero or more asset references. |
| Expanded prompt | Server-resolved prompt snapshot used by the LLM; stored immutably on the job. |
| Job | A durable generation request created from the composed prompt and parameter snapshot. |

## Required server behavior

- `assets` stores reusable material and metadata, not task-specific prompt snapshots.
- `POST /api/jobs` accepts a composed prompt plus asset reference IDs/tokens, validates every referenced asset, resolves references server-side, and stores both the authored prompt and expanded prompt snapshot.
- A job must preserve the selected asset references at submission time. Later asset edits do not change existing jobs.
- Asset content must never be silently appended to every job; only explicitly referenced assets are resolved.
- API responses should expose asset summaries and reference identity, but never expose local absolute paths or credentials.

## Corrected ownership flow

```text
Asset sidebar ──insert @asset token──> Prompt composer
                                          │
                                          ├── text authored by user
                                          └── referenced asset IDs
                                                  │
                                                  ▼
                                           POST /api/jobs
                                                  │
                                  validate + resolve + snapshot in SQLite
                                                  │
                                                  ▼
                                               Worker
```

## Existing durable worker contract

The server-owned worker, SQLite persistence, per-item LLM requests, browser-independent execution, restart recovery, output registry, cancellation boundary, and retry semantics remain unchanged.
