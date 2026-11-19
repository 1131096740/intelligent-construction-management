import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) =>
  readFileSync(new URL(`./${name}`, import.meta.url), "utf8");

describe("contract workbench mutation capability gates", () => {
  it("explains the unavailable submission while preserving the four-place draft editor", () => {
    const page = readFileSync(new URL("../ContractWorkbenchPage.vue", import.meta.url), "utf8");
    expect(page).toContain('v-if="workbench?.draftSubmissionUnavailableReason"');
    expect(page).toContain(':message="workbench.draftSubmissionUnavailableReason"');
    expect(page).toContain('title="草稿已保留，暂不能提交审批"');
  });

  it.each([
    ["ContractBillTransitionsSection.vue", "saveContractBillTransitionsWithCapability"],
    ["ContractBillTransitionsSection.vue", "discardContractBillTransitionsWithCapability"],
    ["ContractBillTransitionsSection.vue", "confirmContractBillTransitionsWithCapability"],
    ["ContractBillFocusEditor.vue", "uploadContractBillImportFileWithCapability"],
    ["ContractBillFocusEditor.vue", "previewContractDraftBillExcelImportWithCapability"],
    ["ContractDocumentsSection.vue", "queueContractDocumentWithCapability"],
    ["ContractDocumentsSection.vue", "uploadContractDocumentFileWithCapability"],
    ["ContractDocumentsSection.vue", "retryContractDocumentWithCapability"],
    ["ContractDocumentsSection.vue", "confirmContractDocumentDownload"],
    ["ContractAuthorizationSection.vue", "uploadContractAuthorizationFileWithCapability"],
    ["ContractAuthorizationSection.vue", "setContractAuthorizationWithCapability"],
    ["ContractCounterpartySignedFilesPanel.vue", "uploadPrivateFileWithCapability"],
    ["ContractPartySection.vue", "uploadContractPartyFileWithCapability"]
  ])("uses %s helper %s", (file, helper) => {
    const source = read(file);
    expect(source).toContain("fetchContractDraftOperationCapabilities");
    expect(source).toContain(helper);
  });

  it("passes exact contract version coordinates into nested bill, document and party controls", () => {
    const page = readFileSync(new URL("../ContractWorkbenchPage.vue", import.meta.url), "utf8");
    expect(page).toContain(':contract-version-id="workbench?.version.id ?? \'\'"');
  });

  it.each([
    "ContractAuthorizationSection.vue",
    "ContractBillFocusEditor.vue",
    "ContractCounterpartySignedFilesPanel.vue",
    "ContractDocumentsSection.vue",
    "ContractPartySection.vue"
  ])("uploads from %s through the version-scoped workbench route", (file) => {
    const source = read(file);
    expect(source).toContain("uploadContractWorkbenchPrivateFile");
    expect(source).not.toContain("return uploadPrivateFile(");
  });

  it("gates contract document download confirmation with the exact file capability", () => {
    const source = read("ContractDocumentsSection.vue");
    expect(source).toContain(
      'v-if="contractDocumentDownloadAction && contractDocumentDownloadAction.enabled"'
    );
    expect(source).toContain('@confirm="confirmContractDocumentDownload"');
    expect(source).toContain("getPrivateFileDownloadTicketCapability(fileId)");
    expect(source).toContain(
      "const request = createPrivateFileDownloadTicket(downloadFileId.value"
    );
  });
});
