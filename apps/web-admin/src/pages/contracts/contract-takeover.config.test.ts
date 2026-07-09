import type { ContractTakeoverReadModel } from "../../api/core-flow-read.api";
import { describe, expect, it } from "vitest";
import {
  buildTakeoverConfirmationSummary,
  canConfirmTakeover,
  canEditTakeover,
  canSubmitTakeoverReview,
  centsToYuanText,
  contractTakeoverColumns,
  lifecycleStatusLabel,
  parseContractTakeoverImportPrecheckRows,
  takeoverWorkbenchSteps,
  takeoverLevelLabel,
  takeoverStatusLabel,
  takeoverStatusTone,
  toContractTakeoverTableRow,
  yuanToCents
} from "./contract-takeover.config";

describe("contract takeover page configuration", () => {
  it("uses compact columns for historical contract takeover ledger", () => {
    expect(contractTakeoverColumns.map((column) => column.title)).toEqual([
      "合同编号",
      "合同名称",
      "接管批次",
      "相对方",
      "合同金额",
      "接管等级",
      "接管状态",
      "履约状态",
      "接管截止日",
      "历史已付",
      "在途/待付",
      "更新时间",
      "操作"
    ]);
  });

  it("converts yuan input to integer cents with BigInt-safe parsing", () => {
    expect(yuanToCents("0.01", "历史已付")).toBe(1);
    expect(yuanToCents("1234567.89", "合同金额")).toBe(123456789);
    expect(yuanToCents("", "历史总包代付", { allowZero: true })).toBe(0);
    expect(yuanToCents("0", "历史总包代付", { allowZero: true })).toBe(0);

    expect(() => yuanToCents("0", "合同金额")).toThrow("合同金额必须大于 0");
    expect(() => yuanToCents("-1", "历史已付")).toThrow("历史已付必须是非负数字");
    expect(() => yuanToCents("1.234", "历史已付")).toThrow("历史已付必须是非负数字");
    expect(() => yuanToCents("abc", "历史已付")).toThrow("历史已付必须是非负数字");
  });

  it("parses pasted takeover import rows without shifting blank leading TSV cells", () => {
    const rows = parseContractTakeoverImportPrecheckRows(
      [
        "合同编号\t合同名称\t相对方\t我方主体\t合同金额(元)\t签订日期\t接管等级\t履约状态",
        "\t缺编号合同\t历史供应商\t建工集团\t100.00\t2026-01-01\tB\tin_progress"
      ].join("\n")
    );

    expect(rows[0]).toMatchObject({
      rowNo: 2,
      code: "",
      name: "缺编号合同",
      counterparty: "历史供应商",
      amountCents: 10000
    });
  });

  it("keeps invalid historical amount cells visible to backend precheck", () => {
    const rows = parseContractTakeoverImportPrecheckRows(
      [
        "code,name,counterparty,company,amount,signedAt,level,status,terms,settled",
        "HT-LS-001,历史合同,历史供应商,建工集团,100.00,2026-01-01,B,in_progress,按月付款,abc"
      ].join("\n")
    );

    expect(rows[0]).toMatchObject({
      code: "HT-LS-001",
      amountCents: 10000,
      historicalSettledCents: null
    });
  });

  it("parses evidence checklist and issue summary for takeover import precheck", () => {
    const rows = parseContractTakeoverImportPrecheckRows(
      [
        "合同编号\t合同名称\t相对方\t我方主体\t合同金额(元)\t签订日期\t接管等级\t履约状态\t付款条款\t历史累计结算(元)\t历史审批中付款(元)\t历史已批待付(元)\t历史累计已付(元)\t历史总包代付(元)\t历史预付款已付(元)\t历史预付款已扣回(元)\t历史质保金扣留(元)\t历史质保金释放(元)\t其他确认占用(元)\t余额来源\t证据说明\t资料清单\t问题清单",
        "HT-LS-002\t历史合同\t供应商\t建工集团\t100.00\t2026-01-01\tC\tin_progress\t按月付款\t0\t0\t0\t0\t0\t0\t0\t0\t0\t0\t财务台账\t合同扫描件\t缺历史付款凭证\t财务本周补凭证"
      ].join("\n")
    );

    expect(rows[0]).toMatchObject({
      evidenceChecklist: "缺历史付款凭证",
      issueSummary: "财务本周补凭证"
    });
  });

  it("formats cents from API string or number values for display", () => {
    expect(centsToYuanText(0)).toBe("¥0.00");
    expect(centsToYuanText(1)).toBe("¥0.01");
    expect(centsToYuanText("123456789")).toBe("¥1,234,567.89");
  });

  it("maps takeover status and lifecycle status to Chinese display", () => {
    expect(takeoverLevelLabel("A")).toBe("A级");
    expect(takeoverStatusLabel("pending_review")).toBe("待复核");
    expect(takeoverStatusTone("confirmed")).toBe("success");
    expect(lifecycleStatusLabel("signed_not_started")).toBe("已签未开工");
  });

  it("shows workflow actions only for allowed statuses", () => {
    expect(canSubmitTakeoverReview({ takeoverStatus: "draft" })).toBe(true);
    expect(canSubmitTakeoverReview({ takeoverStatus: "needs_supplement" })).toBe(true);
    expect(canSubmitTakeoverReview({ takeoverStatus: "pending_review" })).toBe(false);
    expect(canSubmitTakeoverReview({ takeoverStatus: "confirmed" })).toBe(false);

    expect(canConfirmTakeover({ takeoverStatus: "pending_review" })).toBe(true);
    expect(canConfirmTakeover({ takeoverStatus: "draft" })).toBe(false);
    expect(canConfirmTakeover({ takeoverStatus: "confirmed" })).toBe(false);

    expect(canEditTakeover({ takeoverStatus: "draft" })).toBe(true);
    expect(canEditTakeover({ takeoverStatus: "needs_supplement" })).toBe(true);
    expect(canEditTakeover({ takeoverStatus: "pending_review" })).toBe(false);
  });

  it("describes the takeover workbench as an eight-step office workflow", () => {
    expect(takeoverWorkbenchSteps(null).map((step) => step.label)).toEqual([
      "接管准备",
      "导入预检",
      "生成草稿",
      "单合同补录",
      "资料核验",
      "多部门复核",
      "主管确认",
      "接管后核验"
    ]);

    expect(takeoverWorkbenchSteps(takeover()).map((step) => step.status)).toEqual([
      "已完成",
      "已完成",
      "已完成",
      "已完成",
      "已完成",
      "处理中",
      "未开始",
      "未开始"
    ]);

    expect(takeoverWorkbenchSteps({ ...takeover(), takeoverStatus: "confirmed" }).at(-1)).toMatchObject({
      label: "接管后核验",
      status: "已完成",
      tone: "success"
    });
  });

  it("builds a confirmation summary with historical money and business consequence", () => {
    const summary = buildTakeoverConfirmationSummary(takeover());

    expect(summary.items).toEqual([
      { label: "接管截止日", value: "2026-06-30" },
      { label: "接管等级", value: "B级" },
      { label: "历史累计结算", value: "¥600,000.00" },
      { label: "历史累计已付", value: "¥300,000.00" },
      { label: "历史在途/待付", value: "¥30,000.00" },
      { label: "历史预付款已付/已扣回", value: "¥50,000.00 / ¥10,000.00" },
      { label: "历史质保金扣留/释放", value: "¥30,000.00 / ¥10,000.00" }
    ]);
    expect(summary.consequence).toContain("确认后会形成系统期初事实");
    expect(summary.riskText).toContain("B级");
    expect(summary.evidenceText).toBe("合同与凭证");
  });

  it("keeps historical balances separated in table rows", () => {
    const row = toContractTakeoverTableRow(takeover());

    expect(row).toMatchObject({
      contractNo: "HT-LS-001",
      contractName: "历史材料采购合同",
      batchNo: "接管批次-20260710-TEST0001",
      importRowNo: "第 2 行",
      amount: "¥1,000,000.00",
      takeoverStatusLabel: "待复核",
      lifecycleStatusLabel: "履约中",
      takeoverCutoffDate: "2026-06-30",
      historicalSettled: "¥600,000.00",
      historicalPaid: "¥300,000.00",
      historicalPending: "¥30,000.00",
      historicalProxyPaid: "¥40,000.00"
    });
  });
});

