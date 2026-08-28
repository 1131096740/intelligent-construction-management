import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(join(__dirname, "PayableSettlementWorkbenchPage.vue"), "utf8");
const routes = readFileSync(join(__dirname, "../../routes/route-records.ts"), "utf8");
const api = readFileSync(join(__dirname, "../../api/payable-settlement.api.ts"), "utf8");

describe("payable settlement workbench structure", () => {
  it("wires a real candidate selection and allocation lifecycle without execution UUIDs", () => {
    for (const wrapper of [
      "fetchPaymentExecutionCandidates",
      "allocatePayableSettlement",
      "submitPayableSettlement",
      "confirmPayableSettlement",
      "returnPayableSettlement"
    ]) {
      expect(page).toContain(wrapper);
    }
    expect(page).toContain("SensitiveActionDialog");
    expect(page).toContain("selectionRef");
    expect(page).not.toContain("paymentExecutionId");
    expect(api).not.toContain("paymentExecutionId");
    expect(page).toContain("over_settled_reconciliation_required");
    expect(page).toContain("超额核销待核对");
  });

  it("freshly rechecks each server capability immediately before its mutation wrapper", () => {
    for (const [handler, capability, wrapper] of [
      ["allocatePayableSettlementWithCapability", "allocate", "allocatePayableSettlement"],
      ["submitPayableSettlementWithCapability", "submit", "submitPayableSettlement"],
      ["confirmPayableSettlementWithCapability", "confirm", "confirmPayableSettlement"],
      ["returnPayableSettlementWithCapability", "return", "returnPayableSettlement"]
    ] as const) {
      expect(page).toContain(`async function ${handler}`);
      expect(page).toContain(`const operationAllowed = capability.${capability}`);
      expect(page).toContain(`return ${wrapper}(`);
    }
    expect(page.match(/await fetchPayableSettlementCapabilities\(\)/gu)).toHaveLength(4);
  });

  it("registers the finance-only navigation and canonical route", () => {
    expect(routes).toContain('label: "工资应付核销工作台"');
    expect(routes).toContain('path: "/工资应付核销工作台"');
    expect(routes).toContain('path: "工资应付核销工作台"');
    expect(routes).toContain('ACTION_REQUIRED_ROLES["payable_settlement.read"]');
    expect(routes).toContain('import("../pages/payable-settlements/PayableSettlementWorkbenchPage.vue")');
  });
});
