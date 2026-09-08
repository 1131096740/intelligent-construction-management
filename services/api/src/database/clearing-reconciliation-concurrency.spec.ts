import { randomUUID } from "node:crypto";
import * as assert from "node:assert/strict";

import { Prisma, PrismaClient } from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import { AffiliateClearingSelectionRefService } from "../clearing/affiliate-clearing-selection-ref.service";
import { ClearingService } from "../clearing/clearing.service";
import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import { ProjectOperatingProfileService } from "../project/project-operating-profile.service";
import { ProjectService } from "../project/project.service";

describe("POL-275 clearing reconciliation PostgreSQL 16", () => {
  const integrationTest =
    process.env.RUN_POL275_CLEARING_RECONCILIATION_DATABASE === "1"
      ? it
      : it.skip;

  integrationTest(
    "confirms the public V1 workflow with one typed relation set and DecisionSeal",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const client = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const prefix = `pol275_${randomUUID().replace(/-/gu, "")}`;
      const caseId = `${prefix}_case`;
      const preparerUserId = `${prefix}_preparer`;
      const attesterUserId = `${prefix}_attester`;
      const confirmerUserId = `${prefix}_confirmer`;
      try {
        await client.$connect();
        const operatingFixture = await seedOperatingLedgerFixture(client, {
          prefix,
          preparerUserId,
          attesterUserId,
          confirmerUserId
        });
        await client.clearingCase.create({
          data: {
            id: caseId,
            projectId: operatingFixture.projectId,
            constructionEnterpriseAssignmentId: operatingFixture.assignmentId,
            category: "management_fee",
            governedSubjectKey: `${prefix}_subject`,
            authoritativeGrossCapCents: 1000n,
            createdByUserId: preparerUserId
          }
        });
        const selectionRefs = new AffiliateClearingSelectionRefService({
          secret: `${prefix}_selection_secret`
        });
        const actors = {
          preparerUserId,
          attesterUserId,
          confirmerUserId
        };
        const service = clearingService(client, actors, selectionRefs);
        const prepared = eventResult(await service.createEvent(
          preparerUserId,
          caseId,
          {
            idempotencyKey: randomUUID(),
            expectedRevision: 1,
            kind: "pending_reconciliation",
            amountCents: "100",
            evidenceLevel: "B",
            reconciliationIntent: {
              operation: "open_item",
              itemDefinition: {
                mode: "independent",
                amountCents: "100"
              },
              coverages: []
            }
          }
        ));
        const draft = await requiredVersion(client, prepared.versionId);
        const submitted = eventResult(await service.submitEvent(
          preparerUserId,
          prepared.id,
          {
            idempotencyKey: randomUUID(),
            expectedRevision: prepared.revision,
            eventVersionId: draft.id,
            expectedFingerprint: draft.fingerprint
          }
        ));
        const submittedVersion = await requiredVersion(
          client,
          submitted.versionId
        );
        const attested = eventResult(await service.attestEvent(
          attesterUserId,
          prepared.id,
          {
            idempotencyKey: randomUUID(),
            expectedRevision: submitted.revision,
            eventVersionId: submittedVersion.id,
            expectedFingerprint: submittedVersion.fingerprint
          }
        ));
        const currentCase = await client.clearingCase.findUniqueOrThrow({
          where: { id: caseId },
          select: { revision: true }
        });
        await service.confirmEvent(confirmerUserId, prepared.id, {
          idempotencyKey: randomUUID(),
          expectedRevision: attested.revision,
          expectedCaseRevision: currentCase.revision,
          eventVersionId: submittedVersion.id,
          expectedFingerprint: submittedVersion.fingerprint,
          confirmed: true
        });

        const [proof] = await client.$queryRaw<Array<{
          confirmationCount: bigint;
          itemCount: bigint;
          revisionCount: bigint;
          companionWithheldCount: bigint;
          coverageCount: bigint;
          sealCount: bigint;
          openAmountCents: bigint;
        }>>(Prisma.sql`
          SELECT
            (SELECT COUNT(*) FROM "ClearingConfirmation"
              WHERE "eventVersionId" = ${submittedVersion.id}) AS "confirmationCount",
            (SELECT COUNT(*) FROM "ClearingReconciliationItem"
              WHERE "openingDecisionEventVersionId" = ${submittedVersion.id}) AS "itemCount",
            (SELECT COUNT(*) FROM "ClearingReconciliationRevision"
              WHERE "decisionEventVersionId" = ${submittedVersion.id}) AS "revisionCount",
            (SELECT COUNT(*)
              FROM "ClearingReconciliationCoverage" coverage
              JOIN "ClearingEventVersion" withheld_version
                ON withheld_version.id = coverage."withheldEventVersionId"
              JOIN "ClearingEvent" withheld_event
                ON withheld_event.id = withheld_version."clearingEventId"
              WHERE coverage."decisionEventVersionId" = ${submittedVersion.id}
                AND withheld_event.kind = 'withheld'
                AND withheld_event."workflowStatus" = 'confirmed') AS "companionWithheldCount",
            (SELECT COUNT(*) FROM "ClearingReconciliationCoverage"
              WHERE "decisionEventVersionId" = ${submittedVersion.id}) AS "coverageCount",
            (SELECT COUNT(*) FROM "ClearingReconciliationDecisionSeal"
              WHERE "decisionEventVersionId" = ${submittedVersion.id}) AS "sealCount",
            (SELECT "amountCents" FROM "ClearingReconciliationRevision"
              WHERE "decisionEventVersionId" = ${submittedVersion.id}) AS "openAmountCents"
        `);
        assert.deepEqual(proof, {
          confirmationCount: 1n,
          itemCount: 1n,
          revisionCount: 1n,
          companionWithheldCount: 1n,
          coverageCount: 1n,
          sealCount: 1n,
          openAmountCents: 100n
        });

        const openedRevision = await client.clearingReconciliationRevision.findUniqueOrThrow({
          where: { decisionEventVersionId: submittedVersion.id }
        });
        const coverage = await client.clearingReconciliationCoverage.findFirstOrThrow({
          where: { decisionEventVersionId: submittedVersion.id }
        });
        const beforeResolution = await client.clearingCase.findUniqueOrThrow({
          where: { id: caseId },
          select: { revision: true }
        });
        const coverageSelectionRef = selectionRefs.issue({
          actorUserId: preparerUserId,
          authorityVersionId: caseId,
          authorityFingerprint: caseId,
          purpose: "allocation",
          selectedKey: coverage.id,
          revision: beforeResolution.revision
        });
        const finalDecision = await confirmV1Event(client, service, actors, {
          caseId,
          expectedCaseRevision: beforeResolution.revision,
          kind: "final_confirmed",
          amountCents: "40",
          reconciliationIntent: {
            operation: "resolve",
            resolutions: [{
              reconciliationRevisionId: openedRevision.id,
              amountCents: "40",
              lines: [{
                sourceKind: "withheld_coverage",
                sourceSelectionRef: coverageSelectionRef,
                amountCents: "40"
              }]
            }],
            ordinaryAllocations: []
          }
        });
        const originalResolution = await client.clearingReconciliationResolution.findUniqueOrThrow({
          where: {
            decisionEventVersionId_intentItemNo: {
              decisionEventVersionId: finalDecision.versionId,
              intentItemNo: 1
            }
          },
          include: { lines: true }
        });
        const beforeReversal = await client.clearingCase.findUniqueOrThrow({
          where: { id: caseId },
          select: { revision: true }
        });
        const reversalDecision = await confirmV1Event(client, service, actors, {
          caseId,
          expectedCaseRevision: beforeReversal.revision,
          kind: "technical_reversal",
          amountCents: "15",
          reconciliationIntent: {
            operation: "reverse_resolution",
            reversals: [{
              resolutionId: originalResolution.id,
              amountCents: "15",
              lines: [{
                resolutionLineId: originalResolution.lines[0]!.id,
                amountCents: "15"
              }]
            }]
          }
        });
        const [reversalProof] = await client.$queryRaw<Array<{
          openAmountCents: bigint;
          netAllocatedCents: bigint;
          reversalResolutionCents: bigint;
          reversedImpactCount: bigint;
          reversedImpactAmountCents: bigint;
        }>>(Prisma.sql`
          SELECT
            (
              revision."amountCents" - COALESCE(SUM(
                CASE WHEN resolution."entryKind" = 'resolution'
                  THEN resolution."amountCents" ELSE -resolution."amountCents" END
              ), 0)
            )::bigint AS "openAmountCents",
            (SELECT COALESCE(SUM(CASE WHEN allocation."reversesAllocationId" IS NULL
              THEN allocation."amountCents" ELSE -allocation."amountCents" END), 0)::bigint
              FROM "ClearingAllocation" allocation
              WHERE allocation."sourceEventVersionId" = ${coverage.withheldEventVersionId}) AS "netAllocatedCents",
            (SELECT "amountCents" FROM "ClearingReconciliationResolution"
              WHERE "decisionEventVersionId" = ${reversalDecision.versionId}) AS "reversalResolutionCents",
            (SELECT COUNT(*) FROM "ClearingImpactLink"
              WHERE "eventVersionId" = ${reversalDecision.versionId}
                AND "reversesImpactId" IS NOT NULL) AS "reversedImpactCount",
            (SELECT COALESCE(SUM("amountCents"), 0)::bigint FROM "ClearingImpactLink"
              WHERE "eventVersionId" = ${reversalDecision.versionId}
                AND "reversesImpactId" IS NOT NULL) AS "reversedImpactAmountCents"
          FROM "ClearingReconciliationRevision" revision
          LEFT JOIN "ClearingReconciliationResolution" resolution
            ON resolution."reconciliationRevisionId" = revision.id
          WHERE revision.id = ${openedRevision.id}
          GROUP BY revision.id, revision."amountCents"
        `);
        assert.deepEqual(reversalProof, {
          openAmountCents: 75n,
          netAllocatedCents: 25n,
          reversalResolutionCents: 15n,
          reversedImpactCount: 3n,
          reversedImpactAmountCents: 45n
        });

        const competing = [];
        for (let index = 0; index < 2; index += 1) {
          const current = await client.clearingCase.findUniqueOrThrow({
            where: { id: caseId },
            select: { revision: true }
          });
          const selectionRef = selectionRefs.issue({
            actorUserId: preparerUserId,
            authorityVersionId: caseId,
            authorityFingerprint: caseId,
            purpose: "allocation",
            selectedKey: coverage.id,
            revision: current.revision
          });
          competing.push(await prepareAndAttestV1Event(client, service, actors, {
            caseId,
            expectedCaseRevision: current.revision,
            kind: "final_confirmed",
            amountCents: "50",
            reconciliationIntent: {
              operation: "resolve",
              resolutions: [{
                reconciliationRevisionId: openedRevision.id,
                amountCents: "50",
                lines: [{
                  sourceKind: "withheld_coverage",
                  sourceSelectionRef: selectionRef,
                  amountCents: "50"
                }]
              }],
              ordinaryAllocations: []
            }
          }));
        }
        const concurrencyCase = await client.clearingCase.findUniqueOrThrow({
          where: { id: caseId },
          select: { revision: true }
        });
        const concurrentResults = await Promise.allSettled(
          competing.map((candidate) => service.confirmEvent(
            confirmerUserId,
            candidate.eventId,
            {
              idempotencyKey: randomUUID(),
              expectedRevision: candidate.eventRevision,
              expectedCaseRevision: concurrencyCase.revision,
              eventVersionId: candidate.versionId,
              expectedFingerprint: candidate.fingerprint,
              confirmed: true
            }
          ))
        );
        assert.equal(
          concurrentResults.filter((result) => result.status === "fulfilled").length,
          1
        );
        assert.equal(
          concurrentResults.filter((result) => result.status === "rejected").length,
          1
        );
        const [concurrencyProof] = await client.$queryRaw<Array<{
          openAmountCents: bigint;
          netAllocatedCents: bigint;
          occupancyCents: bigint;
        }>>(Prisma.sql`
          SELECT
            (
              revision."amountCents" - COALESCE(SUM(
                CASE WHEN resolution."entryKind" = 'resolution'
                  THEN resolution."amountCents" ELSE -resolution."amountCents" END
              ), 0)
            )::bigint AS "openAmountCents",
            (SELECT COALESCE(SUM(CASE WHEN allocation."reversesAllocationId" IS NULL
              THEN allocation."amountCents" ELSE -allocation."amountCents" END), 0)::bigint
              FROM "ClearingAllocation" allocation
              WHERE allocation."sourceEventVersionId" = ${coverage.withheldEventVersionId}) AS "netAllocatedCents",
            public."pol275_active_coverage_occupancy"(${coverage.withheldEventVersionId}) AS "occupancyCents"
          FROM "ClearingReconciliationRevision" revision
          LEFT JOIN "ClearingReconciliationResolution" resolution
            ON resolution."reconciliationRevisionId" = revision.id
          WHERE revision.id = ${openedRevision.id}
          GROUP BY revision.id, revision."amountCents"
        `);
        assert.deepEqual(concurrencyProof, {
          openAmountCents: 25n,
          netAllocatedCents: 75n,
          occupancyCents: 25n
        });
      } finally {
        await client.$disconnect();
      }
    },
    90_000
  );

  integrationTest(
    "denies runtime direct DML, trigger mutation and SET ROLE to the definer owner",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const client = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const probeRole = `pol275_probe_${randomUUID().replace(/-/gu, "")}`;
      const probePassword = randomUUID();
      const probeUrl = new URL(databaseUrl);
      probeUrl.username = probeRole;
      probeUrl.password = probePassword;
      const probeClient = new PrismaClient({
        datasources: { db: { url: probeUrl.toString() } }
      });
      try {
        await client.$connect();
        await client.$executeRawUnsafe(
          `CREATE ROLE "${probeRole}" LOGIN INHERIT PASSWORD '${probePassword}'`
        );
        await client.$executeRawUnsafe(
          `GRANT "jg_pol275_runtime" TO "${probeRole}"`
        );
        await probeClient.$connect();
        const [probeIdentity] = await probeClient.$queryRaw<Array<{
          sessionUser: string;
          currentUser: string;
          runtimeMember: boolean;
          ownerMember: boolean;
        }>>(Prisma.sql`
          SELECT
            session_user AS "sessionUser",
            current_user AS "currentUser",
            pg_has_role(current_user, 'jg_pol275_runtime', 'MEMBER') AS "runtimeMember",
            pg_has_role(current_user, 'jg_pol275_owner', 'MEMBER') AS "ownerMember"
        `);
        assert.deepEqual(probeIdentity, {
          sessionUser: probeRole,
          currentUser: probeRole,
          runtimeMember: true,
          ownerMember: false
        });
        await expect(
          probeClient.$executeRawUnsafe(
            `INSERT INTO "ClearingReconciliationItem" ("id") VALUES ('forbidden')`
          )
        ).rejects.toThrow(/permission denied/iu);
        await expect(
          probeClient.$executeRawUnsafe(
            `ALTER TABLE "ClearingReconciliationItem" DISABLE TRIGGER ALL`
          )
        ).rejects.toThrow(/permission denied|must be owner/iu);
        await expect(
          probeClient.$executeRawUnsafe(`SET ROLE "jg_pol275_owner"`)
        ).rejects.toThrow(/permission denied/iu);
        const [roles] = await client.$queryRaw<Array<{
          ownerCanLogin: boolean;
          runtimeCanLogin: boolean;
          ownerMemberships: bigint;
        }>>(Prisma.sql`
          SELECT
            (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'jg_pol275_owner') AS "ownerCanLogin",
            (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'jg_pol275_runtime') AS "runtimeCanLogin",
            (SELECT COUNT(*) FROM pg_auth_members members
              JOIN pg_roles granted ON granted.oid = members.roleid
              WHERE granted.rolname = 'jg_pol275_owner') AS "ownerMemberships"
        `);
        assert.deepEqual(roles, {
          ownerCanLogin: false,
          runtimeCanLogin: false,
          ownerMemberships: 0n
        });
      } finally {
        await probeClient.$disconnect().catch(() => undefined);
        await client.$executeRawUnsafe(
          `DROP ROLE IF EXISTS "${probeRole}"`
        ).catch(() => undefined);
        await client.$disconnect();
      }
    },
    90_000
  );

  integrationTest(
    "keeps the no-V1 confirm contract and refuses partial-withheld auto-pairing",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const client = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const prefix = `pol275_legacy_${randomUUID().replace(/-/gu, "")}`;
      const caseId = `${prefix}_case`;
      const preparerUserId = `${prefix}_preparer`;
      const attesterUserId = `${prefix}_attester`;
      const confirmerUserId = `${prefix}_confirmer`;
      try {
        await client.$connect();
        const operatingFixture = await seedOperatingLedgerFixture(client, {
          prefix,
          preparerUserId,
          attesterUserId,
          confirmerUserId
        });
        await client.clearingCase.create({
          data: {
            id: caseId,
            projectId: operatingFixture.projectId,
            constructionEnterpriseAssignmentId: operatingFixture.assignmentId,
            category: "management_fee",
            governedSubjectKey: `${prefix}_subject`,
            authoritativeGrossCapCents: 1000n,
            createdByUserId: preparerUserId
          }
        });
        const actors = {
          preparerUserId,
          attesterUserId,
          confirmerUserId
        };
        const service = clearingService(client, actors);
        const legacyVersionId = await confirmLegacyEvent(service, actors, {
          caseId,
          expectedCaseRevision: 1,
          kind: "withheld",
          amountCents: "30"
        });
        assert.equal(
          await client.clearingConfirmation.count({
            where: { eventVersionId: legacyVersionId }
          }),
          1
        );
        const currentCase = await client.clearingCase.findUniqueOrThrow({
          where: { id: caseId },
          select: { revision: true }
        });
        await expect(service.createEvent(preparerUserId, caseId, {
          idempotencyKey: randomUUID(),
          expectedRevision: currentCase.revision,
          kind: "pending_reconciliation",
          amountCents: "50",
          evidenceLevel: "B",
          reconciliationIntent: {
            operation: "open_item",
            itemDefinition: {
              mode: "independent",
              amountCents: "50"
            },
            coverages: []
          }
        })).rejects.toThrow(/已有可用暂扣.*显式选择覆盖/iu);
        assert.equal(
          await client.clearingEvent.count({
            where: { clearingCaseId: caseId, kind: "pending_reconciliation" }
          }),
          0
        );
      } finally {
        await client.$disconnect();
      }
    },
    90_000
  );
});

