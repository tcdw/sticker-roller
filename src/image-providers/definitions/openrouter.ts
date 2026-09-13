import type { AnyProviderDefinition, SelectionShape } from '../contracts';
import type { GoogleImageOptions, GoogleModelId } from './google';
import type { ImageQuality, OpenAiModelId } from './openai';
export interface RouterGptOptions {
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  quality?: ImageQuality;
}
export type OpenRouterSelection =
  | SelectionShape<'openrouter', GoogleModelId, GoogleImageOptions>
  | SelectionShape<'openrouter', OpenAiModelId, RouterGptOptions>;
const choices = (values: string[]) => values.map((value) => ({ value, label: value }));
export const openRouterProvider: AnyProviderDefinition = {
  id: 'openrouter',
  label: 'OpenRouter Images',
  requiredEnv: ['OPENROUTER_API_KEY'],
  models: ['gemini-3-pro-image', 'gemini-3.1-flash-image-preview', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'].map(
    (id) => {
      const gpt = id.startsWith('gpt-image-');
      return {
        id,
        label: id,
        backgrounds: gpt ? ['original', 'native-transparent'] : ['original', 'magenta-key'],
        defaultBackground: gpt ? 'native-transparent' : 'magenta-key',
        inputLimits: gpt ? { maxReferences: 16, maxPrompt: 32000 } : { maxReferences: 14 },
        fields: [
          {
            name: 'aspectRatio',
            kind: 'select',
            label: '比例',
            group: 'basic',
            optional: true,
            choices: choices(['1:1', '16:9', '9:16', '4:3', '3:4']),
          },
          gpt
            ? {
                name: 'quality',
                kind: 'select',
                label: '质量',
                group: 'basic',
                optional: true,
                choices: choices(['low', 'medium', 'high', 'xhigh', 'max']),
              }
            : {
                name: 'imageSize',
                kind: 'select',
                label: '尺寸档位',
                group: 'basic',
                optional: true,
                choices: choices(['1K', '2K', '4K']),
              },
        ],
      };
    },
  ),
};
