import { describe, expect, it } from "vitest";
import { normalizeBusinessStatusSummaryItems } from "./business-status-summary.config";

describe("normalizeBusinessStatusSummaryItems", () => {
  it("normalizes blank values and default tone", () => {
    expect(normalizeBusinessStatusSummaryItems([{ label: " 当前状态 ", value: " " }])).toEqual([
      { label: "当前状态", value: "-", tone: "default" }
    ]);
  });
});
