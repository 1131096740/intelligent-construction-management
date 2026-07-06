import { describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION_STATUSES,
  canCreatePaymentFromSettlementStatus,
  canCreateSettlementFromContractStatus,
  PAYMENT_REQUEST_STATUSES,
  SETTLEMENT_STATUSES
} from "./statuses";

describe("domain statuses", () => {
  it("keeps contract and settlement effectiveness explicit", () => {
    expect(CONTRACT_VERSION_STATUSES).toContain("effective");
    expect(SETTLEMENT_STATUSES).toContain("effective");
  });

  it("keeps payment approval separate from actual payment", () => {
    expect(PAYMENT_REQUEST_STATUSES).toContain("approval_pending");
    expect(PAYMENT_REQUEST_STATUSES).toContain("approved_pending_payment");
    expect(PAYMENT_REQUEST_STATUSES).toContain("paid");
    expect(PAYMENT_REQUEST_STATUSES).toContain("withdrawn");
  });

  it("allows settlements only after the contract version is effective", () => {
    expect(canCreateSettlementFromContractStatus("effective")).toBe(true);
    expect(canCreateSettlementFromContractStatus("approved_pending_seal")).toBe(false);
    expect(canCreateSettlementFromContractStatus("pending_archive_confirm")).toBe(false);
  });

  it("allows payment requests only after the settlement is effective", () => {
    expect(canCreatePaymentFromSettlementStatus("effective")).toBe(true);
    expect(canCreatePaymentFromSettlementStatus("partially_paid")).toBe(true);
    expect(canCreatePaymentFromSettlementStatus("withdrawn")).toBe(false);
    expect(canCreatePaymentFromSettlementStatus("approved_pending_archive")).toBe(false);
    expect(canCreatePaymentFromSettlementStatus("pending_archive_confirm")).toBe(false);
  });
});
