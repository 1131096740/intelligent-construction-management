import { ContractTakeoverActivationService } from "./contract-takeover-activation.service";

describe("ContractTakeoverActivationService", () => {
  const audit = {
    record: jest.fn().mockResolvedValue({ id: "audit-1" })
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function transaction(options: {
    contractTypeKey?: string;
    historicalSettledCents?: bigint;
    payments?: Array<{ id: string; amountCents: bigint }>;
    amountCents?: bigint;
    amountLimitType?: string;
    excessTreatment?: string | null;
    activatedAt?: Date | null;
    activationIdempotencyKey?: string | null;
    historicalInitialSettlementId?: string | null;
    confirmedFinanceBasisRevision?: number;
    zeroSettlementDeclared?: boolean;
    companyEntityId?: string | null;
    companyEntityName?: string | null;
    companyEntityIsActive?: boolean | null;
    companyEntityDataStatus?: string | null;
    companyEntityVersionId?: string | null;
    companyEntityVersionName?: string | null;
    companyEntityCreditCode?: string | null;
    companyEntityRegisteredAddress?: string | null;
  } = {}) {
    const payments = options.payments ?? [];
    const takeover = {
      id: "takeover-1",
      projectId: "project-1",
      contractId: "contract-1",
      contractVersionId: "version-1",
      paymentTermsVersionId: "terms-1",
      activatedAt: options.activatedAt ?? null,
      activationIdempotencyKey: options.activationIdempotencyKey ?? null,
      historicalInitialSettlementId:
        options.historicalInitialSettlementId ?? null
    };
    const rows = [
      [takeover],
      [
        {
          takeoverId: "takeover-1",
          revision: 3,
          financeBasisRevision: 4,
          historicalSettledCents: options.historicalSettledCents ?? 600n,
          zeroSettlementDeclared:
            options.zeroSettlementDeclared ??
            (options.historicalSettledCents ?? 600n) === 0n,
          confirmedRevision: 3
        }
      ],
      [
        {
          takeoverId: "takeover-1",
          revision: 2,
          confirmedRevision: 2,
          confirmedFinanceBasisRevision:
            options.confirmedFinanceBasisRevision ?? 4,
          zeroPaymentDeclared: payments.length === 0,
          excessTreatment: options.excessTreatment ?? null
        }
      ],
      payments.map((payment, index) => ({
        ...payment,
        takeoverId: "takeover-1",
        sequenceNo: index + 1,
        status: "draft"
      })),
      payments.map((payment, index) => ({
        id: `voucher-${index + 1}`,
        historicalPaymentId: payment.id,
        fileId: `file-${index + 1}`
      })),
      [
        {
          id: "contract-1",
          contractTypeKey: options.contractTypeKey ?? "material_purchase",
          companyEntityId: options.companyEntityId,
          companyEntityName: options.companyEntityName,
          companyEntityIsActive: options.companyEntityIsActive,
          companyEntityDataStatus: options.companyEntityDataStatus,
          companyEntityVersionId: options.companyEntityVersionId,
          companyEntityVersionName: options.companyEntityVersionName,
          companyEntityCreditCode: options.companyEntityCreditCode,
          companyEntityRegisteredAddress: options.companyEntityRegisteredAddress
        }
      ],
      [
        {
          id: "version-1",
          amountCents: options.amountCents ?? 1_000n,
          amountLimitType: options.amountLimitType ?? "capped",
          pricingNature: "fixed_total",
          status: "draft"
        }
      ],
      [{ id: "terms-1", status: "draft" }]
    ];
    return {
      $queryRaw: jest
        .fn()
        .mockImplementation(() => Promise.resolve(rows.shift() ?? [])),
      contractTakeoverSettlementEvidence: {
        count: jest.fn().mockResolvedValue(1)
      },
      contractTakeoverExcessEvidence: {
        count: jest.fn().mockResolvedValue(1)
      },
      contractTakeoverHistoricalPaymentAllocation: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      settlement: {
        create: jest.fn().mockResolvedValue({ id: "settlement-opening-1" })
      },
      contractVersion: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      paymentTermsVersion: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      contractTakeoverHistoricalPayment: {
        updateMany: jest.fn().mockResolvedValue({ count: payments.length })
      },
      contractTakeoverBalanceAccount: {
        create: jest.fn().mockResolvedValue({ id: "balance-account-1" })
      },
      contractTakeoverBalanceEntry: {
        create: jest.fn().mockResolvedValue({ id: "balance-entry-1" })
      },
      contractTakeover: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    };
  }

  it("creates a unique zero-amount opening settlement without approval or execution records", async () => {
    const tx = transaction({ historicalSettledCents: 0n });
    const service = new ContractTakeoverActivationService(audit as never);

    await expect(
      service.tryActivateInTransaction(
        tx as never,
        "takeover-1",
        "finance-director",
        "activation-key-1"
      )
    ).resolves.toMatchObject({
      activated: true,
      activationStatus: "activated",
      historicalInitialSettlementId: "settlement-opening-1"
    });
    expect(tx.settlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amountCents: 0n,
        payableAmountCents: 0n,
        paidAmountCents: 0n,
        sourceType: "historical_takeover",
        sourceTakeoverId: "takeover-1",
        status: "effective"
      }),
      select: { id: true }
    });
    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith({
      where: { id: "version-1" },
      data: {
        status: "effective",
        effectiveAt: expect.any(Date),
        settlementMode: "settlement_required",
        settlementModeSource: "backfill",
        settlementModeConfirmedByUserId: "finance-director",
        settlementModeConfirmedAt: expect.any(Date)
      }
    });
    expect(tx).not.toHaveProperty("paymentRequest");
    expect(tx).not.toHaveProperty("paymentExecution");
  });

  it("activates multiple payments, preserves voucher bindings and opens advance balance", async () => {
    const tx = transaction({
      historicalSettledCents: 600n,
      payments: [
        { id: "payment-1", amountCents: 400n },
        { id: "payment-2", amountCents: 500n }
      ],
      excessTreatment: "historical_advance"
    });
    const service = new ContractTakeoverActivationService(audit as never);

    await service.tryActivateInTransaction(
      tx as never,
      "takeover-1",
      "finance-director",
      "activation-key-1"
    );

    expect(
      tx.contractTakeoverHistoricalPaymentAllocation.createMany
    ).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          historicalPaymentId: "payment-1",
          allocationType: "settlement",
          amountCents: 400n
        }),
        expect.objectContaining({
          historicalPaymentId: "payment-2",
          allocationType: "settlement",
          amountCents: 200n
        }),
        expect.objectContaining({
          historicalPaymentId: "payment-2",
          allocationType: "historical_advance",
          amountCents: 300n
        })
      ]
    });
    expect(tx.contractTakeoverHistoricalPayment.updateMany).toHaveBeenCalledWith({
      where: {
        takeoverId: "takeover-1",
        status: "draft"
      },
      data: {
        status: "activated",
        activatedAt: expect.any(Date)
      }
    });
    expect(tx.contractTakeoverBalanceAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        takeoverId: "takeover-1",
        balanceType: "historical_advance",
        openingCents: 300n,
        balanceCents: 300n
      }),
      select: { id: true }
    });
    expect(tx).not.toHaveProperty(
      "contractTakeoverHistoricalPaymentVoucher.updateMany"
    );
  });

  it("freezes the selected complete company entity into the effective contract version", async () => {
    const tx = transaction({
      companyEntityId: "entity-1",
      companyEntityName: "合同旧主体名称",
      companyEntityIsActive: true,
      companyEntityDataStatus: "complete",
      companyEntityVersionId: "entity-version-2",
      companyEntityVersionName: "建工智管建设有限公司",
      companyEntityCreditCode: "91350211M000100Y46",
      companyEntityRegisteredAddress: "云南省昆明市西山区"
    });
    const service = new ContractTakeoverActivationService(audit as never);

    await service.tryActivateInTransaction(
      tx as never,
      "takeover-1",
      "finance-director",
      "activation-key-1"
    );

    expect(tx.contractVersion.updateMany).toHaveBeenCalledWith({
      where: { id: "version-1" },
      data: expect.objectContaining({
        companyEntityIdSnapshot: "entity-1",
        companyEntityVersionId: "entity-version-2",
        companyEntityNameSnapshot: "建工智管建设有限公司",
        companyEntityCreditCodeSnapshot: "91350211M000100Y46",
        companyEntityRegisteredAddressSnapshot: "云南省昆明市西山区"
      })
    });
  });

  it("forces capped generic-contract excess to abnormal overpayment and creates no settlement", async () => {
    const tx = transaction({
      contractTypeKey: "generic_contract",
      historicalSettledCents: 0n,
      amountCents: 500n,
      payments: [{ id: "payment-1", amountCents: 700n }],
      excessTreatment: "historical_advance"
    });
    const service = new ContractTakeoverActivationService(audit as never);

    await service.tryActivateInTransaction(
      tx as never,
      "takeover-1",
      "finance-director",
      "activation-key-1"
    );

    expect(tx.settlement.create).not.toHaveBeenCalled();
    expect(
      tx.contractTakeoverHistoricalPaymentAllocation.createMany
    ).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          allocationType: "settlement",
          amountCents: 500n
        }),
        expect.objectContaining({
          allocationType: "abnormal_overpay",
          amountCents: 200n
        })
      ]
    });
    expect(tx.contractTakeoverBalanceAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        balanceType: "abnormal_overpay",
        openingCents: 200n
      }),
      select: { id: true }
    });
  });

  it("keeps unlimited generic-contract payments fully normal without false overpayment", async () => {
    const tx = transaction({
      contractTypeKey: "generic_contract",
      amountCents: 0n,
      amountLimitType: "unlimited",
      payments: [{ id: "payment-1", amountCents: 700n }]
    });
    const service = new ContractTakeoverActivationService(audit as never);

    await service.tryActivateInTransaction(
      tx as never,
      "takeover-1",
      "finance-director",
      "activation-key-1"
    );

    expect(tx.settlement.create).not.toHaveBeenCalled();
    expect(
      tx.contractTakeoverHistoricalPaymentAllocation.createMany
    ).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          allocationType: "settlement",
          amountCents: 700n
        })
      ]
    });
    expect(tx.contractTakeoverBalanceAccount.create).not.toHaveBeenCalled();
  });

  it("returns the original activation on repeat without duplicate writes or audit", async () => {
    const tx = transaction({
      activatedAt: new Date("2026-07-29T08:00:00.000Z"),
      activationIdempotencyKey: "activation-key-original",
      historicalInitialSettlementId: "settlement-opening-original"
    });
    const service = new ContractTakeoverActivationService(audit as never);

    await expect(
      service.tryActivateInTransaction(
        tx as never,
        "takeover-1",
        "another-director",
        "activation-key-retry"
      )
    ).resolves.toEqual({
      activated: true,
      activationStatus: "activated",
      activatedAt: "2026-07-29T08:00:00.000Z",
      activationIdempotencyKey: "activation-key-original",
      historicalInitialSettlementId: "settlement-opening-original"
    });
    expect(tx.settlement.create).not.toHaveBeenCalled();
    expect(tx.contractTakeover.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("rejects activation when finance confirmed an obsolete contract basis", async () => {
    const tx = transaction({ confirmedFinanceBasisRevision: 3 });
    const service = new ContractTakeoverActivationService(audit as never);

    await expect(
      service.tryActivateInTransaction(
        tx as never,
        "takeover-1",
        "finance-director",
        "activation-key-1"
      )
    ).rejects.toThrow("财务确认所依据的合同基线已过期");
    expect(tx.settlement.create).not.toHaveBeenCalled();
  });

  it("fails closed when zero settlement has no explicit declaration", async () => {
    const tx = transaction({
      historicalSettledCents: 0n,
      zeroSettlementDeclared: false
    });
    const service = new ContractTakeoverActivationService(audit as never);

    await expect(
      service.tryActivateInTransaction(
        tx as never,
        "takeover-1",
        "finance-director",
        "activation-key-1"
      )
    ).rejects.toThrow("历史累计结算为零时必须保留零结算声明");
    expect(tx.settlement.create).not.toHaveBeenCalled();
  });
});
