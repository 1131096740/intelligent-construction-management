import { BadRequestException } from "@nestjs/common";
import { normalizeProjectionExportFilters } from "./operating-projection.service";

describe("projection export filters", () => {
  it.each([
    { occurredFrom: "2026-09-06", occurredTo: "2026-09-05" },
    { occurredTo: "2026-09-06" }, { occurredFrom: "2026-02-30" },
    { occurredFrom: ["2026-09-01"] }, { rowStatus: "unknown" },
    { occurredTo: "2026-09-05T00:00:00Z" }
  ])("rejects invalid service input %j", (input) => {
    expect(() => normalizeProjectionExportFilters(input as never, "2026-09-05"))
      .toThrow(BadRequestException);
  });
  it("accepts same business day, leap day and an empty from-only future range", () => {
    expect(normalizeProjectionExportFilters({ occurredFrom: "2024-02-29", occurredTo: "2026-09-05",
      rowStatus: "confirmed" }, "2026-09-05")).toEqual({ occurredFrom: "2024-02-29",
      occurredTo: "2026-09-05", rowStatus: "confirmed" });
    expect(normalizeProjectionExportFilters({ occurredFrom: "2026-09-06" }, "2026-09-05"))
      .toEqual({ occurredFrom: "2026-09-06" });
  });
});
