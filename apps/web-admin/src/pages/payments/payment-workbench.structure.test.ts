import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workbench = readFileSync(new URL("./PaymentWorkbenchPage.vue", import.meta.url), "utf8");
const ledger = readFileSync(new URL("./PaymentListPage.vue", import.meta.url), "utf8");

describe("payment workbench structure", () => {
  it("keeps creation in an independent workbench and the management page as a ledger", () => {
    expect(workbench).toContain("<h1>付款工作台</h1>");
    expect(workbench).toContain("title=\"新建付款申请\"");
    expect(ledger).toContain("<h1>付款管理</h1>");
    expect(ledger).toContain("<h2>付款台账</h2>");
    expect(ledger).toContain('path: "/付款工作台"');
    expect(ledger).not.toContain("createPaymentRequest");
    expect(ledger).not.toContain("createForm");
  });

  it("uses TDesign selections for the project, contract, source and settlement chain", () => {
    expect(workbench.match(/<t-select/g)).toHaveLength(4);
    expect(workbench).toContain('v-model="createForm.projectId"');
    expect(workbench).toContain('@change="loadPaymentContracts"');
    expect(workbench).toContain('v-model="createForm.contractOptionValue"');
    expect(workbench).toContain('@change="clearContractSelectionState"');
    expect(workbench).toContain('v-model="createForm.sourceType"');
    expect(workbench).toContain('v-model="createForm.settlementOptionValue"');
    expect(workbench).not.toContain("<select");
  });

  it("keeps backend contract preview and manual requested amount before creation", () => {
    expect(workbench).toContain("fetchContractPaymentApplication");
    expect(workbench).toContain("visibleContractPaymentPreview");
    expect(workbench).toContain('v-model="createForm.requestedAmountYuan"');
    expect(workbench).toContain("buildPaymentCreatePayload");
    expect(workbench).toContain("请先读取付款预览，确认可申请余额后再提交");
  });
});
