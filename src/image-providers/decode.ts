/**
 * 配置快照的解码：v2 严格解码 + 无版本旧快照的兼容解码。
 *
 * 三条不可弱化的规则（路线三定案 §5 / §6）：
 * 1. 解码**不注入任何应用默认值**。快照缺什么就报什么错，
 *    否则以后改默认值会让旧任务被解读成另一次生成。新任务的默认值在 normalize.ts。
 * 2. v2 严格拒绝未知 version / 渠道 / 模型 / 字段与非法组合；
 *    为兼容旧字段而放松 v2 是明确禁止的，所以 legacy 走独立函数。
 * 3. 旧快照没有记录渠道。本模块是纯模块，不读 env，调用方必须显式传入
 *    「当前配置会选哪个渠道」，解码结果会标注这是解析值而非历史事实。
 */

import {
  bindSelection,
  type GenerationSelection,
  getModelDefinition,
  getProviderDefinition,
  isLegacyProviderId,
  type LegacyProviderId,
} from './catalog';
import {
  type AnyModelDefinition,
  AUTO,
  BACKGROUND_STRATEGIES,
  type BackgroundStrategy,
  fail,
  isPlainObject,
  ok,
  type Result,
  SELECTION_VERSION,
} from './contracts';
import { validateFieldValues } from './fields';

export interface DecodedSelection {
  readonly selection: GenerationSelection;
  readonly format: 'v2' | 'legacy';
  /**
   * 'recorded'                    快照本身记录了渠道；
   * 'resolved-from-current-config' 旧快照没有渠道，按调用方当前配置解析得到——
   *                                展示时必须说明这是「按当前配置解析」，不能冒充历史事实。
   */
  readonly providerSource: 'recorded' | 'resolved-from-current-config';
}

export interface LegacyDecodeContext {
  /** 调用方（服务端）根据当前 env 判定的旧默认渠道。共享层不读 env。 */
  readonly legacyProviderId: LegacyProviderId;
}

const V2_ROOT_KEYS = new Set(['version', 'providerId', 'modelId', 'options', 'background']);
const LEGACY_ROOT_KEYS = new Set(['model', 'aspectRatio', 'imageSize', 'removeBackground']);

/** 旧 removeBackground 的固定翻译；刻意不用 defaultBackground，后者以后改了不该影响旧任务。 */
const LEGACY_BACKGROUND: Readonly<Record<'true' | 'false', BackgroundStrategy>> = {
  true: 'magenta-key',
  false: 'original',
};

function resolveModel(providerId: string, modelId: unknown): Result<AnyModelDefinition> {
  if (!getProviderDefinition(providerId)) {
    return fail('unknown-provider', `unknown provider ${JSON.stringify(providerId)}`, 'providerId');
  }
  if (typeof modelId !== 'string') {
    return fail('missing-field', 'modelId is required', 'modelId');
  }
  const model = getModelDefinition(providerId, modelId);
  if (!model) {
    // 不静默回退默认模型：下线的模型必须明确失败，由调用方决定如何提示。
    return fail('unknown-model', `unknown model ${JSON.stringify(modelId)} for provider ${providerId}`, 'modelId');
  }
  return ok(model);
}

function checkBackground(model: AnyModelDefinition, value: unknown): Result<BackgroundStrategy> {
  if (typeof value !== 'string') {
    return fail('missing-field', 'background is required', 'background');
  }
  if (!BACKGROUND_STRATEGIES.includes(value as BackgroundStrategy)) {
    return fail('unsupported-background', `unknown background ${JSON.stringify(value)}`, 'background');
  }
  if (!model.backgrounds.includes(value as BackgroundStrategy)) {
    return fail('unsupported-background', `background ${value} is not supported by ${model.id}`, 'background');
  }
  return ok(value as BackgroundStrategy);
}

/** 严格解码 v2 快照：未知 version/渠道/模型/字段一律拒绝，缺失字段不补默认值。 */
export function decodeV2Snapshot(snapshot: unknown): Result<DecodedSelection> {
  if (!isPlainObject(snapshot)) {
    return fail('malformed', 'snapshot must be an object');
  }
  if (snapshot.version !== SELECTION_VERSION) {
    return fail('unsupported-version', `unsupported snapshot version ${JSON.stringify(snapshot.version)}`, 'version');
  }
  for (const key of Object.keys(snapshot)) {
    if (!V2_ROOT_KEYS.has(key)) {
      return fail('unknown-field', `unknown snapshot field ${JSON.stringify(key)}`, key);
    }
  }
  if (typeof snapshot.providerId !== 'string') {
    return fail('missing-field', 'providerId is required', 'providerId');
  }
  const model = resolveModel(snapshot.providerId, snapshot.modelId);
  if (!model.ok) {
    return model;
  }
  if (snapshot.options === undefined) {
    return fail('missing-field', 'options is required', 'options');
  }
  const options = validateFieldValues(model.value.fields, snapshot.options, 'snapshot');
  if (!options.ok) {
    return options;
  }
  const background = checkBackground(model.value, snapshot.background);
  if (!background.ok) {
    return background;
  }
  return ok({
    selection: bindSelection(snapshot.providerId, model.value.id, options.value, background.value),
    format: 'v2',
    providerSource: 'recorded',
  });
}

