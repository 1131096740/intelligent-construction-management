const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const shanghaiDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: SHANGHAI_TIME_ZONE,
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hourCycle: "h23"
});

export function addShanghaiCalendarMonths(value: Date, months: number): Date {
  const shanghaiParts = Object.fromEntries(
    shanghaiDateTimeFormatter
      .formatToParts(value)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value: partValue }) => [type, Number(partValue)])
  );
  const targetMonthIndex = shanghaiParts.month - 1 + months;
  const targetYear = shanghaiParts.year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(shanghaiParts.day, lastDay),
      shanghaiParts.hour,
      shanghaiParts.minute,
      shanghaiParts.second,
      value.getUTCMilliseconds()
    ) - SHANGHAI_UTC_OFFSET_MS
  );
}
