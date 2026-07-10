import * as settlementPaymentCapacity from "./settlement-payment-capacity";

interface ContractDueSettlement {
  id: string;
  status: string;
  amountCents: bigint;
  paidAmountCents?: bigint;
  paymentTermsVersionId: string;
  isFinal?: boolean;
  sourceType?: string | null;
  sourceTakeoverId?: string | null;
}

interface ContractDuePaymentTermsStage {
  paymentTermsVersionId: string;
  stageType?: string;
  basis: string;
  ratioBps: number | null;
  fixedAmountCents: bigint | null;
  triggerAnchor?: string;
  dueDays: number;
  advanceDeductionMode?: string | null;
  advanceDeductionRatioBps?: number | null;
  advanceDeductionStartRatioBps?: number | null;
}

interface ContractDueSettlementArchiveFile {
  settlementId: string;
  confirmedAt: Date | null;
}

interface ContractDuePaymentRequest {
  settlementId: string | null;
  sourceType?: string | null;
  status: string;
  requestedAmountCents: bigint;
  approvedAmountCents?: bigint | null;
  paidAmountCents: bigint;
}

interface ContractDuePaymentCapacity {
  duePayableCents: bigint;
  occupiedCents: bigint;
  remainingCents: bigint;
  advanceDeductionCents?: bigint;
}

interface ContractAdvancePaymentRequest {
  paymentTermsVersionId?: string;
  status: string;
  requestedAmountCents: bigint;
  approvedAmountCents?: bigint | null;
  paidAmountCents: bigint;
}

interface HistoricalContractPaymentBalance {
  paymentTermsVersionId?: string;
  balanceConfirmedAt?: Date | null;
  settledCents?: bigint;
  approvalPendingPaymentCents?: bigint;
  approvedPendingPaymentCents?: bigint;
  paidCents?: bigint;
  proxyPaidCents?: bigint;
  advancePaidCents?: bigint;
  advanceDeductedCents?: bigint;
  retentionWithheldCents?: bigint;
  retentionReleasedCents?: bigint;
  otherConfirmedOccupancyCents?: bigint;
}

interface ContractPaymentApplicationPreview {
  capacity: {
    cumulativeEffectiveSettlementCents: string;
    systemCumulativeEffectiveSettlementCents?: string;
    historicalSettledCents?: string;
    duePayableCents: string;
    occupiedCents: string;
    historicalOccupiedCents?: string;
    advanceDeductionCents: string;
    maxRequestableCents: string;
  };
  advanceDeduction: {
    paidAdvanceCents: string;
    systemPaidAdvanceCents?: string;
    historicalAdvancePaidCents?: string;
    historicalAdvanceDeductedCents?: string;
    currentDeductionCents: string;
    remainingAdvanceToDeductCents: string;
  };
  historicalBalance?: {
    settledCents: string;
    approvalPendingPaymentCents: string;
    approvedPendingPaymentCents: string;
    paidCents: string;
    proxyPaidCents: string;
    advancePaidCents: string;
    advanceDeductedCents: string;
    retentionWithheldCents: string;
    retentionReleasedCents: string;
    otherConfirmedOccupancyCents: string;
  };
  sections: Array<{
    type: "advance" | "progress" | "final" | "retention";
    title: string;
    rows: Array<{
      id: string;
      source: string;
      settlementId?: string | null;
      contractVersionId?: string;
      paymentTermsVersionId?: string;
      stageId?: string;
      stageName?: string;
      triggerAnchor?: string;
      dueDays?: number;
      ratioBps?: number | null;
      fixedAmountCents?: string | null;
      currentSettlementAmountCents: string;
      cumulativeBeforeAmountCents: string;
      cumulativeAfterAmountCents: string;
      effectiveAt: Date | null;
      expectedPayableAt: Date | null;
      paymentRule: string;
      isDue: boolean;
      includableAmountCents: string;
    }>;
  }>;
}

type ContractDuePaymentCapacityCalculator = (input: {
  asOf: Date;
  contractEffectiveAt?: Date | null;
  settlements: readonly ContractDueSettlement[];
  paymentTermsStages: readonly ContractDuePaymentTermsStage[];
  settlementArchiveFiles: readonly ContractDueSettlementArchiveFile[];
  paymentRequests: readonly ContractDuePaymentRequest[];
  proxyPaidAmountCents?: bigint;
  contractAmountCents?: bigint;
  contractAmountCentsByPaymentTermsVersionId?: Readonly<Record<string, bigint>>;
  advancePaymentRequests?: readonly ContractAdvancePaymentRequest[];
  historicalBalance?: HistoricalContractPaymentBalance;
}) => ContractDuePaymentCapacity;

type ContractPaymentApplicationPreviewBuilder = (
  input: Parameters<ContractDuePaymentCapacityCalculator>[0]
) => ContractPaymentApplicationPreview;

interface ContractDuePaymentExecutionAllocation {
  sourceRowId: string;
  settlementId: string;
  contractVersionId: string | null;
  paymentTermsVersionId: string;
  stageType: "progress" | "final" | "retention";
  stageId: string | null;
  stageName: string | null;
  triggerAnchor: string | null;
  dueDays: number | null;
  ratioBps: number | null;
  fixedAmountCents: bigint | null;
  sourceEffectiveAt: Date | null;
  expectedPayableAt: Date | null;
  sourcePayableAmountCents: bigint;
  amountCents: bigint;
}

type ContractDuePaymentExecutionAllocator = (input: {
  amountCents: bigint;
  sections: ContractPaymentApplicationPreview["sections"];
  existingAllocations?: readonly {
    sourceRowId: string;
    amountCents: bigint;
  }[];
}) => ContractDuePaymentExecutionAllocation[];

type ContractAdvancePaymentCapacityCalculator = (input: {
  asOf: Date;
  contractAmountCents: bigint;
  contractEffectiveAt: Date | null;
  paymentTermsStages: readonly ContractDuePaymentTermsStage[];
  paymentRequests: readonly ContractAdvancePaymentRequest[];
  historicalBalance?: HistoricalContractPaymentBalance;
}) => ContractDuePaymentCapacity;

const calculateContractDuePaymentCapacity = (
  settlementPaymentCapacity as unknown as {
    calculateContractDuePaymentCapacity?: ContractDuePaymentCapacityCalculator;
  }
).calculateContractDuePaymentCapacity;

const calculateContractAdvancePaymentCapacity = (
  settlementPaymentCapacity as unknown as {
    calculateContractAdvancePaymentCapacity?: ContractAdvancePaymentCapacityCalculator;
  }
).calculateContractAdvancePaymentCapacity;

const buildContractPaymentApplicationPreview = (
  settlementPaymentCapacity as unknown as {
    buildContractPaymentApplicationPreview?: ContractPaymentApplicationPreviewBuilder;
  }
).buildContractPaymentApplicationPreview;

const allocateContractDuePaymentExecution = (
  settlementPaymentCapacity as unknown as {
    allocateContractDuePaymentExecution?: ContractDuePaymentExecutionAllocator;
  }
).allocateContractDuePaymentExecution;

function calculateContractCapacity(
  input: Parameters<ContractDuePaymentCapacityCalculator>[0]
): ContractDuePaymentCapacity {
  if (!calculateContractDuePaymentCapacity) {
    throw new Error("calculateContractDuePaymentCapacity is not exported");
  }

  return calculateContractDuePaymentCapacity(input);
}

