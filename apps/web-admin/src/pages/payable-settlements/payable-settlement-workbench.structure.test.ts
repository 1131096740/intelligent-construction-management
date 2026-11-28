import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(join(__dirname, "PayableSettlementWorkbenchPage.vue"), "utf8");
const routes = readFileSync(join(__dirname, "../../routes/route-records.ts"), "utf8");
const api = readFileSync(join(__dirname, "../../api/payable-settlement.api.ts"), "utf8");

describe("payable settlement workbench structure", () => {
  it("renders wage balances and history with no dedicated wage operation", () => {
    expect(page).toContain("fetchWagePayableCases");
    expect(page).toContain("fetchPayableSettlementWorkbench");
    expect(page).toContain("历史核销案件");
    expect(page).toContain("over_settled_reconciliation_required");
    expect(page).toContain("超额核销待核对");
    expect(page).not.toContain("paymentExecutionId");
    expect(api).not.toContain("paymentExecutionId");
    expect(api).not.toContain("payment-execution-candidates");
    expect(api).not.toContain("/allocations");
  });

  it("preserves current relationship entry and authorization independent of retired wage confirmation", () => {
    expect(page).toContain('path: "/公司互转台账"');
    expect(page).toContain("row.status === 'open' && capabilities.returnRelationship");
    expect(page).toContain("originalInterEntityRelationshipId: row.relationshipEntryId");
    expect(page).not.toContain("上传代付往来凭证");
    expect(api).not.toContain('method: "POST"');
  });

  it("registers the finance-only navigation and canonical route", () => {
    expect(routes).toContain('label: "历史工资应付核销"');
    expect(routes).toContain('path: "/工资应付核销工作台"');
    expect(routes).toContain('path: "工资应付核销工作台"');
    expect(routes).toContain('ACTION_REQUIRED_ROLES["payable_settlement.read"]');
    expect(routes).toContain('import("../pages/payable-settlements/PayableSettlementWorkbenchPage.vue")');
  });
});
