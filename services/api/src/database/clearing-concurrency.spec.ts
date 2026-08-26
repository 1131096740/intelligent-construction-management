import { randomUUID } from "node:crypto";
import * as assert from "node:assert/strict";

import { Prisma, PrismaClient } from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import { ClearingService } from "../clearing/clearing.service";
import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";

describe("clearing PostgreSQL concurrency", () => {
  const integrationTest = process.env.RUN_CLEARING_DATABASE === "1" ? it : it.skip;

  integrationTest(
    "keeps confirmation, allocation, audit and OperatingLedger projection atomic under concurrency",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const clients = [0, 1, 2].map(
        () => new PrismaClient({ datasources: { db: { url: databaseUrl } } })
      );
      const fixture = fixtureIds();

      try {
        await Promise.all(clients.map((client) => client.$connect()));
        await seedFixture(clients[0]!, fixture);

        const preparer = clearingService(clients[0]!, fixture);
        const clearingCase = caseResult(await preparer.createCase(fixture.staffUserId, {
          idempotencyKey: randomUUID(),
          expectedRevision: 0,
          projectId: fixture.projectId,
          constructionEnterpriseAssignmentId: fixture.assignmentId,
          category: "management_fee",
          governedSubjectKey: fixture.subjectKey,
          authoritativeGrossCapCents: "1000"
        }));
        const event = eventResult(await preparer.createEvent(fixture.staffUserId, clearingCase.id, {
          idempotencyKey: randomUUID(),
          expectedRevision: 1,
          kind: "final_confirmed",
          amountCents: "1000",
          evidenceLevel: "A",
          payload: { note: "frozen clearing snapshot" }
        }));
        const submitted = eventResult(await preparer.submitEvent(fixture.staffUserId, event.id, {
          idempotencyKey: randomUUID(),
          expectedRevision: 1
        }));

        const attempts = [
          {
            service: clearingService(clients[1]!, fixture),
            actorUserId: fixture.directorAUserId,
            idempotencyKey: randomUUID()
          },
          {
            service: clearingService(clients[2]!, fixture),
            actorUserId: fixture.directorBUserId,
            idempotencyKey: randomUUID()
          }
        ];
        const results = await Promise.allSettled(
          attempts.map((attempt) =>
            attempt.service.confirmEvent(attempt.actorUserId, event.id, {
              idempotencyKey: attempt.idempotencyKey,
              expectedRevision: submitted.revision,
              allocations: [{ sourceKind: "authority_cap", amountCents: "1000" }]
            })
          )
        );
        const fulfilledIndexes = results.flatMap((result, index) =>
          result.status === "fulfilled" ? [index] : []
        );
        const rejected = results.filter(
          (result): result is PromiseRejectedResult => result.status === "rejected"
        );
        assert.equal(
          fulfilledIndexes.length,
          1,
          rejected
            .map((entry) => entry.reason instanceof Error ? entry.reason.stack : String(entry.reason))
            .join("; ")
        );
        assert.equal(rejected.length, 1);

        const winnerIndex = fulfilledIndexes[0]!;
        const winner = attempts[winnerIndex]!;
        const winnerResult = results[winnerIndex]!;
        assert.equal(winnerResult.status, "fulfilled");
        await expect(
          winner.service.confirmEvent(winner.actorUserId, event.id, {
            idempotencyKey: winner.idempotencyKey,
            expectedRevision: submitted.revision,
            allocations: [{ sourceKind: "authority_cap", amountCents: "1000" }]
          })
        ).resolves.toEqual(winnerResult.value);

        const [summary] = await clients[0]!.$queryRaw<
          Array<{
            confirmationCount: bigint;
            allocationCount: bigint;
            factCount: bigint;
            impactCount: bigint;
            impactLinkCount: bigint;
            confirmationReceiptCount: bigint;
            confirmationAuditCount: bigint;
            allocationAmount: bigint;
          }>
        >(Prisma.sql`
          SELECT
            (SELECT COUNT(*) FROM "ClearingConfirmation" confirmation
              JOIN "ClearingEventVersion" version ON version.id = confirmation."eventVersionId"
              WHERE version."clearingEventId" = ${event.id}) AS "confirmationCount",
            (SELECT COUNT(*) FROM "ClearingAllocation" allocation
              JOIN "ClearingEventVersion" version ON version.id = allocation."eventVersionId"
              WHERE version."clearingEventId" = ${event.id}) AS "allocationCount",
            (SELECT COUNT(*) FROM "OperatingFact"
              WHERE "sourceType" = 'clearing_event_version'
                AND "sourceBusinessId" = ${submitted.versionId}) AS "factCount",
            (SELECT COUNT(*) FROM "OperatingImpactEntry"
              WHERE "sourceType" = 'clearing_event_version'
                AND "sourceBusinessId" = ${submitted.versionId}) AS "impactCount",
            (SELECT COUNT(*) FROM "ClearingImpactLink" link
              JOIN "ClearingEventVersion" version ON version.id = link."eventVersionId"
              WHERE version."clearingEventId" = ${event.id}) AS "impactLinkCount",
            (SELECT COUNT(*) FROM "ClearingCommandReceipt"
              WHERE "aggregateId" = ${event.id} AND action = 'clearing.event.confirm') AS "confirmationReceiptCount",
            (SELECT COUNT(*) FROM "AuditLog"
              WHERE "businessId" = ${event.id} AND action = 'clearing.event.confirm') AS "confirmationAuditCount",
            (SELECT COALESCE(SUM(allocation."amountCents"), 0)::bigint FROM "ClearingAllocation" allocation
              JOIN "ClearingEventVersion" version ON version.id = allocation."eventVersionId"
              WHERE version."clearingEventId" = ${event.id}) AS "allocationAmount"
        `);
        assert.deepEqual(summary, {
          confirmationCount: 1n,
          allocationCount: 1n,
          factCount: 1n,
          impactCount: 2n,
          impactLinkCount: 2n,
          confirmationReceiptCount: 1n,
          confirmationAuditCount: 1n,
          allocationAmount: 1000n
        });

        const persisted = await clients[0]!.clearingEvent.findUnique({
          where: { id: event.id },
          select: { workflowStatus: true, revision: true }
        });
        assert.deepEqual(persisted, { workflowStatus: "confirmed", revision: 3 });
        await expect(
          clients[0]!.clearingEventVersion.update({
            where: { id: submitted.versionId },
            data: { amountCents: 999n }
          })
        ).rejects.toThrow("clearing immutable rows cannot be updated or deleted");
      } finally {
        await Promise.allSettled(clients.map((client) => client.$disconnect()));
      }
    },
    90_000
  );
});

