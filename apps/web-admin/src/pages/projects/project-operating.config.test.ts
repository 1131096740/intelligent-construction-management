import type { ContractBusinessOptionReadModel } from "@jiangkong/shared-domain";
import { describe, expect, it } from "vitest";
import {
  buildExecutiveProjectOverview,
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

  it("aggregates visible projects into an executive overview", () => {
    const overview = buildExecutiveProjectOverview([
      projectOverview({
        id: "project-a",
        code: "P-A",
        name: "一号项目",
        contractAmountCents: "10000000",
        settlementAmountCents: "6000000",
        payableAmountCents: "4000000",
        actualReceiptsCents: "5000000",
        actualPaidCents: "2000000",
        approvedPendingPaymentCents: "1000000",
        availableFundsCents: "3000000",
        dataGaps: ["缺收款依据"]
      }),
      projectOverview({
        id: "project-b",
        code: "P-B",
        name: "二号项目",
        contractAmountCents: "20000000",
        settlementAmountCents: "8000000",
        payableAmountCents: "5000000",
        actualReceiptsCents: null,
        actualPaidCents: "3000000",
        approvedPendingPaymentCents: "2000000",
        availableFundsCents: null,
        dataGaps: []
      })
    ]);

    expect(overview.rows.map((row) => row.id)).toEqual(["project-b", "project-a"]);
    expect(overview.summary).toEqual({
      projectCount: 2,
      contractAmountCents: "30000000",
      settlementAmountCents: "14000000",
      payableAmountCents: "9000000",
      actualReceiptsCents: "5000000",
      actualPaidCents: "5000000",
      approvedPendingPaymentCents: "3000000",
      availableFundsCents: "3000000",
      dataGapCount: 1
    });
  });
});

function contractOption(): ContractBusinessOptionReadModel {
  return {
    contractId: "contract-1",
    contractVersionId: "version-1",
    contractNo: "HT-001",
    contractName: "材料采购合同",
    contractTypeKey: "material_purchase",
    counterparty: "供应商",
    amountCents: "1000000",
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
        amountCents: "500000",
        payableAmountCents: "400000",
        paidAmountCents: "100000",
        status: "effective",
        statusLabel: "已生效",
        canCreatePayment: true,
        unavailableReason: null
      }
    ]
  };
}

function projectOverview(overrides: {
  id: string;
  code: string;
  name: string;
  contractAmountCents: string;
  settlementAmountCents: string;
  payableAmountCents: string;
  actualReceiptsCents: string | null;
  actualPaidCents: string;
  approvedPendingPaymentCents: string;
  availableFundsCents: string | null;
  dataGaps: string[];
}) {
  return {
    project: {
      id: overrides.id,
      code: overrides.code,
      name: overrides.name
    },
    cash: {
      actualReceiptsCents: overrides.actualReceiptsCents,
      availableFundsCents: overrides.availableFundsCents,
      actualPaidCents: overrides.actualPaidCents,
      approvalPendingOccupancyCents: "0",
      approvedPendingPaymentCents: overrides.approvedPendingPaymentCents,
      financeRecordedOutflowCents: "0"
    },
    business: {
      effectiveContractAmountCents: overrides.contractAmountCents,
      effectiveSettlementAmountCents: overrides.settlementAmountCents,
      payableSettlementAmountCents: overrides.payableAmountCents,
      operatingIncomeCents: null,
      operatingCostCents: null,
      grossProfitCents: null
    },
    counts: {
      contracts: 0,
      settlements: 0,
      payments: 0
    },
    dataGaps: overrides.dataGaps
  };
}
