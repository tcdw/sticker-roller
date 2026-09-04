/**
 * 纯 TS 的模型能力矩阵，前后端共享。
 *
 * 注意：本文件不得引入 node:fs / node:path 等 node 专属依赖，
 * web 前端会直接打包本文件（因此不能让它 import src/config.ts）。
 *
 * `auto` 的语义是“不向生成 provider 指定该字段”：服务端不落库、
 * generator 不生成 providerOptions.google.imageConfig 中的对应键，
 * 也不会把字符串 `auto` 发给 provider。
 */

export const AUTO = 'auto';

export const SUPPORTED_ASPECT_RATIOS: readonly string[] = ['1:1', '16:9', '9:16', '4:3', '3:4'];
export const SUPPORTED_IMAGE_SIZES: readonly string[] = ['1K', '2K', '4K'];
export const SUPPORTED_MODELS: readonly string[] = ['gemini-3-pro-image', 'gemini-3.1-flash-image-preview'];

export type AspectRatio = '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
export type ImageSize = '1K' | '2K' | '4K';
export type Model = (typeof SUPPORTED_MODELS)[number];

export const DEFAULT_MODEL: string = SUPPORTED_MODELS[0] ?? 'gemini-3-pro-image';

export interface ModelCapabilities {
  aspectRatios: readonly string[];
  imageSizes: readonly string[];
}

/** 每个模型独立配置；当前两个模型能力一致，未来可在此按模型差异化。 */
export const MODEL_CAPABILITIES: Readonly<Record<Model, ModelCapabilities>> = {
  'gemini-3-pro-image': {
    aspectRatios: SUPPORTED_ASPECT_RATIOS,
    imageSizes: SUPPORTED_IMAGE_SIZES,
  },
  'gemini-3.1-flash-image-preview': {
    aspectRatios: SUPPORTED_ASPECT_RATIOS,
    imageSizes: SUPPORTED_IMAGE_SIZES,
  },
};

export function getModelCapabilities(model: string): ModelCapabilities {
  return MODEL_CAPABILITIES[model as Model] ?? { aspectRatios: [], imageSizes: [] };
}

export function isSupportedAspectRatio(model: string, value: string): boolean {
  return getModelCapabilities(model).aspectRatios.includes(value);
}

export function isSupportedImageSize(model: string, value: string): boolean {
  return getModelCapabilities(model).imageSizes.includes(value);
}

/** 模型切换后，当前值不被新模型支持时回退为 AUTO；undefined/auto 原样保留。 */
export function resolveAspectRatio(model: string, value: string | undefined): string {
  if (value === undefined || value === AUTO) {
    return AUTO;
  }
  return isSupportedAspectRatio(model, value) ? value : AUTO;
}

export function resolveImageSize(model: string, value: string | undefined): string {
  if (value === undefined || value === AUTO) {
    return AUTO;
  }
  return isSupportedImageSize(model, value) ? value : AUTO;
}

export interface ProviderImageConfig {
  aspectRatio?: string;
  imageSize?: string;
}

/** 过滤 auto/undefined，只保留显式字段，供 generator 构造 providerOptions。 */
export function buildProviderImageConfig(input: { aspectRatio?: string; imageSize?: string }): ProviderImageConfig {
  const config: ProviderImageConfig = {};
  if (input.aspectRatio !== undefined && input.aspectRatio !== AUTO) {
    config.aspectRatio = input.aspectRatio;
  }
  if (input.imageSize !== undefined && input.imageSize !== AUTO) {
    config.imageSize = input.imageSize;
  }
  return config;
}
