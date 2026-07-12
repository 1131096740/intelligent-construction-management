import type { ContractPaymentApplicationPreviewReadModel } from "@jiangkong/shared-domain";
import { describe, expect, it } from "vitest";
import {
  canShowContractPaymentApplicationPreview,
  emptyPaymentLedgerFilters,
  filterPaymentLedgerRows,
  paymentApplicationPreviewColumns,
  paymentApplicationPreviewRowClassName,
  paymentFilterFields,
  paymentCreateSourceOptions,
  paymentLedgerColumns,
  paymentRules,
  paymentSummaryItems,
  toPaymentApplicationPreviewRows,
  toPaymentCapacityExplanationItems,
  type PaymentLedgerRow
} from "./payment-list.config";

describe("payment ledger page configuration", () => {
  it("uses compact enterprise payment filter fields", () => {
    expect(paymentFilterFields.map((field) => field.label)).toEqual([
      "项目",
      "付款来源",
      "审批状态",
      "实付状态",
      "关键词"
    ]);
  });

  it("separates approval progress from actual payment execution summaries", () => {
    expect(paymentSummaryItems.map((item) => item.label)).toEqual([
      "全部付款",
      "待审批",
      "或签审批",
      "已批待付",
      "已实付"
    ]);
  });

  it("shows approval status and actual payment status as separate ledger columns", () => {
    expect(paymentLedgerColumns.map((column) => column.title)).toEqual([
      "付款编号",
      "关联合同",
      "付款来源",
      "项目",
      "申请金额",
      "审批状态",
      "实付状态",
      "当前节点",
      "当前处理人",
      "停留时长",
      "退回原因",
      "下一步动作",
      "更新时间",
      "操作"
    ]);
  });

  it("filters payment rows by project, source, approval, payment status, and keyword", () => {
    const rows: PaymentLedgerRow[] = [
      paymentRow({
        id: "payment-1",
        project: "E2E 项目",
        settlementNo: "合同累计结算",
        approvalStatus: "已批待付",
        paymentStatus: "部分付款",
        paymentNo: "FK-001"
      }),
      paymentRow({
        id: "payment-2",
        project: "其他项目",
        settlementNo: "JS-002",
        approvalStatus: "审批中",
        paymentStatus: "未付款",
        paymentNo: "FK-002"
      })
    ];

    expect(
      filterPaymentLedgerRows(rows, {
        ...emptyPaymentLedgerFilters(),
        project: "E2E",
        settlementNo: "合同累计",
        approvalStatus: "已批",
        paymentStatus: "部分",
        keyword: "FK-001"
      }).map((row) => row.id)
    ).toEqual(["payment-1"]);
  });

  it("states the core payment gate and execution rules", () => {
    expect(paymentRules).toEqual([
      "普通付款按合同累计已生效结算发起，单张结算入口保留兼容",
      "所有付款审批需董事长/总经理二选一或签",
      "审批通过后进入已批待付，不代表已付款",
      "出纳/财务登记实付并上传付款凭证"
    ]);
  });

  it("prioritizes contract-level payment creation while keeping compatibility sources", () => {
    expect(paymentCreateSourceOptions).toEqual([
      { value: "contract_due", label: "合同累计结算付款" },
      { value: "settlement", label: "单张结算付款" },
      { value: "contract_advance", label: "合同预付款" }
    ]);
  });

  it("defines the 9.3 contract payment application detail columns", () => {
    expect(paymentApplicationPreviewColumns.map((column) => column.title)).toEqual([
      "来源",
      "本期结算金额",
      "期前累计结算金额",
      "期后累计结算金额",
      "生效日期",
      "预计可付日",
      "付款规则",
      "发票要求",
      "当前是否到账期",
      "本行可计入金额"
    ]);
  });

  it("formats contract payment application rows for display", () => {
    expect(
      toPaymentApplicationPreviewRows({
        type: "progress",
        title: "进度款",
        rows: [
          {
            id: "row-1",
            source: "JS-001",
            settlementId: "settlement-1",
            settlementNo: "JS-001",
            currentSettlementAmountCents: "123456",
            cumulativeBeforeAmountCents: "100000",
            cumulativeAfterAmountCents: "223456",
            effectiveAt: "2026-07-03T08:30:00.000Z",
            expectedPayableAt: "2026-08-03T08:30:00.000Z",
            paymentRule: "本期结算金额 × 80%",
            invoiceRequirement: "需提供发票",
            isDue: false,
            includableAmountCents: "0"
          }
        ]
      })
    ).toEqual([
      {
        id: "row-1",
        source: "JS-001",
        currentSettlementAmount: "¥1,234.56",
        cumulativeBeforeAmount: "¥1,000.00",
        cumulativeAfterAmount: "¥2,234.56",
        effectiveAt: "2026-07-03",
        expectedPayableAt: "2026-08-03",
        paymentRule: "本期结算金额 × 80%",
        invoiceRequirement: "需提供发票",
        dueStatus: "未到账期",
        includableAmount: "¥0.00",
        isDue: false
      }
    ]);
  });

  it("marks non-due contract payment application rows for subdued display", () => {
    expect(paymentApplicationPreviewRowClassName({ isDue: true })).toBe("");
    expect(paymentApplicationPreviewRowClassName({ isDue: false })).toBe("preview-row-not-due");
  });

  it("formats contract payment capacity explanation as a business formula", () => {
    const preview = contractPaymentApplicationPreview({
      capacityExplanation: [
        {
          label: "当前累计可付款金额",
          amountCents: "80000",
          operator: "add",
          note: "按合同付款条款计算",
          tone: "primary"
        },
        {
          label: "扣已实际付款",
          amountCents: "10000",
          operator: "subtract"
        },
        {
          label: "本次最多可申请",
          amountCents: "70000",
          operator: "result",
          tone: "success"
        }
      ]
    });

    expect(toPaymentCapacityExplanationItems(preview)).toEqual([
      {
        label: "当前累计可付款金额",
        value: "+¥800.00",
        operator: "add",
        note: "按合同付款条款计算",
        tone: "primary"
      },
      {
        label: "扣已实际付款",
        value: "-¥100.00",
        operator: "subtract",
        note: "",
        tone: "default"
      },
      {
        label: "本次最多可申请",
        value: "=¥700.00",
        operator: "result",
        note: "",
        tone: "success"
      }
    ]);
  });

  it("only shows contract payment application preview for contract-level due payments", () => {
    const preview = contractPaymentApplicationPreview();

    expect(canShowContractPaymentApplicationPreview("contract_due", preview, "contract-version-1", "contract-version-1")).toBe(true);
    expect(canShowContractPaymentApplicationPreview("contract_due", preview, " contract-version-1 ", "contract-version-1")).toBe(true);
    expect(canShowContractPaymentApplicationPreview("contract_due", preview, "contract-version-1", "contract-version-2")).toBe(false);
    expect(canShowContractPaymentApplicationPreview("contract_due", null, "contract-version-1", "contract-version-1")).toBe(false);
    expect(canShowContractPaymentApplicationPreview("settlement", preview, "contract-version-1", "contract-version-1")).toBe(false);
    expect(canShowContractPaymentApplicationPreview("contract_advance", preview, "contract-version-1", "contract-version-1")).toBe(false);
  });
});

