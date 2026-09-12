import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listAssets,
  listUploads,
  renderAsset,
  renderAssetTable,
  renderUpload,
  renderUploadTable,
  showAsset,
  showUpload,
  writeUploadTo,
} from './cli-query';
import { openDatabase } from './db/client';
import { createRepositories } from './db/repositories';
import type { ReferenceLookupError } from './jobs/references';

// Smallest possible PNG header; the query layer never decodes pixels, it only moves bytes.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function setup() {
  const database = await openDatabase(':memory:');
  const repo = createRepositories(database.db);
  const character = repo.createAsset({ name: '角色设定', prompt: '一个猫耳少女', category: '角色' });
  const outfit = repo.createAsset({ name: '角色服装', prompt: '水手服', category: '角色' });
  const style = repo.createAsset({ name: '画风', prompt: '粗线条描边', category: '风格' });
  repo.archiveAsset(style.id);
  const upload = repo.createUpload({
    name: '头像.png',
    mimeType: 'image/png',
    sizeBytes: PNG_BYTES.byteLength,
    data: PNG_BYTES.toString('base64'),
  });
  return { database, repo, character, outfit, style, upload };
}

describe('cli asset queries', () => {
  test('lists active assets by name and hides archived ones by default', async () => {
    const { database, repo } = await setup();
    expect(listAssets(repo).map((asset) => asset.name)).toEqual(['角色服装', '角色设定']);
    expect(listAssets(repo, { includeArchived: true }).map((asset) => asset.name)).toContain('画风');
    expect(listAssets(repo, { search: '服装' }).map((asset) => asset.name)).toEqual(['角色服装']);
    expect(listAssets(repo, { category: '角色' })).toHaveLength(2);
    expect(listAssets(repo, { category: '不存在' })).toEqual([]);
    database.close();
  });
  test('parses metadata into an object like the web API does', async () => {
    const { database, repo } = await setup();
    const asset = listAssets(repo)[0]!;
    expect(typeof asset.metadata).toBe('object');
    expect(asset.metadata).toEqual({});
    database.close();
  });
  test('resolves an asset by id, exact name, and unique fragment', async () => {
    const { database, repo, character } = await setup();
    expect(showAsset(repo, character.id).name).toBe('角色设定');
    expect(showAsset(repo, '画风').name).toBe('画风');
    expect(showAsset(repo, '设定').name).toBe('角色设定');
    database.close();
  });
  test('rejects ambiguous and unknown references with candidates', async () => {
    const { database, repo } = await setup();
    const ambiguous = (() => {
      try {
        showAsset(repo, '角色');
        return undefined;
      } catch (error) {
        return error as ReferenceLookupError;
      }
    })();
    expect(ambiguous?.code).toBe('AMBIGUOUS');
    expect(ambiguous?.candidates).toEqual(['角色服装', '角色设定']);
    const missing = (() => {
      try {
        showAsset(repo, '没有这个素材');
        return undefined;
      } catch (error) {
        return error as ReferenceLookupError;
      }
    })();
    expect(missing?.code).toBe('NOT_FOUND');
    database.close();
  });
});

describe('cli image queries', () => {
  test('lists uploads without the base64 payload', async () => {
    const { database, repo } = await setup();
    const uploads = listUploads(repo);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).not.toHaveProperty('data');
    expect(listUploads(repo, { search: '头像' })).toHaveLength(1);
    expect(listUploads(repo, { search: '别的' })).toHaveLength(0);
    database.close();
  });
  test('resolves an image by name and keeps its bytes for saving', async () => {
    const { database, repo } = await setup();
    expect(showUpload(repo, '头像.png').mimeType).toBe('image/png');
    database.close();
  });
  test('writes image bytes to the requested path and returns an absolute path', async () => {
    const { database, repo, upload } = await setup();
    const dir = await mkdtemp(join(tmpdir(), 'sticker-query-'));
    try {
      const target = join(dir, 'nested', '头像.png');
      const saved = await writeUploadTo(showUpload(repo, upload.id), target);
      expect(saved).toBe(target);
      expect(new Uint8Array(await Bun.file(saved).arrayBuffer())).toEqual(new Uint8Array(PNG_BYTES));
    } finally {
      await rm(dir, { recursive: true, force: true });
      database.close();
    }
  });
});

describe('cli rendering', () => {
  test('tables carry ids and previews on one line per row', async () => {
    const { database, repo } = await setup();
    const table = renderAssetTable(listAssets(repo));
    const lines = table.trimEnd().split('\n');
    expect(lines[0]).toContain('ID');
    expect(lines[0]).toContain('PROMPT');
    expect(lines).toHaveLength(3); // header + two active assets
    expect(table).toContain('角色服装');
    expect(table).toContain('水手服');
    database.close();
  });
  test('asset detail prints the full prompt', async () => {
    const { database, repo } = await setup();
    const text = renderAsset(showAsset(repo, '角色设定'));
    expect(text).toContain('id:');
    expect(text).toContain('一个猫耳少女');
    expect(text).toContain('category: 角色');
    database.close();
  });
  test('image detail reports the saved path only when one was written', async () => {
    const { database, repo } = await setup();
    const summary = listUploads(repo)[0]!;
    expect(renderUpload(summary)).not.toContain('saved:');
    expect(renderUpload(summary, '/tmp/头像.png')).toContain('saved:    /tmp/头像.png');
    expect(renderUploadTable([summary])).toContain('头像.png');
    database.close();
  });
});
