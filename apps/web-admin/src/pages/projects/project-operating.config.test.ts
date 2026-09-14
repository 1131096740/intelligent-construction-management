import type { ContractBusinessOptionReadModel } from "@jiangkong/shared-domain";
import { describe, expect, it } from "vitest";
import type { OperatingProjectionAggregateReadModel } from "../../api/core-flow-read.api";
import {
  buildExecutiveProjectOverview,
  buildProjectBusinessEntries,
  buildProxyPaymentLinkPayload,
  findProjectProxyContract,
  findProjectProxySettlement,
  formatExecutiveMoneyCents
} from "./project-operating.config";

describe("project-operating proxy payment helpers", () => {
  it("keeps unknown executive money distinct from a proven zero", () => {
    expect(formatExecutiveMoneyCents(null)).toBe("—");
    expect(formatExecutiveMoneyCents("0")).toBe("¥0.00");
    expect(formatExecutiveMoneyCents("12345")).toBe("¥123.45");
  });

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

  it("uses one server-side project-set projection for the executive overview", () => {
    const projection = projectOverview({
      id: "project-a",
      code: "P-A",
      name: "一号项目",
      contractAmountCents: "30000000",
      settlementAmountCents: "0",
      payableAmountCents: "0",
      actualReceiptsCents: "0",
      supplierRefundsCents: "0",
      actualPaidCents: "5000000",
      approvedPendingPaymentCents: "0",
      availableFundsCents: null,
      dataGaps: []
    }).operatingProjection as OperatingProjectionAggregateReadModel;
    projection.scope.projectCount = 2;
    projection.integrity.notices = ["存在待核验关系"];
    projection.evidence.gapFactCount = 1;

    const overview = buildExecutiveProjectOverview(projection, [
      { id: "project-b", code: "P-B", name: "二号项目" },
      { id: "project-a", code: "P-A", name: "一号项目" }
    ]);

    expect(overview.rows.map((row) => row.id)).toEqual(["project-a", "project-b"]);
    expect(overview.summary).toEqual({
      projectCount: 2,
      contractAmountCents: "30000000",
      settlementAmountCents: null,
      payableAmountCents: null,
      actualReceiptsCents: null,
      supplierRefundsCents: null,
      actualPaidCents: "5000000",
      approvedPendingPaymentCents: null,
      availableFundsCents: null,
      dataGapCount: 2
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
  supplierRefundsCents: string | null;
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
      legacyReceiptsCents: "0",
      affiliateRemittanceCents: overrides.actualReceiptsCents ?? "0",
      supplierRefundsCents: overrides.supplierRefundsCents,
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
      affiliateDownstreamPaymentCents: "0",
      operatingCostCents: null,
      grossProfitCents: null
    },
    upstreamFunds: {
      ownerPaymentCents: "0",
      affiliateRemittanceCents: overrides.actualReceiptsCents ?? "0",
      affiliateDeductionCents: "0",
      unreconciledReceiptDifferenceCents: "0",
      writtenCount: 0,
      oralCount: 0
    },
    counts: {
      contracts: 0,
      settlements: 0,
      payments: 0
    },
    dataGaps: overrides.dataGaps,
    operatingProjection: {
      scope: { label: "单项目口径", projectCount: 1 },
      asOf: {
        businessDate: "2026-09-11",
        readAt: "2026-09-11T00:00:00.000Z",
        retroactiveFactCount: 0
      },
      integrity: {
        statusLabel: "金额完整",
        moneyComplete: true,
        notices: []
      },
      commitments: { contractCommitmentCents: overrides.contractAmountCents },
      operating: {
        confirmedIncomeCents: "0",
        confirmedCostCents: "0",
        receivableCents: "0",
        payableCents: overrides.payableAmountCents
      },
      actualFunds: {
        constructionEnterpriseFundsCents: overrides.availableFundsCents ?? "0",
        companyProjectFundsCents: "0",
        netProjectCashPositionCents: overrides.availableFundsCents ?? "0",
        nonNegativeUsableCashStartCents: overrides.availableFundsCents ?? "0",
        confirmedProjectInflowsCents: overrides.actualReceiptsCents ?? "0",
        confirmedProjectOutflowsCents: overrides.actualPaidCents,
        companyAdvanceForProjectCents: "0",
        companyReturnableToProjectCents: "0",
        interSubjectBalanceCents: "0"
      },
      restrictions: {
        estimatedClearingExpenseCents: "0",
        necessaryExpenseReserveCents: "0",
        projectDisputedFundsCents: "0",
        constructionEnterpriseFrozenFundsCents: "0",
        openPendingReconciliationGrossCents: "0",
        openCoveredReconciliationCents: "0",
        openUncoveredReconciliationCents: "0",
        continuedWithheldRetainedCents: "0",
        temporaryProfitDistributionCents: "0",
        relationshipCompletenessLabel: "完整"
      },
      profitAndLoss: {
        currentOperatingProfitCents: "0",
        estimatedClearingExpenseCents: "0",
        currentEstimatedProfitCents: "0",
        finalConfirmedProfitCents: "0",
        finalConfirmable: true
      },
      distribution: {
        cashCeilingCents: overrides.availableFundsCents,
        projectedProfitCeilingCents: "0",
        currentDistributableProfitCents: "0"
      },
      evidence: {
        A: { factCount: 0, amountCents: "0" },
        B: { factCount: 0, amountCents: "0" },
        C: { factCount: 0, amountCents: "0" },
        gapFactCount: 0,
        gapAmountCents: "0"
      },
      sources: []
    }
  };
}
