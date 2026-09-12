---
id: shadcn-001
scope: Actual shadcn/ui setup and primitive replacement
status: done
depends-on: []
---

# Objective

Replace the local pseudo-components under `web/src/components/ui/` with genuine shadcn/ui generated components and rebuild the web UI on top of them, while preserving the approved material-reference layout and current backend contracts.

## Context

- `docs/INDEX.md`
- `docs/web/README.md`
- `docs/web/workspace-layout.md`
- Existing frontend under `web/`
- Existing `package.json`, `biome.json`, and Rsbuild configuration

## Required outcome

- Initialize and commit `components.json` using the shadcn/ui configuration for this React/Rsbuild project.
- Use the actual shadcn/ui CLI/source patterns, with dependencies appropriate to each component (Radix primitives, `class-variance-authority`, `clsx`, `tailwind-merge`, and icon package as needed).
- Add a real utility such as `web/src/lib/utils.ts` with `cn()` and use it in generated components.
- Replace the pseudo `Button`, `Card`, `Badge`, `Textarea`, `Select`, `Dialog`, `ScrollArea`, and `Tooltip` implementations with shadcn/ui component source or exact generated equivalents. Components must expose shadcn-compatible APIs (`variant`, `size`, `asChild`, `DialogContent`, `DialogHeader`, etc.) where used.
- Use Tailwind or the configured shadcn styling approach with CSS variables, while retaining the custom prototype visual language through tokens/classes layered above the primitives.
- Preserve real behavior: assets insert references, prompt remains independent, parameter dialog works, assets can be edited/archived, jobs submit/poll/cancel/retry.
- Do not add Electron or Vite. Do not touch or migrate `stickers/` or `stickers_archived/`.

## Verification

- `components.json` exists and points to the actual aliases used by the source.
- `package.json` contains the actual shadcn/Radix utility dependencies.
- UI source imports primitives from `web/src/components/ui/`; no primary workspace control may use a raw HTML control where a shadcn primitive is available.
- `bun run check` passes with Biome (or any pre-existing exclusions are explicitly documented and limited).
- `bun test`, `bun run build`, and `bun run typecheck` pass.
- Browser preview confirms the supplied two-column layout and no fake compatibility-only components remain.
