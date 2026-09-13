import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolvePromptSource, runGeneration } from './cli-run';
import { openDatabase } from './db/client';
import { createRepositories } from './db/repositories';
import { InputError } from './errors';
import type { ReferenceLookupError } from './jobs/references';
import type { SingleImageGenerator } from './jobs/worker';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9]);

async function setup() {
  const database = await openDatabase(':memory:');
  const repo = createRepositories(database.db);
  const asset = repo.createAsset({ name: '角色设定', prompt: '猫耳少女', category: '角色' });
  const archived = repo.createAsset({ name: '旧设定', prompt: '过时', category: '角色' });
  repo.archiveAsset(archived.id);
  const upload = repo.createUpload({
    name: '参考.png',
    mimeType: 'image/png',
    sizeBytes: PNG_BYTES.byteLength,
    data: PNG_BYTES.toString('base64'),
  });
  const dir = await mkdtemp(join(tmpdir(), 'sticker-cli-'));
  const saved = join(dir, '参考.png');
  await Bun.write(saved, PNG_BYTES);
  return { database, repo, asset, archived, upload, dir, saved };
}

type GeneratorCall = { prompt: string; references: number; background?: string };

/** Records what the worker asked for and returns a deterministic image. */
function fakeGenerator(calls: GeneratorCall[]): SingleImageGenerator {
  return async (input) => {
    calls.push({
      prompt: input.sticker.prompt,
      references: input.sticker.referenceImages.length,
      background: input.selection.background,
    });
    return { success: true, imageBuffer: PNG_BYTES, mimeType: 'image/png' };
  };
}