/**
 * 解码无版本的旧快照（`{ model, aspectRatio?, imageSize?, removeBackground }`）。
 * 渠道由调用方显式传入，解码结果标记为 resolved-from-current-config。
 */
export function decodeLegacySnapshot(snapshot: unknown, context: LegacyDecodeContext): Result<DecodedSelection> {
  if (!isLegacyProviderId(context.legacyProviderId)) {
    return fail(
      'unknown-provider',
      `unknown legacy provider ${JSON.stringify(context.legacyProviderId)}`,
      'providerId',
    );
  }
  if (!isPlainObject(snapshot)) {
    return fail('malformed', 'snapshot must be an object');
  }
  if ('version' in snapshot) {
    return fail('unsupported-version', 'versioned snapshots must be decoded as v2', 'version');
  }
  for (const key of Object.keys(snapshot)) {
    if (!LEGACY_ROOT_KEYS.has(key)) {
      return fail('unknown-field', `unknown legacy option ${JSON.stringify(key)}`, key);
    }
  }
  const model = resolveModel(context.legacyProviderId, snapshot.model);
  if (!model.ok) {
    return model;
  }
  // 旧写入端已经丢弃了 auto，但更早的快照可能留有字面量；这是 legacy 专属的容忍，v2 不接受。
  const rawOptions: Record<string, unknown> = {};
  for (const key of ['aspectRatio', 'imageSize'] as const) {
    const value = snapshot[key];
    if (value !== undefined && value !== AUTO) {
      rawOptions[key] = value;
    }
  }
  const options = validateFieldValues(model.value.fields, rawOptions, 'snapshot');
  if (!options.ok) {
    return options;
  }
  if (typeof snapshot.removeBackground !== 'boolean') {
    // 旧任务没记录背景处理就无法还原：不能用「当前默认值」倒推当时的行为。
    return fail('missing-field', 'removeBackground is required in a legacy snapshot', 'removeBackground');
  }
  const background = LEGACY_BACKGROUND[snapshot.removeBackground ? 'true' : 'false'];
  const checked = checkBackground(model.value, background);
  if (!checked.ok) {
    return checked;
  }
  return ok({
    selection: bindSelection(context.legacyProviderId, model.value.id, options.value, checked.value),
    format: 'legacy',
    providerSource: 'resolved-from-current-config',
  });
}

/** 按快照里有没有 version 分派到 v2 / legacy 解码。 */
export function decodeSelectionSnapshot(snapshot: unknown, context: LegacyDecodeContext): Result<DecodedSelection> {
  if (!isPlainObject(snapshot)) {
    return fail('malformed', 'snapshot must be an object');
  }
  return 'version' in snapshot ? decodeV2Snapshot(snapshot) : decodeLegacySnapshot(snapshot, context);
}

/** 落库形状：键顺序按字段定义固定，方便快照比对与人读 diff。 */
export function serializeSelection(selection: GenerationSelection): Record<string, unknown> {
  const model = getModelDefinition(selection.providerId, selection.modelId);
  const source = selection.options as Record<string, unknown>;
  const options: Record<string, unknown> = {};
  const names = model ? model.fields.map((field) => field.name) : Object.keys(source);
  for (const name of names) {
    if (source[name] !== undefined) {
      options[name] = source[name];
    }
  }
  return {
    version: selection.version,
    providerId: selection.providerId,
    modelId: selection.modelId,
    options,
    background: selection.background,
  };
}

/** 结构比较：复用/重试判断「是否改过配置」时用，不能再靠顶层浅比较。 */
export function selectionsEqual(a: GenerationSelection, b: GenerationSelection): boolean {
  if (a.providerId !== b.providerId || a.modelId !== b.modelId || a.background !== b.background) {
    return false;
  }
  const left = a.options as Record<string, unknown>;
  const right = b.options as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }
  return true;
}
