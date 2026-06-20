import { describe, expect, it } from "vitest";
import {
  contractFilterFields,
  contractLedgerColumns,
  contractSummaryItems
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
      "责任部门",
      "更新时间",
      "操作"
    ]);
  });
});
