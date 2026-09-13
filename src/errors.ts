/** Raised when caller-supplied input fails validation. The HTTP API maps it to 400 INVALID_INPUT. */
export class InputError extends Error {}

/**
 * Raised when the local configuration (environment variables) cannot satisfy the request,
 * e.g. the selected image provider has no key. Deliberately distinct from InputError:
 * the caller cannot fix it by editing the command line, so the CLI exits 1, not 2.
 * The message may only name environment variables, never their values.
 */
export class ConfigError extends Error {
  /** Environment variable names the operator has to set; values are never included. */
  readonly missingEnv: readonly string[];
  constructor(message: string, missingEnv: readonly string[] = []) {
    super(message);
    this.missingEnv = missingEnv;
  }
}

export type CliErrorCode = 'USAGE' | 'NOT_FOUND' | 'AMBIGUOUS' | 'RUNTIME' | 'CONFIG' | 'PARTIAL_FAILURE';

/** CLI-facing failure with a stable machine-readable code and an optional hint line. */
export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly hint?: string;
  constructor(code: CliErrorCode, message: string, hint?: string) {
    super(message);
    this.code = code;
    this.hint = hint;
  }
}
