import { expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { createApiHandler } from '../../server/api';
import { parseProviderOptions } from '../cli-provider-options';
import { runGeneration } from '../cli-run';
import { openDatabase } from '../db/client';
import { createRepositories } from '../db/repositories';
import { normalizeJobSelection, validateGenerationInput } from './options';

const env = { GEMINI_API_KEY: 'test-only', OPENAI_API_KEY: 'test-only' };
test('HTTP and CLI persist the same explicit v2 selection and reject before job creation', async () => {
  const db = await openDatabase(':memory:');
  const repo = createRepositories(db.db);
  const api = createApiHandler({ repositories: repo, env });
  const input = {
    prompt: 'draw',
    providerId: 'openai',
    model: 'gpt-image-2.5-flare',
    options: { quality: 'max', size: 'auto' },
  };
  const request = (body: unknown) =>
    new Request('http://localhost/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const response = await api(request(input));
  expect(response.status).toBe(202);
  const http = await response.json();
  const out = `.temp/provider-acl/equivalence-${crypto.randomUUID()}`;
  try {
    const cli = await runGeneration(
      repo,
      { ...input, out },
      {
        env,
        generator: async ({ selection }) => {
          expect(selection).toEqual(http.options);
          return { success: true, imageBuffer: Buffer.from('fake'), mimeType: 'image/png' };
        },
      },
    );
    expect(JSON.parse(repo.getJob(cli.jobId).job?.optionsSnapshot ?? '{}')).toEqual(http.options);
    const count = repo.countJobs();
    expect((await api(request({ ...input, options: { imageSize: '4K' } }))).status).toBe(400);
    expect(repo.countJobs()).toBe(count);
    const missing = createApiHandler({ repositories: repo, env: {} });
    expect((await missing(request(input))).status).toBe(503);
    expect(repo.countJobs()).toBe(count);
  } finally {
    db.close();
    await rm(out, { recursive: true, force: true });
  }
});
test('limits and CLI conflicts are checked locally', () => {
  for (const providerId of ['google', 'openai']) {
    const selection = normalizeJobSelection({ providerId }, env);
    const max = providerId === 'google' ? 14 : 16;
    expect(() => validateGenerationInput(selection, 'x', max)).not.toThrow();
    expect(() => validateGenerationInput(selection, 'x', max + 1)).toThrow();
  }
  expect(() => parseProviderOptions('openai', undefined, ['quality=high', 'quality=max'])).toThrow();
  expect(() =>
    normalizeJobSelection({ model: 'gemini-3-pro-image', aspectRatio: '1:1', options: { aspectRatio: '1:1' } }, env),
  ).toThrow();
  expect(() => normalizeJobSelection({ selection: { version: 99 } }, env)).toThrow();
});
