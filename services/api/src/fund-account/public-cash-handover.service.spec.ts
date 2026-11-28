import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuditService } from "../audit/audit.service";
import type { PrismaService } from "../database/prisma.service";
import { PublicCashHandoverService } from "./public-cash-handover.service";

const input = { idempotencyKey: "759d4ecd-04c9-4c35-972d-7e19714d1592", receivedYuan: "19.9001" };

function fixture(accountRevision = 5, actorRole = "comprehensive_director", priorReceipt?: unknown) {
  const started = { id: "handover", accountId: "cash", fromCustodianId: "previous",
    toCustodianId: "next", startedByUserId: "previous", startedRevision: 5,
    deliveredYuan: new Prisma.Decimal("20.0001"), expectedBalanceYuan: new Prisma.Decimal("21.0001") };
  const receipt = jest.fn();
  const switchCustodian = jest.fn(async () => ({ count: 1 }));
  const custody = jest.fn(async () => ({ count: 1 }));
  const audit = { record: jest.fn() };
  const tx = {
    $queryRaw: async () => [{ id: "cash" }],
    user: { findUnique: async () => ({ isActive: true }) },
    userPosition: { findMany: async () => [{ positionId: actorRole }] },
    position: { findMany: async () => [{ id: actorRole, key: actorRole }] },
    registeredFundAccount: {
      findUnique: async () => ({ id: "cash", publicCashCustody: { currentCustodianId: "previous" }, writeRevision: accountRevision }),
      updateMany: switchCustodian
    },
    publicCashCustody: { updateMany: custody },
    publicCashHandover: { findUnique: async () => started },
    publicCashHandoverReceipt: { findUnique: jest.fn(async () => priorReceipt ?? null), create: receipt }
  };
  const prisma = { $transaction: async <T>(operation: (client: typeof tx) => Promise<T>) => operation(tx) };
  return { service: new PublicCashHandoverService(prisma as unknown as PrismaService, audit as unknown as AuditService),
    receipt, switchCustodian, custody, audit };
}

it("keeps the exact cash-count difference and only switches the custodian", async () => {
  const f = fixture();
  await expect(f.service.confirm("next", "handover", input)).resolves.toMatchObject({
    id: "handover", amountReceivedYuan: "19.9001", discrepancyYuan: "-1.1000", status: "awaiting_reconciliation"
  });
  expect(f.switchCustodian).toHaveBeenCalledWith({
    where: { id: "cash", writeRevision: 5 },
    data: { writeRevision: { increment: 1 } }
  });
  expect(f.custody).toHaveBeenCalledWith({
    where: { accountId: "cash", currentCustodianId: "previous" },
    data: { currentCustodianId: "next" }
  });
  expect(f.receipt).toHaveBeenCalledTimes(1);
  expect(f.audit.record).toHaveBeenCalledTimes(1);
});

it("prevents a concurrent cash write from being covered by a stale handover", async () => {
  const f = fixture(6);
  await expect(f.service.confirm("next", "handover", input)).rejects.toHaveProperty("status", 409);
  expect(f.switchCustodian).not.toHaveBeenCalled();
  expect(f.receipt).not.toHaveBeenCalled();
});

it("does not let another active supervisor confirm for the named successor", async () => {
  const f = fixture();
  await expect(f.service.confirm("other", "handover", input)).rejects.toHaveProperty("status", 403);
  expect(f.switchCustodian).not.toHaveBeenCalled();
  expect(f.receipt).not.toHaveBeenCalled();
});


it("returns the same committed handover on replay even after later money movements", async () => {
  const prior = { handoverId: "handover", confirmedByUserId: "next",
    payloadFingerprint: createHash("sha256").update(JSON.stringify({ actorId: "next", handoverId: "handover", amountReceivedYuan: "19.9001" })).digest("hex"),
    amountReceivedYuan: new Prisma.Decimal("19.9001"), discrepancyYuan: new Prisma.Decimal("-1.1000") };
  const f = fixture(9, "comprehensive_director", prior);
  await expect(f.service.confirm("next", "handover", input)).resolves.toMatchObject({ id: "handover", discrepancyYuan: "-1.1000" });
  await expect(f.service.confirm("next", "handover", { ...input, receivedYuan: "20" })).rejects.toHaveProperty("status", 409);
  expect(f.custody).not.toHaveBeenCalled();
  expect(f.receipt).not.toHaveBeenCalled();
});

describe("finance starts handover for a disabled custodian", () => {
  const start = { idempotencyKey: "759d4ecd-04c9-4c35-972d-7e19714d1593", expectedRevision: 1,
    toCustodianId: "next", deliveredYuan: "5.0001", evidenceReference: "虚构盘点" };
  function startingFixture(departed: boolean, nextRole: string) {
    const update = jest.fn(async () => ({ count: 1 }));
    const create = jest.fn(async ({ data }) => ({ id: "start", ...data, deliveredYuan: new Prisma.Decimal(data.deliveredYuan) }));
    const tx = {
      $queryRaw: async () => [{ id: "cash" }],
      user: { findUnique: async ({ where }: { where: { id: string } }) => ({ isActive: where.id !== "previous" || !departed }) },
      userPosition: { findMany: async ({ where }: { where: { userId: string } }) =>
        [{ positionId: where.userId === "finance" ? "finance_staff" : nextRole }] },
      position: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map(id => ({ id, key: id })) },
      registeredFundAccount: { findUnique: async () => ({ id: "cash", publicCashCustody: { currentCustodianId: "previous" }, writeRevision: 1 }), updateMany: update },
      fundAccountBalanceRegistration: { findFirst: async () => null },
      publicCashHandover: { findUnique: async () => null, create }
    };
    const prisma = { $transaction: async <T>(operation: (client: typeof tx) => Promise<T>) => operation(tx) };
    const audit = { record: jest.fn() };
    return { service: new PublicCashHandoverService(prisma as unknown as PrismaService, audit as unknown as AuditService),
      create, update, audit };
  }

  it("records the disabled previous custodian, finance initiator and unknown ledger separately", async () => {
    const f = startingFixture(true, "comprehensive_director");
    await expect(f.service.start("finance", start)).resolves.toMatchObject({
      id: "start", fromCustodianId: "previous", toCustodianId: "next", expectedBalanceYuan: null, deliveredYuan: "5.0001"
    });
    expect(f.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      startedByUserId: "finance", fromCustodianId: "previous", startedRevision: 2
    }) }));
  });

  it("keeps finance from taking over an active custodian and rejects an ineligible successor", async () => {
    const active = startingFixture(false, "comprehensive_director");
    await expect(active.service.start("finance", start)).rejects.toHaveProperty("status", 403);
    expect(active.create).not.toHaveBeenCalled();
    const revoked = startingFixture(true, "finance_director");
    await expect(revoked.service.start("finance", start)).rejects.toHaveProperty("status", 403);
    expect(revoked.create).not.toHaveBeenCalled();
  });
});
