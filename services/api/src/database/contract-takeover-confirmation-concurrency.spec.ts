import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { ContractTakeoverService } from "../contract-takeover/contract-takeover.service";

const TEST_DATABASE = "jiangkong_contract_takeover_task1_20260729";

export function contractTakeoverConfirmationDatabaseUrl(
  value: string | undefined
) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error("历史接管确认并发测试必须连接非生产专用数据库");
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.pathname !== `/${TEST_DATABASE}`
  ) {
    throw new Error("历史接管确认并发测试拒绝非本机专用数据库");
  }
  return url.toString();
}

describe("historical takeover confirmation PostgreSQL concurrency", () => {
  it("rejects a non-local or wrong database target", () => {
    expect(() =>
      contractTakeoverConfirmationDatabaseUrl(
        "postgresql://user:pass@example.com/production"
      )
    ).toThrow("历史接管确认并发测试拒绝非本机专用数据库");
  });

  const integrationTest =
    process.env.RUN_CONTRACT_TAKEOVER_CONFIRMATION_CONCURRENCY === "1"
      ? it
      : it.skip;

  integrationTest(
    "serializes dual confirmation and races activation against a contract basis change",
    async () => {
      const databaseUrl = contractTakeoverConfirmationDatabaseUrl(
        process.env.CONTRACT_TAKEOVER_CONFIRMATION_DATABASE_URL
      );
      const schema = `takeover_confirmation_${randomUUID().replace(/-/gu, "")}`;
      const admin = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const isolatedUrl = new URL(databaseUrl);
      isolatedUrl.searchParams.set("schema", schema);
      const first = new PrismaClient({
        datasources: { db: { url: isolatedUrl.toString() } }
      });
      const second = new PrismaClient({
        datasources: { db: { url: isolatedUrl.toString() } }
      });
      const activationCalls: string[] = [];
      const auth = {
        confirmPassword: jest.fn().mockResolvedValue({ ok: true })
      };
      const audit = {
        record: async (
          tx: Prisma.TransactionClient,
          input: { action: string }
        ) => {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO "AuditLog" ("id", "action")
            VALUES (${randomUUID()}, ${input.action})
          `);
        }
      };
      const service = (client: PrismaClient) => {
        const instance = new ContractTakeoverService(
          client as never,
          audit as never,
          auth as never
        );
        (
          instance as unknown as {
            tryActivateInTransaction: (
              tx: Prisma.TransactionClient,
              takeover: { id: string },
              contractFacts: {
                revision: number;
                confirmedRevision: number | null;
                financeBasisRevision: number;
              },
              financeFacts: {
                revision: number;
                confirmedRevision: number | null;
                confirmedFinanceBasisRevision: number | null;
              } | null,
              actorUserId: string,
              idempotencyKey: string
            ) => Promise<{
              activated: boolean;
              activationStatus:
                | "awaiting_contract_confirmation"
                | "awaiting_finance_confirmation"
                | "activated";
            }>;
          }
        ).tryActivateInTransaction = async (
          tx,
          takeover,
          contractFacts,
          financeFacts,
          actorUserId,
          idempotencyKey
        ) => {
          if (contractFacts.confirmedRevision !== contractFacts.revision) {
            return {
              activated: false,
              activationStatus: "awaiting_contract_confirmation"
            };
          }
          if (
            !financeFacts ||
            financeFacts.confirmedRevision !== financeFacts.revision
          ) {
            return {
              activated: false,
              activationStatus: "awaiting_finance_confirmation"
            };
          }
          if (
            financeFacts.confirmedFinanceBasisRevision !==
            contractFacts.financeBasisRevision
          ) {
            throw new Error("finance basis mismatch");
          }
          const activated = await tx.$executeRaw(Prisma.sql`
            UPDATE "ContractTakeover"
            SET "activatedAt" = NOW(),
                "activatedByUserId" = ${actorUserId},
                "activationIdempotencyKey" = ${idempotencyKey}
            WHERE "id" = ${takeover.id}
              AND "activatedAt" IS NULL
          `);
          if (activated === 1) activationCalls.push(idempotencyKey);
          return { activated: true, activationStatus: "activated" };
        };
        return instance;
      };

      try {
        await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await createMinimalSchema(first);
        await seedConfirmationFacts(first);

        const contractInput = {
          idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          expectedRevision: 3,
          currentPassword: "not-a-real-password"
        };
        const financeInput = {
          idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          expectedRevision: 2,
          currentPassword: "not-a-real-password",
          basedOnContractRevision: 3,
          basedOnFinanceBasisRevision: 4
        };
        const contractService = service(first);
        const financeService = service(second);
        const concurrent = await Promise.allSettled([
          contractService.confirmContractSide(
            "project-1",
            "takeover-1",
            contractInput,
            "contract-director"
          ),
          financeService.confirmFinanceSide(
            "project-1",
            "takeover-1",
            financeInput,
            "finance-director"
          )
        ]);
        if (concurrent[0].status === "rejected") {
          await contractService.confirmContractSide(
            "project-1",
            "takeover-1",
            contractInput,
            "contract-director"
          );
        }
        if (concurrent[1].status === "rejected") {
          await financeService.confirmFinanceSide(
            "project-1",
            "takeover-1",
            financeInput,
            "finance-director"
          );
        }

        expect(await first.$queryRaw<Array<{
          contractConfirmed: number | null;
          financeConfirmed: number | null;
          activatedAt: Date | null;
        }>>(Prisma.sql`
          SELECT
            contract_facts."confirmedRevision" AS "contractConfirmed",
            finance_facts."confirmedRevision" AS "financeConfirmed",
            takeover."activatedAt" AS "activatedAt"
          FROM "ContractTakeover" takeover
          JOIN "ContractTakeoverContractFacts" contract_facts
            ON contract_facts."takeoverId" = takeover."id"
          JOIN "ContractTakeoverFinanceFacts" finance_facts
            ON finance_facts."takeoverId" = takeover."id"
          WHERE takeover."id" = 'takeover-1'
        `)).toEqual([{
          contractConfirmed: 3,
          financeConfirmed: 2,
          activatedAt: expect.any(Date)
        }]);
        expect(activationCalls).toHaveLength(1);
        expect(await first.contractTakeoverConfirmationEvent.count()).toBe(2);
        expect(await first.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
          SELECT COUNT(*) AS "count" FROM "AuditLog"
        `)).toEqual([{ count: 2n }]);

        await resetForBasisRace(first);
        activationCalls.length = 0;
        const financeConfirmation = service(first).confirmFinanceSide(
          "project-1",
          "takeover-1",
          {
            ...financeInput,
            idempotencyKey: "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
          },
          "finance-director"
        );
        const basisChange = changeContractFinanceBasis(second);
        const race = await Promise.allSettled([
          financeConfirmation,
          basisChange
        ]);
        const confirmationWon = race[0].status === "fulfilled";
        const basisWon =
          race[1].status === "fulfilled" && race[1].value === true;
        expect(Number(confirmationWon) + Number(basisWon)).toBe(1);
        const [finalState] = await first.$queryRaw<Array<{
          activatedAt: Date | null;
          revision: number;
          financeBasisRevision: number;
        }>>(Prisma.sql`
          SELECT takeover."activatedAt" AS "activatedAt",
                 facts."revision" AS "revision",
                 facts."financeBasisRevision" AS "financeBasisRevision"
          FROM "ContractTakeover" takeover
          JOIN "ContractTakeoverContractFacts" facts
            ON facts."takeoverId" = takeover."id"
          WHERE takeover."id" = 'takeover-1'
        `);
        if (confirmationWon) {
          expect(finalState).toMatchObject({
            activatedAt: expect.any(Date),
            revision: 3,
            financeBasisRevision: 4
          });
          expect(activationCalls).toHaveLength(1);
        } else {
          expect(finalState).toEqual({
            activatedAt: null,
            revision: 4,
            financeBasisRevision: 5
          });
          expect(activationCalls).toHaveLength(0);
        }
      } finally {
        await Promise.allSettled([first.$disconnect(), second.$disconnect()]);
        await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.$disconnect();
      }
    },
    30_000
  );
});

