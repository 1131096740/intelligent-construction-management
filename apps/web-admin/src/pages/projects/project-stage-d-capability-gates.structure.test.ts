import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const operatingPage = read("./ProjectOperatingOverviewPage.vue");
const expenseDetailPage = read("./ProjectExpenseApprovalDetailPage.vue");
const affiliatePanel = read("./components/AffiliateBusinessLedgerPanel.vue");
const coreApi = read("../../api/core-flow-read.api.ts");

describe("project stage D capability gates", () => {
  it("exposes project, expense, upstream-fund and affiliate-scoped capability APIs", () => {
    expect(coreApi).toContain("fetchProjectCreateCapability");
    expect(coreApi).toContain("fetchProjectUpdateCapability");
    expect(coreApi).toContain("fetchProjectExpenseCreateCapability");
    expect(coreApi).toContain("fetchProjectExpenseActionCapability");
    expect(coreApi).toContain("fetchProjectUpstreamFundRecordCapability");
    expect(coreApi).toContain("fetchProjectUpstreamFundConfirmationCapability");
    expect(coreApi).toContain("uploadProjectExpensePrivateFile");
    expect(coreApi).toContain("uploadProjectUpstreamFundPrivateFile");
    expect(coreApi).toContain("uploadProjectAffiliateBusinessPrivateFile");
  });

  it.each([
    ["create_project", "createProjectWithCapability"],
    ["update_project", "updateProjectWithCapability"],
    ["create_project_expense_request", "createProjectExpenseRequestWithCapability"],
    ["record_purchase_execution", "recordProjectExpensePurchaseExecutionWithCapability"],
    ["download_attachment", "downloadProjectExpenseAttachmentWithCapability"],
    ["download_approval_pdf", "downloadProjectExpenseApprovalPdfWithCapability"],
    ["record_upstream_fund_fact", "recordProjectUpstreamFundFactWithCapability"],
    ["confirm_upstream_fund_fact", "confirmProjectUpstreamFundFactWithCapability"]
  ])("rechecks the fresh %s action before operating-page mutation", (action, helper) => {
    expect(operatingPage).toContain(`async function ${helper}(`);
    expect(operatingPage).toContain(`"${action}"`);
  });

  it("rechecks the fresh void action before ending a project expense", () => {
    expect(expenseDetailPage).toContain(
      "async function voidProjectExpenseRequestWithCapability("
    );
    expect(expenseDetailPage).toContain("fetchProjectExpenseActionCapability");
    expect(expenseDetailPage).toContain('"void"');
  });

  it.each([
    ["record_affiliate_contract_fact", "recordProjectAffiliateContractFactWithCapability"],
    ["record_affiliate_settlement_fact", "recordProjectAffiliateSettlementFactWithCapability"],
    ["record_affiliate_payment_fact", "recordProjectAffiliatePaymentFactWithCapability"],
    ["confirm_affiliate_fact", "confirmProjectAffiliateContractFactWithCapability"],
    ["confirm_affiliate_fact", "confirmProjectAffiliateSettlementFactWithCapability"],
    ["confirm_affiliate_fact", "confirmProjectAffiliatePaymentFactWithCapability"],
    [
      "supplement_affiliate_evidence",
      "supplementProjectAffiliateBusinessEvidenceWithCapability"
    ]
  ])("rechecks the fresh %s affiliate action before mutation", (action, helper) => {
    expect(affiliatePanel).toContain(`async function ${helper}(`);
    expect(affiliatePanel).toContain(`"${action}"`);
    expect(affiliatePanel).toContain("fetchProjectAffiliateFactCapability");
  });
});
