import { describe, expect, test } from 'bun:test';
import { openDatabase } from '../db/client';
import { createRepositories } from '../db/repositories';
import { createWorker } from './worker';

describe('durable generation worker', () => {
  test('persists each item and does not rerun successful items on retry', async () => {
    const db = await openDatabase(':memory:');
    const repo = createRepositories(db.db);
    let calls = 0;
    const job = repo.createJob({ assetName: 'demo', prompt: 'p', options: {}, count: 2 });
    const worker = createWorker({
      repositories: repo,
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

  test('queued cancellation is honored', async () => {
    const db = await openDatabase(':memory:');
    const repo = createRepositories(db.db);
    const job = repo.createJob({ assetName: 'x', prompt: 'p', options: {}, count: 2 });
    repo.cancelJob(job.id);
    let calls = 0;
    await createWorker({
      repositories: repo,
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
    const job = repo.createJob({ assetName: 'x', prompt: 'p', options: {}, count: 1 });
    const worker = createWorker({
      repositories: repo,
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
    const job = base.createJob({ assetName: 'x', prompt: 'p', options: {}, count: 1 });
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
    const job = repo.createJob({ assetName: 'x', prompt: 'p', options: {}, count: 1 });
    const item = repo.claimNextItem()!;
    repo.registerFile({ itemId: item.id, fileName: `${job.id}-1.png`, mimeType: 'image/png', sizeBytes: 1 });
    repo.recoverStale(new Date(Date.now() + 1000).toISOString());
    repo.recoverStale(new Date(Date.now() + 1000).toISOString());
    expect(repo.getFileByItem(item.id)).toHaveLength(1);
    expect(repo.getJob(job.id).items[0]?.status).toBe('queued');
    db.close();
  });
});
