import { describe, expect, it } from "vitest";
import {
  paymentFilterFields,
  paymentLedgerColumns,
  paymentRules,
  paymentSummaryItems
} from "./payment-list.config";

describe("payment ledger page configuration", () => {
  it("uses compact enterprise payment filter fields", () => {
    expect(paymentFilterFields.map((field) => field.label)).toEqual([
      "项目",
      "结算编号",
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
      "关联结算",
      "项目",
      "申请金额",
      "审批状态",
      "实付状态",
      "当前节点",
      "责任部门",
      "更新时间",
      "操作"
    ]);
  });

  it("states the core payment gate and execution rules", () => {
    expect(paymentRules).toEqual([
      "只能从已生效结算创建付款申请",
      "所有付款审批需董事长/总经理二选一或签",
      "审批通过后进入 approved_pending_payment，不代表已付款",
      "出纳/财务登记实付并上传付款凭证"
    ]);
  });
});
