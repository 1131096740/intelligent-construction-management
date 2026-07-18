const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export function dateOnlyToUtcMidnightIso(value: string) {
  if (!DATE_ONLY_PATTERN.test(value)) {
    throw new Error("日期格式不正确");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("日期格式不正确");
  }
  return `${value}T00:00:00.000Z`;
}

export function utcDateTimeToDateOnly(
  value: string | null | undefined
) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toISOString().slice(0, 10);
}
