# AI Gateway 集成

## 背景

调研是否可以将 sticker-roller 接入公司的 ai-gateway 以统一管理 API 调用和用量追踪。

## 结论

**已实现双模式支持**：
- **AI Gateway 模式**：通过 Vercel AI SDK + ai-gateway 的 Vercel 路由
- **Direct 模式**：直接调用 Google AI Studio API

## 使用方式

### AI Gateway 模式

设置以下环境变量启用 AI Gateway 模式：

```bash
# 公司 ai-gateway
AI_GATEWAY_URL=https://gateway.rightcapital.ai/api
AI_GATEWAY_TOKEN=sk-rc-ai-xxx

# 或者直接用 Vercel AI Gateway
AI_GATEWAY_URL=https://ai-gateway.vercel.sh/v3/ai
AI_GATEWAY_TOKEN=vck_xxx
```

### Direct 模式（默认）

设置以下环境变量使用直连 Google API：

```bash
GEMINI_API_KEY=your-google-api-key
GEMINI_USER_AGENT=optional-user-agent  # 可选
```

### 模式选择逻辑

- 同时设置 `AI_GATEWAY_URL` 和 `AI_GATEWAY_TOKEN` → AI Gateway 模式
- 否则 → Direct 模式（需要 `GEMINI_API_KEY`）

## 调研历史

### ai-gateway Gemini 路由的限制（不可用）

之前尝试过直接使用 ai-gateway 的 Gemini 路由 (`/api/(gemini)/...`)，但存在以下问题：

1. **后端是 GCP Vertex AI** - 走的是 `aiplatform.googleapis.com`，而非 Google AI Studio 的 `generativelanguage.googleapis.com`

2. **User-Agent 限制** - 只允许 `GeminiCLI/` 开头的客户端

3. **模型被强制覆盖** - ai-gateway 内部手册规定：「The model setting in your client will be ignored. The server always uses gemini-3-pro-preview regardless of your local configuration.」

4. **Vertex AI 返回错误** - GCP Vertex AI 返回 400 错误：`Multi-modal output is not supported.`

### 解决方案：使用 Vercel 路由

ai-gateway 的 Vercel 路由 (`/v1/chat/completions`) 走的是 Vercel AI Gateway，支持图片生成模型：

- 模型：`google/gemini-3-pro-image`
- 通过 `providerOptions.google.imageConfig` 设置 `aspectRatio` 和 `imageSize`

## 技术实现

### 依赖

```bash
bun add ai @ai-sdk/google
```

### 代码结构

`src/generator.ts` 包含两个实现：

1. `generateWithGateway()` - 使用 Vercel AI SDK
2. `generateWithDirectAPI()` - 使用 `@google/genai` SDK

根据环境变量自动选择。

### 差异对比

| 特性 | AI Gateway 模式 | Direct 模式 |
|------|-----------------|-------------|
| SDK | `ai` + `@ai-sdk/google` | `@google/genai` |
| 模型名 | `gemini-3-pro-image` | `gemini-3-pro-image-preview` |
| 认证 | `AI_GATEWAY_TOKEN` | `GEMINI_API_KEY` |
| 用量追踪 | 统一到 ai-gateway | 各自 Google 账户 |

---

*初始调研: 2026-01-26*
*实现完成: 2026-01-26*
