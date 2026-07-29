import {
  BadRequestException,
  ConflictException,
  ForbiddenException
} from "@nestjs/common";
import { ContractTakeoverCorrectionService } from "./contract-takeover-correction.service";

const audit = { record: jest.fn().mockResolvedValue({ id: "audit-1" }) };
const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
const files = {
  assertCanAttachUnlinkedFile: jest.fn().mockResolvedValue({ id: "file-1" })
};
const balances = {
  reverseEntryInTransaction: jest.fn()
};

function correction(overrides: Record<string, unknown> = {}) {
  return {
    id: "correction-1",
    projectId: "project-1",
    takeoverId: "takeover-1",
    schemaVersion: 2,
    correctionType: "amount",
    correctionScope: "abnormal_overpay",
    correctionOperation: "correction",
    status: "submitted",
    targetRevision: 4,
    targetBalanceRevision: 2,
    targetHistoricalPaymentId: null,
    targetAllocationId: null,
    targetBalanceEntryId: null,
    beforeSnapshot: { balanceCents: "101" },
    deltaSnapshot: { amountCents: "-101" },
    afterSnapshot: { balanceCents: "0" },
    reason: "异常超付款项已退回",
    responsibleUserId: "finance-1",
    attachmentFileId: "file-1",
    createdByUserId: "finance-1",
    submittedByUserId: "finance-1",
    submittedAt: new Date("2026-07-28T10:00:00.000Z"),
    reviewedByUserId: null,
    reviewedAt: null,
    reviewComment: null,
    applicationIdempotencyKey:
      "11111111-1111-4111-8111-111111111111",
    appliedByUserId: null,
    appliedAt: null,
    ...overrides
  };
}

