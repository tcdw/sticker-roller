import { describe, expect, test } from 'bun:test';
import {
  AUTO,
  buildProviderImageConfig,
  getModelCapabilities,
  resolveAspectRatio,
  resolveImageSize,
} from './image-options';

describe('image model capabilities', () => {
  test('resolves supported values and falls back to auto after a model change', () => {
    expect(resolveAspectRatio('gemini-3-pro-image', '16:9')).toBe('16:9');
    expect(resolveImageSize('gemini-3-pro-image', '2K')).toBe('2K');
    expect(resolveAspectRatio('unknown-model', '16:9')).toBe(AUTO);
    expect(resolveImageSize('unknown-model', '2K')).toBe(AUTO);
  });

  test('keeps capabilities isolated per model', () => {
    const pro = getModelCapabilities('gemini-3-pro-image');
    const flash = getModelCapabilities('gemini-3.1-flash-image-preview');

    expect(pro.aspectRatios).toEqual(['1:1', '16:9', '9:16', '4:3', '3:4']);
    expect(flash.imageSizes).toEqual(['1K', '2K', '4K']);
    expect(getModelCapabilities('unknown-model')).toEqual({ aspectRatios: [], imageSizes: [] });
  });

  test('omits automatic provider fields but preserves explicit selections', () => {
    expect(buildProviderImageConfig({ aspectRatio: AUTO, imageSize: AUTO })).toEqual({});
    expect(buildProviderImageConfig({ aspectRatio: '16:9', imageSize: AUTO })).toEqual({ aspectRatio: '16:9' });
    expect(buildProviderImageConfig({ aspectRatio: AUTO, imageSize: '2K' })).toEqual({ imageSize: '2K' });
  });
});
