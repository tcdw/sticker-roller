# sticker-roller

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

## Web server

```bash
bun run dev   # local development
bun run web   # production server (serves dist when present)
```

The API binds to `127.0.0.1` by default. Set `DATABASE_PATH`, `OUTPUT_DIR`, `HOST`, or `PORT` as needed. Phase 1 stores text assets and never scans `stickers/` or `stickers_archived/`.


`prompt.md` supports reusable includes with the syntax `{{include: path}}`.

- Paths are resolved relative to the current prompt file.
- If not found, it also checks `stickers/_includes/`.
- If no extension is provided, it tries `.md` first, then `.txt`.

Example:

```
stickers/_includes/base.md
stickers/my-sticker/prompt.md
```

```md
{{include: base}}

## Specific request
Draw a smiling chibi character with a white background.
```

This project was created using `bun init` in bun v1.3.5. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