async function createMinimalSchema(client: PrismaClient) {
  await executeSqlBatch(client, `
    CREATE TABLE "ContractTakeover" (
      "id" TEXT PRIMARY KEY,
      "projectId" TEXT NOT NULL,
      "contractId" TEXT NOT NULL,
      "contractVersionId" TEXT NOT NULL,
      "paymentTermsVersionId" TEXT NOT NULL,
      "activatedAt" TIMESTAMPTZ,
      "activatedByUserId" TEXT,
      "activationIdempotencyKey" TEXT
    );
    CREATE TABLE "ContractTakeoverContractFacts" (
      "takeoverId" TEXT PRIMARY KEY,
      "revision" INTEGER NOT NULL,
      "financeBasisRevision" INTEGER NOT NULL,
      "confirmedRevision" INTEGER,
      "confirmedByUserId" TEXT,
      "confirmedAt" TIMESTAMPTZ,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE "ContractTakeoverFinanceFacts" (
      "takeoverId" TEXT PRIMARY KEY,
      "revision" INTEGER NOT NULL,
      "basedOnContractRevision" INTEGER NOT NULL,
      "basedOnFinanceBasisRevision" INTEGER NOT NULL,
      "confirmedRevision" INTEGER,
      "confirmedContractRevision" INTEGER,
      "confirmedFinanceBasisRevision" INTEGER,
      "confirmedByUserId" TEXT,
      "confirmedAt" TIMESTAMPTZ,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE "ContractTakeoverHistoricalPayment" (
      "id" TEXT PRIMARY KEY,
      "takeoverId" TEXT NOT NULL,
      "rowKey" TEXT NOT NULL,
      "status" TEXT NOT NULL
    );
    CREATE TABLE "ContractTakeoverHistoricalPaymentVoucher" (
      "id" TEXT PRIMARY KEY,
      "historicalPaymentId" TEXT NOT NULL,
      "fileId" TEXT NOT NULL
    );
    CREATE TABLE "Contract" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "ContractVersion" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "PaymentTermsVersion" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "Position" ("id" TEXT PRIMARY KEY, "key" TEXT NOT NULL);
    CREATE TABLE "UserPosition" (
      "id" TEXT PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "positionId" TEXT NOT NULL,
      "projectId" TEXT
    );
    CREATE TABLE "ProjectMember" (
      "id" TEXT PRIMARY KEY,
      "projectId" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "positionKey" TEXT NOT NULL
    );
    CREATE TABLE "ContractTakeoverConfirmationEvent" (
      "id" TEXT PRIMARY KEY DEFAULT md5(random()::text || clock_timestamp()::text),
      "idempotencyKey" TEXT NOT NULL UNIQUE,
      "takeoverId" TEXT NOT NULL,
      "side" TEXT NOT NULL,
      "action" TEXT NOT NULL,
      "revision" INTEGER NOT NULL,
      "observedOtherSideRevision" INTEGER,
      "observedFinanceBasisRevision" INTEGER,
      "reason" TEXT,
      "actorUserId" TEXT NOT NULL,
      "responseSnapshot" JSONB,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE "AuditLog" ("id" TEXT PRIMARY KEY, "action" TEXT NOT NULL);
  `);
}

