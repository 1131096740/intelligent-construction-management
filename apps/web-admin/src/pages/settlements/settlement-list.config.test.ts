import { describe, expect, it } from "vitest";
import {
  settlementFilterFields,
  settlementLedgerColumns,
  settlementRules,
  settlementSummaryItems
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
});
