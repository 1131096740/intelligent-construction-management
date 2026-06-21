import { describe, expect, it } from "vitest";
import {
  settlementArchiveResponsibilities,
  settlementDetailMeta,
  settlementEffectivenessSteps,
  settlementPaymentBlockMessage,
  settlementPaymentRuleColumns
} from "./settlement-detail.config";

describe("settlement detail page configuration", () => {
  it("shows settlement detail metadata tied to contract and terms versions", () => {
    expect(settlementDetailMeta.map((item) => item.label)).toEqual([
      "当前状态",
      "关联合同版本",
      "付款条款版本",
      "结算期间",
      "责任部门",
      "下一步动作"
    ]);
  });

  it("keeps the approved settlement effectiveness sequence visible", () => {
    expect(settlementEffectivenessSteps.map((step) => step.label)).toEqual([
      "结算审批",
      "签字盖章归档上传",
      "合同部主管确认",
      "结算生效"
    ]);
  });

  it("states settlement archive responsibility boundaries", () => {
    expect(settlementArchiveResponsibilities).toEqual([
      "结算审批不经过董事长/总经理",
      "结算归档件由合同部成员上传",
      "归档由合同部主管确认",
      "财务只读取业务归档件"
    ]);
  });

  it("shows payment execution rule columns for ratio and account period", () => {
    expect(settlementPaymentRuleColumns.map((column) => column.title)).toEqual([
      "规则阶段",
      "付款比例",
      "付款账期",
      "触发条件",
      "付款申请状态"
    ]);
  });

  it("blocks payment request creation before settlement effectiveness", () => {
    expect(settlementPaymentBlockMessage).toBe(
      "结算尚未生效，暂不可创建付款申请；付款比例和账期按绑定的付款条款版本执行。"
    );
  });
});
