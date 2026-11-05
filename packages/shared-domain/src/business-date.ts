const DAY = /^\d{4}-\d{2}-\d{2}$/u;
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/iu;

function validDay(value: string) {
  if (!DAY.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Date-only and offset-free input describe Beijing business time. Explicit
 * offsets describe an instant and are never replaced with a guessed offset. */
function parseChinaInput(value: string, label: string): Date {
  if (DAY.test(value)) {
    if (!validDay(value)) throw new Error(`${label}格式不正确，请重新选择${label}`);
    return new Date(`${value}T00:00:00.000+08:00`);
  }
  const match = TIMESTAMP.exec(value);
  if (!match || !validDay(match[1]!) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] ?? 0) > 59) {
    throw new Error(`${label}格式不正确，请重新选择${label}`);
  }
  const rawOffset = match[6] ?? "+08:00";
  const offset = rawOffset.toUpperCase() === "Z" ? "Z" : rawOffset.includes(":") ? rawOffset : `${rawOffset.slice(0, 3)}:${rawOffset.slice(3)}`;
  const parsed = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4] ?? "00"}${match[5] ?? ""}${offset}`);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label}格式不正确，请重新选择${label}`);
  return parsed;
}

function beijingParts(value: Date) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("日期格式不正确，请核对实际日期");
  return Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(value).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
}

export function chinaDateOnly(value: Date | string = new Date()): string {
  if (typeof value === "string" && DAY.test(value)) {
    if (!validDay(value)) throw new Error("日期格式不正确，请核对实际日期");
    return value;
  }
  const parts = beijingParts(typeof value === "string" ? parseChinaInput(value, "日期") : value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function chinaDateTimeInput(value: Date = new Date()): string {
  const parts = beijingParts(value);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function requiredPastChinaDate(value: string, label: string, now: Date = new Date()): Date {
  if (typeof value !== "string" || !value.trim()) throw new Error(`请选择${label}`);
  const parsed = parseChinaInput(value.trim(), label);
  if (!Number.isFinite(now.getTime())) throw new Error("当前日期无效，请稍后重试");
  if (parsed.getTime() > now.getTime()) throw new Error(`${label}不能晚于当前时间，请核对实际日期后重试`);
  return parsed;
}

export function assertRefundNotBeforePaymentChinaDate(refundDate: Date | string, paidDate: Date | string): void {
  if (chinaDateOnly(refundDate) < chinaDateOnly(paidDate)) {
    throw new Error("退款到账日期不能早于付款日期，请核对实际日期后重试");
  }
}
