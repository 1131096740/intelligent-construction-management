const UNICODE_WHITESPACE_SEQUENCE = /[\p{White_Space}\uFEFF]+/gu;
const UNICODE_WHITESPACE_EDGES =
  /^[\p{White_Space}\uFEFF]+|[\p{White_Space}\uFEFF]+$/gu;

export function trimUnicodeWhitespace(value: string): string {
  return value.replace(UNICODE_WHITESPACE_EDGES, "");
}

export function collapseUnicodeWhitespace(value: string): string {
  return trimUnicodeWhitespace(value).replace(UNICODE_WHITESPACE_SEQUENCE, " ");
}

export function isUnicodeBlank(value: string): boolean {
  return trimUnicodeWhitespace(value).length === 0;
}
