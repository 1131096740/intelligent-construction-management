export type MoneyCents = number;

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