async function seedConfirmationFacts(client: PrismaClient) {
  await executeSqlBatch(client, `
    INSERT INTO "Contract" VALUES ('contract-1');
    INSERT INTO "ContractVersion" VALUES ('contract-version-1');
    INSERT INTO "PaymentTermsVersion" VALUES ('terms-version-1');
    INSERT INTO "ContractTakeover" (
      "id", "projectId", "contractId", "contractVersionId",
      "paymentTermsVersionId"
    ) VALUES (
      'takeover-1', 'project-1', 'contract-1', 'contract-version-1',
      'terms-version-1'
    );
    INSERT INTO "ContractTakeoverContractFacts" (
      "takeoverId", "revision", "financeBasisRevision",
      "confirmedRevision", "confirmedByUserId", "confirmedAt"
    ) VALUES ('takeover-1', 3, 4, NULL, NULL, NULL);
    INSERT INTO "ContractTakeoverFinanceFacts" (
      "takeoverId", "revision", "basedOnContractRevision",
      "basedOnFinanceBasisRevision", "confirmedRevision",
      "confirmedContractRevision", "confirmedFinanceBasisRevision",
      "confirmedByUserId", "confirmedAt"
    ) VALUES ('takeover-1', 2, 3, 4, NULL, NULL, NULL, NULL, NULL);
    INSERT INTO "Position" VALUES
      ('position-contract', 'contract_director'),
      ('position-finance', 'finance_director');
    INSERT INTO "UserPosition" VALUES
      ('up-contract', 'contract-director', 'position-contract', NULL),
      ('up-finance', 'finance-director', 'position-finance', NULL);
  `);
}

