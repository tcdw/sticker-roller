# sticker-roller

To install dependencies:

```bash
bun install
```

## Web server

```bash
bun run dev   # local development server (API + static frontend)
bun run build # production frontend into dist/
bun run web   # production server (serves dist when present)
```

The API binds to `127.0.0.1` by default. Set `DATABASE_PATH`, `OUTPUT_DIR`, `HOST`, or `PORT` as needed. Assets are created and managed in SQLite only — the app never scans `stickers/` or `stickers_archived/`, which are kept as an untouched prompt archive.

## CLI

`bun run cli` drives the same library and the same prompt semantics as the web app, from the terminal. Every generation is recorded in the web job history, and both entry points share one SQLite file.

```bash
bun run cli -- help                 # full usage, exit codes, environment variables
bun run cli -- help --json          # machine-readable spec: commands, values, defaults, exit codes
bun run cli -- generate --help      # options for one command
```

```bash
# Explore the library before referencing anything
bun run cli -- asset list --search 角色 --json
bun run cli -- asset show 角色设定 --json
bun run cli -- image list --json
bun run cli -- image show 参考图 --out /tmp/reference.png

# Generate
bun run cli -- --prompt "画一只白底小猫贴纸" --out ./out
bun run cli -- generate --prompt "@[角色设定](asset:角色设定) 画成表情包" --count 2 --out ./out
bun run cli -- --prompt-file ./prompt.md --image ./reference.png --aspect-ratio 1:1 --image-size 1K
```

Contract:

- **stdout is data only** — absolute image paths, one per line; `--json` replaces them with a single JSON document. Queries print a table, or a JSON document with `--json`.
- **stderr is everything else** — progress, warnings, `error: CODE: message`, `hint: ...`.
- **References** accept the id or the name: a prompt may use `@[label](asset:<name or id>)` / `![label](image:<path, name, or id>)`, and `--asset` / `--image` take the same values. Names resolve exactly first, then by unique fragment; an ambiguous or unknown reference fails with the candidate list instead of guessing.
- **Exit codes**: `0` success, `1` runtime error, `2` usage error (including unresolved references), `3` the job finished with failed items.

Options mirror the web composer field for field: `--count`, `--model`, `--aspect-ratio`, `--image-size`, and `--remove-background` / `--no-remove-background` (`auto` means "do not send the field to the provider"). `--out` defaults to `$OUTPUT_DIR`, then `./output`; `--database` defaults to `$DATABASE_PATH`, then `./data/sticker-roller.sqlite`.

Only the reviewed subset lives in these docs — `help --json` is the source of truth.

### Agent skill

[`.agents/skills/sticker-prompt-roll`](.agents/skills/sticker-prompt-roll/SKILL.md) turns the CLI into a prompt-iteration loop for coding agents: look at the library first, generate cheap drafts, read the produced image, change one thing at a time.

This project was created using `bun init` in bun v1.3.5. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Docs

- [AGENTS.md](AGENTS.md) — 面向 coding agent 的仓库入口：结构、命令、约定与安全不变量。
- [agent-doc/](agent-doc/) — 按主题拆分的知识文档（架构、数据层、生成链路、CLI、前端、配置、运维、验证）。
- [agent-doc/design/](agent-doc/design/) — 历史设计原文与已完成计划，只读归档。
