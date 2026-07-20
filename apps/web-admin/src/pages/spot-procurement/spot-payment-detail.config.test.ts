import { describe, expect, it } from "vitest";
import type { SpotProcurementPaymentDetailReadModel } from "../../api/spot-procurement.api";
import {
  defaultSpotPaymentExecutionDraft,
  spotPaymentExecutionVoucherLabel,
  firstIncompletePaymentStep,
  resolveSpotPaymentMerchantPayee,
  resolveSpotPaymentDetailTab,
  spotPaymentApprovalStatusSemantic,
  spotPaymentCurrentTaskPresentation,
  spotPaymentDetailTabs
} from "./spot-payment-detail.config";
import { spotPaymentStatusSemantic } from "./spot-payment-workbench.config";

describe("spot payment detail configuration", () => {
  it("defaults an execution to the full remaining amount and one frozen primary channel", () => {
    expect(defaultSpotPaymentExecutionDraft({
      remainingAmountCents: "12345",
      paymentMethods: [
        { value: "bank_transfer", label: "银行转账" },
        { value: "cash", label: "现金" }
      ],
      paymentChannels: [
        cashChannel("cash-secondary", false),
        {
          id: "bank-primary",
          sortOrder: 2,
          channelType: "bank_transfer",
          channelTypeLabel: "银行转账",
          accountName: "昆明建材商行",
          bankName: "建设银行",
          accountNumberLast4: "1234",
          note: null,
          primary: true
        }
      ],
      now: new Date("2026-07-21T08:30:00+08:00")
    })).toEqual({
      amountYuan: "123.45",
      paidAt: "2026-07-21 08:30:00",
      paymentMethod: "bank_transfer",
      paymentChannelId: "bank-primary"
    });
  });

  it("uses the business-required voucher wording for cash and non-cash execution", () => {
    expect(spotPaymentExecutionVoucherLabel("cash")).toBe("商家收据");
    expect(spotPaymentExecutionVoucherLabel("bank_transfer")).toBe("付款成功凭证");
    expect(spotPaymentExecutionVoucherLabel("wechat")).toBe("付款成功凭证");
  });

  it("keeps a four-digit remaining amount as an ungrouped editable value", () => {
    expect(defaultSpotPaymentExecutionDraft({
      remainingAmountCents: "440000",
      paymentMethods: [{ value: "bank_transfer", label: "银行转账" }],
      paymentChannels: [{
        id: "channel-1",
        sortOrder: 1,
        channelType: "bank_transfer",
        channelTypeLabel: "银行转账",
        accountName: null,
        bankName: null,
        accountNumberLast4: null,
        note: null,
        primary: true
      }]
    }).amountYuan).toBe("4400.00");
  });
  it("fixes the six detail tabs in business order", () => {
    expect(spotPaymentDetailTabs).toEqual([
      { value: "current", label: "当前办理" },
      { value: "application", label: "付款申请" },
      { value: "approval", label: "审批进度" },
      { value: "executions", label: "实际付款与凭证" },
      { value: "fulfillment", label: "收货与发票" },
      { value: "archives", label: "归档资料" }
    ]);
  });

  it.each([
    [undefined, "current"],
    ["unknown", "current"],
    [["approval", "current"], "approval"],
    ["current", "current"],
    ["application", "application"],
    ["approval", "approval"],
    ["executions", "executions"],
    ["fulfillment", "fulfillment"],
    ["archives", "archives"]
  ])("normalizes route tab %j without leaving the page blank", (query, expected) => {
    expect(resolveSpotPaymentDetailTab(query)).toBe(expected);
  });

  it("keeps approval semantics independent from payment semantics", () => {
    expect(spotPaymentStatusSemantic("paid")).toBe("success");
    expect(spotPaymentApprovalStatusSemantic("approved")).toBe("success");
    expect(spotPaymentApprovalStatusSemantic("approval_pending")).toBe("progress");
    expect(spotPaymentApprovalStatusSemantic("returned")).toBe("danger");
    expect(spotPaymentApprovalStatusSemantic("rejected")).toBe("danger");
    expect(spotPaymentApprovalStatusSemantic("unknown")).toBe("neutral");
  });

  it("exposes the refund CTA only for an enabled server refund task", () => {
    const summary = {
      currentNodeName: "收货差异退款",
      status: "partially_paid",
      statusLabel: "部分已付",
      approvalAmountText: "¥3,000.00",
      remainingAmountText: "¥1,000.00",
      payerCompanyName: "云南建工有限公司"
    };
    const enabled = spotPaymentCurrentTaskPresentation({
      currentTask: task("record_refund", "登记供应商退款", "personal", 400),
      availableActions: [],
      summary
    });
    const disabled = spotPaymentCurrentTaskPresentation({
      currentTask: task("record_refund", "登记供应商退款", "personal", 400, false),
      availableActions: [],
      summary
    });

    expect(enabled.actions).toEqual([
      { key: "record_refund", label: "办理退款", kind: "danger" }
    ]);
    expect(disabled.actions).toEqual([]);
  });

  it.each([
    {
      role: "物资员",
      task: task("complete_payment_draft", "完善付款草稿", "personal", 300),
      currentNodeName: "待提交",
      expectedTitle: "补全付款信息并提交",
      expectedAction: "edit_draft"
    },
    {
      role: "物资主管",
      task: task("none", "无需办理", "none", 0, false, "当前无需办理付款；后续负责收货复核"),
      currentNodeName: "综合部主管审批",
      expectedTitle: "当前无需办理付款",
      expectedAction: null,
      expectedDescription: "当前无需办理付款；后续负责收货复核"
    },
    {
      role: "综合部主管",
      task: task("review_payment", "处理付款审批", "personal", 300),
      currentNodeName: "综合部主管审批",
      expectedTitle: "办理付款审批",
      expectedAction: "review_approval"
    },
    {
      role: "项目经理",
      task: task("review_payment", "处理付款审批", "personal", 300),
      currentNodeName: "项目经理审批",
      expectedTitle: "办理付款审批",
      expectedAction: "review_approval"
    },
    {
      role: "财务人员审批前",
      task: task("complete_payer", "补充付款主体", "shared", 200),
      currentNodeName: "综合部主管审批",
      expectedTitle: "协作补全付款主体与方式",
      expectedAction: "complete_payer"
    },
    {
      role: "财务人员审批完成后",
      task: task("record_execution", "登记公司实际付款", "personal", 300),
      currentNodeName: "审批完成",
      expectedTitle: "登记实际付款",
      expectedAction: "record_execution"
    },
    {
      role: "财务主管",
      task: task("review_payment", "处理付款审批", "personal", 300),
      currentNodeName: "财务主管审批",
      expectedTitle: "办理付款审批",
      expectedAction: "review_approval"
    },
    {
      role: "董事长/总经理",
      task: task("review_payment", "处理付款审批", "personal", 300),
      currentNodeName: "董事长/总经理 OR 签",
      expectedTitle: "办理最终审批",
      expectedAction: "review_approval"
    }
  ])("derives the $role scene from server task facts", ({ task: currentTask, currentNodeName, expectedTitle, expectedAction, expectedDescription }) => {
    const presentation = spotPaymentCurrentTaskPresentation({
      currentTask,
      availableActions: actionFixtures(),
      summary: {
        currentNodeName,
        status: "approval_pending",
        statusLabel: "审批中",
        approvalAmountText: "¥3,000.00",
        remainingAmountText: "¥1,200.00",
        payerCompanyName: "云南建工有限公司"
      }
    });

    expect(presentation.title).toBe(expectedTitle);
    expect(presentation.actions[0]?.key ?? null).toBe(expectedAction);
    if (expectedDescription) expect(presentation.description).toBe(expectedDescription);
  });

  it("does not expose disabled high-risk actions for a read-only task", () => {
    const presentation = spotPaymentCurrentTaskPresentation({
      currentTask: task("review_payment", "处理付款审批", "personal", 300),
      availableActions: actionFixtures().map((action) => ({ ...action, enabled: false })),
      summary: {
        currentNodeName: "财务主管审批",
        status: "approval_pending",
        statusLabel: "审批中",
        approvalAmountText: "¥3,000.00",
        remainingAmountText: "¥3,000.00",
        payerCompanyName: null
      }
    });

    expect(presentation.actions).toEqual([]);
  });

  it("returns the first incomplete saved draft step", () => {
    expect(firstIncompletePaymentStep(detail({ paymentType: null }))).toBe(0);
    expect(firstIncompletePaymentStep(detail({}, { materials: [] }))).toBe(1);
    expect(firstIncompletePaymentStep(detail({}, { paymentChannels: [] }))).toBe(2);
    expect(firstIncompletePaymentStep(detail())).toBe(3);
  });

  it("keeps an invoiced material on step two until its saved VAT rate exists", () => {
    expect(firstIncompletePaymentStep(detail({}, {
      materials: [{
        id: "material-1",
        procurementLineId: "line-1",
        sortOrder: 1,
        materialName: "钢筋",
        specification: null,
        unit: "吨",
        approvedQuantity: "2",
        paymentQuantity: "2",
        unitPrice: "3000",
        amountCents: "600000",
        expectedInvoiceCondition: "vat_special",
        vatRateOptionId: null,
        vatRateLabel: null
      }]
    }))).toBe(1);
  });

  it("uses the frozen payee snapshot when the handler directory name changed", () => {
    expect(firstIncompletePaymentStep(detail({
      paymentType: "handler_reimbursement",
      payee: {
        name: "经办人原名",
        accountName: null,
        primaryChannel: null
      },
      handler: { id: "handler-1", name: "经办人新名" }
    }))).toBe(3);
  });

  it("does not treat a masked bank account suffix as channel completion", () => {
    expect(firstIncompletePaymentStep(detail({}, {
      paymentMethods: [{ value: "bank_transfer", label: "银行转账" }],
      paymentChannels: [{
        id: "channel-1",
        sortOrder: 1,
        channelType: "bank_transfer",
        channelTypeLabel: "银行转账",
        accountName: "昆明建材商行",
        bankName: "建设银行",
        accountNumberLast4: "1234",
        note: null,
        primary: true
      }]
    }))).toBe(2);
  });

  it("keeps channel recovery on step three when no channel is primary", () => {
    expect(firstIncompletePaymentStep(detail({}, {
      paymentChannels: [cashChannel("channel-1", false)]
    }))).toBe(2);
  });

  it("keeps channel recovery on step three when multiple channels are primary", () => {
    expect(firstIncompletePaymentStep(detail({}, {
      paymentChannels: [
        cashChannel("channel-1", true),
        cashChannel("channel-2", true)
      ]
    }))).toBe(2);
  });

  it("defaults a company-direct payee to the merchant", () => {
    expect(resolveSpotPaymentMerchantPayee({
      paymentType: "company_direct",
      merchantName: " 昆明建材商行 ",
      payeeDiffersFromMerchant: false,
      payeeName: "",
      mismatchNote: ""
    })).toEqual({
      merchantName: "昆明建材商行",
      payeeName: "昆明建材商行",
      merchantPayeeMismatchNote: null
    });
  });

  it("requires an independent payee and explanation when the exception is enabled", () => {
    expect(() => resolveSpotPaymentMerchantPayee({
      paymentType: "company_direct",
      merchantName: "昆明建材商行",
      payeeDiffersFromMerchant: true,
      payeeName: "昆明建材商行",
      mismatchNote: "商户指定代收"
    })).toThrow("例外收款对象必须与实际商户不同");

    expect(() => resolveSpotPaymentMerchantPayee({
      paymentType: "company_direct",
      merchantName: "昆明建材商行",
      payeeDiffersFromMerchant: true,
      payeeName: "张三",
      mismatchNote: " "
    })).toThrow("请填写商户与收款对象不一致说明");

    expect(resolveSpotPaymentMerchantPayee({
      paymentType: "company_direct",
      merchantName: "昆明建材商行",
      payeeDiffersFromMerchant: true,
      payeeName: "张三",
      mismatchNote: " 商户指定代收 "
    })).toEqual({
      merchantName: "昆明建材商行",
      payeeName: "张三",
      merchantPayeeMismatchNote: "商户指定代收"
    });
  });

  it("requires the caller to provide the frozen handler payee snapshot", () => {
    expect(resolveSpotPaymentMerchantPayee({
      paymentType: "handler_reimbursement",
      merchantName: "昆明建材商行",
      handlerPayeeNameSnapshot: " 经办人原名 "
    })).toEqual({
      merchantName: "昆明建材商行",
      payeeName: "经办人原名",
      merchantPayeeMismatchNote: "经办人垫付后报回"
    });

    expect(() => resolveSpotPaymentMerchantPayee({
      paymentType: "handler_reimbursement",
      merchantName: "昆明建材商行",
      handlerPayeeNameSnapshot: " "
    })).toThrow("经办人冻结收款人缺失");
  });
});