function clearingService(
  client: PrismaClient,
  actors: {
    preparerUserId: string;
    attesterUserId: string;
    confirmerUserId: string;
  },
  selectionRefs?: AffiliateClearingSelectionRefService
) {
  const roleResolver = {
    resolveActiveRoleScopes: jest.fn(async (userId: string) =>
      userId === actors.confirmerUserId
        ? ["finance_director"]
        : ["finance_staff"]
    )
  };
  return new ClearingService(
    client as never,
    roleResolver as never,
    new OperatingLedgerService(client as never),
    new AuditService(client as never),
    undefined,
    selectionRefs
  );
}

async function confirmV1Event(
  client: PrismaClient,
  service: ClearingService,
  actors: {
    preparerUserId: string;
    attesterUserId: string;
    confirmerUserId: string;
  },
  input: {
    caseId: string;
    expectedCaseRevision: number;
    kind: "final_confirmed" | "technical_reversal";
    amountCents: string;
    reconciliationIntent: Record<string, unknown>;
  }
): Promise<{ eventId: string; versionId: string }> {
  const prepared = await prepareAndAttestV1Event(
    client,
    service,
    actors,
    input
  );
  const currentCase = await client.clearingCase.findUniqueOrThrow({
    where: { id: input.caseId },
    select: { revision: true }
  });
  await service.confirmEvent(actors.confirmerUserId, prepared.eventId, {
    idempotencyKey: randomUUID(),
    expectedRevision: prepared.eventRevision,
    expectedCaseRevision: currentCase.revision,
    eventVersionId: prepared.versionId,
    expectedFingerprint: prepared.fingerprint,
    confirmed: true
  });
  return { eventId: prepared.eventId, versionId: prepared.versionId };
}

