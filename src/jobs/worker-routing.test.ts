import { expect, test } from 'bun:test';
import { openDatabase } from '../db/client';
import { createRepositories } from '../db/repositories';
import { serializeSelection } from '../image-providers';
import { normalizeJobSelection } from './options';
import { createWorker } from './worker';

const env = { GEMINI_API_KEY: 'offline', OPENAI_API_KEY: 'offline' };
const gateway = { ...env, AI_GATEWAY_URL: 'https://example.invalid', AI_GATEWAY_TOKEN: 'offline' };

test('v2 retry keeps recorded route while legacy resolves current route', async () => {
  const db = await openDatabase(':memory:');
  try {
    const repo = createRepositories(db.db);
    const job = repo.createJob({
      assetName: 'x',
      prompt: 'p',
      options: serializeSelection(normalizeJobSelection({ providerId: 'google' }, env)),
      count: 1,
    });
    const seen: string[] = [];
    for (const current of [env, gateway]) {
      const worker = createWorker({
        repositories: repo,
        env: current,
        generator: async ({ selection }) => {
          seen.push(selection.providerId);
          return { success: false, error: 'offline' };
        },
      });
      await worker.drain(job.id);
      repo.retryFailed(job.id);
    }
    expect(seen).toEqual(['google', 'google']);
    const legacy = repo.createJob({
      assetName: 'x',
      prompt: 'p',
      options: { model: 'gemini-3-pro-image', removeBackground: true },
      count: 1,
    });
    await createWorker({
      repositories: repo,
      env: gateway,
      generator: async ({ selection }) => {
        expect(selection.providerId).toBe('ai-gateway');
        return { success: false, error: 'offline' };
      },
    }).drain(legacy.id);
  } finally {
    db.close();
  }
});

test('historical unknown and over-limit configurations fail before generator', async () => {
  const db = await openDatabase(':memory:');
  try {
    const repo = createRepositories(db.db);
    const refs = Array.from({ length: 15 }, (_, i) =>
      repo.createUpload({ name: `image${i}`, mimeType: 'image/png', data: 'unused', sizeBytes: 1 }),
    );
    for (const options of [{ version: 99 }, { model: 'gemini-3-pro-image', removeBackground: true }]) {
      const job = repo.createJob({
        assetName: 'x',
        prompt: 'p',
        options,
        referencedImages: refs.map((ref) => ({
          kind: 'image' as const,
          id: ref.id,
          name: ref.name,
          mimeType: ref.mimeType,
        })),
        count: 1,
      });
      let calls = 0;
      await createWorker({
        repositories: repo,
        env,
        generator: async () => {
          calls++;
          return { success: false };
        },
      }).drain(job.id);
      expect(calls).toBe(0);
      expect(repo.getJob(job.id).items[0]?.status).toBe('failed');
    }
  } finally {
    db.close();
  }
});
