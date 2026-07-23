import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./SettlementWorkbenchPage.vue", import.meta.url), "utf8");
const participantSelect = readFileSync(
  new URL("./components/SettlementApprovalParticipantSelect.vue", import.meta.url),
  "utf8"
);
const counterpartyPanel = readFileSync(
  new URL("./components/SettlementCounterpartySignedPdfPanel.vue", import.meta.url),
  "utf8"
);
const state = readFileSync(new URL("./settlement-workbench.state.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("../../routes/route-records.ts", import.meta.url), "utf8");
const ledger = readFileSync(new URL("./SettlementListPage.vue", import.meta.url), "utf8");

describe("settlement creation workbench structure", () => {
  it("uses the governed five-step order and keeps participant and signature controls outside the wide table", () => {
    expect(state).toMatch(
      /录入结算事实[\s\S]*选择现场复核人[\s\S]*生成冻结结算单[\s\S]*上传乙方签章扫描件[\s\S]*提交审批/
    );
    expect(page).toContain("SettlementApprovalParticipantSelect");
    expect(page).toContain("SettlementCounterpartySignedPdfPanel");
    expect(page.indexOf("jg-table-region--workspace-wide")).toBeLessThan(
      page.indexOf("<SettlementApprovalParticipantSelect")
    );
    expect(page).toContain("workflowNextAction.label");
    expect(page).toContain("workflowNextAction.reason");
    expect(page).toContain(':disabled="!selectedContractVersionId"');
    expect(page).not.toContain(':disabled="!selectedContractVersionId || Boolean(linkedOriginalDocumentId)"');
  });

  it("uses project-scoped participants and TDesign PDF upload with four explicit declarations", () => {
    expect(page).toContain("fetchSettlementParticipantOptions");
    expect(page).not.toContain("fetchOrganizationDirectory");
    expect(participantSelect).toContain("当前项目没有可选现场复核人");
    expect(counterpartyPanel).toContain("<t-upload");
    expect(counterpartyPanel).toContain('accept=".pdf,application/pdf"');
    expect(counterpartyPanel).toContain(':auto-upload="false"');
    expect(counterpartyPanel).toContain("pageOrderMatchesFrozenDocument");
    expect(counterpartyPanel).toContain("counterpartySignedAndDated");
    expect(counterpartyPanel).toContain("everyPageStamped");
    expect(counterpartyPanel).toContain("crossPageSealCompleted");
    expect(counterpartyPanel).not.toContain('type="file"');
  });

  it("keeps final settlement facts structured and restores revision-bound evidence after refresh", () => {
    expect(page).toContain("FINAL_SETTLEMENT_CONFIRMATIONS");
    expect(page).toContain("finalCumulativeAmountCents");
    expect(page).toContain("draft.documents?.frozenDocument");
    expect(page).toContain("draft.documents?.counterpartySignedOriginal");
    expect(page).toContain("generateSettlementFrozenDocument");
    expect(page).toContain("linkSettlementCounterpartySignedDocument");
    expect(page).toContain("createPrivateFileDownloadTicket");
    expect(page).not.toContain("window.confirm");
    expect(page).not.toContain("window.prompt");
  });

  it("uses an independent workbench route and keeps the ledger as the only created-order entry point", () => {
    expect(routes).toContain('path: "结算工作台"');
    expect(routes).toContain('SettlementWorkbenchPage.vue');
    expect(page).toContain("<h1>结算工作台</h1>");
    expect(ledger).toMatch(/id="settlement-ledger-title">\s*结算台账\s*<\/h2>/);
    expect(ledger).toContain('router.push("/结算工作台/新建")');
    expect(ledger).not.toContain("amountYuan");
  });

  it("requires a selected system contract and does not expose a manual contract field", () => {
    expect(page).toContain('v-model="form.projectId"');
    expect(page).toContain('v-model="form.contractOptionValue"');
    expect(page).toContain('placeholder="请选择已生效合同"');
    expect(page).toContain("fetchSettlementContractOptions");
    expect(page).not.toContain('v-model="form.contractNo"');
    expect(page).not.toContain('v-model="form.contractName"');
  });

  it("uses a full-width TDesign table, backend preview, paste, batch remark, anomaly drawer and sticky totals", () => {
    expect(page).toContain("<t-table");
    expect(page).toContain("previewSettlementLines");
    expect(page).toContain("applyTsvPaste");
    expect(page).toContain("applySelectedRemark");
    expect(page).toContain("<t-drawer");
    expect(page).toContain("workbench-footer");
    expect(page).toContain("后端本期合计");
  });

  it("delegates horizontal overflow to each professional table region", () => {
    expect(page).toContain("jg-responsive-workspace");
    expect(page).toContain('data-jg-scroll-owner="child"');
    expect(page).toContain("jg-table-region--workspace-wide");
    expect(page).toContain("jg-table-region--standard");
    expect(page).toContain(':horizontal-scroll-affixed-bottom="true"');
    expect(page).not.toContain(".table-shell :deep(.t-table)");
    expect(page).not.toContain("@media (max-width:");
  });

  it("saves a draft first and submits it without a client-owned total", () => {
    expect(page).toContain("settlementLines: draftPayload.value");
    expect(page).toContain("settlementTemplateVersionId: selectedSettlementTemplateVersionId.value");
    expect(page).toContain("createSettlementDraftRecord");
    expect(page).toContain("updateSettlementDraftRecord");
    expect(page).toContain("submitSettlementDraftRecord");
    expect(page).toContain("提交结算审批");
    expect(page).toContain("useUnsavedChangesGuard");
    expect(page).not.toContain("onBeforeRouteLeave");
    expect(page).not.toContain("amountCents: preview");
    expect(page).not.toContain("form.amountYuan");
    expect(page).toContain("settlement.id");
  });

  it("executes only server-advertised draft lifecycle actions with revision CAS", () => {
    expect(page).toContain("<BusinessDraftAction");
    expect(page).toContain("activeDraft.value?.availableActions ?? []");
    expect(page).toContain("activeDraft.lifecycleBlockers");
    expect(page).toContain("abandonSettlementDraftRecord");
    expect(page).toContain("expectedRevision: current.revision");
    expect(page).not.toContain("const saved = await persistDraft(false)");
    expect(page).not.toContain("enabled: true");
  });

  it("fails closed for zero recommendations, auto-selects one and requires a choice for many", () => {
    expect(page).toContain("SettlementTemplateRecommendationPanel");
    expect(page).toContain("fetchSettlementTemplateRecommendations");
    expect(page).toContain("resolveSettlementTemplateRecommendation");
    expect(page).toContain("blockedSettlementTemplateSelection");
    expect(page).toContain("templateBlockedReason");
    expect(page).toContain("settlementTemplateVersionId");
  });

  it("keeps Excel import behind upload, preview, guarded apply and authenticated downloads", () => {
    expect(page).toContain("<t-upload");
    expect(page).toContain('theme="file-input"');
    expect(page).toContain(':auto-upload="false"');
    expect(page).not.toContain("native-file-input");
    expect(page).toContain("uploadPrivateFile");
    expect(page).toContain("previewSettlementImport");
    expect(page).toContain("importApplyDisabledReason");
    expect(page).toContain("applyImportedSettlementLines");
    expect(page).toContain("downloadSettlementImportTemplate");
    expect(page).toContain("downloadSettlementImportErrors");
    expect(page).toContain("downloadSettlementImportResult");
    expect(page).not.toContain("{{ importPreview.importId }}");
    expect(page).not.toContain(":href=");
  });

  it("renders backend-blocked historical drafts as preserved read-only input", () => {
    expect(page).toContain("draftSubmissionBlockingReason");
    expect(page).toContain('title="该草稿仅可查看"');
    expect(page).toContain("原草稿明细");
    expect(page).toContain(":data=\"blockedDraftRows\"");
    expect(page).toContain('v-if="!draftSubmissionBlockingReason"');
    expect(page).toContain(":disabled=\"Boolean(draftSubmissionBlockingReason)\"");
    expect(page).toContain(":readonly=\"Boolean(draftSubmissionBlockingReason)\"");
    expect(page).toContain("if (draftSubmissionBlockingReason.value) return;");
    expect(page).toContain("activeDraft.value?.submissionBlockingReason");
    expect(page).toMatch(
      /activeDraft\.value = draft;[\s\S]*if \(draftSubmissionBlockingReason\.value\) \{[\s\S]*return;[\s\S]*await loadSourceLines\(\);/
    );
    expect(page).toMatch(
      /async function loadSourceLines\(\) \{[\s\S]*if \(draftSubmissionBlockingReason\.value\) return;/
    );
    expect(page).not.toMatch(/contractTypeKey\s*===/);
  });
});
