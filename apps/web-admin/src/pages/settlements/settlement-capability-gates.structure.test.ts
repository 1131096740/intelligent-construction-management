import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

const detailPage = read("./SettlementDetailPage.vue");
const listPage = read("./SettlementListPage.vue");
const workbenchPage = read("./SettlementWorkbenchPage.vue");
const lineAttachmentPanel = read("./components/SettlementLineAttachmentPanel.vue");
const recoveryPanel = read("./components/SettlementRecoveryLedgerPanel.vue");
const coreApi = read("../../api/core-flow-read.api.ts");
const draftApi = read("../../api/settlement-drafts.api.ts");

describe("settlement capability gates", () => {
  it("uses protected project-scoped capability and upload APIs", () => {
    expect(draftApi).toContain("fetchSettlementProjectCapability");
    expect(draftApi).toContain("`${draftCollectionPath(projectId)}/capability`");
    expect(draftApi).toContain("uploadSettlementDraftPrivateFile");
    expect(draftApi).toContain("`${draftCollectionPath(projectId)}/files`");
    expect(coreApi).toContain("uploadSettlementArchivePrivateFile");
    expect(coreApi).toContain("uploadSettlementRecoveryPrivateFile");
    expect(coreApi).toContain("fetchSettlementActionCapability");
    expect(coreApi).toContain("`/settlements/${encodeURIComponent(settlementId)}/capability`");
  });

  it.each([
    ["review_approval", "reviewSettlementApprovalWithCapability"],
    ["transfer_approval", "transferSettlementApprovalWithCapability"],
    ["delegate_approval", "delegateSettlementApprovalWithCapability"],
    ["remind_approval", "remindSettlementApprovalWithCapability"],
    ["download_approval_form", "downloadSettlementApprovalPdfWithCapability"],
    ["upload_archive", "uploadSettlementArchiveWithCapability"],
    ["confirm_archive", "confirmSettlementArchiveWithCapability"],
    ["confirm_archive", "regenerateSettlementSignedDocumentWithCapability"],
    ["retry_signed_document_generation", "retrySettlementSignedDocumentWithCapability"],
    ["generate_pdf_archive", "generateSettlementPdfArchiveWithCapability"]
  ])("rechecks the fresh %s detail action before mutation", (action, helper) => {
    expect(detailPage).toContain(`async function ${helper}(`);
    expect(detailPage).toContain(`"${action}"`);
    expect(detailPage).toContain("fetchSettlementActionCapability");
  });

  it("rechecks exact file ACL before settlement downloads", () => {
    expect(detailPage).toContain("downloadSettlementPrivateFileWithCapability");
    expect(detailPage).toContain("getPrivateFileDownloadTicketCapability");
    expect(workbenchPage).toContain("downloadSettlementDraftFileWithCapability");
    expect(workbenchPage).toContain("getPrivateFileDownloadTicketCapability");
  });

  it.each([
    ["save_draft", "saveSettlementDraftWithCapability"],
    ["save_draft", "updateSettlementDraftWithCapability"],
    ["preview_import", "previewSettlementImportWithCapability"],
    ["preview_lines", "previewSettlementLinesWithCapability"],
    ["apply_import", "applySettlementImportWithCapability"],
    ["submit_draft", "submitSettlementDraftWithCapability"],
    ["generate_frozen_document", "generateSettlementFrozenDocumentWithCapability"],
    ["link_counterparty_signed_document", "linkSettlementSignedDocumentWithCapability"]
  ])("rechecks the fresh %s workbench action before mutation", (action, helper) => {
    expect(workbenchPage).toContain(`async function ${helper}(`);
    expect(workbenchPage).toContain(`"${action}"`);
    expect(workbenchPage).toContain("fetchSettlementProjectCapability");
  });

  it("rechecks copy and line attachment actions against the project capability", () => {
    expect(listPage).toContain("copySettlementDraftWithCapability");
    expect(listPage).toContain('"copy_abandoned_draft"');
    expect(lineAttachmentPanel).toContain("attachSettlementLineFileWithCapability");
    expect(lineAttachmentPanel).toContain('"attach_line_file"');
    expect(lineAttachmentPanel).toContain("invalidateSettlementLineAttachmentWithCapability");
    expect(lineAttachmentPanel).toContain('"invalidate_line_attachment"');
  });

  it.each([
    ["record_recovery", "recordSettlementRecoveryWithCapability"],
    ["reverse_recovery", "reverseSettlementRecoveryWithCapability"]
  ])("rechecks the fresh %s recovery action before mutation", (action, helper) => {
    expect(recoveryPanel).toContain(`async function ${helper}(`);
    expect(recoveryPanel).toContain(`"${action}"`);
    expect(recoveryPanel).toContain("fetchSettlementActionCapability");
  });
});
