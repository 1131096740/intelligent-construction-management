import { randomUUID } from "node:crypto";
import * as assert from "node:assert/strict";

import { Prisma, PrismaClient } from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import { ClearingService } from "../clearing/clearing.service";
import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import { ProjectOperatingProfileService } from "../project/project-operating-profile.service";
import { ProjectService } from "../project/project.service";

describe("POL-275 old process / new schema compatibility", () => {
  const compatibilityTest =
    process.env.RUN_POL275_LEGACY_PROCESS_COMPATIBILITY === "1"
      ? it
      : it.skip;

  compatibilityTest(
    "confirms the no-V1 public contract without creating reconciliation rows",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const client = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const prefix = `pol275_legacy_${randomUUID().replace(/-/gu, "")}`;
      const preparerUserId = `${prefix}_preparer`;
      const confirmerUserId = `${prefix}_confirmer`;
      try {
        await client.$connect();
        const fixture = await seedOperatingFixture(client, {
          prefix,
          preparerUserId,
          confirmerUserId
        });
        const clearingCase = await client.clearingCase.create({
          data: {
            id: `${prefix}_case`,
            projectId: fixture.projectId,
            constructionEnterpriseAssignmentId: fixture.assignmentId,
            category: "management_fee",
            governedSubjectKey: `${prefix}_subject`,
            authoritativeGrossCapCents: 1000n,
            createdByUserId: preparerUserId
          }
        });
        const service = createLegacyCompatibleService(client, {
          preparerUserId,
          confirmerUserId
        });
        const prepared = eventResult(await service.createEvent(
          preparerUserId,
          clearingCase.id,
          {
            idempotencyKey: randomUUID(),
            expectedRevision: clearingCase.revision,
            kind: "withheld",
            amountCents: "30",
            evidenceLevel: "A",
            payload: { reason: "POL-275 old process / new schema compatibility" }
          }
        ));
        const submitted = eventResult(await service.submitEvent(
          preparerUserId,
          prepared.id,
          {
            idempotencyKey: randomUUID(),
            expectedRevision: prepared.revision
          }
        ));

        await service.confirmEvent(confirmerUserId, prepared.id, {
          idempotencyKey: randomUUID(),
          expectedRevision: submitted.revision
        });

        const [proof] = await client.$queryRaw<Array<{
          confirmationCount: bigint;
          itemCount: bigint;
          revisionCount: bigint;
          coverageCount: bigint;
          resolutionCount: bigint;
          definitionReversalCount: bigint;
          resolutionLineCount: bigint;
          decisionSealCount: bigint;
        }>>(Prisma.sql`
          SELECT
            (SELECT COUNT(*) FROM "ClearingConfirmation"
              WHERE "eventVersionId" = ${submitted.versionId}) AS "confirmationCount",
            (SELECT COUNT(*) FROM "ClearingReconciliationItem"
              WHERE "openingDecisionEventVersionId" = ${submitted.versionId}) AS "itemCount",
            (SELECT COUNT(*) FROM "ClearingReconciliationRevision"
              WHERE "decisionEventVersionId" = ${submitted.versionId}) AS "revisionCount",
            (SELECT COUNT(*) FROM "ClearingReconciliationCoverage"
              WHERE "decisionEventVersionId" = ${submitted.versionId}) AS "coverageCount",
            (SELECT COUNT(*) FROM "ClearingReconciliationResolution"
              WHERE "decisionEventVersionId" = ${submitted.versionId}) AS "resolutionCount",
            (SELECT COUNT(*) FROM "ClearingReconciliationDefinitionReversal"
              WHERE "decisionEventVersionId" = ${submitted.versionId}) AS "definitionReversalCount",
            (SELECT COUNT(*)
               FROM "ClearingReconciliationResolutionLine" line
               JOIN "ClearingReconciliationResolution" resolution
                 ON resolution."id" = line."resolutionId"
              WHERE resolution."decisionEventVersionId" = ${submitted.versionId}) AS "resolutionLineCount",
            (SELECT COUNT(*) FROM "ClearingReconciliationDecisionSeal"
              WHERE "decisionEventVersionId" = ${submitted.versionId}) AS "decisionSealCount"
        `);
        assert.deepEqual(proof, {
          confirmationCount: 1n,
          itemCount: 0n,
          revisionCount: 0n,
          coverageCount: 0n,
          resolutionCount: 0n,
          definitionReversalCount: 0n,
          resolutionLineCount: 0n,
          decisionSealCount: 0n
        });
      } finally {
        await client.$disconnect();
      }
    },
    90_000
  );
});

