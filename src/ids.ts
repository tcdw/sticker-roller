const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True when the value is a canonical UUID, the only identifier shape the API accepts in paths and references. */
export function isUuid(value: string | undefined): value is string {
  return !!value && ID_PATTERN.test(value);
}
