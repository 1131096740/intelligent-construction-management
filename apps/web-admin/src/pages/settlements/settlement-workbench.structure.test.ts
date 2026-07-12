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
    expect(page).not.toContain("amountCents: preview");
    expect(page).not.toContain("form.amountYuan");
    expect(page).toContain("settlement.id");
  });
});