describe("calculateSettlementPaymentCapacityBigInt", () => {
  it("keeps large settlement capacity accumulation and comparison in bigint", () => {
    expect(
      settlementPaymentCapacity.calculateSettlementPaymentCapacityBigInt({
        payableAmountCents: 9_007_199_254_740_993n,
        actualPaidAmountCents: 1n,
        proxyPaidAmountCents: 2n,
        paymentRequests: [
          {
            status: "approved_pending_payment",
            requestedAmountCents: 5n,
            approvedAmountCents: 4n,
            paidAmountCents: 1n
          }
        ]
      })
    ).toEqual({
      outstandingPaymentCents: 3n,
      occupiedCents: 6n,
      remainingCents: 9_007_199_254_740_987n
    });
  });

  it("keeps due contract capacity in bigint until the external boundary", () => {
    expect(
      settlementPaymentCapacity.calculateContractDuePaymentCapacityBigInt({
        asOf: new Date("2026-07-10T00:00:00.000Z"),
        settlements: [
          {
            id: "settlement-large",
            status: "effective",
            amountCents: 9_007_199_254_740_993n,
            paidAmountCents: 1n,
            paymentTermsVersionId: "terms-large"
          }
        ],
        paymentTermsStages: [
          {
            paymentTermsVersionId: "terms-large",
            basis: "current_settlement",
            ratioBps: 10_000,
            fixedAmountCents: null,
            dueDays: 0
          }
        ],
        settlementArchiveFiles: [
          {
            settlementId: "settlement-large",
            confirmedAt: new Date("2026-07-09T00:00:00.000Z")
          }
        ],
        paymentRequests: []
      })
    ).toEqual({
      duePayableCents: 9_007_199_254_740_993n,
      occupiedCents: 1n,
      remainingCents: 9_007_199_254_740_992n
    });
  });

  it("keeps contract advance capacity in bigint until the external boundary", () => {
    expect(
      settlementPaymentCapacity.calculateContractAdvancePaymentCapacityBigInt({
        asOf: new Date("2026-07-10T00:00:00.000Z"),
        contractAmountCents: 9_007_199_254_740_993n,
        contractEffectiveAt: new Date("2026-07-09T00:00:00.000Z"),
        paymentTermsStages: [
          {
            paymentTermsVersionId: "terms-large",
            stageType: "advance",
            basis: "contract_amount",
            ratioBps: 10_000,
            fixedAmountCents: null,
            triggerAnchor: "contract_effective",
            dueDays: 0
          }
        ],
        paymentRequests: []
      })
    ).toEqual({
      duePayableCents: 9_007_199_254_740_993n,
      occupiedCents: 0n,
      remainingCents: 9_007_199_254_740_993n
    });
  });

  it("rejects any number contract amount before bigint calculation", () => {
    expect(() =>
      settlementPaymentCapacity.calculateContractAdvancePaymentCapacityBigInt({
        asOf: new Date("2026-07-10T00:00:00.000Z"),
        contractAmountCents: 1 as unknown as bigint,
        contractEffectiveAt: null,
        paymentTermsStages: [],
        paymentRequests: []
      })
    ).toThrow("合同金额必须为 bigint 分值");
  });

  it("rejects an unsafe historical paid amount at the contract capacity boundary", () => {
    expect(() =>
      settlementPaymentCapacity.calculateContractDuePaymentCapacityBigInt({
        asOf: new Date("2026-07-10T00:00:00.000Z"),
        settlements: [],
        paymentTermsStages: [],
        settlementArchiveFiles: [],
        paymentRequests: [],
        historicalBalance: {
          balanceConfirmedAt: new Date("2026-07-09T00:00:00.000Z"),
          paidCents: 1 as unknown as bigint
        }
      })
    ).toThrow("历史已付金额必须为 bigint 分值");
  });
});

function calculateAdvanceCapacity(
  input: Parameters<ContractAdvancePaymentCapacityCalculator>[0]
): ContractDuePaymentCapacity {
  if (!calculateContractAdvancePaymentCapacity) {
    throw new Error("calculateContractAdvancePaymentCapacity is not exported");
  }

  return calculateContractAdvancePaymentCapacity(input);
}

function buildApplicationPreview(
  input: Parameters<ContractPaymentApplicationPreviewBuilder>[0]
): ContractPaymentApplicationPreview {
  if (!buildContractPaymentApplicationPreview) {
    throw new Error("buildContractPaymentApplicationPreview is not exported");
  }

  return buildContractPaymentApplicationPreview(input);
}

