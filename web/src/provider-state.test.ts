import { expect, test } from 'bun:test';
import { switchSelection } from '../../src/image-providers/switch';
import { applyCount, newOptions, useDraft } from './api';

test('count-only dialog apply cannot write its old provider selection over current draft', () => {
  const original = useDraft.getState();
  try {
    const opening = newOptions('google');
    useDraft.setState({ prompt: 'keep prompt', referencedAssetIds: ['keep-ref'], options: opening });
    const next = switchSelection(opening.selection, 'openai');
    useDraft.getState().set({ options: { selection: next.selection, count: 3 } });
    const applied = applyCount(useDraft.getState().options, 4);
    useDraft.getState().set({ options: applied });
    expect(useDraft.getState().options.selection.providerId).toBe('openai');
    expect(useDraft.getState().options.count).toBe(4);
    expect(useDraft.getState().prompt).toBe('keep prompt');
    expect(useDraft.getState().referencedAssetIds).toEqual(['keep-ref']);
    expect(() => applyCount(applied, Number.NaN)).toThrow();
    expect(() => applyCount(applied, 1.5)).toThrow();
  } finally {
    useDraft.setState(original);
  }
});
