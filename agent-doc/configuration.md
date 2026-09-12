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
| `AI_GATEWAY_URL` | — | 设置后进入 Gateway 模式 |
| `AI_GATEWAY_TOKEN` | — | Gateway 模式密钥 |

另外 CLI 的 `--database` / `--out` 优先于对应环境变量；服务端参数由 `startServer(options)` 显式传入时优先于环境变量（测试就是这么隔离的）。

## provider 模式选择

`src/generator.ts` 的 `isGatewayMode()`：**`AI_GATEWAY_URL` 与 `AI_GATEWAY_TOKEN` 同时存在**才走 AI Gateway，否则走直连 Google。两者都缺时会抛 `GEMINI_API_KEY environment variable is not set`。

| | AI Gateway 模式 | 直连模式 |
| --- | --- | --- |
| 触发条件 | URL + TOKEN 都有 | 否则 |
| SDK 入口 | `createGateway({ baseURL, apiKey })` | `createGoogleGenerativeAI({ apiKey })` |
| 模型 id | `google/<model>`（`gemini-3-pro-image` 特判） | `gemini-3-pro-image` → `gemini-3-pro-image-preview` |

后台调研原文（为什么不用 ai-gateway 的 Gemini 路由、Vertex 返回 400 的原因）见 [design/ai-gateway-integration.md](design/ai-gateway-integration.md)。**注意该原文的「代码结构」一节已过时**：现在只有一个 `generateSingleImage()` 实现，不是两个 `generateWith*()` 分支。

## Secret 处理规则

- 密钥只从环境变量来；错误信息出库前必须经 `src/jobs/worker.ts` 的 `safeError()` 脱敏（抹 URL 与 `authorization` / `x-api-key` / `bearer …` 形态的值后再截断入库）。
- API 响应里不返回任何路径或凭证：素材只返回内容与元数据，产出图只返回文件名。
- `.env` 里若新增键，**只需**在本文档的变量表补一行名字；不要写示例值。

## 常见配置错误

| 症状 | 原因 | 修正 |
| --- | --- | --- |
| `GEMINI_API_KEY environment variable is not set` | 两个模式都没配齐 | 补 `GEMINI_API_KEY`，或同时补 URL+TOKEN |
| 图生成到别处 / CLI 与 Web 找不到同一批产出 | `OUTPUT_DIR` 与 `DATABASE_PATH` 两端不一致 | 让 Web 与 CLI 用同一组环境变量 |
| 端口被占 | 3000 上已有实例 | 换 `PORT`，或先停旧进程 |
| 改了参数但行为没变 | `auto` 表示「不发送该字段」 | 显式选一个具体值；`auto` 不是「交给前端猜」 |
| 迁移没生效 | 手动删过 `drizzle/` 或换了数据库文件 | 重新 `bun run db:generate` 提交迁移；启动时会自动 migrate |
