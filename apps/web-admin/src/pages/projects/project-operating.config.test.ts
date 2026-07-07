import type { ContractBusinessOptionReadModel } from "@jiangkong/shared-domain";
import { describe, expect, it } from "vitest";
import {
  buildProxyPaymentLinkPayload,
  findProjectProxyContract,
  findProjectProxySettlement
} from "./project-operating.config";

describe("project-operating proxy payment helpers", () => {
  it("builds proxy payment links from selected business options instead of typed ids", () => {
    const contract = contractOption();

    expect(findProjectProxyContract([contract], "version-1")).toEqual(contract);
    expect(findProjectProxySettlement(contract, "settlement-1")).toEqual(contract.settlements[0]);
    expect(buildProxyPaymentLinkPayload(contract, contract.settlements[0])).toEqual({
      contractId: "contract-1",
      settlementId: "settlement-1"
    });
  });

  it("omits links when no business option is selected", () => {
    expect(buildProxyPaymentLinkPayload(null, null)).toEqual({});
  });
});

function contractOption(): ContractBusinessOptionReadModel {
  return {
    contractId: "contract-1",
    contractVersionId: "version-1",
    contractNo: "HT-001",
    contractName: "材料采购合同",
    counterparty: "供应商",
    amountCents: 1_000_000,
    versionLabel: "合同 v1",
    contractStatus: "effective",
    contractStatusLabel: "已生效",
    source: "system",
    sourceLabel: "系统合同",
    takeoverLevel: null,
    takeoverStatus: null,
    takeoverStatusLabel: null,
    historicalBalanceConfirmedAt: null,
    canCreateSettlement: false,
    settlementUnavailableReason: null,
    canCreatePayment: true,
    paymentUnavailableReason: null,
    settlements: [
      {
        settlementId: "settlement-1",
        settlementNo: "JS-001",
        periodLabel: "2026-06",
        amountCents: 500_000,
        payableAmountCents: 400_000,
        paidAmountCents: 100_000,
        status: "effective",
        statusLabel: "已生效",
        canCreatePayment: true,
        unavailableReason: null
      }
    ]
  };
}
