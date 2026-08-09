import { Prisma, PrismaClient } from "@prisma/client";
import { resolve } from "node:path";

const TEST_DATABASE = "jiangkong_contract_draft_aggregate_test";
const scriptPath = resolve(
  __dirname,
  "../../scripts/inspect-legacy-contract-cleanup-preflight.cjs"
);

function localPreflightDatabaseUrl(value: string | undefined) {
  if (!value || process.env.NODE_ENV === "production") {
    throw new Error("存量合同预检测试必须连接非生产专用数据库");
  }
  const url = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    url.pathname !== `/${TEST_DATABASE}`
  ) {
    throw new Error("存量合同预检测试拒绝非本机专用数据库");
  }
  return url.toString();
}

describe("legacy contract cleanup preflight PostgreSQL evidence", () => {
  const integrationTest =
    process.env.RUN_CONTRACT_DRAFT_AGGREGATE_DATABASE === "1" ? it : it.skip;

  integrationTest("reads retention activation as the same absolute instant as PostgreSQL", async () => {
    const databaseUrl = localPreflightDatabaseUrl(
      process.env.CONTRACT_DRAFT_AGGREGATE_DATABASE_URL
    );
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

    try {
      await prisma.$executeRaw(Prisma.sql`
        CREATE TEMP TABLE "RetentionPolicyTimezoneProbe" (
          "activatedAt" TIMESTAMP(3) NOT NULL
        )
      `);
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO "RetentionPolicyTimezoneProbe" ("activatedAt")
        VALUES (TIMESTAMP '2026-08-09 00:00:00')
      `);
      await prisma.$executeRaw(Prisma.sql`
        ALTER TABLE "RetentionPolicyTimezoneProbe"
          ALTER COLUMN "activatedAt" TYPE TIMESTAMPTZ(3)
          USING ("activatedAt" AT TIME ZONE 'Asia/Shanghai')
      `);
      const probeEpochs = await prisma.$queryRaw<Array<{ epochMs: number }>>(
        Prisma.sql`
          SELECT (EXTRACT(EPOCH FROM "activatedAt") * 1000)::double precision AS "epochMs"
          FROM "RetentionPolicyTimezoneProbe"
        `
      );
      expect(probeEpochs).toEqual([{ epochMs: Date.parse("2026-08-08T16:00:00.000Z") }]);

      const columns = await prisma.$queryRaw<Array<{ dataType: string }>>(
        Prisma.sql`
          SELECT data_type AS "dataType"
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'ContractEndedApplicationRetentionPolicy'
            AND column_name = 'activatedAt'
        `
      );
      expect(columns).toEqual([{ dataType: "timestamp with time zone" }]);

      const epochs = await prisma.$queryRaw<Array<{ epochMs: number }>>(
        Prisma.sql`
          SELECT (EXTRACT(EPOCH FROM "activatedAt") * 1000)::double precision AS "epochMs"
          FROM "ContractEndedApplicationRetentionPolicy"
          WHERE "id" = 'contract-ended-retention-v1'
        `
      );
      const policy = await prisma.contractEndedApplicationRetentionPolicy.findUnique({
        where: { id: "contract-ended-retention-v1" },
        select: { activatedAt: true }
      });

      expect(policy).not.toBeNull();
      expect(epochs).toHaveLength(1);
      expect(policy!.activatedAt.getTime()).toBe(Math.trunc(Number(epochs[0].epochMs)));
    } finally {
      await prisma.$executeRaw(
        Prisma.sql`DROP TABLE IF EXISTS "RetentionPolicyTimezoneProbe"`
      );
      await prisma.$disconnect();
    }
  }, 30_000);

  integrationTest("uses a read-only transaction and lists exact COS versions without deleting", async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const tool = require(scriptPath);
    const databaseUrl = localPreflightDatabaseUrl(
      process.env.CONTRACT_DRAFT_AGGREGATE_DATABASE_URL
    );
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = `${process.pid}-${Date.now()}`;
    const ownerId = `legacy-preflight-owner-${suffix}`;
    const projectId = `legacy-preflight-project-${suffix}`;
    const contractId = `legacy-preflight-contract-${suffix}`;
    const contractVersionId = `${contractId}-v1`;
    const fileId = `legacy-preflight-file-${suffix}`;
    const objectKey = `uploads/legacy-preflight-${suffix}.pdf`;
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const originalBucket = process.env.COS_BUCKET;
    const storage = {
      listObjectVersions: jest.fn().mockResolvedValue([
        { versionId: "v1", isDeleteMarker: false },
        { versionId: "v2", isDeleteMarker: false },
        { versionId: "marker", isDeleteMarker: true }
      ]),
      deleteObjectVersion: jest.fn(),
      isConverged: jest.fn()
    };
    const manifestBuilder = jest.fn(async (_tx: unknown, target: { contractVersionIds: string[] }) => {
      expect(target).toEqual({ contractVersionIds: [contractVersionId] });
      const versions: Array<{ versionId: string; isDeleteMarker: boolean }> =
        await storage.listObjectVersions(objectKey);
      return {
        rows: [{
          fileId,
          bucket: "local-preflight",
          objectKey,
          contentSha256: "e".repeat(64),
          bindingType: "exclusive",
          storageSnapshot: {
            versionCount: versions.filter((item) => !item.isDeleteMarker).length,
            deleteMarkerCount: versions.filter((item) => item.isDeleteMarker).length
          }
        }]
      };
    });

    try {
      await prisma.user.create({
        data: { id: ownerId, name: "存量预检专用经办人", mustChangePassword: false }
      });
      await prisma.project.create({
        data: {
          id: projectId,
          code: `LEGACY-PREFLIGHT-${suffix}`,
          name: "存量预检专用项目"
        }
      });
      await prisma.contract.create({
        data: {
          id: contractId,
          projectId,
          temporaryCode: `TMP-LEGACY-PREFLIGHT-${suffix}`,
          name: "存量预检专用合同",
          counterparty: "测试相对方",
          ownerUserId: ownerId,
          source: "system"
        }
      });
      await prisma.contractVersion.create({
        data: {
          id: contractVersionId,
          contractId,
          versionNo: 1,
          changeType: "original",
          status: "abandoned",
          abandonedAt: new Date("2026-06-01T00:00:00.000Z"),
          abandonedByUserId: ownerId,
          amountCents: 100n,
          draftData: {},
          templateSnapshot: {},
          clauseSnapshot: []
        }
      });
      await prisma.fileObject.create({
        data: {
          id: fileId,
          bucket: "local-preflight",
          objectKey,
          originalName: "预检专用附件.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
          uploadedByUserId: ownerId,
          contentSha256: "e".repeat(64)
        }
      });
      await prisma.contractDraftAttachment.create({
        data: {
          contractVersionId,
          slotKey: "legacy_preflight",
          fileId,
          displayOrder: 0,
          createdByUserId: ownerId
        }
      });

      process.env.DATABASE_URL = databaseUrl;
      process.env.COS_BUCKET = "local-preflight";
      const report = await tool.inspectWithClient(prisma, {
        now: new Date("2026-08-09T00:00:00.000Z"),
        codeSha: "a".repeat(40),
        storage,
        manifestBuilder
      });

      expect(report.records).toEqual(expect.arrayContaining([
        expect.objectContaining({
          contractVersionId,
          status: "candidate",
          authorization: "legacy_delete_confirmed",
          fileSummary: {
            exclusiveFileCount: 1,
            sharedFileCount: 0,
            objectVersionCount: 2,
            deleteMarkerCount: 1
          }
        })
      ]));
      expect(manifestBuilder).toHaveBeenCalledTimes(1);
      expect(storage.listObjectVersions).toHaveBeenCalledWith(objectKey);
      expect(storage.deleteObjectVersion).not.toHaveBeenCalled();
      expect(storage.isConverged).not.toHaveBeenCalled();
      expect(JSON.stringify(report)).not.toContain(objectKey);

      await expect(prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        await tx.$executeRawUnsafe("SET LOCAL default_transaction_read_only = on");
        await tx.$executeRaw(
          Prisma.sql`UPDATE "ContractVersion" SET "updatedAt" = "updatedAt" WHERE "id" = ${contractVersionId}`
        );
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })).rejects.toThrow(/read-only/iu);
    } finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
      if (originalBucket === undefined) delete process.env.COS_BUCKET;
      else process.env.COS_BUCKET = originalBucket;
      await prisma.contractDraftAttachment.deleteMany({ where: { contractVersionId } });
      await prisma.contractVersion.deleteMany({ where: { id: contractVersionId } });
      await prisma.contract.deleteMany({ where: { id: contractId } });
      await prisma.fileObject.deleteMany({ where: { id: fileId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.user.deleteMany({ where: { id: ownerId } });
      await prisma.$disconnect();
    }
  }, 30_000);
});