async function prepareAndAttestV1Event(
  client: PrismaClient,
  service: ClearingService,
  actors: {
    preparerUserId: string;
    attesterUserId: string;
    confirmerUserId: string;
  },
  input: {
    caseId: string;
    expectedCaseRevision: number;
    kind: "final_confirmed" | "technical_reversal";
    amountCents: string;
    reconciliationIntent: Record<string, unknown>;
  }
): Promise<{
  eventId: string;
  versionId: string;
  fingerprint: string;
  eventRevision: number;
}> {
  const prepared = eventResult(await service.createEvent(
    actors.preparerUserId,
    input.caseId,
    {
      idempotencyKey: randomUUID(),
      expectedRevision: input.expectedCaseRevision,
      kind: input.kind,
      amountCents: input.amountCents,
      evidenceLevel: "B",
      reconciliationIntent: input.reconciliationIntent
    }
  ));
  const draft = await requiredVersion(client, prepared.versionId);
  const submitted = eventResult(await service.submitEvent(
    actors.preparerUserId,
    prepared.id,
    {
      idempotencyKey: randomUUID(),
      expectedRevision: prepared.revision,
      eventVersionId: draft.id,
      expectedFingerprint: draft.fingerprint
    }
  ));
  const submittedVersion = await requiredVersion(client, submitted.versionId);
  const attested = eventResult(await service.attestEvent(
    actors.attesterUserId,
    prepared.id,
    {
      idempotencyKey: randomUUID(),
      expectedRevision: submitted.revision,
      eventVersionId: submittedVersion.id,
      expectedFingerprint: submittedVersion.fingerprint
    }
  ));
  return {
    eventId: prepared.id,
    versionId: submittedVersion.id,
    fingerprint: submittedVersion.fingerprint,
    eventRevision: attested.revision
  };
}

