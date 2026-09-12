# shadcn-001 实际落地审查

- 审查任务：`shadcn-001`
- 审查范围：任务文档、`components.json`、`package.json`、`web/src/components/ui/`、`web/src/lib/utils.ts`、`web/src/main.tsx`、`web/src/styles.css`、`rsbuild.config.ts`、`biome.json`，以及 workspace layout 文档
- 审查结论：**blocked**

## 证据摘要

| 检查项 | 结果 | 证据 |
|---|---|---|
| `bun test` | 通过 | 20 pass / 0 fail，72 assertions |
| `bun run build` | 通过 | Rsbuild 1.7.6，生成 `dist/`，总 bundle 458.6 kB |
| `bun run typecheck` | 通过 | `tsc --noEmit` 无输出、退出码 0 |
| `bun run check` | **失败** | 41 files checked；89 errors、39 warnings、3 infos。多数来自既有 `src/`、`server/`，但当前配置并未限定到 workspace，也没有 documented exclusion |
| `stickers/` / `stickers_archived/` | 未发现本次 diff 触碰 | `git diff --name-only -- 'stickers/**' 'stickers_archived/**'` 无输出 |

## Blocking findings

### P1 — 仍有原生 textarea 作为 primary workspace control

`web/src/main.tsx:212-219` 的素材编辑器直接使用 `<textarea>`，而仓库已经提供 `web/src/components/ui/Textarea.tsx`。任务验证明确要求“primary workspace control may not use a raw HTML control where a shadcn primitive is available”。这直接违反验收条件，也使“全面替换 pseudo components”的目标未完成。

**影响：** shadcn primitive replacement 不完整。

### P1 — 没有可工作的 Tailwind/shadcn CSS-variable 配置

`components.json:7-11` 声明了 `tailwind.config` 为空、`cssVariables: true`，但仓库没有 `tailwind.config.*` 或 `postcss.config.*`；`web/src/styles.css:2-6` 也没有 shadcn 生成所需的 `--background`、`--foreground` 等 token、`@tailwind`/Tailwind v4 `@import`，而是完全手写的 hex CSS。`package.json:27-51` 也没有 `tailwindcss` 或对应 Tailwind 集成依赖。

这套 CSS 可以让当前自定义 `ui-*` 类工作，但不能证明 shadcn 配置已实际落地；`components.json` 的 Tailwind 配置与项目构建链不一致。

**影响：** 新组件无法按 `components.json` 配置稳定生成/复用，CSS variables 要求未满足。

### P1 — `components.json` alias 不能在项目 TypeScript/Rsbuild 中直接工作

`components.json:13-18` 使用 `@/components`、`@/lib/utils` 等 alias，但 `tsconfig.json` 没有 `baseUrl`/`paths`，`rsbuild.config.ts:4-8` 也没有 alias 配置。当前 UI 文件通过 `../../lib/utils` 等相对路径绕过了 alias，因此现有 build 能通过；这反而说明配置中的 alias 没有接入实际 source/build resolution。将官方 CLI 生成的 `@/components/ui/*` import 原样加入后，解析会失败或依赖额外未配置的 CLI 行为。

**影响：** `components.json` 所指向的 alias 不是可验证的工作配置，官方生成模式不可持续。

### P1 — 多个 UI 文件是简化包装器，不是完整官方生成 API

部分 primitive 使用了 Radix，但暴露的 API 不足以称为官方生成等价物：

- `web/src/components/ui/Dialog.tsx:8-20` 内部直接创建 Overlay，但没有导出 `DialogOverlay`、`DialogPortal`、`DialogFooter` 等常用 shadcn API；
- `web/src/components/ui/Select.tsx:7-36` 缺少官方常见的 `SelectGroup`、`SelectLabel`、`SelectSeparator`、`SelectScrollUpButton`、`SelectScrollDownButton` 等导出，也未设置官方生成组件的 role/positioning 样式类体系；
- `web/src/components/ui/ScrollArea.tsx:4-14` 只导出一个固定垂直 scrollbar，未提供官方常见的 `ScrollBar` API；
- `web/src/components/ui/Tooltip.tsx:1-5` 只是 Radix 原语直通导出，没有 `cn`、样式、side/offset 配置或可用的 `TooltipContent` 生成层；当前 workspace 也没有实际使用 Tooltip；
- `web/src/components/ui/Card.tsx:3-12`、`Badge.tsx:5-14` 使用自定义 `ui-*`/`badge-*` 类，且 Card 仅提供 Header/Content，不是标准生成源的完整 Card parts。

