import * as settlementPaymentCapacity from "./settlement-payment-capacity";

interface ContractDueSettlement {
  id: string;
  status: string;
  amountCents: number;
  paymentTermsVersionId: string;
}

interface ContractDuePaymentTermsStage {
  paymentTermsVersionId: string;
  basis: string;
  ratioBps: number | null;
  fixedAmountCents: number | null;
  dueDays: number;
}

interface ContractDueSettlementArchiveFile {
  settlementId: string;
  confirmedAt: Date | null;
}

interface ContractDuePaymentRequest {
  settlementId: string;
  status: string;
  requestedAmountCents: number;
  approvedAmountCents?: number | null;
  paidAmountCents: number;
}

interface ContractDuePaymentCapacity {
  duePayableCents: number;
  occupiedCents: number;
  remainingCents: number;
}

type ContractDuePaymentCapacityCalculator = (input: {
  asOf: Date;
  settlements: readonly ContractDueSettlement[];
  paymentTermsStages: readonly ContractDuePaymentTermsStage[];
  settlementArchiveFiles: readonly ContractDueSettlementArchiveFile[];
  paymentRequests: readonly ContractDuePaymentRequest[];
  proxyPaidAmountCents?: number;
}) => ContractDuePaymentCapacity;

const calculateContractDuePaymentCapacity = (
  settlementPaymentCapacity as unknown as {
    calculateContractDuePaymentCapacity?: ContractDuePaymentCapacityCalculator;
  }
).calculateContractDuePaymentCapacity;

function calculateContractCapacity(
  input: Parameters<ContractDuePaymentCapacityCalculator>[0]
): ContractDuePaymentCapacity {
  if (!calculateContractDuePaymentCapacity) {
    throw new Error("calculateContractDuePaymentCapacity is not exported");
  }

  return calculateContractDuePaymentCapacity(input);
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
          amountCents: 100_000,
          paymentTermsVersionId: "terms-due"
        },
        {
          id: "settlement-not-due",
          status: "effective",
          amountCents: 80_000,
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
      duePayableCents: 80_000,
      occupiedCents: 0,
      remainingCents: 80_000
    });
  });

  it("deducts in-flight payments from another settlement under the same contract", () => {
    const capacity = calculateContractCapacity({
      asOf,
      settlements: [
        {
          id: "settlement-current",
          status: "effective",
          amountCents: 100_000,
          paymentTermsVersionId: "terms-current"
        },
        {
          id: "settlement-other",
          status: "effective",
          amountCents: 50_000,
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
          requestedAmountCents: 30_000,
          approvedAmountCents: null,
          paidAmountCents: 0
        }
      ]
    });

    expect(capacity).toEqual({
      duePayableCents: 120_000,
      occupiedCents: 30_000,
      remainingCents: 90_000
    });
  });

  it("counts partially paid and paid settlements as effective contract capacity rows", () => {
    const capacity = calculateContractCapacity({
      asOf,
      settlements: [
        {
          id: "settlement-partially-paid",
          status: "partially_paid",
          amountCents: 100_000,
          paymentTermsVersionId: "terms-partially-paid"
        },
        {
          id: "settlement-paid",
          status: "paid",
          amountCents: 50_000,
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
      duePayableCents: 120_000,
      occupiedCents: 0,
      remainingCents: 120_000
    });
  });

  it("uses the earliest archive confirmation time as the settlement due-date base", () => {
    const capacity = calculateContractCapacity({
      asOf,
      settlements: [
        {
          id: "settlement-with-reconfirmed-archive",
          status: "effective",
          amountCents: 100_000,
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

    expect(capacity.remainingCents).toBe(80_000);
  });

  it("does not count effective settlements without archive confirmation time", () => {
    const capacity = calculateContractCapacity({
      asOf,
      settlements: [
        {
          id: "settlement-confirmed",
          status: "effective",
          amountCents: 100_000,
          paymentTermsVersionId: "terms-confirmed"
        },
        {
          id: "settlement-unconfirmed",
          status: "effective",
          amountCents: 100_000,
          paymentTermsVersionId: "terms-unconfirmed"
        }
      ],
      paymentTermsStages: [
        {
          paymentTermsVersionId: "terms-confirmed",
          basis: "current_settlement",
          ratioBps: null,
          fixedAmountCents: 10_000,
          dueDays: 0
        },
        {
          paymentTermsVersionId: "terms-unconfirmed",
          basis: "current_settlement",
          ratioBps: null,
          fixedAmountCents: 20_000,
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
      duePayableCents: 10_000,
      occupiedCents: 0,
      remainingCents: 10_000
    });
  });
});
