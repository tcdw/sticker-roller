---
id: shadcn-002
scope: Rebuild styling with standard shadcn design language
status: completed
depends-on: [shadcn-001]
---

# Objective

Delete the legacy `web/src/styles.css` and rebuild the entire workspace styling from scratch using standard shadcn/ui generated components, semantic CSS variables, and Tailwind utility classes. Preserve the approved information architecture and behavior, but do not preserve the previous custom visual appearance.

## Context

- `docs/INDEX.md`
- `docs/web/README.md`
- `docs/web/workspace-layout.md`
- `docs/plan/tasks/shadcn-001.md`
- Current material-reference API contracts

## Required outcome

- Delete `web/src/styles.css`; do not retain it as a renamed legacy stylesheet.
- Add only a minimal standard shadcn/Tailwind global theme file, e.g. `web/src/globals.css`, containing Tailwind import, standard shadcn semantic variables and base layer. No component-specific classes such as `.ui-button`, `.job`, `.material`, `.toolbar`, `.asset-token`, bespoke shadows, remote Google font import, or hard-coded orange/purple/blue visual system.
- Rewrite `web/src/main.tsx`, `web/src/components/Composer.tsx`, and any new page components using Tailwind utilities and generated shadcn primitives.
- Use standard shadcn component composition: `CardHeader`, `CardContent`, `CardFooter`, `DialogFooter`, `Badge` variants, `Button` variants, `Select` parts, `ScrollArea`, `Textarea`, `Input`, `Checkbox`, and Tooltip where applicable.
- Preserve layout hierarchy only: application header; left grouped materials rail; right prompt composer; toolbar below prompt; right-aligned submit; durable task history/result grid.
- Preserve material reference behavior, asset create/edit/archive, parameter dialog, job submit/poll/cancel/retry, output preview/download, and Phase 1 text-only limitation.
- Loading, empty, error, queued/running/succeeded/failed and responsive states must use standard shadcn patterns and semantic colors.
- Do not introduce Electron/Vite, change backend contracts, migrate filesystem data, or modify `stickers/`, `stickers_archived/`, or `data/`.

## Verification

- `web/src/styles.css` does not exist and no source imports it.
- No project-defined component/surface/status CSS selectors remain outside the generated shadcn primitives.
- `bun run check`, `bun test`, `bun run typecheck`, and `bun run build` pass.
- Browser desktop and narrow-width screenshots show standard shadcn typography, spacing, borders, radii and semantic color treatment without the previous custom design language.
- Browser interaction verifies material insertion and parameter Dialog.
