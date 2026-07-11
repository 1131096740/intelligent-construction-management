export const POSTGRES_BIGINT_MIN = -9_223_372_036_854_775_808n;
export const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

export function isWithinPostgresBigIntRange(value: bigint): boolean {
  return value >= POSTGRES_BIGINT_MIN && value <= POSTGRES_BIGINT_MAX;
}
