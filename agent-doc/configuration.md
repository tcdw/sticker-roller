# 配置

没有配置文件：所有运行配置来自**环境变量**，Bun 会自动加载仓库根的 `.env`（**不要**引入 dotenv）。`.env` 已 gitignore，**绝不提交**，也永远不要把里面的值复制进文档、测试或源码。

`.env` 的键名可在文件里查（不要读出值）。

## 环境变量

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `DATABASE_PATH` | `./data/sticker-roller.sqlite` | SQLite 文件，Web 与 CLI 共用 |
| `OUTPUT_DIR` | `<repo>/output` | 产出图片目录，也是 CLI `--out` 的默认值 |
| `HOST` | `127.0.0.1` | HTTP 监听地址 |
| `PORT` | `3000` | HTTP 端口 |
| `GEMINI_API_KEY` | — | 直连 Google 模式的密钥 |
| `GEMINI_USER_AGENT` | — | 可选，直连模式下附加的 User-Agent |
| `GOOGLE_GEMINI_BASE_URL` | — | **死变量**：`.env` 里有，但全仓库无代码读取（可能是 SDK 历史遗留）。改它不会改变任何行为 |
| `AI_GATEWAY_URL` | — | Gateway 根前缀；仅旧快照或未指定渠道时参与自动选择 |
| `AI_GATEWAY_TOKEN` | — | Gateway 渠道密钥 |
| `OPENAI_API_KEY` | — | OpenAI Images 密钥 |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | 可选 OpenAI 根前缀 |
| `OPENROUTER_API_KEY` | — | OpenRouter Images 密钥 |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | 可选 OpenRouter 根前缀 |

另外 CLI 的 `--database` / `--out` 优先于对应环境变量；服务端参数由 `startServer(options)` 显式传入时优先于环境变量（测试就是这么隔离的）。

## provider 渠道选择

四个渠道由 `src/image-providers/catalog.ts` 静态定义，服务端 adapter 在 `src/image-providers/server/` 注册。新任务持久化 v2 selection：providerId、modelId、options、background。没有凭证设置页面。

- Google / AI Gateway 保留原 SDK 和模型映射；Google SDK 原有默认重试（2 次）保留。
- OpenAI Images：`OPENAI_API_KEY`，可选 `OPENAI_BASE_URL`（默认 `https://api.openai.com/v1`）；无参考图走 generations，有图走 multipart edits。
- OpenRouter Images：`OPENROUTER_API_KEY`，可选 `OPENROUTER_BASE_URL`（默认 `https://openrouter.ai/api/v1`）；统一 JSON `/images`。固定已核对上游，禁用 fallback。
- 自定义根前缀只接受 HTTP(S)，拒绝 userinfo/query/fragment，保留自定义路径，不自动补 `/v1`。显式空字符串或空白同样无效；只有未设置时使用默认地址。
- 只有旧快照与未指定渠道的旧 API/CLI 参数使用环境优先级：Gateway URL+TOKEN 齐备则 Gateway，否则 Google。新 v2 重试不会因其他 key 出现而换渠道；修改其渠道 endpoint 仍会影响之后执行。
- `/api/image-providers` 只返回本地配置状态、原因码、缺失变量名和 legacy 默认渠道，不返回值、不探测账户。
- 新任务在建库前检查配置。HTTP 配置错误为 503，CLI 为退出 1；参数错误分别为 400/退出 2。

首批 GPT 2.5 Flare/Sunburst 使用原生透明，无洋红降级。OpenAI 只开放有限尺寸预设；OpenRouter 不开放精确尺寸、不发送未确认的 output_format。原生透明响应无 alpha 则失败。新 fetch adapter 不重试，180 秒超时不等于远端未计费。

## Secret 处理规则

- 密钥只从环境变量来；错误信息出库前必须经 `src/jobs/worker.ts` 的 `safeError()` 脱敏（抹 URL 与 `authorization` / `x-api-key` / `bearer …` 形态的值后再截断入库）。
- API 响应里不返回任何路径或凭证：素材只返回内容与元数据，产出图只返回文件名。
- `.env` 里若新增键，**只需**在本文档的变量表补一行名字；不要写示例值。

## 常见配置错误

| 症状 | 原因 | 修正 |
| --- | --- | --- |
| `image provider is not configured` | 所选渠道缺少环境变量或根前缀无效 | 按错误列出的变量名配置；不要把可选根前缀设为空白 |
| 图生成到别处 / CLI 与 Web 找不到同一批产出 | `OUTPUT_DIR` 与 `DATABASE_PATH` 两端不一致 | 让 Web 与 CLI 用同一组环境变量 |
| 端口被占 | 3000 上已有实例 | 换 `PORT`，或先停旧进程 |
| 改了参数但行为没变 | `auto` 表示「不发送该字段」 | 显式选一个具体值；`auto` 不是「交给前端猜」 |
| 迁移没生效 | 手动删过 `drizzle/` 或换了数据库文件 | 重新 `bun run db:generate` 提交迁移；启动时会自动 migrate |
