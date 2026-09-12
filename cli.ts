#!/usr/bin/env bun
/**
 * sticker-roller CLI 入口。
 *
 * 契约（由 `bun run cli -- help` 与 help --json 同步声明）：
 * - stdout 只放数据：生成命令逐行输出图片绝对路径，查询命令输出表格或 JSON；
 * - stderr 放进度、警告与错误，格式为 `error: CODE: message`；
 * - 退出码：0 成功 / 1 运行时错误 / 2 用法错误（含引用解析失败）/ 3 有 item 生成失败。
 */

import { resolve } from 'node:path';
import { renderHelp, renderHelpJson } from './src/cli-help';
import { optionList, optionValue, parseCliArgs } from './src/cli-parse';
import {
  listAssets,
  listUploads,
  renderAsset,
  renderAssetTable,
  renderUpload,
  renderUploadTable,
  showAsset,
  showUpload,
  uploadSummary,
  writeUploadTo,
} from './src/cli-query';
import { runGeneration } from './src/cli-run';
import { findCommand, PROGRAM } from './src/cli-spec';
import { openDatabase } from './src/db/client';
import { createRepositories, type Repositories } from './src/db/repositories';
import { CliError, InputError } from './src/errors';
import { ReferenceLookupError } from './src/jobs/references';
import type { SingleImageGenerator } from './src/jobs/worker';

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

export interface CliDeps {
  /** Injected by tests so a run never calls the real provider. */
  generator?: SingleImageGenerator;
}

export const EXIT = {
  ok: 0,
  runtime: 1,
  usage: 2,
  partialFailure: 3,
} as const;

/** Map a thrown error onto the documented exit codes. */
export function exitCodeFor(error: unknown): number {
  if (error instanceof CliError) {
    switch (error.code) {
      case 'USAGE':
      case 'NOT_FOUND':
      case 'AMBIGUOUS':
        return EXIT.usage;
      case 'PARTIAL_FAILURE':
        return EXIT.partialFailure;
      default:
        return EXIT.runtime;
    }
  }
  // Everything the caller can fix by editing the command line is a usage error.
  if (error instanceof InputError) {
    return EXIT.usage;
  }
  return EXIT.runtime;
}

