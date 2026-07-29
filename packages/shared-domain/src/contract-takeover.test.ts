import { describe, expect, it } from "vitest";
import {
  CONTRACT_TAKEOVER_BALANCE_ENTRY_KINDS,
  CONTRACT_TAKEOVER_BALANCE_TYPES,
  CONTRACT_TAKEOVER_PERFORMANCE_STATUSES
} from "./contract-takeover";

describe("historical contract takeover vocabulary", () => {
  it("uses the five locked performance statuses without an ambiguous ended state", () => {
    expect(CONTRACT_TAKEOVER_PERFORMANCE_STATUSES).toEqual([
      "not_started",
      "performing",
      "suspended",
      "completed",
      "terminated"
    ]);
    expect(CONTRACT_TAKEOVER_PERFORMANCE_STATUSES).not.toContain("ended");
  });

  it("locks balance accounts and append-only entry kinds to the approved vocabulary", () => {
    expect(CONTRACT_TAKEOVER_BALANCE_TYPES).toEqual([
      "historical_advance",
      "abnormal_overpay"
    ]);
    expect(CONTRACT_TAKEOVER_BALANCE_ENTRY_KINDS).toEqual([
      "opening",
      "deduction",
      "correction",
      "reversal",
      "reclassification"
    ]);
  });
});
