/**
 * 服务端的环境读取：渠道是否配置齐备、旧快照该按哪个渠道解释、自定义 base URL 校验。
 *
 * 三条约束（定案 §5 / §7 / §9）：
 * 1. 共享层（../catalog.ts 等）永远不读 env；「当前配置会选哪个渠道」只在这里判定，
 *    再显式传给解码器，所以旧任务不会被冒充成「历史事实」。
 * 2. 状态只表示**本地配置齐备**，不是账户/网络可用性探测，也不返回任何值。
 * 3. env 一律通过参数注入，测试用假 env 即可与真实凭证隔离。
 */

import { getProviderDefinition, IMAGE_PROVIDERS, type ImageProviderId, type LegacyProviderId } from '../catalog';
import type { ProviderEnv } from './contracts';

/** 固定原因码，前端按码决定措辞，不依赖服务端文案。 */
export type ProviderConfigReason = 'ok' | 'missing-env' | 'invalid-base-url';

export interface ProviderConfigState {
  readonly id: string;
  readonly configured: boolean;
  readonly reason: ProviderConfigReason;
  /** 缺失的环境变量**名称**（永远不含值）。 */
  readonly missingEnv: readonly string[];
}

const present = (env: ProviderEnv, name: string): boolean => {
  const value = env[name];
  return typeof value === 'string' && value.trim().length > 0;
};

/** 可选的自定义 base URL 环境变量名；填了就必须合法，填错不静默回落官方地址。 */
const OPTIONAL_BASE_URL: Readonly<Record<string, string | undefined>> = {
  'ai-gateway': 'AI_GATEWAY_URL',
  openai: 'OPENAI_BASE_URL',
  openrouter: 'OPENROUTER_BASE_URL',
};

/**
 * 自定义 base URL 只接受 HTTP(S) 根前缀：
 * 合法的自定义路径保留（例如反代挂在 /gateway 下），但 userinfo / query / fragment 一律拒绝，
 * 也不自动补 `/v1`——补错路径会把请求发到别的服务上去。
 */
export function normalizeBaseUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return undefined;
  }
  if (url.username || url.password || url.search || url.hash) {
    return undefined;
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export function providerConfigState(providerId: string, env: ProviderEnv): ProviderConfigState {
  const definition = getProviderDefinition(providerId);
  if (!definition) {
    return { id: providerId, configured: false, reason: 'missing-env', missingEnv: [] };
  }
  const missingEnv = definition.requiredEnv.filter((name) => !present(env, name));
  if (missingEnv.length) {
    return { id: definition.id, configured: false, reason: 'missing-env', missingEnv };
  }
  const baseUrlName = OPTIONAL_BASE_URL[definition.id];
  if (baseUrlName && env[baseUrlName] !== undefined && normalizeBaseUrl(env[baseUrlName] as string) === undefined) {
    return { id: definition.id, configured: false, reason: 'invalid-base-url', missingEnv: [baseUrlName] };
  }
  return { id: definition.id, configured: true, reason: 'ok', missingEnv: [] };
}

export function listProviderConfigStates(env: ProviderEnv): readonly ProviderConfigState[] {
  return IMAGE_PROVIDERS.map((provider) => providerConfigState(provider.id, env));
}

export function isProviderConfigured(providerId: string, env: ProviderEnv): boolean {
  return providerConfigState(providerId, env).configured;
}

/**
 * 无版本旧快照该按哪个渠道解释。
 *
 * 刻意复刻迁移前 `generator.ts` 的 `isGatewayMode()` 优先级（Gateway 的 URL+TOKEN 同时存在就用 Gateway，
 * 否则 Google 直连），这样旧任务的执行路由不会因为这次重构而改变。
 * 注意这只影响**旧**快照；v2 任务的渠道已经写在快照里，加别的 key 也不会改路由。
 */
export function resolveLegacyProviderId(env: ProviderEnv): LegacyProviderId {
  return present(env, 'AI_GATEWAY_URL') && present(env, 'AI_GATEWAY_TOKEN') ? 'ai-gateway' : 'google';
}

/** 读取必需的凭证；缺失时由调用方抛 ConfigError，消息里只允许出现变量名。 */
export function requireEnv(env: ProviderEnv, name: string): string | undefined {
  const value = env[name];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export type { ImageProviderId };
