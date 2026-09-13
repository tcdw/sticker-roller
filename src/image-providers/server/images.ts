import { ConfigError } from '../../errors';
import type { AdapterDeps, AdapterImage, AdapterRequest, ImageAdapter } from './contracts';
import { normalizeBaseUrl, providerConfigState } from './env';
import { decodeBase64Strict, verifyImageBytes } from './image-bytes';

/** No retries, redirects, remote-image downloads, or response text in errors. */
async function post(
  deps: AdapterDeps,
  url: string,
  key: string,
  body: BodyInit,
  signal?: AbortSignal,
): Promise<AdapterImage> {
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(url, {
      method: 'POST',
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${key}`,
        ...(typeof body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(180000)]) : AbortSignal.timeout(180000),
    });
  } catch {
    throw new Error('image provider request failed or timed out');
  }
  if (!response.ok) {
    throw new Error(`image provider returned HTTP ${response.status}`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('image provider returned invalid JSON');
  }
  const data = payload && typeof payload === 'object' && 'data' in payload ? payload.data : undefined;
  if (!Array.isArray(data) || data.length !== 1 || !data[0] || typeof data[0] !== 'object') {
    throw new Error('image provider must return exactly one image');
  }
  const bytes = decodeBase64Strict(data[0].b64_json, 'image');
  const verified = await verifyImageBytes(bytes);
  const declared = data[0].media_type;
  if (declared !== undefined && declared !== verified.mimeType) {
    throw new Error('image provider returned mismatched image MIME');
  }
  return { bytes, mimeType: verified.mimeType };
}

function config(deps: AdapterDeps, prefix: 'OPENAI' | 'OPENROUTER', fallback: string) {
  if (!providerConfigState(prefix === 'OPENAI' ? 'openai' : 'openrouter', deps.env).configured) {
    throw new ConfigError('image provider configuration is incomplete or invalid');
  }
  const key = deps.env[`${prefix}_API_KEY`];
  const base = normalizeBaseUrl(deps.env[`${prefix}_BASE_URL`] ?? fallback);
  if (!key?.trim() || !base) {
    throw new ConfigError('image provider configuration is incomplete or invalid');
  }
  return { key, base };
}

async function references(request: AdapterRequest) {
  const result: Array<{ bytes: Buffer; mimeType: string }> = [];
  for (const ref of request.referenceImages) {
    const bytes = decodeBase64Strict(ref.data, 'reference image');
    const verified = await verifyImageBytes(bytes);
    if (verified.mimeType !== ref.mimeType) {
      throw new Error('reference image MIME mismatch');
    }
    result.push(verified);
  }
  return result;
}

export function createOpenAiAdapter(deps: AdapterDeps): ImageAdapter {
  return {
    providerId: 'openai',
    async generate(request) {
      if (request.selection.providerId !== 'openai') {
        throw new Error('adapter selection mismatch');
      }
      const { key, base } = config(deps, 'OPENAI', 'https://api.openai.com/v1');
      const options = request.selection.options;
      const fields = {
        model: request.selection.modelId,
        prompt: request.prompt,
        n: 1,
        background: request.selection.background === 'native-transparent' ? 'transparent' : 'opaque',
        output_format: 'png',
        ...(options.size === undefined ? {} : { size: options.size }),
        ...(options.quality === undefined ? {} : { quality: options.quality }),
      };
      const refs = await references(request);
      if (!refs.length) {
        return post(deps, `${base}/images/generations`, key, JSON.stringify(fields), request.signal);
      }
      const form = new FormData();
      for (const [name, value] of Object.entries(fields)) {
        form.append(name, String(value));
      }
      refs.forEach((ref, index) => {
        form.append(
          'image[]',
          new Blob([new Uint8Array(ref.bytes)], { type: ref.mimeType }),
          `reference-${index}.${ref.mimeType === 'image/png' ? 'png' : ref.mimeType === 'image/jpeg' ? 'jpg' : 'webp'}`,
        );
      });
      return post(deps, `${base}/images/edits`, key, form, request.signal);
    },
  };
}

export function createOpenRouterAdapter(deps: AdapterDeps): ImageAdapter {
  return {
    providerId: 'openrouter',
    async generate(request) {
      if (request.selection.providerId !== 'openrouter') {
        throw new Error('adapter selection mismatch');
      }
      const { key, base } = config(deps, 'OPENROUTER', 'https://openrouter.ai/api/v1');
      const gpt = request.selection.modelId.startsWith('gpt-image-');
      const options = request.selection.options;
      const refs = await references(request);
      const fields = {
        model: `${gpt ? 'openai' : 'google'}/${request.selection.modelId}`,
        prompt: request.prompt,
        n: 1,
        provider: {
          only: [
            gpt
              ? 'openai'
              : request.selection.modelId === 'gemini-3-pro-image'
                ? 'google-ai-studio/global'
                : 'google-ai-studio',
          ],
          allow_fallbacks: false,
        },
        ...(gpt
          ? { background: request.selection.background === 'native-transparent' ? 'transparent' : 'opaque' }
          : {}),
        ...(options.aspectRatio === undefined ? {} : { aspect_ratio: options.aspectRatio }),
        ...('quality' in options && options.quality !== undefined ? { quality: options.quality } : {}),
        ...('imageSize' in options && options.imageSize !== undefined ? { resolution: options.imageSize } : {}),
        ...(refs.length
          ? {
              input_references: refs.map((ref) => ({
                type: 'image_url',
                image_url: { url: `data:${ref.mimeType};base64,${ref.bytes.toString('base64')}` },
              })),
            }
          : {}),
      };
      return post(deps, `${base}/images`, key, JSON.stringify(fields), request.signal);
    },
  };
}
