/**
 * help 渲染：文本与 JSON 都由 `cli-spec.ts` 生成，输出不含 ANSI 转义、不随终端宽度变化，
 * 因此可以被 agent 直接 diff 和断言。
 */

import {
  CLI_COMMANDS,
  type CliCommandSpec,
  type CliOptionSpec,
  ENV_VARS,
  EXIT_CODES,
  findCommand,
  isDefaultCommand,
  OUTPUT_CONTRACT,
  optionValueLabel,
  PROGRAM,
  PROGRAM_NAME,
  SPEC_VERSION,
} from './cli-spec';

const SECTION_INDENT = '  ';
const MAX_COLUMN = 38;

const optionPrefix = (option: CliOptionSpec): string => {
  const flags = option.short ? `${option.short}, ${option.name}` : `    ${option.name}`;
  if (!option.placeholder) {
    return flags;
  }
  return `${flags} ${optionValueLabel(option)}`;
};

const optionSuffix = (option: CliOptionSpec): string => {
  const parts: string[] = [];
  if (option.default !== undefined) {
    parts.push(`default: ${option.default}`);
  }
  if (option.repeatable) {
    parts.push('repeatable');
  }
  return parts.length ? ` (${parts.join(', ')})` : '';
};

function renderOptionsBlock(options: readonly CliOptionSpec[]): string[] {
  const prefixes = options.map(optionPrefix);
  const width = Math.min(MAX_COLUMN, Math.max(...prefixes.map((prefix) => prefix.length)) + 2);
  return options.map((option, index) => {
    const prefix = prefixes[index]!;
    const description = `${option.description}${optionSuffix(option)}`;
    if (prefix.length + 2 > width) {
      return `${SECTION_INDENT}${prefix}\n${SECTION_INDENT.repeat(2)}${description}`;
    }
    return `${SECTION_INDENT}${prefix.padEnd(width)}${description}`;
  });
}

function renderSection(title: string, lines: readonly string[]): string[] {
  return lines.length ? ['', title, ...lines] : [];
}

function renderExitCodes(): string[] {
  const width = Math.max(...EXIT_CODES.map((entry) => String(entry.code).length));
  return EXIT_CODES.map((entry) => `${SECTION_INDENT}${String(entry.code).padEnd(width)}  ${entry.meaning}`);
}

function renderOutputContract(): string[] {
  const width = Math.max(...OUTPUT_CONTRACT.map((entry) => entry.stream.length));
  return OUTPUT_CONTRACT.map((entry) => `${SECTION_INDENT}${entry.stream.padEnd(width)}  ${entry.rule}`);
}

function renderEnv(): string[] {
  const width = Math.max(...ENV_VARS.map((entry) => entry.name.length));
  return ENV_VARS.map((entry) => `${SECTION_INDENT}${entry.name.padEnd(width)}  ${entry.description}`);
}

const FOOTER = `Run '${PROGRAM} help' for exit codes, the output contract, and environment variables.`;

/** Help for one command. */
export function renderCommandHelp(command: CliCommandSpec): string {
  const lines = [
    `${PROGRAM_NAME} ${command.path.join(' ')} — ${command.summary}`,
    ...renderSection(
      'USAGE',
      command.usage.map((line) => `${SECTION_INDENT}${line}`),
    ),
    ...renderSection(
      'ARGUMENTS',
      (command.positionals ?? []).map(
        (positional) => `${SECTION_INDENT}${positional.name.padEnd(12)}${positional.description}`,
      ),
    ),
    ...renderSection('OPTIONS', renderOptionsBlock(command.options)),
    ...renderSection(
      'NOTES',
      (command.notes ?? []).map((note) => `${SECTION_INDENT}- ${note}`),
    ),
    ...renderSection(
      'EXAMPLES',
      command.examples.map((example) => `${SECTION_INDENT}${example}`),
    ),
    '',
    FOOTER,
  ];
  return `${lines.join('\n')}\n`;
}

/** Top-level help: the command list plus the sections every command shares. */
export function renderTopLevelHelp(): string {
  const commands = CLI_COMMANDS.map((command) => command.path.join(' '));
  const width = Math.max(...commands.map((command) => command.length));
  const lines = [
    `${PROGRAM_NAME} — generate sticker images and explore the shared asset library`,
    ...renderSection('USAGE', [
      `${SECTION_INDENT}${PROGRAM} <command> [options]`,
      `${SECTION_INDENT}${PROGRAM} --prompt "<text>" [options]`,
    ]),
    ...renderSection(
      'COMMANDS',
      CLI_COMMANDS.map((command) => {
        const label = command.path.join(' ');
        const suffix = isDefaultCommand(command.path) ? ' (default command)' : '';
        return `${SECTION_INDENT}${label.padEnd(width)}  ${command.summary}${suffix}`;
      }),
    ),
    ...renderSection('OPTIONS', renderOptionsBlock([{ name: '--help', short: '-h', description: 'Show help.' }])),
    ...renderSection('EXIT CODES', renderExitCodes()),
    ...renderSection('OUTPUT', renderOutputContract()),
    ...renderSection('ENV', renderEnv()),
    '',
    `Run '${PROGRAM} <command> --help' for command options.`,
    `Run '${PROGRAM} help --json' for the machine-readable spec (commands, values, defaults, exit codes).`,
  ];
  return `${lines.join('\n')}\n`;
}

/** Help for a command path, or the top-level help when the path is unknown or empty. */
export function renderHelp(path: readonly string[] = []): string {
  const command = path.length ? findCommand(path) : undefined;
  return command ? renderCommandHelp(command) : renderTopLevelHelp();
}

/** Machine-readable spec: field-for-field what the text help shows. */
export function renderHelpJson(): string {
  return `${JSON.stringify(helpSpec(), null, 2)}\n`;
}

export function helpSpec() {
  return {
    specVersion: SPEC_VERSION,
    program: PROGRAM_NAME,
    invocation: PROGRAM,
    defaultCommand: 'generate',
    commands: CLI_COMMANDS.map((command) => ({
      path: command.path,
      name: command.path.join(' '),
      summary: command.summary,
      usage: command.usage,
      positionals: command.positionals ?? [],
      options: command.options.map((option) => ({
        name: option.name,
        short: option.short ?? null,
        value: option.placeholder ? optionValueLabel(option) : null,
        values: option.values ?? null,
        description: option.description,
        default: option.default ?? null,
        repeatable: option.repeatable ?? false,
        conflictsWith: option.conflictsWith ?? null,
      })),
      notes: command.notes ?? [],
      examples: command.examples,
    })),
    exitCodes: EXIT_CODES,
    outputContract: OUTPUT_CONTRACT,
    env: ENV_VARS,
  };
}
