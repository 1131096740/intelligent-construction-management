import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const detailPage = read("./ExpenseClaimDetailPage.vue");
const createDrawer = read("./components/ExpenseClaimCreateDrawer.vue");
const expenseClaimApi = read("../../api/expense-claim.api.ts");

describe("expense claim stage D capability gates", () => {
  it("exposes claim, repayment and business-domain upload APIs", () => {
    for (const apiName of [
      "fetchExpenseClaimActionCapability",
      "fetchExpenseClaimRepaymentActionCapability",
      "uploadExpenseClaimDraftAttachmentFile",
      "uploadExpenseClaimAppendAttachmentFile",
      "uploadExpenseClaimPaymentVoucherFile",
      "uploadExpenseClaimLoanDisbursementVoucherFile",
      "uploadExpenseClaimLoanRepaymentVoucherFile"
    ]) {
      expect(expenseClaimApi).toContain(`function ${apiName}(`);
    }
  });

  it("rechecks create capability immediately before creating a claim", () => {
    expect(createDrawer).toContain("async function createExpenseClaimWithCapability(");
    expect(createDrawer).toContain('"create_expense_claim"');
    expect(createDrawer).toContain("fetchExpenseClaimCreateOptions");
  });

  it.each([
    ["submit_expense_claim", "submitExpenseClaimWithCapability"],
    ["review_expense_claim", "reviewExpenseClaimWithCapability"],
    ["attach_expense_claim_attachment", "attachExpenseClaimAttachmentWithCapability"],
    ["append_expense_claim_attachment", "appendExpenseClaimAttachmentWithCapability"],
    ["remove_expense_claim_attachment", "removeExpenseClaimAttachmentWithCapability"],
    ["adjust_expense_claim_payment_subject", "adjustExpenseClaimPaymentSubjectWithCapability"],
    ["record_expense_claim_payment", "recordExpenseClaimPaymentWithCapability"],
    ["generate_expense_claim_final_payment_pdf", "generateExpenseClaimFinalPaymentPdfWithCapability"],
    ["record_expense_claim_loan_disbursement", "recordExpenseClaimLoanDisbursementWithCapability"],
    ["generate_expense_claim_final_disbursement_pdf", "generateExpenseClaimFinalDisbursementPdfWithCapability"],
    ["record_expense_claim_loan_repayment", "recordExpenseClaimLoanRepaymentWithCapability"]
  ])("rechecks the fresh %s action before mutation", (action, helper) => {
    expect(detailPage).toContain(`async function ${helper}(`);
    expect(detailPage).toContain(`"${action}"`);
    expect(detailPage).toContain("fetchExpenseClaimActionCapability");
  });

  it.each([
    ["confirm_expense_claim_loan_repayment", "confirmExpenseClaimLoanRepaymentWithCapability"],
    ["reverse_expense_claim_loan_repayment", "reverseExpenseClaimLoanRepaymentWithCapability"]
  ])("rechecks exact repayment coordinates for %s", (action, helper) => {
    expect(detailPage).toContain(`async function ${helper}(`);
    expect(detailPage).toContain(`"${action}"`);
    expect(detailPage).toContain("fetchExpenseClaimRepaymentActionCapability");
  });

  it.each([
    ["attach_expense_claim_attachment", "uploadExpenseClaimDraftAttachmentWithCapability"],
    ["append_expense_claim_attachment", "uploadExpenseClaimAppendAttachmentWithCapability"],
    ["record_expense_claim_payment", "uploadExpenseClaimPaymentVoucherWithCapability"],
    ["record_expense_claim_loan_disbursement", "uploadExpenseClaimLoanDisbursementVoucherWithCapability"],
    ["record_expense_claim_loan_repayment", "uploadExpenseClaimLoanRepaymentVoucherWithCapability"]
  ])("authorizes %s before storing its business file", (action, helper) => {
    expect(detailPage).toContain(`async function ${helper}(`);
    expect(detailPage).toContain(`"${action}"`);
  });

  it("does not use the generic authenticated-only upload wrapper", () => {
    expect(detailPage).not.toContain("uploadPrivateFile");
  });
});