describe("calculateContractDuePaymentCapacity", () => {
  const asOf = new Date("2026-07-20T00:00:00.000Z");

  it("does not count effective settlements before their current-settlement stage is due", () => {
    const capacity = calculateContractCapacity({
      asOf,
      settlements: [
        {
          id: "settlement-due",
          status: "effective",
          amountCents: 100_000n,
          paymentTermsVersionId: "terms-due"
        },
        {
          id: "settlement-not-due",
          status: "effective",
          amountCents: 80_000n,
          paymentTermsVersionId: "terms-not-due"
        }
      ],
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-due",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          dueDays: 30
        },
        {
          paymentTermsVersionId: "terms-not-due",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          dueDays: 30
        }
      ],
      settlementArchiveFiles: [
        {
          settlementId: "settlement-due",
          confirmedAt: new Date("2026-06-01T00:00:00.000Z")
        },
        {
          settlementId: "settlement-not-due",
          confirmedAt: new Date("2026-07-10T00:00:00.000Z")
        }
      ],
      paymentRequests: []
    });

    expect(capacity).toEqual({
      duePayableCents: 80_000n,
      occupiedCents: 0n,
      remainingCents: 80_000n
    });
  });

  it("deducts in-flight payments from another settlement under the same contract", () => {
    const capacity = calculateContractCapacity({
      asOf,
      settlements: [
        {
          id: "settlement-current",
          status: "effective",
          amountCents: 100_000n,
          paymentTermsVersionId: "terms-current"
        },
        {
          id: "settlement-other",
          status: "effective",
          amountCents: 50_000n,
          paymentTermsVersionId: "terms-other"
        }
      ],
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-current",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          dueDays: 0
        },
        {
          paymentTermsVersionId: "terms-other",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          dueDays: 0
        }
      ],
      settlementArchiveFiles: [
        {
          settlementId: "settlement-current",
          confirmedAt: new Date("2026-06-01T00:00:00.000Z")
        },
        {
          settlementId: "settlement-other",
          confirmedAt: new Date("2026-06-01T00:00:00.000Z")
        }
      ],
      paymentRequests: [
        {
          settlementId: "settlement-other",
          status: "approval_pending",
          requestedAmountCents: 30_000n,
          approvedAmountCents: null,
          paidAmountCents: 0n
        }
      ]
    });

    expect(capacity).toEqual({
      duePayableCents: 120_000n,
      occupiedCents: 30_000n,
      remainingCents: 90_000n
    });
  });

  it("deducts paid contract-level due payments that are not allocated to a settlement", () => {
    const capacity = calculateContractCapacity({
      asOf,
      settlements: [
        {
          id: "settlement-1",
          status: "effective",
          amountCents: 100_000n,
          paymentTermsVersionId: "terms-1"
        }
      ],
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-1",
          stageType: "progress",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          triggerAnchor: "settlement_effective",
          dueDays: 0
        }
      ],
      settlementArchiveFiles: [
        {
          settlementId: "settlement-1",
          confirmedAt: new Date("2026-06-01T00:00:00.000Z")
        }
      ],
      paymentRequests: [
        {
          settlementId: null,
          sourceType: "contract_due",
          status: "paid",
          requestedAmountCents: 20_000n,
          approvedAmountCents: 20_000n,
          paidAmountCents: 20_000n
        },
        {
          settlementId: null,
          sourceType: "contract_due",
          status: "partially_paid",
          requestedAmountCents: 30_000n,
          approvedAmountCents: 30_000n,
          paidAmountCents: 10_000n
        }
      ]
    });

    expect(capacity).toEqual({
      duePayableCents: 80_000n,
      occupiedCents: 50_000n,
      remainingCents: 30_000n
    });
  });

  it("deducts confirmed historical takeover balances without releasing historical settled capacity", () => {
    const capacity = calculateContractCapacity({
      asOf,
      contractAmountCents: 1_000_000n,
      settlements: [
        {
          id: "settlement-after-takeover",
          status: "effective",
          amountCents: 100_000n,
          paymentTermsVersionId: "terms-1"
        }
      ],
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-1",
          stageType: "progress",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          triggerAnchor: "settlement_effective",
          dueDays: 0
        },
        {
          paymentTermsVersionId: "terms-1",
          stageType: "advance",
          basis: "contract_amount",
          ratioBps: 1000,
          fixedAmountCents: null,
          triggerAnchor: "contract_effective",
          dueDays: 0,
          advanceDeductionMode: "per_settlement_ratio",
          advanceDeductionRatioBps: 2000
        }
      ],
      settlementArchiveFiles: [
        {
          settlementId: "settlement-after-takeover",
          confirmedAt: new Date("2026-06-01T00:00:00.000Z")
        }
      ],
      paymentRequests: [
        {
          settlementId: null,
          sourceType: "contract_due",
          status: "approval_pending",
          requestedAmountCents: 10_000n,
          approvedAmountCents: null,
          paidAmountCents: 0n
        }
      ],
      historicalBalance: {
        paymentTermsVersionId: "terms-1",
        balanceConfirmedAt: new Date("2026-06-01T00:00:00.000Z"),
        settledCents: 200_000n,
        paidCents: 120_000n,
        approvalPendingPaymentCents: 20_000n,
        approvedPendingPaymentCents: 30_000n,
        proxyPaidCents: 10_000n,
        otherConfirmedOccupancyCents: 5_000n,
        advancePaidCents: 50_000n,
        advanceDeductedCents: 20_000n
      },
      advancePaymentRequests: []
    });

    expect(capacity).toEqual({
      duePayableCents: 80_000n,
      occupiedCents: 195_000n,
      remainingCents: -115_000n,
      advanceDeductionCents: 0n
    });
  });

  it("uses historical initial settlements as the payable source without deducting historical paid twice", () => {
    const capacity = calculateContractCapacity({
      asOf,
      settlements: [
        {
          id: "settlement-takeover-initial",
          status: "effective",
          amountCents: 100_000n,
          paidAmountCents: 40_000n,
          paymentTermsVersionId: "terms-1",
          sourceType: "historical_takeover",
          sourceTakeoverId: "takeover-1"
        }
      ],
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-1",
          stageType: "progress",
          basis: "current_settlement",
          ratioBps: 10000,
          fixedAmountCents: null,
          triggerAnchor: "settlement_effective",
          dueDays: 0
        }
      ],
      settlementArchiveFiles: [],
      paymentRequests: [],
      historicalBalance: {
        paymentTermsVersionId: "terms-1",
        balanceConfirmedAt: new Date("2026-06-01T00:00:00.000Z"),
        settledCents: 100_000n,
        paidCents: 40_000n,
        approvedPendingPaymentCents: 10_000n,
        otherConfirmedOccupancyCents: 5_000n,
        retentionWithheldCents: 12_000n,
        retentionReleasedCents: 5_000n
      }
    });

    expect(capacity).toEqual({
      duePayableCents: 100_000n,
      occupiedCents: 62_000n,
      remainingCents: 38_000n
    });
  });

  it("does not turn released historical retention into extra payment capacity", () => {
    const capacity = calculateContractCapacity({
      asOf,
      settlements: [
        {
          id: "settlement-takeover-initial",
          status: "effective",
          amountCents: 100_000n,
          paymentTermsVersionId: "terms-1",
          sourceType: "historical_takeover",
          sourceTakeoverId: "takeover-1"
        }
      ],
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-1",
          stageType: "progress",
          basis: "current_settlement",
          ratioBps: 10000,
          fixedAmountCents: null,
          triggerAnchor: "settlement_effective",
          dueDays: 0
        }
      ],
      settlementArchiveFiles: [],
      paymentRequests: [],
      historicalBalance: {
        paymentTermsVersionId: "terms-1",
        balanceConfirmedAt: new Date("2026-06-01T00:00:00.000Z"),
        settledCents: 100_000n,
        retentionWithheldCents: 5_000n,
        retentionReleasedCents: 12_000n
      }
    });

    expect(capacity).toEqual({
      duePayableCents: 100_000n,
      occupiedCents: 0n,
      remainingCents: 100_000n
    });
  });

  it("recognizes takeover initial settlements by takeover id when source type is not populated", () => {
    const capacity = calculateContractCapacity({
      asOf,
      settlements: [
        {
          id: "settlement-takeover-initial",
          status: "effective",
          amountCents: 100_000n,
          paidAmountCents: 40_000n,
          paymentTermsVersionId: "terms-1",
          sourceTakeoverId: "takeover-1"
        }
      ],
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-1",
          stageType: "progress",
          basis: "current_settlement",
          ratioBps: 10000,
          fixedAmountCents: null,
          triggerAnchor: "settlement_effective",
          dueDays: 0
        }
      ],
      settlementArchiveFiles: [],
      paymentRequests: [],
      historicalBalance: {
        paymentTermsVersionId: "terms-1",
        balanceConfirmedAt: new Date("2026-06-01T00:00:00.000Z"),
        settledCents: 100_000n,
        paidCents: 40_000n,
        approvedPendingPaymentCents: 10_000n,
        otherConfirmedOccupancyCents: 5_000n
      }
    });

    expect(capacity).toEqual({
      duePayableCents: 100_000n,
      occupiedCents: 55_000n,
      remainingCents: 45_000n
    });
  });

  it("uses takeover balance confirmation date for historical initial settlement due dates", () => {
    const input = {
      settlements: [
        {
          id: "settlement-takeover-initial",
          status: "effective",
          amountCents: 100_000n,
          paidAmountCents: 0n,
          paymentTermsVersionId: "terms-1",
          sourceType: "historical_takeover",
          sourceTakeoverId: "takeover-1"
        }
      ],
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-1",
          stageType: "progress",
          basis: "current_settlement",
          ratioBps: 10000,
          fixedAmountCents: null,
          triggerAnchor: "settlement_effective",
          dueDays: 30
        }
      ],
      settlementArchiveFiles: [],
      paymentRequests: [],
      historicalBalance: {
        paymentTermsVersionId: "terms-1",
        balanceConfirmedAt: new Date("2026-06-01T00:00:00.000Z"),
        settledCents: 100_000n
      }
    };

    expect(
      calculateContractCapacity({
        asOf: new Date("2026-06-20T00:00:00.000Z"),
        ...input
      })
    ).toMatchObject({
      duePayableCents: 0n,
      remainingCents: 0n
    });
    expect(
      calculateContractCapacity({
        asOf: new Date("2026-07-02T00:00:00.000Z"),
        ...input
      })
    ).toMatchObject({
      duePayableCents: 100_000n,
      remainingCents: 100_000n
    });

    const preview = buildApplicationPreview({
      asOf: new Date("2026-07-02T00:00:00.000Z"),
      ...input
    });
    expect(preview.sections[0].rows).toEqual([
      expect.objectContaining({
        id: "settlement-takeover-initial:progress:0",
        effectiveAt: new Date("2026-06-01T00:00:00.000Z"),
        expectedPayableAt: new Date("2026-07-01T00:00:00.000Z"),
        isDue: true,
        includableAmountCents: "100000"
      })
    ]);
  });

  it("counts partially paid and paid settlements as effective contract capacity rows", () => {
    const capacity = calculateContractCapacity({
      asOf,
      settlements: [
        {
          id: "settlement-partially-paid",
          status: "partially_paid",
          amountCents: 100_000n,
          paymentTermsVersionId: "terms-partially-paid"
        },
        {
          id: "settlement-paid",
          status: "paid",
          amountCents: 50_000n,
          paymentTermsVersionId: "terms-paid"
        }
      ],
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-partially-paid",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          dueDays: 0
        },
        {
          paymentTermsVersionId: "terms-paid",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          dueDays: 0
        }
      ],
      settlementArchiveFiles: [
        {
          settlementId: "settlement-partially-paid",
          confirmedAt: new Date("2026-06-01T00:00:00.000Z")
        },
        {
          settlementId: "settlement-paid",
          confirmedAt: new Date("2026-06-01T00:00:00.000Z")
        }
      ],
      paymentRequests: []
    });

    expect(capacity).toEqual({
      duePayableCents: 120_000n,
      occupiedCents: 0n,
      remainingCents: 120_000n
    });
  });

  it("uses the earliest archive confirmation time as the settlement due-date base", () => {
    const capacity = calculateContractCapacity({
      asOf,
      settlements: [
        {
          id: "settlement-with-reconfirmed-archive",
          status: "effective",
          amountCents: 100_000n,
          paymentTermsVersionId: "terms-reconfirmed"
        }
      ],
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-reconfirmed",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          dueDays: 30
        }
      ],
      settlementArchiveFiles: [
        {
          settlementId: "settlement-with-reconfirmed-archive",
          confirmedAt: new Date("2026-06-01T00:00:00.000Z")
        },
        {
          settlementId: "settlement-with-reconfirmed-archive",
          confirmedAt: new Date("2026-07-01T00:00:00.000Z")
        }
      ],
      paymentRequests: []
    });

    expect(capacity.remainingCents).toBe(80_000n);
  });

  it("does not release final-settlement anchored stages from non-final settlements", () => {
    const capacity = calculateContractCapacity({
      asOf,
      settlements: [
        {
          id: "settlement-progress",
          status: "effective",
          amountCents: 100_000n,
          paymentTermsVersionId: "terms-version-1",
          isFinal: false
        }
      ],
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-version-1",
          stageType: "progress",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          triggerAnchor: "settlement_effective",
          dueDays: 0
        },
        {
          paymentTermsVersionId: "terms-version-1",
          stageType: "retention",
          basis: "current_settlement",
          ratioBps: 2000,
          fixedAmountCents: null,
          triggerAnchor: "final_settlement_effective",
          dueDays: 0
        }
      ],
      settlementArchiveFiles: [
        {
          settlementId: "settlement-progress",
          confirmedAt: new Date("2026-06-01T00:00:00.000Z")
        }
      ],
      paymentRequests: []
    });

    expect(capacity.duePayableCents).toBe(80_000n);
  });

  it("releases final-settlement anchored stages only after final settlement is due", () => {
    const capacity = calculateContractCapacity({
      asOf,
      settlements: [
        {
          id: "settlement-final",
          status: "effective",
          amountCents: 100_000n,
          paymentTermsVersionId: "terms-version-1",
          isFinal: true
        }
      ],
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-version-1",
          stageType: "progress",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          triggerAnchor: "settlement_effective",
          dueDays: 0
        },
        {
          paymentTermsVersionId: "terms-version-1",
          stageType: "retention",
          basis: "current_settlement",
          ratioBps: 2000,
          fixedAmountCents: null,
          triggerAnchor: "final_settlement_effective",
          dueDays: 30
        }
      ],
      settlementArchiveFiles: [
        {
          settlementId: "settlement-final",
          confirmedAt: new Date("2026-06-01T00:00:00.000Z")
        }
      ],
      paymentRequests: []
    });

    expect(capacity.duePayableCents).toBe(100_000n);
  });

  it("does not count effective settlements without archive confirmation time", () => {
    const capacity = calculateContractCapacity({
      asOf,
      settlements: [
        {
          id: "settlement-confirmed",
          status: "effective",
          amountCents: 100_000n,
          paymentTermsVersionId: "terms-confirmed"
        },
        {
          id: "settlement-unconfirmed",
          status: "effective",
          amountCents: 100_000n,
          paymentTermsVersionId: "terms-unconfirmed"
        }
      ],
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-confirmed",
          basis: "current_settlement",
          ratioBps: null,
          fixedAmountCents: 10_000n,
          dueDays: 0
        },
        {
          paymentTermsVersionId: "terms-unconfirmed",
          basis: "current_settlement",
          ratioBps: null,
          fixedAmountCents: 20_000n,
          dueDays: 0
        }
      ],
      settlementArchiveFiles: [
        {
          settlementId: "settlement-confirmed",
          confirmedAt: new Date("2026-06-01T00:00:00.000Z")
        },
        {
          settlementId: "settlement-unconfirmed",
          confirmedAt: null
        }
      ],
      paymentRequests: []
    });

    expect(capacity).toEqual({
      duePayableCents: 10_000n,
      occupiedCents: 0n,
      remainingCents: 10_000n
    });
  });

  it("does not deduct unpaid contract advances from settlement payment capacity", () => {
    const capacity = calculateContractCapacity({
      asOf,
      contractAmountCents: 1_000_000n,
      settlements: [
        {
          id: "settlement-1",
          status: "effective",
          amountCents: 100_000n,
          paymentTermsVersionId: "terms-1"
        }
      ],
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-1",
          stageType: "progress",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          triggerAnchor: "settlement_effective",
          dueDays: 0
        },
        {
          paymentTermsVersionId: "terms-1",
          stageType: "advance",
          basis: "contract_amount",
          ratioBps: 1000,
          fixedAmountCents: null,
          triggerAnchor: "contract_effective",
          dueDays: 0,
          advanceDeductionMode: "per_settlement_ratio",
          advanceDeductionRatioBps: 2000
        }
      ],
      settlementArchiveFiles: [
        {
          settlementId: "settlement-1",
          confirmedAt: new Date("2026-06-01T00:00:00.000Z")
        }
      ],
      paymentRequests: [],
      advancePaymentRequests: [
        {
          paymentTermsVersionId: "terms-1",
          status: "approval_pending",
          requestedAmountCents: 100_000n,
          approvedAmountCents: null,
          paidAmountCents: 0n
        }
      ]
    });

    expect(capacity).toEqual({
      duePayableCents: 80_000n,
      occupiedCents: 0n,
      remainingCents: 80_000n,
      advanceDeductionCents: 0n
    });
  });

  it("deducts paid contract advances from settlement capacity and caps deduction to paid advance", () => {
    const capacity = calculateContractCapacity({
      asOf,
      contractAmountCents: 1_000_000n,
      settlements: [
        {
          id: "settlement-1",
          status: "effective",
          amountCents: 100_000n,
          paymentTermsVersionId: "terms-1"
        },
        {
          id: "settlement-2",
          status: "effective",
          amountCents: 100_000n,
          paymentTermsVersionId: "terms-1"
        }
      ],
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-1",
          stageType: "progress",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          triggerAnchor: "settlement_effective",
          dueDays: 0
        },
        {
          paymentTermsVersionId: "terms-1",
          stageType: "advance",
          basis: "contract_amount",
          ratioBps: 1000,
          fixedAmountCents: null,
          triggerAnchor: "contract_effective",
          dueDays: 0,
          advanceDeductionMode: "per_settlement_ratio",
          advanceDeductionRatioBps: 2000
        }
      ],
      settlementArchiveFiles: [
        {
          settlementId: "settlement-1",
          confirmedAt: new Date("2026-06-01T00:00:00.000Z")
        },
        {
          settlementId: "settlement-2",
          confirmedAt: new Date("2026-06-01T00:00:00.000Z")
        }
      ],
      paymentRequests: [],
      advancePaymentRequests: [
        {
          paymentTermsVersionId: "terms-1",
          status: "paid",
          requestedAmountCents: 30_000n,
          approvedAmountCents: 30_000n,
          paidAmountCents: 30_000n
        }
      ]
    });

    expect(capacity).toEqual({
      duePayableCents: 160_000n,
      occupiedCents: 0n,
      remainingCents: 130_000n,
      advanceDeductionCents: 30_000n
    });
  });

  it("starts conditional advance deduction only after cumulative settlements reach the configured ratio", () => {
    const capacity = calculateContractCapacity({
      asOf,
      contractAmountCents: 1_000_000n,
      settlements: [
        {
          id: "settlement-1",
          status: "effective",
          amountCents: 400_000n,
          paymentTermsVersionId: "terms-1"
        }
      ],
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-1",
          stageType: "progress",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          triggerAnchor: "settlement_effective",
          dueDays: 0
        },
        {
          paymentTermsVersionId: "terms-1",
          stageType: "advance",
          basis: "contract_amount",
          ratioBps: 1000,
          fixedAmountCents: null,
          triggerAnchor: "contract_effective",
          dueDays: 0,
          advanceDeductionMode: "after_cumulative_settlement_ratio",
          advanceDeductionRatioBps: 2000,
          advanceDeductionStartRatioBps: 5000
        }
      ],
      settlementArchiveFiles: [
        {
          settlementId: "settlement-1",
          confirmedAt: new Date("2026-06-01T00:00:00.000Z")
        }
      ],
      paymentRequests: [],
      advancePaymentRequests: [
        {
          paymentTermsVersionId: "terms-1",
          status: "paid",
          requestedAmountCents: 100_000n,
          approvedAmountCents: 100_000n,
          paidAmountCents: 100_000n
        }
      ]
    });

    expect(capacity).toEqual({
      duePayableCents: 320_000n,
      occupiedCents: 0n,
      remainingCents: 320_000n,
      advanceDeductionCents: 0n
    });
  });

  it("applies advance deductions only to settlements using the same payment terms version", () => {
    const capacity = calculateContractCapacity({
      asOf,
      contractAmountCents: 1_000_000n,
      contractAmountCentsByPaymentTermsVersionId: {
        "terms-old": 1_000_000n,
        "terms-new": 2_000_000n
      },
      settlements: [
        {
          id: "settlement-old",
          status: "effective",
          amountCents: 100_000n,
          paymentTermsVersionId: "terms-old"
        },
        {
          id: "settlement-new",
          status: "effective",
          amountCents: 100_000n,
          paymentTermsVersionId: "terms-new"
        }
      ],
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-old",
          stageType: "progress",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          triggerAnchor: "settlement_effective",
          dueDays: 0
        },
        {
          paymentTermsVersionId: "terms-old",
          stageType: "advance",
          basis: "contract_amount",
          ratioBps: 1000,
          fixedAmountCents: null,
          triggerAnchor: "contract_effective",
          dueDays: 0,
          advanceDeductionMode: "per_settlement_ratio",
          advanceDeductionRatioBps: 1000
        },
        {
          paymentTermsVersionId: "terms-new",
          stageType: "progress",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          triggerAnchor: "settlement_effective",
          dueDays: 0
        },
        {
          paymentTermsVersionId: "terms-new",
          stageType: "advance",
          basis: "contract_amount",
          ratioBps: 1000,
          fixedAmountCents: null,
          triggerAnchor: "contract_effective",
          dueDays: 0,
          advanceDeductionMode: "per_settlement_ratio",
          advanceDeductionRatioBps: 2000
        }
      ],
      settlementArchiveFiles: [
        {
          settlementId: "settlement-old",
          confirmedAt: new Date("2026-06-01T00:00:00.000Z")
        },
        {
          settlementId: "settlement-new",
          confirmedAt: new Date("2026-06-01T00:00:00.000Z")
        }
      ],
      paymentRequests: [],
      advancePaymentRequests: [
        {
          paymentTermsVersionId: "terms-old",
          status: "paid",
          requestedAmountCents: 100_000n,
          approvedAmountCents: 100_000n,
          paidAmountCents: 100_000n
        },
        {
          paymentTermsVersionId: "terms-new",
          status: "paid",
          requestedAmountCents: 100_000n,
          approvedAmountCents: 100_000n,
          paidAmountCents: 100_000n
        }
      ]
    });

    expect(capacity).toEqual({
      duePayableCents: 160_000n,
      occupiedCents: 0n,
      remainingCents: 130_000n,
      advanceDeductionCents: 30_000n
    });
  });

  it("caps multiple advance deduction stages under one terms version to paid advance total", () => {
    const capacity = calculateContractCapacity({
      asOf,
      contractAmountCents: 1_000_000n,
      settlements: [
        {
          id: "settlement-1",
          status: "effective",
          amountCents: 400_000n,
          paymentTermsVersionId: "terms-1"
        }
      ],
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-1",
          stageType: "progress",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          triggerAnchor: "settlement_effective",
          dueDays: 0
        },
        {
          paymentTermsVersionId: "terms-1",
          stageType: "advance",
          basis: "contract_amount",
          ratioBps: 500,
          fixedAmountCents: null,
          triggerAnchor: "contract_effective",
          dueDays: 0,
          advanceDeductionMode: "per_settlement_ratio",
          advanceDeductionRatioBps: 2000
        },
        {
          paymentTermsVersionId: "terms-1",
          stageType: "advance",
          basis: "contract_amount",
          ratioBps: 500,
          fixedAmountCents: null,
          triggerAnchor: "contract_effective",
          dueDays: 0,
          advanceDeductionMode: "per_settlement_ratio",
          advanceDeductionRatioBps: 2000
        }
      ],
      settlementArchiveFiles: [
        {
          settlementId: "settlement-1",
          confirmedAt: new Date("2026-06-01T00:00:00.000Z")
        }
      ],
      paymentRequests: [],
      advancePaymentRequests: [
        {
          paymentTermsVersionId: "terms-1",
          status: "paid",
          requestedAmountCents: 100_000n,
          approvedAmountCents: 100_000n,
          paidAmountCents: 100_000n
        }
      ]
    });

    expect(capacity).toEqual({
      duePayableCents: 320_000n,
      occupiedCents: 0n,
      remainingCents: 220_000n,
      advanceDeductionCents: 100_000n
    });
  });

  it("rejects active advance deduction modes without a positive deduction ratio", () => {
    expect(() =>
      calculateContractCapacity({
        asOf,
        contractAmountCents: 1_000_000n,
        settlements: [
          {
            id: "settlement-1",
            status: "effective",
            amountCents: 100_000n,
            paymentTermsVersionId: "terms-1"
          }
        ],
        paymentTermsStages: [
          {
            paymentTermsVersionId: "terms-1",
            stageType: "progress",
            basis: "current_settlement",
            ratioBps: 8000,
            fixedAmountCents: null,
            triggerAnchor: "settlement_effective",
            dueDays: 0
          },
          {
            paymentTermsVersionId: "terms-1",
            stageType: "advance",
            basis: "contract_amount",
            ratioBps: 1000,
            fixedAmountCents: null,
            triggerAnchor: "contract_effective",
            dueDays: 0,
            advanceDeductionMode: "per_settlement_ratio",
            advanceDeductionRatioBps: null
          }
        ],
        settlementArchiveFiles: [
          {
            settlementId: "settlement-1",
            confirmedAt: new Date("2026-06-01T00:00:00.000Z")
          }
        ],
        paymentRequests: [],
        advancePaymentRequests: [
          {
            paymentTermsVersionId: "terms-1",
            status: "paid",
            requestedAmountCents: 100_000n,
            approvedAmountCents: 100_000n,
            paidAmountCents: 100_000n
          }
        ]
      })
    ).toThrow("预付款扣回比例未填写，不能计算本次可付款金额。请先补齐合同付款条款。");
  });

  it("rejects active advance deduction with a zero deduction ratio", () => {
    expect(() =>
      calculateContractCapacity({
        asOf,
        contractAmountCents: 1_000_000n,
        settlements: [
          {
            id: "settlement-1",
            status: "effective",
            amountCents: 100_000n,
            paymentTermsVersionId: "terms-1"
          }
        ],
        paymentTermsStages: [
          {
            paymentTermsVersionId: "terms-1",
            stageType: "progress",
            basis: "current_settlement",
            ratioBps: 8000,
            fixedAmountCents: null,
            triggerAnchor: "settlement_effective",
            dueDays: 0
          },
          {
            paymentTermsVersionId: "terms-1",
            stageType: "advance",
            basis: "contract_amount",
            ratioBps: 1000,
            fixedAmountCents: null,
            triggerAnchor: "contract_effective",
            dueDays: 0,
            advanceDeductionMode: "per_settlement_ratio",
            advanceDeductionRatioBps: 0
          }
        ],
        settlementArchiveFiles: [
          {
            settlementId: "settlement-1",
            confirmedAt: new Date("2026-06-01T00:00:00.000Z")
          }
        ],
        paymentRequests: [],
        advancePaymentRequests: [
          {
            paymentTermsVersionId: "terms-1",
            status: "paid",
            requestedAmountCents: 100_000n,
            approvedAmountCents: 100_000n,
            paidAmountCents: 100_000n
          }
        ]
      })
    ).toThrow("预付款扣回比例必须大于 0，不能计算本次可付款金额。");
  });

  it("rejects conditional advance deduction without a start ratio", () => {
    expect(() =>
      calculateContractCapacity({
        asOf,
        contractAmountCents: 1_000_000n,
        settlements: [
          {
            id: "settlement-1",
            status: "effective",
            amountCents: 100_000n,
            paymentTermsVersionId: "terms-1"
          }
        ],
        paymentTermsStages: [
          {
            paymentTermsVersionId: "terms-1",
            stageType: "progress",
            basis: "current_settlement",
            ratioBps: 8000,
            fixedAmountCents: null,
            triggerAnchor: "settlement_effective",
            dueDays: 0
          },
          {
            paymentTermsVersionId: "terms-1",
            stageType: "advance",
            basis: "contract_amount",
            ratioBps: 1000,
            fixedAmountCents: null,
            triggerAnchor: "contract_effective",
            dueDays: 0,
            advanceDeductionMode: "after_cumulative_settlement_ratio",
            advanceDeductionRatioBps: 2000,
            advanceDeductionStartRatioBps: null
          }
        ],
        settlementArchiveFiles: [
          {
            settlementId: "settlement-1",
            confirmedAt: new Date("2026-06-01T00:00:00.000Z")
          }
        ],
        paymentRequests: [],
        advancePaymentRequests: [
          {
            paymentTermsVersionId: "terms-1",
            status: "paid",
            requestedAmountCents: 100_000n,
            approvedAmountCents: 100_000n,
            paidAmountCents: 100_000n
          }
        ]
      })
    ).toThrow("预付款条件扣回缺少起扣比例，不能计算本次可付款金额。请先补齐合同付款条款。");
  });

  it("rejects unsupported advance deduction modes instead of ignoring them", () => {
    expect(() =>
      calculateContractCapacity({
        asOf,
        contractAmountCents: 1_000_000n,
        settlements: [
          {
            id: "settlement-1",
            status: "effective",
            amountCents: 100_000n,
            paymentTermsVersionId: "terms-1"
          }
        ],
        paymentTermsStages: [
          {
            paymentTermsVersionId: "terms-1",
            stageType: "progress",
            basis: "current_settlement",
            ratioBps: 8000,
            fixedAmountCents: null,
            triggerAnchor: "settlement_effective",
            dueDays: 0
          },
          {
            paymentTermsVersionId: "terms-1",
            stageType: "advance",
            basis: "contract_amount",
            ratioBps: 1000,
            fixedAmountCents: null,
            triggerAnchor: "contract_effective",
            dueDays: 0,
            advanceDeductionMode: "unsupported_mode",
            advanceDeductionRatioBps: 2000
          }
        ],
        settlementArchiveFiles: [
          {
            settlementId: "settlement-1",
            confirmedAt: new Date("2026-06-01T00:00:00.000Z")
          }
        ],
        paymentRequests: [],
        advancePaymentRequests: [
          {
            paymentTermsVersionId: "terms-1",
            status: "paid",
            requestedAmountCents: 100_000n,
            approvedAmountCents: 100_000n,
            paidAmountCents: 100_000n
          }
        ]
      })
    ).toThrow("预付款扣回方式不受支持：unsupported_mode。请检查合同付款条款后再发起付款。");
  });
});