`Button.tsx` 和 `utils.ts` 的 `cn`/CVA/Radix Slot 形态接近官方模式；`Dialog`、`Select`、`Checkbox` 也确实依赖 Radix，不能说是全部伪造。但整体仍是“Radix + 本地简化包装器”，不满足任务要求的 genuine shadcn source/exact generated equivalents。

**影响：** API 兼容性和后续 CLI 生成一致性不足。

### P1 — 官方样式生成链没有被真实接入，构建通过不足以证明 shadcn 落地

`web/src/styles.css:70-125` 等位置主要定义 `.ui-card`、`.ui-button`、`.ui-badge` 等项目自定义类；没有 shadcn 的 `@layer base`、变量 token 或 Tailwind utility source。`rsbuild.config.ts` 只启用 React plugin，没有 Tailwind/PostCSS 集成。因而 `bun run build` 仅证明现有手写 CSS 和 React/Radix bundle 可编译，不证明 shadcn 初始化结果可运行。

## Non-blocking findings

### P2 — workspace 与批准的原型布局仅部分一致

优点：`web/src/components/Composer.tsx:54-113` 确实实现了左侧素材 rail、右侧 prompt canvas；素材按显式 category 分组；插入 token 保留 prompt；`main.tsx:116-161` 有双 selector、禁用添加图片、更多参数和右侧提交；history 结果网格使用 `repeat(auto-fit, minmax(150px, 1fr))`（`web/src/styles.css:308-311`）。

偏差：布局文档要求“全视口薄暗外框”，实际 `styles.css:1-18` 没有 outer frame；文档要求 sidebar 是 scrollable materials browser，实际 Composer 使用 `ScrollArea`，但 `styles.css` 没有 `.scroll-area`、`.scroll-viewport`、Radix scrollbar/viewport 的布局与滚动样式；文档要求窄屏 collapsible drawer，实际只是 `max-height:330px; overflow:auto`（`styles.css:368-387`），不是可折叠 drawer。

### P2 — a11y/API 细节仍需补齐

`web/src/components/Composer.tsx:75-77` 的“编辑”按钮没有 `aria-label`，多个素材按钮依靠视觉文本；`AssetReferenceToken` 的 button 有 label，Dialog 的关闭按钮有 label，这些部分是正确的。`Checkbox` 基于 Radix，label 关联 id 也正确（`main.tsx:272-278`）。但 Tooltip 没有 Provider/use，且 Dialog/Select 自定义包装层未完整对齐官方 API，后续组合使用存在可访问性和一致性风险。

### P3 — Biome 基线未整理

`biome.json:4-13` 扫描整个仓库，仅排除 node_modules/dist 等目录，导致本次 `bun run check` 被已有后端/CLI/test 诊断阻断：例如 `src/config.ts:27`、`server/index.ts:1`、`src/cli.ts:57`。这不是 shadcn 本身的唯一问题，但任务要求 check 通过或明确记录有限的既有 exclusions；当前没有这样的文档化基线。建议后续单独清理或将明确范围纳入配置，避免用 broad exclusion 掩盖问题。

## 判定

**BLOCKED。**

测试、构建、类型检查和核心原型交互证据是正面的；但至少四项 P1 违反任务的直接验收条件：原生 textarea 未替换、Tailwind/CSS variables/构建链缺失、alias 未接入、UI primitive API 不是完整官方生成模式。因此不能以当前实现通过 `shadcn-001`。本审查未修改任何代码，也未修改 `stickers/` 或 `stickers_archived/`。

## Remaining uncertainty

- 本次未启动后端并进行完整浏览器端到端交互验收；`bun run build` 和现有 API/组件测试不能替代真实 browser preview。
- 没有调用 shadcn CLI 重新解析 `components.json`，因此 alias 失败的具体 CLI 错误尚未取证；结论基于项目 `tsconfig`/Rsbuild 均未声明 alias 的静态证据。
- `style: "nova"` 是否为当前 CLI/schema 支持的有效样式取决于安装/CLI 版本；仓库 package scripts 未声明 shadcn CLI，当前无法证明该配置曾被 CLI 成功消费。