function clearingService(client: PrismaClient, fixture: ReturnType<typeof fixtureIds>) {
  const roleResolver = {
    resolveActiveRoleScopes: jest.fn(async (userId: string) =>
      userId === fixture.staffUserId ? ["finance_staff"] : ["finance_director"]
    )
  };
  return new ClearingService(
    client as never,
    roleResolver as never,
    new OperatingLedgerService(client as never),
    new AuditService(client as never)
  );
}

function fixtureIds() {
  const prefix = `pol11a_${randomUUID().replace(/-/gu, "")}`;
  return {
    prefix,
    staffUserId: `${prefix}_staff`,
    directorAUserId: `${prefix}_director_a`,
    directorBUserId: `${prefix}_director_b`,
    projectId: `${prefix}_project`,
    assignmentId: `${prefix}_assignment`,
    partyId: `${prefix}_party`,
    partyVersionId: `${prefix}_party_version`,
    companyId: `${prefix}_company`,
    companyVersionId: `${prefix}_company_version`,
    subjectKey: `${prefix}_management_fee`
  };
}

function assertDedicatedDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || process.env.NODE_ENV === "production") {
    throw new Error("清分并发测试必须连接非生产隔离数据库");
  }
  const parsed = new URL(databaseUrl);
  if (
    !["postgresql:", "postgres:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) ||
    parsed.pathname !== "/jiangkong_database_dynamic_misc"
  ) {
    throw new Error("清分并发测试只允许本机一次性 PostgreSQL 16 数据库");
  }
  return databaseUrl;
}

