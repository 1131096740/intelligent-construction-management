import { describe, expect, it } from "vitest";

import {
  PROJECT_FUND_DISPUTE_ENTRY_KINDS,
  PROJECT_FUND_DISPUTE_KINDS,
  PROJECT_FUND_DISPUTE_STATUSES
} from "./project-fund-dispute";

describe("project fund dispute contract", () => {
  it("freezes the allowed dispute kinds, append-only entry kinds and lifecycle states", () => {
    expect(PROJECT_FUND_DISPUTE_KINDS).toEqual([
      "upstream",
      "downstream",
      "inter_subject",
      "external_restriction"
    ]);
    expect(PROJECT_FUND_DISPUTE_ENTRY_KINDS).toEqual([
      "establish",
      "increase",
      "release",
      "technical_reversal"
    ]);
    expect(PROJECT_FUND_DISPUTE_STATUSES).toEqual([
      "draft",
      "submitted",
      "attested",
      "confirmed",
      "returned"
    ]);
  });
});