async function confirmLegacyEvent(
  service: ClearingService,
  actors: {
    preparerUserId: string;
    attesterUserId: string;
    confirmerUserId: string;
  },
  input: {
    caseId: string;
    expectedCaseRevision: number;
    kind: "withheld";
    amountCents: string;
  }
): Promise<string> {
  const prepared = eventResult(await service.createEvent(
    actors.preparerUserId,
    input.caseId,
    {
      idempotencyKey: randomUUID(),
      expectedRevision: input.expectedCaseRevision,
      kind: input.kind,
      amountCents: input.amountCents,
      evidenceLevel: "A",
      payload: { reason: "POL-275 no-V1 compatibility probe" }
    }
  ));
  const submitted = eventResult(await service.submitEvent(
    actors.preparerUserId,
    prepared.id,
    {
      idempotencyKey: randomUUID(),
      expectedRevision: prepared.revision
    }
  ));
  await service.confirmEvent(actors.confirmerUserId, prepared.id, {
    idempotencyKey: randomUUID(),
    expectedRevision: submitted.revision
  });
  return submitted.versionId;
}

async function seedOperatingLedgerFixture(
  client: PrismaClient,
  fixture: {
    prefix: string;
    preparerUserId: string;
    attesterUserId: string;
    confirmerUserId: string;
  }
): Promise<{ projectId: string; assignmentId: string }> {
  const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
  if (!secret) {
    throw new Error("POL-275 PostgreSQL 测试缺少一次性经营账写入密钥");
  }
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "OperatingLedgerWriteSecret" ("id", "secretHash")
    VALUES (1, crypt(${secret}, gen_salt('bf')))
    ON CONFLICT ("id") DO UPDATE SET "secretHash" = EXCLUDED."secretHash"
  `);
  for (const userId of [
    fixture.preparerUserId,
    fixture.attesterUserId,
    fixture.confirmerUserId
  ]) {
    await client.$executeRaw(Prisma.sql`
      INSERT INTO "User" ("id", "name", "mustChangePassword", "isActive", "updatedAt")
      VALUES (${userId}, 'POL-275核对动态测试用户', FALSE, TRUE, CURRENT_TIMESTAMP)
    `);
  }
  const audit = new AuditService(client as never);
  const projects = new ProjectService(client as never, audit);
  const project = await projects.createProject(fixture.preparerUserId, {
    code: fixture.prefix,
    name: "POL-275核对动态测试项目"
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
      name: "POL-275施工企业测试主体",
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
      changeReason: "POL-275清算核对动态验收"
    }
  );
  const company = await client.companyEntity.create({
    data: {
      id: `${fixture.prefix}_company`,
      name: "POL-275我方参与公司",
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
  const profile = new ProjectOperatingProfileService(
    client as never,
    audit
  );
  await profile.addParticipatingCompany(project.id, fixture.preparerUserId, {
    companyEntityId: company.id,
    effectiveFrom: "2026-08-01",
    changeReason: "POL-275清算核对动态验收"
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

async function requiredVersion(client: PrismaClient, id: string) {
  return client.clearingEventVersion.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      fingerprint: true
    }
  });
}

function assertDedicatedDatabase(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || process.env.NODE_ENV === "production") {
    throw new Error("POL-275 测试必须连接非生产隔离数据库");
  }
  const parsed = new URL(databaseUrl);
  if (
    !["postgresql:", "postgres:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) ||
    parsed.pathname !== "/jiangkong_pol275"
  ) {
    throw new Error("POL-275 测试只允许本机固定一次性 PostgreSQL 16 数据库");
  }
  return databaseUrl;
}