function errorCodeFor(error: unknown): string {
  if (error instanceof CliError) {
    return error.code;
  }
  if (error instanceof ReferenceLookupError) {
    return error.code;
  }
  if (error instanceof InputError) {
    return 'USAGE';
  }
  return 'RUNTIME';
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** `error: CODE: message` + candidate list + one hint line, all on stderr. */
export function reportError(io: CliIo, error: unknown): void {
  const code = errorCodeFor(error);
  io.err(`error: ${code}: ${messageOf(error)}\n`);
  if (error instanceof ReferenceLookupError) {
    const command = error.message.startsWith('image') ? 'image list' : 'asset list';
    if (error.candidates.length) {
      io.err(`  candidates: ${error.candidates.join(', ')}\n`);
      io.err(`hint: use one of the candidates or the exact id from '${PROGRAM} ${command} --json'\n`);
      return;
    }
    io.err(`hint: run '${PROGRAM} ${command} --json' to list what is available\n`);
    return;
  }
  if (error instanceof CliError && error.hint) {
    io.err(`hint: ${error.hint}\n`);
    return;
  }
  io.err(`hint: run '${PROGRAM} help' for usage\n`);
}

const escapeHint = (path: readonly string[]) => `run '${PROGRAM} ${path.join(' ')} --help' for usage`;

async function withRepositories<T>(
  databasePath: string | undefined,
  run: (repo: Repositories) => Promise<T> | T,
): Promise<T> {
  const database = await openDatabase(databasePath);
  try {
    return await run(createRepositories(database.db));
  } finally {
    database.close();
  }
}

/** Full CLI contract: never throws, always returns the documented exit code. */
export async function runCli(argv: readonly string[], io: CliIo, deps: CliDeps = {}): Promise<number> {
  try {
    return await dispatch(argv, io, deps);
  } catch (error) {
    reportError(io, error);
    return exitCodeFor(error);
  }
}

async function dispatch(argv: readonly string[], io: CliIo, deps: CliDeps): Promise<number> {
  if (!argv.length) {
    // Never exit 0 without doing work: an agent would read that as a successful generation.
    io.err(`error: USAGE: no command given\n`);
    io.err(renderHelp([]));
    return EXIT.usage;
  }
  const invocation = parseCliArgs(argv);
  if (invocation.kind === 'help') {
    io.out(invocation.json ? renderHelpJson() : renderHelp(invocation.path));
    return EXIT.ok;
  }
  const { command, values, positionals, json } = invocation;
  switch (command.path[0]) {
    case 'help': {
      if (json) {
        io.out(renderHelpJson());
        return EXIT.ok;
      }
      const words = positionals.flatMap((value) => value.split(/\s+/)).filter(Boolean);
      if (!words.length) {
        io.out(renderHelp([]));
        return EXIT.ok;
      }
      if (!findCommand(words)) {
        throw new CliError('USAGE', `unknown command: ${words.join(' ')}`, escapeHint([]));
      }
      io.out(renderHelp(words));
      return EXIT.ok;
    }
    case 'asset': {
      const databasePath = optionValue(values, '--database');
      const query = {
        search: optionValue(values, '--search'),
        category: optionValue(values, '--category'),
        includeArchived: values['include-archived'] !== undefined,
      };
      return withRepositories(databasePath, (repo) => {
        if (command.path[1] === 'list') {
          const assets = listAssets(repo, query);
          if (!assets.length) {
            io.err('no assets matched\n');
            return EXIT.ok;
          }
          io.out(json ? `${JSON.stringify(assets, null, 2)}\n` : renderAssetTable(assets));
          return EXIT.ok;
        }
        const asset = showAsset(repo, positionals[0]!);
        io.out(json ? `${JSON.stringify(asset, null, 2)}\n` : renderAsset(asset));
        return EXIT.ok;
      });
    }
    case 'image': {
      const databasePath = optionValue(values, '--database');
      const query = {
        search: optionValue(values, '--search'),
        includeArchived: values['include-archived'] !== undefined,
      };
      return withRepositories(databasePath, async (repo) => {
        if (command.path[1] === 'list') {
          const uploads = listUploads(repo, query);
          if (!uploads.length) {
            io.err('no images matched\n');
            return EXIT.ok;
          }
          io.out(json ? `${JSON.stringify(uploads, null, 2)}\n` : renderUploadTable(uploads));
          return EXIT.ok;
        }
        const upload = showUpload(repo, positionals[0]!);
        const outPath = optionValue(values, '--out');
        const saved = outPath ? await writeUploadTo(upload, outPath) : undefined;
        if (json) {
          io.out(`${JSON.stringify({ ...uploadSummary(upload), savedPath: saved ?? null }, null, 2)}\n`);
        } else if (saved) {
          // Same contract as generate: stdout carries the path a caller can open.
          io.err(renderUpload(uploadSummary(upload), saved));
          io.out(`${saved}\n`);
        } else {
          io.out(renderUpload(uploadSummary(upload)));
        }
        return EXIT.ok;
      });
    }
    default: {
      const databasePath = optionValue(values, '--database');
      const outcome = await withRepositories(databasePath, (repo) =>
        runGeneration(
          repo,
          {
            prompt: optionValue(values, '--prompt'),
            promptFile: optionValue(values, '--prompt-file'),
            assets: optionList(values, '--asset'),
            images: optionList(values, '--image'),
            count: optionValue(values, '--count') === undefined ? undefined : Number(optionValue(values, '--count')),
            model: optionValue(values, '--model'),
            aspectRatio: optionValue(values, '--aspect-ratio'),
            imageSize: optionValue(values, '--image-size'),
            removeBackground: values['no-remove-background'] !== undefined ? false : undefined,
            out: optionValue(values, '--out'),
          },
          {
            generator: deps.generator,
            onProgress: (done, total) => io.err(`generated ${done}/${total}\n`),
          },
        ),
      );
      const resolvedItems = outcome.items.map((item) => ({
        ordinal: item.ordinal,
        status: item.status,
        path: item.filePath ? resolve(item.filePath) : null,
        error: item.error ?? null,
      }));
      for (const item of resolvedItems) {
        if (item.path) {
          if (!json) {
            io.out(`${item.path}\n`);
          }
        } else {
          io.err(`failed: item ${item.ordinal} (job ${outcome.jobId}): ${item.error ?? item.status}\n`);
        }
      }
      if (json) {
        io.out(
          `${JSON.stringify(
            {
              jobId: outcome.jobId,
              outputDir: outcome.outputDir,
              succeeded: outcome.succeeded,
              failed: outcome.failed,
              items: resolvedItems,
            },
            null,
            2,
          )}\n`,
        );
      }
      io.err(`job ${outcome.jobId}: ${outcome.succeeded} succeeded, ${outcome.failed} failed\n`);
      return outcome.failed ? EXIT.partialFailure : EXIT.ok;
    }
  }
}

if (import.meta.main) {
  const io: CliIo = {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  };
  process.exit(await runCli(process.argv.slice(2), io));
}