function createContext(options: {
  correction?: ReturnType<typeof correction> | null;
  positionKey?: string;
  balanceCents?: bigint;
  balanceRevision?: number;
  takeoverActivated?: boolean;
  rawRows?: unknown[][];
} = {}) {
  const currentCorrection =
    options.correction === undefined ? correction() : options.correction;
  const positionKey = options.positionKey ?? "finance_director";
  const takeover = {
    id: "takeover-1",
    projectId: "project-1",
    activatedAt:
      options.takeoverActivated === false
        ? null
        : new Date("2026-07-28T09:00:00.000Z"),
    historicalInitialSettlementId: "settlement-opening-1",
    historicalPaidCents: 1_000n,
    historicalAdvancePaidCents: 0n,
    historicalAdvanceDeductedCents: 0n
  };
  const account = {
    id: "balance-1",
    takeoverId: "takeover-1",
    balanceType: "abnormal_overpay",
    openingCents: 101n,
    balanceCents: options.balanceCents ?? 101n,
    revision: options.balanceRevision ?? 2
  };
  const lockedRows: unknown[][] =
    options.rawRows ?? [
      ...(currentCorrection ? [[currentCorrection]] : []),
      [takeover],
      [account]
    ];
  const tx = {
    $queryRaw: jest.fn().mockImplementation(() =>
      Promise.resolve(lockedRows.shift() ?? [])
    ),
    contractTakeoverCorrection: {
      findUnique: jest.fn().mockResolvedValue(currentCorrection),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve(correction({ ...data }))
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    contractTakeoverFinanceFacts: {
      findUnique: jest.fn().mockResolvedValue({ revision: 4 })
    },
    contractTakeoverContractFacts: {
      findUnique: jest.fn().mockResolvedValue({
        revision: 3,
        financeBasisRevision: 4,
        historicalSettledCents: 1_000n
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    contractTakeoverBalanceAccount: {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      upsert: jest.fn().mockResolvedValue({
        id: "balance-target-1",
        balanceCents: 0n,
        revision: 1
      })
    },
    contractTakeoverBalanceEntry: {
      create: jest.fn().mockResolvedValue({ id: "entry-correction-1" }),
      findUnique: jest.fn()
    },
    contractTakeoverHistoricalPaymentAllocation: {
      findUnique: jest.fn()
    },
    settlement: {
      findUnique: jest.fn().mockResolvedValue({
        amountCents: 1_000n,
        payableAmountCents: 1_000n,
        paidAmountCents: 500n
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    contractTakeover: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 })
    },
    userPosition: {
      findMany: jest.fn().mockResolvedValue([
        { positionId: `position-${positionKey}` }
      ])
    },
    position: {
      findMany: jest.fn().mockResolvedValue([{ key: positionKey }])
    },
    projectMember: {
      findMany: jest.fn().mockResolvedValue([])
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: "finance-1",
        isActive: true
      })
    }
  };
  const prisma = {
    $transaction: jest.fn(
      (callback: (client: typeof tx) => unknown) => callback(tx)
    )
  };
  const service = new ContractTakeoverCorrectionService(
    prisma as never,
    audit as never,
    auth as never,
    files as never,
    balances as never
  );
  return { prisma, service, tx };
}

describe("ContractTakeoverCorrectionService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("submits a one-cent abnormal-overpay delta with frozen before/delta/after and an exclusive file", async () => {
    const { service, tx } = createContext({
      correction: null,
      positionKey: "finance_staff"
    });

    await expect(
      service.submit("project-1", "takeover-1", "finance-1", {
        correctionScope: "abnormal_overpay",
        correctionOperation: "correction",
        targetRevision: 4,
        targetBalanceRevision: 2,
        deltaCents: "-1",
        reason: "银行回单确认退回一分钱",
        responsibleUserId: "finance-1",
        attachmentFileId: "file-1",
        applicationIdempotencyKey:
          "11111111-1111-4111-8111-111111111111",
        currentPassword: "not-a-real-password"
      })
    ).resolves.toMatchObject({
      status: "submitted",
      schemaVersion: 2
    });

    expect(files.assertCanAttachUnlinkedFile).toHaveBeenCalledWith(
      tx,
      "file-1",
      "finance-1"
    );
    expect(tx.contractTakeoverCorrection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        schemaVersion: 2,
        correctionScope: "abnormal_overpay",
        correctionOperation: "correction",
        status: "submitted",
        targetRevision: 4,
        targetBalanceRevision: 2,
        beforeSnapshot: expect.objectContaining({
          balanceCents: "101"
        }),
        deltaSnapshot: { amountCents: "-1" },
        afterSnapshot: expect.objectContaining({
          balanceCents: "100"
        })
      })
    });
  });

  it("rejects a stale balance revision before accepting the correction", async () => {
    const { service, tx } = createContext({
      correction: null,
      positionKey: "finance_staff",
      balanceRevision: 3
    });

    await expect(
      service.submit("project-1", "takeover-1", "finance-1", {
        correctionScope: "abnormal_overpay",
        correctionOperation: "correction",
        targetRevision: 4,
        targetBalanceRevision: 2,
        deltaCents: "-1",
        reason: "银行回单确认退回一分钱",
        responsibleUserId: "finance-1",
        attachmentFileId: "file-1",
        applicationIdempotencyKey:
          "11111111-1111-4111-8111-111111111111",
        currentPassword: "not-a-real-password"
      })
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.contractTakeoverCorrection.create).not.toHaveBeenCalled();
  });

  it("requires the finance director to review a finance-side correction", async () => {
    const { service } = createContext({ positionKey: "contract_director" });

    await expect(
      service.review(
        "project-1",
        "takeover-1",
        "correction-1",
        "contract-director-1",
        {
          decision: "apply",
          reviewComment: "同意解除风险",
          currentPassword: "not-a-real-password"
        }
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("applies the reviewed delta atomically, appends a ledger entry and releases the payment gate", async () => {
    const { service, tx } = createContext();

    await expect(
      service.review(
        "project-1",
        "takeover-1",
        "correction-1",
        "finance-director-1",
        {
          decision: "apply",
          reviewComment: "退款依据与银行流水一致",
          currentPassword: "not-a-real-password"
        }
      )
    ).resolves.toMatchObject({
      id: "correction-1",
      status: "applied"
    });

    expect(tx.contractTakeoverBalanceAccount.updateMany).toHaveBeenCalledWith({
      where: {
        id: "balance-1",
        revision: 2,
        balanceCents: 101n
      },
      data: {
        balanceCents: 0n,
        revision: { increment: 1 }
      }
    });
    expect(tx.contractTakeoverBalanceEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: "balance-1",
        entryKind: "correction",
        amountCents: 101n,
        correctionId: "correction-1",
        idempotencyKey:
          "11111111-1111-4111-8111-111111111111:ledger:abnormal_overpay"
      })
    });
    expect(tx.contractTakeoverCorrection.updateMany).toHaveBeenCalledWith({
      where: {
        id: "correction-1",
        status: "submitted"
      },
      data: expect.objectContaining({
        status: "applied",
        reviewedByUserId: "finance-director-1",
        appliedByUserId: "finance-director-1"
      })
    });
  });

  it("blocks a reviewed negative delta that exceeds the currently locked balance", async () => {
    const { service, tx } = createContext({
      correction: correction({
        beforeSnapshot: { balanceCents: "101" },
        deltaSnapshot: { amountCents: "-102" },
        afterSnapshot: { balanceCents: "-1" }
      })
    });

    await expect(
      service.review(
        "project-1",
        "takeover-1",
        "correction-1",
        "finance-director-1",
        {
          decision: "apply",
          reviewComment: "同意",
          currentPassword: "not-a-real-password"
        }
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.contractTakeoverBalanceEntry.create).not.toHaveBeenCalled();
  });

  it("replays an already applied correction without a second ledger write", async () => {
    const applied = correction({
      status: "applied",
      reviewedByUserId: "finance-director-1",
      reviewedAt: new Date("2026-07-28T11:00:00.000Z"),
      appliedByUserId: "finance-director-1",
      appliedAt: new Date("2026-07-28T11:00:00.000Z")
    });
    const { service, tx } = createContext({ correction: applied });

    await expect(
      service.review(
        "project-1",
        "takeover-1",
        "correction-1",
        "finance-director-1",
        {
          decision: "apply",
          reviewComment: "重复点击",
          currentPassword: "not-a-real-password"
        }
      )
    ).resolves.toMatchObject({
      id: "correction-1",
      status: "applied",
      repeated: true
    });
    expect(tx.contractTakeoverBalanceEntry.create).not.toHaveBeenCalled();
    expect(tx.contractTakeoverCorrection.updateMany).not.toHaveBeenCalled();
  });

  it("applies a contract-director settlement delta to facts, parent and opening settlement together", async () => {
    const settlementCorrection = correction({
      correctionScope: "historical_settlement",
      targetRevision: 3,
      targetBalanceRevision: null,
      beforeSnapshot: {
        amountCents: "1000",
        revision: 3
      },
      deltaSnapshot: { amountCents: "1" },
      afterSnapshot: { amountCents: "1001" },
      createdByUserId: "contract-staff-1"
    });
    const { service, tx } = createContext({
      correction: settlementCorrection,
      positionKey: "contract_director",
      rawRows: [
        [settlementCorrection],
        [
          {
            id: "takeover-1",
            projectId: "project-1",
            activatedAt: new Date(),
            historicalInitialSettlementId: "settlement-opening-1",
            historicalPaidCents: 500n,
            historicalAdvancePaidCents: 0n,
            historicalAdvanceDeductedCents: 0n
          }
        ]
      ]
    });

    await expect(
      service.review(
        "project-1",
        "takeover-1",
        "correction-1",
        "contract-director-1",
        {
          decision: "apply",
          reviewComment: "历史结算依据核验无误",
          currentPassword: "not-a-real-password"
        }
      )
    ).resolves.toMatchObject({ status: "applied" });

    expect(tx.settlement.updateMany).toHaveBeenCalledWith({
      where: {
        id: "settlement-opening-1",
        amountCents: 1_000n,
        payableAmountCents: 1_000n
      },
      data: {
        amountCents: { increment: 1n },
        payableAmountCents: { increment: 1n }
      }
    });
    expect(
      tx.contractTakeoverContractFacts.updateMany
    ).toHaveBeenCalledWith({
      where: {
        takeoverId: "takeover-1",
        revision: 3,
        historicalSettledCents: 1_000n
      },
      data: expect.objectContaining({
        revision: { increment: 1 },
        financeBasisRevision: { increment: 1 },
        historicalSettledCents: 1_001n,
        zeroSettlementDeclared: false,
        confirmedRevision: 4,
        confirmedByUserId: "contract-director-1"
      })
    });
  });

  it("applies a historical-payment allocation delta without rewriting the original payment or allocation", async () => {
    const paymentCorrection = correction({
      correctionScope: "historical_payment",
      targetRevision: 4,
      targetBalanceRevision: null,
      targetHistoricalPaymentId: "payment-1",
      targetAllocationId: "allocation-1",
      beforeSnapshot: {
        amountCents: "500",
        allocationType: "settlement",
        financeRevision: 4
      },
      deltaSnapshot: { amountCents: "-1" },
      afterSnapshot: {
        amountCents: "499",
        allocationType: "settlement"
      }
    });
    const { service, tx } = createContext({
      correction: paymentCorrection,
      rawRows: [
        [paymentCorrection],
        [
          {
            id: "takeover-1",
            projectId: "project-1",
            activatedAt: new Date(),
            historicalInitialSettlementId: "settlement-opening-1",
            historicalPaidCents: 1_000n,
            historicalAdvancePaidCents: 0n,
            historicalAdvanceDeductedCents: 0n
          }
        ],
        [
          {
            id: "allocation-1",
            historicalPaymentId: "payment-1",
            allocationType: "settlement",
            amountCents: 500n,
            takeoverId: "takeover-1"
          }
        ]
      ]
    });

    await service.review(
      "project-1",
      "takeover-1",
      "correction-1",
      "finance-director-1",
      {
        decision: "apply",
        reviewComment: "原实付尾数登记有误",
        currentPassword: "not-a-real-password"
      }
    );

    expect(tx.settlement.updateMany).toHaveBeenCalledWith({
      where: {
        id: "settlement-opening-1",
        paidAmountCents: 500n
      },
      data: { paidAmountCents: 499n }
    });
    expect(
      tx.contractTakeoverHistoricalPaymentAllocation.findUnique
    ).not.toHaveBeenCalled();
  });

  it("reclassifies abnormal overpay to historical advance with paired immutable entries", async () => {
    const reclassification = correction({
      correctionScope: "abnormal_overpay",
      correctionOperation: "reclassification",
      targetRevision: 4,
      targetBalanceRevision: 2,
      targetHistoricalPaymentId: "payment-1",
      targetAllocationId: "allocation-1",
      beforeSnapshot: {
        sourceType: "abnormal_overpay",
        sourceBalanceCents: "101",
        sourceBalanceRevision: 2,
        targetType: "historical_advance"
      },
      deltaSnapshot: {
        amountCents: "100",
        from: "abnormal_overpay",
        to: "historical_advance"
      },
      afterSnapshot: {
        sourceType: "abnormal_overpay",
        sourceBalanceCents: "1",
        targetType: "historical_advance"
      }
    });
    const { service, tx } = createContext({
      correction: reclassification,
      rawRows: [
        [reclassification],
        [
          {
            id: "takeover-1",
            projectId: "project-1",
            activatedAt: new Date(),
            historicalInitialSettlementId: null,
            historicalPaidCents: 1_000n,
            historicalAdvancePaidCents: 0n,
            historicalAdvanceDeductedCents: 0n
          }
        ],
        [
          {
            id: "allocation-1",
            historicalPaymentId: "payment-1",
            allocationType: "abnormal_overpay",
            amountCents: 101n,
            takeoverId: "takeover-1"
          }
        ],
        [
          {
            id: "balance-1",
            takeoverId: "takeover-1",
            balanceType: "abnormal_overpay",
            openingCents: 101n,
            balanceCents: 101n,
            revision: 2
          }
        ]
      ]
    });

    await service.review(
      "project-1",
      "takeover-1",
      "correction-1",
      "finance-director-1",
      {
        decision: "apply",
        reviewComment: "核验为历史预付款",
        currentPassword: "not-a-real-password"
      }
    );

    expect(
      tx.contractTakeoverBalanceEntry.create
    ).toHaveBeenCalledTimes(2);
    expect(
      tx.contractTakeoverBalanceEntry.create
    ).toHaveBeenNthCalledWith(
      1,
      {
        data: expect.objectContaining({
          accountId: "balance-1",
          entryKind: "reclassification",
          amountCents: 100n,
          correctionId: "correction-1"
        })
      }
    );
    expect(
      tx.contractTakeoverBalanceEntry.create
    ).toHaveBeenNthCalledWith(
      2,
      {
        data: expect.objectContaining({
          accountId: "balance-target-1",
          entryKind: "reclassification",
          amountCents: 100n,
          correctionId: "correction-1"
        })
      }
    );
  });

  it("routes an exact deduction reversal through the governed balance service", async () => {
    const reversal = correction({
      correctionScope: "historical_advance",
      correctionOperation: "reversal",
      targetRevision: 4,
      targetBalanceRevision: 2,
      targetBalanceEntryId: "deduction-1",
      beforeSnapshot: {
        balanceCents: "20",
        balanceRevision: 2,
        originalEntryKind: "deduction",
        originalEntryAmountCents: "80"
      },
      deltaSnapshot: {
        amountCents: "80",
        reversesEntryId: "deduction-1"
      },
      afterSnapshot: { balanceCents: "100" }
    });
    balances.reverseEntryInTransaction.mockResolvedValue({
      entryId: "reversal-1",
      repeated: false
    });
    const { service } = createContext({
      correction: reversal,
      rawRows: [
        [reversal],
        [
          {
            id: "takeover-1",
            projectId: "project-1",
            activatedAt: new Date(),
            historicalInitialSettlementId: "settlement-opening-1",
            historicalPaidCents: 1_000n,
            historicalAdvancePaidCents: 100n,
            historicalAdvanceDeductedCents: 80n
          }
        ],
        [
          {
            id: "balance-advance-1",
            takeoverId: "takeover-1",
            balanceType: "historical_advance",
            openingCents: 100n,
            balanceCents: 20n,
            revision: 2
          }
        ]
      ]
    });

    await service.review(
      "project-1",
      "takeover-1",
      "correction-1",
      "finance-director-1",
      {
        decision: "apply",
        reviewComment: "原抵扣对象错误，批准反向",
        currentPassword: "not-a-real-password"
      }
    );

    expect(
      balances.reverseEntryInTransaction
    ).toHaveBeenCalledWith(
      expect.any(Object),
      "deduction-1",
      "finance-director-1",
      "11111111-1111-4111-8111-111111111111:reversal",
      "correction-1"
    );
  });
});
