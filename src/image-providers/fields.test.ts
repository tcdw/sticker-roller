import { describe, expect, test } from 'bun:test';
import { AUTO, type OptionField } from './contracts';
import { defaultFieldValues, validateFieldValues } from './fields';

/** 本地夹具：覆盖四种字段类型，不往正式注册表里塞假渠道。 */
const fields: OptionField[] = [
  {
    kind: 'select',
    name: 'quality',
    label: 'Quality',
    group: 'basic',
    choices: [
      { value: 'low', label: 'Low' },
      { value: 'high', label: 'High' },
    ],
    defaultValue: 'low',
  },
  { kind: 'boolean', name: 'transparent', label: 'Transparent', group: 'advanced', defaultValue: false },
  { kind: 'number', name: 'steps', label: 'Steps', group: 'advanced', min: 1, max: 8, integer: true, defaultValue: 4 },
  {
    kind: 'text',
    name: 'size',
    label: 'Size',
    group: 'basic',
    pattern: '\\d{3,4}x\\d{3,4}',
    maxLength: 9,
    optional: true,
  },
];

function expectError(result: ReturnType<typeof validateFieldValues>) {
  if (result.ok) {
    throw new Error('expected a validation error');
  }
  return result.error;
}

describe('option field validation', () => {
  test('accepts values of every supported field kind', () => {
    const result = validateFieldValues(
      fields,
      { quality: 'high', transparent: true, steps: 8, size: '1024x1536' },
      'snapshot',
    );
    expect(result).toEqual({
      ok: true,
      value: { quality: 'high', transparent: true, steps: 8, size: '1024x1536' },
    });
  });

  test('rejects unknown options instead of dropping them', () => {
    const error = expectError(validateFieldValues(fields, { quality: 'high', sharpen: true }, 'input'));
    expect(error.code).toBe('unknown-field');
    expect(error.path).toBe('options.sharpen');
  });

  test('rejects wrong types, out-of-range numbers and malformed text', () => {
    expect(expectError(validateFieldValues(fields, { quality: 'ultra' }, 'input')).code).toBe('invalid-field');
    expect(expectError(validateFieldValues(fields, { transparent: 'true' }, 'input')).code).toBe('invalid-field');
    expect(expectError(validateFieldValues(fields, { steps: 4.5 }, 'input')).code).toBe('invalid-field');
    expect(expectError(validateFieldValues(fields, { steps: 9 }, 'input')).code).toBe('invalid-field');
    expect(expectError(validateFieldValues(fields, { steps: '4' }, 'input')).code).toBe('invalid-field');
    expect(expectError(validateFieldValues(fields, { steps: Number.NaN }, 'input')).code).toBe('invalid-field');
    expect(expectError(validateFieldValues(fields, { size: '12x12' }, 'input')).code).toBe('invalid-field');
    expect(expectError(validateFieldValues(fields, [], 'input')).code).toBe('malformed');
  });

  test('input mode applies definition defaults and drops auto for optional fields', () => {
    const result = validateFieldValues(fields, { size: AUTO }, 'input');
    expect(result).toEqual({ ok: true, value: { quality: 'low', transparent: false, steps: 4 } });
  });

  test('snapshot mode never injects defaults and never accepts the auto literal', () => {
    const missing = expectError(validateFieldValues(fields, { transparent: true, steps: 4 }, 'snapshot'));
    expect(missing.code).toBe('missing-field');
    expect(missing.path).toBe('options.quality');
    const auto = expectError(
      validateFieldValues(fields, { quality: 'low', transparent: false, steps: 4, size: AUTO }, 'snapshot'),
    );
    expect(auto.code).toBe('invalid-field');
    expect(auto.path).toBe('options.size');
  });

  test('auto is not a way to skip a required field', () => {
    expect(expectError(validateFieldValues(fields, { quality: AUTO }, 'input')).code).toBe('invalid-field');
  });

  test('default values cover required fields only', () => {
    expect(defaultFieldValues(fields)).toEqual({ quality: 'low', transparent: false, steps: 4 });
  });
});
