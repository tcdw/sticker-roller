/**
 * 服务端 adapter 注册表：把跨端定义（../catalog.ts）绑到强类型实现上。
 *
 * images.test.ts 保证注册表与定义一一对应——新增渠道时忘了注册 adapter，
 * 或者注册了却没有定义，都会在测试里立刻失败，而不是等到一次真实付费调用。
 */

import { ConfigError } from '../../errors';
import { getProviderDefinition, IMAGE_PROVIDERS, type ImageProviderId } from '../catalog';
import type { AdapterDeps, AdapterFactory, ImageAdapter } from './contracts';
import { providerConfigState } from './env';
import { createAiGatewayAdapter, createGoogleAdapter } from './gemini';
import { createOpenAiAdapter, createOpenRouterAdapter } from './images';

const FACTORIES: Readonly<Record<string, AdapterFactory>> = {
  google: createGoogleAdapter,
  openai: createOpenAiAdapter,
  openrouter: createOpenRouterAdapter,
  'ai-gateway': createAiGatewayAdapter,
};

export function hasAdapter(providerId: string): providerId is ImageProviderId {
  return Object.hasOwn(FACTORIES, providerId);
}

export function registeredAdapterIds(): readonly string[] {
  return Object.keys(FACTORIES);
}

/**
 * 建一个 adapter。配置不齐备时抛 ConfigError（CLI 退出 1、HTTP 固定错误码），
 * 消息里只出现环境变量**名**，不出现值、URL 或上游原文。
 */
export function createAdapter(providerId: string, deps: AdapterDeps): ImageAdapter {
  const factory = FACTORIES[providerId];
  if (!factory || !getProviderDefinition(providerId)) {
    throw new ConfigError(`unknown image provider ${JSON.stringify(providerId)}`);
  }
  const state = providerConfigState(providerId, deps.env);
  if (!state.configured) {
    throw new ConfigError(
      state.reason === 'invalid-base-url'
        ? `image provider ${providerId} has an invalid base URL in ${state.missingEnv.join(', ')}`
        : `image provider ${providerId} is not configured; set ${state.missingEnv.join(', ')}`,
      state.missingEnv,
    );
  }
  return factory(deps);
}

export { IMAGE_PROVIDERS };
