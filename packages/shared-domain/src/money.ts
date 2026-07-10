export type MoneyCents = number;

export type MoneyCentsText = string;

const NON_NEGATIVE_CENTS_TEXT = /^(0|[1-9]\d*)$/;
const POSITIVE_CENTS_TEXT = /^[1-9]\d*$/;

export function assertNonNegativeMoneyCents(
  value: number,
  fieldName: string
): MoneyCents {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer amount in cents`);
  }
  return value;
}

export function assertPositiveMoneyCents(
  value: number,
  fieldName: string
): MoneyCents {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer amount in cents`);
  }
  return value;
}

export function assertNonNegativeMoneyCentsText(
  value: string,
  fieldName: string
): MoneyCentsText {
  if (!NON_NEGATIVE_CENTS_TEXT.test(value)) {
    throw new Error(`${fieldName}必须填写 0 或更大的金额`);
  }
  return value;
}

export function assertPositiveMoneyCentsText(
  value: string,
  fieldName: string
): MoneyCentsText {
  if (!POSITIVE_CENTS_TEXT.test(value)) {
    throw new Error(`${fieldName}必须填写大于 0 的金额`);
  }
  return value;
}
