import { afterEach, describe, expect, mock, test } from 'bun:test';
import { DEFAULT_MODEL } from '../../src/image-options';
import type { AssetRow, UploadSummary } from '../../src/web-types';
import {
  draftFromJob,
  type JobSummary,
  optionsFromSnapshot,
  referencedIdsFromPrompt,
  referencedImageIdsFromPrompt,
  saveAsset,
  unreferencedUploads,
} from './api';

const body = { name: 'demo', prompt: 'a loud sticker' };
afterEach(() => mock.restore());
describe('saveAsset', () => {
  test('creates a new asset when no asset is selected', async () => {
    const fetchMock = mock(() => Promise.resolve(Response.json({ id: 'asset-1', ...body })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await saveAsset(undefined, body);
    expect(fetchMock).toHaveBeenCalledWith('/api/assets', expect.objectContaining({ method: 'POST' }));
  });
  test('updates the selected asset with PATCH instead of creating a duplicate', async () => {
    const fetchMock = mock(() => Promise.resolve(Response.json({ id: 'asset-1', ...body })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await saveAsset('asset-1', body);
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/asset-1', expect.objectContaining({ method: 'PATCH' }));
  });
});
describe('prompt asset references', () => {
  const assets = [
    { id: 'a1', name: '同名', prompt: 'one' },
    { id: 'a2', name: '同名', prompt: 'two' },
  ] as AssetRow[];
  test('uses stable IDs and removes deleted tokens', () => {
    expect(referencedIdsFromPrompt('@[同名](asset:a2) prose', assets)).toEqual(['a2']);
    expect(referencedIdsFromPrompt('同名 prose', assets)).toEqual([]);
  });
});
describe('prompt image references', () => {
  const uploads = [
    { id: 'u1', name: '头像', mimeType: 'image/png' },
    { id: 'u2', name: '风格', mimeType: 'image/jpeg' },
  ] as UploadSummary[];
  test('extracts stable IDs and ignores unknown uploads', () => {
    expect(referencedImageIdsFromPrompt('按 ![头像](image:u1) 和 ![风格](image:u2) 画', uploads)).toEqual(['u1', 'u2']);
    expect(referencedImageIdsFromPrompt('![没了](image:missing) prose', uploads)).toEqual([]);
    expect(referencedImageIdsFromPrompt('no tokens here', uploads)).toEqual([]);
  });
});
describe('unreferencedUploads', () => {
  const uploads = [
    { id: 'u1', name: '头像', mimeType: 'image/png' },
    { id: 'u2', name: '风格', mimeType: 'image/jpeg' },
  ] as UploadSummary[];
  test('reports uploads the prompt never references', () => {
    expect(unreferencedUploads('按 ![头像](image:u1) 画', uploads).map((upload) => upload.id)).toEqual(['u2']);
    expect(unreferencedUploads('没有任何引用', uploads).map((upload) => upload.id)).toEqual(['u1', 'u2']);
    expect(unreferencedUploads('![头像](image:u1) ![风格](image:u2)', uploads)).toEqual([]);
    expect(unreferencedUploads('prose', [])).toEqual([]);
  });
});
describe('optionsFromSnapshot', () => {
  test('restores a persisted snapshot and takes the count from the job row', () => {
    const options = optionsFromSnapshot(
      { model: 'gemini-3.1-flash-image-preview', aspectRatio: '16:9', imageSize: '4K', removeBackground: false },
      3,
    );
    expect(options).toEqual({
      model: 'gemini-3.1-flash-image-preview',
      aspectRatio: '16:9',
      imageSize: '4K',
      removeBackground: false,
      count: 3,
    });
  });
  test('falls back to defaults and drops values the model cannot use', () => {
    const options = optionsFromSnapshot({ model: 'retired-model', aspectRatio: '21:9', imageSize: '8K' });
    expect(options).toEqual({
      model: DEFAULT_MODEL,
      aspectRatio: 'auto',
      imageSize: 'auto',
      removeBackground: true,
      count: 1,
    });
    // Values are validated against the model that will actually run the job.
    expect(optionsFromSnapshot({ model: 'retired-model', aspectRatio: '16:9' }).aspectRatio).toBe('16:9');
    expect(optionsFromSnapshot(undefined).model).toBe(DEFAULT_MODEL);
  });
  test('clamps counts into the supported range', () => {
    expect(optionsFromSnapshot({ count: 99 }).count).toBe(20);
    expect(optionsFromSnapshot({ count: 0 }).count).toBe(1);
    expect(optionsFromSnapshot({}, 2).count).toBe(2);
  });
});
describe('draftFromJob', () => {
  const assets = [
    { id: 'a1', name: '风格', prompt: 'one' },
    { id: 'a2', name: '另一项', prompt: 'two' },
  ] as AssetRow[];
  const uploads = [{ id: 'u1', name: '头像', mimeType: 'image/png' }] as UploadSummary[];
  const job = {
    id: 'j1',
    authoredPrompt: '@[风格](asset:a1) 按 ![头像](image:u1) 和 ![旧图](image:u9) 画',
    promptSnapshot: 'expanded',
    requestedCount: 4,
    references: [
      { kind: 'text', id: 'a1', name: '风格' },
      { kind: 'image', id: 'u1', name: '头像' },
      { kind: 'image', id: 'u9', name: '旧图' },
    ],
    options: { model: DEFAULT_MODEL, aspectRatio: '16:9', imageSize: '2K', removeBackground: false },
  } as unknown as JobSummary;
  test('restores prompt, references, and options in one step', () => {
    const draft = draftFromJob(job, assets, uploads);
    expect(draft.prompt).toBe('@[风格](asset:a1) 按 ![头像](image:u1) 和 画');
    expect(draft.referencedAssetIds).toEqual(['a1']);
    expect(draft.options).toEqual({
      model: DEFAULT_MODEL,
      aspectRatio: '16:9',
      imageSize: '2K',
      removeBackground: false,
      count: 4,
    });
  });
  test('reports reference images that are no longer available', () => {
    const draft = draftFromJob(job, assets, uploads);
    expect(draft.missingImageNames).toEqual(['旧图']);
    expect(draft.prompt).toBe('@[风格](asset:a1) 按 ![头像](image:u1) 和 画');
    expect(draftFromJob(job, assets, uploads.concat([{ id: 'u9' } as UploadSummary])).missingImageNames).toEqual([]);
  });
  test('falls back to the expanded prompt when no authored prompt was stored', () => {
    const legacy = { ...job, authoredPrompt: undefined } as JobSummary;
    expect(draftFromJob(legacy, assets, uploads).prompt).toBe('expanded');
  });
});
