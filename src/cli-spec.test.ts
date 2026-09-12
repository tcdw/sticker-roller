import { describe, expect, test } from 'bun:test';
import { helpSpec, renderCommandHelp, renderHelp, renderTopLevelHelp } from './cli-help';
import { optionValue, parseCliArgs } from './cli-parse';
import { CLI_COMMANDS, type CliCommandSpec, type CliOptionSpec, EXIT_CODES, optionValueLabel } from './cli-spec';
import type { CliError } from './errors';

/** A command line that satisfies required positionals so option-level assertions can run. */
function argvFor(command: CliCommandSpec, option: CliOptionSpec, value: string): string[] {
  const positionals = (command.positionals ?? []).map(() => 'demo');
  return [...command.path, ...positionals, option.name, value];
}

describe('cli spec hygiene', () => {
  test('flags are unique per command and repeatable options always take a value', () => {
    for (const command of CLI_COMMANDS) {
      const names = new Set<string>();
      const shorts = new Set<string>();
      for (const option of command.options) {
        expect(names.has(option.name)).toBe(false);
        names.add(option.name);
        if (option.short) {
          expect(shorts.has(option.short)).toBe(false);
          shorts.add(option.short);
        }
        if (option.repeatable) {
          expect(option.placeholder).toBeTruthy();
        }
        if (option.conflictsWith) {
          expect(command.options.some((candidate) => candidate.name === option.conflictsWith)).toBe(true);
        }
      }
      expect(command.usage.length).toBeGreaterThan(0);
      expect(command.examples.length).toBeGreaterThan(0);
    }
  });
});

describe('help rendering', () => {
  test('text help documents every flag, short name, value set, and default', () => {
    for (const command of CLI_COMMANDS) {
      const text = renderCommandHelp(command);
      expect(text).toContain(`${command.path.join(' ')} — ${command.summary}`);
      for (const line of command.usage) {
        expect(text).toContain(line);
      }
      for (const example of command.examples) {
        expect(text).toContain(example);
      }
      for (const option of command.options) {
        expect(text).toContain(option.name);
        if (option.short) {
          expect(text).toContain(`${option.short}, ${option.name}`);
        }
        if (option.values) {
          expect(text).toContain(optionValueLabel(option));
        }
        if (option.default) {
          expect(text).toContain(`default: ${option.default}`);
        }
        if (option.repeatable) {
          expect(text).toContain('(repeatable)');
        }
      }
    }
  });
  test('every command is listed in the top-level command block', () => {
    const text = renderTopLevelHelp();
    for (const command of CLI_COMMANDS) {
      expect(text).toContain(command.path.join(' '));
      expect(text).toContain(command.summary);
    }
    for (const entry of EXIT_CODES) {
      expect(text).toContain(String(entry.code));
    }
  });
  test('rendering is deterministic, colourless, and terminal-width independent', () => {
    const previous = process.env.COLUMNS;
    const wide = renderHelp(['generate']);
    const narrow = renderCommandHelp(CLI_COMMANDS[0]!);
    process.env.COLUMNS = '40';
    const afterResize = renderHelp(['generate']);
    if (previous === undefined) {
      delete process.env.COLUMNS;
    } else {
      process.env.COLUMNS = previous;
    }
    expect(afterResize).toBe(wide);
    expect(narrow).toBe(wide);
    expect(wide).not.toContain('\u001b[');
    expect(renderTopLevelHelp()).not.toContain('\u001b[');
  });
  test('json spec mirrors the text help option-for-option', () => {
    const spec = helpSpec();
    expect(spec.commands.map((command) => command.name)).toEqual(CLI_COMMANDS.map((command) => command.path.join(' ')));
    for (const [index, command] of CLI_COMMANDS.entries()) {
      const json = spec.commands[index]!;
      expect(json.usage).toEqual(command.usage);
      expect(json.examples).toEqual(command.examples);
      expect(json.options.map((option) => option.name)).toEqual(command.options.map((option) => option.name));
      for (const [optionIndex, option] of command.options.entries()) {
        const jsonOption = json.options[optionIndex]!;
        expect(jsonOption.values).toEqual(option.values ?? null);
        expect(jsonOption.default).toEqual(option.default ?? null);
        expect(jsonOption.repeatable).toBe(option.repeatable ?? false);
        expect(jsonOption.value).toBe(option.placeholder ? optionValueLabel(option) : null);
      }
    }
    expect(spec.exitCodes).toEqual(EXIT_CODES);
    expect(spec.defaultCommand).toBe('generate');
  });
});

describe('cli parsing', () => {
  test('the parser accepts every declared value and rejects anything else', () => {
    for (const command of CLI_COMMANDS) {
      for (const option of command.options.filter((candidate) => candidate.values)) {
        for (const value of option.values!) {
          const invocation = parseCliArgs(argvFor(command, option, value));
          expect(invocation.kind).toBe('command');
          if (invocation.kind === 'command') {
            expect(optionValue(invocation.values, option.name)).toBe(value);
          }
        }
        const rejected = (() => {
          try {
            parseCliArgs(argvFor(command, option, 'not-a-real-value'));
            return undefined;
          } catch (error) {
            return error as CliError;
          }
        })();
        expect(rejected?.code).toBe('USAGE');
        expect(rejected?.message).toContain(option.values!.join(', '));
      }
    }
  });
  test('the default command is generate when no command word is typed', () => {
    const invocation = parseCliArgs(['--prompt', 'a cat']);
    expect(invocation.kind).toBe('command');
    if (invocation.kind === 'command') {
      expect(invocation.command.path).toEqual(['generate']);
      expect(optionValue(invocation.values, '--prompt')).toBe('a cat');
    }
  });
  test('a prompt that spells a command name is still prompt text', () => {
    const invocation = parseCliArgs(['--prompt', 'asset', '--out', './out']);
    expect(invocation.kind).toBe('command');
    if (invocation.kind === 'command') {
      expect(invocation.command.path).toEqual(['generate']);
      expect(invocation.positionals).toEqual([]);
    }
  });
  test('repeatable options collect every occurrence in order', () => {
    const invocation = parseCliArgs(['--prompt', 'x', '--asset', 'one', '--asset', 'two']);
    expect(invocation.kind).toBe('command');
    if (invocation.kind === 'command') {
      expect(invocation.values.asset).toEqual(['one', 'two']);
    }
  });
  test('--help wins over every other argument on the line', () => {
    expect(parseCliArgs(['--bogus', '--help'])).toEqual({ kind: 'help', path: ['generate'], json: false });
    expect(parseCliArgs(['asset', 'show', '--help'])).toEqual({ kind: 'help', path: ['asset', 'show'], json: false });
    // `help --json` is the help command itself, not the help flag.
    expect(parseCliArgs(['help', '--json'])).toMatchObject({ kind: 'command', json: true, positionals: [] });
  });
  test('usage errors carry a stable code and a hint', () => {
    const cases: Array<[string[], RegExp]> = [
      [['asset', 'bogus'], /unknown command/],
      [['--nope'], /unknown option/],
      [['--prompt'], /requires <text>/],
      [['--prompt', 'x', 'extra'], /unexpected argument/],
      [['asset', 'show'], /missing argument/],
      [['--prompt', 'x', '--remove-background', '--no-remove-background'], /cannot be combined/],
    ];
    for (const [argv, pattern] of cases) {
      const error = (() => {
        try {
          parseCliArgs(argv);
          return undefined;
        } catch (caught) {
          return caught as CliError;
        }
      })();
      expect(error?.code).toBe('USAGE');
      expect(error?.message).toMatch(pattern);
      expect(error?.hint).toContain('--help');
    }
  });
});