describe("buildContractPaymentApplicationPreview", () => {
  const asOf = new Date("2026-07-20T00:00:00.000Z");

  it("rejects number settlement amounts at the public preview boundary", () => {
    expect(() =>
      buildApplicationPreview({
        asOf,
        settlements: [
          {
            id: "settlement-number",
            status: "effective",
            amountCents: 1 as unknown as bigint,
            paymentTermsVersionId: "terms-1"
          }
        ],
        paymentTermsStages: [],
        settlementArchiveFiles: [],
        paymentRequests: []
      })
    ).toThrow("结算金额必须为 bigint 分值");
  });

  it("lists every effective settlement and marks rows before account period as not includable", () => {
    const preview = buildApplicationPreview({
      asOf,
      settlements: [
        {
          id: "settlement-due",
          status: "effective",
          amountCents: 100_000n,
          paymentTermsVersionId: "terms-1"
        },
        {
          id: "settlement-not-due",
          status: "effective",
          amountCents: 50_000n,
          paymentTermsVersionId: "terms-1"
        }
      ],
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-1",
          stageType: "progress",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          triggerAnchor: "settlement_effective",
          dueDays: 30
        }
      ],
      settlementArchiveFiles: [
        {
          settlementId: "settlement-due",
          confirmedAt: new Date("2026-06-01T00:00:00.000Z")
        },
        {
          settlementId: "settlement-not-due",
          confirmedAt: new Date("2026-07-10T00:00:00.000Z")
        }
      ],
      paymentRequests: []
    });

    expect(preview.capacity).toMatchObject({
      cumulativeEffectiveSettlementCents: "150000",
      duePayableCents: "80000",
      occupiedCents: "0",
      advanceDeductionCents: "0",
      maxRequestableCents: "80000"
    });
    expect(preview.sections).toHaveLength(1);
    expect(preview.sections[0]).toMatchObject({
      type: "progress",
      title: "进度款"
    });
    expect(preview.sections[0].rows).toEqual([
      expect.objectContaining({
        id: "settlement-due:progress:0",
        source: "settlement-due",
        currentSettlementAmountCents: "100000",
        cumulativeBeforeAmountCents: "0",
        cumulativeAfterAmountCents: "100000",
        effectiveAt: new Date("2026-06-01T00:00:00.000Z"),
        expectedPayableAt: new Date("2026-07-01T00:00:00.000Z"),
        paymentRule: "80% · 30天",
        isDue: true,
        includableAmountCents: "80000"
      }),
      expect.objectContaining({
        id: "settlement-not-due:progress:0",
        source: "settlement-not-due",
        currentSettlementAmountCents: "50000",
        cumulativeBeforeAmountCents: "100000",
        cumulativeAfterAmountCents: "150000",
        effectiveAt: new Date("2026-07-10T00:00:00.000Z"),
        expectedPayableAt: new Date("2026-08-09T00:00:00.000Z"),
        paymentRule: "80% · 30天",
        isDue: false,
        includableAmountCents: "0"
      })
    ]);
  });

  it("hides final and retention sections until a final settlement is effective", () => {
    const preview = buildApplicationPreview({
      asOf,
      settlements: [
        {
          id: "settlement-progress",
          status: "effective",
          amountCents: 100_000n,
          paymentTermsVersionId: "terms-1",
          isFinal: false
        }
      ],
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-1",
          stageType: "progress",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          triggerAnchor: "settlement_effective",
          dueDays: 0
        },
        {
          paymentTermsVersionId: "terms-1",
          stageType: "final",
          basis: "current_settlement",
          ratioBps: 1000,
          fixedAmountCents: null,
          triggerAnchor: "final_settlement_effective",
          dueDays: 0
        },
        {
          paymentTermsVersionId: "terms-1",
          stageType: "retention",
          basis: "current_settlement",
          ratioBps: 1000,
          fixedAmountCents: null,
          triggerAnchor: "final_settlement_effective",
          dueDays: 0
        }
      ],
      settlementArchiveFiles: [
        {
          settlementId: "settlement-progress",
          confirmedAt: new Date("2026-06-01T00:00:00.000Z")
        }
      ],
      paymentRequests: []
    });

    expect(preview.sections.map((section) => section.type)).toEqual(["progress"]);
  });

  it("shows retention after a final settlement is effective and omits the section when no retention term exists", () => {
    const preview = buildApplicationPreview({
      asOf,
      settlements: [
        {
          id: "settlement-final",
          status: "effective",
          amountCents: 100_000n,
          paymentTermsVersionId: "terms-1",
          isFinal: true
        }
      ],
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-1",
          stageType: "progress",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          triggerAnchor: "settlement_effective",
          dueDays: 0
        },
        {
          paymentTermsVersionId: "terms-1",
          stageType: "retention",
          basis: "current_settlement",
          ratioBps: 2000,
          fixedAmountCents: null,
          triggerAnchor: "final_settlement_effective",
          dueDays: 30
        }
      ],
      settlementArchiveFiles: [
        {
          settlementId: "settlement-final",
          confirmedAt: new Date("2026-06-01T00:00:00.000Z")
        }
      ],
      paymentRequests: []
    });

    expect(preview.sections.map((section) => section.type)).toEqual(["progress", "retention"]);
    expect(preview.sections.find((section) => section.type === "retention")?.rows[0]).toMatchObject({
      source: "settlement-final",
      isDue: true,
      includableAmountCents: "20000"
    });
    expect(preview.sections.some((section) => section.type === "final")).toBe(false);
  });

  it("surfaces advance deduction details separately from occupied payment amounts", () => {
    const preview = buildApplicationPreview({
      asOf,
      contractAmountCents: 1_000_000n,
      settlements: [
        {
          id: "settlement-1",
          status: "effective",
          amountCents: 100_000n,
          paidAmountCents: 10_000n,
          paymentTermsVersionId: "terms-1"
        }
      ],
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-1",
          stageType: "progress",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          triggerAnchor: "settlement_effective",
          dueDays: 0
        },
        {
          paymentTermsVersionId: "terms-1",
          stageType: "advance",
          basis: "contract_amount",
          ratioBps: 1000,
          fixedAmountCents: null,
          triggerAnchor: "contract_effective",
          dueDays: 0,
          advanceDeductionMode: "per_settlement_ratio",
          advanceDeductionRatioBps: 2000
        }
      ],
      settlementArchiveFiles: [
        {
          settlementId: "settlement-1",
          confirmedAt: new Date("2026-06-01T00:00:00.000Z")
        }
      ],
      paymentRequests: [
        {
          settlementId: "settlement-1",
          status: "approved_pending_payment",
          requestedAmountCents: 30_000n,
          approvedAmountCents: 30_000n,
          paidAmountCents: 0n
        }
      ],
      advancePaymentRequests: [
        {
          paymentTermsVersionId: "terms-1",
          status: "paid",
          requestedAmountCents: 50_000n,
          approvedAmountCents: 50_000n,
          paidAmountCents: 50_000n
        }
      ]
    });

    expect(preview.capacity).toMatchObject({
      duePayableCents: "80000",
      occupiedCents: "40000",
      advanceDeductionCents: "20000",
      maxRequestableCents: "20000"
    });
    expect(preview.advanceDeduction).toEqual({
      paidAdvanceCents: "50000",
      currentDeductionCents: "20000",
      remainingAdvanceToDeductCents: "30000"
    });
  });

  it("separates historical takeover balances from in-system preview amounts", () => {
    const preview = buildApplicationPreview({
      asOf,
      contractAmountCents: 1_000_000n,
      settlements: [
        {
          id: "settlement-1",
          status: "effective",
          amountCents: 100_000n,
          paidAmountCents: 10_000n,
          paymentTermsVersionId: "terms-1"
        }
      ],
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-1",
          stageType: "progress",
          basis: "current_settlement",
          ratioBps: 8000,
          fixedAmountCents: null,
          triggerAnchor: "settlement_effective",
          dueDays: 0
        },
        {
          paymentTermsVersionId: "terms-1",
          stageType: "advance",
          basis: "contract_amount",
          ratioBps: 1000,
          fixedAmountCents: null,
          triggerAnchor: "contract_effective",
          dueDays: 0,
          advanceDeductionMode: "per_settlement_ratio",
          advanceDeductionRatioBps: 2000
        }
      ],
      settlementArchiveFiles: [
        {
          settlementId: "settlement-1",
          confirmedAt: new Date("2026-06-01T00:00:00.000Z")
        }
      ],
      paymentRequests: [
        {
          settlementId: "settlement-1",
          status: "approved_pending_payment",
          requestedAmountCents: 10_000n,
          approvedAmountCents: 10_000n,
          paidAmountCents: 0n
        }
      ],
      advancePaymentRequests: [],
      historicalBalance: {
        paymentTermsVersionId: "terms-1",
        balanceConfirmedAt: new Date("2026-06-01T00:00:00.000Z"),
        settledCents: 200_000n,
        paidCents: 50_000n,
        approvedPendingPaymentCents: 20_000n,
        proxyPaidCents: 10_000n,
        advancePaidCents: 40_000n,
        advanceDeductedCents: 10_000n,
        retentionWithheldCents: 0n,
        retentionReleasedCents: 0n
      }
    });

    expect(preview.capacity).toMatchObject({
      systemCumulativeEffectiveSettlementCents: "100000",
      historicalSettledCents: "200000",
      cumulativeEffectiveSettlementCents: "300000",
      duePayableCents: "80000",
      occupiedCents: "100000",
      historicalOccupiedCents: "80000",
      advanceDeductionCents: "10000",
      maxRequestableCents: "0"
    });
    expect(preview.historicalBalance).toEqual({
      settledCents: "200000",
      approvalPendingPaymentCents: "0",
      approvedPendingPaymentCents: "20000",
      paidCents: "50000",
      proxyPaidCents: "10000",
      advancePaidCents: "40000",
      advanceDeductedCents: "10000",
      retentionWithheldCents: "0",
      retentionReleasedCents: "0",
      otherConfirmedOccupancyCents: "0"
    });
    expect(preview.advanceDeduction).toEqual({
      paidAdvanceCents: "40000",
      systemPaidAdvanceCents: "0",
      historicalAdvancePaidCents: "40000",
      historicalAdvanceDeductedCents: "10000",
      currentDeductionCents: "10000",
      remainingAdvanceToDeductCents: "20000"
    });
  });
});

