import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("../ContractWorkbenchPage.vue", import.meta.url), "utf8");
const documents = readFileSync(new URL("./ContractDocumentsSection.vue", import.meta.url), "utf8");
const section = readFileSync(new URL("./ContractNegotiationSection.vue", import.meta.url), "utf8");
const canvas = readFileSync(new URL("./ContractNegotiationCanvas.vue", import.meta.url), "utf8");
const api = readFileSync(new URL("../../../api/contract-negotiation.api.ts", import.meta.url), "utf8");

describe("contract negotiation workbench structure", () => {
  it("keeps negotiation comparison in the central canvas and readiness in the sidebar", () => {
    expect(page).toContain("ContractNegotiationCanvas");
    expect(page).toMatch(/document-canvas-slot[\s\S]*ContractNegotiationCanvas/u);
    expect(page).toMatch(/business-sidebar[\s\S]*ContractWorkbenchIssueList/u);
    expect(documents).toContain("ContractNegotiationSection");
  });

  it("uses TDesign controls for rounds, DOCX upload, disposition and secure preview", () => {
    expect(section).toContain("<t-timeline");
    expect(section).toContain("<t-upload");
    expect(section).toContain('accept=".docx');
    expect(canvas).toContain("<t-radio-group");
    expect(canvas).toContain("<t-popconfirm");
    expect(canvas).toContain("安全打开修订 PDF");
    expect(canvas).not.toContain("window.prompt");
    expect(canvas).not.toContain("<iframe");
  });

  it("keeps ledger candidates read-only and private file details out of the page", () => {
    expect(canvas).toContain("此处不会修改合同账本");
    expect(canvas).not.toContain("应用到合同");
    expect(section).not.toContain("sourceGeneratedDocumentId");
    expect(section).not.toContain("sourceRevision");
    expect(canvas).not.toContain("previewPdfFileId");
    expect(canvas).not.toContain(":href=");
    expect(canvas).not.toContain("downloadUrl");
    expect(canvas).not.toContain("window.open");
    expect(api).toContain("/preview-download-ticket");
    expect(api).toContain('startsWith("/files/")');
    expect(api).toContain("response.blob()");
  });

  it("invalidates uploads, preview credentials and disposition drafts when selection changes", () => {
    expect(section).toMatch(/await uploadPrivateFile[\s\S]*isActionCurrent[\s\S]*uploadContractNegotiationRevision/u);
    expect(section).toContain("resetVersionState");
    expect(section).toContain("clearUploadState");
    expect(canvas).toContain("clearPreviewCredentials");
    expect(canvas).toContain("clearDispositionDrafts");
    expect(canvas).toContain("canApplyContractNegotiationSelectionResponse");
    expect(canvas).toContain("onBeforeUnmount");
  });
});
