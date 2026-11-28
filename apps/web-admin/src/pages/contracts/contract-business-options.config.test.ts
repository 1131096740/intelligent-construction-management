import type { ContractBusinessOptionReadModel } from "@jiangkong/shared-domain";
import { describe, expect, it } from "vitest";
import {
  buildPaymentCreatePayload,
  contractOptionHint,
  contractOptionLabel,
  findContractOption,
  findSettlementOption,
  toContractSelectOptions,
  toSettlementSelectOptions
} from "./contract-business-options.config";

describe("contract business options configuration", () => {
  it("formats contract options with business-facing labels and disabled reasons", () => {
    const [enabled, disabled] = toContractSelectOptions([contract(), blockedContract()], "payment");

    expect(enabled).toMatchObject({
      label: "HT-001 · 材料采购合同 · 供应商",
      value: "version-1",
      disabled: false,
      hint: "历史接管 · 财务台账 · B级已接管 · 已生效 · ¥1,000,000.00"
    });
    expect(disabled).toMatchObject({
      label: "HT-002 · 待确认历史合同 · 供应商",
      value: "version-2",
      disabled: true,
      hint: "历史余额尚未确认，不能发起付款"
    });
    expect(contractOptionLabel(enabled.record)).toBe("HT-001 · 材料采购合同 · 供应商");
    expect(contractOptionHint(enabled.record)).toBe(
      "历史接管 · 财务台账 · B级已接管 · 已生效 · ¥1,000,000.00"
    );
  });

  it("formats settlement options and blocks fully paid settlements", () => {
    expect(toSettlementSelectOptions(contract())).toEqual([
      {
        label: "JS-001 · 2026-06 · ¥300,000.00",
        value: "settlement-1",
        disabled: false,
        hint: "审批通过 · 可发起单结算付款",
        record: contract().settlements[0]
      },
      {
        label: "JS-000 · 2026-05 · ¥200,000.00",
        value: "settlement-paid",
        disabled: true,
        hint: "结算未生效或已付款完成",
        record: contract().settlements[1]
      }
    ]);
  });

  it("submits a text-only contract agreement with its preview proof and no stage or settlement", () => {
    const fingerprint = "d".repeat(64);
    expect(buildPaymentCreatePayload(contract(), null, {
      sourceType: "contract_due", requestedAmountYuan: "550.00", code: "FK-TEXT-01",
      textAgreement: { paymentTermsVersionId: "terms-1", fingerprint },
      paymentMatter: " 巡检服务 ", amountCalculationExplanation: " 按已核对工单计价 "
    })).toEqual({
      sourceType: "contract_due", requestedAmountCents: "55000", code: "FK-TEXT-01",
      contractVersionId: "version-1", paymentTermsVersionId: "terms-1", expectedAgreementFingerprint: fingerprint,
      paymentMatter: "巡检服务", amountCalculationExplanation: "按已核对工单计价"
    });
  });

  it("builds payment payloads without requiring user-entered technical ids", () => {
    const selectedContract = findContractOption([contract()], "version-1");
    const selectedSettlement = findSettlementOption(selectedContract, "settlement-1");

    expect(
      buildPaymentCreatePayload(selectedContract, null, {
        sourceType: "contract_due",
        paymentTermsStageId: "stage-due-1",
        code: " FK-001 ",
        requestedAmountYuan: "2500"
      })
    ).toEqual({
      sourceType: "contract_due",
      contractVersionId: "version-1",
      paymentTermsStageId: "stage-due-1",
      code: "FK-001",
      requestedAmountCents: "250000"
    });
    expect(
      buildPaymentCreatePayload(selectedContract, selectedSettlement, {
        sourceType: "settlement",
        code: "FK-002",
        requestedAmountYuan: "999.99"
      })
    ).toEqual({
      sourceType: "settlement",
      settlementId: "settlement-1",
      code: "FK-002",
      requestedAmountCents: "99999"
    });
  });

  it("builds a signed settlement payment payload from the server-selected latest confirmation", () => {
    const selectedContract = findContractOption([contract()], "version-1");

    expect(
      buildPaymentCreatePayload(selectedContract, null, {
        sourceType: "signed_settlement",
        signedSettlementId: " signed-settlement-1 ",
        code: " FK-005 ",
        requestedAmountYuan: "1200"
      })
    ).toEqual({
      sourceType: "signed_settlement",
      signedSettlementId: "signed-settlement-1",
      code: "FK-005",
      requestedAmountCents: "120000"
    });
    expect(() =>
      buildPaymentCreatePayload(selectedContract, null, {
        sourceType: "signed_settlement",
        code: "FK-006",
        requestedAmountYuan: "1"
      })
    ).toThrow("最近确认的已签结算不能为空");
  });

  it("carries the construction-enterprise payment subject from the signed contract", () => {
    const selectedContract = findContractOption(
      [{ ...contract(), paymentSubjectType: "affiliate" }],
      "version-1"
    );

    expect(
      buildPaymentCreatePayload(selectedContract, null, {
        sourceType: "contract_due",
        paymentTermsStageId: "stage-due-1",
        code: "FK-AFFILIATE-001",
        requestedAmountYuan: "2500"
      })
    ).toMatchObject({ paymentSubjectType: "affiliate" });
  });

  it("requires a frozen payment stage for a new contract-due request", () => {
    expect(() =>
      buildPaymentCreatePayload(contract(), null, {
        sourceType: "contract_due",
        code: "FK-004",
        requestedAmountYuan: "1"
      })
    ).toThrow("请选择合同已冻结的付款阶段");
  });

  it("keeps blocked historical contracts out of payment payloads", () => {
    expect(() =>
      buildPaymentCreatePayload(blockedContract(), blockedContract().settlements[0], {
        sourceType: "settlement",
        code: "FK-003",
        requestedAmountYuan: "1"
      })
    ).toThrow("历史余额尚未确认，不能发起付款");
  });
});

