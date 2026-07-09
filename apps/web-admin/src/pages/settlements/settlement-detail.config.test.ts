import { describe, expect, it } from "vitest";
import {
  buildSettlementFlowSummary,
  settlementBaseInfo,
  settlementArchiveResponsibilities,
  settlementAttachmentTemplates,
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

  it("builds a compact flow summary from existing settlement detail fields", () => {
    expect(buildSettlementFlowSummary(settlementDetailMeta, settlementBaseInfo)).toEqual([
      { label: "当前状态", value: "待归档确认", tone: "primary" },
      { label: "关联合同版本", value: "合同 v1" },
      { label: "结算金额", value: "¥320,000.00" },
      { label: "责任部门", value: "合同部" },
      { label: "下一步动作", value: "主管确认归档", tone: "primary" }
    ]);
  });

  it("uses a dash when settlement flow summary source fields are missing", () => {
    expect(buildSettlementFlowSummary([], [])[2]).toEqual({
      label: "结算金额",
      value: "-",
      tone: undefined
    });
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

  it("exposes the four offline settlement attachment templates", () => {
    expect(settlementAttachmentTemplates.map((item) => item.label)).toEqual([
      "收方单",
      "签工单",
      "零星机械签认单",
      "台班记录表"
    ]);
  });

  it("shows payment execution rule columns for ratio and account period", () => {
    expect(settlementPaymentRuleColumns.map((column) => column.title)).toEqual([
      "规则阶段",
      "付款比例",
      "付款账期",
      "发票要求",
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
