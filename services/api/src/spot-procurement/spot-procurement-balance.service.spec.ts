import { ConflictException } from "@nestjs/common";
import { SpotProcurementBalanceService } from "./spot-procurement-balance.service";

const RESERVATION_STATE_ERROR =
  "供应商余额预留状态异常，请联系财务处理";

function harness() {
  const tx = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    supplierBalanceAccount: {
      findUnique: jest.fn(),
      update: jest.fn()
    },
    supplierBalanceReservation: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn()
    },
    spotProcurementPayment: {
      findUnique: jest.fn()
    },
    supplierBalanceEntry: {
      findFirst: jest.fn(),
      create: jest.fn()
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: "audit-1" })
    }
  };
  const prisma = {
    supplierBalanceAccount: {
      findUnique: jest.fn()
    }
  };
  const audit = {
    record: jest.fn((client: typeof tx, input: object) =>
      client.auditLog.create({ data: input })
    )
  };
  const service = new SpotProcurementBalanceService(
    prisma as never,
    audit as never
  );
  return { service, prisma, tx, audit };
}

function creditFromDiscrepancy(
  service: SpotProcurementBalanceService,
  tx: ReturnType<typeof harness>["tx"],
  amountCents = 3_000n
) {
  return service.creditFromDiscrepancy(tx as never, {
    discrepancyId: "discrepancy-1",
    projectId: "project-1",
    supplierPartyId: "party-1",
    supplierKey: "party:party-1",
    supplierNameSnapshot: "供应商甲",
    procurementId: "procurement-1",
    amountCents,
    actorUserId: "finance-director-1",
    reason: "少货真实多付整笔转余额"
  });
}

function releaseForShortage(
  service: SpotProcurementBalanceService,
  tx: ReturnType<typeof harness>["tx"],
  releaseAmountCents: bigint
) {
  return service.releaseForShortage(tx as never, {
    paymentId: "payment-1",
    expectedReservedAmountCents: 3_000n,
    releaseAmountCents,
    expectedProjectId: "project-1",
    expectedSupplierKey: "party:party-1",
    actorUserId: "material-director-1",
    reason: "收货少货取消未执行余额额度"
  });
}

function executeReservation(
  service: SpotProcurementBalanceService,
  tx: ReturnType<typeof harness>["tx"],
  expectedAmountCents = 2_000n
) {
  return service.executeReservation(tx as never, {
    paymentId: "payment-1",
    expectedAmountCents,
    expectedProjectId: "project-1",
    expectedSupplierKey: "party:party-1",
    expectedProcurementId: "procurement-1",
    actorUserId: "finance-director-1",
    reason: "财务主管确认执行供应商余额抵扣"
  });
}

function releaseReservation(
  service: SpotProcurementBalanceService,
  tx: ReturnType<typeof harness>["tx"],
  expectedAmountCents: bigint,
  actorUserId = "finance-1",
  reason = "付款申请被退回",
  expectedProjectId = "project-1",
  expectedSupplierKey = "party:party-1"
) {
  return service.releaseReservation(tx as never, {
    paymentId: "payment-1",
    expectedAmountCents,
    expectedProjectId,
    expectedSupplierKey,
    actorUserId,
    reason
  });
}

function releaseReservationWithBusinessCoordinates(
  service: SpotProcurementBalanceService,
  tx: ReturnType<typeof harness>["tx"],
  expectedAmountCents: bigint,
  expectedProjectId = "project-1",
  expectedSupplierKey = "party:party-1",
  actorUserId = "finance-1",
  reason = "付款申请被退回"
) {
  return service.releaseReservation(tx as never, {
    paymentId: "payment-1",
    expectedAmountCents,
    expectedProjectId,
    expectedSupplierKey,
    actorUserId,
    reason
  });
}

