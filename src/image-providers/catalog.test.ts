import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getModelDefinition,
  getProviderDefinition,
  IMAGE_PROVIDERS,
  isImageProviderId,
  isLegacyProviderId,
  LEGACY_PROVIDER_IDS,
} from './catalog';
import { BACKGROUND_STRATEGIES } from './contracts';

describe('image provider catalog', () => {
  test('registers four channels with unique ids', () => {
    expect(IMAGE_PROVIDERS.map((provider) => provider.id)).toEqual(['google', 'ai-gateway', 'openai', 'openrouter']);
    expect(isImageProviderId('google')).toBe(true);
    expect(isImageProviderId('openai')).toBe(true);
    expect(getProviderDefinition('nope')).toBeUndefined();
  });

  test('every model declares a consistent background policy and unique field names', () => {
    for (const provider of IMAGE_PROVIDERS) {
      expect(provider.models.length).toBeGreaterThan(0);
      expect(provider.requiredEnv.length).toBeGreaterThan(0);
      for (const model of provider.models) {
        expect(model.backgrounds.length).toBeGreaterThan(0);
        expect(model.backgrounds).toContain(model.defaultBackground);
        for (const background of model.backgrounds) {
          expect(BACKGROUND_STRATEGIES).toContain(background);
        }
        const names = model.fields.map((field) => field.name);
        expect(new Set(names).size).toBe(names.length);
      }
    }
  });

  test('keeps the same model id isolated per channel', () => {
    const direct = getModelDefinition('google', 'gemini-3-pro-image');
    const gateway = getModelDefinition('ai-gateway', 'gemini-3-pro-image');
    expect(direct).toBeDefined();
    expect(gateway).toBeDefined();
    // 同一份对象会让某一侧收紧能力时意外污染另一侧。
    expect(direct).not.toBe(gateway);
    expect(getModelDefinition('google', 'gpt-image-2.5')).toBeUndefined();
  });

  test('legacy channels are a subset of the registered ones', () => {
    for (const providerId of LEGACY_PROVIDER_IDS) {
      expect(getProviderDefinition(providerId)).toBeDefined();
    }
    expect(isLegacyProviderId('openrouter')).toBe(false);
  });

  test('gemini models keep magenta keying and never claim native transparency', () => {
    for (const providerId of ['google', 'ai-gateway']) {
      const model = getModelDefinition(providerId, 'gemini-3-pro-image');
      expect(model?.defaultBackground).toBe('magenta-key');
      expect(model?.backgrounds).not.toContain('native-transparent');
    }
  });

  test('the shared layer stays bundleable by the web app', () => {
    const dir = import.meta.dir;
    const files = [
      ...readdirSync(dir)
        .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
        .map((name) => join(dir, name)),
      ...readdirSync(join(dir, 'definitions')).map((name) => join(dir, 'definitions', name)),
    ];
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      // 前端直接打包这些模块：不得引入 node 内建、SDK 或读取环境配置的模块。
      expect(source).not.toMatch(/from '(node:|sharp|ai|@ai-sdk|drizzle)/);
      expect(source).not.toMatch(/process\.env/);
      expect(source).not.toMatch(/from '\.\.\/config'/);
    }
  });
});