describe('cli generate', () => {
  test('writes one file per requested image and reports absolute paths', async () => {
    const { database, repo, dir } = await setup();
    const calls: GeneratorCall[] = [];
    const outcome = await runGeneration(
      repo,
      { prompt: '画一只猫', count: 2, out: join(dir, 'nested') },
      { env: { GEMINI_API_KEY: 'test-only' }, generator: fakeGenerator(calls) },
    );
    expect(outcome.succeeded).toBe(2);
    expect(outcome.failed).toBe(0);
    expect(calls).toHaveLength(2);
    expect(outcome.items.map((item) => item.status)).toEqual(['succeeded', 'succeeded']);
    for (const item of outcome.items) {
      expect(item.filePath?.startsWith(join(dir, 'nested'))).toBe(true);
      expect(await Bun.file(item.filePath!).exists()).toBe(true);
    }
    expect(outcome.items[0]!.filePath).toBe(join(outcome.outputDir, `${outcome.jobId}-1.png`));
    database.close();
    await rm(dir, { recursive: true, force: true });
  });
  test('resolves an asset by name in both --asset and prompt tokens without duplicating it', async () => {
    const { database, repo, dir } = await setup();
    const calls: GeneratorCall[] = [];
    const outcome = await runGeneration(
      repo,
      { prompt: '@[随便](asset:角色设定) 画成贴纸', assets: ['角色设定'], out: dir },
      { env: { GEMINI_API_KEY: 'test-only' }, generator: fakeGenerator(calls) },
    );
    const job = repo.getJob(outcome.jobId).job!;
    expect(JSON.parse(job.referencesSnapshot)).toHaveLength(1);
    expect(job.authoredPromptSnapshot).toBe(`@[角色设定](asset:${repo.listAssets()[0]!.id}) 画成贴纸`);
    expect(calls[0]!.prompt).toContain('猫耳少女');
    database.close();
    await rm(dir, { recursive: true, force: true });
  });
  test('uploads a local image path and prefers it over a same-named library image', async () => {
    const { database, repo, dir, saved, upload } = await setup();
    const calls: GeneratorCall[] = [];
    const outcome = await runGeneration(
      repo,
      { prompt: '照着画', images: [saved], out: dir },
      { env: { GEMINI_API_KEY: 'test-only' }, generator: fakeGenerator(calls) },
    );
    const job = repo.getJob(outcome.jobId).job!;
    const references = JSON.parse(job.referencesSnapshot) as Array<{ id: string }>;
    expect(references).toHaveLength(1);
    expect(references[0]!.id).not.toBe(upload.id);
    expect(repo.getUpload(references[0]!.id)!.name).toBe('参考.png');
    expect(repo.listUploads()).toHaveLength(2);
    expect(calls[0]!.references).toBe(1);
    database.close();
    await rm(dir, { recursive: true, force: true });
  });
  test('accepts a library image id and rewrites the prompt token to its canonical name', async () => {
    const { database, repo, dir, upload } = await setup();
    const calls: GeneratorCall[] = [];
    const outcome = await runGeneration(
      repo,
      { prompt: `按 ![老名字](image:${upload.id}) 画`, out: dir },
      { env: { GEMINI_API_KEY: 'test-only' }, generator: fakeGenerator(calls) },
    );
    const job = repo.getJob(outcome.jobId).job!;
    expect(job.authoredPromptSnapshot).toBe(`按 ![参考.png](image:${upload.id}) 画`);
    expect(job.promptSnapshot).toBe('按 参考.png 画');
    database.close();
    await rm(dir, { recursive: true, force: true });
  });
  test('fails loudly on unknown, ambiguous, archived, and missing-file references', async () => {
    const { database, repo, dir } = await setup();
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ prompt: '@[x](asset:没有这个) 画' }, /not found/i],
      [{ prompt: '画', assets: ['不存在的素材'] }, /not found/i],
      [{ prompt: '画', assets: ['旧设定'] }, /archived/],
      [{ prompt: '画', images: ['./不存在.png'] }, /no such image file/],
    ];
    for (const [extra, pattern] of cases) {
      const error = await runGeneration(
        repo,
        { out: dir, ...extra },
        { env: { GEMINI_API_KEY: 'test-only' }, generator: fakeGenerator([]) },
      ).then(
        () => undefined,
        (caught: unknown) => caught as Error,
      );
      expect(error).toBeInstanceOf(InputError);
      expect(error?.message).toMatch(pattern);
    }
    database.close();
    await rm(dir, { recursive: true, force: true });
  });
  test('rejects an ambiguous name fragment instead of guessing', async () => {
    const { database, repo, dir } = await setup();
    repo.createAsset({ name: '角色服装', prompt: '水手服' });
    const error = await runGeneration(
      repo,
      { prompt: '画', assets: ['角色'], out: dir },
      { env: { GEMINI_API_KEY: 'test-only' }, generator: fakeGenerator([]) },
    ).then(
      () => undefined,
      (caught: unknown) => caught as ReferenceLookupError,
    );
    expect(error?.code).toBe('AMBIGUOUS');
    expect(error?.candidates).toEqual(['角色服装', '角色设定']);
    database.close();
    await rm(dir, { recursive: true, force: true });
  });
  test('reports failed items while keeping the successful ones', async () => {
    const { database, repo, dir } = await setup();
    let call = 0;
    const outcome = await runGeneration(
      repo,
      { prompt: '画', count: 2, out: dir },
      {
        env: { GEMINI_API_KEY: 'test-only' },
        generator: async () => {
          call++;
          return call === 1
            ? { success: true, imageBuffer: PNG_BYTES, mimeType: 'image/png' }
            : { success: false, error: 'provider exploded' };
        },
      },
    );
    expect(outcome.succeeded).toBe(1);
    expect(outcome.failed).toBe(1);
    expect(outcome.items[0]!.filePath).toBeTruthy();
    expect(outcome.items[1]!.filePath).toBeUndefined();
    expect(outcome.items[1]!.error).toContain('provider exploded');
    database.close();
    await rm(dir, { recursive: true, force: true });
  });
  test('validates count and forwards explicit options only', async () => {
    const { database, repo, dir } = await setup();
    await expect(runGeneration(repo, { prompt: '画', count: 0, out: dir })).rejects.toBeInstanceOf(InputError);
    await expect(runGeneration(repo, { prompt: '画', count: 21, out: dir })).rejects.toBeInstanceOf(InputError);
    await expect(runGeneration(repo, { prompt: '画', model: 'nope', out: dir })).rejects.toBeInstanceOf(InputError);
    const calls: GeneratorCall[] = [];
    const outcome = await runGeneration(
      repo,
      { prompt: '画', aspectRatio: 'auto', imageSize: '2K', removeBackground: false, out: dir },
      { env: { GEMINI_API_KEY: 'test-only' }, generator: fakeGenerator(calls) },
    );
    expect(JSON.parse(repo.getJob(outcome.jobId).job!.optionsSnapshot)).toEqual({
      version: 2,
      providerId: 'google',
      modelId: 'gemini-3-pro-image',
      options: { imageSize: '2K' },
      background: 'original',
    });
    expect(calls[0]!.background).toBe('original');
    database.close();
    await rm(dir, { recursive: true, force: true });
  });
  test('reports progress once per processed item', async () => {
    const { database, repo, dir } = await setup();
    const progress: string[] = [];
    await runGeneration(
      repo,
      { prompt: '画', count: 3, out: dir },
      {
        env: { GEMINI_API_KEY: 'test-only' },
        generator: fakeGenerator([]),
        onProgress: (done, total) => progress.push(`${done}/${total}`),
      },
    );
    expect(progress).toEqual(['1/3', '2/3', '3/3']);
    database.close();
    await rm(dir, { recursive: true, force: true });
  });
});

describe('prompt source', () => {
  test('reads --prompt-file and rejects an empty or missing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sticker-prompt-'));
    const file = join(dir, 'prompt.md');
    await Bun.write(file, '  画一只猫  ');
    expect(await resolvePromptSource({ promptFile: file })).toBe('画一只猫');
    await expect(resolvePromptSource({ promptFile: join(dir, 'nope.md') })).rejects.toBeInstanceOf(InputError);
    await expect(resolvePromptSource({ prompt: 'a', promptFile: file })).rejects.toBeInstanceOf(InputError);
    await expect(resolvePromptSource({})).rejects.toBeInstanceOf(InputError);
    await rm(dir, { recursive: true, force: true });
  });
});
