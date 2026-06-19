import { describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION_STATUSES,
  PAYMENT_REQUEST_STATUSES,
  SETTLEMENT_STATUSES
} from "./statuses";

describe("domain statuses", () => {
  it("keeps contract and settlement effectiveness explicit", () => {
    expect(CONTRACT_VERSION_STATUSES).toContain("effective");
    expect(SETTLEMENT_STATUSES).toContain("effective");
  });

  it("keeps payment approval separate from actual payment", () => {
    expect(PAYMENT_REQUEST_STATUSES).toContain("approved_pending_payment");
    expect(PAYMENT_REQUEST_STATUSES).toContain("paid");
  });
});
