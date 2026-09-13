/**
 * AI Gateway 渠道定义（AI_GATEWAY_URL + AI_GATEWAY_TOKEN 走 ai 的 createGateway）。
 *
 * 与 google.ts 是两个独立渠道：新任务一旦选定本渠道就固定下来，
 * 之后环境里多出别的 key 也不会改变这些任务的执行路由（定案 §5）。
 * 字面量刻意不与 google.ts 共享，理由同 google.ts 顶部说明。
 */

import type { ModelDefinition, ProviderDefinition, SelectField, SelectionShape } from '../contracts';

export const AI_GATEWAY_PROVIDER_ID = 'ai-gateway';

const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const;
const IMAGE_SIZES = ['1K', '2K', '4K'] as const;

export type AiGatewayAspectRatio = (typeof ASPECT_RATIOS)[number];
export type AiGatewayImageSize = (typeof IMAGE_SIZES)[number];
export type AiGatewayModelId = 'gemini-3-pro-image' | 'gemini-3.1-flash-image-preview';

export interface AiGatewayImageOptions {
  aspectRatio?: AiGatewayAspectRatio;
  imageSize?: AiGatewayImageSize;
}

export type AiGatewaySelection = SelectionShape<typeof AI_GATEWAY_PROVIDER_ID, AiGatewayModelId, AiGatewayImageOptions>;

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

function gatewayModel(id: AiGatewayModelId, label: string): ModelDefinition<AiGatewayModelId, AiGatewayImageOptions> {
  return {
    id,
    label,
    fields: [aspectRatioField, imageSizeField],
    backgrounds: ['magenta-key', 'original'],
    inputLimits: { maxReferences: 14 },
    defaultBackground: 'magenta-key',
  };
}

export const aiGatewayProvider: ProviderDefinition<
  typeof AI_GATEWAY_PROVIDER_ID,
  AiGatewayModelId,
  AiGatewayImageOptions
> = {
  id: AI_GATEWAY_PROVIDER_ID,
  label: 'AI Gateway',
  requiredEnv: ['AI_GATEWAY_URL', 'AI_GATEWAY_TOKEN'],
  models: [
    gatewayModel('gemini-3-pro-image', 'Gemini 3 Pro Image'),
    gatewayModel('gemini-3.1-flash-image-preview', 'Gemini 3.1 Flash Image (preview)'),
  ],
};
