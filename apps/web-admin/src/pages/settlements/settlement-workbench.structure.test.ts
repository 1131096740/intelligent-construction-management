import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./SettlementWorkbenchPage.vue", import.meta.url), "utf8");
const routes = readFileSync(new URL("../../routes/route-records.ts", import.meta.url), "utf8");
const ledger = readFileSync(new URL("./SettlementListPage.vue", import.meta.url), "utf8");

describe("settlement creation workbench structure", () => {
  it("uses an independent workbench route and keeps the ledger as the only created-order entry point", () => {
    expect(routes).toContain('path: "结算工作台"');
    expect(routes).toContain('SettlementWorkbenchPage.vue');
    expect(page).toContain("<h1>结算工作台</h1>");
    expect(ledger).toMatch(/id="settlement-ledger-title">\s*结算台账\s*<\/h2>/);
    expect(ledger).toContain('router.push("/结算工作台")');
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
    expect(page).toContain("onBeforeRouteLeave");
    expect(page).not.toContain("amountCents: preview");
    expect(page).not.toContain("form.amountYuan");
    expect(page).toContain("settlement.id");
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
