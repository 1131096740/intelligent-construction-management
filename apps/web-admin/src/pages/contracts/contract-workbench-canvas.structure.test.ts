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
  path.resolve(__dirname, "workbench/ContractBillFocusEditor.vue"),
  "utf8"
);
const navigationStateSource = fs.readFileSync(
  path.resolve(__dirname, "workbench/contract-workbench-navigation.state.ts"),
  "utf8"
);
const documentsSource = fs.readFileSync(
  path.resolve(__dirname, "workbench/ContractDocumentsSection.vue"),
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

  it("adds repeated bill rows to one aggregate candidate without section persistence", () => {
    expect(billEditorSource).toContain("addBillCandidateRow");
    expect(billEditorSource).toContain('options.emit("update:rows"');
    expect(billEditorSource).toContain('options.emit("edited"');
    expect(billEditorSource).not.toContain("replaceContractBillRows");
    expect(billEditorSource).not.toContain("保存全部");
    expect(billEditorSource).not.toContain("addBillRow");
  });

  it("replaces the two-column shell with focus editing governed by the aggregate draft", () => {
    expect(pageSource).toMatch(
      /ContractBillFocusEditor[\s\S]*v-else-if="!exactVersionError"[\s\S]*class="shell-body"/u
    );
    expect(pageSource).toContain("draftDirty: isDirty.value");
    expect(pageSource).toContain("billDirty: false");
    expect(pageSource).not.toContain("billEditorDirty");
    expect(pageSource).not.toContain("discardChanges()");
    expect(pageSource).toContain("discardChanges: discardNavigationChanges");
    expect(pageSource).toContain("discardLocalState()");
    expect(pageSource).toContain(':disabled="writeLocked"');
  });

  it("uses one route guard and closes bill focus without discarding aggregate edits", () => {
    expect(navigationStateSource).toContain("合同基础信息和清单均未保存");
    expect(navigationStateSource).toContain("放弃后两类本地修改都会丢失");
    expect(pageSource).toMatch(
      /function requestBillFocusClose\(\) \{[\s\S]*closeBillFocus\(\)/u
    );
    expect(pageSource).not.toContain("focusCloseConfirmVisible");
    expect(pageSource).not.toContain("focusCloseCheck");
    expect(pageSource).not.toContain("requestUnsavedClose");
  });

  it("fails closed instead of discarding local state while a draft save is in flight", () => {
    expect(navigationStateSource).toContain("合同草稿正在保存");
    expect(navigationStateSource).toContain("系统不会中断已发出的保存请求");
    expect(pageSource).toContain(':disabled="saveState === \'saving\'"');
    expect(pageSource).toMatch(
      /if \(isDirty\.value && !discardLocalState\(\)\) \{[\s\S]*throw new Error/u
    );
    expect(pageSource).not.toContain("billBatchSaving.value");
  });

  it("removes independent bill saving and leaves one aggregate navigation lock", () => {
    expect(billEditorSource).not.toContain('"batch-saving-change"');
    expect(billEditorSource).not.toContain("batchSaving");
    expect(billEditorSource).toContain('@click="requestClose"');
    expect(billEditorSource).toMatch(/function requestClose\(\) \{[\s\S]*emit\("close"\)/u);
    expect(pageSource).not.toContain("@batch-saving-change");
    expect(pageSource).toContain("navigationPrompt.value !== null");
    expect(pageSource).toContain(
      "shouldCancelPendingNavigation(navigationDecisionPending.value, state)"
    );
    expect(pageSource).toMatch(
      /shouldCancelPendingNavigation[\s\S]*resolveNavigationDecision\(false\)/u
    );
    expect(pageSource).toContain(':disabled="saveState === \'saving\'"');
    expect(pageSource).not.toContain("resolveFocusClose");
  });

  it("shows a recoverable conflict-read failure without enabling server discard", () => {
    expect(pageSource).toContain("conflict?.serverLoadError");
    expect(pageSource).toContain("服务器版本读取失败");
    expect(pageSource).toContain("重新读取服务器版本");
    expect(pageSource).toContain("retryConflictServerLoad");
    expect(pageSource).toContain(':disabled="conflict?.server === null"');
  });

  it("stages complete bill rows in the aggregate before the global save", () => {
    expect(pageSource).toContain('@update:rows="updateFocusedBillRows"');
    expect(pageSource).toContain('@edited="markDirty(\'bills\')"');
    expect(pageSource).toMatch(
      /function updateFocusedBillRows\([^)]*\) \{[\s\S]*bill\.rows = rows\.map/u
    );
    expect(pageSource).not.toContain("onBillSaved");
  });

  it("previews Excel into the same aggregate while document mutations still flush first", () => {
    expect(pageSource).not.toContain(":ordinary-draft-dirty");
    expect(billEditorSource).toContain("previewContractDraftBillExcelImport");
    expect(billEditorSource).toContain("确认后由右上角统一保存合同草稿");
    expect(billEditorSource).not.toContain("applyBillExcelImport");
    expect(pageSource).toMatch(/ContractDocumentsSection[\s\S]*:prepare-mutation="prepareGovernanceMutation"/u);
    expect(documentsSource).toContain("await props.prepareMutation()");
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
    expect(draftSource).toContain("const responseState = aggregateSaveState.value");
    expect(draftSource).toContain("completeAggregateSave(");
    expect(draftSource).toContain("while (dirtyRef.value || activeSave)");
  });
});
