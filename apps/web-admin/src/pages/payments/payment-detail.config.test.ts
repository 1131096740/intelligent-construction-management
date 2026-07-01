import { describe, expect, it } from "vitest";
import {
  paymentApprovalSteps,
  paymentBaseInfo,
  paymentDetailMeta,
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
      "申请金额",
      "申请人"
    ]);
  });

  it("requires chairman or general manager OR-sign in the approval chain", () => {
    expect(paymentApprovalSteps.map((step) => step.label)).toEqual([
      "付款申请",
      "部门审核",
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

  it("states the traceability rules for payment detail", () => {
    expect(paymentTraceRules).toEqual([
      "付款申请只能来自已生效结算",
      "审批通过进入已批待付",
      "审批通过不等于实际付款完成",
      "实付登记必须上传付款凭证并写入审计日志"
    ]);
  });
});
