import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { ContractTakeoverService } from "../contract-takeover/contract-takeover.service";

describe("historical change baseline database concurrency", () => {
  const integrationTest = process.env.RUN_CONTRACT_CHANGE_BASELINE_CONCURRENCY === "1"
    ? it
    : it.skip;

  integrationTest("uses the production service CAS so two connections confirm exactly once", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || process.env.NODE_ENV === "production") {
      throw new Error("历史基线并发测试必须连接非生产隔离数据库");
    }
    const schema = `change_baseline_${randomUUID().replace(/-/g, "")}`;
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const isolatedUrl = new URL(databaseUrl);
    isolatedUrl.searchParams.set("schema", schema);
    const first = new PrismaClient({ datasources: { db: { url: isolatedUrl.toString() } } });
    const second = new PrismaClient({ datasources: { db: { url: isolatedUrl.toString() } } });
    const auth = { confirmPassword: jest.fn().mockResolvedValue({ ok: true }) };
    const audit = {
      record: async (tx: Prisma.TransactionClient, input: { action: string }) => {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "AuditLog" ("id", "action") VALUES (${randomUUID()}, ${input.action})
        `);
      }
    };

    try {
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await first.$executeRawUnsafe(`CREATE TABLE "Contract" ("id" TEXT PRIMARY KEY)`);
      await first.$executeRawUnsafe(`CREATE TABLE "ContractTakeover" (
        "id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL, "contractId" TEXT NOT NULL,
        "contractVersionId" TEXT NOT NULL, "takeoverStatus" TEXT NOT NULL
      )`);
      await first.$executeRawUnsafe(`CREATE TABLE "ContractVersion" (
        "id" TEXT PRIMARY KEY, "baseVersionId" TEXT, "changeType" TEXT NOT NULL,
        "status" TEXT NOT NULL, "effectiveAt" TIMESTAMPTZ, "pricingNature" TEXT NOT NULL,
        "amountLimitType" TEXT NOT NULL, "originalBaseAmountCents" BIGINT,
        "cumulativeIncreaseCents" BIGINT NOT NULL DEFAULT 0
      )`);
      await first.$executeRawUnsafe(`CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "isActive" BOOLEAN NOT NULL)`);
      await first.$executeRawUnsafe(`CREATE TABLE "Position" ("id" TEXT PRIMARY KEY, "key" TEXT NOT NULL)`);
      await first.$executeRawUnsafe(`CREATE TABLE "UserPosition" (
        "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "positionId" TEXT NOT NULL, "projectId" TEXT
      )`);
      await first.$executeRawUnsafe(`CREATE TABLE "AuditLog" ("id" TEXT PRIMARY KEY, "action" TEXT NOT NULL)`);
      await first.$executeRawUnsafe(`INSERT INTO "Contract" VALUES ('contract-1')`);
      await first.$executeRawUnsafe(`INSERT INTO "ContractVersion" VALUES (
        'root-1', NULL, 'historical_takeover', 'effective', NOW(), 'fixed_total', 'capped', NULL, 0
      )`);
      await first.$executeRawUnsafe(`INSERT INTO "ContractTakeover" VALUES (
        'takeover-1', 'project-1', 'contract-1', 'root-1', 'confirmed'
      )`);
      await first.$executeRawUnsafe(`INSERT INTO "User" VALUES ('director-1', TRUE)`);
      await first.$executeRawUnsafe(`INSERT INTO "Position" VALUES ('position-1', 'contract_director')`);
      await first.$executeRawUnsafe(`INSERT INTO "UserPosition" VALUES (
        'up-1', 'director-1', 'position-1', NULL
      )`);

      const services = [first, second].map((client) => new ContractTakeoverService(
        client as never,
        audit as never,
        auth as never
      ));
      const results = await Promise.allSettled(services.map((service) =>
        service.confirmChangeBaseline("project-1", "takeover-1", "director-1", {
          originalSignedAmountCents: "1000000",
          preTakeoverPositiveIncreaseCents: "100000",
          currentPassword: "not-a-real-password"
        })
      ));
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      expect(await first.$queryRaw<Array<{ original: bigint; increase: bigint }>>`
        SELECT "originalBaseAmountCents" AS original, "cumulativeIncreaseCents" AS increase
        FROM "ContractVersion" WHERE "id" = 'root-1'
      `).toEqual([{ original: 1_000_000n, increase: 100_000n }]);
      expect(await first.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count FROM "AuditLog"
        WHERE "action" = 'contract_takeover.change_baseline.confirm'
      `).toEqual([{ count: 1n }]);
    } finally {
      await Promise.allSettled([first.$disconnect(), second.$disconnect()]);
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    }
  }, 20_000);
});
