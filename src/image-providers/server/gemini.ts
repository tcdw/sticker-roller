/**
 * Google 直连与 AI Gateway 两个渠道的 adapter。
 *
 * 两者共用同一套 AI SDK 调用形状（`generateText` + `providerOptions.google.imageConfig`），
 * 差别只有「怎么建 provider」和「模型名怎么映射到上游」，所以实现放在一起，
 * 但**注册成两个独立渠道**：v2 任务选定哪个就固定哪个，环境里多出别的 key 也不会改路由。
 *
 * 重试：这里刻意保留 AI SDK `generateText` 的默认重试（maxRetries = 2），
 * 与迁移前的行为完全一致（定案 §10「保留既有 Google 重试行为时应明确记录」）。
 * 阶段四的新 adapter 则不内置任何重试。
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGateway, generateText } from 'ai';
import { AI_GATEWAY_PROVIDER_ID } from '../definitions/ai-gateway';
import { GOOGLE_PROVIDER_ID } from '../definitions/google';
import type { AdapterDeps, AdapterImage, AdapterRequest, FetchLike, ImageAdapter, ProviderEnv } from './contracts';
import { requireEnv } from './env';

type ImageConfigAspectRatio = '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';
type ImageConfigSize = '1K' | '2K' | '4K';

interface GeminiImageConfig {
  [key: string]: string | undefined;
  aspectRatio?: ImageConfigAspectRatio;
  imageSize?: ImageConfigSize;
}

/** options 已经过字段定义校验，这里只做「缺省即不发送」的投影。 */
export function buildGeminiImageConfig(options: Record<string, unknown>): GeminiImageConfig {
  const config: GeminiImageConfig = {};
  if (typeof options.aspectRatio === 'string') {
    config.aspectRatio = options.aspectRatio as ImageConfigAspectRatio;
  }
  if (typeof options.imageSize === 'string') {
    config.imageSize = options.imageSize as ImageConfigSize;
  }
  return config;
}

type ModelFactory = (modelId: string) => Parameters<typeof generateText>[0]['model'];

async function callGemini(
  createModel: ModelFactory,
  upstreamModelId: string,
  request: AdapterRequest,
): Promise<AdapterImage> {
  const content: Array<{ type: 'text'; text: string } | { type: 'image'; image: string; mimeType: string }> = [];
  for (const reference of request.referenceImages) {
    content.push({ type: 'image', image: reference.data, mimeType: reference.mimeType });
  }
  content.push({ type: 'text', text: request.prompt });
  const config = buildGeminiImageConfig(request.selection.options as Record<string, unknown>);
  const result = await generateText({
    model: createModel(upstreamModelId),
    messages: [{ role: 'user', content }],
    providerOptions: Object.keys(config).length ? { google: { imageConfig: config } } : undefined,
    abortSignal: request.signal,
  }).catch(() => {
    throw new Error('Google image provider request failed');
  });
  const file = result.files?.find((candidate) => candidate.mediaType?.startsWith('image/'));
  if (!file) {
    throw new Error('No image in response');
  }
  return { bytes: Buffer.from(file.base64, 'base64'), mimeType: file.mediaType ?? 'image/png' };
}

/** 迁移前 `getModelId()` 的直连分支，逐字保留。 */
export function googleUpstreamModelId(modelId: string): string {
  return modelId === 'gemini-3-pro-image' ? 'gemini-3-pro-image-preview' : modelId;
}

/** 迁移前 `getModelId()` 的 Gateway 分支，逐字保留。 */
export function gatewayUpstreamModelId(modelId: string): string {
  return `google/${modelId}`;
}

function googleModelFactory(env: ProviderEnv, fetchImpl?: FetchLike): ModelFactory {
  const apiKey = requireEnv(env, 'GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }
  const userAgent = requireEnv(env, 'GEMINI_USER_AGENT');
  const provider = createGoogleGenerativeAI({
    apiKey,
    headers: userAgent ? { 'User-Agent': userAgent } : undefined,
    fetch: fetchImpl,
  });
  return (modelId) => provider(modelId);
}

function gatewayModelFactory(env: ProviderEnv, fetchImpl?: FetchLike): ModelFactory {
  const baseURL = requireEnv(env, 'AI_GATEWAY_URL');
  const apiKey = requireEnv(env, 'AI_GATEWAY_TOKEN');
  if (!baseURL || !apiKey) {
    throw new Error('AI_GATEWAY_URL and AI_GATEWAY_TOKEN are not set');
  }
  const provider = createGateway({ baseURL, apiKey, fetch: fetchImpl });
  return (modelId) => provider(modelId);
}

export function createGoogleAdapter(deps: AdapterDeps): ImageAdapter {
  return {
    providerId: GOOGLE_PROVIDER_ID,
    generate: async (request) =>
      callGemini(googleModelFactory(deps.env, deps.fetch), googleUpstreamModelId(request.selection.modelId), request),
  };
}

export function createAiGatewayAdapter(deps: AdapterDeps): ImageAdapter {
  return {
    providerId: AI_GATEWAY_PROVIDER_ID,
    generate: async (request) =>
      callGemini(gatewayModelFactory(deps.env, deps.fetch), gatewayUpstreamModelId(request.selection.modelId), request),
  };
}
