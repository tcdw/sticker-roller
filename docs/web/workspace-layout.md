# Workspace Layout

Status: Approved correction

## Design Principles

The workspace follows the supplied prototype: a large left materials rail and a wide right task canvas. Materials are reusable references inserted into the prompt; the prompt composer is the task itself.

## Overall Structure

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ 生图工作室                                                                   │
│                                                                              │
│ ┌────────────────────┐ ┌───────────────────────────────────────────────────┐ │
│ │ 我的素材           │ │ @通用Telegram贴纸模板                            │ │
│ │                    │ │ @雪乃碗 抱住二次元人物。                         │ │
│ │ ┌────────────────┐ │ │ ## 人物特征                                       │ │
│ │ │ 提示词 (2)     │ │ │ 浅蓝短发的Q版兽耳少女……                          │ │
│ │ │                │ │ │                                                   │ │
│ │ │ @通用Telegram… │ │ └───────────────────────────────────────────────────┘ │
│ │ │ 壁纸           │ │ [ Nano Banana 2 ] [ 1:1 / 2k ] [添加图片] [更多参数] │ │
│ │ └────────────────┘ │                                      [提交任务]     │ │
│ │ ┌────────────────┐ │ 2026-09-01 20:30 (6 张)                           │ │
│ │ │ 人物 (3)       │ │ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌───────┐ │
│ │ │                │ │ │ 图片   │ │ 图片   │ │ 图片   │ │ 图片   │ │ 图片  │ │
│ │ │ @雪乃碗        │ │ └────────┘ └────────┘ └────────┘ └────────┘ └───────┘ │
│ │ │ 塑料碗         │ │ ┌────────┐                                             │
│ │ │ cronfox        │ │ │ 图片   │                                             │
│ │ └────────────────┘ │ └────────┘                                             │
│ └────────────────────┘ └───────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Page-Level Layout

- Full viewport canvas with a thin dark outer frame.
- Header title at the upper left: `生图工作室`.
- Main area uses a narrow sidebar (about 19–21% width) and a flexible task area.
- Sidebar is a scrollable materials browser.
- Task area is a vertical stack: prompt composer, generation toolbar, task history/results.

## Region Layout

### Materials sidebar

- Heading: `我的素材`.
- Group assets by explicit `category` metadata. Phase 1 may use `提示词` and `人物`; it must not infer categories from prompt content.
- Group title includes count, e.g. `提示词 (2)`.
- Each material is a selectable bordered card with its name and short preview.
- Selecting/clicking a material inserts its reference token into the prompt composer at the current caret position. It does not replace the composer content and does not immediately submit a job.
- Provide a visible create-material action. Material editing is separate from task prompt editing.

### Prompt composer

- Large bordered multiline editor at the top of the task area.
- Shows the authored prompt text and asset reference tokens in readable form.
- Tokens are removable/editable without losing surrounding prose.
- The editor is the primary task input; there is no separate “asset prompt” masquerading as the task prompt.

### Generation toolbar

- Compact horizontal controls below the composer:
  - model selector, displayed as a colored pill/button;
  - aspect ratio and size selector, e.g. `1:1 / 2k`;
  - `添加图片` reserved/disabled in Phase 1 because Web assets are text-only;
  - `更多参数` opens a dialog for count/background and advanced options;
  - right-aligned `提交任务`.
- Submit is disabled while the job request is being created or when the composed prompt is empty.

### Task history and results

- Each task has a timestamp and requested count, e.g. `2026-09-01 20:30 (6 张)`.
- Active tasks show durable progress and current item state.
- Results are displayed as a wrapping grid of image cards, sized to fit the available width.
- Failed items show their error and retry action; successful items show preview/download.

## Interactions

| Input | Scope | Behavior |
|---|---|---|
| Material card click | Sidebar | Insert an `@material` reference at the prompt caret. Preserve existing prompt text. |
| Material double click/edit | Sidebar | Open material editor; saving changes material metadata/content, not current task prompt. |
| Prompt editor | Task | Edit composed authored text and tokens. |
| More parameters | Toolbar | Open dialog; apply or cancel without changing unrelated prompt content. |
| Add image | Toolbar | Disabled with Phase 1 explanation; enabled only when image assets are implemented. |
| Submit task | Toolbar | Sends composed prompt and referenced asset IDs; creates a durable job. |
| Refresh/reopen | Whole page | Reloads assets/jobs from SQLite and resumes active job polling. |
| Cancel | Active task | Cancels queued/not-started items only. |
| Retry failed | Task | Requeues failed items without rerunning successful items. |
| Escape | Dialog | Closes dialog and returns focus to its trigger. |

## State Variants

- Loading: skeleton material groups, prompt editor disabled, toolbar controls disabled.
- Empty materials: empty groups plus `创建素材` action; prompt composer remains usable.
- Empty prompt: submit disabled and inline hint explains that a prompt is required.
- Busy task: progress count, active item indicator, disabled duplicate submit.
- Failed item: error card with retry, no fake image.
- API error: inline error banner with retry action.
- Narrow window: sidebar becomes a collapsible materials drawer; toolbar wraps; results reduce to one column.

## Responsive / Size Constraints

- Desktop target: at least 1100px wide; sidebar 260–320px.
- The prompt composer uses the majority of the horizontal canvas and a minimum height of 180px.
- Result grid uses `repeat(auto-fit, minmax(150px, 1fr))`.
- At widths below 760px, the material drawer can collapse above the composer; submit remains visible and toolbar controls wrap.

## Component Tree

```text
App
└── WorkspaceRoute
    ├── WorkspaceShell
    │   ├── MaterialsSidebar
    │   │   ├── MaterialGroup
    │   │   │   └── MaterialCard
    │   │   └── MaterialEditorDialog
    │   └── TaskCanvas
    │       ├── PromptComposer
    │       │   └── AssetReferenceToken
    │       ├── GenerationToolbar
    │       │   └── MoreParametersDialog
    │       └── TaskHistory
    │           └── TaskCard
    │               └── ImageResultCard
```

## Page Entry Points

- `/`: the workbench shown in the supplied prototype.
