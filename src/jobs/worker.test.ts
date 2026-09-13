import { describe, expect, test } from 'bun:test';
import { openDatabase } from '../db/client';
import { createRepositories } from '../db/repositories';
import { createWorker } from './worker';

/** 无版本旧快照的真实形状：迁移前的 validateOptions 永远写入 model + removeBackground。 */
const LEGACY = { model: 'gemini-3-pro-image', removeBackground: true };
/** 旧快照按哪个渠道解释由注入的假 env 决定，测试不依赖开发机上的真实凭证。 */
const ENV = {} as Record<string, string | undefined>;

describe('durable generation worker', () => {
  test('persists each item and does not rerun successful items on retry', async () => {
    const db = await openDatabase(':memory:');
    const repo = createRepositories(db.db);
    let calls = 0;
    const job = repo.createJob({ assetName: 'demo', prompt: 'p', options: { ...LEGACY }, count: 2 });
    const worker = createWorker({
      repositories: repo,
      env: ENV,
      outputDir: `/tmp/sticker-worker-${crypto.randomUUID()}`,
      generator: async () => {
        calls++;
        return calls === 2
          ? { success: false, error: 'nope' }
          : { success: true, imageBuffer: Buffer.from('png'), mimeType: 'image/png' };
      },
    });
    await worker.drain();
    expect(repo.getJob(job.id).items.map((item) => item.status)).toEqual(['succeeded', 'failed']);
    expect(calls).toBe(2);
    repo.retryFailed(job.id);
    await worker.drain();
    expect(calls).toBe(3);
    expect(repo.getJob(job.id).items.map((item) => item.status)).toEqual(['succeeded', 'succeeded']);
    db.close();
  });

  test('forwards only explicitly stored image options to the generator', async () => {
    const db = await openDatabase(':memory:');
    const repo = createRepositories(db.db);
    repo.createJob({
      assetName: 'automatic',
      prompt: 'p',
      options: { model: 'gemini-3-pro-image', removeBackground: true },
      count: 1,
    });
    repo.createJob({
      assetName: 'explicit',
      prompt: 'p',
      options: { model: 'gemini-3-pro-image', aspectRatio: '16:9', imageSize: '2K', removeBackground: false },
      count: 1,
    });
    const calls: unknown[] = [];
    await createWorker({
      repositories: repo,
      env: ENV,
      outputDir: `/tmp/sticker-worker-${crypto.randomUUID()}`,
      generator: async (input) => {
        calls.push(input.selection);
        return { success: true, imageBuffer: Buffer.from('x'), mimeType: 'image/png' };
      },
    }).drain();

    // 完整 selection 原样传递：新增选项不需要再改 worker 的透传清单。
    expect(calls).toEqual([
      {
        version: 2,
        providerId: 'google',
        modelId: 'gemini-3-pro-image',
        options: {},
        background: 'magenta-key',
      },
      {
        version: 2,
        providerId: 'google',
        modelId: 'gemini-3-pro-image',
        options: { aspectRatio: '16:9', imageSize: '2K' },
        background: 'original',
      },
    ]);
    db.close();
  });

  test('forwards snapshot reference images to the generator', async () => {
    const db = await openDatabase(':memory:');
    const repo = createRepositories(db.db);
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const upload = repo.createUpload({
      name: 'ref.png',
      mimeType: 'image/png',
      sizeBytes: bytes.byteLength,
      data: Buffer.from(bytes).toString('base64'),
    });
    repo.createJob({
      assetName: 'demo',
      prompt: 'p',
      referencedImages: [{ kind: 'image', id: upload.id, name: upload.name, mimeType: upload.mimeType }],
      options: { ...LEGACY },
      count: 1,
    });
    const calls: Array<Array<{ data: string; mimeType: string; fileName: string }>> = [];
    await createWorker({
      repositories: repo,
      env: ENV,
      outputDir: `/tmp/sticker-worker-${crypto.randomUUID()}`,
      generator: async (input) => {
        calls.push(input.sticker.referenceImages);
        return { success: true, imageBuffer: Buffer.from('x'), mimeType: 'image/png' };
      },
    }).drain();
    expect(calls).toEqual([
      [{ data: Buffer.from(bytes).toString('base64'), mimeType: 'image/png', fileName: 'ref.png' }],
    ]);
    db.close();
  });

  test('fails items when a referenced upload no longer exists', async () => {
    const db = await openDatabase(':memory:');
    const repo = createRepositories(db.db);
    repo.createJob({
      assetName: 'demo',
      prompt: 'p',
      referencedImages: [{ kind: 'image', id: crypto.randomUUID(), name: 'gone.png', mimeType: 'image/png' }],
      options: { ...LEGACY },
      count: 1,
    });
    let calls = 0;
    const worker = createWorker({
      repositories: repo,
      env: ENV,
      outputDir: `/tmp/sticker-worker-${crypto.randomUUID()}`,
      generator: async () => {
        calls++;
        return { success: true, imageBuffer: Buffer.from('x'), mimeType: 'image/png' };
      },
    });
    await worker.drain();
    expect(calls).toBe(0);
    const created = repo.listJobs(1, 0)[0];
    const detail = created ? repo.getJob(created.id) : undefined;
    expect(detail?.items[0]?.status).toBe('failed');
    expect(detail?.items[0]?.error).toContain('reference image');
    db.close();
  });

  test('queued cancellation is honored', async () => {
    const db = await openDatabase(':memory:');
    const repo = createRepositories(db.db);
    const job = repo.createJob({ assetName: 'x', prompt: 'p', options: { ...LEGACY }, count: 2 });
    repo.cancelJob(job.id);
    let calls = 0;
    await createWorker({
      repositories: repo,
      env: ENV,
      generator: async () => {
        calls++;
        return { success: true, imageBuffer: Buffer.from('x'), mimeType: 'image/png' };
      },
    }).drain();
    expect(calls).toBe(0);
    expect(repo.getJob(job.id).items.every((item) => item.status === 'cancelled')).toBe(true);
    db.close();
  });

  test('redacts complete sensitive provider credentials', async () => {
    const db = await openDatabase(':memory:');
    const repo = createRepositories(db.db);
    const job = repo.createJob({ assetName: 'x', prompt: 'p', options: { ...LEGACY }, count: 1 });
    const worker = createWorker({
      repositories: repo,
      env: ENV,
      outputDir: `/tmp/sticker-worker-${crypto.randomUUID()}`,
      generator: async () => {
        throw new Error('Authorization: Bearer TOPSECRET, Basic BASICSECRET x-api-key=KEYSECRET');
      },
    });
    await worker.drain();
    const item = repo.getJob(job.id).items[0]!;
    const request = repo.listRequests(item.id)[0]!;
    expect(request.error).not.toContain('TOPSECRET');
    expect(request.error).not.toContain('BASICSECRET');
    expect(request.error).not.toContain('KEYSECRET');
    expect(item.error).not.toContain('TOPSECRET');
    expect(item.status).toBe('failed');
    db.close();
  });

  test('cancellation after claim but before request creation skips provider', async () => {
    const db = await openDatabase(':memory:');
    const base = createRepositories(db.db);
    const job = base.createJob({ assetName: 'x', prompt: 'p', options: { ...LEGACY }, count: 1 });
    let cancelled = false;
    const repo = {
      ...base,
      claimNextItem: () => {
        const item = base.claimNextItem();
        if (item && !cancelled) {
          cancelled = true;
          base.cancelJob(job.id);
        }
        return item;
      },
    } as typeof base;
    let calls = 0;
    await createWorker({
      repositories: repo,
      env: ENV,
      generator: async () => {
        calls++;
        return { success: true, imageBuffer: Buffer.from('x'), mimeType: 'image/png' };
      },
    }).drain();
    expect(calls).toBe(0);
    expect(repo.getJob(job.id).items[0]?.status).toBe('cancelled');
    const itemId = repo.getJob(job.id).items[0]?.id;
    expect(itemId).toBeDefined();
    expect(repo.listRequests(itemId as string)).toHaveLength(0);
    db.close();
  });

  test('stale recovery is idempotent for registered output', async () => {
    const db = await openDatabase(':memory:');
    const repo = createRepositories(db.db);
    const job = repo.createJob({ assetName: 'x', prompt: 'p', options: { ...LEGACY }, count: 1 });
    const item = repo.claimNextItem()!;
    repo.registerFile({ itemId: item.id, fileName: `${job.id}-1.png`, mimeType: 'image/png', sizeBytes: 1 });
    repo.recoverStale(new Date(Date.now() + 1000).toISOString());
    repo.recoverStale(new Date(Date.now() + 1000).toISOString());
    expect(repo.getFileByItem(item.id)).toHaveLength(1);
    expect(repo.getJob(job.id).items[0]?.status).toBe('queued');
    db.close();
  });
});

