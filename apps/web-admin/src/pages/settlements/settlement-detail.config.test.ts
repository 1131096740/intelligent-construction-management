import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildSettlementFlowSummary,
  buildSettlementDetailHeader,
  buildSettlementSignatureEvidenceSlots,
  settlementBaseInfo,
  settlementArchiveResponsibilities,
  settlementAttachmentTemplates,
  settlementDetailMeta,
  settlementDetailTitle,
  settlementEffectivenessSteps,
  settlementPaymentBlockMessage,
  settlementPaymentRuleColumns,
  settlementLineColumns,
  settlementDetailTabs,
  settlementSignatureEvidenceKinds,
  settlementSignatureGenerationState,
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

  it("renders the governed settlement evidence pair without the legacy upload instruction", () => {
    const source = readFileSync(new URL("./SettlementDetailPage.vue", import.meta.url), "utf8");
    const panel = readFileSync(
      new URL("./components/SettlementSignatureEvidencePanel.vue", import.meta.url),
      "utf8"
    );
    expect(settlementSignatureEvidenceKinds).toEqual([
      "counterparty_signed_original",
      "final_internal_signed_copy"
    ]);
    expect(source).toContain("<SettlementSignatureEvidencePanel");
    expect(panel).toContain("<EvidenceFileCards");
    expect(panel).toContain("<ApprovalTimeline");
    expect(source).not.toContain("审批通过后上传归档件");
    expect(source).toContain("retrySettlementSignedDocumentGeneration");
    expect(source).toContain("regenerateSettlementSignedDocument");
    expect(source).toContain("confirmPureRenderingIssue: true");
    expect(source).toContain("requireReason: true");
    expect(source).toContain("requirePassword: true");
    expect(source).toContain(":disabled=\"detailLoading || Boolean(archiveActionBusy)\"");
  });

  it("keeps generated evidence states machine readable", () => {
    const original = {
      recordId: "original-record",
      fileId: "original-file",
      fileName: "乙方签章件.pdf",
      purpose: "乙方签章原件",
      purposeKey: "counterparty_signed_original" as const,
      mimeType: "application/pdf",
      sizeBytes: 100,
      status: "active",
      statusLabel: "证据已冻结",
      uploadedByName: "合同员",
      uploadedAt: "2026-07-18T00:00:00.000Z",
      confirmedByName: null,
      confirmedAt: null,
      canDownload: true,
      disabledReason: null,
      generationStatus: "not_applicable" as const,
      downloadability: "available" as const
    };
    expect(buildSettlementSignatureEvidenceSlots([original]).map((slot) => slot.files.length))
      .toEqual([1, 0]);
    expect(settlementSignatureGenerationState([original], [{
      key: "retry_signed_document_generation",
      label: "重试",
      kind: "primary",
      enabled: true,
      disabledReason: null
    }], "最终结算文件生成失败")).toBe("failed");
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

  it("shows the frozen inclusive, exclusive and tax amount columns", () => {
    expect(settlementLineColumns.map((column) => column.title)).toEqual([
      "来源",
      "结算内容",
      "单位",
      "本期工程量",
      "含税单价",
      "不含税单价",
      "税率",
      "含税金额",
      "不含税金额",
      "税额",
      "依据/原因",
      "备注"
    ]);
    expect(
      settlementLineColumns
        .filter((column) =>
          ["含税单价", "不含税单价", "税率", "含税金额", "不含税金额", "税额"].includes(
            String(column.title)
          )
        )
        .every((column) => column.align === "right")
    ).toBe(true);
  });

  it("renders the frozen tax fact summary once in the overview", () => {
    const source = readFileSync(new URL("./SettlementDetailPage.vue", import.meta.url), "utf8");
    expect(source).toContain("税务事实快照");
    expect(source).toContain("settlementTaxFactSummaryView");
    expect(source.match(/税务事实快照/gu)).toHaveLength(1);
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
