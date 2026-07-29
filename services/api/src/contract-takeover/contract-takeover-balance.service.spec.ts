import { ContractTakeoverBalanceService } from "./contract-takeover-balance.service";

describe("ContractTakeoverBalanceService", () => {
  const audit = {
    record: jest.fn().mockResolvedValue({ id: "audit-1" })
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("deducts the smaller of settlement payable and locked historical advance balance", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "account-1",
          openingCents: 150n,
          balanceCents: 150n,
          revision: 1
        }
      ]),
      contractTakeoverBalanceEntry: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "entry-1",
          amountCents: 100n
        })
      },
      contractTakeoverBalanceAccount: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      settlement: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    };
    const service = new ContractTakeoverBalanceService(audit as never);

    await expect(
      service.deductAdvanceForSettlement(
        tx as never,
        {
          id: "settlement-1",
          contractVersionId: "version-1",
          payableAmountCents: 100n
        },
        "contract-director"
      )
    ).resolves.toEqual({
      accountId: "account-1",
      entryId: "entry-1",
      openingCents: 150n,
      balanceBeforeCents: 150n,
      deductionCents: 100n,
      balanceAfterCents: 50n,
      payableAfterDeductionCents: 0n,
      repeated: false
    });
    expect(tx.contractTakeoverBalanceEntry.create).toHaveBeenCalledWith({
      data: {
        accountId: "account-1",
        entryKind: "deduction",
        amountCents: 100n,
        settlementId: "settlement-1",
        idempotencyKey:
          "settlement:settlement-1:historical-advance-deduction",
        createdByUserId: "contract-director"
      },
      select: { id: true, amountCents: true }
    });
    expect(
      tx.contractTakeoverBalanceAccount.updateMany
    ).toHaveBeenCalledWith({
      where: {
        id: "account-1",
        revision: 1,
        balanceCents: 150n
      },
      data: {
        balanceCents: 50n,
        revision: { increment: 1 }
      }
    });
    expect(tx.settlement.updateMany).toHaveBeenCalledWith({
      where: {
        id: "settlement-1",
        payableAmountCents: 100n
      },
      data: {
        payableAmountCents: 0n
      }
    });
  });

  it("replays the original deduction without decrementing the account twice", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "account-1",
          openingCents: 150n,
          balanceCents: 50n,
          revision: 2
        }
      ]),
      contractTakeoverBalanceEntry: {
        findUnique: jest.fn().mockResolvedValue({
          id: "entry-1",
          accountId: "account-1",
          amountCents: 100n
        }),
        create: jest.fn()
      },
      contractTakeoverBalanceAccount: {
        updateMany: jest.fn()
      },
      settlement: {
        updateMany: jest.fn()
      }
    };
    const service = new ContractTakeoverBalanceService(audit as never);

    await expect(
      service.deductAdvanceForSettlement(
        tx as never,
        {
          id: "settlement-1",
          contractVersionId: "version-1",
          payableAmountCents: 100n
        },
        "contract-director"
      )
    ).resolves.toMatchObject({
      entryId: "entry-1",
      deductionCents: 100n,
      balanceAfterCents: 50n,
      repeated: true
    });
    expect(tx.contractTakeoverBalanceEntry.create).not.toHaveBeenCalled();
    expect(
      tx.contractTakeoverBalanceAccount.updateMany
    ).not.toHaveBeenCalled();
    expect(tx.settlement.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("appends an exact reversal and restores the locked balance", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          entryId: "entry-1",
          accountId: "account-1",
          entryKind: "deduction",
          amountCents: 80n,
          balanceCents: 20n,
          revision: 2,
          settlementId: "settlement-1",
          settlementPayableAmountCents: 20n
        }
      ]),
      contractTakeoverBalanceEntry: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "reversal-1",
          amountCents: 80n
        })
      },
      contractTakeoverBalanceAccount: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      },
      settlement: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 })
      }
    };
    const service = new ContractTakeoverBalanceService(audit as never);

    await expect(
      service.reverseEntryInTransaction(
        tx as never,
        "entry-1",
        "contract-director",
        "reversal-key-1"
      )
    ).resolves.toEqual({
      accountId: "account-1",
      entryId: "reversal-1",
      reversesEntryId: "entry-1",
      reversedAmountCents: 80n,
      balanceBeforeCents: 20n,
      balanceAfterCents: 100n,
      repeated: false
    });
    expect(tx.contractTakeoverBalanceEntry.create).toHaveBeenCalledWith({
      data: {
        accountId: "account-1",
        entryKind: "reversal",
        amountCents: 80n,
        reversesEntryId: "entry-1",
        idempotencyKey: "reversal-key-1",
        createdByUserId: "contract-director"
      },
      select: { id: true, amountCents: true }
    });
    expect(tx.settlement.updateMany).toHaveBeenCalledWith({
      where: {
        id: "settlement-1",
        payableAmountCents: 20n
      },
      data: {
        payableAmountCents: 100n
      }
    });
  });

  it("blocks payment while a locked abnormal-overpay account remains positive", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "account-abnormal",
          takeoverId: "takeover-1",
          balanceCents: 1n
        }
      ])
    };
    const service = new ContractTakeoverBalanceService(audit as never);

    await expect(
      service.assertNoAbnormalOverpayForContract(
        tx as never,
        "contract-1",
        "登记实付"
      )
    ).rejects.toThrow(
      "历史接管存在尚未解除的异常超付，不能登记实付"
    );
  });

  it("allows payment only after the locked abnormal-overpay balance reaches zero", async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: "account-abnormal",
          takeoverId: "takeover-1",
          balanceCents: 0n
        }
      ])
    };
    const service = new ContractTakeoverBalanceService(audit as never);

    await expect(
      service.assertNoAbnormalOverpayForContract(
        tx as never,
        "contract-1",
        "发起付款申请"
      )
    ).resolves.toBeUndefined();
  });
});
