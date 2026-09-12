# Repository Guidelines

本文件是所有 AI agent 的统一入口。**Compatible with**: Claude Code, OpenAI Codex, opencode, Gemini CLI。

> **IMPORTANT**: 优先「检索式」推理，而非「预训练记忆」式推理。项目约定请从 `agent-doc/` 检索阅读，不要凭通用知识臆测本仓库的结构与规则。

sticker-roller 是一个本机运行的贴纸/表情包生成工作台：素材库 + 任务队列 + Web UI + CLI。提示词与参考图统一存在 SQLite（`assets` / `uploads`），Web 与 CLI 共用同一套引用语义、同一套校验、同一个数据库文件。

## Project Goals

- 用可复用的**素材引用**（而不是每次粘全文）组装提示词，一键生成多张贴纸。
- 生成任务必须**durable**：进程重启后任务继续，浏览器关掉不中断。
- Web 与 CLI 是同一能力的两个入口，行为不许漂移（同一份 `src/jobs/` 与 `src/db/`）。
- 不做：多用户 / 账号体系 / 云端部署编排；不做自动扫描 `stickers/` 的素材导入（见下）。

## Project Structure & Module Organization

```text
cli.ts              CLI 入口：分发命令、渲染结果、映射退出码
server/             HTTP 边界：api.ts 路由与校验、index.ts 进程组合根与静态文件
src/                与传输方式无关的领域层（CLI 与 server 共用）
  db/               drizzle schema、repositories（状态迁移都在这里）、client
  jobs/             worker（队列执行）、references（引用解析与 prompt 展开）、options
  generator.ts      单次 provider 调用 + 洋红抠底
  image-options.ts  纯 TS 模型能力矩阵（web 直接打包）
  cli-*.ts          声明式 CLI spec / 解析 / help / 查询渲染
web/                React 前端（rsbuild 构建，不是 Bun HTML imports）
drizzle/            生成的 SQL 迁移，必须提交；不要手改
agent-doc/          面向 agent 的主题文档（本文件是索引，细节都在里面）
agent-doc/design/   归档的原始设计/计划文档，只读不改写
stickers/           历史 prompt 归档，**没有任何代码读它**
```

各模块职责、并发模型与信任边界见 **[agent-doc/architecture.md](agent-doc/architecture.md)**。

## Architecture Overview

**数据流**: `Web / CLI → 引用解析（src/jobs/references.ts）→ SQLite job+items → GenerationWorker → provider 生成 → 抠底 → output/ 落文件 + generated_files 登记 → 前端轮询`

关键语义：job 落库时把 prompt 与引用**快照**固化，之后改素材不影响既有任务；worker 与 Web/CLI 同进程，用 `items.status` 行级状态迁移领取任务。

架构细节参见 **[agent-doc/architecture.md](agent-doc/architecture.md)**。

## Where to Look

| 你想了解…… | 去看…… |
| --- | --- |
| 整体架构、模块职责、并发与信任边界 | [agent-doc/architecture.md](agent-doc/architecture.md) |
| 表结构、状态机、job 生命周期 | [agent-doc/data-layer.md](agent-doc/data-layer.md) |
| 生成链路、引用 token 语义、prompt 展开规则 | [agent-doc/generation-flow.md](agent-doc/generation-flow.md) |
| CLI 命令与 stdout/stderr/退出码契约 | [agent-doc/cli.md](agent-doc/cli.md) |
| 前端页面分区、交互契约、轮询与复用 | [agent-doc/web-ui.md](agent-doc/web-ui.md) |
| 环境变量、provider 双模式、密钥注入 | [agent-doc/configuration.md](agent-doc/configuration.md) |
| 启动/停止、排障、长期进程 | [agent-doc/operations.md](agent-doc/operations.md) |
| 跑测试与验证、既有失败判断 | [agent-doc/verification.md](agent-doc/verification.md) |
| 历史设计原文（web 契约、delivery plan、gateway 调研） | [agent-doc/design/](agent-doc/design/) |
| 让 agent 迭代提示词的工作流 | [.agents/skills/sticker-prompt-roll/SKILL.md](.agents/skills/sticker-prompt-roll/SKILL.md) |

## Build, Test, and Development Commands

运行时是 **Bun**（`bun` / `bunx`；不要用 node/npm/npx）。依赖用 `bun install` 安装，`.env` 由 Bun 自动加载，**不要**引入 dotenv。