async function seedFixture(client: PrismaClient, fixture: ReturnType<typeof fixtureIds>) {
  const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
  if (!secret) throw new Error("清分 PostgreSQL 测试缺少经营账写入密钥");
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "OperatingLedgerWriteSecret" ("id", "secretHash")
    VALUES (1, crypt(${secret}, gen_salt('bf')))
    ON CONFLICT ("id") DO UPDATE SET "secretHash" = EXCLUDED."secretHash"
  `);
  for (const userId of [fixture.staffUserId, fixture.directorAUserId, fixture.directorBUserId]) {
    await client.$executeRaw(Prisma.sql`
      INSERT INTO "User" ("id", "name", "mustChangePassword", "isActive", "updatedAt")
      VALUES (${userId}, 'POL-11A清分测试用户', FALSE, TRUE, CURRENT_TIMESTAMP)
    `);
  }
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "Project" (
      "id", "code", "name", "updatedAt"
    ) VALUES (
      ${fixture.projectId}, ${fixture.prefix}, 'POL-11A清分并发项目', CURRENT_TIMESTAMP
    )
  `);
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "ProjectMember" ("id", "projectId", "userId", "positionKey")
    VALUES
      (${`${fixture.prefix}_member_staff`}, ${fixture.projectId}, ${fixture.staffUserId}, 'finance_staff'),
      (${`${fixture.prefix}_member_director_a`}, ${fixture.projectId}, ${fixture.directorAUserId}, 'finance_director'),
      (${`${fixture.prefix}_member_director_b`}, ${fixture.projectId}, ${fixture.directorBUserId}, 'finance_director')
  `);
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "ProjectAffiliateAssignment" (
      "id", "projectId", "businessPartyId", "businessPartyVersionId",
      "affiliateNameSnapshot", "effectiveFrom", "changeReason", "assignedByUserId", "updatedAt"
    ) VALUES (
      ${fixture.assignmentId}, ${fixture.projectId}, ${fixture.partyId}, ${fixture.partyVersionId},
      '施工企业测试主体', DATE '2026-01-01', 'POL-11A清分动态验收',
      ${fixture.staffUserId}, CURRENT_TIMESTAMP
    )
  `);
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "CompanyEntity" (
      "id", "name", "dataStatus", "currentVersionNo", "isActive", "createdAt", "updatedAt"
    ) VALUES (
      ${fixture.companyId}, '我方清分测试公司', 'legacy_incomplete', 1, TRUE,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `);
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "CompanyEntityVersion" (
      "id", "companyEntityId", "versionNo", "name", "isActive", "action", "createdAt"
    ) VALUES (
      ${fixture.companyVersionId}, ${fixture.companyId}, 1,
      '我方清分测试公司', TRUE, 'POL-11A_TEST', CURRENT_TIMESTAMP
    )
  `);
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "ProjectParticipatingCompany" (
      "id", "projectId", "companyEntityId", "companyEntityVersionId",
      "companyNameSnapshot", "effectiveFrom", "changeReason", "addedByUserId", "updatedAt"
    ) VALUES (
      ${`${fixture.prefix}_company_assignment`}, ${fixture.projectId}, ${fixture.companyId},
      ${fixture.companyVersionId}, '我方清分测试公司', DATE '2026-01-01',
      'POL-11A清分动态验收', ${fixture.staffUserId}, CURRENT_TIMESTAMP
    )
  `);
  await client.$executeRaw(Prisma.sql`
    UPDATE "Project"
    SET "operatingLedgerEffectiveDate" = DATE '2026-08-01'
    WHERE "id" = ${fixture.projectId}
  `);
}

function caseResult(value: unknown): { id: string; revision: number } {
  if (!value || typeof value !== "object") throw new Error("清分事项命令未返回对象");
  const result = value as Record<string, unknown>;
  if (typeof result.id !== "string" || typeof result.revision !== "number") {
    throw new Error("清分事项命令返回值损坏");
  }
  return { id: result.id, revision: result.revision };
}

function eventResult(value: unknown): {
  id: string;
  versionId: string;
  revision: number;
  workflowStatus: string;
} {
  if (!value || typeof value !== "object") throw new Error("清分事件命令未返回对象");
  const result = value as Record<string, unknown>;
  if (
    typeof result.id !== "string" ||
    typeof result.versionId !== "string" ||
    typeof result.revision !== "number" ||
    typeof result.workflowStatus !== "string"
  ) {
    throw new Error("清分事件命令返回值损坏");
  }
  return {
    id: result.id,
    versionId: result.versionId,
    revision: result.revision,
    workflowStatus: result.workflowStatus
  };
}
