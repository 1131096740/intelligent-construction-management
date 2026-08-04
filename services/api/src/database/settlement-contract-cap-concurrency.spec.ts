import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { SettlementSubmissionService } from "../settlement/settlement-submission.service";
import { SettlementService } from "../settlement/settlement.service";

describe("settlement contract cap database concurrency", () => {
  const integrationTest = process.env.RUN_SETTLEMENT_CONTRACT_CAP_CONCURRENCY === "1"
    ? it
    : it.skip;

  integrationTest("serializes on Contract so two individually valid submissions cannot exceed the cap", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || process.env.NODE_ENV === "production") {
      throw new Error("结算合同上限并发测试必须连接非生产隔离数据库");
    }
    const schema = `settlement_cap_${randomUUID().replace(/-/g, "")}`;
    const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const isolatedUrl = new URL(databaseUrl);
    isolatedUrl.searchParams.set("schema", schema);
    const clients = [0, 1].map(() => new PrismaClient({
      datasources: { db: { url: isolatedUrl.toString() } }
    }));
    let schemaCreated = false;

    try {
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      schemaCreated = true;
      await clients[0]!.$executeRawUnsafe(`CREATE TABLE "Contract" (
        "id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL, "contractTypeKey" TEXT
      )`);
      await clients[0]!.$executeRawUnsafe(`CREATE TABLE "ContractVersion" (
        "id" TEXT PRIMARY KEY, "contractId" TEXT NOT NULL, "versionNo" INTEGER NOT NULL,
        "status" TEXT NOT NULL, "amountCents" BIGINT NOT NULL, "pricingNature" TEXT NOT NULL,
        "amountLimitType" TEXT NOT NULL, "baseVersionId" TEXT, "changeType" TEXT NOT NULL,
        "changeDirection" TEXT, "changeAmountCents" BIGINT, "cumulativeIncreaseCents" BIGINT NOT NULL,
        "effectiveAt" TIMESTAMPTZ, "invoiceType" TEXT, "defaultTaxRatePercent" NUMERIC,
        "taxFactStatus" TEXT, "taxFactRevision" INTEGER NOT NULL
      )`);
      await clients[0]!.$executeRawUnsafe(`CREATE TABLE "Settlement" (
        "id" TEXT PRIMARY KEY, "contractId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
        "status" TEXT NOT NULL, "amountCents" BIGINT NOT NULL
      )`);
      await clients[0]!.$executeRawUnsafe(`CREATE TABLE "SettlementDraft" (
        "id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL, "ownerUserId" TEXT NOT NULL,
        "status" TEXT NOT NULL, "revision" INTEGER NOT NULL
      )`);
      await clients[0]!.$executeRawUnsafe(`CREATE TABLE "AuditLog" (
        "id" TEXT PRIMARY KEY, "actorUserId" TEXT NOT NULL, "action" TEXT NOT NULL,
        "businessType" TEXT NOT NULL, "businessId" TEXT NOT NULL, "metadata" JSONB NOT NULL
      )`);
      await clients[0]!.$executeRawUnsafe(`CREATE TABLE "ProjectSettlementExceptionQuotaUsage" (
        "id" TEXT PRIMARY KEY
      )`);
      await clients[0]!.$executeRawUnsafe(`CREATE TABLE "ApprovalInstance" (
        "id" TEXT PRIMARY KEY, "businessType" TEXT, "businessId" TEXT
      )`);
      await clients[0]!.$executeRawUnsafe(`CREATE TABLE "SettlementSignedDocument" (
        "id" TEXT PRIMARY KEY, "settlementDraftId" TEXT, "purpose" TEXT NOT NULL,
        "status" TEXT NOT NULL
      )`);
      await clients[0]!.$executeRawUnsafe(`CREATE TABLE "ContractSettlementProcess" (
        "id" TEXT PRIMARY KEY, "settlementDraftId" TEXT, "settlementId" TEXT
      )`);
      await clients[0]!.$executeRawUnsafe(`CREATE TABLE "Project" ("id" TEXT PRIMARY KEY)`);
      await clients[0]!.$executeRaw`INSERT INTO "Project" VALUES ('project-1')`;
      await clients[0]!.$executeRaw`INSERT INTO "Contract" VALUES ('contract-1','project-1','material_purchase')`;
      await clients[0]!.$executeRaw`INSERT INTO "ContractVersion" VALUES (
        'version-1','contract-1',1,'effective',1000,'fixed_total','capped',NULL,'original',
        NULL,NULL,0,NOW(),'vat_special',13,'frozen',1
      )`;

      const wrapped = (client: PrismaClient) => ({
        $transaction: <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>, options?: unknown) =>
          client.$transaction(async (rawTx) => {
            const version = {
              id: "version-1", contractId: "contract-1", versionNo: 1, status: "effective",
              amountCents: 1_000n, pricingNature: "fixed_total", amountLimitType: "capped",
              baseVersionId: null, changeType: "original", changeDirection: null,
              changeAmountCents: null, cumulativeIncreaseCents: 0n,
              effectiveAt: new Date(), invoiceType: "vat_special",
              defaultTaxRatePercent: new Prisma.Decimal(13), taxFactStatus: "frozen", taxFactRevision: 1
            };
            return callback(Object.assign(rawTx, {
              contractVersion: {
                findUnique: jest.fn().mockResolvedValue(version),
                findFirst: jest.fn().mockResolvedValue(version),
                findMany: jest.fn().mockResolvedValue([version])
              },
              contract: { findUnique: jest.fn().mockResolvedValue({
                id: "contract-1", projectId: "project-1", contractTypeKey: "material_purchase"
              }) },
              paymentTermsVersion: { findFirst: jest.fn().mockResolvedValue({ id: "terms-1" }) },
              paymentTermsStage: { findFirst: jest.fn().mockResolvedValue({ ratioBps: 10_000 }) },
              settlement: {
                findFirst: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([]),
                create: jest.fn().mockImplementation(async ({ data }: { data: { projectId: string; contractId: string; amountCents: bigint } }) => {
                  const id = randomUUID();
                  await rawTx.$executeRaw(Prisma.sql`
                    INSERT INTO "Settlement" ("id","contractId","projectId","status","amountCents")
                    VALUES (${id},${data.contractId},${data.projectId},'approval_pending',${data.amountCents})
                  `);
                  return { id, ...data, status: "approval_pending" };
                })
              },
              projectUpstreamSettlement: { findMany: jest.fn().mockResolvedValue([{ approvedAmountCents: 10_000n }]) },
              projectSettlementExceptionQuotaUsage: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn() },
              projectSettlementExceptionQuota: { findMany: jest.fn().mockResolvedValue([]) },
              settlementDraft: {
                findUnique: jest.fn().mockImplementation(async ({ where }: { where: { id: string } }) => {
                  const [row] = await rawTx.$queryRaw<Array<{
                    id: string;
                    projectId: string;
                    ownerUserId: string;
                    status: string;
                    revision: number;
                  }>>(Prisma.sql`
                    SELECT "id", "projectId", "ownerUserId", "status", "revision"
                    FROM "SettlementDraft" WHERE "id" = ${where.id}
                  `);
                  return row ? {
                    ...row,
                    contractVersionId: "version-1",
                    settlementTemplateVersionId: null,
                    code: "JS-DRAFT-CAP",
                    periodLabel: "2026-03",
                    isFinal: true,
                    finalCumulativeAmountCents: 1_001n,
                    lines: [],
                    governanceVersion: 1,
                    fieldReviewerUserId: "material-1",
                    fieldReviewerRoleKey: "material_staff",
                    finalScopeCompleted: true,
                    finalPriorSettlementsIncluded: true,
                    finalNoOutstandingSettlements: true,
                    finalWithinContractCap: true,
                    finalNoFurtherOrdinarySettlements: true
                  } : null;
                }),
                updateMany: jest.fn().mockImplementation(async ({
                  where,
                  data
                }: {
                  where: { id: string; projectId?: string; ownerUserId?: string; status?: string; revision?: number };
                  data: { revision?: { increment: number }; status?: string };
                }) => {
                  if (!data.revision?.increment) return { count: 0 };
                  const rows = await rawTx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                    UPDATE "SettlementDraft"
                    SET "revision" = "revision" + ${data.revision.increment}
                    WHERE "id" = ${where.id}
                      AND "projectId" = ${where.projectId ?? ""}
                      AND "ownerUserId" = ${where.ownerUserId ?? ""}
                      AND "status" = ${where.status ?? ""}
                      AND "revision" = ${where.revision ?? -1}
                    RETURNING "id"
                  `);
                  return { count: rows.length };
                })
              }
            }) as unknown as Prisma.TransactionClient);
          }, options as never)
      });

      const services = clients.map((client) => new SettlementService(wrapped(client) as never));
      const results = await Promise.allSettled(services.map((service, index) => service.create({
        contractVersionId: "version-1",
        code: `JS-CAP-${index}`,
        periodLabel: `2026-0${index + 1}`,
        amountCents: "600"
      })));
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      expect(await clients[0]!.$queryRaw<Array<{ total: bigint; count: bigint }>>`
        SELECT COALESCE(SUM("amountCents"),0)::bigint AS total, COUNT(*)::bigint AS count FROM "Settlement"
      `).toEqual([{ total: 600n, count: 1n }]);

      const audit = {
        record: async (tx: Prisma.TransactionClient, input: {
          actorUserId: string;
          action: string;
          businessType: string;
          businessId: string;
          metadata?: unknown;
        }) => {
          const id = randomUUID();
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO "AuditLog" (
              "id", "actorUserId", "action", "businessType", "businessId", "metadata"
            ) VALUES (
              ${id}, ${input.actorUserId}, ${input.action}, ${input.businessType},
              ${input.businessId}, ${JSON.stringify(input.metadata ?? {})}::jsonb
            )
          `);
          return { id };
        }
      };
      const auditedSettlementService = new SettlementService(
        wrapped(clients[0]!) as never,
        audit as never
      );
      jest.spyOn(auditedSettlementService, "freezeGovernedSettlementFacts")
        .mockResolvedValue({
          fieldReviewerUserId: "material-1",
          fieldReviewerRoleKey: "material_staff",
          engineeringDirectorUserId: null,
          finalConfirmations: {
            finalScopeCompleted: true,
            finalPriorSettlementsIncluded: true,
            finalNoOutstandingSettlements: true,
            finalWithinContractCap: true,
            finalNoFurtherOrdinarySettlements: true
          },
          frozenNodes: [],
          preparerSignature: { fileId: "signature-1", sha256: "a".repeat(64), versionId: "signature-version-1" }
        });
      await expect(auditedSettlementService.create({
        contractVersionId: "version-1",
        code: "JS-CAP-DENIED",
        periodLabel: "2026-04",
        amountCents: "401"
      }, "staff-1")).rejects.toThrow("请先完成合同变更");

      expect(await clients[0]!.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM "Settlement"
      `).toEqual([{ count: 1n }]);
      expect(await clients[0]!.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM "ProjectSettlementExceptionQuotaUsage"
      `).toEqual([{ count: 0n }]);
      expect(await clients[0]!.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM "ApprovalInstance"
      `).toEqual([{ count: 0n }]);
      expect(await clients[0]!.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM "AuditLog"
        WHERE "action" = 'settlement.contract_capacity.denied'
      `).toEqual([{ count: 1n }]);

      await clients[0]!.$executeRaw`
        INSERT INTO "SettlementDraft" ("id", "projectId", "ownerUserId", "status", "revision")
        VALUES ('draft-1', 'project-1', 'staff-1', 'draft', 3)
      `;
      const draftSubmission = new SettlementSubmissionService(
        wrapped(clients[0]!) as never,
        auditedSettlementService,
        {
          assertReadyForSubmission: jest.fn().mockResolvedValue({}),
          persistDenial: jest.fn().mockResolvedValue(undefined)
        } as never,
        { assertCurrentFacts: jest.fn().mockResolvedValue({}) } as never
      );
      await expect(draftSubmission.submitDraft(
        "project-1",
        "draft-1",
        "staff-1",
        3
      )).rejects.toThrow("请先完成合同变更");
      expect(await clients[0]!.$queryRaw<Array<{ status: string; revision: number }>>`
        SELECT "status", "revision" FROM "SettlementDraft" WHERE "id" = 'draft-1'
      `).toEqual([{ status: "draft", revision: 3 }]);
      expect(await clients[0]!.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM "Settlement"
      `).toEqual([{ count: 1n }]);
      expect(await clients[0]!.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM "AuditLog"
        WHERE "action" = 'settlement.contract_capacity.denied'
      `).toEqual([{ count: 2n }]);
    } finally {
      await Promise.allSettled(clients.map((client) => client.$disconnect()));
      if (schemaCreated) {
        await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      }
      await admin.$disconnect();
    }
  }, 20_000);
});
