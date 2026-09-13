import { describe, expect, test } from 'bun:test';
import type { GenerationSelection } from './catalog';
import { AUTO, type Result } from './contracts';
import { normalizeSelectionInput } from './normalize';

function expectOk(result: Result<GenerationSelection>): GenerationSelection {
  if (!result.ok) {
    throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

function expectError(result: Result<GenerationSelection>) {
  if (result.ok) {
    throw new Error('expected a validation error');
  }
  return result.error;
}

describe('new task selection normalization', () => {
  test('fills the model default background and keeps omitted options omitted', () => {
    const selection = expectOk(normalizeSelectionInput({ providerId: 'google', modelId: 'gemini-3-pro-image' }));
    expect(selection).toEqual({
      version: 2,
      providerId: 'google',
      modelId: 'gemini-3-pro-image',
      options: {},
      background: 'magenta-key',
    } as GenerationSelection);
  });

  test('treats auto as "let the provider choose" and never stores the literal', () => {
    const selection = expectOk(
      normalizeSelectionInput({
        providerId: 'ai-gateway',
        modelId: 'gemini-3.1-flash-image-preview',
        options: { aspectRatio: AUTO, imageSize: '4K' },
        background: 'original',
      }),
    );
    expect(selection.options).toEqual({ imageSize: '4K' });
    expect(selection.background).toBe('original');
  });

  test('requires an explicit channel and a model that belongs to it', () => {
    expect(expectError(normalizeSelectionInput({ providerId: undefined, modelId: 'gemini-3-pro-image' })).code).toBe(
      'unknown-provider',
    );
    expect(expectError(normalizeSelectionInput({ providerId: 'unregistered', modelId: 'gpt-image-2.5' })).code).toBe(
      'unknown-provider',
    );
    expect(expectError(normalizeSelectionInput({ providerId: 'google', modelId: 'gpt-image-2.5' })).code).toBe(
      'unknown-model',
    );
    expect(expectError(normalizeSelectionInput({ providerId: 'google', modelId: 42 })).code).toBe('missing-field');
  });

  test('rejects unknown and invalid options instead of forwarding them upstream', () => {
    expect(
      expectError(
        normalizeSelectionInput({ providerId: 'google', modelId: 'gemini-3-pro-image', options: { quality: 'high' } }),
      ).code,
    ).toBe('unknown-field');
    expect(
      expectError(
        normalizeSelectionInput({ providerId: 'google', modelId: 'gemini-3-pro-image', options: { imageSize: '8K' } }),
      ).code,
    ).toBe('invalid-field');
    expect(
      expectError(
        normalizeSelectionInput({ providerId: 'google', modelId: 'gemini-3-pro-image', options: 'aspectRatio=1:1' }),
      ).code,
    ).toBe('malformed');
  });

  test('rejects a background the model cannot do rather than silently keying it', () => {
    expect(
      expectError(
        normalizeSelectionInput({
          providerId: 'google',
          modelId: 'gemini-3-pro-image',
          background: 'native-transparent',
        }),
      ).code,
    ).toBe('unsupported-background');
    expect(
      expectError(
        normalizeSelectionInput({ providerId: 'google', modelId: 'gemini-3-pro-image', background: 'remove' }),
      ).code,
    ).toBe('unsupported-background');
  });

  test('does not let one channel inherit another channel choice', () => {
    const direct = expectOk(
      normalizeSelectionInput({ providerId: 'google', modelId: 'gemini-3-pro-image', options: { imageSize: '4K' } }),
    );
    const gateway = expectOk(
      normalizeSelectionInput({
        providerId: 'ai-gateway',
        modelId: 'gemini-3-pro-image',
        options: { imageSize: '4K' },
      }),
    );
    expect(direct.providerId).toBe('google');
    expect(gateway.providerId).toBe('ai-gateway');
    expect(direct.options).toEqual(gateway.options);
  });
});
