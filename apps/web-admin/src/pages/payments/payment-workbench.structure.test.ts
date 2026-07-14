import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workbench = readFileSync(new URL("./PaymentWorkbenchPage.vue", import.meta.url), "utf8");
const ledger = readFileSync(new URL("./PaymentListPage.vue", import.meta.url), "utf8");
const detail = readFileSync(new URL("./PaymentDetailPage.vue", import.meta.url), "utf8");

describe("payment workbench structure", () => {
  it("keeps creation in an independent workbench and the management page as a ledger", () => {
    expect(workbench).toContain('title="付款工作台"');
    expect(workbench).toContain('id="create-payment-title"');
    expect(workbench).toContain("新建付款申请");
    expect(ledger).toContain('title="付款管理"');
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

  it("keeps system capacity validation and manual requested amount before creation", () => {
    expect(workbench).toContain("fetchContractPaymentApplication");
    expect(workbench).toContain("visibleContractPaymentPreview");
    expect(workbench).toContain('v-model="createForm.requestedAmountYuan"');
    expect(workbench).toContain("buildPaymentCreatePayload");
    expect(workbench).toContain("请先校验可付款额度，确认当前可申请金额");
    expect(workbench).toContain("校验可付款额度");
    expect(workbench).not.toContain("读取付款预览");
  });

  it("shows a read-only confirmation summary and protects unsaved input", () => {
    expect(workbench).toContain("<PaymentConfirmationSummary");
    expect(workbench).toContain('v-if="selectedContract"');
    expect(workbench).toContain("yuanTextToCentsText");
    expect(workbench).toContain("onBeforeRouteLeave");
    expect(workbench).toContain("<SensitiveActionDialog");
  });

  it("uses six detail tabs and one sensitive action dialog without browser confirms", () => {
    expect(detail).toContain("paymentDetailTabs");
    expect(detail).toContain("<SensitiveActionDialog");
    expect(detail).toContain('activeTab === \'execution\'');
    expect(detail).not.toContain("confirmSensitiveAction");
    expect(detail).not.toContain("promptSensitiveActionReason");
    expect(detail).not.toContain("window.confirm");
    expect(detail).not.toContain("window.prompt");
  });

  it("uses TDesign uploads and separates detail navigation from execution submission", () => {
    expect(detail.match(/<t-upload/g)).toHaveLength(2);
    expect(detail).not.toContain('type="file"');
    expect(detail).toContain("前往实付登记");
    expect(detail).toContain("确认登记实付");
    expect(detail).toContain("action-buttons action-buttons--end");
  });

  it("moves the requested amount into the detail header without duplicating it in base info", () => {
    expect(detail).toContain(':requested-amount="paymentRequestedAmountView"');
    expect(detail).toContain('["付款编号", "申请金额"].includes(item.label)');
  });
});
