import { describe, expect, test } from 'bun:test';
import type { GenerationSelection } from './catalog';
import { AUTO, type Result } from './contracts';
import {
  type DecodedSelection,
  decodeLegacySnapshot,
  decodeSelectionSnapshot,
  decodeV2Snapshot,
  selectionsEqual,
  serializeSelection,
} from './decode';
import { normalizeSelectionInput } from './normalize';

const v2Snapshot = {
  version: 2,
  providerId: 'google',
  modelId: 'gemini-3-pro-image',
  options: { aspectRatio: '16:9' },
  background: 'magenta-key',
};

function expectOk<T>(result: Result<T>): T {
  if (!result.ok) {
    throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

function expectError(result: Result<DecodedSelection>) {
  if (result.ok) {
    throw new Error('expected a decode error');
  }
  return result.error;
}

describe('v2 snapshot decoding', () => {
  test('decodes a recorded channel without touching application defaults', () => {
    const decoded = expectOk(decodeV2Snapshot(v2Snapshot));
    expect(decoded.format).toBe('v2');
    expect(decoded.providerSource).toBe('recorded');
    expect(decoded.selection).toEqual({
      version: 2,
      providerId: 'google',
      modelId: 'gemini-3-pro-image',
      options: { aspectRatio: '16:9' },
      background: 'magenta-key',
    } as GenerationSelection);
  });

  test('keeps an empty options object empty instead of re-filling current defaults', () => {
    const decoded = expectOk(decodeV2Snapshot({ ...v2Snapshot, options: {} }));
    expect(decoded.selection.options).toEqual({});
  });

  test('rejects unknown or missing versions', () => {
    expect(expectError(decodeV2Snapshot({ ...v2Snapshot, version: 3 })).code).toBe('unsupported-version');
    expect(expectError(decodeV2Snapshot({ ...v2Snapshot, version: '2' })).code).toBe('unsupported-version');
    const { version: _version, ...withoutVersion } = v2Snapshot;
    expect(expectError(decodeV2Snapshot(withoutVersion)).code).toBe('unsupported-version');
    expect(expectError(decodeV2Snapshot(null)).code).toBe('malformed');
  });

  test('rejects unknown channels, models and root fields', () => {
    expect(expectError(decodeV2Snapshot({ ...v2Snapshot, providerId: 'unregistered' })).code).toBe('unknown-provider');
    expect(expectError(decodeV2Snapshot({ ...v2Snapshot, modelId: 'gemini-9' })).code).toBe('unknown-model');
    expect(expectError(decodeV2Snapshot({ ...v2Snapshot, count: 4 })).code).toBe('unknown-field');
  });

  test('rejects unknown option keys, invalid values and the auto literal', () => {
    expect(expectError(decodeV2Snapshot({ ...v2Snapshot, options: { quality: 'high' } })).code).toBe('unknown-field');
    expect(expectError(decodeV2Snapshot({ ...v2Snapshot, options: { aspectRatio: '21:9' } })).code).toBe(
      'invalid-field',
    );
    // 快照里永远不该出现 'auto'：它的语义是「这个键不存在」。
    expect(expectError(decodeV2Snapshot({ ...v2Snapshot, options: { imageSize: AUTO } })).code).toBe('invalid-field');
    const { options: _options, ...withoutOptions } = v2Snapshot;
    expect(expectError(decodeV2Snapshot(withoutOptions)).code).toBe('missing-field');
  });

  test('rejects backgrounds the model does not support and never defaults a missing one', () => {
    expect(expectError(decodeV2Snapshot({ ...v2Snapshot, background: 'native-transparent' })).code).toBe(
      'unsupported-background',
    );
    expect(expectError(decodeV2Snapshot({ ...v2Snapshot, background: 'blur' })).code).toBe('unsupported-background');
    const { background: _background, ...withoutBackground } = v2Snapshot;
    expect(expectError(decodeV2Snapshot(withoutBackground)).code).toBe('missing-field');
  });
});

describe('legacy snapshot decoding', () => {
  const legacy = { model: 'gemini-3-pro-image', aspectRatio: '4:3', removeBackground: true };

  test('uses the caller-supplied channel and marks it as resolved, not historical', () => {
    const direct = expectOk(decodeLegacySnapshot(legacy, { legacyProviderId: 'google' }));
    const gateway = expectOk(decodeLegacySnapshot(legacy, { legacyProviderId: 'ai-gateway' }));
    expect(direct.selection.providerId).toBe('google');
    expect(gateway.selection.providerId).toBe('ai-gateway');
    expect(direct.format).toBe('legacy');
    expect(direct.providerSource).toBe('resolved-from-current-config');
    expect(direct.selection.options).toEqual({ aspectRatio: '4:3' });
  });

  test('translates removeBackground into a fixed background strategy', () => {
    expect(expectOk(decodeLegacySnapshot(legacy, { legacyProviderId: 'google' })).selection.background).toBe(
      'magenta-key',
    );
    expect(
      expectOk(decodeLegacySnapshot({ ...legacy, removeBackground: false }, { legacyProviderId: 'google' })).selection
        .background,
    ).toBe('original');
  });

  test('refuses to guess a background the old snapshot never recorded', () => {
    const { removeBackground: _removeBackground, ...withoutBackground } = legacy;
    const error = expectError(decodeLegacySnapshot(withoutBackground, { legacyProviderId: 'google' }));
    expect(error.code).toBe('missing-field');
    expect(error.path).toBe('removeBackground');
  });

  test('tolerates the legacy auto literal but still rejects unknown keys and models', () => {
    const decoded = expectOk(
      decodeLegacySnapshot(
        { model: 'gemini-3.1-flash-image-preview', aspectRatio: AUTO, imageSize: AUTO, removeBackground: true },
        { legacyProviderId: 'google' },
      ),
    );
    expect(decoded.selection.options).toEqual({});
    expect(
      expectError(decodeLegacySnapshot({ ...legacy, provider: 'google' }, { legacyProviderId: 'google' })).code,
    ).toBe('unknown-field');
    // 下线模型必须明确失败，不能静默换成默认模型。
    expect(
      expectError(decodeLegacySnapshot({ ...legacy, model: 'gemini-1' }, { legacyProviderId: 'google' })).code,
    ).toBe('unknown-model');
  });

  test('refuses versioned snapshots and unknown legacy channels', () => {
    expect(expectError(decodeLegacySnapshot(v2Snapshot, { legacyProviderId: 'google' })).code).toBe(
      'unsupported-version',
    );
    expect(
      expectError(decodeLegacySnapshot(legacy, { legacyProviderId: 'openrouter' as unknown as 'google' })).code,
    ).toBe('unknown-provider');
  });
});

describe('snapshot dispatch, serialization and comparison', () => {
  test('routes on the presence of a version field', () => {
    expect(expectOk(decodeSelectionSnapshot(v2Snapshot, { legacyProviderId: 'ai-gateway' })).providerSource).toBe(
      'recorded',
    );
    const legacy = expectOk(
      decodeSelectionSnapshot(
        { model: 'gemini-3-pro-image', removeBackground: false },
        { legacyProviderId: 'ai-gateway' },
      ),
    );
    expect(legacy.selection.providerId).toBe('ai-gateway');
    expect(expectError(decodeSelectionSnapshot('nope', { legacyProviderId: 'google' })).code).toBe('malformed');
  });

  test('round-trips a normalized selection through JSON with a stable key order', () => {
    const selection = expectOk(
      normalizeSelectionInput({
        providerId: 'google',
        modelId: 'gemini-3-pro-image',
        options: { imageSize: '2K', aspectRatio: '16:9' },
      }),
    );
    const serialized = serializeSelection(selection);
    expect(Object.keys(serialized)).toEqual(['version', 'providerId', 'modelId', 'options', 'background']);
    expect(Object.keys(serialized.options as Record<string, unknown>)).toEqual(['aspectRatio', 'imageSize']);
    const decoded = expectOk(decodeV2Snapshot(JSON.parse(JSON.stringify(serialized))));
    expect(decoded.selection).toEqual(selection);
  });

  test('compares selections structurally', () => {
    const base = expectOk(decodeV2Snapshot(v2Snapshot)).selection;
    const same = expectOk(decodeV2Snapshot({ ...v2Snapshot })).selection;
    const otherChannel = expectOk(decodeV2Snapshot({ ...v2Snapshot, providerId: 'ai-gateway' })).selection;
    const otherOptions = expectOk(decodeV2Snapshot({ ...v2Snapshot, options: {} })).selection;
    expect(selectionsEqual(base, same)).toBe(true);
    expect(selectionsEqual(base, otherChannel)).toBe(false);
    expect(selectionsEqual(base, otherOptions)).toBe(false);
  });
});
