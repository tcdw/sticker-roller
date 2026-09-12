/**
 * 声明式 CLI spec：解析与 help 渲染的唯一真相源。
 *
 * 新增 flag 时只改这里：`parseCliArgs()` 会按它校验，`renderHelp()` / `renderHelpJson()`
 * 会按它渲染，因此不存在「help 里写了、解析器里没有」的漂移。
 */

import { DEFAULT_MODEL, DEFAULT_REMOVE_BACKGROUND } from './config';
import { AUTO, SUPPORTED_ASPECT_RATIOS, SUPPORTED_IMAGE_SIZES, SUPPORTED_MODELS } from './image-options';
import { MAX_COUNT } from './jobs/options';

export const SPEC_VERSION = 1;
export const PROGRAM_NAME = 'sticker-roller cli';
/** Every usage line and example is rendered with this exact prefix so agents can copy-paste. */
export const PROGRAM = 'bun run cli --';

export interface CliOptionSpec {
  /** Long flag, e.g. `--prompt`. */
  name: string;
  /** Single-dash alias, e.g. `-p`. */
  short?: string;
  /** Value placeholder; the option takes a value exactly when this is set. */
  placeholder?: string;
  /** Enumerated values, rendered inline and enforced by the parser. */
  values?: readonly string[];
  description: string;
  default?: string;
  repeatable?: boolean;
  /** Boolean options only: the opposite flag, which cannot be combined with this one. */
  conflictsWith?: string;
}

export interface CliPositionalSpec {
  name: string;
  description: string;
  required?: boolean;
}

export interface CliCommandSpec {
  /** Command path as typed, e.g. `['asset', 'list']`. */
  path: string[];
  summary: string;
  usage: string[];
  positionals?: CliPositionalSpec[];
  /** Upper bound on positional arguments; defaults to the number of declared positionals. */
  maxPositionals?: number;
  options: CliOptionSpec[];
  notes?: string[];
  examples: string[];
}

export const EXIT_CODES: ReadonlyArray<{ code: number; meaning: string }> = [
  { code: 0, meaning: 'success' },
  { code: 1, meaning: 'runtime error (database, migration, provider, output write)' },
  { code: 2, meaning: 'usage error (unknown flag, bad value, unresolved or ambiguous reference)' },
  { code: 3, meaning: 'generation finished with at least one failed item' },
];

export const OUTPUT_CONTRACT: ReadonlyArray<{ stream: string; rule: string }> = [
  { stream: 'stdout', rule: 'data only: image paths for generate, table or JSON for queries' },
  { stream: 'stderr', rule: 'progress, warnings, errors (error: CODE: message, hint: ..., exit code)' },
  { stream: '--json', rule: 'one JSON document on stdout, never mixed with human-readable text' },
];

export const ENV_VARS: ReadonlyArray<{ name: string; description: string }> = [
  { name: 'DATABASE_PATH', description: 'SQLite file shared with the web app (default ./data/sticker-roller.sqlite)' },
  { name: 'OUTPUT_DIR', description: 'default directory for --out' },
  { name: 'GEMINI_API_KEY', description: 'direct Google API key' },
  { name: 'AI_GATEWAY_URL', description: 'AI Gateway URL; with AI_GATEWAY_TOKEN it replaces the direct API' },
  { name: 'AI_GATEWAY_TOKEN', description: 'AI Gateway token' },
];

const help: CliOptionSpec = { name: '--help', short: '-h', description: 'Show this help and exit 0.' };
const json: CliOptionSpec = {
  name: '--json',
  description: 'Write a single JSON document to stdout instead of human-readable text.',
};
const database: CliOptionSpec = {
  name: '--database',
  short: '-d',
  placeholder: 'path',
  description: 'SQLite database file. Defaults to $DATABASE_PATH, then ./data/sticker-roller.sqlite.',
};
const search: CliOptionSpec = {
  name: '--search',
  short: '-s',
  placeholder: 'text',
  description: 'Only show entries whose name contains this text (case-insensitive).',
};
const includeArchived: CliOptionSpec = {
  name: '--include-archived',
  description: 'Include archived entries. Archived entries cannot be referenced by a generation.',
};
const refPositional: CliPositionalSpec = {
  name: '<name|id>',
  description: 'Exact name, unique name fragment, or full id.',
  required: true,
};

