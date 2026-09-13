import { expect, test } from 'bun:test';
import { normalizeSelectionInput } from './normalize';
import { switchSelection } from './switch';

function initial(providerId = 'google') {
  const parsed = normalizeSelectionInput({
    providerId,
    modelId: 'gemini-3-pro-image',
    options: { aspectRatio: '16:9', imageSize: '4K' },
    background: 'original',
  });
  if (!parsed.ok) {
    throw new Error('fixture');
  }
  return parsed.value;
}
test('same-channel model switch retains valid explicit options and disabled background', () => {
  const current = initial();
  const next = switchSelection(current, 'google', 'gemini-3.1-flash-image-preview');
  expect(next.selection.options).toEqual(current.options);
  expect(next.selection.background).toBe('original');
  expect(next.cleared).toEqual([]);
});
test('OpenRouter model switch prunes only unsupported fields', () => {
  const next = switchSelection(initial('openrouter'), 'openrouter', 'gpt-image-2.5-flare');
  expect(next.selection.options).toEqual({ aspectRatio: '16:9' });
  expect(next.selection.background).toBe('original');
  expect(next.cleared).toEqual(['imageSize']);
});
test('channel switch resets even identically named fields and background', () => {
  const next = switchSelection(initial(), 'openrouter', 'gemini-3-pro-image');
  expect(next.selection.options).toEqual({});
  expect(next.selection.background).toBe('magenta-key');
  expect(next.cleared).toEqual(['aspectRatio', 'imageSize', 'background']);
});
