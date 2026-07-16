import { ConflictException } from "@nestjs/common";
import { SpotProcurementBalanceService } from "./spot-procurement-balance.service";

function harness() {
  const tx = {
    $queryRaw: jest.fn(),
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
      new ConflictException("供应商可用余额不足，请刷新付款草稿后重试")
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
      service.releaseReservation(
        tx as never,
        "payment-1",
        "finance-1",
        "付款申请被退回"
      )
    ).resolves.toEqual({ released: true, amountCents: 3_000n });
    expect(tx.supplierBalanceReservation.updateMany).toHaveBeenCalledWith({
      where: { id: "reservation-1", status: "reserved" },
      data: expect.objectContaining({
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

  it("treats an absent or already-terminal reservation as an idempotent no-op", async () => {
    const { service, tx } = harness();
    tx.supplierBalanceReservation.findUnique.mockResolvedValue(null);

    await expect(
      service.releaseReservation(
        tx as never,
        "payment-1",
        "finance-1",
        "重复释放"
      )
    ).resolves.toEqual({ released: false, amountCents: 0n });
    expect(tx.supplierBalanceAccount.update).not.toHaveBeenCalled();
    expect(tx.supplierBalanceEntry.create).not.toHaveBeenCalled();
  });

  it("does not decrement the account or append a duplicate ledger entry when release loses its status CAS", async () => {
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
          status: "reserved"
        }
      ]);
    tx.supplierBalanceReservation.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.releaseReservation(
        tx as never,
        "payment-1",
        "finance-1",
        "并发重复释放"
      )
    ).resolves.toEqual({ released: false, amountCents: 0n });
    expect(tx.supplierBalanceAccount.update).not.toHaveBeenCalled();
    expect(tx.supplierBalanceEntry.create).not.toHaveBeenCalled();
  });
});
