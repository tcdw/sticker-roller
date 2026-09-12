# 架构

sticker-roller 是**单进程**应用：一个 Bun 进程里同时跑 HTTP API、静态前端和后台生成 worker，共享一个 SQLite 文件。

## 进程组成

```text
┌─────────────────────────── bun run server/index.ts ───────────────────────────┐
│                                                                               │
│  Bun.serve ──► server/api.ts ──► src/db/repositories ──┐                      │
│      │              (HTTP 校验 + 引用解析)              │                      │
│      │                                                  ├─► data/*.sqlite      │
│      └──► staticResponse(dist/)  (SPA fallback)         │    (drizzle)         │
│                                                         │                      │
│  GenerationWorker ──► src/generator.ts ──► provider     │                      │
│      (25ms 轮询循环)         │                          │                      │
│                             └──► output/*.png ──────────┘                      │
└───────────────────────────────────────────────────────────────────────────────┘
                                     ▲
                        bun run cli.ts（独立进程，同一 SQLite）
```

两个入口共享领域层，只有传输与交互不同：

| 关注点 | Web | CLI |
| --- | --- | --- |
| 入口文件 | `server/index.ts` → `server/api.ts` | `cli.ts` → `src/cli-run.ts` |
| 校验 | `validateOptions()`（`src/jobs/options.ts`） | 同一个函数 |
| 引用解析 | `resolveJobInput()`（`src/jobs/references.ts`），只接受 id | 同一函数，额外允许名字与本地路径 |
| 执行 | 进程内常驻 worker 循环 | 按 jobId 临时 `drain`，不碰别人的任务 |
| 输出 | HTTP JSON | stdout 路径 / 表格 / JSON |

**启动顺序**（`server/index.ts`）：`openDatabase()`（含 migrate）→ `createRepositories()` → `createWorker()` → `await startGenerationWorker()`（内含 stale 恢复，必须 await）→ `Bun.serve()`。
**关闭顺序**：`stopGenerationWorker()`（先停循环、等在途 provider 调用）→ `server.stop()` → `database.close()`；`shutdown` 是幂等的。

## 主数据流

```text
Web 提交器 / CLI 参数
        │
        ▼
引用解析  src/jobs/references.ts
  resolveAssetRef / resolveUploadRef → 名字/片段/id → 唯一行
  resolveJobInput → 展开 prompt（图片 token 换文件名 + 文本素材块追加）
        │
        ▼
createJob（一个事务）  src/db/repositories.ts
  jobs 行：authored/snapshot/references/options 快照
  job_items 行：ordinal 1..count，全部 queued
        │
        ▼
claimNextItem（事务内条件更新，防重复领取）
        │
        ▼
GenerationWorker.process  src/jobs/worker.ts
  startRequest（写 llm_requests，attempt 递增）
  → generateSingleImage  src/generator.ts
      └─ 有 AI_GATEWAY_URL+TOKEN → createGateway，否则 createGoogleGenerativeAI
      └─ removeBackground=true 时走 sharp 洋红抠底
  → Bun.write 临时文件 → rename 到 output/<jobId>-<ordinal>.<ext>
  → finalizeRequest（登记 generated_files + 更新 item + 刷新 job + 写事件）
        │
        ▼
前端轮询 GET /api/jobs?limit=10&offset=… （有 active 任务时 1.5s）
图片经 GET /api/output/<fileName> 读取，会先校验 DB 登记 + 路径包含性
```

## 模块职责

| 模块 | 职责 |
| --- | --- |
| `cli.ts` | 命令分发、stdout/stderr 契约、退出码映射；不返回任何 result 对象给调用方 |
| `src/cli-spec.ts` | 声明式 CLI spec（命令、flag、枚举、默认值、示例），是 help 与解析器的**唯一真相源** |
| `src/cli-parse.ts` | 按 spec 解析 argv；`--help` 优先于一切 |
| `src/cli-help.ts` | 由 spec 渲染 human / JSON help |
| `src/cli-run.ts` | 生成链路：读 prompt 文件、把 token 规范成 id、建 job、按 jobId 排空队列 |
| `src/cli-query.ts` | 素材/图片查询与表格渲染 |
| `server/api.ts` | 唯一 HTTP 校验边界；路由、分页、错误 envelope |
| `server/index.ts` | 组合根：装配依赖、静态文件、SPA fallback、优雅关闭 |
| `src/db/schema.ts` | drizzle 表定义，类型来源 |
| `src/db/repositories.ts` | 全部状态迁移（claim / finalize / cancel / retry / recover），事务都在这里 |
| `src/jobs/worker.ts` | 队列循环、心跳、重试上限、临时文件、错误脱敏、注册产出复用 |
| `src/jobs/references.ts` | 引用解析（id / 名字 / 唯一片段）与 prompt 展开，Web 与 CLI 共用 |
| `src/jobs/options.ts` | 生成参数校验（model / aspectRatio / imageSize / removeBackground）与上限常量 |
| `src/generator.ts` | 单次 provider 调用，返回 buffer；不决定落盘路径 |
| `src/image-options.ts` | 模型能力矩阵，**纯 TS**，前端直接打包 |
| `src/prompt-tokens.ts` | 引用 token 正则与提取，**纯 TS**，前后端共享 |
| `src/uploads.ts` | 上传字节校验（magic number、大小上限）与本地文件入库 |
| `web/src/main.tsx` | 工作台页面装配、路由、查询与弹窗编排 |
| `web/src/components/Composer.tsx` | 工作台的可复用界面块：素材侧栏、提交器、上传条、引用 token |
| `web/src/api.ts` | API 客户端、zustand draft store、快照还原与分页纯函数 |

