import type { ProviderDefinition, SelectionShape } from '../contracts';
export type OpenAiModelId = 'gpt-image-2.5-flare' | 'gpt-image-2.5-sunburst';
export type ImageQuality = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export interface OpenAiOptions {
  size?: '1024x1024' | '1536x1024' | '1024x1536';
  quality?: ImageQuality;
}
export type OpenAiSelection = SelectionShape<'openai', OpenAiModelId, OpenAiOptions>;
export const openAiProvider: ProviderDefinition<'openai', OpenAiModelId, OpenAiOptions> = {
  id: 'openai',
  label: 'OpenAI Images',
  requiredEnv: ['OPENAI_API_KEY'],
  models: (['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'] as const).map((id) => ({
    id,
    label: id,
    backgrounds: ['original', 'native-transparent'],
    defaultBackground: 'native-transparent',
    inputLimits: { maxReferences: 16, maxPrompt: 32000 },
    fields: [
      {
        name: 'size',
        kind: 'select',
        label: '像素尺寸',
        group: 'basic',
        optional: true,
        choices: ['1024x1024', '1536x1024', '1024x1536'].map((value) => ({ value, label: value })),
      },
      {
        name: 'quality',
        kind: 'select',
        label: '质量',
        group: 'basic',
        optional: true,
        choices: ['low', 'medium', 'high', 'xhigh', 'max'].map((value) => ({ value, label: value })),
      },
    ],
  })),
};
