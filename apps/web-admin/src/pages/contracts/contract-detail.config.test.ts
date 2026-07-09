import { describe, expect, it } from "vitest";
import { normalizeBusinessStatusSummaryItems } from "../../components/business-status-summary.config";
import {
  buildContractFlowSummary,
  buildContractFundTimeline,
  contractBaseInfo,
  contractDetailMeta,
  contractEffectivenessSteps,
  contractPaymentLedgerColumns,
  contractPaymentTermColumns,
  contractSettlementLedgerColumns,
  contractSettlementBlockMessage
} from "./contract-detail.config";

describe("contract detail page configuration", () => {
  it("shows the approved contract detail metadata fields", () => {
    expect(contractDetailMeta.map((item) => item.label)).toEqual([
      "当前状态",
      "当前版本",
      "付款条款",
      "责任部门",
      "当前处理人",
      "下一步动作"
    ]);
  });

  it("builds a compact flow summary from existing contract detail fields", () => {
    expect(buildContractFlowSummary(contractDetailMeta, contractBaseInfo)).toEqual([
      { label: "当前状态", value: "待用章", tone: "warning" },
      { label: "当前版本", value: "原合同 v1" },
      { label: "合同金额", value: "¥1,200,000.00" },
      { label: "当前处理人", value: "王工" },
      { label: "下一步动作", value: "办理用章", tone: "warning" }
    ]);
  });

  it("stays compatible with the shared business status summary component", () => {
    expect(normalizeBusinessStatusSummaryItems(buildContractFlowSummary([], []))).toEqual([
      { label: "当前状态", value: "-", tone: "default" },
      { label: "当前版本", value: "-", tone: "default" },
      { label: "合同金额", value: "-", tone: "default" },
      { label: "当前处理人", value: "-", tone: "default" },
      { label: "下一步动作", value: "-", tone: "default" }
    ]);
  });

  it("uses a dash when flow summary source fields are missing", () => {
    expect(buildContractFlowSummary([], [])[2]).toEqual({
      label: "合同金额",
      value: "-",
      tone: undefined
    });
  });

  it("keeps the strict effectiveness sequence visible", () => {
    expect(contractEffectivenessSteps.map((step) => step.label)).toEqual([
      "合同审批",
      "用章",
      "归档上传",
      "主管确认",
      "合同生效"
    ]);
  });

  it("shows multi-stage payment term traceability columns", () => {
    expect(contractPaymentTermColumns.map((column) => column.title)).toEqual([
      "版本",
      "状态",
      "适用合同版本",
      "计算依据",
      "比例",
      "账期",
      "触发事件",
      "操作"
    ]);
  });

  it("states that non-effective contracts block settlement creation", () => {
    expect(contractSettlementBlockMessage).toBe(
      "合同尚未生效，暂不可发起结算；结算未生效前不可创建付款申请。"
    );
  });

  it("shows contract settlement and payment ledger columns", () => {
    expect(contractSettlementLedgerColumns.map((column) => column.title)).toEqual([
      "结算编号",
      "期次",
      "更新时间",
      "结算方式",
      "本期结算金额",
      "期前累计结算",
      "期后累计结算",
      "审批状态",
      "归档状态",
      "操作"
    ]);
    expect(contractPaymentLedgerColumns.map((column) => column.title)).toEqual([
      "付款申请单号",
      "关联结算",
      "申请金额",
      "已批金额",
      "已实付金额",
      "最近付款日期",
      "审批状态",
      "付款状态",
      "凭证状态",
      "操作"
    ]);
  });

  it("builds a reverse chronological fund timeline from settlement and payment rows", () => {
    expect(
      buildContractFundTimeline(
        [
          {
            id: "settlement-1",
            settlementNo: "JS-001",
            period: "2026-06",
            settlementDate: "2026-06-30",
            settlementMethod: "过程结算",
            currentAmount: "¥100.00",
            cumulativeBeforeAmount: "¥0.00",
            cumulativeAfterAmount: "¥100.00",
            approvalStatus: "已通过",
            archiveStatus: "已生效"
          }
        ],
        [
          {
            id: "payment-1",
            paymentNo: "FK-001",
            settlementNo: "JS-001",
            requestedAmount: "¥80.00",
            approvedAmount: "¥80.00",
            paidAmount: "¥50.00",
            paymentDate: "2026-07-02",
            approvalStatus: "已批待付",
            paymentStatus: "部分付款",
            voucherStatus: "已上传"
          }
        ]
      ).map((item) => ({
        id: item.id,
        title: item.title,
        amount: item.amount,
        tone: item.tone
      }))
    ).toEqual([
      { id: "payment:payment-1", title: "付款 FK-001", amount: "¥50.00", tone: "warning" },
      { id: "settlement:settlement-1", title: "结算 JS-001", amount: "¥100.00", tone: "success" }
    ]);
  });
});
