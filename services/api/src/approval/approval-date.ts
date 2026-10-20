/** Approval actions are displayed in the system business time zone, independent of server TZ. */
export function approvalDateTime(value: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).format(value);
}
export function approvalDate(value: Date): string { return approvalDateTime(value).slice(0, 10); }
