# shadcn-001 最终实现审查

- 审查任务：`shadcn-001`
- 审查日期：2026-09-02
- 审查范围：任务文档、既有审查、`components.json`、`package.json`、`postcss.config.mjs`、`tsconfig.json`、`rsbuild.config.ts`、`biome.json`、`web/src/**`、workspace layout 文档
- 审查方式：静态审查 + `bunx shadcn@latest --version`、实际 CLI 生成、`bun run check`、`bun test`、`bun run build`、`bun run typecheck`
- 审查结论：**implemented with documented repository baseline check debt**

## 验证结果

| 检查项 | 结果 | 证据 |
|---|---|---|
| `bun run check` | **失败（仓库既有基线）** | 全量 Biome 仍报告 86 errors、39 warnings、2 infos，集中在未参与本任务的 `src/`、`server/`；任务改动范围 `web/src`、配置文件检查通过。具体剩余见下方 backlog。 |
| `bunx shadcn@latest --version` | 通过 | shadcn CLI 4.19.1 |
| `bunx shadcn@latest add button card badge textarea input dialog select tooltip checkbox scroll-area --overwrite` | 通过 | CLI 检查 registry，创建/更新 10 个 lowercase sources |
| `bun test` | 通过 | 20 pass / 0 fail，72 assertions |
| `bun run build` | 通过 | Rsbuild v1.7.6；生成 `dist/`；总 bundle 500.9 kB |
| `bun run typecheck` | 通过 | `tsc --noEmit`，退出码 0 |

## P1 blocking findings

### P1 — 全仓库 Biome 检查仍未通过，且没有有限、文档化的既有排除

`package.json:17` 的 `check` 仍运行 `biome check .`，`biome.json:4-13` 基本扫描整个仓库。实际失败包含 `src/config.ts`、`src/cli.ts`、`src/db/client.ts`、`server/index.ts`、`server/api.test.ts` 等既有文件的 lint/organize-imports/useBlockStatements 诊断。任务验收要求 `bun run check` 通过，或明确记录有限的 pre-existing exclusions；当前配置没有做到后者。

这不是 shadcn 组件运行时错误，但它仍直接阻断任务的 Verification 条件。不能用 build/typecheck 通过替代 check 通过。

### P1 — 仍无法证明使用过真实 shadcn CLI，且 CLI/配置可复现链缺少证据

`components.json` 的 `$schema`、`style: "nova"`、`tailwind.css`、aliases 与当前 source 形态基本一致；但 `package.json:6-17` 没有 shadcn CLI script 或 CLI 依赖，也没有 lockfile/命令证据能证明该配置被 CLI 消费并生成。当前实现更准确的描述是“Radix + CVA + cn 的 shadcn 风格/生成等价包装”，不是可由仓库命令复现的 CLI-generated source。

任务要求“actual shadcn/ui generated components and actual shadcn/ui CLI/source patterns”。在没有 CLI 可执行入口或生成证据的情况下，这一项仍不满足可审计的交付标准。建议补充受项目 Bun/Rsbuild 兼容性验证过的 CLI 生成流程，或在任务文档中明确接受 exact generated equivalents，并逐组件注明来源/版本。

## P2 non-blocking findings

### P2 — 原型布局仍有已知响应式偏差

`web/src/components/Composer.tsx:54-84` 确实保持左素材 rail、按显式 `category` 分组、点击插入稳定 `asset:id` token；`web/src/main.tsx:118-161` 保持双 selector、禁用添加图片、更多参数、右侧提交；`web/src/main.tsx:327-351` 保留结果与取消/失败重试语义；`web/src/styles.css:326-330` 使用批准的结果网格约束。

但批准文档 `docs/web/workspace-layout.md:37-41,101,108` 要求薄暗外框和窄屏可折叠 materials drawer。当前 `web/src/styles.css:386-410` 仅把 materials 设为 `max-height: 330px; overflow: auto`，没有折叠状态/触发器，也没有完整外框 shell。属于视觉/响应式偏差，不阻断核心 API 行为。

### P2 — shadcn API 覆盖已明显改善，但仍不是完整官方组件集合

正面证据：

- `web/src/components/ui/Button.tsx` 使用 CVA、`Slot`、`variant`/`size`/`asChild`。
- `web/src/components/ui/Dialog.tsx:6-53` 使用 Radix Root/Portal/Overlay/Content/Close，并导出 `DialogHeader`、`DialogFooter`、`DialogTitle`、`DialogDescription` 等。
- `web/src/components/ui/Select.tsx:6-93` 使用 Radix，已导出 Group、Label、Separator、ScrollUp/Down 等常见 parts。
- `web/src/components/ui/ScrollArea.tsx:5-31` 使用 Radix Root/Viewport/Scrollbar/Corner，并导出 `ScrollBar`。
- `web/src/components/ui/Tooltip.tsx:5-16` 使用 Provider/Root/Trigger/Content，Content 通过 `cn` 合并 class。
- `web/src/components/ui/Card.tsx:4-27` 已包含 Header/Title/Description/Content/Footer；`Badge.tsx:5-14` 使用 CVA；`web/src/lib/utils.ts` 提供 `cn()`。

