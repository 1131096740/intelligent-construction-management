import { describe, expect, it } from "vitest";
import {
  contractFilterFields,
  contractLedgerColumns,
  contractSummaryItems,
  emptyContractLedgerFilters,
  filterContractLedgerRows,
  type ContractLedgerRow
} from "./contract-list.config";

describe("contract ledger page configuration", () => {
  it("uses the approved compact enterprise filter fields", () => {
    expect(contractFilterFields.map((field) => field.label)).toEqual([
      "项目",
      "合同状态",
      "归档状态",
      "付款条款版本",
      "关键词"
    ]);
  });

  it("keeps the compact summary strip focused on contract states", () => {
    expect(contractSummaryItems.map((item) => item.label)).toEqual([
      "全部合同",
      "审批中",
      "待用章",
      "待归档",
      "已生效"
    ]);
  });

  it("shows version, archive, owner, and next-node columns in the ledger", () => {
    expect(contractLedgerColumns.map((column) => column.title)).toEqual([
      "合同编号",
      "合同名称",
      "项目",
      "相对方",
      "金额",
      "版本",
      "当前节点",
      "当前处理人",
      "停留时长",
      "退回原因",
      "下一步动作",
      "更新时间",
      "操作"
    ]);
  });

  it("filters ledger rows by project, status, archive text, payment terms, and keyword", () => {
    const rows: ContractLedgerRow[] = [
      contractRow({
        id: "contract-1",
        project: "E2E 项目",
        currentNode: "待归档确认",
        nextAction: "确认归档",
        paymentTermsVersion: "条款 v2",
        counterparty: "钢材供应商"
      }),
      contractRow({
        id: "contract-2",
        project: "其他项目",
        currentNode: "已生效",
        nextAction: "发起结算",
        paymentTermsVersion: "条款 v1",
        counterparty: "劳务班组"
      })
    ];

    expect(
      filterContractLedgerRows(rows, {
        ...emptyContractLedgerFilters(),
        project: "E2E",
        contractStatus: "归档",
        archiveStatus: "确认",
        paymentTermsVersion: "v2",
        keyword: "钢材"
      }).map((row) => row.id)
    ).toEqual(["contract-1"]);
  });
});

function contractRow(overrides: Partial<ContractLedgerRow>): ContractLedgerRow {
  return {
    id: "contract",
    contractNo: "HT-001",
    name: "钢材采购合同",
    project: "项目",
    counterparty: "供应商",
    amount: "¥1.00",
    version: "v1",
    currentNode: "审批中",
    nodeTone: "primary",
    ownerDepartment: "合同部",
    pendingOwner: "合同部",
    stalledFor: "1天",
    returnReason: "-",
    nextAction: "待处理",
    updatedAt: "2026-07-08",
    ...overrides
  };
}