function contractPaymentApplicationPreview(
  overrides: Partial<ContractPaymentApplicationPreviewReadModel> = {}
): ContractPaymentApplicationPreviewReadModel {
  return {
    contract: {
      contractId: "contract-1",
      contractVersionId: "contract-version-1",
      contractNo: "HT-001",
      contractName: "材料采购合同",
      contractVersion: "v1",
      projectId: "project-1",
      projectName: "示例项目"
    },
    asOf: "2026-07-03T00:00:00.000Z",
    includedSettlements: [],
    capacity: {
      cumulativeEffectiveSettlementCents: "0",
      duePayableCents: "0",
      occupiedCents: "0",
      actualPaidCents: "0",
      approvalPendingCents: "0",
      approvedPendingCents: "0",
      proxyPaidCents: "0",
      advanceDeductionCents: "0",
      maxRequestableCents: "0"
    },
    advanceDeduction: {
      paidAdvanceCents: "0",
      currentDeductionCents: "0",
      remainingAdvanceToDeductCents: "0"
    },
    capacityExplanation: [],
    sections: [],
    formula: "",
    ...overrides
  };
}

function paymentRow(overrides: Partial<PaymentLedgerRow>): PaymentLedgerRow {
  return {
    id: "payment",
    paymentNo: "FK-001",
    contractNo: "HT-001 · 材料采购合同",
    settlementNo: "JS-001",
    project: "项目",
    requestedAmount: "¥1.00",
    approvalStatus: "审批中",
    approvalTone: "primary",
    paymentStatus: "未付款",
    paymentTone: "default",
    currentNode: "审批中",
    ownerDepartment: "财务部",
    pendingOwner: "财务部",
    stalledFor: "1天",
    returnReason: "-",
    nextAction: "待处理",
    updatedAt: "2026-07-08",
    ...overrides
  };
}
