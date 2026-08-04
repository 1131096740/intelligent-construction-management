import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const detailPage = read("./PaymentDetailPage.vue");
const workbenchPage = read("./PaymentWorkbenchPage.vue");
const coreApi = read("../../api/core-flow-read.api.ts");

describe("payment capability gates", () => {
  it("uses payment-scoped capability and archive upload APIs", () => {
    expect(coreApi).toContain("fetchPaymentCreateCapability");
    expect(coreApi).toContain("/payments/create-capability");
    expect(coreApi).toContain("fetchPaymentActionCapability");
    expect(coreApi).toContain("`/payments/${encodeURIComponent(paymentId)}/capability`");
    expect(coreApi).toContain("uploadPaymentPdfArchivePrivateFile");
    expect(coreApi).toContain("/pdf-archive-file-uploads`");
  });

  it("rechecks the exact project create action before creating a payment", () => {
    expect(workbenchPage).toContain("async function createPaymentRequestWithCapability(");
    expect(workbenchPage).toContain("fetchPaymentCreateCapability");
    expect(workbenchPage).toContain('"create_payment"');
  });

  it.each([
    ["abandon_application", "abandonPaymentRequestWithCapability"],
    ["delegate_approval", "delegatePaymentApprovalWithCapability"],
    ["download_approval_form", "downloadPaymentApprovalFormWithCapability"],
    ["archive_pdf", "generatePaymentPdfArchiveWithCapability"],
    ["record_finance", "recordPaymentFinanceWithCapability"],
    ["archive_pdf", "recordPaymentPdfArchiveWithCapability"],
    ["remind_approval", "remindPaymentApprovalWithCapability"],
    ["transfer_approval", "transferPaymentApprovalWithCapability"],
    ["withdraw_approval", "withdrawPaymentApprovalWithCapability"]
  ])("rechecks the fresh %s payment action before mutation", (action, helper) => {
    expect(detailPage).toContain(`async function ${helper}(`);
    expect(detailPage).toContain(`"${action}"`);
    expect(detailPage).toContain("fetchPaymentActionCapability");
  });

  it("rechecks exact file ACL before payment downloads", () => {
    expect(detailPage).toContain("downloadPaymentPrivateFileWithCapability");
    expect(detailPage).toContain("getPrivateFileDownloadTicketCapability");
    expect(detailPage).toContain('"create_private_file_download_ticket"');
  });
});