function takeover(): ContractTakeoverReadModel {
  return {
    id: "takeover-1",
    batchNo: "接管批次-20260710-TEST0001",
    importRowNo: 2,
    contractNo: "HT-LS-001",
    contractName: "历史材料采购合同",
    counterparty: "历史供应商",
    companyEntityName: "建工智管公司",
    amountCents: "100000000",
    paymentTermsOriginalText: "按月结算，归档后付款",
    takeoverLevel: "B",
    takeoverStatus: "pending_review",
    lifecycleStatus: "in_progress",
    signedAt: "2026-01-01T00:00:00.000Z",
    historicalSettledCents: "60000000",
    historicalApprovalPendingPaymentCents: "1000000",
    historicalApprovedPendingPaymentCents: "2000000",
    historicalPaidCents: "30000000",
    historicalProxyPaidCents: "4000000",
    historicalAdvancePaidCents: "5000000",
    historicalAdvanceDeductedCents: "1000000",
    historicalRetentionWithheldCents: "3000000",
    historicalRetentionReleasedCents: "1000000",
    otherConfirmedOccupancyCents: "800000",
    balanceSourceSummary: "财务台账",
    evidenceSummary: "合同与凭证",
    takeoverCutoffDate: "2026-06-30T00:00:00.000Z",
    responsibleUserId: "contract-director-1",
    reviewComment: "预算已复核结算口径",
    acceptanceConclusion: "作为 A 级活跃合同继续办理",
    submittedAt: "2026-07-03T10:00:00.000Z",
    confirmedAt: null,
    historicalBalanceConfirmedAt: null,
    evidenceFiles: [],
    createdAt: "2026-07-03T09:00:00.000Z",
    updatedAt: "2026-07-03T10:00:00.000Z"
  };
}
