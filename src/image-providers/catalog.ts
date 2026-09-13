/**
 * 静态注册表：Web 与 CLI 共用同一份渠道/模型定义（前端直接打包本文件）。
 *
 * 注册在代码里完成，不是用户填 JSON 就能接入的插件平台；
 * 服务端 adapter 注册表（阶段二）会绑定这里的定义与强类型实现，并用测试保证一一对应。
 */

import {
  type AnyModelDefinition,
  type AnyProviderDefinition,
  type BackgroundStrategy,
  SELECTION_VERSION,
} from './contracts';
import { type AiGatewaySelection, aiGatewayProvider } from './definitions/ai-gateway';
import { type GoogleSelection, googleProvider } from './definitions/google';
import { type OpenAiSelection, openAiProvider } from './definitions/openai';
import { type OpenRouterSelection, openRouterProvider } from './definitions/openrouter';

export type { AiGatewayImageOptions, AiGatewayModelId, AiGatewaySelection } from './definitions/ai-gateway';
export type { GoogleImageOptions, GoogleModelId, GoogleSelection } from './definitions/google';

/** 所有渠道的配置快照联合；provider / model / options 在类型层面绑定，禁止任意 Record。 */
export type GenerationSelection = GoogleSelection | AiGatewaySelection | OpenAiSelection | OpenRouterSelection;

export type ImageProviderId = GenerationSelection['providerId'];

/** 四个显式渠道；能力以渠道定义为准，不按模型厂商隐式选路由。 */
export const IMAGE_PROVIDERS: readonly AnyProviderDefinition[] = [
  googleProvider,
  aiGatewayProvider,
  openAiProvider,
  openRouterProvider,
];

/**
 * 无版本旧快照可能来自的渠道。旧任务没有记录渠道，调用方必须显式告诉解码器
 * 「当前环境会选哪个」，共享层不读 env，也不假造历史事实（见 decode.ts）。
 */
export type LegacyProviderId = 'google' | 'ai-gateway';

export const LEGACY_PROVIDER_IDS: readonly LegacyProviderId[] = ['google', 'ai-gateway'];

export function listImageProviders(): readonly AnyProviderDefinition[] {
  return IMAGE_PROVIDERS;
}

export function getProviderDefinition(providerId: string): AnyProviderDefinition | undefined {
  return IMAGE_PROVIDERS.find((provider) => provider.id === providerId);
}

export function getModelDefinition(providerId: string, modelId: string): AnyModelDefinition | undefined {
  return getProviderDefinition(providerId)?.models.find((model) => model.id === modelId);
}

export function isImageProviderId(value: unknown): value is ImageProviderId {
  return typeof value === 'string' && IMAGE_PROVIDERS.some((provider) => provider.id === value);
}

export function isLegacyProviderId(value: unknown): value is LegacyProviderId {
  return typeof value === 'string' && (LEGACY_PROVIDER_IDS as readonly string[]).includes(value);
}

/**
 * 把已校验的 options 绑回渠道联合成员。
 *
 * 字段校验（fields.ts）保证键集合与取值都来自该模型的定义，因此这里做一次受控断言；
 * 这是整个防腐层唯一允许的 options 断言点，decode/normalize 之外不要再 cast。
 */
export function bindSelection(
  providerId: string,
  modelId: string,
  options: Record<string, unknown>,
  background: BackgroundStrategy,
): GenerationSelection {
  return { version: SELECTION_VERSION, providerId, modelId, options, background } as GenerationSelection;
}
