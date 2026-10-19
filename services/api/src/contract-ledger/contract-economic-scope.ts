/** 同一工程分项在文书复核和结算分配中使用完全相同的身份。 */
export function normalizeEconomicScope(value: string) {
  return value.normalize("NFKC").replace(/\s/gu, "").toLowerCase();
}
