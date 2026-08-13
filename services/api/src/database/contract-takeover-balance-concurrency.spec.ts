import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { ContractTakeoverBalanceService } from "../contract-takeover/contract-takeover-balance.service";

const TEST_DATABASE = "jiangkong_contract_takeover_task1_20260729";

export function contractTakeoverBalanceDatabaseUrl(
  value: string | undefined
) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error("历史接管余额并发测试必须连接非生产专用数据库");
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.pathname !== `/${TEST_DATABASE}`
  ) {
    throw new Error("历史接管余额并发测试拒绝非本机专用数据库");
  }
  return url.toString();
}

describe("historical takeover balance PostgreSQL concurrency", () => {
  it("rejects a non-local or wrong database target", () => {
    expect(() =>
      contractTakeoverBalanceDatabaseUrl(
        "postgresql://user:pass@example.com/production"
      )
    ).toThrow("历史接管余额并发测试拒绝非本机专用数据库");
  });

  const integrationTest =
    process.env.RUN_CONTRACT_TAKEOVER_BALANCE_CONCURRENCY === "1"
      ? it
      : it.skip;

  integrationTest(
    "serializes deductions, idempotent replay, reversal and abnormal-payment release",
    async () => {
      const databaseUrl = contractTakeoverBalanceDatabaseUrl(
        process.env.CONTRACT_TAKEOVER_BALANCE_DATABASE_URL
      );
      const first = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const second = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const suffix = randomUUID();
      const ids = {
        actor: `balance-actor-${suffix}`,
        project: `balance-project-${suffix}`,
        contract: `balance-contract-${suffix}`,
        version: `balance-version-${suffix}`,
        terms: `balance-terms-${suffix}`,
        takeover: `balance-takeover-${suffix}`,
        advanceAccount: `balance-advance-account-${suffix}`,
        abnormalAccount: `balance-abnormal-account-${suffix}`,
        settlementA: `balance-settlement-a-${suffix}`,
        settlementB: `balance-settlement-b-${suffix}`,
        settlementC: `balance-settlement-c-${suffix}`,
        settlementD: `balance-settlement-d-${suffix}`
      };
      const balanceService = new ContractTakeoverBalanceService(
        new AuditService()
      );

      try {
        await seedBalanceFacts(first, ids, suffix);

        const firstDeductions = await Promise.allSettled([
          deduct(first, balanceService, ids.settlementA, ids.actor),
          deduct(second, balanceService, ids.settlementB, ids.actor)
        ]);
        const [deductionA, deductionB] = await Promise.all([
          retrySerializable(firstDeductions[0], () =>
            deduct(
              first,
              balanceService,
              ids.settlementA,
              ids.actor
            )
          ),
          retrySerializable(firstDeductions[1], () =>
            deduct(
              second,
              balanceService,
              ids.settlementB,
              ids.actor
            )
          )
        ]);
        expect(
          deductionA!.deductionCents +
            deductionB!.deductionCents
        ).toBe(160n);
        expect(
          await accountBalance(first, ids.advanceAccount)
        ).toBe(140n);

        const sameSettlementRace = await Promise.allSettled([
          deduct(first, balanceService, ids.settlementC, ids.actor),
          deduct(second, balanceService, ids.settlementC, ids.actor)
        ]);
        const sameSettlement = await Promise.all([
          retrySerializable(sameSettlementRace[0], () =>
            deduct(
              first,
              balanceService,
              ids.settlementC,
              ids.actor
            )
          ),
          retrySerializable(sameSettlementRace[1], () =>
            deduct(
              second,
              balanceService,
              ids.settlementC,
              ids.actor
            )
          )
        ]);
        expect(
          sameSettlement.filter((result) => result?.repeated)
        ).toHaveLength(1);
        expect(
          await first.contractTakeoverBalanceEntry.count({
            where: {
              accountId: ids.advanceAccount,
              settlementId: ids.settlementC,
              entryKind: "deduction"
            }
          })
        ).toBe(1);
        expect(
          await accountBalance(first, ids.advanceAccount)
        ).toBe(80n);

        const deductionAEntry =
          await first.contractTakeoverBalanceEntry.findFirstOrThrow({
            where: {
              accountId: ids.advanceAccount,
              settlementId: ids.settlementA,
              entryKind: "deduction"
            },
            select: { id: true }
          });
        const deductionD = () =>
          deduct(
            first,
            balanceService,
            ids.settlementD,
            ids.actor
          );
        const reversalA = () =>
          second.$transaction(
            (tx) =>
              balanceService.reverseEntryInTransaction(
                tx,
                deductionAEntry.id,
                ids.actor,
                `balance-reversal-${suffix}`
              ),
            {
              isolationLevel:
                Prisma.TransactionIsolationLevel.Serializable
            }
          );
        const deductionReversalRace = await Promise.allSettled([
          deductionD(),
          reversalA()
        ]);
        if (deductionReversalRace[0].status === "rejected") {
          expectSerializableRetry(
            deductionReversalRace[0].reason
          );
          await deductionD();
        }
        if (deductionReversalRace[1].status === "rejected") {
          expectSerializableRetry(
            deductionReversalRace[1].reason
          );
          await reversalA();
        }
        const activeDeductions =
          await activeDeductionCents(first, ids.advanceAccount);
        const advanceBalance = await accountBalance(
          first,
          ids.advanceAccount
        );
        expect(advanceBalance).toBe(300n - activeDeductions);
        expect(advanceBalance).toBe(80n);

        const paymentCode = `BAL-PAY-${suffix}`;
        const race = await Promise.allSettled([
          createPaymentBehindAbnormalGuard(
            first,
            balanceService,
            ids,
            paymentCode
          ),
          resolveAbnormalBalance(second, ids)
        ]);
        if (race[1].status === "rejected") {
          expectSerializableRetry(race[1].reason);
          await resolveAbnormalBalance(second, ids);
        }
        const finalAbnormalBalance = await accountBalance(
          first,
          ids.abnormalAccount
        );
        const createdPayments = await first.paymentRequest.count({
          where: { code: paymentCode }
        });
        expect(finalAbnormalBalance).toBe(0n);
        expect(createdPayments).toBeLessThanOrEqual(1);
        if (createdPayments === 1) {
          expect(race[0].status).toBe("fulfilled");
        } else {
          expect(race[0].status).toBe("rejected");
        }
      } finally {
        await Promise.all([
          first.$disconnect(),
          second.$disconnect()
        ]);
      }
    },
    30_000
  );
});

