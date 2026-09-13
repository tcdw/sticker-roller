# 前端工作台

单页应用，当前只有 `/` 一个路由（`@tanstack/react-router` 已装好，多页时再扩）。页面装配在 `web/src/main.tsx`，可复用的界面块在 `web/src/components/Composer.tsx`（`MaterialsSidebar` / `PromptComposer` / `UploadStrip` / `AssetReferenceToken`），数据层与纯函数在 `web/src/api.ts`，原子组件是 shadcn 生成的 `web/src/components/ui/*`。

视觉与布局契约的完整原文在 [design/web/workspace-layout.md](design/web/workspace-layout.md)（已批准的修正案）。本页只记录当前实现与容易踩的点。

## 页面分区

```text
┌──────────────────────────────────────────────────────────┐
│ 生图工作室（header）                                      │
├───────────────┬──────────────────────────────────────────┤
│ 我的素材      │ Prompt 提交器（textarea + token）         │
│  提示词 (2)   ├──────────────────────────────────────────┤
│   素材卡片…   │ 生成工具条：模型 / 比例尺寸 / 图片 / 更多参数 / 提交 │
│  人物 (3)     ├──────────────────────────────────────────┤
│   素材卡片…   │ 任务历史（每页 10 条，可翻页）             │
│               │   任务卡片 → 结果网格 → 图片卡片           │
└───────────────┴──────────────────────────────────────────┘
```

- 素材按 `category` 分组，标题带计数；分类**不**从 prompt 内容推断。
- 素材卡片单击把素材引用 token（`@` + 方括号名字 + `(asset:<id>)`）插到光标处，不覆盖已有正文、不自动提交。
- 工具条使用 `ProviderOptionsFields` 渲染渠道、模型和专属字段，背景策略独立，张数在更多参数中。草稿为 `{ selection, count }`；跨渠道重建专属参数，同渠道切模型保留仍兼容的字段和背景，仅清理不兼容值并提示，不改 prompt、引用和张数。更多参数只返回张数，应用时合并当前草稿，不写回打开弹窗时的渠道快照。新草稿固定从 Google 开始，不根据环境自动切换；仅配置 Gateway 时需显式选择它。
- `/api/image-providers` 提供安全本地配置状态；未配置渠道可浏览，提交禁用，服务端仍独立检查。该状态不是账户可用性测试。
- 结果网格列数固定（xl 6 列、md/lg 4 列、sm 3 列、更窄 2 列），图少时留空格而不是拉伸。

## 状态与数据流

| 关注点 | 实现 |
| --- | --- |
| 服务端状态 | `@tanstack/react-query`：`['assets']` / `['uploads']` / `['jobs', page]`（列表）/ `['job', id]`（详情） |
| 轮询 | 列表与详情的 `refetchInterval` 都是：**存在 active 任务时 1.5s，否则关闭**。`isActive` 判定 `queued` / `running` |
| 提交器草稿 | `zustand` 的 `useDraft`：prompt、`referencedAssetIds`、`options`；`clearPrompt()` 清空 prompt **与** `referencedAssetIds`（素材引用跟着清，生成参数保留） |
| 历史分页 | 服务端分页，`HISTORY_PAGE_SIZE = 10`，`pageCount()` / `pageOffset()` 是纯函数（有测试）；提交后回到第 1 页 |

**提交时前端不算「哪些素材被引用」**：`referencedIdsFromPrompt()` 从 prompt 里的 token 提取 id 后交给服务端，服务端再解析一次。两侧共用 `src/prompt-tokens.ts`，所以判定一致。

## 容易踩的点

- **`web/src/api.ts` 不是 CRUD 层**：它是 API 客户端 + 纯函数 + store 的混合体。历史任务的还原逻辑（`optionsFromSnapshot` / `draftFromJob`）就在这里，改「复用历史任务」要改这个文件，不是 `main.tsx`。
- **只 import 纯 TS 共享模块**：`src/prompt-tokens.ts`、`src/image-options.ts`、`src/web-types.ts`。它们不能引入 `node:*`（前端直接打包）。需要新共享逻辑就新建纯 TS 模块，别顺手 import `src/config.ts`。
- **`optionsFromSnapshot()` 不再静默降级**：未知版本、渠道、模型或字段明确不可复用；单条失败通过通知显示，不使历史列表崩溃。旧快照使用服务端返回的当前 legacy 渠道，并显示这不是历史渠道事实。结构比较使用 `selectionsEqual`。
- **复用历史任务要处理已失效的参考图**：`draftFromJob()` 会把「引用了但已归档/删除」的图片 token 从 prompt 里剥掉，并返回 `missingImageNames` 供提示用户。别把这段逻辑删掉——留着死 token 会让提交直接失败。
- **未引用图片要先确认**：提交器里有图但 prompt 没引用时先弹确认（`unreferencedUploads()` 用的是和提交同一个解析器），避免用户以为图会被用上。
- **上传走 multipart**：`api.createUpload` 不能带 JSON content-type（浏览器要自己设 boundary），和 `api.request` 的默认行为不同。
- **shadcn 约束**：不要新加自定义样式表去重造 Button / Card / Dialog / Select / Badge 等；全局样式只允许 `web/src/globals.css` 这个最小主题文件。改动 radix 组件时用 `bun run shadcn:add` 走生成流程。
- **API 错误是可显示的**：`api.request` 抛的是服务端 `error.message`（`{error:{code,message}}` envelope），直接展示即可，不要吞掉后显示通用文案。
