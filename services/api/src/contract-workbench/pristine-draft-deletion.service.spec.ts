import { threeCalendarMonthsAfter } from "./pristine-draft-deletion.service";

describe("threeCalendarMonthsAfter", () => {
  it("clamps month-end dates instead of overflowing into a fourth month", () => {
    expect(threeCalendarMonthsAfter(new Date("2026-01-31T12:34:56.000Z"))).toEqual(
      new Date("2026-04-30T12:34:56.000Z")
    );
    expect(threeCalendarMonthsAfter(new Date("2026-11-30T12:34:56.000Z"))).toEqual(
      new Date("2027-02-28T12:34:56.000Z")
    );
  });

  it("uses the China calendar date even when it differs from UTC", () => {
    expect(threeCalendarMonthsAfter(new Date("2026-01-30T16:30:00.000Z"))).toEqual(
      new Date("2026-04-29T16:30:00.000Z")
    );
    expect(threeCalendarMonthsAfter(new Date("2026-02-28T16:00:00.000Z"))).toEqual(
      new Date("2026-05-31T16:00:00.000Z")
    );
  });
});
