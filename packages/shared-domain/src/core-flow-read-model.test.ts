import { describe, expect, it } from "vitest";
import {
  CORE_FLOW_READ_ENDPOINTS,
  type ContractPaymentApplicationPreviewReadModel
} from "./core-flow-read-model";

describe("core flow read model contract", () => {
  it("defines the first read-only detail API endpoints", () => {
    expect(CORE_FLOW_READ_ENDPOINTS).toEqual({
      contractDetail: "/contracts/:contractId",
      settlementDetail: "/settlements/:settlementId",
      paymentDetail: "/payments/:paymentId",
      contractPaymentApplication: "/payments/contract-application"
    });
  });

  it("freezes the generic-contract payment mode and selectable contract stage in the read contract", () => {
    const preview = {
      contract: {
        contractId: "contract-1",
        contractVersionId: "version-1",
        contractNo: "HT-TY-001",
        contractName: "通用服务合同",
        contractVersion: "合同 v1",
        contractTypeKey: "generic_contract",
        projectId: "project-1",
        projectName: "项目一"
      },
      paymentMode: "generic_contract_stage",
      availableStages: [{
        paymentTermsStageId: "stage-1",
        paymentTermsVersionId: "terms-1",
        name: "验收后付款",
        stageType: "other",
        basis: "contract_amount",
        triggerAnchor: "contract_effective",
        triggerEvent: "验收通过",
        dueDays: 30,
        requiresInvoice: true,
        allowsInstallments: true,
        payableCents: "500000",
        occupiedCents: "0",
        maxRequestableCents: "500000",
        disabledReason: null
      }],
      genericContractCapacity: {
        contractAmountCents: "500000",
        contractOccupiedCents: "0",
        contractRemainingCents: "500000"
      },
      directPaymentSummary: {
        amountNature: "fixed_limit",
        unlimitedTotal: false,
        cumulativeRequestedCents: "0",
        cumulativeApprovedCents: "0",
        cumulativePaidCents: "0"
      },
      asOf: "2026-07-18T00:00:00.000Z",
      includedSettlements: [],
      capacity: {
        cumulativeEffectiveSettlementCents: "0",
        duePayableCents: "500000",
        occupiedCents: "0",
        actualPaidCents: "0",
        approvalPendingCents: "0",
        approvedPendingCents: "0",
        proxyPaidCents: "0",
        advanceDeductionCents: "0",
        maxRequestableCents: "500000"
      },
      advanceDeduction: {
        paidAdvanceCents: "0",
        currentDeductionCents: "0",
        remainingAdvanceToDeductCents: "0"
      },
      capacityExplanation: [],
      sections: [],
      formula: "冻结阶段可申请额度"
    } satisfies ContractPaymentApplicationPreviewReadModel;

    expect(preview.paymentMode).toBe("generic_contract_stage");
    expect(preview.availableStages[0]?.paymentTermsStageId).toBe("stage-1");
    expect(preview.genericContractCapacity.contractAmountCents).toBe("500000");
    expect(preview.genericContractCapacity.contractRemainingCents).toBe("500000");
    expect(preview.directPaymentSummary.amountNature).toBe("fixed_limit");
  });
});