describe("allocateContractDuePaymentExecution", () => {
  it("拒绝将不安全整数的实付金额进入分摊", () => {
    expect(() =>
      allocateContractDuePaymentExecution?.({
        amountCents: (Number.MAX_SAFE_INTEGER + 1) as unknown as bigint,
        sections: []
      })
    ).toThrow("登记实付金额必须为 bigint 分值");
  });

  it("rejects zero amount contract-level execution with a Chinese business reason", () => {
    expect(() =>
      allocateContractDuePaymentExecution?.({
        amountCents: 0n,
        sections: []
      })
    ).toThrow("登记实付金额必须大于 0，不能分摊零金额或负数付款。");
  });

  it("rejects a negative contract-level execution with the existing Chinese reason", () => {
    expect(() =>
      allocateContractDuePaymentExecution?.({
        amountCents: -1n,
        sections: []
      })
    ).toThrow("登记实付金额必须大于 0，不能分摊零金额或负数付款。");
  });

  it("allocates actual contract-level payments to due settlement rows in order", () => {
    expect(allocateContractDuePaymentExecution?.({
      amountCents: 70_000n,
      sections: [
        {
          type: "advance",
          title: "预付款",
          rows: [
            {
              id: "advance-row",
              source: "合同生效",
              settlementId: null,
              paymentTermsVersionId: "terms-v1",
              currentSettlementAmountCents: "0",
              cumulativeBeforeAmountCents: "0",
              cumulativeAfterAmountCents: "0",
              effectiveAt: new Date("2026-07-01T00:00:00.000Z"),
              expectedPayableAt: new Date("2026-07-01T00:00:00.000Z"),
              paymentRule: "10%",
              isDue: true,
              includableAmountCents: "30000"
            }
          ]
        },
        {
          type: "progress",
          title: "进度款",
          rows: [
            {
              id: "settlement-1:progress:0",
              source: "JS-001",
              settlementId: "settlement-1",
              contractVersionId: "contract-version-1",
              paymentTermsVersionId: "terms-v1",
              stageId: "stage-progress",
              stageName: "进度款",
              triggerAnchor: "settlement_effective",
              dueDays: 0,
              ratioBps: 5000,
              fixedAmountCents: null,
              currentSettlementAmountCents: "100000",
              cumulativeBeforeAmountCents: "0",
              cumulativeAfterAmountCents: "100000",
              effectiveAt: new Date("2026-07-01T00:00:00.000Z"),
              expectedPayableAt: new Date("2026-07-01T00:00:00.000Z"),
              paymentRule: "80%",
              isDue: true,
              includableAmountCents: "50000"
            },
            {
              id: "settlement-2:progress:0",
              source: "JS-002",
              settlementId: "settlement-2",
              contractVersionId: "contract-version-1",
              paymentTermsVersionId: "terms-v1",
              stageId: "stage-progress",
              stageName: "进度款",
              triggerAnchor: "settlement_effective",
              dueDays: 0,
              ratioBps: 8000,
              fixedAmountCents: null,
              currentSettlementAmountCents: "80000",
              cumulativeBeforeAmountCents: "100000",
              cumulativeAfterAmountCents: "180000",
              effectiveAt: new Date("2026-07-02T00:00:00.000Z"),
              expectedPayableAt: new Date("2026-07-02T00:00:00.000Z"),
              paymentRule: "80%",
              isDue: true,
              includableAmountCents: "64000"
            },
            {
              id: "settlement-3:progress:0",
              source: "JS-003",
              settlementId: "settlement-3",
              paymentTermsVersionId: "terms-v1",
              currentSettlementAmountCents: "90000",
              cumulativeBeforeAmountCents: "180000",
              cumulativeAfterAmountCents: "270000",
              effectiveAt: new Date("2026-07-03T00:00:00.000Z"),
              expectedPayableAt: new Date("2026-09-03T00:00:00.000Z"),
              paymentRule: "80%",
              isDue: false,
              includableAmountCents: "72000"
            }
          ]
        }
      ]
    })).toEqual([
      {
        sourceRowId: "settlement-1:progress:0",
        settlementId: "settlement-1",
        contractVersionId: "contract-version-1",
        paymentTermsVersionId: "terms-v1",
        stageType: "progress",
        stageId: "stage-progress",
        stageName: "进度款",
        triggerAnchor: "settlement_effective",
        dueDays: 0,
        ratioBps: 5000,
        fixedAmountCents: null,
        sourceEffectiveAt: new Date("2026-07-01T00:00:00.000Z"),
        expectedPayableAt: new Date("2026-07-01T00:00:00.000Z"),
        sourcePayableAmountCents: 50_000n,
        amountCents: 50_000n
      },
      {
        sourceRowId: "settlement-2:progress:0",
        settlementId: "settlement-2",
        contractVersionId: "contract-version-1",
        paymentTermsVersionId: "terms-v1",
        stageType: "progress",
        stageId: "stage-progress",
        stageName: "进度款",
        triggerAnchor: "settlement_effective",
        dueDays: 0,
        ratioBps: 8000,
        fixedAmountCents: null,
        sourceEffectiveAt: new Date("2026-07-02T00:00:00.000Z"),
        expectedPayableAt: new Date("2026-07-02T00:00:00.000Z"),
        sourcePayableAmountCents: 64_000n,
        amountCents: 20_000n
      }
    ]);
  });

  it("deducts existing allocation rows before allocating a new execution", () => {
    expect(allocateContractDuePaymentExecution?.({
      amountCents: 20_000n,
      existingAllocations: [{ sourceRowId: "settlement-1:progress:0", amountCents: 40_000n }],
      sections: [
        {
          type: "progress",
          title: "进度款",
          rows: [
            {
              id: "settlement-1:progress:0",
              source: "JS-001",
              settlementId: "settlement-1",
              paymentTermsVersionId: "terms-v1",
              currentSettlementAmountCents: "100000",
              cumulativeBeforeAmountCents: "0",
              cumulativeAfterAmountCents: "100000",
              effectiveAt: new Date("2026-07-01T00:00:00.000Z"),
              expectedPayableAt: new Date("2026-07-01T00:00:00.000Z"),
              paymentRule: "80%",
              isDue: true,
              includableAmountCents: "50000"
            },
            {
              id: "settlement-2:progress:0",
              source: "JS-002",
              settlementId: "settlement-2",
              paymentTermsVersionId: "terms-v1",
              currentSettlementAmountCents: "50000",
              cumulativeBeforeAmountCents: "100000",
              cumulativeAfterAmountCents: "150000",
              effectiveAt: new Date("2026-07-02T00:00:00.000Z"),
              expectedPayableAt: new Date("2026-07-02T00:00:00.000Z"),
              paymentRule: "80%",
              isDue: true,
              includableAmountCents: "40000"
            }
          ]
        }
      ]
    })).toEqual([
      expect.objectContaining({
        sourceRowId: "settlement-1:progress:0",
        amountCents: 10_000n
      }),
      expect.objectContaining({
        sourceRowId: "settlement-2:progress:0",
        amountCents: 10_000n
      })
    ]);
  });

  it("rejects allocations above remaining due settlement rows", () => {
    expect(() =>
      allocateContractDuePaymentExecution?.({
        amountCents: 60_001n,
        sections: [
          {
            type: "progress",
            title: "进度款",
            rows: [
              {
                id: "settlement-1:progress:0",
                source: "JS-001",
                settlementId: "settlement-1",
                paymentTermsVersionId: "terms-v1",
                currentSettlementAmountCents: "100000",
                cumulativeBeforeAmountCents: "0",
                cumulativeAfterAmountCents: "100000",
                effectiveAt: new Date("2026-07-01T00:00:00.000Z"),
                expectedPayableAt: new Date("2026-07-01T00:00:00.000Z"),
                paymentRule: "60%",
                isDue: true,
                includableAmountCents: "60000"
              }
            ]
          }
        ]
      })
    ).toThrow("登记实付金额超过当前可分摊的到期应付款，当前最多可分摊 600.00 元。");
  });
});

