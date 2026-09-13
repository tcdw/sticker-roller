/**
 * 新任务输入的归一化：和快照解码（decode.ts）职责刻意分开。
 *
 * 这里——也只有这里——会注入应用默认值：建任务时把默认值固定进快照，
 * 之后改默认值不影响已存在的任务。读取旧任务永远走 decode.ts。
 */

import { bindSelection, type GenerationSelection, getModelDefinition, getProviderDefinition } from './catalog';
import { BACKGROUND_STRATEGIES, type BackgroundStrategy, fail, ok, type Result } from './contracts';
import { validateFieldValues } from './fields';

export interface SelectionInput {
  /** 渠道必须由调用方明确给出：旧扁平参数的「按 env 选渠道」优先级属于边界层（阶段三），不在纯模块里。 */
  readonly providerId: unknown;
  readonly modelId: unknown;
  /** 未知键、错误类型、非法组合一律拒绝，不会原样 spread 给上游。 */
  readonly options?: unknown;
  /** 省略时使用该模型的默认背景策略。 */
  readonly background?: unknown;
}

export function normalizeSelectionInput(input: SelectionInput): Result<GenerationSelection> {
  if (typeof input.providerId !== 'string' || !getProviderDefinition(input.providerId)) {
    return fail('unknown-provider', `unknown provider ${JSON.stringify(input.providerId)}`, 'providerId');
  }
  if (typeof input.modelId !== 'string') {
    return fail('missing-field', 'modelId is required', 'modelId');
  }
  const model = getModelDefinition(input.providerId, input.modelId);
  if (!model) {
    return fail(
      'unknown-model',
      `unknown model ${JSON.stringify(input.modelId)} for provider ${input.providerId}`,
      'modelId',
    );
  }
  const options = validateFieldValues(model.fields, input.options === undefined ? {} : input.options, 'input');
  if (!options.ok) {
    return options;
  }
  let background: BackgroundStrategy;
  if (input.background === undefined) {
    background = model.defaultBackground;
  } else {
    if (
      typeof input.background !== 'string' ||
      !BACKGROUND_STRATEGIES.includes(input.background as BackgroundStrategy)
    ) {
      return fail('unsupported-background', `unknown background ${JSON.stringify(input.background)}`, 'background');
    }
    background = input.background as BackgroundStrategy;
    if (!model.backgrounds.includes(background)) {
      // 能力不支持就拒绝，不偷偷换模型、也不退回本地抠底。
      return fail('unsupported-background', `background ${background} is not supported by ${model.id}`, 'background');
    }
  }
  return ok(bindSelection(input.providerId, model.id, options.value, background));
}
