/**
 * 图片生成渠道防腐层的共享契约（阶段一，路线三）。
 *
 * 本文件与 definitions/、catalog.ts、decode.ts、normalize.ts 一样是**跨端**模块：
 * web 会直接打包它们，因此不得 import node:*、SDK、React 或 src/config.ts，
 * 也不得读取任何环境变量。凭证与 endpoint 只允许出现在服务端 adapter 里。
 *
 * 三个概念不可混用：
 * - providerId  应用内的 API 接入渠道（google / ai-gateway / …），不是模型厂商；
 * - modelId     该渠道定义下的模型，不能由厂商前缀反推渠道；
 * - options     该渠道+模型的专属参数，形状由字段定义约束，不是任意 Record。
 */

/** 省略语义：调用方不指定该字段，交由上游选择。持久化时表现为「键不存在」，快照里永远不会出现字面量 'auto'。 */
export const AUTO = 'auto';

/** v2 配置快照的版本号。无 version 的快照一律走 legacy decoder。 */
export const SELECTION_VERSION = 2;

/**
 * 背景策略由生成编排执行，不是渠道选项：
 * - original           不做任何背景处理（OpenAI 侧在 adapter 内明确映射为 opaque）；
 * - native-transparent 使用上游原生透明输出，禁止再走洋红流程；
 * - magenta-key        现有 Gemini 洋红提示词 + 本地抠底。
 */
export type BackgroundStrategy = 'original' | 'native-transparent' | 'magenta-key';

export const BACKGROUND_STRATEGIES: readonly BackgroundStrategy[] = ['original', 'native-transparent', 'magenta-key'];

/** 字段分组只影响展示（基础 / 高级），与校验职责无关。 */
export type OptionFieldGroup = 'basic' | 'advanced';

interface OptionFieldBase<K extends string> {
  /** 必须是该渠道 options 类型的键（由 ModelDefinition 的泛型约束）。 */
  readonly name: K;
  readonly label: string;
  readonly group: OptionFieldGroup;
  /**
   * true 表示该字段可以缺省：缺省即「委托上游选择」。
   * 建任务时不会为它注入应用默认值，快照里直接没有这个键。
   */
  readonly optional?: boolean;
}

export interface SelectFieldChoice {
  readonly value: string;
  readonly label: string;
}

export interface SelectField<K extends string = string> extends OptionFieldBase<K> {
  readonly kind: 'select';
  readonly choices: readonly SelectFieldChoice[];
  /** 仅非 optional 字段需要；建任务时固定注入，读取旧快照时**不**注入。 */
  readonly defaultValue?: string;
}

export interface BooleanField<K extends string = string> extends OptionFieldBase<K> {
  readonly kind: 'boolean';
  readonly defaultValue?: boolean;
}

export interface NumberField<K extends string = string> extends OptionFieldBase<K> {
  readonly kind: 'number';
  readonly min: number;
  readonly max: number;
  /** true 时拒绝小数；数字一律要求有限值，不接受字符串数字。 */
  readonly integer: boolean;
  readonly defaultValue?: number;
}

/** 受限文本，只用于像素尺寸这类形状明确的输入；pattern 是完整匹配的源字符串，便于随定义一起序列化。 */
export interface TextField<K extends string = string> extends OptionFieldBase<K> {
  readonly kind: 'text';
  readonly pattern: string;
  readonly maxLength: number;
  readonly defaultValue?: string;
}

export type OptionField<K extends string = string> = SelectField<K> | BooleanField<K> | NumberField<K> | TextField<K>;

export type OptionFieldKind = OptionField['kind'];

export interface ModelDefinition<M extends string, O extends object> {
  readonly id: M;
  readonly label: string;
  readonly fields: readonly OptionField<Extract<keyof O, string>>[];
  /** 该渠道下该模型允许的背景策略。能力不支持就拒绝，不偷偷换模型或改算法。 */
  readonly backgrounds: readonly BackgroundStrategy[];
  readonly inputLimits?: { readonly maxReferences: number; readonly maxPrompt?: number };
  readonly defaultBackground: BackgroundStrategy;
}

export interface ProviderDefinition<P extends string, M extends string, O extends object> {
  readonly id: P;
  readonly label: string;
  /** 只记录环境变量**名称**，用于「本地配置是否齐备」的提示；共享层永远不读取它们的值。 */
  readonly requiredEnv: readonly string[];
  readonly models: readonly ModelDefinition<M, O>[];
}

/** 落库/传输用的配置快照形状；provider、model、options 由联合类型绑定在一起。 */
export interface SelectionShape<P extends string, M extends string, O extends object> {
  readonly version: typeof SELECTION_VERSION;
  readonly providerId: P;
  readonly modelId: M;
  readonly options: O;
  readonly background: BackgroundStrategy;
}

/** 稳定的机器可读失败码；HTTP/CLI 边界（阶段三）负责映射成各自的错误契约。 */
export type SelectionErrorCode =
  | 'malformed'
  | 'unsupported-version'
  | 'unknown-provider'
  | 'unknown-model'
  | 'unknown-field'
  | 'missing-field'
  | 'invalid-field'
  | 'unsupported-background';

export interface SelectionError {
  readonly code: SelectionErrorCode;
  readonly message: string;
  /** 出错的字段路径，例如 'options.aspectRatio'；便于前端定位控件。 */
  readonly path?: string;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SelectionError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T>(code: SelectionErrorCode, message: string, path?: string): Result<T> {
  return { ok: false, error: path === undefined ? { code, message } : { code, message, path } };
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 注册表用的「擦除泛型」视图：遍历所有渠道时不需要知道各自的 options 类型。
 * 具体的 provider+model+options 绑定由各渠道的 Selection 联合类型负责（见 catalog.ts）。
 */
export interface AnyModelDefinition {
  readonly id: string;
  readonly label: string;
  readonly fields: readonly OptionField[];
  readonly backgrounds: readonly BackgroundStrategy[];
  readonly inputLimits?: { readonly maxReferences: number; readonly maxPrompt?: number };
  readonly defaultBackground: BackgroundStrategy;
}

export interface AnyProviderDefinition {
  readonly id: string;
  readonly label: string;
  readonly requiredEnv: readonly string[];
  readonly models: readonly AnyModelDefinition[];
}