describe("calculateContractAdvancePaymentCapacity", () => {
  it("counts contract-effective advance stages after their due date", () => {
    const capacity = calculateAdvanceCapacity({
      asOf: new Date("2026-07-20T00:00:00.000Z"),
      contractAmountCents: 1_000_000n,
      contractEffectiveAt: new Date("2026-06-01T00:00:00.000Z"),
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-1",
          stageType: "advance",
          basis: "contract_amount",
          ratioBps: 1000,
          fixedAmountCents: null,
          triggerAnchor: "contract_effective",
          dueDays: 30
        }
      ],
      paymentRequests: []
    });

    expect(capacity).toEqual({
      duePayableCents: 100_000n,
      occupiedCents: 0n,
      remainingCents: 100_000n
    });
  });

  it("keeps contract-effective advance stages unavailable before due date", () => {
    const capacity = calculateAdvanceCapacity({
      asOf: new Date("2026-06-20T00:00:00.000Z"),
      contractAmountCents: 1_000_000n,
      contractEffectiveAt: new Date("2026-06-01T00:00:00.000Z"),
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-1",
          stageType: "advance",
          basis: "contract_amount",
          ratioBps: 1000,
          fixedAmountCents: null,
          triggerAnchor: "contract_effective",
          dueDays: 30
        }
      ],
      paymentRequests: []
    });

    expect(capacity).toEqual({
      duePayableCents: 0n,
      occupiedCents: 0n,
      remainingCents: 0n
    });
  });

  it("subtracts paid and in-flight contract advance requests from advance capacity", () => {
    const capacity = calculateAdvanceCapacity({
      asOf: new Date("2026-07-20T00:00:00.000Z"),
      contractAmountCents: 1_000_000n,
      contractEffectiveAt: new Date("2026-06-01T00:00:00.000Z"),
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-1",
          stageType: "advance",
          basis: "contract_amount",
          ratioBps: 1000,
          fixedAmountCents: null,
          triggerAnchor: "contract_effective",
          dueDays: 30
        }
      ],
      paymentRequests: [
        {
          status: "paid",
          requestedAmountCents: 60_000n,
          approvedAmountCents: 60_000n,
          paidAmountCents: 60_000n
        },
        {
          status: "approval_pending",
          requestedAmountCents: 30_000n,
          approvedAmountCents: null,
          paidAmountCents: 0n
        }
      ]
    });

    expect(capacity).toEqual({
      duePayableCents: 100_000n,
      occupiedCents: 90_000n,
      remainingCents: 10_000n
    });
  });

  it("subtracts confirmed historical advance paid from advance capacity", () => {
    const capacity = calculateAdvanceCapacity({
      asOf: new Date("2026-07-20T00:00:00.000Z"),
      contractAmountCents: 1_000_000n,
      contractEffectiveAt: new Date("2026-06-01T00:00:00.000Z"),
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-1",
          stageType: "advance",
          basis: "contract_amount",
          ratioBps: 1000,
          fixedAmountCents: null,
          triggerAnchor: "contract_effective",
          dueDays: 30
        }
      ],
      paymentRequests: [
        {
          status: "approval_pending",
          requestedAmountCents: 20_000n,
          approvedAmountCents: null,
          paidAmountCents: 0n
        }
      ],
      historicalBalance: {
        balanceConfirmedAt: new Date("2026-06-01T00:00:00.000Z"),
        advancePaidCents: 70_000n
      }
    });

    expect(capacity).toEqual({
      duePayableCents: 100_000n,
      occupiedCents: 90_000n,
      remainingCents: 10_000n
    });
  });
});
