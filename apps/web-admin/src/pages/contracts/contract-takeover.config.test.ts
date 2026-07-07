import type { ContractTakeoverReadModel } from "../../api/core-flow-read.api";
import { describe, expect, it } from "vitest";
import {
  canConfirmTakeover,
  canEditTakeover,
  canSubmitTakeoverReview,
  centsToYuanText,
  contractTakeoverColumns,
  lifecycleStatusLabel,
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
      "相对方",
      "合同金额",
      "接管等级",
      "接管状态",
      "履约状态",
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

  it("keeps historical balances separated in table rows", () => {
    const row = toContractTakeoverTableRow(takeover());

    expect(row).toMatchObject({
      contractNo: "HT-LS-001",
      contractName: "历史材料采购合同",
      amount: "¥1,000,000.00",
      takeoverStatusLabel: "待复核",
      lifecycleStatusLabel: "履约中",
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
    submittedAt: "2026-07-03T10:00:00.000Z",
    confirmedAt: null,
    historicalBalanceConfirmedAt: null,
    createdAt: "2026-07-03T09:00:00.000Z",
    updatedAt: "2026-07-03T10:00:00.000Z"
  };
}