describe('job-scoped draining', () => {
  test('drain(jobId) never claims items that belong to another job', async () => {
    const db = await openDatabase(':memory:');
    const repo = createRepositories(db.db);
    const mine = repo.createJob({ assetName: 'mine', prompt: 'p', options: { ...LEGACY }, count: 2 });
    const theirs = repo.createJob({ assetName: 'theirs', prompt: 'p', options: { ...LEGACY }, count: 1 });
    const worker = createWorker({
      repositories: repo,
      env: ENV,
      outputDir: `/tmp/sticker-worker-${crypto.randomUUID()}`,
      generator: async () => ({ success: true, imageBuffer: Buffer.from('png'), mimeType: 'image/png' }),
    });
    await worker.drain(mine.id);
    expect(repo.getJob(mine.id).items.map((item) => item.status)).toEqual(['succeeded', 'succeeded']);
    expect(repo.getJob(theirs.id).items.map((item) => item.status)).toEqual(['queued']);
    db.close();
  });

  test('claimNextItem() without a job id still drains every queued item', async () => {
    const db = await openDatabase(':memory:');
    const repo = createRepositories(db.db);
    const first = repo.createJob({ assetName: 'first', prompt: 'p', options: { ...LEGACY }, count: 1 });
    const second = repo.createJob({ assetName: 'second', prompt: 'p', options: { ...LEGACY }, count: 1 });
    const worker = createWorker({
      repositories: repo,
      env: ENV,
      outputDir: `/tmp/sticker-worker-${crypto.randomUUID()}`,
      generator: async () => ({ success: true, imageBuffer: Buffer.from('png'), mimeType: 'image/png' }),
    });
    await worker.drain();
    expect(repo.getJob(first.id).items.map((item) => item.status)).toEqual(['succeeded']);
    expect(repo.getJob(second.id).items.map((item) => item.status)).toEqual(['succeeded']);
    db.close();
  });
});