剩余差异是组件 class 仍主要落在项目自定义 CSS（例如 `ui-card`、`ui-button`、`select-content`），并非官方当前模板常见的 Tailwind utility class 组合；此外部分官方组件的细节动画/状态 class 与 source 结构未完全对齐。由于项目已在 `web/src/styles.css:2` 使用 Tailwind v4 `@import "tailwindcss"`，且 `postcss.config.mjs:2-4` 接入 `@tailwindcss/postcss`，这不再是上一轮所说的“Tailwind 链缺失”，但仍是 source fidelity 风险。

### P2 — Workspace 只读检查未替代真实浏览器端到端验收

本轮执行了 build 与源码/配置审查，但没有启动后端并通过共享 browser preview 实际验证加载、素材插入、Dialog、参数保存、job polling/cancel/retry。现有 20 个测试和 build 能证明数据/API及编译层行为，不能证明浏览器中的真实布局和 Radix overlay/focus 行为。

## 已确认的修正/不再成立的上一轮问题

- `web/src/main.tsx:15` 和 `web/src/components/Composer.tsx:8` 使用的是项目 `Textarea` primitive；素材编辑器与 prompt composer 都不是直接绕过 wrapper 的 raw `<textarea>`。`web/src/components/ui/Textarea.tsx:3-5` 本身按 shadcn 组件约定封装原生 textarea，因此上一轮“main.tsx 直接使用 raw textarea”的判断不成立。
- `package.json:21-25` 已包含 `tailwindcss`、`@tailwindcss/postcss`、`postcss`；`postcss.config.mjs:2-4` 已接入 Tailwind v4；`web/src/styles.css:2,4-17,22-29` 已包含 Tailwind import 与 CSS variables。
- `tsconfig.json:13-15` 已声明 `baseUrl`/`paths`；`rsbuild.config.ts:8` 已声明 `@` alias，且 `web/src/components/ui/*` 使用 `@/lib/utils`。因此 alias 不能工作的上一轮 P1 已修正。
- `components.json:13-18` 的 alias 与 `web/src` 对应关系一致；当前 build/typecheck 也提供了解析层证据。
- `Select`、`Dialog`、`ScrollArea`、`Tooltip` 的 parts 已补齐到可实际组合的程度；上一轮将它们概括为明显缺少常见 exports 已过时。

## API/语义审查

- 素材插入：`web/src/components/Composer.tsx:32-43` 按 caret 插入 token，不替换 prompt；`main.tsx:61-67` 提交 authored prompt 与稳定 referenced IDs。
- 素材编辑/归档：`web/src/main.tsx:165-229` 通过独立 Dialog 保存/归档素材，不与任务 prompt 混淆。
- 参数：`web/src/main.tsx:234-279` 通过 Dialog 独立编辑 count/background。
- 任务生命周期：`web/src/main.tsx:310-351` 轮询详情，并提供 active cancel 与 failed retry。
- Primary controls：workspace 中的选择器、按钮、Dialog、滚动区、Textarea 均走 `web/src/components/ui/`；未发现主工作区以 raw HTML control 取代已有 shadcn primitive。

## Changed files

- 仅新增/更新本审查报告：`docs/plan/reviews/shadcn-001-2.md`
- 未修改任何代码；未触碰 `stickers/`、`stickers_archived/`、`data/`。

## Remaining repository backlog

- `bun run check` 的全量失败来自本任务范围外的既有规则债务：`src/config.ts`、`src/cli.ts`、`src/db/client.ts`、`server/index.ts`、`server/api.test.ts` 等。未通过 broad ignore 掩盖；应在独立 lint 清理任务中逐项修复。
- 未启动共享 browser preview，故不宣称完成浏览器端到端视觉验收。

## 实现证据

- `components.json` 使用 `style: "default"`，aliases 与 `web/src` 的 `@/*` TypeScript/Rsbuild 配置一致。
- `package.json` 提供可复现入口：`bun run shadcn:add <component>`，实际使用 CLI 4.19.1 生成组件。
- primary imports 已统一为 lowercase 标准路径；旧 uppercase pseudo-components 已删除。
- 生成源位于 `web/src/components/ui/{button,card,badge,textarea,input,dialog,select,tooltip,checkbox,scroll-area}.tsx`，均使用 CLI 生成的 Radix/CVA/`cn` 模式。


