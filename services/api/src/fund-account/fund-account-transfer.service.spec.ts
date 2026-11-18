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

function transferService(role: string, firstConflict = false) {
  const receipt = jest.fn();
  const transferUpdate = jest.fn();
  const tx = {
    user: { findUnique: async () => ({ isActive: !firstConflict }) },
    userPosition: { findMany: async () => [{ positionId: role }] },
    position: { findMany: async () => [{ id: role, key: role }] },
    registeredFundAccount: { findUnique: async ({ where }: { where: { scopeKey: string } }) =>
      where.scopeKey === "public_cash" ? { kind: "public_cash", companyEntityId: null } : { kind: "company", companyEntityId: "company-a" } },
    companyEntity: { findUnique: async () => ({ isActive: false }) },
    registeredFundTransferAction: { findUnique: receipt },
    registeredFundTransfer: {
      findUnique: async () => ({ createdByUserId: "origin", sourceAccount: { kind: "public_cash" }, destinationAccount: { kind: "company" } }),
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
