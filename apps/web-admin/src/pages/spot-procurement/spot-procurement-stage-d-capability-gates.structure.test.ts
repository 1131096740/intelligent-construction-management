import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const workbenchPage = read("./SpotProcurementWorkbenchPage.vue");
const detailPage = read("./SpotProcurementDetailPage.vue");
const paymentPage = read("./SpotProcurementPaymentDetailPage.vue");
const receiptPage = read("./SpotProcurementReceiptPage.vue");
const spotApi = read("../../api/spot-procurement.api.ts");

describe("spot procurement stage D capability gates", () => {
  it("exposes business-domain upload APIs", () => {
    for (const apiName of [
      "uploadSpotProcurementCreateFile",
      "uploadSpotProcurementDraftFile",
      "uploadSpotProcurementPaymentDraftFile",
      "uploadSpotProcurementExecutionVoucherFile",
      "uploadSpotProcurementReceiptPhotoFile",
      "uploadSpotProcurementRefundVoucherFile",
      "uploadSpotProcurementInvoiceFile"
    ]) {
      expect(spotApi).toContain(`function ${apiName}(`);
    }
  });

  it("rechecks the exact project create action before creating a procurement", () => {
    expect(workbenchPage).toContain(
      "async function createSpotProcurementDraftWithCapability("
    );
    expect(workbenchPage).toContain('"create_spot_procurement"');
    expect(workbenchPage).toContain("fetchSpotProcurementCapabilities");
  });

  it.each([
    ["edit_draft", "updateSpotProcurementDraftWithCapability"],
    ["abandon_application", "abandonSpotProcurementDraftWithCapability"],
    ["create_payment_draft", "recreateSpotProcurementPaymentDraftWithCapability"],
    ["create_version", "createSpotProcurementVersionWithCapability"],
    ["void_procurement", "voidSpotProcurementWithCapability"],
    ["download_application_pdf", "downloadSpotProcurementApprovalFormWithCapability"]
  ])("rechecks the fresh procurement %s action before mutation", (action, helper) => {
    expect(detailPage).toContain(`async function ${helper}(`);
    expect(detailPage).toContain(`"${action}"`);
    expect(detailPage).toContain("fetchSpotProcurementDetail");
  });

  it.each([
    ["edit_draft", "updateSpotProcurementPaymentDraftWithCapability"],
    ["manage_payer", "updateSpotProcurementPaymentPayerWithCapability"],
    ["abandon_payment_draft", "abandonSpotProcurementPaymentDraftWithCapability"],
    ["withdraw_approval", "withdrawSpotProcurementPaymentWithCapability"],
    ["record_execution", "recordSpotProcurementPaymentExecutionWithCapability"],
    ["submit_approval", "submitSpotProcurementPaymentWithCapability"],
    ["void_payment", "voidSpotProcurementPaymentWithCapability"],
    ["download_payment_pdf", "downloadSpotProcurementPaymentApprovalFormWithCapability"]
  ])("rechecks the fresh payment %s action before mutation", (action, helper) => {
    expect(paymentPage).toContain(`async function ${helper}(`);
    expect(paymentPage).toContain(`"${action}"`);
    expect(paymentPage).toContain("fetchSpotProcurementPaymentDetail");
  });

  it.each([
    ["edit_receipt", "updateSpotProcurementReceiptDraftWithCapability"],
    ["append_receipt_photo", "attachSpotProcurementReceiptPhotoWithCapability"],
    ["remove_receipt_photo", "deleteSpotProcurementReceiptPhotoWithCapability"],
    ["delegate_receipt", "createSpotProcurementReceiptDelegationWithCapability"],
    ["reset_receipt_draft", "resetSpotProcurementReceiptDraftWithCapability"],
    ["review_receipt", "reviewSpotProcurementReceiptWithCapability"],
    ["revoke_receipt_review", "revokeSpotProcurementReceiptReviewWithCapability"],
    ["submit_receipt", "submitSpotProcurementReceiptWithCapability"],
    ["initiate_discrepancy", "createSpotProcurementDiscrepancyWithCapability"],
    ["record_refund", "recordSpotProcurementRefundWithCapability"]
  ])("rechecks the fresh receipt %s action before mutation", (action, helper) => {
    expect(receiptPage).toContain(`async function ${helper}(`);
    expect(receiptPage).toContain(`"${action}"`);
    expect(receiptPage).toContain("fetchSpotProcurementReceipt");
  });

  it.each([
    [workbenchPage, "create_spot_procurement", "uploadSpotProcurementCreateFileWithCapability"],
    [detailPage, "edit_draft", "uploadSpotProcurementDraftFileWithCapability"],
    [paymentPage, "edit_draft", "uploadSpotProcurementPaymentDraftFileWithCapability"],
    [paymentPage, "record_execution", "uploadSpotProcurementExecutionVoucherWithCapability"],
    [receiptPage, "append_receipt_photo", "uploadSpotProcurementReceiptPhotoWithCapability"],
    [receiptPage, "record_refund", "uploadSpotProcurementRefundVoucherWithCapability"],
    [receiptPage, "append_invoice", "uploadSpotProcurementInvoiceFileWithCapability"]
  ])("authorizes %s before storing its business file", (page, action, helper) => {
    expect(page).toContain(`async function ${helper}(`);
    expect(page).toContain(`"${action}"`);
  });

  it.each([workbenchPage, detailPage, paymentPage, receiptPage])(
    "does not use the generic authenticated-only upload wrapper",
    (page) => {
      expect(page).not.toContain("uploadPrivateFile");
    }
  );
});