export const CLI_COMMANDS: readonly CliCommandSpec[] = [
  {
    path: ['generate'],
    summary: 'Generate images from a prompt',
    usage: [`${PROGRAM} generate --prompt "<text>" [options]`, `${PROGRAM} --prompt "<text>" [options]`],
    options: [
      {
        name: '--prompt',
        short: '-p',
        placeholder: 'text',
        description:
          'Prompt text, same shape the web composer submits. Supports @[name](asset:ref) and ![alt](image:ref) tokens.',
      },
      {
        name: '--prompt-file',
        placeholder: 'path',
        description: 'Read the prompt from a file instead of --prompt.',
      },
      {
        name: '--asset',
        placeholder: 'name|id',
        description: 'Reference a text asset by name or id. Replaces the matching prompt token.',
        repeatable: true,
      },
      {
        name: '--image',
        placeholder: 'path|id',
        description: 'Attach a reference image: a local file path is uploaded, a library id is reused.',
        repeatable: true,
      },
      {
        name: '--count',
        short: '-n',
        placeholder: 'n',
        description: `How many images to generate, 1-${MAX_COUNT}.`,
        default: '1',
      },
      {
        name: '--model',
        short: '-m',
        placeholder: 'model',
        values: SUPPORTED_MODELS,
        description: 'Image model.',
        default: DEFAULT_MODEL,
      },
      {
        name: '--aspect-ratio',
        short: '-r',
        placeholder: 'ratio',
        values: [AUTO, ...SUPPORTED_ASPECT_RATIOS],
        description: 'Aspect ratio; auto sends no ratio and lets the model decide.',
        default: AUTO,
      },
      {
        name: '--image-size',
        short: '-z',
        placeholder: 'size',
        values: [AUTO, ...SUPPORTED_IMAGE_SIZES],
        description: 'Output size; auto sends no size and lets the model decide.',
        default: AUTO,
      },
      {
        name: '--remove-background',
        description: 'Chroma-key the magenta background to transparent (default).',
        conflictsWith: '--no-remove-background',
      },
      {
        name: '--no-remove-background',
        description: 'Keep the generated background untouched.',
        conflictsWith: '--remove-background',
      },
      {
        name: '--out',
        short: '-o',
        placeholder: 'dir',
        description: 'Directory for the generated files, created if missing. Defaults to $OUTPUT_DIR, then ./output.',
      },
      database,
      json,
      help,
    ],
    notes: [
      'stdout is data: one absolute image path per line, nothing else. Progress and errors go to stderr.',
      'A prompt reference resolves by exact name first, then by unique name fragment; ambiguous or unknown references fail with exit code 2 and list the candidates.',
      'Every run costs real money and every run is recorded in the web job history.',
      '--count > 1 writes one path per image; failed items are reported on stderr and exit code is 3.',
    ],
    examples: [
      `${PROGRAM} --prompt "a chibi cat sticker on a white background" --out ./out`,
      `${PROGRAM} generate --prompt "@[角色设定](asset:角色设定) 画成表情包" --count 2 --out ./out`,
      `${PROGRAM} --prompt-file ./prompt.md --image ./reference.png --aspect-ratio 1:1 --image-size 1K --out ./out`,
    ],
  },
  {
    path: ['asset', 'list'],
    summary: 'List text assets in the shared library',
    usage: [`${PROGRAM} asset list [options]`],
    options: [
      search,
      {
        name: '--category',
        short: '-c',
        placeholder: 'name',
        description: 'Only show assets in this category.',
      },
      includeArchived,
      database,
      json,
      help,
    ],
    notes: [
      'JSON output carries full prompts, which is what an agent needs to pick the right asset; narrow it with --search or --category instead of reading everything.',
      'Use the id from this output (or the exact name) as the reference in a generation prompt.',
    ],
    examples: [
      `${PROGRAM} asset list --json`,
      `${PROGRAM} asset list --search 角色 --json`,
      `${PROGRAM} asset list --category 风格`,
    ],
  },
  {
    path: ['asset', 'show'],
    summary: 'Show one text asset in full',
    usage: [`${PROGRAM} asset show <name|id> [options]`],
    positionals: [refPositional],
    options: [database, json, help],
    notes: ['Prints the complete prompt, category, metadata, and timestamps.'],
    examples: [`${PROGRAM} asset show 角色设定`, `${PROGRAM} asset show 角色设定 --json`],
  },
  {
    path: ['image', 'list'],
    summary: 'List uploaded reference images',
    usage: [`${PROGRAM} image list [options]`],
    options: [search, includeArchived, database, json, help],
    notes: [
      'Never prints image bytes; only id, name, mime type, size, and timestamps.',
      "To actually look at an image, use 'image show <name|id> --out <path>'.",
    ],
    examples: [`${PROGRAM} image list --json`, `${PROGRAM} image list --search 头像`],
  },
  {
    path: ['image', 'show'],
    summary: 'Show one uploaded image, optionally saving it to a file',
    usage: [`${PROGRAM} image show <name|id> [options]`],
    positionals: [refPositional],
    options: [
      {
        name: '--out',
        short: '-o',
        placeholder: 'path',
        description: 'Write the image bytes to this file and print the absolute path on stdout.',
      },
      database,
      json,
      help,
    ],
    notes: ['Without --out only metadata is printed, so a large library stays cheap to inspect.'],
    examples: [`${PROGRAM} image show 头像 --out /tmp/reference.png`, `${PROGRAM} image show 头像 --json`],
  },
  {
    path: ['help'],
    summary: 'Show this help, or the help of one command',
    usage: [`${PROGRAM} help [command] [--json]`],
    positionals: [{ name: '[command]', description: 'Command path to describe, e.g. "generate" or "asset list".' }],
    maxPositionals: 2,
    options: [json, help],
    notes: ['Every command also accepts --help; that wins over everything else on the line and exits 0.'],
    examples: [`${PROGRAM} help`, `${PROGRAM} help generate`, `${PROGRAM} help --json`],
  },
];