function contract(): ContractBusinessOptionReadModel {
  return {
    contractId: "contract-1",
    contractVersionId: "version-1",
    contractNo: "HT-001",
    contractName: "材料采购合同",
    contractTypeKey: "material_purchase",
    counterparty: "供应商",
    amountCents: "100000000",
    versionLabel: "合同 v1",
    contractStatus: "effective",
    contractStatusLabel: "已生效",
    source: "historical_takeover",
    sourceLabel: "历史接管 · 财务台账",
    takeoverLevel: "B",
    takeoverStatus: "confirmed",
    takeoverStatusLabel: "已接管",
    historicalBalanceConfirmedAt: "2026-07-03T10:00:00.000Z",
    canCreateSettlement: true,
    settlementUnavailableReason: null,
    canCreatePayment: true,
    paymentUnavailableReason: null,
    settlements: [
      {
        settlementId: "settlement-1",
        settlementNo: "JS-001",
        periodLabel: "2026-06",
        amountCents: "30000000",
        payableAmountCents: "24000000",
        paidAmountCents: "0",
        status: "effective",
        statusLabel: "审批通过",
        canCreatePayment: true,
        unavailableReason: null
      },
      {
        settlementId: "settlement-paid",
        settlementNo: "JS-000",
        periodLabel: "2026-05",
        amountCents: "20000000",
        payableAmountCents: "16000000",
        paidAmountCents: "16000000",
        status: "paid",
        statusLabel: "审批通过",
        canCreatePayment: false,
        unavailableReason: "结算未生效或已付款完成"
      }
    ]
  };
}

function blockedContract(): ContractBusinessOptionReadModel {
  return {
    ...contract(),
    contractId: "contract-2",
    contractVersionId: "version-2",
    contractNo: "HT-002",
    contractName: "待确认历史合同",
    canCreatePayment: false,
    paymentUnavailableReason: "历史余额尚未确认，不能发起付款"
  };
}
