import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CliIo, EXIT, exitCodeFor, runCli } from './cli';
import { EXIT_CODES } from './src/cli-spec';
import { openDatabase } from './src/db/client';
import { createRepositories } from './src/db/repositories';
import { CliError } from './src/errors';
import type { SingleImageGenerator } from './src/jobs/worker';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]);

interface Capture {
  io: CliIo;
  stdout: () => string;
  stderr: () => string;
}

function capture(): Capture {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { out: (text) => out.push(text), err: (text) => err.push(text) },
    stdout: () => out.join(''),
    stderr: () => err.join(''),
  };
}

/** Temp database seeded with the same shapes the web app writes. */
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'sticker-cli-e2e-'));
  const databasePath = join(dir, 'db.sqlite');
  const database = await openDatabase(databasePath);
  const repo = createRepositories(database.db);
  repo.createAsset({ name: '角色设定', prompt: '猫耳少女', category: '角色' });
  repo.createAsset({ name: '角色服装', prompt: '水手服', category: '角色' });
  repo.createUpload({
    name: '参考.png',
    mimeType: 'image/png',
    sizeBytes: PNG_BYTES.byteLength,
    data: PNG_BYTES.toString('base64'),
  });
  database.close();
  return { dir, databasePath, imagePath: join(dir, 'ref.png') };
}

const okGenerator: SingleImageGenerator = async () => ({
  success: true,
  imageBuffer: PNG_BYTES,
  mimeType: 'image/png',
});

async function run(argv: string[], deps = {}) {
  const sink = capture();
  const code = await runCli(argv, sink.io, { env: { GEMINI_API_KEY: 'test-only' }, ...deps });
  return { code, stdout: sink.stdout(), stderr: sink.stderr() };
}

describe('cli dispatch', () => {
  test('bare invocation prints help on stderr and exits 2 instead of pretending to work', async () => {
    const { code, stdout, stderr } = await run([]);
    expect(code).toBe(EXIT.usage);
    expect(stdout).toBe('');
    expect(stderr).toContain('error: USAGE: no command given');
    expect(stderr).toContain('USAGE');
    expect(stderr).toContain('COMMANDS');
  });
  test('--help goes to stdout and exits 0, even next to a broken argument', async () => {
    const { code, stdout, stderr } = await run(['--bogus', '--help']);
    expect(code).toBe(EXIT.ok);
    expect(stderr).toBe('');
    expect(stdout).toContain('sticker-roller cli');
  });
  test('help --json emits one JSON document an agent can parse', async () => {
    const { code, stdout } = await run(['help', '--json']);
    expect(code).toBe(EXIT.ok);
    const spec = JSON.parse(stdout) as { specVersion: number; commands: Array<{ name: string }>; exitCodes: unknown[] };
    expect(spec.specVersion).toBe(1);
    expect(spec.commands.map((command) => command.name)).toContain('generate');
    expect(spec.exitCodes.length).toBeGreaterThan(0);
  });
  test('help <command> describes that command', async () => {
    const { code, stdout } = await run(['help', 'asset', 'list']);
    expect(code).toBe(EXIT.ok);
    expect(stdout).toContain('asset list — List text assets in the shared library');
    expect(stdout).toContain('--search');
  });
  test('the documented exit codes are exactly the ones the CLI can return', async () => {
    // A documented code with no code path behind it sends agents chasing a flag that does not exist.
    const documented = EXIT_CODES.map((entry) => entry.code).sort();
    const reachable = [EXIT.ok, EXIT.runtime, EXIT.usage, EXIT.partialFailure].sort();
    expect(documented).toEqual(reachable);
    expect(exitCodeFor(new CliError('PARTIAL_FAILURE', 'x'))).toBe(EXIT.partialFailure);
    expect(exitCodeFor(new CliError('RUNTIME', 'x'))).toBe(EXIT.runtime);
    expect(exitCodeFor(new CliError('NOT_FOUND', 'x'))).toBe(EXIT.usage);
    expect(exitCodeFor(new Error('boom'))).toBe(EXIT.runtime);
  });
  test('usage errors are reported with a code, a hint, and exit 2', async () => {
    const { code, stderr } = await run(['--nope']);
    expect(code).toBe(EXIT.usage);
    expect(stderr).toContain('error: USAGE: unknown option: --nope');
    expect(stderr).toContain('hint:');
    const unknown = await run(['asset', 'bogus']);
    expect(unknown.code).toBe(EXIT.usage);
    expect(unknown.stderr).toContain('unknown command: asset bogus');
  });
});

