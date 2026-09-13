import { expect, test } from 'bun:test';
import sharp from 'sharp';
import { generateSingleImage } from '../../generator';
import { IMAGE_PROVIDERS } from '../catalog';
import { normalizeSelectionInput } from '../normalize';
import type { FetchLike } from './contracts';
import { providerConfigState } from './env';
import { createAdapter, registeredAdapterIds } from './registry';

const env = {
  OPENAI_API_KEY: 'test-only',
  OPENAI_BASE_URL: 'https://example.invalid/custom',
  OPENROUTER_API_KEY: 'test-only',
};
const image = () =>
  sharp({ create: { width: 2, height: 2, channels: 4, background: '#ff00ff00' } })
    .png()
    .toBuffer();
function selection(providerId: string, modelId = 'gpt-image-2.5-flare', options = {}) {
  const result = normalizeSelectionInput({ providerId, modelId, options });
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
}
test('both registries cover exactly the same channels', () => {
  expect([...registeredAdapterIds()].sort()).toEqual(IMAGE_PROVIDERS.map((p) => p.id).sort());
});
test('OpenAI generation and edit protocols preserve references and omit response_format', async () => {
  const bytes = await image();
  for (const withRefs of [false, true]) {
    let calls = 0;
    const fake = (async (url, init) => {
      calls++;
      expect(String(url)).toBe(`https://example.invalid/custom/images/${withRefs ? 'edits' : 'generations'}`);
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-only');
      const body = init?.body;
      if (withRefs) {
        expect(body).toBeInstanceOf(FormData);
        if (!(body instanceof FormData)) {
          throw new Error('missing form');
        }
        expect(body.getAll('image[]')).toHaveLength(2);
        expect(body.get('n')).toBe('1');
        expect(body.get('background')).toBe('transparent');
        expect(body.has('response_format')).toBe(false);
      } else {
        const json = JSON.parse(String(body));
        expect(json).toMatchObject({ n: 1, background: 'transparent', output_format: 'png', quality: 'max' });
        expect(json).not.toHaveProperty('response_format');
      }
      return Response.json({ data: [{ b64_json: bytes.toString('base64') }] });
    }) as FetchLike;
    await createAdapter('openai', { env, fetch: fake }).generate({
      selection: selection('openai', undefined, { quality: 'max' }),
      prompt: 'draw',
      referenceImages: withRefs
        ? [1, 2].map((i) => ({ data: bytes.toString('base64'), mimeType: 'image/png', fileName: `${i}.png` }))
        : [],
    });
    expect(calls).toBe(1);
  }
});
test('OpenRouter pins upstream and native transparency bypasses magenta processing', async () => {
  const bytes = await image();
  const fake = (async (url, init) => {
    expect(String(url)).toBe('https://openrouter.ai/api/v1/images');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: 'openai/gpt-image-2.5-flare',
      n: 1,
      background: 'transparent',
      provider: { only: ['openai'], allow_fallbacks: false },
    });
    expect(body.prompt).toBe('draw');
    expect(body).not.toHaveProperty('output_format');
    expect(body).not.toHaveProperty('size');
    return Response.json({ data: [{ b64_json: bytes.toString('base64'), media_type: 'image/png' }] });
  }) as FetchLike;
  const result = await generateSingleImage({
    selection: selection('openrouter'),
    sticker: { name: 'x', prompt: 'draw', referenceImages: [] },
    env,
    fetch: fake,
  });
  expect(result.success).toBe(true);
  expect(result.imageBuffer).toEqual(bytes);
});
test('bad responses never leak server payload and never retry', async () => {
  for (const response of [
    Response.json({ data: [] }),
    Response.json({ data: [{ b64_json: 'bad@@' }] }),
    Response.json({ data: [{ b64_json: Buffer.from('<svg/>').toString('base64') }] }),
    new Response('private-server-payload', { status: 403 }),
    new Response('not-json'),
  ]) {
    let calls = 0;
    const fake = (async (_url: RequestInfo | URL, _init?: RequestInit) => {
      calls++;
      return response;
    }) as FetchLike;
    const result = await generateSingleImage({
      selection: selection('openai'),
      sticker: { name: 'x', prompt: 'x', referenceImages: [] },
      env,
      fetch: fake,
    });
    expect(result.success).toBe(false);
    expect(result.error).not.toContain('private-server-payload');
    expect(calls).toBe(1);
  }
  for (const value of [
    'file:///tmp/x',
    'https://user:pass@example.invalid',
    'https://example.invalid/?secret=x',
    'https://example.invalid/#x',
  ]) {
    const state = providerConfigState('openai', { ...env, OPENAI_BASE_URL: value });
    expect(state.configured).toBe(false);
    expect(JSON.stringify(state)).not.toContain(value);
  }
});