describe("SpotProcurementBalanceService", () => {
  it("returns zero suggestion when no balance account exists", async () => {
    const { service, prisma } = harness();
    prisma.supplierBalanceAccount.findUnique.mockResolvedValue(null);

    await expect(
      service.suggestion("project-1", "party:party-1", 8_000n)
    ).resolves.toEqual({
      availableBalanceAmountCents: "0",
      suggestedBalanceAmountCents: "0"
    });
  });

  it("suggests only unreserved balance and caps it by settlement amount", async () => {
    const { service, prisma } = harness();
    prisma.supplierBalanceAccount.findUnique.mockResolvedValue({
      availableAmountCents: 10_000n,
      reservedAmountCents: 3_000n
    });

    await expect(
      service.suggestion("project-1", "party:party-1", 5_000n)
    ).resolves.toEqual({
      availableBalanceAmountCents: "7000",
      suggestedBalanceAmountCents: "5000"
    });
  });

  it("locks the account, reserves balance and appends a sequence-safe ledger entry", async () => {
    const { service, tx, audit } = harness();
    tx.$queryRaw.mockResolvedValueOnce([
      {
        id: "balance-1",
        projectId: "project-1",
        supplierKey: "party:party-1",
        availableAmountCents: 10_000n,
        reservedAmountCents: 2_000n
      }
    ]);
    tx.supplierBalanceReservation.create.mockResolvedValue({
      id: "reservation-1"
    });
    tx.supplierBalanceAccount.update.mockResolvedValue({
      id: "balance-1"
    });
    tx.supplierBalanceEntry.findFirst.mockResolvedValue({
      sequenceNo: 6n
    });
    tx.supplierBalanceEntry.create.mockResolvedValue({ id: "entry-1" });

    const result = await service.reserve(tx as never, {
      projectId: "project-1",
      supplierKey: "party:party-1",
      paymentId: "payment-1",
      procurementId: "procurement-1",
      amountCents: 3_000n,
      actorUserId: "material-1"
    });

    expect(result).toEqual({
      reservationId: "reservation-1",
      amountCents: 3_000n
    });
    expect(tx.supplierBalanceAccount.update).toHaveBeenCalledWith({
      where: { id: "balance-1" },
      data: { reservedAmountCents: 5_000n }
    });
    expect(tx.supplierBalanceEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: "balance-1",
        sequenceNo: 7n,
        reservationId: "reservation-1",
        paymentId: "payment-1",
        procurementId: "procurement-1",
        entryType: "reserve",
        availableDeltaCents: 0n,
        reservedDeltaCents: 3_000n,
        availableAmountAfterCents: 10_000n,
        reservedAmountAfterCents: 5_000n
      })
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "spot_procurement.balance.reserve",
        businessId: "payment-1",
        metadata: expect.objectContaining({
          reservationId: "reservation-1",
          amountCents: "3000"
        })
      })
    );
  });

  it("rejects reservation when the locked account has insufficient unreserved balance", async () => {
    const { service, tx } = harness();
    tx.$queryRaw.mockResolvedValueOnce([
      {
        id: "balance-1",
        projectId: "project-1",
        supplierKey: "party:party-1",
        availableAmountCents: 4_000n,
        reservedAmountCents: 3_000n
      }
    ]);

    await expect(
      service.reserve(tx as never, {
        projectId: "project-1",
        supplierKey: "party:party-1",
        paymentId: "payment-1",
        procurementId: "procurement-1",
        amountCents: 2_000n,
        actorUserId: "material-1"
      })
    ).rejects.toEqual(
      new ConflictException(
        "供应商可用余额已变化，请将抵扣金额调整为最新系统建议后重新提交"
      )
    );
    expect(tx.supplierBalanceReservation.create).not.toHaveBeenCalled();
  });

  it("does not require an account or create a reservation for zero balance use", async () => {
    const { service, tx } = harness();

    await expect(
      service.reserve(tx as never, {
        projectId: "project-1",
        supplierKey: "party:party-1",
        paymentId: "payment-1",
        procurementId: "procurement-1",
        amountCents: 0n,
        actorUserId: "material-1"
      })
    ).resolves.toEqual({ reservationId: null, amountCents: 0n });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it("releases a reservation exactly once and appends a release entry", async () => {
    const { service, tx, audit } = harness();
    tx.supplierBalanceReservation.findUnique.mockResolvedValue({
      accountId: "balance-1",
      status: "reserved"
    });
    tx.spotProcurementPayment.findUnique.mockResolvedValue({
      procurementId: "procurement-1"
    });
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: "balance-1",
          projectId: "project-1",
          supplierKey: "party:party-1",
          availableAmountCents: 10_000n,
          reservedAmountCents: 5_000n
        }
      ])
      .mockResolvedValueOnce([
        {
          id: "reservation-1",
          accountId: "balance-1",
          paymentId: "payment-1",
          amountCents: 3_000n,
          releasedAmountCents: 0n,
          status: "reserved"
        }
      ]);
    tx.supplierBalanceReservation.updateMany.mockResolvedValue({ count: 1 });
    tx.supplierBalanceAccount.update.mockResolvedValue({ id: "balance-1" });
    tx.supplierBalanceEntry.findFirst.mockResolvedValue({
      sequenceNo: 7n
    });
    tx.supplierBalanceEntry.create.mockResolvedValue({ id: "entry-2" });

    await expect(
      releaseReservation(service, tx, 3_000n)
    ).resolves.toEqual({ released: true, amountCents: 3_000n });
    expect(tx.supplierBalanceReservation.updateMany).toHaveBeenCalledWith({
      where: {
        id: "reservation-1",
        status: "reserved",
        releasedAmountCents: 0n
      },
      data: expect.objectContaining({
        releasedAmountCents: 3_000n,
        status: "released",
        releasedByUserId: "finance-1",
        releaseReason: "付款申请被退回"
      })
    });
    expect(tx.supplierBalanceAccount.update).toHaveBeenCalledWith({
      where: { id: "balance-1" },
      data: { reservedAmountCents: 2_000n }
    });
    expect(tx.supplierBalanceEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sequenceNo: 8n,
        entryType: "release",
        procurementId: "procurement-1",
        reservedDeltaCents: -3_000n,
        reservedAmountAfterCents: 2_000n
      })
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "spot_procurement.balance.release"
      })
    );
  });

  it.each([
    [
      "project",
      {
        projectId: "project-2",
        supplierKey: "party:party-1"
      }
    ],
    [
      "supplier",
      {
        projectId: "project-1",
        supplierKey: "party:party-2"
      }
    ]
  ])(
    "fails closed when the reserved account has the wrong %s coordinate",
    async (_coordinate, accountCoordinates) => {
      const { service, tx, audit } = harness();
      tx.supplierBalanceReservation.findUnique.mockResolvedValue({
        accountId: "balance-1",
        status: "reserved"
      });
      tx.spotProcurementPayment.findUnique.mockResolvedValue({
        procurementId: "procurement-1"
      });
      tx.$queryRaw
        .mockResolvedValueOnce([
          {
            id: "balance-1",
            ...accountCoordinates,
            availableAmountCents: 10_000n,
            reservedAmountCents: 3_000n
          }
        ])
        .mockResolvedValueOnce([
          {
            id: "reservation-1",
            accountId: "balance-1",
            paymentId: "payment-1",
            amountCents: 3_000n,
            releasedAmountCents: 0n,
            status: "reserved"
          }
        ]);
      tx.supplierBalanceReservation.updateMany.mockResolvedValue({
        count: 1
      });

      await expect(
        releaseReservationWithBusinessCoordinates(
          service,
          tx,
          3_000n
        )
      ).rejects.toEqual(new ConflictException(RESERVATION_STATE_ERROR));
      expect(
        tx.supplierBalanceReservation.updateMany
      ).not.toHaveBeenCalled();
      expect(tx.supplierBalanceAccount.update).not.toHaveBeenCalled();
      expect(tx.supplierBalanceEntry.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    }
  );

  it("fails closed when a positive frozen balance amount has no reservation", async () => {
    const { service, tx } = harness();
    tx.supplierBalanceReservation.findUnique.mockResolvedValue(null);

    await expect(
      releaseReservation(service, tx, 3_000n, "finance-1", "重复释放")
    ).rejects.toEqual(new ConflictException(RESERVATION_STATE_ERROR));
    expect(tx.supplierBalanceAccount.update).not.toHaveBeenCalled();
    expect(tx.supplierBalanceEntry.create).not.toHaveBeenCalled();
  });

  it("allows a zero frozen balance amount only when no reservation exists", async () => {
    const { service, tx } = harness();
    tx.supplierBalanceReservation.findUnique.mockResolvedValue(null);

    await expect(
      releaseReservation(service, tx, 0n, "finance-1", "零余额付款终止")
    ).resolves.toEqual({ released: false, amountCents: 0n });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.supplierBalanceAccount.update).not.toHaveBeenCalled();
    expect(tx.supplierBalanceEntry.create).not.toHaveBeenCalled();
  });

  it("fails closed when a zero frozen balance amount unexpectedly has a reservation", async () => {
    const { service, tx } = harness();
    tx.supplierBalanceReservation.findUnique.mockResolvedValue({
      accountId: "balance-1",
      status: "reserved"
    });

    await expect(
      releaseReservation(service, tx, 0n, "finance-1", "零余额付款终止")
    ).rejects.toEqual(new ConflictException(RESERVATION_STATE_ERROR));
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.supplierBalanceAccount.update).not.toHaveBeenCalled();
    expect(tx.supplierBalanceEntry.create).not.toHaveBeenCalled();
  });

  it.each([
    [
      "terminal status",
      {
        accountId: "balance-1",
        status: "released"
      },
      {
        id: "reservation-1",
        accountId: "balance-1",
        paymentId: "payment-1",
        amountCents: 3_000n,
        releasedAmountCents: 0n,
        status: "released"
      }
    ],
    [
      "amount mismatch",
      {
        accountId: "balance-1",
        status: "reserved"
      },
      {
        id: "reservation-1",
        accountId: "balance-1",
        paymentId: "payment-1",
        amountCents: 2_999n,
        releasedAmountCents: 0n,
        status: "reserved"
      }
    ],
    [
      "same-amount wrong account",
      {
        accountId: "balance-1",
        status: "reserved"
      },
      {
        id: "reservation-1",
        accountId: "balance-2",
        paymentId: "payment-1",
        amountCents: 3_000n,
        releasedAmountCents: 0n,
        status: "reserved"
      }
    ]
  ])(
    "fails closed on reservation %s before changing the account",
    async (_caseName, preflightReservation, lockedReservation) => {
      const { service, tx, audit } = harness();
      tx.supplierBalanceReservation.findUnique.mockResolvedValue(
        preflightReservation
      );
      tx.spotProcurementPayment.findUnique.mockResolvedValue({
        procurementId: "procurement-1"
      });
      tx.$queryRaw
        .mockResolvedValueOnce([
          {
            id: "balance-1",
            projectId: "project-1",
            supplierKey: "party:party-1",
            availableAmountCents: 10_000n,
            reservedAmountCents: 3_000n
          }
        ])
        .mockResolvedValueOnce([lockedReservation]);

      await expect(
        releaseReservation(service, tx, 3_000n)
      ).rejects.toEqual(new ConflictException(RESERVATION_STATE_ERROR));
      expect(tx.supplierBalanceReservation.updateMany).not.toHaveBeenCalled();
      expect(tx.supplierBalanceAccount.update).not.toHaveBeenCalled();
      expect(tx.supplierBalanceEntry.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    }
  );

  it("fails closed without decrementing the account when release loses its status CAS", async () => {
    const { service, tx } = harness();
    tx.supplierBalanceReservation.findUnique.mockResolvedValue({
      accountId: "balance-1",
      status: "reserved"
    });
    tx.spotProcurementPayment.findUnique.mockResolvedValue({
      procurementId: "procurement-1"
    });
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: "balance-1",
          projectId: "project-1",
          supplierKey: "party:party-1",
          availableAmountCents: 10_000n,
          reservedAmountCents: 3_000n
        }
      ])
      .mockResolvedValueOnce([
        {
          id: "reservation-1",
          accountId: "balance-1",
          paymentId: "payment-1",
          amountCents: 3_000n,
          releasedAmountCents: 0n,
          status: "reserved"
        }
      ]);
    tx.supplierBalanceReservation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      releaseReservation(
        service,
        tx,
        3_000n,
        "finance-1",
        "并发重复释放"
      )
    ).rejects.toEqual(new ConflictException(RESERVATION_STATE_ERROR));
    expect(tx.supplierBalanceAccount.update).not.toHaveBeenCalled();
    expect(tx.supplierBalanceEntry.create).not.toHaveBeenCalled();
  });

  it("concurrency-safely creates or reuses the same project-supplier account before crediting the full discrepancy", async () => {
    const { service, tx, audit } = harness();
    tx.$executeRaw.mockResolvedValue(1);
    tx.$queryRaw.mockResolvedValueOnce([
      {
        id: "balance-1",
        projectId: "project-1",
        supplierPartyId: "party-1",
        supplierKey: "party:party-1",
        supplierNameSnapshot: "供应商甲",
        availableAmountCents: 5_000n,
        reservedAmountCents: 1_000n
      }
    ]);
    tx.supplierBalanceAccount.update.mockResolvedValue({ id: "balance-1" });
    tx.supplierBalanceEntry.findFirst.mockResolvedValue({ sequenceNo: 9n });
    tx.supplierBalanceEntry.create.mockResolvedValue({ id: "entry-credit-1" });

    await expect(
      creditFromDiscrepancy(service, tx)
    ).resolves.toEqual({
      accountId: "balance-1",
      entryId: "entry-credit-1",
      amountCents: 3_000n
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.supplierBalanceAccount.update).toHaveBeenCalledWith({
      where: { id: "balance-1" },
      data: { availableAmountCents: 8_000n }
    });
    expect(tx.supplierBalanceEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: "balance-1",
        sequenceNo: 10n,
        procurementId: "procurement-1",
        entryType: "credit_from_discrepancy",
        availableDeltaCents: 3_000n,
        reservedDeltaCents: 0n,
        availableAmountAfterCents: 8_000n,
        reservedAmountAfterCents: 1_000n
      })
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "spot_procurement.balance.credit_from_discrepancy",
        businessType: "spot_procurement_discrepancy",
        businessId: "discrepancy-1",
        metadata: expect.objectContaining({
          procurementId: "procurement-1",
          entryId: "entry-credit-1",
          amountCents: "3000"
        })
      })
    );
  });

  it("rejects a non-positive discrepancy credit before attempting account creation", async () => {
    const { service, tx } = harness();

    await expect(
      creditFromDiscrepancy(service, tx, 0n)
    ).rejects.toEqual(
      new ConflictException("供应商余额转入金额异常，请刷新后重试")
    );
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.supplierBalanceAccount.update).not.toHaveBeenCalled();
    expect(tx.supplierBalanceEntry.create).not.toHaveBeenCalled();
  });

  it("partially releases a shortage from the live reservation without rewriting its reserve entry", async () => {
    const { service, tx, audit } = harness();
    tx.supplierBalanceReservation.findUnique.mockResolvedValue({
      accountId: "balance-1",
      status: "reserved"
    });
    tx.spotProcurementPayment.findUnique.mockResolvedValue({
      procurementId: "procurement-1"
    });
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: "balance-1",
          projectId: "project-1",
          supplierKey: "party:party-1",
          availableAmountCents: 10_000n,
          reservedAmountCents: 3_000n
        }
      ])
      .mockResolvedValueOnce([
        {
          id: "reservation-1",
          accountId: "balance-1",
          paymentId: "payment-1",
          amountCents: 3_000n,
          releasedAmountCents: 0n,
          status: "reserved"
        }
      ]);
    tx.supplierBalanceReservation.updateMany.mockResolvedValue({ count: 1 });
    tx.supplierBalanceAccount.update.mockResolvedValue({ id: "balance-1" });
    tx.supplierBalanceEntry.findFirst.mockResolvedValue({ sequenceNo: 3n });
    tx.supplierBalanceEntry.create.mockResolvedValue({ id: "entry-release-1" });

    await expect(
      releaseForShortage(service, tx, 1_000n)
    ).resolves.toEqual({
      releasedAmountCents: 1_000n,
      remainingAmountCents: 2_000n,
      status: "reserved"
    });
    expect(tx.supplierBalanceReservation.updateMany).toHaveBeenCalledWith({
      where: {
        id: "reservation-1",
        status: "reserved",
        releasedAmountCents: 0n
      },
      data: expect.objectContaining({
        releasedAmountCents: 1_000n,
        status: "reserved",
        releasedByUserId: "material-director-1",
        releaseReason: "收货少货取消未执行余额额度"
      })
    });
    expect(tx.supplierBalanceAccount.update).toHaveBeenCalledWith({
      where: { id: "balance-1" },
      data: { reservedAmountCents: 2_000n }
    });
    expect(tx.supplierBalanceEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entryType: "partial_release",
        availableDeltaCents: 0n,
        reservedDeltaCents: -1_000n,
        reservedAmountAfterCents: 2_000n
      })
    });
    expect(tx.supplierBalanceEntry).not.toHaveProperty("update");
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "spot_procurement.balance.partial_release"
      })
    );
  });

  it("marks a reservation released when shortage cancellation consumes its full remaining amount", async () => {
    const { service, tx } = harness();
    tx.supplierBalanceReservation.findUnique.mockResolvedValue({
      accountId: "balance-1",
      status: "reserved"
    });
    tx.spotProcurementPayment.findUnique.mockResolvedValue({
      procurementId: "procurement-1"
    });
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: "balance-1",
          projectId: "project-1",
          supplierKey: "party:party-1",
          availableAmountCents: 10_000n,
          reservedAmountCents: 2_000n
        }
      ])
      .mockResolvedValueOnce([
        {
          id: "reservation-1",
          accountId: "balance-1",
          paymentId: "payment-1",
          amountCents: 3_000n,
          releasedAmountCents: 1_000n,
          status: "reserved"
        }
      ]);
    tx.supplierBalanceReservation.updateMany.mockResolvedValue({ count: 1 });
    tx.supplierBalanceAccount.update.mockResolvedValue({ id: "balance-1" });
    tx.supplierBalanceEntry.findFirst.mockResolvedValue({ sequenceNo: 4n });
    tx.supplierBalanceEntry.create.mockResolvedValue({ id: "entry-release-2" });

    await expect(
      releaseForShortage(service, tx, 2_000n)
    ).resolves.toEqual({
      releasedAmountCents: 2_000n,
      remainingAmountCents: 0n,
      status: "released"
    });
    expect(tx.supplierBalanceReservation.updateMany).toHaveBeenCalledWith({
      where: {
        id: "reservation-1",
        status: "reserved",
        releasedAmountCents: 1_000n
      },
      data: expect.objectContaining({
        releasedAmountCents: 3_000n,
        status: "released"
      })
    });
    expect(tx.supplierBalanceEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entryType: "release",
        reservedDeltaCents: -2_000n
      })
    });
  });

  it("executes only the unreleased reservation amount and consumes available and reserved balance together", async () => {
    const { service, tx, audit } = harness();
    tx.supplierBalanceReservation.findUnique.mockResolvedValue({
      accountId: "balance-1",
      status: "reserved"
    });
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: "balance-1",
          projectId: "project-1",
          supplierKey: "party:party-1",
          availableAmountCents: 10_000n,
          reservedAmountCents: 2_000n
        }
      ])
      .mockResolvedValueOnce([
        {
          id: "reservation-1",
          accountId: "balance-1",
          paymentId: "payment-1",
          amountCents: 3_000n,
          releasedAmountCents: 1_000n,
          status: "reserved"
        }
      ]);
    tx.spotProcurementPayment.findUnique.mockResolvedValue({
      projectId: "project-1",
      procurementId: "procurement-1",
      supplierBalanceAmountCents: 3_000n,
      canceledSupplierBalanceAmountCents: 1_000n,
      executedSupplierBalanceAmountCents: 0n
    });
    tx.supplierBalanceReservation.updateMany.mockResolvedValue({ count: 1 });
    tx.supplierBalanceAccount.update.mockResolvedValue({ id: "balance-1" });
    tx.supplierBalanceEntry.findFirst.mockResolvedValue({ sequenceNo: 12n });
    tx.supplierBalanceEntry.create.mockResolvedValue({ id: "entry-execute-1" });

    await expect(
      executeReservation(service, tx)
    ).resolves.toEqual({
      accountId: "balance-1",
      reservationId: "reservation-1",
      entryId: "entry-execute-1",
      amountCents: 2_000n
    });
    expect(tx.supplierBalanceReservation.updateMany).toHaveBeenCalledWith({
      where: {
        id: "reservation-1",
        status: "reserved",
        releasedAmountCents: 1_000n
      },
      data: expect.objectContaining({
        status: "executed",
        executedByUserId: "finance-director-1"
      })
    });
    expect(tx.supplierBalanceAccount.update).toHaveBeenCalledWith({
      where: { id: "balance-1" },
      data: {
        availableAmountCents: 8_000n,
        reservedAmountCents: 0n
      }
    });
    expect(tx.supplierBalanceEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entryType: "execute",
        availableDeltaCents: -2_000n,
        reservedDeltaCents: -2_000n,
        availableAmountAfterCents: 8_000n,
        reservedAmountAfterCents: 0n
      })
    });
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "spot_procurement.balance.execute",
        businessId: "payment-1",
        metadata: expect.objectContaining({
          amountCents: "2000",
          entryId: "entry-execute-1"
        })
      })
    );
  });

  it.each([
    ["project", { projectId: "project-2", procurementId: "procurement-1" }],
    ["procurement", { projectId: "project-1", procurementId: "procurement-2" }]
  ])(
    "fails closed when execution has a mismatched payment %s coordinate",
    async (_coordinate, paymentCoordinates) => {
      const { service, tx, audit } = harness();
      tx.supplierBalanceReservation.findUnique.mockResolvedValue({
        accountId: "balance-1",
        status: "reserved"
      });
      tx.$queryRaw
        .mockResolvedValueOnce([
          {
            id: "balance-1",
            projectId: "project-1",
            supplierKey: "party:party-1",
            availableAmountCents: 3_000n,
            reservedAmountCents: 2_000n
          }
        ])
        .mockResolvedValueOnce([
          {
            id: "reservation-1",
            accountId: "balance-1",
            paymentId: "payment-1",
            amountCents: 2_000n,
            releasedAmountCents: 0n,
            status: "reserved"
          }
        ]);
      tx.spotProcurementPayment.findUnique.mockResolvedValue({
        ...paymentCoordinates,
        supplierBalanceAmountCents: 2_000n,
        canceledSupplierBalanceAmountCents: 0n,
        executedSupplierBalanceAmountCents: 0n
      });

      await expect(
        executeReservation(service, tx)
      ).rejects.toEqual(new ConflictException(RESERVATION_STATE_ERROR));
      expect(tx.supplierBalanceReservation.updateMany).not.toHaveBeenCalled();
      expect(tx.supplierBalanceAccount.update).not.toHaveBeenCalled();
      expect(tx.supplierBalanceEntry.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    }
  );

  it("fails closed when execution balance is insufficient before changing the reservation", async () => {
    const { service, tx } = harness();
    tx.supplierBalanceReservation.findUnique.mockResolvedValue({
      accountId: "balance-1",
      status: "reserved"
    });
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: "balance-1",
          projectId: "project-1",
          supplierKey: "party:party-1",
          availableAmountCents: 1_999n,
          reservedAmountCents: 1_999n
        }
      ])
      .mockResolvedValueOnce([
        {
          id: "reservation-1",
          accountId: "balance-1",
          paymentId: "payment-1",
          amountCents: 2_000n,
          releasedAmountCents: 0n,
          status: "reserved"
        }
      ]);
    tx.spotProcurementPayment.findUnique.mockResolvedValue({
      projectId: "project-1",
      procurementId: "procurement-1",
      supplierBalanceAmountCents: 2_000n,
      canceledSupplierBalanceAmountCents: 0n,
      executedSupplierBalanceAmountCents: 0n
    });

    await expect(
      executeReservation(service, tx)
    ).rejects.toEqual(new ConflictException(RESERVATION_STATE_ERROR));
    expect(tx.supplierBalanceReservation.updateMany).not.toHaveBeenCalled();
    expect(tx.supplierBalanceAccount.update).not.toHaveBeenCalled();
  });

  it("fails closed when execution loses its reservation status CAS", async () => {
    const { service, tx } = harness();
    tx.supplierBalanceReservation.findUnique.mockResolvedValue({
      accountId: "balance-1",
      status: "reserved"
    });
    tx.$queryRaw
      .mockResolvedValueOnce([
        {
          id: "balance-1",
          projectId: "project-1",
          supplierKey: "party:party-1",
          availableAmountCents: 2_000n,
          reservedAmountCents: 2_000n
        }
      ])
      .mockResolvedValueOnce([
        {
          id: "reservation-1",
          accountId: "balance-1",
          paymentId: "payment-1",
          amountCents: 2_000n,
          releasedAmountCents: 0n,
          status: "reserved"
        }
      ]);
    tx.spotProcurementPayment.findUnique.mockResolvedValue({
      projectId: "project-1",
      procurementId: "procurement-1",
      supplierBalanceAmountCents: 2_000n,
      canceledSupplierBalanceAmountCents: 0n,
      executedSupplierBalanceAmountCents: 0n
    });
    tx.supplierBalanceReservation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      executeReservation(service, tx)
    ).rejects.toEqual(new ConflictException(RESERVATION_STATE_ERROR));
    expect(tx.supplierBalanceAccount.update).not.toHaveBeenCalled();
    expect(tx.supplierBalanceEntry.create).not.toHaveBeenCalled();
  });
});
