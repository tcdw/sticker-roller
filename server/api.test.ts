import { describe, expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db/client';
import { createRepositories } from '../src/db/repositories';
import { createApiHandler } from './api';
import { startServer, staticResponse } from './index';

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
  test('stores automatic image options as unspecified and preserves explicit values', async () => {
    const db = await openDatabase(':memory:');
    const repo = createRepositories(db.db);
    const api = createApiHandler({ repositories: repo });

    const automatic = await api(
      request('POST', '/api/jobs', {
        prompt: 'automatic',
        model: 'gemini-3-pro-image',
        aspectRatio: 'auto',
        imageSize: 'auto',
      }),
    );
    expect(automatic.status).toBe(202);
    expect((await automatic.json()).options).toEqual({
      model: 'gemini-3-pro-image',
      removeBackground: true,
    });

    const explicit = await api(
      request('POST', '/api/jobs', {
        prompt: 'explicit',
        model: 'gemini-3-pro-image',
        aspectRatio: '16:9',
        imageSize: '2K',
      }),
    );
    expect(explicit.status).toBe(202);
    expect((await explicit.json()).options).toEqual({
      model: 'gemini-3-pro-image',
      aspectRatio: '16:9',
      imageSize: '2K',
      removeBackground: true,
    });

    expect(
      (
        await api(
          request('POST', '/api/jobs', {
            prompt: 'invalid ratio',
            model: 'gemini-3-pro-image',
            aspectRatio: '2:1',
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await api(
          request('POST', '/api/jobs', {
            prompt: 'invalid size',
            model: 'gemini-3-pro-image',
            imageSize: '8K',
          }),
        )
      ).status,
    ).toBe(400);
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

  const pngBytes = () => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const uploadRequest = (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return new Request('http://localhost/api/uploads', { method: 'POST', body: form });
  };
  const pngFile = (name = 'ref.png') => new File([pngBytes()], name, { type: 'image/png' });

  test('uploads store images, serve bytes, and archive keeps them hidden', async () => {
    const db = await openDatabase(':memory:');
    const repo = createRepositories(db.db);
    const api = createApiHandler({ repositories: repo });
    const created = await api(uploadRequest(pngFile()));
    expect(created.status).toBe(201);
    const upload = (await created.json()) as { id: string; name: string; mimeType: string };
    expect(upload.name).toBe('ref.png');
    expect(upload.mimeType).toBe('image/png');
    expect(upload).not.toHaveProperty('data');
    const list = (await (await api(request('GET', '/api/uploads'))).json()) as unknown[];
    expect(list).toHaveLength(1);
    const raw = await api(request('GET', `/api/uploads/${upload.id}`));
    expect(raw.status).toBe(200);
    expect(raw.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await raw.arrayBuffer())).toEqual(pngBytes());
    const archived = await api(request('DELETE', `/api/uploads/${upload.id}`, {}));
    expect(archived.status).toBe(200);
    expect(await (await api(request('GET', '/api/uploads'))).json()).toHaveLength(0);
    expect((await api(request('GET', `/api/uploads/${upload.id}`))).status).toBe(200);
    db.close();
  });

  test('uploads reject non-images, wrong content type, and bogus paths', async () => {
    const db = await openDatabase(':memory:');
    const api = createApiHandler({ repositories: createRepositories(db.db) });
    expect((await api(request('POST', '/api/uploads', {}))).status).toBe(400);
    const textFile = new File([new TextEncoder().encode('hello there')], 'a.txt', { type: 'text/plain' });
    expect((await api(uploadRequest(textFile))).status).toBe(400);
    const mislabeled = new File([new TextEncoder().encode('not really a png')], 'fake.png', { type: 'image/png' });
    expect((await api(uploadRequest(mislabeled))).status).toBe(400);
    const empty = new File([], 'empty.png', { type: 'image/png' });
    expect((await api(uploadRequest(empty))).status).toBe(400);
    expect((await api(request('GET', `/api/uploads/${crypto.randomUUID()}`))).status).toBe(404);
    expect((await api(request('DELETE', `/api/uploads/${crypto.randomUUID()}`, {}))).status).toBe(404);
    db.close();
  });

  test('jobs snapshot image references and expand tokens into plain names', async () => {
    const db = await openDatabase(':memory:');
    const repo = createRepositories(db.db);
    const api = createApiHandler({ repositories: repo });
    const upload = (await (await api(uploadRequest(pngFile('表情包.png')))).json()) as { id: string };
    const created = await api(
      request('POST', '/api/jobs', {
        authoredPrompt: `参照 ![表情包.png](image:${upload.id}) 画同款`,
        referencedImageIds: [upload.id],
        count: 1,
      }),
    );
    expect(created.status).toBe(202);
    const job = (await created.json()) as {
      authoredPrompt: string;
      promptSnapshot: string;
      references: Array<{ kind?: string; id: string; name: string; mimeType: string }>;
    };
    expect(job.authoredPrompt).toBe(`参照 ![表情包.png](image:${upload.id}) 画同款`);
    expect(job.promptSnapshot).toBe('参照 表情包.png 画同款');
    expect(job.references).toEqual([{ kind: 'image', id: upload.id, name: '表情包.png', mimeType: 'image/png' }]);
    expect(
      (await api(request('POST', '/api/jobs', { prompt: 'x', referencedImageIds: [crypto.randomUUID()] }))).status,
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

  test('serves registered output files from disk on any platform', async () => {
    const db = await openDatabase(':memory:');
    const repo = createRepositories(db.db);
    const outputDir = join(tmpdir(), `sticker-output-${crypto.randomUUID()}`);
    const api = createApiHandler({ repositories: repo, outputDir });
    repo.createJob({ assetName: 'x', prompt: 'p', options: {}, count: 1 });
    const item = repo.claimNextItem();
    if (!item) {
      throw new Error('item was not claimed');
    }
    repo.registerFile({ itemId: item.id, fileName: 'ok.png', mimeType: 'image/png', sizeBytes: 3 });
    await mkdir(outputDir, { recursive: true });
    await Bun.write(join(outputDir, 'ok.png'), 'abc');
    const served = await api(request('GET', '/api/output/ok.png'));
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(await served.text()).toBe('abc');
    db.close();
    await rm(outputDir, { recursive: true, force: true });
  });

  test('static serving resolves index.html on any platform', async () => {
    const dist = join(tmpdir(), `sticker-dist-${crypto.randomUUID()}`);
    await mkdir(join(dist, 'static'), { recursive: true });
    await Bun.write(join(dist, 'index.html'), '<html><body>root</body></html>');
    await Bun.write(join(dist, 'static', 'app.js'), 'console.log(1)');
    const root = await staticResponse(dist, '/');
    expect(root.status).toBe(200);
    expect(await root.text()).toContain('root');
    expect((await staticResponse(dist, '/index.html')).status).toBe(200);
    const asset = await staticResponse(dist, '/static/app.js');
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe('console.log(1)');
    expect((await staticResponse(dist, '/static/missing.js')).status).toBe(404);
    expect((await staticResponse(dist, '/%E0%A4%A')).status).toBe(404);
    // Extensionless unknown paths fall back to the SPA entry; traversal with an
    // extension stays outside dist and is never read.
    expect((await staticResponse(dist, '/..%2F..%2Fsecret.txt')).status).toBe(404);
    await rm(dist, { recursive: true, force: true });
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
