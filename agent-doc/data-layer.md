# 数据层

只有**一层持久化**：一个 SQLite 文件，所有状态（素材、任务、产出登记、事件）都在里面。产出图片本身在文件系统上，但**必须**有 `generated_files` 登记才可读。

## 概览

```text
assets ──(job 引用快照)──┐
                         ├──► jobs ──1:N──► job_items ──1:N──► llm_requests
uploads ─(图片引用快照)──┘                      │
                                               └──1:N──► generated_files
jobs ──1:N──► job_events（审计流水，只追加）
```

| 文件 | 职责 |
| --- | --- |
| `src/db/schema.ts` | 表定义与 `*Row` 类型；业务 ID 是 `crypto.randomUUID()` 文本（`job_events.id` 例外，是自增整数），时间是 ISO UTC 字符串 |
| `src/db/client.ts` | 打开连接（`PRAGMA foreign_keys = ON`）、跑迁移、`nowUtc()` |
| `src/db/repositories.ts` | 唯一的状态迁移入口，跨行改动一律在 `db.transaction()` 内 |
| `drizzle/*.sql` + `drizzle/meta/` | 生成的迁移，**必须提交**；`drizzle/meta/*.json` 不要手改 |

数据库路径：`DATABASE_PATH` → 默认 `./data/sticker-roller.sqlite`。测试用 `:memory:`（`openDatabase(':memory:')` 会跳过建目录，但**仍会跑迁移**）。

## 表结构

**assets** — 可复用素材（文本）。`name` 上有唯一索引 `assets_name_uq`，这是「名字引用」能成立的前提。

| 列 | 说明 |
| --- | --- |
| `id` / `name` / `prompt` | 主键、显示名、素材正文（生成时作为文本块追加） |
| `category` | 侧栏分组依据；前端**不**从 prompt 内容猜分类 |
| `metadata` | JSON 字符串，API 层解析成对象返回 |
| `archived_at` | 软删除。archived 行不能被引用，但历史 job 仍能显示 |

**uploads** — 参考图，**base64 存在库里**（`data` 列），不在文件系统。上限见 `src/uploads.ts` 的 `MAX_UPLOAD_BYTES`。

| 列 | 说明 |
| --- | --- |
| `mime_type` | 由**字节签名**判定，不信客户端的 content-type |
| `data` | base64；列表/API 响应一律走 `UploadSummary`（`Omit<UploadRow,'data'>`），绝不外带 |
| `archived_at` | 软删除。job 引用了已归档的图片时，提交会被拒 |

**jobs** — 一次提交。四份快照是核心语义：**改了素材不会改历史任务**。

| 列 | 说明 |
| --- | --- |
| `authored_prompt_snapshot` | 用户原样写的文本（含 token），前端「展开提示词」显示的就是它 |
| `references_snapshot` | 引用快照数组：文本素材在前、图片在后，图片项带 `kind:'image'` |
| `prompt_snapshot` | **真正发给 provider** 的展开后文本 |
| `options_snapshot` | 新任务保存 `{version:2, providerId, modelId, options, background}`，auto 省略，不含凭证/endpoint；旧无版本快照不改写，由 legacy decoder 解析 |
| `asset_id` / `asset_name` | 首个文本素材的 id / 名字；纯文本提示词时 `asset_name` 为 `'text'` |
| `requested_count` / `completed_count` / `failed_count` | 进度计数，由 `refreshJob()` 按 item 行重算 |
| `status` / `cancelled_at` | 见下方状态机 |

**job_items** — 一张图 = 一个 item。`(job_id, ordinal)` 唯一，`ordinal` 从 1 开始；`status` 上有队列索引。

| 列 | 说明 |
| --- | --- |
| `status` | `queued` / `running` / `succeeded` / `failed` / `cancelled` |
| `heartbeat_at` | 处理期间每 15s 更新；stale 恢复依据此列 |
| `error` | 终态错误文本，已由 `safeError` 脱敏 |

**llm_requests** — 每个 item 的每次尝试。`(item_id, attempt)` 唯一，`attempt` 从 1 递增。

| 列 | 说明 |
| --- | --- |
| `status` | `running` / `succeeded` / `failed`（**没有** cancelled；被打断的记 `failed`） |
| `error` | 失败原因，`interrupted by stale recovery` 表示被恢复流程打断 |

**generated_files** — 产出登记。`(item_id, file_name)` 唯一。

| 列 | 说明 |
| --- | --- |
| `file_name` | `output/` 下的文件名 `<jobId>-<ordinal>.<ext>`；写入前校验不含分隔符、不以 `.` 开头、大小非负 |
| `mime_type` / `size_bytes` | 决定 `/api/output/:name` 响应的 content-type |

**job_events** — 只追加的审计流水，`id` 自增，按 `(job_id, id)` 建索引。事件类型：`job.created` / `job.cancelled` / `job.retry-failed` / `item.claimed` / `item.succeeded` / `item.failed` / `item.recovered` / `request.recovered`。

## 状态机

```text
job:   queued ─► running ─► succeeded
          │          │
          │          ├─► failed ──(retry-failed)──► queued
          └──────────┴─► cancelled

item:  queued ─► running ─► succeeded
          │          ├─► failed ──(retry-failed)──► queued
          │          ├─► cancelled（仅未发请求时）
          └─► cancelled
```

job 状态由 `refreshJob()` 从 item 行推导，顺序：有 running → `running`；否则有 queued → `queued`；否则有 failed → `failed`；否则有 cancelled → `cancelled`；否则 `succeeded`。

**非法迁移会抛错**，不是静默忽略：`invalid transition: …`（`startRequest` 要求 item 是 running、`finalizeRequest` / `completeRegisteredItem` 要求 item 与 request 都处于 running、job 已取消时拒绝开新请求）。改这些函数时保留这个 fail-fast 行为。

## 迁移

```bash
bun run db:generate   # 改完 schema.ts 后生成 SQL（要提交）
bun run db:migrate    # 手动应用（一般不需要）
```

- **正常路径不用手动 migrate**：任何入口打开数据库时都会跑 `migrate()`，包括测试的 `:memory:` 库。
- 新增列/表后，`bun run db:generate` 产出的 `.sql` 与 `drizzle/meta/` 都要提交，否则别人的库不会升级。
- 已有迁移文件名是 drizzle 随机生成的（如 `0002_open_ulik.sql`），不要重命名。
- `drizzle.config.ts` 里的 `dbCredentials.url` 只是 drizzle-kit 的默认值，运行时路径由 `DATABASE_PATH` 决定。

## 容易踩的点

- **不要绕过 repository 直接写表**：状态迁移的原子性都在事务里，外边补一刀会破坏不变量。
- **`uploads.data` 是全库最大的一块**：任何列表/摘要路径都要走 `UploadSummary`，别 `select()` 整行。
- **时间一律 `nowUtc()` 的 ISO 字符串**，比较用字符串比较（SQLite 里按字典序即时间序）。
- **软删除没有「取消归档」接口**：`archived_at` 一旦写入只能改库。
- 产出文件可能被手工删除：`process()` 命中已登记产出时会先 `stat()`，文件不在就重新生成。