## 并发模型

- **单 worker 实例**：`GenerationWorker` 自带 `active` 互斥，同一时刻只处理一个 item；循环空转时 sleep 25ms。
- **领取靠 DB 条件更新**：`claimNextItem` 在事务里 `UPDATE … WHERE status='queued'`，只有改到行的调用者算领取成功。
- **CLI 不抢别人的活**：`runOnce(jobId)` 带 job 过滤，CLI 只排空自己刚建的 job，因此可以和服务进程并存。
- **取消与在途请求的边界**：已发 provider 请求的 item 不会被取消，等请求结束再落终态；`startRequest` 在 job 已取消时抛错，worker 收到后直接返回，不产生真实调用。
- **重试上限**：每个 item 在开始处理前先看历史尝试数，达到 `maxAttempts`（默认 3）就直接 `failed: maximum attempts exceeded`，不再发请求（第 3 次仍会执行，从第 4 次不执行）。
- **心跳与 stale 恢复**：处理中每 15s 写 `heartbeat_at`；进程启动时把心跳早于 2× 心跳间隔的 running item 打回 queued，并把对应 running request 记为 failed（`request.recovered` / `item.recovered` 事件）。

## 恢复与重试

| 场景 | 行为 |
| --- | --- |
| 进程崩溃时 item 处于 running | 重启 `recover()` 打回 queued，重新排队 |
| 崩溃发生在文件落盘后、登记前 | 该 item 无 `generated_files` 记录，重跑会再次调用 provider（backlog 已记录此缺口） |
| item 有已登记产出且文件仍在 `output/` | `process()` 命中后直接 `completeRegisteredItem`，不重复调用 provider |
| 用户取消 job | 只取消 queued 与「running 但没有 running request」的 item |
| job 失败后重试 | 只把 failed item 打回 queued，成功的不重跑 |
| 迁移未应用 | 启动时自动 migrate，所以任何入口都先 `openDatabase()` |

## 信任边界

| 边界 | 规则 |
| --- | --- |
| HTTP 输入 | 全部不可信。`server/api.ts` 校验类型/长度/枚举/JSON content-type，`src/uploads.ts` 用 magic number 判定图片类型（不信客户端 MIME） |
| 文件路径 | `/api/output/:name` 要求文件名不含分隔符、不以 `.` 开头、扩展名白名单，并确认已登记 + resolve 后仍在 outputDir 内；静态文件同样做包含性校验，SPA fallback 只对无扩展名路径生效 |
| 引用 | 只接受 UUID 或（CLI 场景）库内名字，解析失败不猜、直接报候选；archived 行不能被引用 |
| Prompt 中的 token | 只是文本，不执行任何表达式。但**两条入口的校验强度不同**：CLI 会扫描 token 并把无法解析的当错误（退出码 2）；HTTP 侧**不扫描** prompt，只校验 `referencedAssetIds` / `referencedImageIds` 是合法 UUID，prompt 里写错的 token 会原样入库并当纯文本发给 provider |
| 错误出库 | `safeError` 抹除 URL 与 `authorization` / `api-key` / `bearer` 等形态的值后才写库 |
| 网络暴露 | 默认 `127.0.0.1`。项目内**没有任何鉴权**，改成对外监听等于把素材库和产出图公开 |

## 外部依赖

| 依赖 | 用途 |
| --- | --- |
| `ai` + `@ai-sdk/google` | provider 调用（直连 Google 或走 AI Gateway），图片以 base64 取回 |
| `sharp` | 洋红背景抠图，输出 PNG |
| `drizzle-orm` + `bun:sqlite` | 表定义与查询、事务；迁移由 drizzle-kit 生成 |
| `@tanstack/react-query` | 前端数据获取、轮询、缓存失效 |
| `@tanstack/react-router` | 路由（当前只有 `/` 一个页面） |
| `zustand` | 提交器草稿状态（prompt、引用 id、生成参数） |
| `@radix-ui/*` + shadcn 生成的 `web/src/components/ui/*` | UI 原子组件 |
| `@rsbuild/core` + `@rsbuild/plugin-react` | 前端构建（**不是** Bun HTML imports） |
| `@biomejs/biome` | lint + format + import 排序 |
