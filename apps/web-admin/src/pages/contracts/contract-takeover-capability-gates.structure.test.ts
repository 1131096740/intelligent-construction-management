import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  new URL("./ContractTakeoverPage.vue", import.meta.url),
  "utf8"
);
const api = readFileSync(
  new URL("../../api/core-flow-read.api.ts", import.meta.url),
  "utf8"
);
const taxPanel = readFileSync(
  new URL("./components/ContractTaxFactReviewPanel.vue", import.meta.url),
  "utf8"
);

describe("historical takeover project capability gates", () => {
  it("loads project-scoped capabilities from the protected API", () => {
    expect(api).toContain("fetchContractTakeoverProjectCapability");
    expect(api).toContain("/contract-takeovers/capability");
    expect(api).toContain("/contract-takeovers/files");
    expect(page).toContain("fetchContractTakeoverProjectCapability");
  });

  it.each([
    ["create_takeover", "createContractTakeoverWithCapability"],
    ["precheck_import", "precheckContractTakeoverImportWithCapability"],
    ["create_import_drafts", "createContractTakeoverDraftsFromImportWithCapability"],
    ["preview_excel_import", "previewContractTakeoverExcelImportWithCapability"],
    ["apply_excel_import", "applyContractTakeoverExcelImportWithCapability"],
    ["review_import_batch", "reviewContractTakeoverImportBatchWithCapability"],
    ["preview_batch_abandonment", "previewContractTakeoverBatchAbandonmentWithCapability"],
    ["apply_batch_abandonment", "applyContractTakeoverBatchAbandonmentWithCapability"],
    ["upload_takeover_file", "uploadContractTakeoverPrivateFileWithCapability"]
  ])("rechecks the fresh %s project action before mutation", (action, helper) => {
    expect(page).toContain(`async function ${helper}(`);
    expect(page).toContain("capability.projectId === projectId");
    expect(page).toContain(`"${action}"`);
  });

  it.each([
    ["update_takeover", "updateContractTakeoverWithCapability"],
    ["abandon_takeover", "abandonContractTakeoverWithCapability"],
    ["submit_review", "submitContractTakeoverReviewWithCapability"],
    ["confirm_takeover", "confirmContractTakeoverWithCapability"],
    ["return_for_supplement", "returnContractTakeoverForSupplementWithCapability"],
    ["confirm_change_baseline", "confirmContractTakeoverChangeBaselineWithCapability"],
    ["attach_contract_evidence", "attachContractTakeoverEvidenceFileWithCapability"],
    ["attach_payment_voucher", "attachHistoricalPaymentVoucherWithCapability"],
    ["save_contract_side", "saveContractTakeoverContractSideWithCapability"],
    ["save_finance_side", "saveContractTakeoverFinanceSideWithCapability"],
    ["confirm_contract_side", "confirmContractTakeoverContractSideWithCapability"],
    ["confirm_finance_side", "confirmContractTakeoverFinanceSideWithCapability"],
    [
      "withdraw_contract_side_confirmation",
      "withdrawContractTakeoverContractSideConfirmationWithCapability"
    ],
    [
      "withdraw_finance_side_confirmation",
      "withdrawContractTakeoverFinanceSideConfirmationWithCapability"
    ],
    ["submit_correction", "submitContractTakeoverCorrectionWithCapability"],
    ["review_correction", "reviewContractTakeoverCorrectionWithCapability"],
    [
      "submit_company_entity_correction",
      "submitContractTakeoverCompanyEntityCorrectionWithCapability"
    ],
    [
      "review_company_entity_correction",
      "reviewContractTakeoverCompanyEntityCorrectionWithCapability"
    ]
  ])("rechecks the fresh %s record action before mutation", (action, helper) => {
    expect(page).toContain(`async function ${helper}(`);
    expect(page).toContain("capability.projectId === projectId");
    expect(page).toContain(`"${action}"`);
  });

  it("rechecks exact private-file ACL before creating either download ticket", () => {
    expect(page).toContain("createContractTakeoverFileDownloadTicketWithCapability");
    expect(page).toContain("getPrivateFileDownloadTicketCapability");
    expect(page).toContain('"create_private_file_download_ticket"');
  });

  it.each([
    ["create_tax_fact_revision", "createContractTaxFactRevisionWithCapability"],
    ["update_tax_fact_revision", "updateContractTaxFactRevisionWithCapability"],
    [
      "submit_tax_fact_finance_review",
      "submitContractTaxFactRevisionForFinanceReviewWithCapability"
    ],
    ["review_tax_fact_by_finance", "reviewContractTaxFactRevisionByFinanceWithCapability"],
    ["confirm_tax_fact_by_contract", "confirmContractTaxFactRevisionWithCapability"],
    ["abandon_tax_fact_revision", "abandonContractTaxFactRevisionWithCapability"],
    ["upload_takeover_file", "uploadContractTaxFactEvidenceFileWithCapability"]
  ])("rechecks the fresh %s tax-fact action before mutation", (action, helper) => {
    expect(taxPanel).toContain(`async function ${helper}(`);
    expect(taxPanel).toContain("capability.projectId === projectId");
    expect(taxPanel).toContain(`"${action}"`);
  });
});
