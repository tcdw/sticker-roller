# Workspace Layout

Status: Approved for implementation

## Design Principles

The page is a high-contrast local workbench. The database-backed job state is always more authoritative than transient browser state.

## Overall Structure

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Sticker Roller                                                        │
├───────────────┬──────────────────────────────────────────────────────┤
│ Assets        │ Prompt editor                                        │
│               │                                                      │
│ text asset    │ ┌──────────────────────────────────────────────────┐ │
│ list          │ │ prompt                                           │ │
│               │ └──────────────────────────────────────────────────┘ │
│ + New asset   │ Parameters  [model] [ratio] [size] [count] [submit] │
│               │                                                      │
│               │ Durable job history                                  │
│               │ ┌──────────────┐ ┌──────────────┐                   │
│               │ │ item image   │ │ item image   │ ...               │
│               │ └──────────────┘ └──────────────┘                   │
└───────────────┴──────────────────────────────────────────────────────┘
```

## Interactions

| Input | Scope | Behavior |
|---|---|---|
| Asset card click | Sidebar | Loads the SQLite asset prompt into the editor. |
| Prompt editor | Current draft | Edits a job override; it does not save the asset automatically. |
| Save asset | Asset editor | Persists text and updates the asset list. |
| Submit job | Toolbar | Creates a durable job and disables duplicate submission while the request is pending. |
| Refresh/reopen | Whole page | Fetches jobs from SQLite and resumes polling active jobs. |
| Cancel | Active job | Requests cancellation of queued items only. |
| Retry failed | Completed job | Requeues failed items without rerunning successful items. |
| Escape | Dialog | Closes the parameters or asset dialog without applying draft changes. |

## State Variants

- Loading: skeleton/sidebar placeholder and disabled submit.
- Empty assets: centered prompt to create the first text asset.
- Empty history: explanation that submitted jobs appear here.
- Busy job: persisted progress count and current request status.
- Failed item: error text, retry action, no fake image placeholder.
- Server/API error: inline message with retry control.

## Responsive / Size Constraints

- Desktop: fixed-width sidebar and flexible editor/history pane.
- Narrow windows: sidebar becomes a collapsible top region; job grid reduces to one column.
- Prompt text remains scrollable and never exposes local filesystem paths.

## Component Tree

```text
App
└── WorkspaceRoute
    ├── WorkspaceShell
    │   ├── AssetSidebar
    │   └── MainWorkspace
    │       ├── AssetEditor
    │       │   └── PromptEditor
    │       ├── GenerationToolbar
    │       └── JobHistory
    │           └── JobCard
    │               └── ImageResultCard
    └── MoreParametersDialog
```

## Page Entry Points

- `/`: workspace.
