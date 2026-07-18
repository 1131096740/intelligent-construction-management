import { describe, expect, it } from "vitest";
import {
  canAppendSpotProcurementInvoice,
  isSpotProcurementBusinessLocked,
  SPOT_PROCUREMENT_ARCHIVE_TRIGGERS,
  SPOT_PROCUREMENT_DISCREPANCY_STATUSES,
  SPOT_PROCUREMENT_EXPECTED_INVOICE_CONDITIONS,
  SPOT_PROCUREMENT_INVOICE_STATUSES,
  SPOT_PROCUREMENT_PAYMENT_METHODS,
  SPOT_PROCUREMENT_PAYMENT_TYPES,
  SPOT_PROCUREMENT_STATUSES
} from "./spot-procurement";

describe("real-form spot procurement domain contracts", () => {
  it("defines the approved payment types, methods, and invoice conditions", () => {
    expect(SPOT_PROCUREMENT_PAYMENT_TYPES).toEqual([
      "company_direct",
      "handler_reimbursement"
    ]);
    expect(SPOT_PROCUREMENT_PAYMENT_METHODS).toEqual([
      "cash",
      "wechat",
      "alipay",
      "bank_transfer",
      "other"
    ]);
    expect(SPOT_PROCUREMENT_EXPECTED_INVOICE_CONDITIONS).toEqual([
      "no_invoice",
      "vat_general",
      "vat_special"
    ]);
  });

  it("makes invoice state independent from the procurement business status", () => {
    expect(SPOT_PROCUREMENT_INVOICE_STATUSES).toEqual([
      "not_required",
      "pending",
      "uploaded"
    ]);
    expect(SPOT_PROCUREMENT_DISCREPANCY_STATUSES).toEqual([
      "pending",
      "awaiting_replenishment",
      "awaiting_refund",
      "resolved"
    ]);
  });

  it("allows invoice appendix after normal closure or abnormal termination only", () => {
    expect(SPOT_PROCUREMENT_STATUSES).toContain("abnormally_terminated");
    expect(canAppendSpotProcurementInvoice("closed")).toBe(true);
    expect(canAppendSpotProcurementInvoice("abnormally_terminated")).toBe(true);
    expect(canAppendSpotProcurementInvoice("approved_in_progress")).toBe(false);
    expect(isSpotProcurementBusinessLocked("closed")).toBe(true);
    expect(isSpotProcurementBusinessLocked("abnormally_terminated")).toBe(true);
    expect(isSpotProcurementBusinessLocked("approval_pending")).toBe(false);
  });

  it("defines every business fact that must create a new payment archive version", () => {
    expect(SPOT_PROCUREMENT_ARCHIVE_TRIGGERS).toEqual([
      "approval_completed",
      "payment_execution_recorded",
      "payment_execution_voided",
      "refund_recorded",
      "procurement_closed",
      "abnormal_termination_confirmed",
      "invoice_appended"
    ]);
  });
});