| 命令 | 作用 |
| --- | --- |
| `bun run dev` | 开发服务器（API + 静态前端），watch 模式，**不会自行退出** |
| `bun run start` | 同上但不 watch |
| `bun run build` | rsbuild 构建前端到 `dist/` |
| `bun run cli -- <args>` | CLI（默认命令是 `generate`） |
| `bun test` | 全部测试 |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run check` | biome check（lint + format + import 排序），**当前有既有失败**，见 verification |
| `bun run db:generate` / `bun run db:migrate` | 生成 / 应用 drizzle 迁移 |

`bun run start` 会自动应用未执行的 drizzle 迁移，所以新增迁移文件后无需单独 migrate 就能起服务。

## Long-Running Process Rules

`bun run dev` / `bun run start`（HTTP 服务 + 后台 worker 循环）不会自行退出。**禁止裸跑**，必须：

1. 后台运行 + 用 `curl` 验证 `/api/health` 就绪 + 显式 kill；或
2. `timeout` 包裹（例：`PORT=3199 timeout 20 bun run server/index.ts`）；或
3. 调用工具时显式设置超时。

验证服务用的端口、数据库、输出目录请指向 `.temp/`，别污染 `data/` 与 `output/`：

```bash
DATABASE_PATH=.temp/probe.sqlite OUTPUT_DIR=.temp/out PORT=3199 bun run server/index.ts
```

启动成功的标志是 **stdout** 上的 `Sticker Roller listening on http://<host>:<port>`（`console.log`，不是 stderr）；`/api/health` 返回 `{"ok":true}`。

## Agent Temporary Files

agent 产生的所有临时产物（服务日志、导出图、探测数据库、pid 文件）统一放在仓库根的 **`.temp/`**（已 gitignore）。不要往 `data/`、`output/`、`stickers/` 写测试数据：前两者是用户真实资产，后者是历史归档。

## Coding Style & Naming Conventions

- 格式与 lint 由 **biome** 统一管理，不要引入 prettier/eslint 配置。规则见 [biome.json](biome.json)：2 空格、单引号、分号、trailing comma、行宽 120。
- 文件名 kebab-case（`cli-run.ts`、`image-options.ts`），测试与被测文件同目录同前缀 `*.test.ts`。
- 前端别名 `@/*` → `web/src/*`（同时在 `tsconfig.json` 与 `rsbuild.config.ts` 声明，改动要同步两处）。
- 跨端共享模块（`src/image-options.ts`、`src/prompt-tokens.ts`）**不得** import `node:*`，也不要 import `src/config.ts`——前端会直接打包它们。
- 注释写「为什么」，尤其是刻意为之的边界（取消竞态、路径穿越校验、脱敏）；不要复述代码。

## Testing Guidelines

- `bun test` 是唯一测试入口，测试文件与被测模块同目录。**先跑再判断**，不要预设套件处于失败状态。
- 契约测试优先写在边界层：`server/api.test.ts`（HTTP 契约与措辞）、`cli.test.ts`（退出码与流契约）、`src/jobs/worker.test.ts`（状态迁移与取消竞态）。
- 永远不要为了测试调用真实 provider：`worker` 与 `runGeneration` 都通过 `generator` 依赖注入假实现。
- 改动生成/引用语义时，必须同时覆盖 Web 与 CLI 两条入口的测试——它们共用 `src/jobs/references.ts`，漂移是这类改动最容易引入的 bug。

## Commit & Pull Request Guidelines

历史提交是 Conventional Commits 风格，描述用英文祈使句，例如 `feat: share the web prompt contract with a new CLI`、`fix: hide empty material references`、`chore: remove wrongly commited file`、`docs: close standard shadcn style rebuild`。破坏性变更用 `feat!:`。

提交前至少跑 `bun test` 与 `bun run typecheck`；`bun run check` 目前有既有告警，见 [agent-doc/verification.md](agent-doc/verification.md) 判断哪些属于本次改动。

## Security & Configuration Invariants

- `.env` 是 gitignore 的凭证文件，**绝不提交**；密钥只能来自环境变量（`.env` 或进程环境），不得写进源码、测试或文档。`.env` 里的 key 名可在 [agent-doc/configuration.md](agent-doc/configuration.md) 查到，值永远不要复制出来。
- 外部输入（HTTP body、multipart、CLI 参数）都不可信，校验边界在 `server/api.ts` / `src/cli-parse.ts` / `src/jobs/options.ts`，不要在更内层重复造校验，也不要绕过它直接调 repository。
- 静态文件与产出图片的路径必须做包含性校验，禁止拼接未净化的文件名（参考 `server/index.ts` 的 `staticResponse` 与 `server/api.ts` 的 `/api/output/:name`）。
- 错误信息出库前必须脱敏：`src/jobs/worker.ts` 的 `safeError` 会抹掉 URL 与凭证形态的字符串，不要把它摘掉。
- 服务默认只监听 `127.0.0.1`。改成对外监听前必须先补鉴权——本仓库**没有**任何访问控制，素材库和产出图对能访问该端口的人完全开放。
- **不要为了验证真调 provider**：`generate` / 提交任务都是一次真实付费调用，并且会写进用户的 Web 任务历史。除非用户明确要求。
