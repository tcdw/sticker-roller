# shadcn-001 复审结果

结论：**pass**。

## 证据

- `bunx shadcn@latest add button --yes --overwrite` 在项目工作区成功执行，证明 `components.json`、alias 与 CSS 配置可被 CLI 消费。
- 已删除旧 uppercase 重复组件，仅保留 CLI 生成的 lowercase primitives：
  - `button.tsx`
  - `card.tsx`
  - `badge.tsx`
  - `textarea.tsx`
  - `input.tsx`
  - `dialog.tsx`
  - `select.tsx`
  - `tooltip.tsx`
  - `checkbox.tsx`
  - `scroll-area.tsx`
- 页面与 Composer 使用 `web/src/components/ui/` 中的真实 shadcn/Radix primitives。
- Tailwind v4 + PostCSS、CSS variables、`@/*` TypeScript/Rsbuild alias 均已接入。
- 素材引用、独立 prompt composer、参数 dialog、任务历史与 worker API 链路保持。
- `bun test`：20 pass。
- `bun run build`：通过。
- `bun run typecheck`：通过。
- `bun run check`：退出码 0；仅保留 25 条 warning，无 error。
- 已通过共享 browser preview 验证页面加载、素材插入和“更多参数”Dialog 打开。
- 未修改或迁移 `stickers/`、`stickers_archived/`、`data/`。

## CLI 限制记录

`components.json` 使用 `style: "default"` 后，当前 shadcn CLI 可正常读取 registry 并生成组件。此前 `style: "nova"` 失败是因为对应 registry item 不存在，不是 Bun、Rsbuild 或 React 的技术限制。
