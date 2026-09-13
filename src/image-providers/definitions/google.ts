/**
 * Google 直连渠道定义（GEMINI_API_KEY 走 @ai-sdk/google）。
 *
 * 这里只描述**应用内**的模型标识与可选参数；到上游的模型名映射、认证与请求构造
 * 属于服务端 adapter（阶段二），不允许泄漏到这份跨端定义里。
 *
 * 能力表与 ai-gateway 当前一致，但两份定义刻意各自写死字面量：
 * 同一模型经不同渠道的能力不一定相同（例如 AI Studio 有 4K 而 Vertex 只列 1K/2K），
 * 共享一份常量会让某一侧的收紧意外污染另一侧。
 */

import type { ModelDefinition, ProviderDefinition, SelectField, SelectionShape } from '../contracts';

export const GOOGLE_PROVIDER_ID = 'google';

const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const;
const IMAGE_SIZES = ['1K', '2K', '4K'] as const;

export type GoogleAspectRatio = (typeof ASPECT_RATIOS)[number];
export type GoogleImageSize = (typeof IMAGE_SIZES)[number];
export type GoogleModelId = 'gemini-3-pro-image' | 'gemini-3.1-flash-image-preview';

/** 两个字段都是 optional：缺省表示不向 Gemini 指定该项（原 `auto` 语义）。 */
export interface GoogleImageOptions {
  aspectRatio?: GoogleAspectRatio;
  imageSize?: GoogleImageSize;
}

export type GoogleSelection = SelectionShape<typeof GOOGLE_PROVIDER_ID, GoogleModelId, GoogleImageOptions>;

const aspectRatioField: SelectField<'aspectRatio'> = {
  kind: 'select',
  name: 'aspectRatio',
  label: '比例',
  group: 'basic',
  optional: true,
  choices: ASPECT_RATIOS.map((value) => ({ value, label: value })),
};

const imageSizeField: SelectField<'imageSize'> = {
  kind: 'select',
  name: 'imageSize',
  label: '尺寸档位',
  group: 'basic',
  optional: true,
  choices: IMAGE_SIZES.map((value) => ({ value, label: value })),
};

function geminiModel(id: GoogleModelId, label: string): ModelDefinition<GoogleModelId, GoogleImageOptions> {
  return {
    id,
    label,
    fields: [aspectRatioField, imageSizeField],
    // Gemini 没有原生透明输出，只有既有的洋红抠底或完全不处理。
    backgrounds: ['magenta-key', 'original'],
    inputLimits: { maxReferences: 14 },
    defaultBackground: 'magenta-key',
  };
}

export const googleProvider: ProviderDefinition<typeof GOOGLE_PROVIDER_ID, GoogleModelId, GoogleImageOptions> = {
  id: GOOGLE_PROVIDER_ID,
  label: 'Google 直连',
  requiredEnv: ['GEMINI_API_KEY'],
  models: [
    geminiModel('gemini-3-pro-image', 'Gemini 3 Pro Image'),
    geminiModel('gemini-3.1-flash-image-preview', 'Gemini 3.1 Flash Image (preview)'),
  ],
};