type BalanceIds = {
  actor: string;
  project: string;
  contract: string;
  version: string;
  terms: string;
  takeover: string;
  advanceAccount: string;
  abnormalAccount: string;
  settlementA: string;
  settlementB: string;
  settlementC: string;
  settlementD: string;
};

async function seedBalanceFacts(
  client: PrismaClient,
  ids: BalanceIds,
  suffix: string
) {
  await client.user.create({
    data: {
      id: ids.actor,
      name: "历史余额并发测试用户"
    }
  });
  await client.project.create({
    data: {
      id: ids.project,
      code: `BAL-${suffix}`,
      name: "历史余额并发测试项目"
    }
  });
  await client.projectAffiliateAssignment.create({
    data: {
      id: `balance-construction-enterprise-${suffix}`,
      projectId: ids.project,
      businessPartyId: `balance-party-${suffix}`,
      businessPartyVersionId: `balance-party-version-${suffix}`,
      affiliateNameSnapshot: "历史余额测试施工企业",
      effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
      changeReason: "数据库测试夹具",
      assignedByUserId: ids.actor
    }
  });
  await client.contract.create({
    data: {
      id: ids.contract,
      projectId: ids.project,
      source: "historical_takeover",
      code: `BAL-CONTRACT-${suffix}`,
      name: "历史余额并发测试合同",
      counterparty: "测试供应商",
      contractTypeKey: "generic_contract"
    }
  });
  await client.contractVersion.create({
    data: {
      id: ids.version,
      contractId: ids.contract,
      versionNo: 1,
      changeType: "historical_takeover",
      status: "effective",
      amountCents: 1_000n,
      effectiveAt: new Date(),
      draftData: {},
      templateSnapshot: {},
      clauseSnapshot: {}
    }
  });
  await client.paymentTermsVersion.create({
    data: {
      id: ids.terms,
      contractId: ids.contract,
      contractVersionId: ids.version,
      versionNo: 1,
      status: "effective",
      originalText: "历史余额并发测试条款"
    }
  });
  await client.contractTakeover.create({
    data: {
      id: ids.takeover,
      projectId: ids.project,
      contractId: ids.contract,
      contractVersionId: ids.version,
      paymentTermsVersionId: ids.terms,
      takeoverLevel: "A",
      takeoverStatus: "confirmed",
      lifecycleStatus: "in_progress",
      signedAt: new Date("2026-01-01T00:00:00.000Z"),
      historicalBalanceConfirmedAt: new Date(),
      historicalBalanceConfirmedByUserId: ids.actor,
      confirmedAt: new Date(),
      confirmedByUserId: ids.actor,
      activationIdempotencyKey: `balance-activation-${suffix}`,
      activatedAt: new Date(),
      activatedByUserId: ids.actor,
      createdByUserId: ids.actor
    }
  });
  await client.contractTakeoverBalanceAccount.createMany({
    data: [
      {
        id: ids.advanceAccount,
        takeoverId: ids.takeover,
        balanceType: "historical_advance",
        openingCents: 300n,
        balanceCents: 300n
      },
      {
        id: ids.abnormalAccount,
        takeoverId: ids.takeover,
        balanceType: "abnormal_overpay",
        openingCents: 1n,
        balanceCents: 1n
      }
    ]
  });
  await client.contractTakeoverBalanceEntry.createMany({
    data: [
      {
        accountId: ids.advanceAccount,
        entryKind: "opening",
        amountCents: 300n,
        idempotencyKey: `balance-opening-advance-${suffix}`,
        createdByUserId: ids.actor
      },
      {
        accountId: ids.abnormalAccount,
        entryKind: "opening",
        amountCents: 1n,
        idempotencyKey: `balance-opening-abnormal-${suffix}`,
        createdByUserId: ids.actor
      }
    ]
  });
  await client.settlement.createMany({
    data: [
      [ids.settlementA, 80n, "A"],
      [ids.settlementB, 80n, "B"],
      [ids.settlementC, 60n, "C"],
      [ids.settlementD, 80n, "D"]
    ].map(([id, amountCents, label]) => ({
      id: id as string,
      projectId: ids.project,
      contractId: ids.contract,
      contractVersionId: ids.version,
      paymentTermsVersionId: ids.terms,
      code: `BAL-SETTLEMENT-${label}-${suffix}`,
      periodLabel: `并发${label}`,
      status: "pending_archive_confirm",
      amountCents: amountCents as bigint,
      payableAmountCents: amountCents as bigint
    }))
  });
}