function createLegacyCompatibleService(
  client: PrismaClient,
  actors: { preparerUserId: string; confirmerUserId: string }
): ClearingService {
  const roleResolver = {
    resolveActiveRoleScopes: jest.fn(async (userId: string) =>
      userId === actors.confirmerUserId
        ? ["finance_director"]
        : ["finance_staff"]
    )
  };
  return Reflect.construct(ClearingService, [
    client,
    roleResolver,
    new OperatingLedgerService(client as never),
    new AuditService(client as never),
    undefined,
    undefined
  ]) as ClearingService;
}

async function seedOperatingFixture(
  client: PrismaClient,
  fixture: {
    prefix: string;
    preparerUserId: string;
    confirmerUserId: string;
  }
): Promise<{ projectId: string; assignmentId: string }> {
  const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
  if (!secret) {
    throw new Error("POL-275 compatibility test lacks local ledger secret");
  }
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "OperatingLedgerWriteSecret" ("id", "secretHash")
    VALUES (1, crypt(${secret}, gen_salt('bf')))
    ON CONFLICT ("id") DO UPDATE SET "secretHash" = EXCLUDED."secretHash"
  `);
  for (const userId of [fixture.preparerUserId, fixture.confirmerUserId]) {
    await client.$executeRaw(Prisma.sql`
      INSERT INTO "User" ("id", "name", "mustChangePassword", "isActive", "updatedAt")
      VALUES (${userId}, 'POL-275兼容性测试用户', FALSE, TRUE, CURRENT_TIMESTAMP)
    `);
  }
  const audit = new AuditService(client as never);
  const projects = new ProjectService(client as never, audit);
  const project = await projects.createProject(fixture.preparerUserId, {
    code: fixture.prefix,
    name: "POL-275兼容性测试项目"
  });
  await client.projectMember.create({
    data: {
      id: `${fixture.prefix}_finance_member`,
      projectId: project.id,
      userId: fixture.preparerUserId,
      positionKey: "finance_staff"
    }
  });
  const party = await client.businessParty.create({
    data: {
      id: `${fixture.prefix}_party`,
      name: "POL-275兼容性施工主体",
      normalizedName: `${fixture.prefix}_party`,
      unifiedSocialCreditCode: `BUILD-${fixture.prefix}`,
      createdByUserId: fixture.preparerUserId
    }
  });
  const partyVersion = await client.businessPartyVersion.create({
    data: {
      id: `${fixture.prefix}_party_version`,
      businessPartyId: party.id,
      versionNo: 1,
      snapshot: {
        name: party.name,
        unifiedSocialCreditCode: party.unifiedSocialCreditCode
      },
      createdByUserId: fixture.preparerUserId
    }
  });
  const assignment = await projects.assignAffiliate(
    project.id,
    fixture.preparerUserId,
    {
      businessPartyVersionId: partyVersion.id,
      effectiveFrom: "2026-01-01",
      changeReason: "POL-275 old process / new schema compatibility"
    }
  );
  const company = await client.companyEntity.create({
    data: {
      id: `${fixture.prefix}_company`,
      name: "POL-275兼容性我方公司",
      unifiedSocialCreditCode: `COMPANY-${fixture.prefix}`,
      dataStatus: "complete",
      currentVersionNo: 1,
      isActive: true
    }
  });
  await client.companyEntityVersion.create({
    data: {
      id: `${fixture.prefix}_company_version`,
      companyEntityId: company.id,
      versionNo: 1,
      name: company.name,
      unifiedSocialCreditCode: company.unifiedSocialCreditCode,
      isActive: true,
      action: "create",
      actorUserId: fixture.preparerUserId,
      actorRoleKey: "finance_staff"
    }
  });
  const profile = new ProjectOperatingProfileService(client as never, audit);
  await profile.addParticipatingCompany(project.id, fixture.preparerUserId, {
    companyEntityId: company.id,
    effectiveFrom: "2026-08-01",
    changeReason: "POL-275 old process / new schema compatibility"
  });
  await profile.updateProfile(project.id, fixture.preparerUserId, {
    operatingLedgerEffectiveDate: "2026-08-01"
  });
  return { projectId: project.id, assignmentId: assignment.id };
}

function eventResult(value: unknown): {
  id: string;
  versionId: string;
  revision: number;
} {
  return value as {
    id: string;
    versionId: string;
    revision: number;
  };
}

function assertDedicatedDatabase(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || process.env.NODE_ENV === "production") {
    throw new Error("POL-275 compatibility test requires an isolated database");
  }
  const parsed = new URL(databaseUrl);
  if (
    !["postgresql:", "postgres:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) ||
    parsed.pathname !== "/jiangkong_pol275"
  ) {
    throw new Error("POL-275 compatibility test only accepts its local PG16 database");
  }
  return databaseUrl;
}
