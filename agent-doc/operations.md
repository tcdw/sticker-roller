# 运行与运维

本应用**只在本机运行**（默认监听 `127.0.0.1`），没有部署单元、没有云端编排、没有备份策略。本页写「怎么起、怎么停、出问题看哪里」。

## 运行时依赖

- **Bun**：唯一必需的运行时（`bun` / `bunx`）。不要用 node / npm / npx。
- `bun install` 安装依赖；`.env` 由 Bun 自动加载，不需要 dotenv。
- `sharp` 是原生依赖，`bun install` 会拉预编译包；抠图相关的失败通常来自这里。

## 初始化开发环境

```bash
bun install
cp .env.example .env   # 若仓库没有该文件，则直接创建 .env 并填 GEMINI_API_KEY
bun run build          # 需要 dev/start 服务前端时才要，dist/ 缺失时 / 只返回 404
bun run dev            # API + 前端，watch 模式
```

数据库不需要手动初始化：首次启动会创建目录并跑迁移。

## 启动与停止

| 命令 | 说明 |
| --- | --- |
| `bun run dev` | `bun --watch server/index.ts`，改代码自动重启 |
| `bun run start` | 同上但不 watch，日常使用用这个 |
| `bun run build` | 构建前端到 `dist/`（`bun run start` 会直接服务 `dist/`） |

**就绪信号**：**stdout** 上的 `Sticker Roller listening on http://<host>:<port>`；`curl -s http://127.0.0.1:3000/api/health` 返回 `{"ok":true}`。

**停止**：Ctrl-C 或 `SIGTERM`。关闭顺序是 worker 停止（等在途 provider 调用结束）→ 关 HTTP → 关数据库；重复信号不会重复执行。注意进程不会立刻死：如果正卡在一个慢的 provider 调用上，会等它返回。

`.temp/` 是 agent 的临时产物目录（已 gitignore）。做探测时用独立端口与数据库，别动 `data/` 与 `output/`：

```bash
DATABASE_PATH=.temp/probe.sqlite OUTPUT_DIR=.temp/out PORT=3199 bun run server/index.ts
```

## 长期进程

`server/index.ts` 不会自行退出（HTTP 服务 + worker 循环）。agent 处理方式见 [../AGENTS.md](../AGENTS.md) 的 Long-Running Process Rules：后台运行 + 探活 + kill，或 `timeout` 包裹，或调用工具时设超时。

`bun run cli` 会正常结束，但**可能很慢**（每张图一次 provider 往返），跑它的工具超时值要放宽。

## 配置变更

改 `.env` 或环境变量后**必须重启进程**——配置在启动时读入，没有热重载。改完确认方式：`/api/health` 能通，且新起的任务是按新配置跑的（例如换 `OUTPUT_DIR` 后新产出落在新目录）。

## 日志

没有日志框架，输出走 `console` 到 stderr/stdout：

| 输出 | 含义 |
| --- | --- |
| `Sticker Roller listening on …` | 启动成功 |
| `generation worker stopped unexpectedly` + 错误栈 | worker 循环挂了；进程还在，但新任务不再被处理（重启恢复） |
| 没有任何输出但任务卡在 queued | 正常情况是 25ms 内被领取；长时间不动说明 worker 已停或没有可用 provider |

**持久状态不在日志里**，而在 `job_events` 表：`item.recovered` / `request.recovered` 说明进程崩溃或卡死过；`item.failed` 的 detail 是脱敏后的错误原因。排障优先查事件流水。

## 本地排障

### 页面 404 / 白屏

1. 确认 `dist/` 存在（`bun run build`）。`/` 走的是 `dist/index.html`，没构建过就 404。
2. 确认访问的是一个**无扩展名**路径：SPA fallback 只对无扩展名路径生效，带点的路径会被当成资源缺失返回 404（这是刻意设计，防止把资源拼错当成页面）。

### 任务一直 queued

1. 看服务进程是否还活着（`generation worker stopped unexpectedly`）。
2. 看 `.env` 的 provider 配置是否完整（缺 key 时 worker 仍会领取，但每个 item 会失败）。
3. 直接查库：`item.claimed` 事件是否出现。

### 任务 running 但永远不停

心跳每 15s 更新，超过 2× 间隔未更新才算 stale。进程重启时才会做恢复，所以**重启服务即可**把卡住的任务打回队列。想先观察再动手，就查 `job_items.heartbeat_at`。

### 图 404（历史任务里看得到，点开没有）

文件被手工删了。库里仍有 `generated_files` 登记，所以详情里能看到文件名，但 `/api/output/:name` 会 `stat()` 失败返回 404。

注意**没有一键重生成**：`retry-failed` 只把 `failed` 的 item 打回队列，而 `claimNextItem` 只领 `queued`，所以已 `succeeded` 的 item 不会被任何正常路径重新生成。当前可行做法是**用同一个 prompt 重新提交一个任务**（在历史任务里点「复用」再提交）。若确实需要「原地重生成」，那要先改 `src/db/repositories.ts` 的状态迁移，不要在 UI 上假装有这个能力。

### CLI 与 Web 看到的素材/任务不一致

两边用了不同的数据库文件。用 `--database` 或统一 `DATABASE_PATH`。

## 备份

没有自动备份。要保留就直接复制 `DATABASE_PATH` 指向的 SQLite 文件（连同 `OUTPUT_DIR`）——素材与参考图都在库里，产出图在文件系统上，两者必须成对复制。
