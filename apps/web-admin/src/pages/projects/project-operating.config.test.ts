import type { ContractBusinessOptionReadModel } from "@jiangkong/shared-domain";
import { describe, expect, it } from "vitest";
import {
  buildProjectBusinessEntries,
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

  it("builds project container entries across business modules", () => {
    const encodedProject = "%E5%BB%BA%E5%B7%A5%E4%B8%80%E5%8F%B7%20%E9%A1%B9%E7%9B%AE";

    expect(
      buildProjectBusinessEntries("建工一号 项目", {
        contracts: 2,
        settlements: 3,
        payments: 4
      }).map((entry) => ({ label: entry.label, path: entry.path, count: entry.count }))
    ).toEqual([
      { label: "合同", path: `/合同管理?project=${encodedProject}`, count: 2 },
      { label: "结算", path: `/结算管理?project=${encodedProject}`, count: 3 },
      { label: "付款", path: `/付款管理?project=${encodedProject}`, count: 4 },
      { label: "资料", path: `/资料库?project=${encodedProject}`, count: undefined },
      { label: "审批", path: `/审批中心?project=${encodedProject}`, count: undefined },
      { label: "审计", path: `/审计日志?project=${encodedProject}`, count: undefined }
    ]);
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
