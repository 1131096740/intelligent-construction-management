import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./SettlementWorkbenchPage.vue", import.meta.url), "utf8");
const routes = readFileSync(new URL("../../routes/route-records.ts", import.meta.url), "utf8");
const ledger = readFileSync(new URL("./SettlementListPage.vue", import.meta.url), "utf8");

describe("settlement creation workbench structure", () => {
  it("uses an independent stable route and keeps the ledger as an entry point", () => {
    expect(routes).toContain('path: "结算管理/新建"');
    expect(routes).toContain('SettlementWorkbenchPage.vue');
    expect(ledger).toContain('router.push("/结算管理/新建")');
    expect(ledger).not.toContain("amountYuan");
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

  it("submits selected settlementLines without a client-owned total", () => {
    expect(page).toContain("settlementLines: currentPayload.value");
    expect(page).toContain("settlementTemplateVersionId: selectedSettlementTemplateVersionId.value");
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
});
