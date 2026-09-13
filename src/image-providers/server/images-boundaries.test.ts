import { expect, test } from 'bun:test';
import sharp from 'sharp';
import { generateSingleImage } from '../../generator';
import { normalizeJobSelection } from '../../jobs/options';
import type { FetchLike } from './contracts';
import { providerConfigState } from './env';
import { createAdapter } from './registry';

const env = { OPENAI_API_KEY: 'offline', OPENROUTER_API_KEY: 'offline' };
const sticker = { name: 'test', prompt: 'draw', referenceImages: [] };
const png = () =>
  sharp({ create: { width: 4, height: 4, channels: 4, background: '#ff00ff' } })
    .png()
    .toBuffer();

test('OpenRouter Gemini mappings, 4K and actual magenta keying', async () => {
  for (const model of ['gemini-3-pro-image', 'gemini-3.1-flash-image-preview']) {
    const bytes = await png();
    let calls = 0;
    const fetchMock = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe(`google/${model}`);
      expect(body.resolution).toBe('4K');
      expect(body.aspect_ratio).toBe('16:9');
      expect(body.provider).toEqual({
        only: [model === 'gemini-3-pro-image' ? 'google-ai-studio/global' : 'google-ai-studio'],
        allow_fallbacks: false,
      });
      expect(body.prompt).toContain('CRITICAL BACKGROUND INSTRUCTION');
      expect(body.n).toBe(1);
      return Response.json({ data: [{ b64_json: bytes.toString('base64') }] });
    }) as unknown as FetchLike;
    const result = await generateSingleImage({
      sticker,
      env,
      fetch: fetchMock,
      selection: normalizeJobSelection(
        { providerId: 'openrouter', model, options: { imageSize: '4K', aspectRatio: '16:9' } },
        env,
      ),
    });
    expect(result.success).toBe(true);
    const raw = await sharp(result.imageBuffer).ensureAlpha().raw().toBuffer();
    expect(raw[3]).toBe(0);
    expect(calls).toBe(1);
  }
});

test('different reference formats and bytes retain exact order on both protocols', async () => {
  const first = await png();
  const second = await sharp({ create: { width: 3, height: 3, channels: 3, background: '#00ff00' } })
    .jpeg()
    .toBuffer();
  const refs = [
    { data: first.toString('base64'), mimeType: 'image/png', fileName: 'first.png' },
    { data: second.toString('base64'), mimeType: 'image/jpeg', fileName: 'second.jpg' },
  ];
  for (const providerId of ['openai', 'openrouter'] as const) {
    const fetchMock = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (providerId === 'openai') {
        const form = init?.body as FormData;
        const files = form.getAll('image[]') as File[];
        expect(files.map((file) => file.type)).toEqual(refs.map((ref) => ref.mimeType));
        expect(
          await Promise.all(files.map(async (file) => Buffer.from(await file.arrayBuffer()).toString('base64'))),
        ).toEqual(refs.map((ref) => ref.data));
      } else {
        const body = JSON.parse(String(init?.body));
        expect(body.input_references).toEqual(
          refs.map((ref) => ({ type: 'image_url', image_url: { url: `data:${ref.mimeType};base64,${ref.data}` } })),
        );
      }
      return Response.json({ data: [{ b64_json: first.toString('base64') }] });
    }) as unknown as FetchLike;
    await createAdapter(providerId, { env, fetch: fetchMock }).generate({
      selection: normalizeJobSelection({ providerId, model: 'gpt-image-2.5-flare' }, env),
      prompt: 'draw',
      referenceImages: refs,
    });
  }
});

test('native alpha, truncated images and declared MIME are enforced without retries', async () => {
  const opaque = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } })
    .png()
    .toBuffer();
  const valid = await png();
  const jpeg = await sharp(valid).jpeg().toBuffer();
  const webp = await sharp(valid).webp().toBuffer();
  for (const providerId of ['openai', 'openrouter']) {
    for (const payload of [
      { b64_json: opaque.toString('base64') },
      ...[valid, jpeg, webp].map((bytes) => ({ b64_json: bytes.subarray(0, 20).toString('base64') })),
      { b64_json: valid.toString('base64'), media_type: 'image/jpeg' },
    ]) {
      let calls = 0;
      const fetchMock = (async () => {
        calls++;
        return Response.json({ data: [payload] });
      }) as unknown as FetchLike;
      const result = await generateSingleImage({
        sticker,
        env,
        fetch: fetchMock,
        selection: normalizeJobSelection({ providerId, model: 'gpt-image-2.5-flare' }, env),
      });
      expect(result.success).toBe(false);
      expect(calls).toBe(1);
    }
  }
});

test('network rejection and aborted requests fail safely once', async () => {
  for (const providerId of ['openai', 'openrouter'] as const) {
    for (const abort of [false, true]) {
      let calls = 0;
      const controller = new AbortController();
      controller.abort();
      const fetchMock = (async (_url: RequestInfo | URL, init?: RequestInit) => {
        calls++;
        expect(init?.signal).toBeDefined();
        if (abort) {
          expect(init?.signal?.aborted).toBe(true);
        }
        throw new Error('secret-payload https://private.invalid');
      }) as unknown as FetchLike;
      await expect(
        createAdapter(providerId, { env, fetch: fetchMock }).generate({
          selection: normalizeJobSelection({ providerId, model: 'gpt-image-2.5-flare' }, env),
          prompt: 'draw',
          referenceImages: [],
          signal: abort ? controller.signal : undefined,
        }),
      ).rejects.toThrow('image provider request failed or timed out');
      expect(calls).toBe(1);
    }
  }
});

test('explicit empty endpoints are invalid in state and execution before fetch', async () => {
  for (const providerId of ['openai', 'openrouter'] as const) {
    const name = providerId === 'openai' ? 'OPENAI_BASE_URL' : 'OPENROUTER_BASE_URL';
    for (const value of ['', '   ', 'file:///bad', 'https://user:pass@example.invalid']) {
      const invalidEnv = { ...env, [name]: value };
      expect(providerConfigState(providerId, invalidEnv).reason).toBe('invalid-base-url');
      let calls = 0;
      const result = await generateSingleImage({
        sticker,
        env: invalidEnv,
        selection: normalizeJobSelection({ providerId, model: 'gpt-image-2.5-flare' }, env),
        fetch: (async () => {
          calls++;
          throw new Error('must not fetch');
        }) as unknown as FetchLike,
      });
      expect(result.success).toBe(false);
      expect(calls).toBe(0);
    }
    expect(providerConfigState(providerId, { ...env, [name]: 'https://example.invalid/custom/' }).configured).toBe(
      true,
    );
  }
});
