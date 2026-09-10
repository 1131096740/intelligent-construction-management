import { describe, expect, it } from "vitest";

import {
  NECESSARY_EXPENSE_RESERVE_ENTRY_KINDS,
  NECESSARY_EXPENSE_RESERVE_REASON_KINDS,
  NECESSARY_EXPENSE_RESERVE_STATUSES
} from "./necessary-expense-reserve";

describe("necessary expense reserve contract", () => {
  it("freezes the allowed reasons, append-only entry kinds and lifecycle states", () => {
    expect(NECESSARY_EXPENSE_RESERVE_REASON_KINDS).toEqual([
      "warranty_or_remediation",
      "legal_or_compliance",
      "mandatory_closeout",
      "other_approved_necessary"
    ]);
    expect(NECESSARY_EXPENSE_RESERVE_ENTRY_KINDS).toEqual([
      "establish",
      "increase",
      "release",
      "technical_reversal"
    ]);
    expect(NECESSARY_EXPENSE_RESERVE_STATUSES).toEqual([
      "draft",
      "submitted",
      "attested",
      "confirmed",
      "returned"
    ]);
  });
});
