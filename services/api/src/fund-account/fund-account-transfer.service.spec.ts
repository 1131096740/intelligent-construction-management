import { Prisma } from "@prisma/client";
import type { AuditService } from "../audit/audit.service";
import type { PrismaService } from "../database/prisma.service";
import { FundAccountTransferService } from "./fund-account-transfer.service";

const registration = {
  sourceScopeKey: "public_cash",
  destinationScopeKey: "company:company-a",
  expectedRegistrationId: "10561000-0000-4000-8000-000000000001",
  idempotencyKey: "10561000-0000-4000-8000-000000000002",
  transferredOn: "2026-11-01",
  evidenceReference: "虚构现金转款依据",
  lines: [{ sourceBatchId: "10561000-0000-4000-8000-000000000003", amountYuan: "30.0001" }]
};

function transferService(role: string, firstConflict = false, activeCompany = false, originalRegistrationExists = false) {
  const receipt = jest.fn();
  const transferUpdate = jest.fn();
  const tx = {
    user: { findUnique: async () => ({ isActive: !firstConflict }) },
    userPosition: { findMany: async () => [{ positionId: role }] },
    position: { findMany: async () => [{ id: role, key: role }] },
    registeredFundAccount: { findUnique: async ({ where }: { where: { scopeKey: string } }) =>
      where.scopeKey === "public_cash" ? { id: "cash", kind: "public_cash", companyEntityId: null } : { id: "company", kind: "company", companyEntityId: "company-a" },
      update: jest.fn() },
    companyEntity: { findUnique: async () => ({ isActive: activeCompany }) },
    fundAccountBalanceRegistration: { findFirst: async ({ select }: { select?: { id: true } }) => select
      ? (originalRegistrationExists ? { id: registration.expectedRegistrationId } : null)
      : { id: "new-current", version: 2, balanceYuan: new Prisma.Decimal(100) } },
    $queryRaw: async () => [{ id: "cash" }, { id: "company" }],
    registeredFundTransferAction: { findUnique: receipt },
    registeredFundTransfer: {
      findUnique: async () => ({ revision: 2, sourceAccountId: "cash", destinationAccountId: "company", createdByUserId: "origin", sourceAccount: { kind: "public_cash" }, destinationAccount: { kind: "company" } }),
      updateMany: transferUpdate
    }
  };
  let calls = 0;
  const prisma = { $transaction: async <T>(run: (client: typeof tx) => Promise<T>) => {
    calls++;
    if (firstConflict && calls === 1) throw new Prisma.PrismaClientKnownRequestError("synthetic conflict", { code: "P2034", clientVersion: "test" });
    return run(tx);
  } };
  return { service: new FundAccountTransferService(prisma as unknown as PrismaService, {} as AuditService), receipt, transferUpdate, transactionCount: () => calls };
}

it("does not expose a committed registration receipt after the original actor loses the company role", async () => {
  const { service, receipt, transactionCount } = transferService("comprehensive_director", true);
  await expect(service.register("origin", registration)).rejects.toHaveProperty("status", 403);
  expect(transactionCount()).toBe(2);
  expect(receipt).not.toHaveBeenCalled();
});

it("rechecks the recipient role in a fresh confirmation replay transaction", async () => {
  const { service, receipt, transferUpdate, transactionCount } = transferService("finance_staff", true);
  await expect(service.act("recipient", "transfer", {
    idempotencyKey: registration.idempotencyKey, expectedRevision: 1, action: "confirm", evidenceReference: "独立实收"
  })).rejects.toHaveProperty("status", 403);
  expect(transactionCount()).toBe(2);
  expect(receipt).not.toHaveBeenCalled();
  expect(transferUpdate).not.toHaveBeenCalled();
});

it("rejects a new transfer into an inactive company", async () => {
  const { service, receipt } = transferService("comprehensive_director");
  await expect(service.register("origin", registration)).rejects.toThrow("所选公司已停用");
  expect(receipt).toHaveBeenCalledTimes(1);
});

it("does not mark an unrecognized source registration as superseded", async () => {
  const { service, receipt } = transferService("comprehensive_director", false, true);
  await expect(service.register("origin", registration)).rejects.toMatchObject({
    response: { statusCode: 409, code: "FUND_ACCOUNT_TRANSFER_REJECTED_NO_WRITE" }
  });
  expect(receipt).toHaveBeenCalledTimes(1);
});

it("proves an older confirmed source registration is superseded", async () => {
  const { service, receipt } = transferService("comprehensive_director", false, true, true);
  await expect(service.register("origin", registration)).rejects.toMatchObject({
    response: { statusCode: 409, code: "FUND_ACCOUNT_TRANSFER_COMMAND_SUPERSEDED" }
  });
  expect(receipt).toHaveBeenCalledTimes(1);
});

it("proves a stale receipt decision is superseded", async () => {
  const { service, receipt, transferUpdate } = transferService("finance_staff");
  await expect(service.act("recipient", "transfer", {
    idempotencyKey: registration.idempotencyKey, expectedRevision: 1, action: "confirm", evidenceReference: "独立实收"
  })).rejects.toMatchObject({
    response: { statusCode: 409, code: "FUND_ACCOUNT_TRANSFER_COMMAND_SUPERSEDED" }
  });
  expect(receipt).toHaveBeenCalledTimes(1);
  expect(transferUpdate).not.toHaveBeenCalled();
});

it("does not mark a key collision with an existing receipt as a definite rejection", async () => {
  const { service, receipt } = transferService("comprehensive_director", false, true);
  receipt.mockResolvedValue({ actorUserId: "origin", payloadFingerprint: "0".repeat(64) });
  await expect(service.register("origin", registration)).rejects.toMatchObject({
    response: { statusCode: 409, error: "Conflict" }
  });
});
