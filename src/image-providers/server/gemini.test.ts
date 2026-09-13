import { describe, expect, test } from 'bun:test';
import type { GenerationSelection } from '../catalog';
import { normalizeSelectionInput } from '../normalize';
import type { FetchLike } from './contracts';
import {
  buildGeminiImageConfig,
  createAiGatewayAdapter,
  createGoogleAdapter,
  gatewayUpstreamModelId,
  googleUpstreamModelId,
} from './gemini';

/** 1x1 PNG，够 sniff 与 sharp 解码。 */
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** 记录请求并返回一个最小的 Gemini 风格响应；绝不出网。 */
function recordingFetch(seen: Array<{ url: string; body: unknown }>): FetchLike {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const raw = typeof init?.body === 'string' ? init.body : undefined;
    seen.push({ url, body: raw ? JSON.parse(raw) : undefined });
    return new Response(
      JSON.stringify({
        candidates: [
          { content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG_B64 } }] }, finishReason: 'STOP' },
        ],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as FetchLike;
}

/** 走公共归一化入口建 selection，避免测试绕过字段校验。 */
function selection(providerId: 'google' | 'ai-gateway', options: Record<string, unknown> = {}): GenerationSelection {
  const result = normalizeSelectionInput({ providerId, modelId: 'gemini-3-pro-image', options });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}

describe('gemini adapters', () => {
  test('keeps the pre-migration upstream model mapping for both channels', () => {
    expect(googleUpstreamModelId('gemini-3-pro-image')).toBe('gemini-3-pro-image-preview');
    expect(googleUpstreamModelId('gemini-3.1-flash-image-preview')).toBe('gemini-3.1-flash-image-preview');
    expect(gatewayUpstreamModelId('gemini-3-pro-image')).toBe('google/gemini-3-pro-image');
    expect(gatewayUpstreamModelId('gemini-3.1-flash-image-preview')).toBe('google/gemini-3.1-flash-image-preview');
  });

  test('omits image config keys the selection does not carry', () => {
    expect(buildGeminiImageConfig({})).toEqual({});
    expect(buildGeminiImageConfig({ aspectRatio: '16:9' })).toEqual({ aspectRatio: '16:9' });
    expect(buildGeminiImageConfig({ aspectRatio: '16:9', imageSize: '2K' })).toEqual({
      aspectRatio: '16:9',
      imageSize: '2K',
    });
  });

  test('google adapter calls the direct API with the mapped model and ordered references', async () => {
    const seen: Array<{ url: string; body: unknown }> = [];
    const adapter = createGoogleAdapter({ env: { GEMINI_API_KEY: 'test-key' }, fetch: recordingFetch(seen) });
    const result = await adapter.generate({
      prompt: 'draw',
      referenceImages: [
        { data: PNG_B64, mimeType: 'image/png', fileName: 'a.png' },
        { data: PNG_B64, mimeType: 'image/png', fileName: 'b.png' },
      ],
      selection: selection('google', { aspectRatio: '16:9' }),
    });
    expect(result.mimeType).toBe('image/png');
    expect(result.bytes.byteLength).toBeGreaterThan(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toContain('gemini-3-pro-image-preview');
    const body = seen[0]?.body as {
      contents: Array<{ parts: Array<{ inlineData?: unknown; text?: string }> }>;
      generationConfig: { imageConfig: unknown };
    };
    const parts = body.contents[0]?.parts ?? [];
    expect(parts.filter((part) => part.inlineData)).toHaveLength(2);
    expect(parts.at(-1)?.text).toBe('draw');
    expect(body.generationConfig.imageConfig).toEqual({ aspectRatio: '16:9' });
  });

  test('gateway adapter routes through the configured gateway URL with the google/ prefix', async () => {
    const seen: Array<{ url: string; body: unknown }> = [];
    const adapter = createAiGatewayAdapter({
      env: { AI_GATEWAY_URL: 'https://gateway.invalid/v1/ai', AI_GATEWAY_TOKEN: 'test-token' },
      fetch: (async (input, init) => {
        seen.push({ url: String(input), body: JSON.parse(String(init?.body)) });
        return Response.json({
          content: [{ type: 'file', mediaType: 'image/png', data: PNG_B64 }],
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } },
          warnings: [],
        });
      }) as FetchLike,
    });
    await adapter.generate({ prompt: 'draw', referenceImages: [], selection: selection('ai-gateway') });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url.startsWith('https://gateway.invalid/v1/ai')).toBe(true);
    expect(seen[0]?.url).toBe('https://gateway.invalid/v1/ai/language-model');
  });

  test('missing credentials fail before any request is made', async () => {
    const seen: Array<{ url: string; body: unknown }> = [];
    const adapter = createGoogleAdapter({ env: {}, fetch: recordingFetch(seen) });
    await expect(
      adapter.generate({ prompt: 'p', referenceImages: [], selection: selection('google') }),
    ).rejects.toThrow('GEMINI_API_KEY');
    expect(seen).toHaveLength(0);
  });
});
