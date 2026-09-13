/**
 * 服务端防腐层入口。**前端绝不 import 本目录**：这里允许 node、SDK 与凭证读取，
 * 跨端可用的定义/解码在上一层 src/image-providers/index.ts。
 */

export type {
  AdapterDeps,
  AdapterFactory,
  AdapterImage,
  AdapterRequest,
  FetchLike,
  ImageAdapter,
  ProviderEnv,
} from './contracts';
export {
  isProviderConfigured,
  listProviderConfigStates,
  normalizeBaseUrl,
  type ProviderConfigReason,
  type ProviderConfigState,
  providerConfigState,
  requireEnv,
  resolveLegacyProviderId,
} from './env';
export { createAdapter, hasAdapter, registeredAdapterIds } from './registry';