async function deduct(
  client: PrismaClient,
  service: ContractTakeoverBalanceService,
  settlementId: string,
  actorUserId: string
) {
  return client.$transaction(
    async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "Settlement"
        WHERE "id" = ${settlementId}
        FOR UPDATE
      `);
      const settlement =
        await tx.settlement.findUniqueOrThrow({
          where: { id: settlementId },
          select: {
            id: true,
            contractVersionId: true,
            payableAmountCents: true
          }
        });
      return service.deductAdvanceForSettlement(
        tx,
        settlement,
        actorUserId
      );
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel.Serializable
    }
  );
}

async function accountBalance(
  client: PrismaClient,
  accountId: string
) {
  return (
    await client.contractTakeoverBalanceAccount.findUniqueOrThrow({
      where: { id: accountId },
      select: { balanceCents: true }
    })
  ).balanceCents;
}

async function activeDeductionCents(
  client: PrismaClient,
  accountId: string
) {
  const deductions =
    await client.contractTakeoverBalanceEntry.findMany({
      where: { accountId, entryKind: "deduction" },
      select: { id: true, amountCents: true }
    });
  const reversed =
    await client.contractTakeoverBalanceEntry.findMany({
      where: {
        accountId,
        entryKind: "reversal",
        reversesEntryId: {
          in: deductions.map((entry) => entry.id)
        }
      },
      select: { amountCents: true }
    });
  return (
    deductions.reduce(
      (total, entry) => total + entry.amountCents,
      0n
    ) -
    reversed.reduce(
      (total, entry) => total + entry.amountCents,
      0n
    )
  );
}

async function createPaymentBehindAbnormalGuard(
  client: PrismaClient,
  service: ContractTakeoverBalanceService,
  ids: BalanceIds,
  code: string
) {
  return client.$transaction(
    async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "Contract"
        WHERE "id" = ${ids.contract}
        FOR UPDATE
      `);
      await service.assertNoAbnormalOverpayForContract(
        tx,
        ids.contract,
        "发起付款申请"
      );
      return tx.paymentRequest.create({
        data: {
          projectId: ids.project,
          settlementId: null,
          sourceType: "contract_due",
          contractId: ids.contract,
          contractVersionId: ids.version,
          paymentTermsVersionId: ids.terms,
          code,
          status: "approval_pending",
          requestedAmountCents: 1n,
          paidAmountCents: 0n
        }
      });
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel.Serializable
    }
  );
}

async function resolveAbnormalBalance(
  client: PrismaClient,
  ids: BalanceIds
) {
  return client.$transaction(
    async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "Contract"
        WHERE "id" = ${ids.contract}
        FOR UPDATE
      `);
      const [account] = await tx.$queryRaw<
        Array<{ id: string; balanceCents: bigint; revision: number }>
      >(Prisma.sql`
        SELECT
          account."id",
          account."balanceCents",
          account."revision"
        FROM "ContractTakeoverBalanceAccount" account
        WHERE account."id" = ${ids.abnormalAccount}
        FOR UPDATE
      `);
      if (account.balanceCents === 0n) return false;
      await tx.contractTakeoverBalanceEntry.create({
        data: {
          accountId: account.id,
          entryKind: "correction",
          amountCents: account.balanceCents,
          idempotencyKey: `balance-abnormal-resolve-${randomUUID()}`,
          createdByUserId: ids.actor
        }
      });
      await tx.contractTakeoverBalanceAccount.update({
        where: { id: account.id },
        data: {
          balanceCents: 0n,
          revision: { increment: 1 }
        }
      });
      return true;
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel.Serializable
    }
  );
}

function expectSerializableRetry(error: unknown) {
  const candidate = error as {
    code?: string;
    meta?: { code?: string };
    message?: string;
  };
  expect(
    candidate.code === "P2034" ||
      candidate.meta?.code === "40001" ||
      candidate.message?.includes("could not serialize access")
  ).toBe(true);
}

async function retrySerializable<T>(
  result: PromiseSettledResult<T>,
  retry: () => Promise<T>
): Promise<T> {
  if (result.status === "fulfilled") return result.value;
  expectSerializableRetry(result.reason);
  return retry();
}
