import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGateway, generateText } from 'ai';
import sharp from 'sharp';
import {
  BACKGROUND_KEY_COLOR,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_IMAGE_SIZE,
  DEFAULT_MODEL,
  DEFAULT_REMOVE_BACKGROUND,
  type StickerConfig,
} from './config';
import { buildProviderImageConfig } from './image-options';

const OUTPUT_DIR = join(import.meta.dir, '..', 'output');

export interface GenerateOptions {
  sticker: StickerConfig;
  count: number;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  removeBackground?: boolean;
  onProgress?: (current: number, total: number) => void;
}

export interface GenerateResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

type ImageConfigAspectRatio = '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '4:5' | '5:4' | '9:16' | '16:9' | '21:9';

type ImageConfigSize = '1K' | '2K' | '4K';

const BACKGROUND_PROMPT_INSTRUCTION = `\n\nCRITICAL BACKGROUND INSTRUCTION: The entire background of this image must be a solid, uniform bright magenta color (${BACKGROUND_KEY_COLOR} / fuchsia). No gradients, no variations - pure ${BACKGROUND_KEY_COLOR}. The subject must be clearly separated from this magenta background. Do NOT use magenta, fuchsia, bright pink, purple, or violet colors anywhere on the subject, outline, glow, shadow, or edge pixels.`;

function resolveRemoveBackground(options: GenerateOptions): boolean {
  if (options.removeBackground !== undefined) {
    return options.removeBackground;
  }
  if (options.sticker.removeBackground !== undefined) {
    return options.sticker.removeBackground;
  }
  return DEFAULT_REMOVE_BACKGROUND;
}

async function removeBackground(imageBuffer: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(imageBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const threshold = 0.18;
  const maxDistance = 1.2;

  const clamp = (value: number): number => Math.max(0, Math.min(1, value));

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]! / 255;
    const g = data[i + 1]! / 255;
    const b = data[i + 2]! / 255;
    const a = data[i + 3]! / 255;

    const dr = r - 1;
    const dg = g;
    const db = b - 1;
    const distance = Math.sqrt(dr * dr + dg * dg + db * db);
    const magentaDominance = Math.min(r, b) - g;
    const magentaAmount = clamp((magentaDominance - 0.03) / 0.35);
    const distanceAmount = clamp((maxDistance - distance) / (maxDistance - threshold));
    const keyAmount = distance <= threshold ? 1 : distanceAmount * magentaAmount;
    const foregroundAmount = 1 - keyAmount;

    if (foregroundAmount <= 0.001) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
      continue;
    }

    data[i] = Math.round(clamp((r - keyAmount) / foregroundAmount) * 255);
    data[i + 1] = Math.round(clamp(g / foregroundAmount) * 255);
    data[i + 2] = Math.round(clamp((b - keyAmount) / foregroundAmount) * 255);
    data[i + 3] = Math.round(a * foregroundAmount * 255);
  }

  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

/**
 * Check if AI Gateway mode is enabled
 */
function isGatewayMode(): boolean {
  return !!(process.env.AI_GATEWAY_URL && process.env.AI_GATEWAY_TOKEN);
}

/**
 * Create the appropriate provider based on mode
 */
function createProvider() {
  if (isGatewayMode()) {
    return createGateway({
      baseURL: process.env.AI_GATEWAY_URL,
      apiKey: process.env.AI_GATEWAY_TOKEN,
    });
  } else {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is not set. Please set it in your .env file.');
    }

    const userAgent = process.env.GEMINI_USER_AGENT;
    return createGoogleGenerativeAI({
      apiKey,
      headers: userAgent ? { 'User-Agent': userAgent } : undefined,
    });
  }
}

/**
 * Get the model ID based on mode and configuration
 */
function getModelId(modelName: string = DEFAULT_MODEL): string {
  if (isGatewayMode()) {
    // Gateway uses the mapped model name
    // For gemini-3-pro-image, it maps to google/gemini-3-pro-image
    // For gemini-3.1-flash-image-preview, assume it maps similarly
    if (modelName === 'gemini-3-pro-image') {
      return 'google/gemini-3-pro-image';
    }
    return `google/${modelName}`;
  } else {
    // Direct API uses the actual model name
    if (modelName === 'gemini-3-pro-image') {
      return 'gemini-3-pro-image-preview';
    }
    return modelName;
  }
}

export interface SingleImageResult {
  success: boolean;
  imageBuffer?: Buffer;
  mimeType?: string;
  error?: string;
}