async function resetForBasisRace(client: PrismaClient) {
  await executeSqlBatch(client, `
    UPDATE "ContractTakeover"
    SET "activatedAt" = NULL,
        "activatedByUserId" = NULL,
        "activationIdempotencyKey" = NULL;
    UPDATE "ContractTakeoverContractFacts"
    SET "revision" = 3,
        "financeBasisRevision" = 4,
        "confirmedRevision" = 3,
        "confirmedByUserId" = 'contract-director',
        "confirmedAt" = NOW();
    UPDATE "ContractTakeoverFinanceFacts"
    SET "revision" = 2,
        "basedOnContractRevision" = 3,
        "basedOnFinanceBasisRevision" = 4,
        "confirmedRevision" = NULL,
        "confirmedContractRevision" = NULL,
        "confirmedFinanceBasisRevision" = NULL,
        "confirmedByUserId" = NULL,
        "confirmedAt" = NULL;
    TRUNCATE "ContractTakeoverConfirmationEvent", "AuditLog";
  `);
}

async function executeSqlBatch(client: PrismaClient, sql: string) {
  for (const statement of sql.split(";").map((item) => item.trim()).filter(Boolean)) {
    await client.$executeRawUnsafe(statement);
  }
}

async function changeContractFinanceBasis(client: PrismaClient) {
  return client.$transaction(async (tx) => {
    const [takeover] = await tx.$queryRaw<Array<{
      id: string;
      activatedAt: Date | null;
    }>>(Prisma.sql`
      SELECT "id", "activatedAt"
      FROM "ContractTakeover"
      WHERE "id" = 'takeover-1'
      FOR UPDATE
    `);
    if (takeover.activatedAt) return false;
    await tx.$queryRaw(Prisma.sql`
      SELECT "takeoverId"
      FROM "ContractTakeoverContractFacts"
      WHERE "takeoverId" = 'takeover-1'
      FOR UPDATE
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT "takeoverId"
      FROM "ContractTakeoverFinanceFacts"
      WHERE "takeoverId" = 'takeover-1'
      FOR UPDATE
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "ContractTakeoverHistoricalPayment"
      WHERE "takeoverId" = 'takeover-1'
      ORDER BY "id"
      FOR UPDATE
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT voucher."id"
      FROM "ContractTakeoverHistoricalPaymentVoucher" voucher
      JOIN "ContractTakeoverHistoricalPayment" payment
        ON payment."id" = voucher."historicalPaymentId"
      WHERE payment."takeoverId" = 'takeover-1'
      ORDER BY voucher."fileId"
      FOR UPDATE OF voucher
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "Contract" WHERE "id" = 'contract-1' FOR UPDATE
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "ContractVersion"
      WHERE "id" = 'contract-version-1' FOR UPDATE
    `);
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "PaymentTermsVersion"
      WHERE "id" = 'terms-version-1' FOR UPDATE
    `);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "ContractTakeoverContractFacts"
      SET "revision" = 4,
          "financeBasisRevision" = 5,
          "confirmedRevision" = NULL,
          "confirmedByUserId" = NULL,
          "confirmedAt" = NULL
      WHERE "takeoverId" = 'takeover-1'
    `);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "ContractTakeoverFinanceFacts"
      SET "confirmedRevision" = NULL,
          "confirmedContractRevision" = NULL,
          "confirmedFinanceBasisRevision" = NULL,
          "confirmedByUserId" = NULL,
          "confirmedAt" = NULL
      WHERE "takeoverId" = 'takeover-1'
    `);
    return true;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable
  });
}
