/** Raised when caller-supplied input fails validation. The HTTP API maps it to 400 INVALID_INPUT. */
export class InputError extends Error {}

export type CliErrorCode = 'USAGE' | 'NOT_FOUND' | 'AMBIGUOUS' | 'RUNTIME' | 'PARTIAL_FAILURE';

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