describe('cli query commands', () => {
  test('asset list emits a table by default and full JSON on request', async () => {
    const { databasePath, dir } = await fixture();
    const table = await run(['asset', 'list', '--database', databasePath]);
    expect(table.code).toBe(EXIT.ok);
    expect(table.stdout).toContain('角色设定');
    expect(table.stdout).toContain('ID');
    const json = await run(['asset', 'list', '--database', databasePath, '--json']);
    const assets = JSON.parse(json.stdout) as Array<{ name: string; prompt: string; metadata: unknown }>;
    expect(assets.map((asset) => asset.name)).toEqual(['角色服装', '角色设定']);
    expect(assets[0]!.prompt).toBe('水手服');
    expect(assets[0]!.metadata).toEqual({});
    await rm(dir, { recursive: true, force: true });
  });
  test('an empty result set keeps stdout clean and explains itself on stderr', async () => {
    const { databasePath, dir } = await fixture();
    const result = await run(['asset', 'list', '--search', '没有这个', '--database', databasePath]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('no assets matched');
    await rm(dir, { recursive: true, force: true });
  });
  test('asset show resolves by name and reports ambiguous names with candidates', async () => {
    const { databasePath, dir } = await fixture();
    const shown = await run(['asset', 'show', '角色设定', '--database', databasePath]);
    expect(shown.stdout).toContain('猫耳少女');
    const ambiguous = await run(['asset', 'show', '角色', '--database', databasePath]);
    expect(ambiguous.code).toBe(EXIT.usage);
    expect(ambiguous.stderr).toContain('error: AMBIGUOUS:');
    expect(ambiguous.stderr).toContain('candidates: 角色服装, 角色设定');
    expect(ambiguous.stderr).toContain('asset list --json');
    const missing = await run(['asset', 'show', '不存在', '--database', databasePath]);
    expect(missing.code).toBe(EXIT.usage);
    expect(missing.stderr).toContain('error: NOT_FOUND:');
    await rm(dir, { recursive: true, force: true });
  });
  test('image list never leaks bytes and image show --out saves the file', async () => {
    const { databasePath, dir, imagePath } = await fixture();
    const list = await run(['image', 'list', '--database', databasePath, '--json']);
    const uploads = JSON.parse(list.stdout) as Array<Record<string, unknown>>;
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).not.toHaveProperty('data');
    const saved = await run(['image', 'show', '参考.png', '--out', imagePath, '--database', databasePath]);
    expect(saved.code).toBe(EXIT.ok);
    expect(saved.stdout.trim()).toBe(imagePath);
    expect(new Uint8Array(await Bun.file(imagePath).arrayBuffer())).toEqual(new Uint8Array(PNG_BYTES));
    await rm(dir, { recursive: true, force: true });
  });
});

describe('cli generate', () => {
  test('stdout carries exactly the absolute image paths', async () => {
    const { databasePath, dir } = await fixture();
    const out = join(dir, 'images');
    const result = await run(['--prompt', '画一只猫', '--count', '2', '--out', out, '--database', databasePath], {
      generator: okGenerator,
    });
    expect(result.code).toBe(EXIT.ok);
    const lines = result.stdout.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.startsWith(out)).toBe(true);
      expect(await Bun.file(line).exists()).toBe(true);
    }
    expect(result.stderr).toContain('generated 1/2');
    expect(result.stderr).toContain('2 succeeded, 0 failed');
    await rm(dir, { recursive: true, force: true });
  });
  test('--json replaces the path lines with one job document', async () => {
    const { databasePath, dir } = await fixture();
    const result = await run(
      ['--prompt', '画一只猫', '--out', join(dir, 'images'), '--database', databasePath, '--json'],
      { generator: okGenerator },
    );
    const payload = JSON.parse(result.stdout) as {
      jobId: string;
      succeeded: number;
      items: Array<{ path: string; status: string }>;
    };
    expect(result.code).toBe(EXIT.ok);
    expect(payload.succeeded).toBe(1);
    expect(payload.items[0]!.status).toBe('succeeded');
    expect(payload.items[0]!.path).toContain(payload.jobId);
    await rm(dir, { recursive: true, force: true });
  });
  test('a failed item keeps successful paths on stdout and exits 3', async () => {
    const { databasePath, dir } = await fixture();
    let calls = 0;
    const flaky: SingleImageGenerator = async () => {
      calls++;
      return calls === 1
        ? { success: true, imageBuffer: PNG_BYTES, mimeType: 'image/png' }
        : { success: false, error: 'provider exploded' };
    };
    const result = await run(
      ['--prompt', '画', '--count', '2', '--out', join(dir, 'images'), '--database', databasePath],
      {
        generator: flaky,
      },
    );
    expect(result.code).toBe(EXIT.partialFailure);
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    expect(result.stderr).toContain('failed: item 2');
    expect(result.stderr).toContain('provider exploded');
    await rm(dir, { recursive: true, force: true });
  });
  test('a job whose items all fail exits 3 without printing paths', async () => {
    const { databasePath, dir } = await fixture();
    const result = await run(['--prompt', '画', '--out', join(dir, 'images'), '--database', databasePath], {
      generator: async () => ({ success: false, error: 'nope' }),
    });
    expect(result.code).toBe(EXIT.partialFailure);
    expect(result.stdout).toBe('');
    await rm(dir, { recursive: true, force: true });
  });
  test('the generated job is visible to the web app in the same database', async () => {
    const { databasePath, dir } = await fixture();
    const out = join(dir, 'images');
    const result = await run(['--prompt', '画', '--asset', '角色设定', '--out', out, '--database', databasePath], {
      generator: okGenerator,
    });
    expect(result.code).toBe(EXIT.ok);
    const database = await openDatabase(databasePath);
    const repo = createRepositories(database.db);
    const jobs = repo.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.assetName).toBe('角色设定');
    expect(jobs[0]!.promptSnapshot).toContain('猫耳少女');
    expect(jobs[0]!.status).toBe('succeeded');
    database.close();
    await rm(dir, { recursive: true, force: true });
  });
});
