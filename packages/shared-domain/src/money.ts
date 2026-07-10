export type MoneyCents = string;

const NON_NEGATIVE_CENTS_TEXT = /^(0|[1-9]\d*)$/;
const POSITIVE_CENTS_TEXT = /^[1-9]\d*$/;

export function assertNonNegativeMoneyCents(
  value: string,
  fieldName: string
): MoneyCents {
  if (typeof value !== "string" || !NON_NEGATIVE_CENTS_TEXT.test(value)) {
    throw new Error(`${fieldName}必须填写 0 或更大的金额`);
  }
  return value;
}

export function assertPositiveMoneyCents(
  value: string,
  fieldName: string
): MoneyCents {
  if (typeof value !== "string" || !POSITIVE_CENTS_TEXT.test(value)) {
    throw new Error(`${fieldName}必须填写大于 0 的金额`);
  }
  return value;
}
