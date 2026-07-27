import { SettlementRecoveryService } from "./settlement-recovery.service";

const audit = { record: jest.fn() };
const auth = { confirmPassword: jest.fn() };
const files = { assertCanAttachUnlinkedFile: jest.fn() };

function balance(overrides: Record<string, unknown> = {}) {
  return {
    id: "balance-1", settlementId: "settlement-1", projectId: "project-1", contractId: "contract-1",
    originalAmountCents: 1_000n, resolvedAmountCents: 0n, outstandingAmountCents: 1_000n,
    status: "open", revision: 1, ...overrides
  };
}

function context(currentBalance = balance()) {
  const tx = {
    $queryRaw: jest.fn(),
    settlementRecoveryBalance: { findUnique: jest.fn().mockResolvedValue(currentBalance), create: jest.fn(), update: jest.fn() },
    settlementRecoveryEntry: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn(), create: jest.fn() },
    projectMember: { findFirst: jest.fn().mockResolvedValue({ id: "member-1" }) },
    paymentRequest: { findUnique: jest.fn() }
  };
  const prisma = { $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)) };
  return { tx, service: new SettlementRecoveryService(prisma as never, audit as never, auth as never, files as never) };
}

describe("SettlementRecoveryService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("creates a positive recovery balance once for an effective negative settlement", async () => {
    const { tx, service } = context();
    tx.settlementRecoveryBalance.findUnique.mockResolvedValueOnce(null);
    tx.settlementRecoveryBalance.create.mockResolvedValue(balance());

    await service.ensureBalanceForEffectiveSettlement(tx as never, {
      id: "settlement-1", projectId: "project-1", contractId: "contract-1", amountCents: -1_000n
    }, "contract-director-1");

    expect(tx.settlementRecoveryBalance.create).toHaveBeenCalledWith({ data: expect.objectContaining({ originalAmountCents: 1_000n, outstandingAmountCents: 1_000n }) });
  });

  it("rejects a recovery amount beyond the locked outstanding balance", async () => {
    const { service } = context();
    await expect(service.record("settlement-1", "finance-1", {
      entryType: "refund", amountCents: "1001", occurredOn: "2026-07-27", evidenceFileId: "file-1",
      reason: "退款到账", idempotencyKey: "recovery-1", confirmationPassword: "confirmed"
    })).rejects.toThrow("回收金额超过待处理余额");
  });

  it("records a partial refund with a new balance revision", async () => {
    const { tx, service } = context();
    tx.settlementRecoveryEntry.create.mockResolvedValue({ id: "entry-1", evidenceFileId: "file-1" });
    tx.settlementRecoveryBalance.update.mockResolvedValue(balance({ resolvedAmountCents: 400n, outstandingAmountCents: 600n, status: "partially_resolved", revision: 2 }));

    await service.record("settlement-1", "finance-1", {
      entryType: "refund", amountCents: "400", occurredOn: "2026-07-27", evidenceFileId: "file-1",
      reason: "退款到账", idempotencyKey: "recovery-2", confirmationPassword: "confirmed"
    });

    expect(tx.settlementRecoveryBalance.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ resolvedAmountCents: 400n, outstandingAmountCents: 600n, status: "partially_resolved" })
    }));
  });

  it("reverses a recorded refund instead of deleting its historical fact", async () => {
    const { tx, service } = context(balance({
      resolvedAmountCents: 400n,
      outstandingAmountCents: 600n,
      status: "partially_resolved",
      revision: 2
    }));
    tx.settlementRecoveryEntry.findFirst
      .mockResolvedValueOnce({ id: "entry-1", balanceId: "balance-1", entryType: "refund", amountCents: 400n })
      .mockResolvedValueOnce(null);
    tx.settlementRecoveryEntry.create.mockResolvedValue({ id: "reversal-1", evidenceFileId: "file-reversal" });
    tx.settlementRecoveryBalance.update.mockResolvedValue(balance({ revision: 3 }));

    await service.reverse("settlement-1", "entry-1", "finance-1", {
      reason: "原退款登记有误",
      evidenceFileId: "file-reversal",
      idempotencyKey: "reversal-1",
      confirmationPassword: "confirmed"
    });

    expect(tx.settlementRecoveryEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entryType: "reversal",
        amountCents: 400n,
        reversalOfEntryId: "entry-1"
      })
    });
    expect(tx.settlementRecoveryBalance.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        resolvedAmountCents: 0n,
        outstandingAmountCents: 1_000n,
        status: "open"
      })
    }));
  });
});