function detail(
  payment: Partial<SpotProcurementPaymentDetailReadModel["payment"]> = {},
  rest: Partial<SpotProcurementPaymentDetailReadModel> = {}
): SpotProcurementPaymentDetailReadModel {
  return {
    payment: {
      paymentType: "company_direct",
      merchantName: "昆明建材商行",
      merchantPayeeMismatchNote: null,
      payee: {
        name: "昆明建材商行",
        accountName: "昆明建材商行",
        primaryChannel: null
      },
      handler: { id: "handler-1", name: "经办人甲" },
      ...payment
    },
    materials: [{
      id: "material-1",
      procurementLineId: "line-1",
      sortOrder: 1,
      materialName: "钢筋",
      specification: null,
      unit: "吨",
      approvedQuantity: "2",
      paymentQuantity: "2",
      unitPrice: "3000",
      amountCents: "600000",
      expectedInvoiceCondition: "no_invoice",
      vatRateOptionId: null,
      vatRateLabel: null
    }],
    paymentMethods: [{ value: "cash", label: "现金" }],
    paymentChannels: [{
      id: "channel-1",
      sortOrder: 1,
      channelType: "cash",
      channelTypeLabel: "现金",
      accountName: null,
      bankName: null,
      accountNumberLast4: null,
      note: null,
      primary: true
    }],
    ...rest
  } as SpotProcurementPaymentDetailReadModel;
}

function cashChannel(id: string, primary: boolean) {
  return {
    id,
    sortOrder: 1,
    channelType: "cash" as const,
    channelTypeLabel: "现金",
    accountName: null,
    bankName: null,
    accountNumberLast4: null,
    note: null,
    primary
  };
}

function task(
  key: string,
  label: string,
  scope: "personal" | "shared" | "none",
  priority: 400 | 300 | 200 | 0,
  enabled = true,
  hint = label
) {
  return { key, label, hint, scope, priority, enabled, disabledReason: null };
}

function actionFixtures() {
  return [
    { key: "edit_draft", label: "编辑 A5 付款草稿", kind: "normal" as const, enabled: true, disabledReason: null },
    { key: "submit_approval", label: "提交付款审批", kind: "primary" as const, enabled: true, disabledReason: null },
    { key: "review_approval", label: "处理付款审批", kind: "primary" as const, enabled: true, disabledReason: null },
    { key: "record_execution", label: "登记实际付款", kind: "primary" as const, enabled: true, disabledReason: null }
  ];
}
