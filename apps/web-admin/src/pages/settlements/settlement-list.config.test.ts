import { readFileSync } from "node:fs";
import type { SettlementSourceLineReadModel } from "@jiangkong/shared-domain";
import { describe, expect, it } from "vitest";
import {
  emptySettlementLedgerFilters,
  filterSettlementLedgerRows,
  settlementFilterFields,
  settlementLedgerColumns,
  settlementLedgerFilterOptions,
  settlementPaginationBlockReason,
  settlementRules,
  settlementSourceLineColumns,
  settlementSummaryItems,
  toSettlementSourceLinePreviewRows,
  type SettlementLedgerRow
} from "./settlement-list.config";

describe("settlement ledger page configuration", () => {
  it("uses the shared enterprise ledger structure without native controls", () => {
    const source = readFileSync(new URL("./SettlementListPage.vue", import.meta.url), "utf8");
    expect(source).toContain("<BusinessPageHeader");
    expect(source).toContain("<BusinessStatusSummary");
    expect(source).toContain("<BusinessTableToolbar");
    expect(source).toContain("<BusinessFeedback");
    expect(source).toContain("<EmptyBusinessState");
    expect(source).not.toContain("<input");
  });

  it("shows the current user's saved drafts without changing formal ledger statistics", () => {
    const source = readFileSync(new URL("./SettlementListPage.vue", import.meta.url), "utf8");
    expect(source).toContain("我的草稿");
    expect(source).toContain("listSettlementDraftRecords");
    expect(source).toContain("继续填写");
    expect(source).toContain("draftId: row.id");
    expect(source).toContain("税务缺口");
  });

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
    expect(settlementPaginationBlockReason).toContain("暂不支持翻页");
  });

  it("builds stable select options from the currently loaded ledger", () => {
    const rows = [
      settlementRow({ project: "乙项目", contractNo: "HT-002", currentNode: "待归档确认" }),
      settlementRow({ project: "甲项目", contractNo: "HT-001", currentNode: "审批中" }),
      settlementRow({ project: "甲项目", contractNo: "HT-001", currentNode: "已生效" })
    ];

    expect(settlementLedgerFilterOptions(rows)).toEqual({
      project: [
        { label: "全部项目", value: "" },
        { label: "甲项目", value: "甲项目" },
        { label: "乙项目", value: "乙项目" }
      ],
      contractNo: [
        { label: "全部合同", value: "" },
        { label: "HT-001", value: "HT-001" },
        { label: "HT-002", value: "HT-002" }
      ],
      settlementStatus: [
        { label: "全部结算状态", value: "" },
        { label: "待归档确认", value: "待归档确认" },
        { label: "审批中", value: "审批中" },
        { label: "已生效", value: "已生效" }
      ],
      archiveStatus: [
        { label: "全部归档状态", value: "" },
        { label: "待归档确认", value: "待归档确认" },
        { label: "未进入归档", value: "未进入归档" },
        { label: "已生效", value: "已生效" }
      ]
    });
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
          taxExclusiveUnitPrice: "90071992547409.93",
          pricingFactStatus: "confirmed",
          calculationAvailable: true,
          submissionBlocker: null,
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

  it("shows unknown contract amounts as neutral missing values instead of zero", () => {
    expect(
      toSettlementSourceLinePreviewRows([
        {
          ...sourceLine(),
          contractAmountCents: null,
          remainingAmountCents: null
        }
      ])[0]
    ).toMatchObject({
      contractAmount: "—",
      remainingAmount: "—"
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
        archiveStatus: "待归档确认",
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

function sourceLine(): SettlementSourceLineReadModel {
  return {
    id: "row-1",
    billId: "bill-1",
    billKey: "main",
    billName: "主清单",
    rowKey: "1",
    sortOrder: 1,
    itemCode: null,
    itemName: "待确认清单项",
    specification: null,
    unit: "项",
    quantity: null,
    unitPrice: null,
    taxRatePercent: null,
    taxExclusiveUnitPrice: null,
    pricingFactStatus: "unconfirmed",
    calculationAvailable: false,
    submissionBlocker: {
      code: "missing_unit_price",
      message: "含税单价待确认",
      remedyPath: "/合同工作台"
    },
    amountRole: "included",
    pricingMode: "tax_inclusive",
    calculationMode: "normal_auto",
    contractAmountCents: null,
    settledQuantity: null,
    previousSettledQuantity: null,
    remainingQuantity: null,
    settledAmountCents: "0",
    remainingAmountCents: null,
    provisional: false,
    settlementBasis: null,
    exception: null,
    exceptions: []
  };
}
