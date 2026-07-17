import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildSettlementFlowSummary,
  buildSettlementDetailHeader,
  settlementBaseInfo,
  settlementArchiveResponsibilities,
  settlementAttachmentTemplates,
  settlementDetailMeta,
  settlementDetailTitle,
  settlementEffectivenessSteps,
  settlementPaymentBlockMessage,
  settlementPaymentRuleColumns,
  settlementDetailTabs,
  settlementOverviewBaseInfo
} from "./settlement-detail.config";

describe("settlement detail page configuration", () => {
  it("uses the shared detail shell, TDesign upload and sensitive dialog", () => {
    const source = readFileSync(new URL("./SettlementDetailPage.vue", import.meta.url), "utf8");
    expect(source).toContain("<BusinessDetailHeader");
    expect(source).toContain("<t-tabs");
    expect(source).toContain("<t-upload");
    expect(source).toContain("<SensitiveActionDialog");
    expect(source).not.toContain("<input");
    expect(source).not.toContain("confirmSensitiveAction");
    expect(source).not.toContain("promptSensitiveActionReason");
  });

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

  it("builds the standard detail header without repeating code and amount", () => {
    expect(buildSettlementDetailHeader(
      "route-code",
      settlementDetailTitle,
      settlementDetailMeta,
      settlementBaseInfo
    )).toEqual({
      businessCode: "JS-2026-018",
      title: "5月材料结算单",
      status: "待归档确认",
      statusTone: "primary",
      owner: "合同部",
      currentNode: "待归档确认",
      nextStep: "主管确认归档",
      amount: "¥320,000.00"
    });
    expect(settlementOverviewBaseInfo(settlementBaseInfo).map((item) => item.label)).not.toContain("结算金额");
  });

  it("organizes settlement detail by business task instead of infinite cards", () => {
    expect(settlementDetailTabs.map((tab) => tab.label)).toEqual([
      "概览",
      "流程办理",
      "结算明细",
      "凭证资料",
      "关联与审计"
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

  it("clears stale settlement facts and ignores stale responses when the route id changes", () => {
    const source = readFileSync(new URL("./SettlementDetailPage.vue", import.meta.url), "utf8");
    expect(source).toContain("() => route.params.settlementId");
    expect(source).toContain("clearSettlementDetailTransientState()");
    expect(source).toContain("settlementDetail.value = null");
    expect(source).toContain("activeTab.value = \"overview\"");
    expect(source).toContain("settlementId !== routeSettlementId()");
    expect(source).toContain("void reloadSettlementDetail()");
  });
});
