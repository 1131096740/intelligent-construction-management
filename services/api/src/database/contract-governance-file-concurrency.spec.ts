import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

describe("contract governance file binding concurrency", () => {
  const integrationTest = process.env.RUN_CONTRACT_GOVERNANCE_CONCURRENCY === "1"
    ? it
    : it.skip;

  integrationTest("serializes formal and authorization bindings through the FileObject row", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || process.env.NODE_ENV === "production") {
      throw new Error("合同签署文件并发测试必须连接非生产隔离数据库");
    }
    const schema = `contract_governance_${randomUUID().replace(/-/gu, "")}`;
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const isolatedUrl = new URL(databaseUrl);
    isolatedUrl.searchParams.set("schema", schema);
    const first = new PrismaClient({ datasources: { db: { url: isolatedUrl.toString() } } });
    const second = new PrismaClient({ datasources: { db: { url: isolatedUrl.toString() } } });

    try {
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await first.$executeRawUnsafe(`CREATE TABLE "ContractVersion" ("id" TEXT PRIMARY KEY)`);
      await first.$executeRawUnsafe(`CREATE TABLE "FileObject" ("id" TEXT PRIMARY KEY)`);
      await first.$executeRawUnsafe(`CREATE TABLE "ContractFormalFile" ("id" TEXT PRIMARY KEY, "contractVersionId" TEXT NOT NULL, "fileId" TEXT NOT NULL, "status" TEXT NOT NULL)`);
      await first.$executeRawUnsafe(`CREATE TABLE "ContractAuthorization" ("id" TEXT PRIMARY KEY, "originContractVersionId" TEXT NOT NULL, "fileId" TEXT NOT NULL, "status" TEXT NOT NULL)`);
      await first.$executeRawUnsafe(`INSERT INTO "ContractVersion" ("id") VALUES ('version-formal'), ('version-auth')`);
      await first.$executeRawUnsafe(`INSERT INTO "FileObject" ("id") VALUES ('file-1')`);

      const bind = (
        client: PrismaClient,
        kind: "formal" | "authorization"
      ) => client.$transaction(async (tx) => {
        const versionId = kind === "formal" ? "version-formal" : "version-auth";
        await tx.$queryRawUnsafe(`SELECT "id" FROM "ContractVersion" WHERE "id" = '${versionId}' FOR UPDATE`);
        await tx.$queryRawUnsafe(`SELECT "id" FROM "FileObject" WHERE "id" = 'file-1' FOR UPDATE`);
        const bindings = await tx.$queryRaw<Array<{ source: string }>>`
          SELECT 'formal'::text AS "source" FROM "ContractFormalFile" WHERE "fileId" = 'file-1'
          UNION ALL
          SELECT 'authorization'::text AS "source" FROM "ContractAuthorization" WHERE "fileId" = 'file-1'
        `;
        if (bindings.length > 0) return false;
        if (kind === "formal") {
          await tx.$executeRaw`INSERT INTO "ContractFormalFile" ("id", "contractVersionId", "fileId", "status") VALUES ('formal-1', 'version-formal', 'file-1', 'active')`;
        } else {
          await tx.$executeRaw`INSERT INTO "ContractAuthorization" ("id", "originContractVersionId", "fileId", "status") VALUES ('auth-1', 'version-auth', 'file-1', 'active')`;
        }
        return true;
      });

      const results = await Promise.all([bind(first, "formal"), bind(second, "authorization")]);
      expect(results.filter(Boolean)).toHaveLength(1);
      const [count] = await first.$queryRaw<Array<{ count: bigint }>>`
        SELECT (
          (SELECT COUNT(*) FROM "ContractFormalFile" WHERE "fileId" = 'file-1') +
          (SELECT COUNT(*) FROM "ContractAuthorization" WHERE "fileId" = 'file-1')
        )::bigint AS "count"
      `;
      expect(count.count).toBe(1n);
    } finally {
      await Promise.allSettled([first.$disconnect(), second.$disconnect()]);
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    }
  }, 15_000);
});
