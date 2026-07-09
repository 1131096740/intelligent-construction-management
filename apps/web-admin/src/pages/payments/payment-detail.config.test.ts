import { describe, expect, it } from "vitest";
import {
  buildPaymentFlowSummary,
  paymentApprovalSteps,
  paymentBaseInfo,
  paymentDetailMeta,
  paymentExecutionAllocationColumns,
  paymentExecutionCoverageColumns,
  paymentExecutionSteps,
  paymentTraceRules
} from "./payment-detail.config";

describe("payment detail page configuration", () => {
  it("keeps approval status separate from actual payment status", () => {
    expect(paymentDetailMeta.map((item) => item.label)).toEqual([
      "审批状态",
      "实付状态",
      "付款条款版本",
      "关联合同版本",
      "责任部门",
      "下一步动作"
    ]);
  });

  it("shows settlement, ratio, account period, and requested amount", () => {
    expect(paymentBaseInfo.map((item) => item.label)).toEqual([
      "付款编号",
      "关联结算",
      "结算状态",
      "付款阶段",
      "付款比例",
      "付款账期",
      "发票要求",
      "申请金额",
      "申请人"
    ]);
  });

  it("shows the full project payment approval chain", () => {
    expect(paymentApprovalSteps.map((step) => step.label)).toEqual([
      "付款申请",
      "项目经理审批",
      "合同结算部/预算部审批",
      "财务复核",
      "董事长/总经理或签",
      "审批通过"
    ]);
  });

  it("tracks actual payment execution after approval", () => {
    expect(paymentExecutionSteps.map((step) => step.label)).toEqual([
      "已批待付",
      "出纳付款登记",
      "付款凭证上传",
      "财务入账",
      "付款完成"
    ]);
  });

  it("shows contract-level execution allocation ledger columns", () => {
    expect(paymentExecutionAllocationColumns.map((column) => column.title)).toEqual([
      "实付记录",
      "结算单",
      "付款阶段",
      "分摊/抵扣类型",
      "分摊金额"
    ]);
  });

  it("shows payment execution and finance coverage columns", () => {
    expect(paymentExecutionCoverageColumns.map((column) => column.title)).toEqual([
      "实付记录",
      "实付时间",
      "实付金额",
      "付款凭证",
      "已入账",
      "未入账",
      "覆盖状态"
    ]);
  });

  it("states the traceability rules for payment detail", () => {
    expect(paymentTraceRules).toEqual([
      "付款申请来自已生效结算或合同累计结算付款",
      "合同累计结算付款实付后自动形成分摊台账",
      "审批通过进入已批待付",
      "审批通过不等于实际付款完成",
      "实付登记必须上传付款凭证并写入审计日志"
    ]);
  });

  it("builds the payment flow summary from existing detail fields", () => {
    expect(buildPaymentFlowSummary(paymentDetailMeta, paymentBaseInfo)).toEqual([
      { label: "审批状态", value: "已通过", tone: "success" },
      { label: "实付状态", value: "已批待付", tone: "warning" },
      { label: "申请金额", value: "¥256,000.00" },
      { label: "责任部门", value: "财务部" },
      { label: "下一步动作", value: "出纳付款登记", tone: "primary" }
    ]);
  });

  it("falls back when a payment flow summary source field is missing", () => {
    expect(buildPaymentFlowSummary([], [])).toEqual([
      { label: "审批状态", value: "-" },
      { label: "实付状态", value: "-" },
      { label: "申请金额", value: "-" },
      { label: "责任部门", value: "-" },
      { label: "下一步动作", value: "-" }
    ]);
  });
});
