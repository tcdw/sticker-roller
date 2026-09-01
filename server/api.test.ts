import { describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { openDatabase } from '../src/db/client';
import { createRepositories } from '../src/db/repositories';
import { createApiHandler } from './api';
import { startServer } from './index';

const request = (method: string, path: string, value?: unknown) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: value === undefined ? undefined : { 'content-type': 'application/json' },
    body: value === undefined ? undefined : JSON.stringify(value),
  });

describe('web API', () => {
  test('asset CRUD and validation use stable envelopes', async () => {
    const db = await openDatabase(':memory:');
    const api = createApiHandler({ repositories: createRepositories(db.db) });
    expect((await api(request('GET', '/api/health'))).status).toBe(200);
    expect((await api(request('POST', '/api/assets', { name: 'A', prompt: 'hello' }))).status).toBe(201);
    expect((await api(request('POST', '/api/assets', { name: 'B', prompt: 'hello' }))).status).toBe(201);
    const invalid = await api(request('POST', '/api/jobs', { prompt: 'x', count: 0 }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toHaveProperty('error.code', 'INVALID_INPUT');
    db.close();
  });
  test('job persists across handler recreation and rejects reference images', async () => {
    const db = await openDatabase(':memory:');
    const repo = createRepositories(db.db);
    const api = createApiHandler({ repositories: repo });
    const rejected = await api(request('POST', '/api/jobs', { prompt: 'x', referenceImages: [] }));
    expect(rejected.status).toBe(400);
    const accepted = await api(request('POST', '/api/jobs', { prompt: 'x', count: 1 }));
    expect(accepted.status).toBe(202);
    const job = (await accepted.json()) as { id: string };
    const api2 = createApiHandler({ repositories: repo });
    expect((await api2(request('GET', `/api/jobs/${job.id}`))).status).toBe(200);
    db.close();
  });
  test('creates jobs with multiple references and immutable expansion', async () => {
    const db = await openDatabase(':memory:');
    const repo = createRepositories(db.db);
    const api = createApiHandler({ repositories: repo });
    const a = (await (
      await api(request('POST', '/api/assets', { name: 'A', prompt: 'alpha', category: '人物', metadata: { x: 1 } }))
    ).json()) as { id: string };
    const b = (await (await api(request('POST', '/api/assets', { name: 'B', prompt: 'beta' }))).json()) as {
      id: string;
    };
    const created = await api(
      request('POST', '/api/jobs', { authoredPrompt: 'make', referencedAssetIds: [a.id, b.id] }),
    );
    expect(created.status).toBe(202);
    const job = (await created.json()) as {
      authoredPrompt: string;
      promptSnapshot: string;
      references: Array<{ prompt: string }>;
    };
    expect(job.authoredPrompt).toBe('make');
    expect(job.promptSnapshot).toContain('alpha');
    expect(job.promptSnapshot).toContain('beta');
    expect(job.references).toHaveLength(2);
    expect(
      (await api(request('POST', '/api/jobs', { authoredPrompt: 'bad', referencedAssetIds: [crypto.randomUUID()] })))
        .status,
    ).toBe(400);
    db.close();
  });
  test('registered output blocks traversal and missing files', async () => {
    const db = await openDatabase(':memory:');
    const repo = createRepositories(db.db);
    const api = createApiHandler({ repositories: repo, outputDir: '/tmp/sticker-output' });
    expect((await api(request('GET', '/api/output/..%2Fsecret.png'))).status).toBe(404);
    expect((await api(request('GET', '/api/output/nope.png'))).status).toBe(404);
    db.close();
  });
  test('startServer serves and processes accepted jobs through its background worker', async () => {
    const outputDir = `/tmp/sticker-server-${crypto.randomUUID()}`;
    const app = await startServer({
      databasePath: ':memory:',
      outputDir,
      port: 0,
      generator: async () => ({ success: true, imageBuffer: Buffer.from('fake'), mimeType: 'image/png' }),
    });
    try {
      const base = `http://${app.server.hostname}:${app.server.port}`;
      const accepted = await fetch(`${base}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'server integration' }),
      });
      expect(accepted.status).toBe(202);
      const job = (await accepted.json()) as { id: string };
      let detail: { items: Array<{ status: string }> } | undefined;
      for (let i = 0; i < 100; i++) {
        detail = (await (await fetch(`${base}/api/jobs/${job.id}`)).json()) as typeof detail;
        if (detail?.items[0]?.status === 'succeeded') {
          break;
        }
        await Bun.sleep(10);
      }
      expect(detail?.items[0]?.status).toBe('succeeded');
      expect((await fetch(`${base}/api/unknown-path`)).status).toBe(404);
    } finally {
      await app.shutdown();
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  test('mutation routes reject extra path segments', async () => {
    const db = await openDatabase(':memory:');
    const repo = createRepositories(db.db);
    const api = createApiHandler({ repositories: repo });
    const asset = (await (await api(request('POST', '/api/assets', { name: 'A', prompt: 'hello' }))).json()) as {
      id: string;
    };
    const job = (await (await api(request('POST', '/api/jobs', { prompt: 'x' }))).json()) as { id: string };
    for (const [method, path, value] of [
      ['PATCH', `/api/assets/${asset.id}/extra`, { name: 'changed' }],
      ['DELETE', `/api/assets/${asset.id}/extra`],
      ['POST', `/api/assets/${asset.id}/archive/extra`],
      ['POST', `/api/jobs/${job.id}/cancel/extra`],
      ['POST', `/api/jobs/${job.id}/retry-failed/extra`],
    ] as const) {
      expect((await api(request(method, path, value))).status).toBe(404);
    }
    expect((await api(request('GET', '/api/output/%E0%A4%A'))).status).toBe(400);
    db.close();
  });
});
