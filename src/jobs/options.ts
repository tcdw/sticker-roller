import { ConfigError, InputError } from '../errors';
import {
  decodeV2Snapshot,
  type GenerationSelection,
  normalizeSelectionInput,
  serializeSelection,
} from '../image-providers';
import { getProviderDefinition } from '../image-providers/catalog';
import type { ProviderEnv } from '../image-providers/server/contracts';
import { providerConfigState, resolveLegacyProviderId } from '../image-providers/server/env';

export const MAX_PROMPT = 10000;
export const MAX_COUNT = 20;

/** Both transports use this conversion; legacy aliases never leak into v2 snapshots. */
export function normalizeJobSelection(input: Record<string, unknown>, env: ProviderEnv): GenerationSelection {
  if (input.version !== undefined) {
    throw new InputError('version is only supported inside selection');
  }
  if (input.selection !== undefined) {
    for (const name of [
      'provider',
      'providerId',
      'model',
      'modelId',
      'options',
      'aspectRatio',
      'imageSize',
      'removeBackground',
      'background',
    ]) {
      if (input[name] !== undefined) {
        throw new InputError('selection cannot be combined with generation aliases');
      }
    }
    const decoded = decodeV2Snapshot(input.selection);
    if (!decoded.ok) {
      throw new InputError(
        `invalid generation selection: ${decoded.error.code} at ${decoded.error.path ?? 'selection'}`,
      );
    }
    return decoded.value.selection;
  }
  if (input.providerId !== undefined && input.provider !== undefined) {
    throw new InputError('provider aliases cannot be combined');
  }
  const providerId =
    input.providerId !== undefined
      ? input.providerId
      : input.provider !== undefined
        ? input.provider
        : resolveLegacyProviderId(env);
  if (typeof providerId !== 'string') {
    throw new InputError('invalid provider');
  }
  const provider = getProviderDefinition(providerId);
  if (!provider) {
    throw new InputError('invalid provider');
  }
  if (input.model !== undefined && input.modelId !== undefined) {
    throw new InputError('model aliases cannot be combined');
  }
  const modelId =
    input.modelId !== undefined ? input.modelId : input.model !== undefined ? input.model : provider.models[0]?.id;
  const raw = input.options === undefined ? {} : input.options;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new InputError('options must be an object');
  }
  const options = { ...raw } as Record<string, unknown>;
  for (const key of ['aspectRatio', 'imageSize'] as const) {
    if (input[key] !== undefined) {
      if (Object.hasOwn(options, key)) {
        throw new InputError(`${key} alias conflicts with options`);
      }
      options[key] = input[key];
    }
  }
  let background = input.background;
  if (input.removeBackground !== undefined) {
    if (typeof input.removeBackground !== 'boolean') {
      throw new InputError('invalid removeBackground');
    }
    if (background !== undefined) {
      throw new InputError('background aliases cannot be combined');
    }
    background = input.removeBackground ? undefined : 'original';
  }
  const result = normalizeSelectionInput({
    providerId,
    modelId,
    options,
    ...(background === undefined ? {} : { background }),
  });
  if (!result.ok) {
    throw new InputError(`invalid generation options: ${result.error.code} at ${result.error.path ?? 'options'}`);
  }
  return result.value;
}

export function requireSelectionConfigured(selection: GenerationSelection, env: ProviderEnv): void {
  const state = providerConfigState(selection.providerId, env);
  if (!state.configured) {
    throw new ConfigError(`image provider is not configured: ${state.reason}; check ${state.missingEnv.join(', ')}`);
  }
}

export function validateOptions(
  input: Record<string, unknown>,
  env: ProviderEnv = process.env,
): Record<string, unknown> {
  return serializeSelection(normalizeJobSelection(input, env));
}

/** Called after reference expansion and again for historical jobs before any provider call. */
export function validateGenerationInput(selection: GenerationSelection, prompt: string, referenceCount: number): void {
  const limits = getProviderDefinition(selection.providerId)?.models.find(
    (model) => model.id === selection.modelId,
  )?.inputLimits;
  if (!limits) {
    throw new InputError('model input limits are unavailable');
  }
  if (referenceCount > limits.maxReferences) {
    throw new InputError(`model accepts at most ${limits.maxReferences} reference images`);
  }
  if (limits.maxPrompt !== undefined && prompt.length > limits.maxPrompt) {
    throw new InputError(`expanded prompt must be at most ${limits.maxPrompt} characters`);
  }
}
