import { expect, test } from 'bun:test';
import { mkdir, rm } from 'node:fs/promises';
import { runCli } from '../../cli';
import { createApiHandler } from '../../server/api';
import { runGeneration } from '../cli-run';
import { openDatabase } from '../db/client';
import { createRepositories } from '../db/repositories';
import { normalizeJobSelection } from './options';

const env = { GEMINI_API_KEY: 'offline', OPENAI_API_KEY: 'offline', OPENROUTER_API_KEY: 'offline' };
const request = (body: unknown) =>
  new Request('http://localhost/api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('null and wrong types never become defaults or create HTTP jobs', async () => {
  const db = await openDatabase(':memory:');
  try {
    const repo = createRepositories(db.db);
    const api = createApiHandler({ repositories: repo, env });
    for (const key of ['providerId', 'provider', 'modelId', 'model', 'options', 'background', 'selection']) {
      for (const value of [null, false, 12, []]) {
        const input = { prompt: 'draw', [key]: value };
        expect(() => normalizeJobSelection(input, env)).toThrow();
        expect((await api(request(input))).status).toBe(400);
        expect(repo.countJobs()).toBe(0);
      }
    }
    expect((await api(request({ prompt: 'draw', version: 99 }))).status).toBe(400);
  } finally {
    db.close();
  }
});

test('expanded reference and prompt boundaries are identical before HTTP/CLI job creation', async () => {
  const db = await openDatabase(':memory:');
  const out = `.temp/provider-acl/boundaries-${crypto.randomUUID()}`;
  try {
    const repo = createRepositories(db.db);
    const api = createApiHandler({ repositories: repo, env });
    const ids = Array.from(
      { length: 17 },
      (_, i) => repo.createUpload({ name: `ref-${i}`, mimeType: 'image/png', data: 'unused-by-fake', sizeBytes: 1 }).id,
    );
    for (const providerId of ['google', 'openai', 'openrouter']) {
      const model = providerId === 'google' ? 'gemini-3-pro-image' : 'gpt-image-2.5-flare';
      const max = providerId === 'google' ? 14 : 16;
      for (const count of [max, max + 1]) {
        const refs = ids.slice(0, count);
        const before = repo.countJobs();
        const response = await api(request({ prompt: 'draw', providerId, model, referencedImageIds: refs }));
        expect(response.status).toBe(count === max ? 202 : 400);
        expect(repo.countJobs()).toBe(before + (count === max ? 1 : 0));
        const cliBefore = repo.countJobs();
        const promise = runGeneration(
          repo,
          { prompt: 'draw', providerId, model, images: refs, out },
          { env, generator: async () => ({ success: false, error: 'offline' }) },
        );
        if (count === max) {
          await promise;
        } else {
          await expect(promise).rejects.toThrow();
        }
        expect(repo.countJobs()).toBe(cliBefore + (count === max ? 1 : 0));
      }
    }
    for (const length of [32000, 32001]) {
      // Resolver adds "\n\n[a]\n" (six characters) after the authored prompt.
      const asset = repo.createAsset({
        name: `a${length}`,
        prompt: 'x'.repeat(length - 1 - `\n\n[a${length}]\n`.length),
      });
      const before = repo.countJobs();
      const response = await api(request({ prompt: 'p', providerId: 'openai', referencedAssetIds: [asset.id] }));
      expect(response.status).toBe(length === 32000 ? 202 : 400);
      expect(repo.countJobs()).toBe(before + (length === 32000 ? 1 : 0));
      const cliBefore = repo.countJobs();
      const promise = runGeneration(
        repo,
        { prompt: 'p', providerId: 'openai', assets: [asset.id], out },
        { env, generator: async () => ({ success: false, error: 'offline' }) },
      );
      if (length === 32000) {
        await promise;
      } else {
        await expect(promise).rejects.toThrow();
      }
      expect(repo.countJobs()).toBe(cliBefore + (length === 32000 ? 1 : 0));
    }
  } finally {
    db.close();
    await rm(out, { recursive: true, force: true });
  }
});

test('HTTP configuration errors and CLI dispatch exit classes precede job insertion', async () => {
  const dir = `.temp/provider-acl/dispatch-${crypto.randomUUID()}`;
  await mkdir(dir, { recursive: true });
  const path = `${dir}/db.sqlite`;
  const db = await openDatabase(path);
  try {
    const repo = createRepositories(db.db);
    const io = { out: (_text: string) => {}, err: (_text: string) => {} };
    for (const providerId of ['openai', 'openrouter']) {
      const name = providerId === 'openai' ? 'OPENAI_BASE_URL' : 'OPENROUTER_BASE_URL';
      for (const value of ['', '  ', 'https://example.invalid/?bad=1']) {
        const invalidEnv = { ...env, [name]: value };
        const api = createApiHandler({ repositories: repo, env: invalidEnv });
        expect((await api(request({ prompt: 'draw', providerId }))).status).toBe(503);
        expect(
          await runCli(['--database', path, '--prompt', 'draw', '--provider', providerId], io, { env: invalidEnv }),
        ).toBe(1);
        expect(repo.countJobs()).toBe(0);
      }
    }
    for (const args of [
      ['--model', 'null'],
      ['--option', 'quality=null'],
      ['--option', 'quality=high', '--option', 'quality=max'],
    ]) {
      expect(await runCli(['--database', path, '--prompt', 'draw', '--provider', 'openai', ...args], io, { env })).toBe(
        2,
      );
      expect(repo.countJobs()).toBe(0);
    }
    expect(
      await runCli(['--database', path, '--prompt', 'draw', '--provider', 'openai'], io, {
        env,
        generator: async () => ({ success: false, error: 'offline failure' }),
      }),
    ).toBe(3);
    expect(repo.countJobs()).toBe(1);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
