/**
 * 生成编排：把一个已解码的配置（GenerationSelection）变成一张已验证的图片。
 *
 * 分工（定案 §3）：
 * - adapter（src/image-providers/server/）负责认证、协议、模型映射、响应解析；
 * - **本文件**负责背景策略、字节校验与领域返回，不含任何按厂商的分支；
 * - worker 只拿完整 selection 调用这里，不再逐字段提取选项。
 */

import sharp from 'sharp';
import { BACKGROUND_KEY_COLOR, type StickerConfig } from './config';
import type { GenerationSelection } from './image-providers';
import type { FetchLike, ProviderEnv } from './image-providers/server';
import { createAdapter } from './image-providers/server';
import { verifyImageBytes } from './image-providers/server/image-bytes';

/** Input for one image: the caller decides the output path (see src/jobs/worker.ts). */
export interface ImageGenerationOptions {
  sticker: StickerConfig;
  /** 已解码校验过的完整配置；编排层不再自行补默认值。 */
  selection: GenerationSelection;
  /** 注入式环境变量与 fetch，测试用假实现即可完全避开真实 provider。 */
  env?: ProviderEnv;
  fetch?: FetchLike;
  signal?: AbortSignal;
}

const BACKGROUND_PROMPT_INSTRUCTION = `\n\nCRITICAL BACKGROUND INSTRUCTION: The entire background of this image must be a solid, uniform bright magenta color (${BACKGROUND_KEY_COLOR} / fuchsia). No gradients, no variations - pure ${BACKGROUND_KEY_COLOR}. The subject must be clearly separated from this magenta background. Do NOT use magenta, fuchsia, bright pink, purple, or violet colors anywhere on the subject, outline, glow, shadow, or edge pixels.`;

/**
 * 洋红抠底：算法与迁移前逐字一致，不要顺手调参（阈值改动会直接改变所有历史风格的边缘）。
 * 只在 background === 'magenta-key' 时执行，与原生透明互斥。
 */
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

export interface SingleImageResult {
  success: boolean;
  imageBuffer?: Buffer;
  mimeType?: string;
  error?: string;
}

/** Generate one image without choosing a filesystem path. */
export async function generateSingleImage(options: ImageGenerationOptions): Promise<SingleImageResult> {
  const { selection } = options;
  try {
    const adapter = createAdapter(selection.providerId, {
      env: options.env ?? process.env,
      fetch: options.fetch,
    });
    const raw = await adapter.generate({
      // 洋红提示词只在洋红策略下追加；原生透明路径的提示词绝不经过它。
      prompt:
        selection.background === 'magenta-key'
          ? options.sticker.prompt + BACKGROUND_PROMPT_INSTRUCTION
          : options.sticker.prompt,
      referenceImages: options.sticker.referenceImages,
      selection,
      signal: options.signal,
    });
    const verified = await verifyImageBytes(raw.bytes);
    if (raw.mimeType !== verified.mimeType) {
      throw new Error('provider returned mismatched image MIME');
    }
    if (selection.background === 'magenta-key') {
      return { success: true, imageBuffer: await removeBackground(verified.bytes), mimeType: 'image/png' };
    }
    if (selection.background === 'native-transparent' && !verified.hasAlpha) {
      // 明确失败，不降级：定案 §1.6 要求原生透明不得回落到本地抠底。
      throw new Error('provider returned an opaque image while native transparency was requested');
    }
    return { success: true, imageBuffer: verified.bytes, mimeType: verified.mimeType };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'image generation failed' };
  }
}
