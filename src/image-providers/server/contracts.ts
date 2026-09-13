/**
 * 服务端 adapter 契约（阶段二，路线三）。
 *
 * 与 ../contracts.ts 的分工：那份是**跨端**的定义/快照契约（web 会打包），
 * 这份只在服务端使用，允许 node/SDK/凭证。前端永远不会 import 本目录。
 *
 * adapter 只负责「认证 + 协议 + 模型映射 + 响应解析 + 错误转换」。
 * 它**不**碰数据库、不决定输出路径、不领任务、不做背景后处理——
 * 背景策略与字节校验都在生成编排（src/generator.ts）里，见定案 §3。
 */

import type { ReferenceImage } from '../../config';
import type { GenerationSelection, ImageProviderId } from '../catalog';

/**
 * 注入式环境变量。测试传假 env 即可完全隔离真实凭证，
 * 生产由组合根传 `process.env`；adapter 自身永远不直接读 process.env。
 */
export type ProviderEnv = Readonly<Record<string, string | undefined>>;

/** 注入式 fetch，便于阶段四用离线 mock 验证协议细节而不发真实请求。 */
export type FetchLike = typeof fetch;

export interface AdapterRequest {
  /** 已展开的提示词。洋红指令由编排层在调用前追加，adapter 不再改写。 */
  readonly prompt: string;
  /** 有序参考图；顺序即上游收到的顺序。 */
  readonly referenceImages: readonly ReferenceImage[];
  /** 已解码校验过的完整配置，adapter 不再自行补默认值。 */
  readonly selection: GenerationSelection;
  readonly signal?: AbortSignal;
}

/** adapter 的领域返回：原始字节 + 上游声明的 mime。字节合法性由编排层统一判定。 */
export interface AdapterImage {
  readonly bytes: Buffer;
  readonly mimeType: string;
}

export interface ImageAdapter {
  readonly providerId: ImageProviderId;
  generate(request: AdapterRequest): Promise<AdapterImage>;
}

export interface AdapterDeps {
  readonly env: ProviderEnv;
  readonly fetch?: FetchLike;
}

export type AdapterFactory = (deps: AdapterDeps) => ImageAdapter;
