import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = fs.readFileSync(
  path.resolve(__dirname, "ContractWorkbenchPage.vue"),
  "utf8"
);
const canvasSource = fs.readFileSync(
  path.resolve(__dirname, "workbench/ContractDocumentCanvas.vue"),
  "utf8"
);
const pricingSource = fs.readFileSync(
  path.resolve(__dirname, "workbench/ContractPricingSection.vue"),
  "utf8"
);
const billEditorSource = fs.readFileSync(
  path.resolve(__dirname, "workbench/ContractBillEditor.vue"),
  "utf8"
);
const authorizationSource = fs.readFileSync(
  path.resolve(__dirname, "workbench/ContractAuthorizationSection.vue"),
  "utf8"
);
const formalSource = fs.readFileSync(
  path.resolve(__dirname, "workbench/ContractFormalDocumentSection.vue"),
  "utf8"
);
const draftSource = fs.readFileSync(
  path.resolve(__dirname, "workbench/use-contract-draft.ts"),
  "utf8"
);

describe("contract workbench document canvas structure", () => {
  it("uses a central document canvas and one TDesign business sidebar", () => {
    expect(pageSource).toContain("ContractDocumentCanvas");
    expect(pageSource).toContain("ContractNegotiationCanvas");
    expect(pageSource).toContain('class="document-canvas-slot"');
    expect(pageSource).toContain('class="business-sidebar"');
    expect(pageSource).toMatch(/<t-tabs\s+v-model="activeSection"/u);
    expect(pageSource).toContain(':value="section.key"');
    expect(pageSource).not.toContain('class="section-nav"');
  });

  it("keeps readiness visible and preserves all structured and document sections", () => {
    expect(pageSource).toMatch(
      /class="business-sidebar"[\s\S]*ContractReadinessPanel[\s\S]*<t-tabs/u
    );
    for (const component of [
      "ContractOverviewSection",
      "ContractBasicSection",
      "ContractPartySection",
      "ContractPricingSection",
      "ContractProfessionalFieldsSection",
      "ContractBillsSection",
      "ContractPaymentTermsSection",
      "ContractClausesSection",
      "ContractDocumentsSection"
    ]) {
      expect(pageSource).toContain(`<${component}`);
    }
  });

  it("does not invent an insecure embedded private-file path", () => {
    expect(canvasSource).toContain("通过右侧“文档”页签安全打开");
    expect(canvasSource).toMatch(/emit\(["']open-documents["']\)/u);
    expect(canvasSource).not.toContain("<iframe");
    expect(canvasSource).not.toContain("createPrivateFileDownloadTicket");
    expect(canvasSource).not.toContain("pdfFileId}`");
  });

  it("keeps manual amount text locally editable before converting it to cents", () => {
    expect(pricingSource).toContain('v-model="manualAmountYuanText"');
    expect(pricingSource).not.toContain(':value="manualAmountYuanText"');
    expect(pricingSource).toContain('@change="onManualAmountChange"');
    expect(pricingSource).toContain('value: "fixed_total"');
    expect(pricingSource).toContain('value: "bill_sum"');
    expect(pricingSource).not.toContain('value: "fixed_price"');
    expect(pricingSource).not.toContain('value: "cost_plus"');
  });

  it("adds a local editable bill row before calling the existing create API", () => {
    expect(billEditorSource).toContain("createUnsavedBillRow");
    expect(billEditorSource).toContain("isUnsavedBillRow(row)");
    expect(billEditorSource).toContain("已新增空白行，请填写后保存");
  });

  it("keeps signing facts in the document flow and uses only TDesign upload", () => {
    expect(pageSource).toContain("ContractAuthorizationSection");
    expect(pageSource).toContain("ContractFormalDocumentSection");
    expect(pageSource).toMatch(/ContractDocumentsSection[\s\S]*ContractAuthorizationSection[\s\S]*ContractFormalDocumentSection/u);
    expect(formalSource).toContain("<t-upload");
    expect(formalSource).toContain(':request-method="uploadApprovalPdf"');
    expect(formalSource).not.toContain('type="file"');
    expect(authorizationSource).toContain("<t-upload");
    expect(authorizationSource).toContain("uploadPrivateFile");
    expect(authorizationSource).toContain("尚未选择");
  });

  it("owns the only draft submission entry and navigates legacy detail submission to workbench", () => {
    const detailSource = fs.readFileSync(path.resolve(__dirname, "ContractDetailPage.vue"), "utf8");
    expect(pageSource).toContain("提交审批");
    expect(pageSource).toContain("submitContractFromWorkbench");
    expect(detailSource).toContain("前往合同工作台提交");
    expect(detailSource).not.toContain("submitContractApprovalAction");
  });

  it("serializes draft saves and locks every write surface during governed mutations", () => {
    expect(pageSource).toContain("const writeLocked = computed");
    expect(pageSource).toContain("const editorDisabled = computed");
    expect(pageSource.match(/:disabled="editorDisabled/g)?.length ?? 0).toBeGreaterThanOrEqual(10);
    expect(pageSource).toContain("if (writeLocked.value) return;");
    expect(draftSource).toContain("let activeSave: Promise<boolean> | null = null");
    expect(draftSource).toContain("editGeneration === savingGeneration");
    expect(draftSource).toContain("while (dirtyRef.value || activeSave)");
  });
});
