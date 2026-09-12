import {
  CLI_COMMANDS,
  type CliCommandSpec,
  type CliOptionSpec,
  findCommand,
  matchCommandPath,
  optionValueLabel,
  PROGRAM,
} from './cli-spec';
import { CliError } from './errors';

/** Raw flag values: booleans are `true`, value options are strings, repeatable options are always arrays. */
export type ParsedValues = Record<string, string | true | string[]>;

export type ParsedInvocation =
  | { kind: 'help'; path: string[]; json: boolean }
  | { kind: 'command'; command: CliCommandSpec; values: ParsedValues; positionals: string[]; json: boolean };

const usageHint = (path: readonly string[]) =>
  `run '${PROGRAM}${path.length ? ` ${path.join(' ')}` : ''} --help' for usage`;

function setValue(values: ParsedValues, spec: CliOptionSpec, value: string | true): void {
  const key = spec.name.replace(/^--/, '');
  if (spec.repeatable) {
    // Repeatable options always take a value; a boolean repeatable flag would be a spec bug,
    // which src/cli-spec.test.ts rejects.
    const current = values[key];
    const list = Array.isArray(current) ? current : [];
    if (typeof value === 'string') {
      list.push(value);
    }
    values[key] = list;
    return;
  }
  values[key] = value;
}

/**
 * Parse argv against the declarative spec. `--help` wins over everything else on the line,
 * including malformed arguments, so any command can always explain itself.
 */
export function parseCliArgs(argv: readonly string[]): ParsedInvocation {
  const { path, rest } = matchCommandPath(argv);
  const command = findCommand(path);
  if (rest.includes('--help') || rest.includes('-h')) {
    return { kind: 'help', path, json: rest.includes('--json') };
  }
  if (!command) {
    throw new CliError(
      'USAGE',
      `unknown command: ${path.join(' ')}`,
      `known commands: ${CLI_COMMANDS.map((candidate) => candidate.path.join(' ')).join(', ')} (run '${PROGRAM} --help' for usage)`,
    );
  }
  const byFlag = new Map<string, CliOptionSpec>();
  for (const option of command.options) {
    byFlag.set(option.name, option);
    if (option.short) {
      byFlag.set(option.short, option);
    }
  }
  const values: ParsedValues = {};
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i]!;
    if (token === '--') {
      positionals.push(...rest.slice(i + 1));
      break;
    }
    if (token === '-' || !token.startsWith('-')) {
      positionals.push(token);
      continue;
    }
    const spec = byFlag.get(token);
    if (!spec) {
      throw new CliError('USAGE', `unknown option: ${token}`, usageHint(path));
    }
    if (!spec.placeholder) {
      setValue(values, spec, true);
      continue;
    }
    const next = rest[i + 1];
    if (next === undefined || byFlag.has(next)) {
      throw new CliError('USAGE', `${spec.name} requires ${optionValueLabel(spec)}`, usageHint(path));
    }
    if (spec.values && !spec.values.includes(next)) {
      throw new CliError(
        'USAGE',
        `${spec.name} must be one of: ${spec.values.join(', ')} (got "${next}")`,
        usageHint(path),
      );
    }
    i++;
    setValue(values, spec, next);
  }
  for (const option of command.options) {
    const key = option.name.replace(/^--/, '');
    const opposite = option.conflictsWith?.replace(/^--/, '');
    if (values[key] !== undefined && opposite !== undefined && values[opposite] !== undefined) {
      throw new CliError('USAGE', `${option.name} and ${option.conflictsWith} cannot be combined`, usageHint(path));
    }
  }
  const required = (command.positionals ?? []).filter((positional) => positional.required).length;
  const max = command.maxPositionals ?? (command.positionals ?? []).length;
  if (positionals.length < required) {
    const missing = (command.positionals ?? []).slice(positionals.length).map((positional) => positional.name);
    throw new CliError('USAGE', `missing argument: ${missing.join(' ')}`, usageHint(path));
  }
  if (positionals.length > max) {
    throw new CliError('USAGE', `unexpected argument: ${positionals[max]}`, usageHint(path));
  }
  return { kind: 'command', command, values, positionals, json: values.json !== undefined };
}

/** Last value of a (possibly repeatable) option. */
export function optionValue(values: ParsedValues, name: string): string | undefined {
  const value = values[name.replace(/^--/, '')];
  if (Array.isArray(value)) {
    return value.at(-1) as string | undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

/** Every value of a repeatable option, in the order given. */
export function optionList(values: ParsedValues, name: string): string[] {
  const value = values[name.replace(/^--/, '')];
  if (Array.isArray(value)) {
    return value as string[];
  }
  return typeof value === 'string' ? [value] : [];
}

export function flagSet(values: ParsedValues, name: string): boolean {
  return values[name.replace(/^--/, '')] !== undefined;
}
