import { approvalDate, approvalDateTime } from "./approval-date";
it("prints Beijing approval dates across UTC midnight independently of host time zone", () => {
  const signed = new Date("2026-10-20T01:00:00+08:00");
  expect(approvalDate(signed)).toBe("2026-10-20");
  expect(approvalDateTime(signed)).toBe("2026-10-20 01:00:00");
  expect(approvalDateTime(new Date("2026-10-20T00:00:00+08:00"))).toBe("2026-10-20 00:00:00");
});
