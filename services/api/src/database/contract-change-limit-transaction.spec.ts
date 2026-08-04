import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { ContractService } from "../contract/contract.service";

describe("contract change limit transaction evidence", () => {
  const integrationTest = process.env.RUN_CONTRACT_CHANGE_LIMIT_DATABASE === "1" ? it : it.skip;

  integrationTest("keeps an over-limit draft rolled back while persisting denial audit", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || process.env.NODE_ENV === "production") {
      throw new Error("合同增项上限集成测试必须连接非生产隔离数据库");
    }
    const schema = `change_limit_${randomUUID().replace(/-/g, "")}`;
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const isolatedUrl = new URL(databaseUrl);
    isolatedUrl.searchParams.set("schema", schema);
    const client = new PrismaClient({ datasources: { db: { url: isolatedUrl.toString() } } });
    const contract = {
      id: "contract-1", projectId: "project-1", ownerUserId: "owner-1", voidedAt: null
    };
    const audit = {
      record: async (tx: Prisma.TransactionClient, input: {
        actorUserId: string; action: string; businessId: string; metadata: unknown;
      }) => tx.$executeRaw(Prisma.sql`
        INSERT INTO "AuditLog" ("id", "actorUserId", "action", "businessId", "metadata")
        VALUES (${randomUUID()}, ${input.actorUserId}, ${input.action}, ${input.businessId},
                ${JSON.stringify(input.metadata)}::jsonb)
      `)
    };

    try {
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await client.$executeRawUnsafe(`CREATE TABLE "Contract" ("id" TEXT PRIMARY KEY)`);
      await client.$executeRawUnsafe(`CREATE TABLE "ContractVersion" (
        "id" TEXT PRIMARY KEY, "contractId" TEXT NOT NULL, "versionNo" INTEGER NOT NULL,
        "status" TEXT NOT NULL, "changeType" TEXT NOT NULL, "baseVersionId" TEXT,
        "effectiveAt" TIMESTAMPTZ, "changeDirection" TEXT, "changeAmountCents" BIGINT,
        "amountCents" BIGINT NOT NULL, "originalBaseAmountCents" BIGINT,
        "cumulativeIncreaseCents" BIGINT NOT NULL DEFAULT 0,
        "cumulativeDecreaseCents" BIGINT NOT NULL DEFAULT 0,
        "pricingNature" TEXT NOT NULL, "amountLimitType" TEXT NOT NULL,
        "companyEntityIdSnapshot" TEXT, "companyEntityVersionId" TEXT,
        "companyEntityNameSnapshot" TEXT, "companyEntityCreditCodeSnapshot" TEXT,
        "companyEntityRegisteredAddressSnapshot" TEXT,
        "draftData" JSONB NOT NULL DEFAULT '{}', "clauseSnapshot" JSONB NOT NULL DEFAULT '[]',
        "templateSnapshot" JSONB NOT NULL DEFAULT '{"fieldSchema":[],"clauseSchema":[]}',
        "draftRevision" INTEGER NOT NULL DEFAULT 1, "contractGovernanceVersion" INTEGER NOT NULL DEFAULT 1
      )`);
      await client.$executeRawUnsafe(`CREATE TABLE "AuditLog" (
        "id" TEXT PRIMARY KEY, "actorUserId" TEXT NOT NULL, "action" TEXT NOT NULL,
        "businessId" TEXT NOT NULL, "metadata" JSONB NOT NULL
      )`);
      await client.$executeRawUnsafe(`INSERT INTO "Contract" VALUES ('contract-1')`);
      await client.$executeRawUnsafe(`INSERT INTO "ContractVersion" (
        "id","contractId","versionNo","status","changeType","baseVersionId","effectiveAt",
        "amountCents","cumulativeIncreaseCents","cumulativeDecreaseCents","pricingNature","amountLimitType",
        "companyEntityIdSnapshot","companyEntityVersionId","companyEntityNameSnapshot","companyEntityCreditCodeSnapshot"
      ) VALUES
        ('root','contract-1',1,'superseded','historical_takeover',NULL,NOW(),1000000,50000,0,'fixed_total','capped','e','ev','company','credit'),
        ('prior-up','contract-1',2,'superseded','change','root',NOW(),1050000,100000,0,'fixed_total','capped','e','ev','company','credit'),
        ('prior-down','contract-1',3,'effective','change','prior-up',NOW(),1000000,100000,50000,'fixed_total','capped','e','ev','company','credit'),
        ('candidate-exact','contract-1',4,'draft','change','prior-down',NULL,1000000,100000,50000,'fixed_total','capped','e','ev','company','credit'),
        ('candidate','contract-1',5,'draft','change','prior-down',NULL,1000001,100001,50000,'fixed_total','capped','e','ev','company','credit')
      `);
      await client.$executeRaw`UPDATE "ContractVersion" SET
        "originalBaseAmountCents" = 1000000
        WHERE "id" = 'root'`;
      await client.$executeRaw`UPDATE "ContractVersion" SET
        "originalBaseAmountCents" = 1000000,
        "changeDirection" = 'increase', "changeAmountCents" = 50000
        WHERE "id" = 'prior-up'`;
      await client.$executeRaw`UPDATE "ContractVersion" SET
        "originalBaseAmountCents" = 1000000,
        "changeDirection" = 'decrease', "changeAmountCents" = 50000
        WHERE "id" = 'prior-down'`;
      await client.$executeRaw`UPDATE "ContractVersion" SET
        "originalBaseAmountCents" = 1000000,
        "changeDirection" = 'unchanged', "changeAmountCents" = 0
        WHERE "id" = 'candidate-exact'`;
      await client.$executeRaw`UPDATE "ContractVersion" SET
        "originalBaseAmountCents" = 1000000,
        "changeDirection" = 'increase', "changeAmountCents" = 1
        WHERE "id" = 'candidate'`;

      const prisma = {
        $transaction: <T>(callback: (tx: Prisma.TransactionClient & { contract: unknown }) => Promise<T>, options?: unknown) =>
          client.$transaction(async (tx) => callback(Object.assign(tx, {
            contract: { findUnique: jest.fn().mockResolvedValue(contract) }
          })), options as never)
      };
      const service = new ContractService(prisma as never, audit as never);
      const subject = service as unknown as {
        assertChangeAmountProjection(tx: Prisma.TransactionClient, version: Record<string, unknown>): Promise<void>;
      };
      await client.$transaction(async (tx) => {
        const [exact] = await tx.$queryRaw<Array<Record<string, unknown>>>`
          SELECT * FROM "ContractVersion" WHERE "id" = 'candidate-exact'
        `;
        await expect(subject.assertChangeAmountProjection(tx, exact)).resolves.toBeUndefined();
      });
      await expect(service.submitApproval("candidate", "owner-1"))
        .rejects.toThrow("累计增项已超过原合同 10%，必须新签合同");
      expect(await client.$queryRaw<Array<{ status: string }>>`
        SELECT "status" FROM "ContractVersion" WHERE "id" = 'candidate'
      `).toEqual([{ status: "draft" }]);
      expect(await client.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count FROM "AuditLog"
        WHERE "action" = 'contract.change.limit.denied' AND "businessId" = 'candidate'
      `).toEqual([{ count: 1n }]);
    } finally {
      await client.$disconnect();
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    }
  }, 20_000);
});
