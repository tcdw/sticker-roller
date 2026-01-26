# AI Gateway 集成调研

## 背景

调研是否可以将 sticker-roller 接入公司的 ai-gateway 以统一管理 API 调用和用量追踪。

## 结论

**不可行**，继续使用 Google AI Studio 直接 API。

## 原因分析

### ai-gateway 的 Gemini 代理限制

1. **后端是 GCP Vertex AI** - ai-gateway 的 Gemini 路由走的是 `aiplatform.googleapis.com`，而非 Google AI Studio 的 `generativelanguage.googleapis.com`

2. **User-Agent 限制** - 只允许 `GeminiCLI/` 开头的客户端

3. **模型被强制覆盖** - ai-gateway 内部手册明确规定：「The model setting in your client will be ignored. The server always uses gemini-3-pro-preview regardless of your local configuration.」请求的 `gemini-3-pro-image-preview` 会被强制替换为 `gemini-3-pro-preview`（纯文本模型）

4. **Vertex AI 返回错误** - 因为实际调用的是不支持图片输出的模型，GCP Vertex AI 返回 400 错误：`Multi-modal output is not supported.`

## 当前方案

继续使用 `GEMINI_API_KEY` 环境变量直接调用 Google AI Studio API：

```typescript
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});
```

## 未来可能的改进：使用 Vercel AI SDK + ai-gateway Vercel 路由

### 可行路径

ai-gateway 有另一条 Vercel 路由 (`/v1/chat/completions`)，走的是 Vercel AI Gateway，支持图片生成模型：

- 端点：`https://ai-gateway.vercel.sh/v1/chat/completions`
- 模型：`google/gemini-3-pro-image`（白名单允许 `google/gemini-3*`）
- 认证：公司 token

### 当前阻塞问题

**Vercel AI SDK 不支持 `imageSize` 参数**（1K/2K/4K）

| 功能 | 支持情况 |
|------|---------|
| `aspectRatio` | ✅ 通过 `providerOptions.google.imageConfig.aspectRatio` |
| `imageSize` | ❌ 不支持 |

相关 issue：https://github.com/vercel/ai/issues/11924

### 待 SDK 支持后的实现方案

1. 安装依赖：
   ```bash
   bun add ai @ai-sdk/google
   ```

2. 修改 `generator.ts`，使用 `generateText`：
   ```typescript
   import { generateText } from 'ai';
   import { google } from '@ai-sdk/google';

   // 走 ai-gateway 的 Vercel 路由
   const result = await generateText({
     model: google('gemini-3-pro-image', {
       baseURL: process.env.AI_GATEWAY_URL + '/v1',
       apiKey: process.env.AI_GATEWAY_TOKEN,
     }),
     prompt: options.sticker.prompt,
     providerOptions: {
       google: {
         imageConfig: {
           aspectRatio: '1:1',
           imageSize: '1K',  // 待 SDK 支持
         },
       },
     },
   });

   // 图片在 result.files 中
   for (const file of result.files) {
     if (file.mediaType.startsWith('image/')) {
       await Bun.write(filePath, file.data);
     }
   }
   ```

3. 支持双模式（可选）：
   - 有 `AI_GATEWAY_TOKEN` → 走 Vercel AI SDK + ai-gateway
   - 只有 `GEMINI_API_KEY` → 继续用 `@google/genai` 直连

### 注意事项

- `generateText` 不支持 `n` 参数，需要循环多次调用生成多张图片
- 需要处理 reference images 的传入方式（多模态输入）
- 模型名称格式不同：
  - 直连 Google API：`gemini-3-pro-image-preview`
  - ai-gateway Vercel 路由：`google/gemini-3-pro-image`

---

*调研日期: 2026-01-26*
