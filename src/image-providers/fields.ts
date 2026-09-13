/**
 * 有限字段定义的校验与归一化。跨端纯模块（见 contracts.ts 的边界说明）。
 *
 * 两种模式刻意分开，正是路线三定案的要求：
 * - 'input'    新任务输入：接受 AUTO/缺省，为非 optional 字段注入定义里的默认值；
 * - 'snapshot' 读取已落库的 v2 配置：**不注入任何默认值**，也不接受 AUTO 字面量，
 *              否则以后改默认值会把旧任务解读成另一次生成。
 */

import { AUTO, fail, isPlainObject, type OptionField, ok, type Result, type SelectionErrorCode } from './contracts';

export type OptionsMode = 'input' | 'snapshot';

function invalid(path: string, message: string, code: SelectionErrorCode = 'invalid-field'): Result<never> {
  return fail(code, message, path);
}

function validateValue(field: OptionField, value: unknown, path: string): Result<unknown> {
  switch (field.kind) {
    case 'select': {
      if (typeof value !== 'string') {
        return invalid(path, `${field.name} must be a string`);
      }
      if (!field.choices.some((choice) => choice.value === value)) {
        return invalid(path, `${field.name} does not accept ${JSON.stringify(value)}`);
      }
      return ok(value);
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        return invalid(path, `${field.name} must be a boolean`);
      }
      return ok(value);
    }
    case 'number': {
      // 不接受字符串数字：边界层负责解析，内层只接受已解析的有限数值。
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return invalid(path, `${field.name} must be a finite number`);
      }
      if (field.integer && !Number.isInteger(value)) {
        return invalid(path, `${field.name} must be an integer`);
      }
      if (value < field.min || value > field.max) {
        return invalid(path, `${field.name} must be between ${field.min} and ${field.max}`);
      }
      return ok(value);
    }
    case 'text': {
      if (typeof value !== 'string') {
        return invalid(path, `${field.name} must be a string`);
      }
      if (value.length > field.maxLength) {
        return invalid(path, `${field.name} must be at most ${field.maxLength} characters`);
      }
      if (!new RegExp(`^(?:${field.pattern})$`).test(value)) {
        return invalid(path, `${field.name} does not match the accepted format`);
      }
      return ok(value);
    }
  }
}

/**
 * 校验一个渠道+模型的完整 options 对象。
 * 未知键一律拒绝：不知道的选项不能被静默丢弃后原样 spread 给上游。
 */
export function validateFieldValues(
  fields: readonly OptionField[],
  raw: unknown,
  mode: OptionsMode,
  basePath = 'options',
): Result<Record<string, unknown>> {
  if (!isPlainObject(raw)) {
    return fail('malformed', 'options must be an object', basePath);
  }
  const known = new Set(fields.map((field) => field.name));
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      return fail('unknown-field', `unknown option ${JSON.stringify(key)}`, `${basePath}.${key}`);
    }
  }
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const path = `${basePath}.${field.name}`;
    const value = raw[field.name];
    const omitted = value === undefined || (mode === 'input' && value === AUTO && field.optional === true);
    if (omitted) {
      if (field.optional === true) {
        continue; // 缺省 = 委托上游选择，快照里不写这个键
      }
      if (mode === 'input' && field.defaultValue !== undefined) {
        result[field.name] = field.defaultValue;
        continue;
      }
      return fail('missing-field', `${field.name} is required`, path);
    }
    const checked = validateValue(field, value, path);
    if (!checked.ok) {
      return checked;
    }
    result[field.name] = checked.value;
  }
  return ok(result);
}

/** 建任务时的默认 options：只包含非 optional 且有默认值的字段。 */
export function defaultFieldValues(fields: readonly OptionField[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.optional !== true && field.defaultValue !== undefined) {
      result[field.name] = field.defaultValue;
    }
  }
  return result;
}
