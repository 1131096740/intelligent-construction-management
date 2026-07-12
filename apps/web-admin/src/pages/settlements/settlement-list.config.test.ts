import { describe, expect, it } from "vitest";
import {
  emptySettlementLedgerFilters,
  filterSettlementLedgerRows,
  settlementFilterFields,
  settlementLedgerColumns,
  settlementRules,
  settlementSourceLineColumns,
  settlementSummaryItems,
  toSettlementSourceLinePreviewRows,
  type SettlementLedgerRow
} from "./settlement-list.config";

describe("settlement ledger page configuration", () => {
  it("uses compact enterprise settlement filter fields", () => {
    expect(settlementFilterFields.map((field) => field.label)).toEqual([
      "项目",
      "合同编号",
      "结算状态",
      "归档状态",
      "关键词"
    ]);
  });

  it("keeps settlement summaries focused on approval, archive, and payment readiness", () => {
    expect(settlementSummaryItems.map((item) => item.label)).toEqual([
      "全部结算",
      "审批中",
      "待归档确认",
      "已生效",
      "可申请付款"
    ]);
  });

  it("shows period, amount, payment terms version, and owner columns", () => {
    expect(settlementLedgerColumns.map((column) => column.title)).toEqual([
      "结算编号",
      "关联合同",
      "项目",
      "结算期间",
      "结算金额",
      "付款条款版本",
      "当前节点",
      "当前处理人",
      "停留时长",
      "退回原因",
      "下一步动作",
      "更新时间",
      "操作"
    ]);
  });

  it("states the core settlement gate rules", () => {
    expect(settlementRules).toEqual([
      "只能从已生效合同版本创建结算",
      "结算单签字盖章并归档确认后才生效",
      "结算未生效前不可创建付款申请",
      "历史结算绑定当时的付款条款版本"
    ]);
  });

  it("formats the read-only contract source lines without losing bigint money", () => {
    expect(settlementSourceLineColumns.map((column) => column.title)).toEqual([
      "清单",
      "编码",
      "合同清单项",
      "单位",
      "合同数量",
      "合同金额",
      "已占用",
      "剩余",
      "核对结果"
    ]);
    expect(
      toSettlementSourceLinePreviewRows([
        {
          id: "row-1",
          billId: "bill-1",
          billKey: "main",
          billName: "主清单",
          rowKey: "1",
          sortOrder: 1,
          itemCode: null,
          itemName: "超安全整数金额",
          specification: null,
          unit: "项",
          quantity: "1",
          unitPrice: "90071992547409.93",
          taxRatePercent: "0",
          amountRole: "included",
          pricingMode: "tax_inclusive",
          calculationMode: "normal_auto",
          contractAmountCents: "9007199254740993",
          settledQuantity: null,
          previousSettledQuantity: null,
          remainingQuantity: null,
          settledAmountCents: "9007199254740994",
          remainingAmountCents: "-1",
          provisional: false,
          settlementBasis: null,
          exception: {
            code: "negative_remaining_amount",
            message: "已超过 0.01 元"
          },
          exceptions: [
            {
              code: "negative_remaining_amount",
              message: "已超过 0.01 元"
            }
          ]
        }
      ])[0]
    ).toMatchObject({
      itemCode: "-",
      contractAmount: "¥90,071,992,547,409.93",
      settledAmount: "¥90,071,992,547,409.94",
      remainingAmount: "¥-0.01",
      statusText: "已超过 0.01 元"
    });
  });

  it("filters settlement rows by project, contract, status, archive text, and keyword", () => {
    const rows: SettlementLedgerRow[] = [
      settlementRow({
        id: "settlement-1",
        project: "E2E 项目",
        contractNo: "HT-001",
        currentNode: "待归档确认",
        nextAction: "确认归档",
        period: "2026-06"
      }),
      settlementRow({
        id: "settlement-2",
        project: "其他项目",
        contractNo: "HT-002",
        currentNode: "审批中",
        nextAction: "等待预算审批",
        period: "2026-05"
      })
    ];

    expect(
      filterSettlementLedgerRows(rows, {
        ...emptySettlementLedgerFilters(),
        project: "E2E",
        contractNo: "001",
        settlementStatus: "归档",
        archiveStatus: "确认",
        keyword: "2026-06"
      }).map((row) => row.id)
    ).toEqual(["settlement-1"]);
  });
});

function settlementRow(overrides: Partial<SettlementLedgerRow>): SettlementLedgerRow {
  return {
    id: "settlement",
    settlementNo: "JS-001",
    contractNo: "HT-001",
    project: "项目",
    period: "2026-06",
    amount: "¥1.00",
    paymentTermsVersion: "v1",
    currentNode: "审批中",
    nodeTone: "primary",
    ownerDepartment: "合同部",
    pendingOwner: "预算部",
    stalledFor: "1天",
    returnReason: "-",
    nextAction: "待处理",
    updatedAt: "2026-07-08",
    ...overrides
  };
}