/** Generate one image without choosing a filesystem path. */
export async function generateSingleImage(
  options: Omit<GenerateOptions, 'count' | 'onProgress'>,
): Promise<SingleImageResult> {
  const aspectRatio = options.aspectRatio ?? options.sticker.aspectRatio;
  const imageSize = options.imageSize ?? options.sticker.imageSize;
  const imageConfig = buildProviderImageConfig({ aspectRatio, imageSize });
  const doRemoveBg = resolveRemoveBackground(options as GenerateOptions);
  try {
    const content: Array<{ type: 'text'; text: string } | { type: 'image'; image: string; mimeType: string }> = [];
    for (const refImage of options.sticker.referenceImages) {
      content.push({ type: 'image', image: refImage.data, mimeType: refImage.mimeType });
    }
    content.push({
      type: 'text',
      text: doRemoveBg ? options.sticker.prompt + BACKGROUND_PROMPT_INSTRUCTION : options.sticker.prompt,
    });
    const result = await generateText({
      model: createProvider()(getModelId(options.model)),
      messages: [{ role: 'user', content }],
      providerOptions: Object.keys(imageConfig).length
        ? {
            google: {
              imageConfig: imageConfig as { aspectRatio?: ImageConfigAspectRatio; imageSize?: ImageConfigSize },
            },
          }
        : undefined,
    });
    const file = result.files?.find((candidate) => candidate.mediaType?.startsWith('image/'));
    if (!file) {
      return { success: false, error: 'No image in response' };
    }
    let imageBuffer = Buffer.from(file.base64, 'base64') as Buffer;
    if (doRemoveBg) {
      imageBuffer = await removeBackground(imageBuffer);
    }
    return { success: true, imageBuffer, mimeType: doRemoveBg ? 'image/png' : file.mediaType };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'image generation failed' };
  }
}
export async function generateImages(options: GenerateOptions): Promise<GenerateResult[]> {
  const aspectRatio = options.aspectRatio || options.sticker.aspectRatio || DEFAULT_ASPECT_RATIO;
  const imageSize = options.imageSize || options.sticker.imageSize || DEFAULT_IMAGE_SIZE;
  const doRemoveBg = resolveRemoveBackground(options);

  const provider = createProvider();
  const modelId = getModelId(options.model);
  const results: GenerateResult[] = [];
  const timestamp = Date.now();
  await mkdir(OUTPUT_DIR, { recursive: true });

  for (let i = 0; i < options.count; i++) {
    options.onProgress?.(i + 1, options.count);

    try {
      const content: Array<{ type: 'text'; text: string } | { type: 'image'; image: string; mimeType: string }> = [];

      for (const refImage of options.sticker.referenceImages) {
        content.push({
          type: 'image',
          image: refImage.data,
          mimeType: refImage.mimeType,
        });
      }

      const promptText = doRemoveBg ? options.sticker.prompt + BACKGROUND_PROMPT_INSTRUCTION : options.sticker.prompt;

      content.push({ type: 'text', text: promptText });

      const result = await generateText({
        model: provider(modelId),
        messages: [{ role: 'user', content }],
        providerOptions: {
          google: {
            imageConfig: {
              aspectRatio: aspectRatio as ImageConfigAspectRatio,
              imageSize: imageSize as ImageConfigSize,
            },
          },
        },
      });

      let savedFile = false;

      if (result.files && result.files.length > 0) {
        for (const file of result.files) {
          if (file.mediaType?.startsWith('image/')) {
            const mimeType = file.mediaType;
            let rawBuffer: Buffer = Buffer.from(file.base64, 'base64') as Buffer;

            const ext = doRemoveBg
              ? '.png'
              : mimeType === 'image/jpeg'
                ? '.jpg'
                : mimeType === 'image/webp'
                  ? '.webp'
                  : '.png';
            const fileName = `${options.sticker.name}-${timestamp}-${i + 1}${ext}`;
            const filePath = join(OUTPUT_DIR, fileName);

            if (doRemoveBg) {
              rawBuffer = await removeBackground(rawBuffer);
            }

            await Bun.write(filePath, rawBuffer);

            results.push({
              success: true,
              filePath,
            });
            savedFile = true;
            break;
          }
        }
      }

      if (!savedFile) {
        results.push({
          success: false,
          error: 'No image in response',
        });
      }
    } catch (error) {
      results.push({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

/**
 * Get the current mode description
 */
export function getGeneratorMode(): string {
  if (isGatewayMode()) {
    return `AI Gateway (${process.env.AI_GATEWAY_URL})`;
  } else {
    return 'Direct Google API';
  }
}