const DEFAULT_COMMAND_PATH = ['generate'];
const GROUP_WORDS = CLI_COMMANDS.filter((command) => command.path.length === 2).map((command) => command.path[0]!);

/**
 * Resolve the command path typed at the front of argv, falling back to the default command.
 * Only leading words count: `--prompt "asset list"` is prompt text, never a command.
 */
export function matchCommandPath(argv: readonly string[]): { path: string[]; rest: string[] } {
  const [first, second] = argv;
  if (first === undefined) {
    return { path: DEFAULT_COMMAND_PATH, rest: [] };
  }
  const sub = CLI_COMMANDS.find(
    (command) => command.path.length === 2 && command.path[0] === first && command.path[1] === second,
  );
  if (sub) {
    return { path: sub.path, rest: argv.slice(2) };
  }
  const top = CLI_COMMANDS.find((command) => command.path.length === 1 && command.path[0] === first);
  if (top) {
    return { path: top.path, rest: argv.slice(1) };
  }
  if (GROUP_WORDS.includes(first)) {
    // Unknown subcommand under a known group: report it instead of silently generating.
    return { path: second === undefined ? [first] : [first, second], rest: [] };
  }
  return { path: DEFAULT_COMMAND_PATH, rest: [...argv] };
}

export function findCommand(path: readonly string[]): CliCommandSpec | undefined {
  return CLI_COMMANDS.find(
    (command) => command.path.length === path.length && command.path.every((segment, i) => segment === path[i]),
  );
}

/** Value label including the angle brackets, e.g. `<auto|1:1>`; shared by help and error messages. */
export function optionValueLabel(option: CliOptionSpec): string {
  return `<${(option.values ?? [option.placeholder ?? '']).join('|')}>`;
}

export function isDefaultCommand(path: readonly string[]): boolean {
  return path.length === DEFAULT_COMMAND_PATH.length && path.every((segment, i) => segment === DEFAULT_COMMAND_PATH[i]);
}
