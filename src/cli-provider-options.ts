import { InputError } from './errors';
import { getModelDefinition, getProviderDefinition } from './image-providers/catalog';

export function parseProviderOptions(
  providerId: string,
  modelId: string | undefined,
  entries: readonly string[],
): Record<string, unknown> {
  const model = getModelDefinition(providerId, modelId ?? getProviderDefinition(providerId)?.models[0]?.id ?? '');
  if (!model) {
    throw new InputError('invalid provider or model');
  }
  const result: Record<string, unknown> = {};
  for (const entry of entries) {
    const index = entry.indexOf('=');
    if (index < 1) {
      throw new InputError('--option requires name=value');
    }
    const name = entry.slice(0, index);
    const value = entry.slice(index + 1);
    if (Object.hasOwn(result, name)) {
      throw new InputError('duplicate option key');
    }
    const field = model.fields.find((candidate) => candidate.name === name);
    if (!field) {
      throw new InputError('unknown option for model');
    }
    if (field.kind === 'boolean') {
      if (value !== 'true' && value !== 'false') {
        throw new InputError('boolean option requires true or false');
      }
      result[name] = value === 'true';
    } else if (field.kind === 'number') {
      if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) {
        throw new InputError('invalid numeric option');
      }
      result[name] = Number(value);
    } else {
      result[name] = value;
    }
  }
  return result;
}
