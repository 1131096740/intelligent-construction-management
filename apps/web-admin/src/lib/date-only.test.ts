import { describe, expect, it } from "vitest";
import {
  dateOnlyToUtcMidnightIso,
  utcDateTimeToDateOnly
} from "./date-only";

describe("date-only UTC persistence", () => {
  it("persists a selected business date as UTC midnight without using local timezone", () => {
    expect(dateOnlyToUtcMidnightIso("2026-07-18")).toBe(
      "2026-07-18T00:00:00.000Z"
    );
  });

  it("round-trips the backend UTC-midnight contract to the same date", () => {
    const persisted = dateOnlyToUtcMidnightIso("2026-07-18");
    expect(utcDateTimeToDateOnly(persisted)).toBe("2026-07-18");
  });

  it("rejects impossible dates and returns an empty editor value for malformed server facts", () => {
    expect(() => dateOnlyToUtcMidnightIso("2026-02-30")).toThrow(
      "日期格式不正确"
    );
    expect(utcDateTimeToDateOnly("not-a-date")).toBe("");
  });
});
