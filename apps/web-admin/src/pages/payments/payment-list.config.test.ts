import { describe, expect, it } from "vitest";
import {
  paymentFilterFields,
  paymentCreateSourceOptions,
  paymentLedgerColumns,
  paymentRules,
  paymentSummaryItems
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
      "付款来源",
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
});
