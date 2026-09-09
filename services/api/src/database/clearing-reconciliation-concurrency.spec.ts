import { createHash, randomUUID } from "node:crypto";
import * as assert from "node:assert/strict";

import { Prisma, PrismaClient } from "@prisma/client";

import { AuditService } from "../audit/audit.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { AffiliateClearingAuthorityService } from "../clearing/affiliate-clearing-authority.service";
import { AffiliateClearingSelectionRefService } from "../clearing/affiliate-clearing-selection-ref.service";
import { ClearingService } from "../clearing/clearing.service";
import { ClearingReconciliationReaderService } from "../clearing/clearing-reconciliation-reader.service";
import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import { ProjectOperatingProfileService } from "../project/project-operating-profile.service";
import { ProjectAffiliateCompanyContractService } from "../project/project-affiliate-company-contract.service";
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
        const confirmationInput = {
          idempotencyKey: randomUUID(),
          expectedRevision: attested.revision,
          expectedCaseRevision: currentCase.revision,
          eventVersionId: submittedVersion.id,
          expectedFingerprint: submittedVersion.fingerprint,
          confirmed: true as const
        };
        const confirmed = await service.confirmEvent(
          confirmerUserId,
          prepared.id,
          confirmationInput
        );
        const replayed = await service.confirmEvent(
          confirmerUserId,
          prepared.id,
          confirmationInput
        );
        assert.deepEqual(replayed, confirmed);

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
    "persists T1-T5 partial, continued, reversal and real-return history with stable as-of reads",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const client = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const prefix = `pol275_timeline_${randomUUID().replace(/-/gu, "")}`;
      const caseId = `${prefix}_case`;
      const actors = {
        preparerUserId: `${prefix}_preparer`,
        attesterUserId: `${prefix}_attester`,
        confirmerUserId: `${prefix}_confirmer`
      };
      try {
        await client.$connect();
        const fixture = await seedOperatingLedgerFixture(client, {
          prefix,
          ...actors
        });
        const clearingCase = await client.clearingCase.create({
          data: {
            id: caseId,
            projectId: fixture.projectId,
            constructionEnterpriseAssignmentId: fixture.assignmentId,
            category: "management_fee",
            governedSubjectKey: `${prefix}_subject`,
            authoritativeGrossCapCents: 1000n,
            createdByUserId: actors.preparerUserId
          }
        });
        const selectionRefs = new AffiliateClearingSelectionRefService({
          secret: `${prefix}_selection_secret`
        });
        const service = clearingService(client, actors, selectionRefs);
        const t1 = await confirmV1Event(client, service, actors, {
          caseId,
          expectedCaseRevision: clearingCase.revision,
          kind: "pending_reconciliation",
          amountCents: "100",
          reconciliationIntent: {
            operation: "open_item",
            itemDefinition: { mode: "independent", amountCents: "100" },
            coverages: []
          }
        });
        const revision = await client.clearingReconciliationRevision.findUniqueOrThrow({
          where: { decisionEventVersionId: t1.versionId }
        });
        const coverage = await client.clearingReconciliationCoverage.findFirstOrThrow({
          where: { decisionEventVersionId: t1.versionId }
        });
        const timeline: Date[] = [await confirmationTime(client, t1.versionId)];
        await client.$queryRaw`SELECT 1 AS slept FROM pg_sleep(0.01)`;

        const beforeT2 = await client.clearingCase.findUniqueOrThrow({
          where: { id: caseId },
          select: { revision: true }
        });
        const t2 = await confirmV1Event(client, service, actors, {
          caseId,
          expectedCaseRevision: beforeT2.revision,
          kind: "final_confirmed",
          amountCents: "40",
          reconciliationIntent: {
            operation: "resolve",
            resolutions: [{
              reconciliationRevisionId: revision.id,
              amountCents: "40",
              lines: [{
                sourceKind: "withheld_coverage",
                sourceSelectionRef: issueAllocationSelection(
                  selectionRefs,
                  actors.preparerUserId,
                  caseId,
                  beforeT2.revision,
                  coverage.id
                ),
                amountCents: "40"
              }]
            }],
            ordinaryAllocations: []
          }
        });
        const finalResolution = await client.clearingReconciliationResolution.findUniqueOrThrow({
          where: {
            decisionEventVersionId_intentItemNo: {
              decisionEventVersionId: t2.versionId,
              intentItemNo: 1
            }
          },
          include: { lines: true }
        });
        timeline.push(await confirmationTime(client, t2.versionId));
        await client.$queryRaw`SELECT 1 AS slept FROM pg_sleep(0.01)`;

        const beforeT3 = await client.clearingCase.findUniqueOrThrow({
          where: { id: caseId }, select: { revision: true }
        });
        const t3 = await confirmV1Event(client, service, actors, {
          caseId,
          expectedCaseRevision: beforeT3.revision,
          kind: "continued_withheld",
          amountCents: "20",
          reconciliationIntent: {
            operation: "resolve",
            resolutions: [{
              reconciliationRevisionId: revision.id,
              amountCents: "20",
              lines: [{
                sourceKind: "withheld_coverage",
                sourceSelectionRef: issueAllocationSelection(
                  selectionRefs,
                  actors.preparerUserId,
                  caseId,
                  beforeT3.revision,
                  coverage.id
                ),
                amountCents: "20"
              }]
            }],
            ordinaryAllocations: []
          }
        });
        timeline.push(await confirmationTime(client, t3.versionId));
        const [continuedOccupancy] = await client.$queryRaw<Array<{
          amountCents: bigint;
        }>>(Prisma.sql`
          SELECT public."pol275_active_coverage_occupancy"(
            ${coverage.withheldEventVersionId}
          ) AS "amountCents"
        `);
        assert.equal(continuedOccupancy?.amountCents, 60n);
        await client.$queryRaw`SELECT 1 AS slept FROM pg_sleep(0.01)`;

        const beforeT4 = await client.clearingCase.findUniqueOrThrow({
          where: { id: caseId }, select: { revision: true }
        });
        const t4Candidate = await prepareAndAttestV1Event(client, service, actors, {
          caseId,
          expectedCaseRevision: beforeT4.revision,
          kind: "technical_reversal",
          amountCents: "10",
          reconciliationIntent: {
            operation: "reverse_resolution",
            reversals: [{
              resolutionId: finalResolution.id,
              amountCents: "10",
              lines: [{
                resolutionLineId: finalResolution.lines[0]!.id,
                amountCents: "10"
              }]
            }]
          }
        });
        const reverseDelegateeUserId = `${prefix}_reverse_delegatee`;
        await client.user.create({
          data: {
            id: reverseDelegateeUserId,
            name: "POL-275技术反向受托人",
            mustChangePassword: false,
            isActive: true
          }
        });
        const financeStaffPosition = await client.position.findUniqueOrThrow({
          where: { key: "finance_staff" },
          select: { id: true }
        });
        await client.userPosition.create({
          data: {
            userId: reverseDelegateeUserId,
            positionId: financeStaffPosition.id,
            projectId: null
          }
        });
        await client.approvalDelegation.create({
          data: {
            id: randomUUID(),
            fromUserId: actors.confirmerUserId,
            toUserId: reverseDelegateeUserId,
            actionKey: "clearing.reconciliation.reverse",
            resourceType: "clearing_event",
            resourceId: t4Candidate.eventId,
            startsAt: new Date(Date.now() - 60_000),
            endsAt: new Date(Date.now() + 60_000),
            enabled: true
          }
        });
        const reverseGuard = new PermissionGuard(
          {
            getAllAndOverride: jest.fn()
              .mockReturnValueOnce(undefined)
              .mockReturnValueOnce("clearing.confirm")
              .mockReturnValueOnce(undefined)
          } as never,
          client as never,
          undefined,
          new CompanyRoleResolverService(client as never)
        );
        await expect(reverseGuard.canActivate({
          getHandler: () => (() => undefined),
          getClass: () => ({}),
          switchToHttp: () => ({
            getRequest: () => ({
              user: { id: reverseDelegateeUserId },
              params: { eventId: t4Candidate.eventId },
              body: { delegatorUserId: actors.confirmerUserId }
            })
          })
        } as never)).resolves.toBe(true);
        const readyT4CaseRevision = await currentCaseRevision(client, caseId);
        const t4 = eventResult(await service.confirmEvent(
          reverseDelegateeUserId,
          t4Candidate.eventId,
          {
            idempotencyKey: randomUUID(),
            expectedRevision: t4Candidate.eventRevision,
            expectedCaseRevision: readyT4CaseRevision,
            eventVersionId: t4Candidate.versionId,
            expectedFingerprint: t4Candidate.fingerprint,
            delegatorUserId: actors.confirmerUserId,
            confirmed: true
          }
        ));
        timeline.push(await confirmationTime(client, t4.versionId));
        await client.$queryRaw`SELECT 1 AS slept FROM pg_sleep(0.01)`;

        const beforeT5 = await client.clearingCase.findUniqueOrThrow({
          where: { id: caseId }, select: { revision: true }
        });
        const t5 = await confirmV1Event(client, service, actors, {
          caseId,
          expectedCaseRevision: beforeT5.revision,
          kind: "returned",
          amountCents: "50",
          reconciliationIntent: {
            operation: "resolve",
            resolutions: [{
              reconciliationRevisionId: revision.id,
              amountCents: "50",
              lines: [{
                sourceKind: "withheld_coverage",
                sourceSelectionRef: issueAllocationSelection(
                  selectionRefs,
                  actors.preparerUserId,
                  caseId,
                  beforeT5.revision,
                  coverage.id
                ),
                amountCents: "50"
              }]
            }],
            ordinaryAllocations: []
          }
        });
        timeline.push(await confirmationTime(client, t5.versionId));

        const reader = new ClearingReconciliationReaderService(
          client as never,
          {} as never
        );
        const expectedRisks = [
          [100n, 100n, 0n],
          [60n, 60n, 0n],
          [40n, 40n, 20n],
          [50n, 50n, 20n],
          [0n, 0n, 20n]
        ] as const;
        for (const [index, asOf] of timeline.entries()) {
          const risk = await reader.readClearingReconciliationRiskInTransaction(
            client as never,
            { projectId: fixture.projectId, asOf }
          );
          assert.equal(risk.openPendingGrossCents, expectedRisks[index]![0]);
          assert.equal(risk.openCoveredCents, expectedRisks[index]![1]);
          assert.equal(
            risk.continuedWithheldRetainedCents,
            expectedRisks[index]![2]
          );
        }

        const impactSets = await client.clearingImpactLink.groupBy({
          by: ["eventVersionId"],
          where: {
            eventVersionId: {
              in: [t2.versionId, t3.versionId, t4.versionId, t5.versionId]
            }
          },
          _count: { _all: true }
        });
        assert.deepEqual(
          Object.fromEntries(impactSets.map((row) => [
            row.eventVersionId,
            row._count._all
          ])),
          {
            [t2.versionId]: 3,
            [t4.versionId]: 3,
            [t5.versionId]: 1
          }
        );
        assert.equal(
          await client.clearingReconciliationDecisionSeal.count({
            where: {
              decisionEventVersionId: {
                in: [t1.versionId, t2.versionId, t3.versionId, t4.versionId, t5.versionId]
              }
            }
          }),
          5
        );
      } finally {
        await client.$disconnect();
      }
    },
    90_000
  );

  integrationTest(
    "closes mixed withheld and authority-cap lines and reverses a prior economic source exactly",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      const prefix = `pol275_mixed_${randomUUID().replace(/-/gu, "")}`;
      const actors = {
        preparerUserId: `${prefix}_preparer`,
        attesterUserId: `${prefix}_attester`,
        confirmerUserId: `${prefix}_confirmer`
      };
      try {
        await client.$connect();
        const jcsVector = {
          "\uE000": ["x", 1, true],
          "😀": null,
          a: "9223372036854775807"
        };
        const expectedCanonicalJcs =
          '{"a":"9223372036854775807","😀":null,"":["x",1,true]}';
        const [jcsGolden] = await client.$queryRaw<Array<{
          canonical: string;
          hash: string;
        }>>(Prisma.sql`
          SELECT
            public."pol275_jcs_v1"(${JSON.stringify(jcsVector)}::jsonb) AS canonical,
            encode(public.digest(convert_to(
              'pol275/relation-set/V1' || chr(10) ||
              public."pol275_jcs_v1"(${JSON.stringify(jcsVector)}::jsonb),
              'UTF8'
            ), 'sha256'), 'hex') AS hash
        `);
        assert.equal(jcsGolden?.canonical, expectedCanonicalJcs);
        assert.equal(
          jcsGolden?.hash,
          createHash("sha256")
            .update(`pol275/relation-set/V1\n${expectedCanonicalJcs}`, "utf8")
            .digest("hex")
        );
        const fixture = await seedOperatingLedgerFixture(client, { prefix, ...actors });
        const selectionRefs = new AffiliateClearingSelectionRefService({ secret: `${prefix}_secret` });
        const authorityFixture = await createAuthorityBackedClearingCase(
          client,
          actors,
          fixture,
          selectionRefs,
          prefix
        );
        const clearingCase = authorityFixture.clearingCase;
        const service = authorityFixture.service;
        const caseId = clearingCase.id;
        const withheld = await confirmLegacyEvent(service, actors, {
          caseId,
          expectedCaseRevision: clearingCase.revision,
          kind: "withheld",
          amountCents: "40",
          businessReason: "按已确认保证金权威来源记录本次暂扣",
          requiresAttestation: true
        });
        let caseRevision = (await client.clearingCase.findUniqueOrThrow({ where: { id: caseId }, select: { revision: true } })).revision;
        const open = await confirmV1Event(client, service, actors, {
          caseId,
          expectedCaseRevision: caseRevision,
          kind: "pending_reconciliation",
          amountCents: "100",
          reconciliationIntent: {
            operation: "open_item",
            itemDefinition: { mode: "independent", amountCents: "100" },
            coverages: [{
              sourceSelectionRef: selectionRefs.issue({
                actorUserId: actors.preparerUserId,
                authorityVersionId: clearingCase.authorityVersionId!,
                authorityFingerprint: clearingCase.authoritySnapshotRef!,
                purpose: "allocation",
                selectedKey: withheld,
                revision: caseRevision
              }),
              amountCents: "40"
            }]
          }
        });
        const revision = await client.clearingReconciliationRevision.findUniqueOrThrow({ where: { decisionEventVersionId: open.versionId } });
        const coverage = await client.clearingReconciliationCoverage.findFirstOrThrow({ where: { decisionEventVersionId: open.versionId } });
        caseRevision = (await client.clearingCase.findUniqueOrThrow({ where: { id: caseId }, select: { revision: true } })).revision;
        const mixed = await confirmV1Event(client, service, actors, {
          caseId,
          expectedCaseRevision: caseRevision,
          kind: "final_confirmed",
          amountCents: "100",
          reconciliationIntent: {
            operation: "resolve",
            resolutions: [{
              reconciliationRevisionId: revision.id,
              amountCents: "100",
              lines: [
                {
                  sourceKind: "withheld_coverage",
                  sourceSelectionRef: selectionRefs.issue({
                    actorUserId: actors.preparerUserId,
                    authorityVersionId: clearingCase.authorityVersionId!,
                    authorityFingerprint: clearingCase.authoritySnapshotRef!,
                    purpose: "allocation",
                    selectedKey: coverage.id,
                    revision: caseRevision
                  }),
                  amountCents: "40"
                },
                {
                  sourceKind: "authority_cap",
                  sourceSelectionRef: selectionRefs.issue({
                    actorUserId: actors.preparerUserId,
                    authorityVersionId: clearingCase.authorityVersionId!,
                    authorityFingerprint: clearingCase.authoritySnapshotRef!,
                    purpose: "allocation",
                    selectedKey: caseId,
                    revision: caseRevision
                  }),
                  amountCents: "60"
                }
              ]
            }],
            ordinaryAllocations: []
          }
        });
        const mixedAllocations = await client.clearingAllocation.findMany({
          where: { eventVersionId: mixed.versionId },
          orderBy: { amountCents: "asc" }
        });
        assert.deepEqual(
          mixedAllocations.map((allocation) => [allocation.sourceKind, allocation.amountCents]),
          [["withheld", 40n], ["authority_cap", 60n]]
        );
        assert.equal(
          await client.clearingImpactLink.count({ where: { eventVersionId: mixed.versionId } }),
          3
        );

        caseRevision = (await client.clearingCase.findUniqueOrThrow({ where: { id: caseId }, select: { revision: true } })).revision;
        const returnOpen = await confirmV1Event(client, service, actors, {
          caseId,
          expectedCaseRevision: caseRevision,
          kind: "pending_reconciliation",
          amountCents: "30",
          reconciliationIntent: {
            operation: "open_item",
            itemDefinition: { mode: "addition", additionOfItemId: revision.itemId, amountCents: "30" },
            coverages: []
          }
        });
        const returnRevision = await client.clearingReconciliationRevision.findUniqueOrThrow({ where: { decisionEventVersionId: returnOpen.versionId } });
        const priorAllocation = mixedAllocations.find((allocation) => allocation.sourceKind === "authority_cap");
        assert.ok(priorAllocation);
        caseRevision = (await client.clearingCase.findUniqueOrThrow({ where: { id: caseId }, select: { revision: true } })).revision;
        const returned = await confirmV1Event(client, service, actors, {
          caseId,
          expectedCaseRevision: caseRevision,
          kind: "returned",
          amountCents: "30",
          reconciliationIntent: {
            operation: "resolve",
            resolutions: [{
              reconciliationRevisionId: returnRevision.id,
              amountCents: "30",
              lines: [{
                sourceKind: "prior_economic_event",
                sourceSelectionRef: selectionRefs.issue({
                  actorUserId: actors.preparerUserId,
                  authorityVersionId: clearingCase.authorityVersionId!,
                  authorityFingerprint: clearingCase.authoritySnapshotRef!,
                  purpose: "allocation",
                  selectedKey: priorAllocation.id,
                  revision: caseRevision
                }),
                amountCents: "30"
              }]
            }],
            ordinaryAllocations: []
          }
        });
        const returnedLinks = await client.clearingImpactLink.findMany({
          where: { eventVersionId: returned.versionId },
          orderBy: { sourceImpactKey: "asc" }
        });
        assert.deepEqual(returnedLinks.map((link) => link.sourceImpactKey), [
          "return-1:confirmed-cost-return",
          "return-1:construction-enterprise-funds-return"
        ]);
        assert.ok(returnedLinks.every((link) => link.reversesImpactId));
      } finally {
        await client.$disconnect();
      }
    },
    90_000
  );

  integrationTest(
    "supports explicit coverage, addition, replacement rollback and corrected first-open replacement",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const client = new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      });
      const prefix = `pol275_revision_${randomUUID().replace(/-/gu, "")}`;
      const caseId = `${prefix}_case`;
      const actors = {
        preparerUserId: `${prefix}_preparer`,
        attesterUserId: `${prefix}_attester`,
        confirmerUserId: `${prefix}_confirmer`
      };
      try {
        await client.$connect();
        const fixture = await seedOperatingLedgerFixture(client, {
          prefix,
          ...actors
        });
        const clearingCase = await client.clearingCase.create({
          data: {
            id: caseId,
            projectId: fixture.projectId,
            constructionEnterpriseAssignmentId: fixture.assignmentId,
            category: "management_fee",
            governedSubjectKey: `${prefix}_subject`,
            authoritativeGrossCapCents: 1000n,
            createdByUserId: actors.preparerUserId
          }
        });
        const selectionRefs = new AffiliateClearingSelectionRefService({
          secret: `${prefix}_selection_secret`
        });
        const service = clearingService(client, actors, selectionRefs);
        const withheld40 = await confirmLegacyEvent(service, actors, {
          caseId,
          expectedCaseRevision: clearingCase.revision,
          kind: "withheld",
          amountCents: "40"
        });
        let caseRevision = (await client.clearingCase.findUniqueOrThrow({
          where: { id: caseId }, select: { revision: true }
        })).revision;
        const withheld60 = await confirmLegacyEvent(service, actors, {
          caseId,
          expectedCaseRevision: caseRevision,
          kind: "withheld",
          amountCents: "60"
        });
        caseRevision = (await client.clearingCase.findUniqueOrThrow({
          where: { id: caseId }, select: { revision: true }
        })).revision;
        const opened = await confirmV1Event(client, service, actors, {
          caseId,
          expectedCaseRevision: caseRevision,
          kind: "pending_reconciliation",
          amountCents: "100",
          reconciliationIntent: {
            operation: "open_item",
            itemDefinition: { mode: "independent", amountCents: "100" },
            coverages: [{
              sourceSelectionRef: issueAllocationSelection(
                selectionRefs,
                actors.preparerUserId,
                caseId,
                caseRevision,
                withheld40
              ),
              amountCents: "40"
            }]
          }
        });
        const r1 = await client.clearingReconciliationRevision.findUniqueOrThrow({
          where: { decisionEventVersionId: opened.versionId },
          include: { item: true }
        });
        caseRevision = (await client.clearingCase.findUniqueOrThrow({
          where: { id: caseId }, select: { revision: true }
        })).revision;
        await confirmV1Event(client, service, actors, {
          caseId,
          expectedCaseRevision: caseRevision,
          kind: "coverage_added",
          amountCents: "60",
          reconciliationIntent: {
            operation: "add_coverage",
            targetRevisionId: r1.id,
            coverages: [{
              sourceSelectionRef: issueAllocationSelection(
                selectionRefs,
                actors.preparerUserId,
                caseId,
                caseRevision,
                withheld60
              ),
              amountCents: "60"
            }]
          }
        });
        assert.equal(
          await client.clearingReconciliationCoverage.aggregate({
            where: { reconciliationRevisionId: r1.id },
            _sum: { amountCents: true }
          }).then((value) => value._sum.amountCents),
          100n
        );
        caseRevision = (await client.clearingCase.findUniqueOrThrow({
          where: { id: caseId }, select: { revision: true }
        })).revision;
        const addition = await confirmV1Event(client, service, actors, {
          caseId,
          expectedCaseRevision: caseRevision,
          kind: "pending_reconciliation",
          amountCents: "20",
          reconciliationIntent: {
            operation: "open_item",
            itemDefinition: {
              mode: "addition",
              additionOfItemId: r1.itemId,
              amountCents: "20"
            },
            coverages: []
          }
        });
        const additionRevision = await client.clearingReconciliationRevision.findUniqueOrThrow({
          where: { decisionEventVersionId: addition.versionId }
        });
        const additionCoverage = await client.clearingReconciliationCoverage.findFirstOrThrow({
          where: { reconciliationRevisionId: additionRevision.id }
        });
        caseRevision = (await client.clearingCase.findUniqueOrThrow({
          where: { id: caseId }, select: { revision: true }
        })).revision;
        const reversedAddition = await confirmV1Event(client, service, actors, {
          caseId,
          expectedCaseRevision: caseRevision,
          kind: "technical_reversal",
          amountCents: "20",
          reconciliationIntent: {
            operation: "reverse_definition",
            targetRevisionId: additionRevision.id
          }
        });
        const additionDefinitionReversal = await client.clearingReconciliationDefinitionReversal.findUniqueOrThrow({
          where: { decisionEventVersionId: reversedAddition.versionId }
        });
        caseRevision = (await client.clearingCase.findUniqueOrThrow({
          where: { id: caseId }, select: { revision: true }
        })).revision;
        const corrected = await confirmV1Event(client, service, actors, {
          caseId,
          expectedCaseRevision: caseRevision,
          kind: "pending_reconciliation",
          amountCents: "20",
          reconciliationIntent: {
            operation: "replace_item",
            itemDefinition: {
              mode: "replacement",
              replacesRevisionId: additionRevision.id,
              correctsDefinitionReversalId: additionDefinitionReversal.id,
              amountCents: "20"
            },
            coverages: [{
              sourceSelectionRef: issueAllocationSelection(
                selectionRefs,
                actors.preparerUserId,
                caseId,
                caseRevision,
                additionCoverage.withheldEventVersionId
              ),
              amountCents: "20"
            }]
          }
        });
        const correctedRevision = await client.clearingReconciliationRevision.findUniqueOrThrow({
          where: { decisionEventVersionId: corrected.versionId }
        });
        assert.equal(correctedRevision.revisionNo, 2);
        assert.equal(correctedRevision.replacedOpenAmountCents, 0n);
        assert.equal(
          correctedRevision.correctsDefinitionReversalId,
          additionDefinitionReversal.id
        );

        caseRevision = (await client.clearingCase.findUniqueOrThrow({
          where: { id: caseId }, select: { revision: true }
        })).revision;
        const r2Decision = await confirmV1Event(client, service, actors, {
          caseId,
          expectedCaseRevision: caseRevision,
          kind: "pending_reconciliation",
          amountCents: "80",
          reconciliationIntent: {
            operation: "replace_item",
            itemDefinition: {
              mode: "replacement",
              replacesRevisionId: r1.id,
              amountCents: "80"
            },
            coverages: [
              {
                sourceSelectionRef: issueAllocationSelection(
                  selectionRefs,
                  actors.preparerUserId,
                  caseId,
                  caseRevision,
                  withheld40
                ),
                amountCents: "40"
              },
              {
                sourceSelectionRef: issueAllocationSelection(
                  selectionRefs,
                  actors.preparerUserId,
                  caseId,
                  caseRevision,
                  withheld60
                ),
                amountCents: "40"
              }
            ]
          }
        });
        const r2 = await client.clearingReconciliationRevision.findUniqueOrThrow({
          where: { decisionEventVersionId: r2Decision.versionId }
        });
        assert.equal(r2.revisionNo, 2);
        caseRevision = (await client.clearingCase.findUniqueOrThrow({
          where: { id: caseId }, select: { revision: true }
        })).revision;
        await confirmV1Event(client, service, actors, {
          caseId,
          expectedCaseRevision: caseRevision,
          kind: "technical_reversal",
          amountCents: "80",
          reconciliationIntent: {
            operation: "reverse_definition",
            targetRevisionId: r2.id
          }
        });
        caseRevision = (await client.clearingCase.findUniqueOrThrow({
          where: { id: caseId }, select: { revision: true }
        })).revision;
        const r3Decision = await confirmV1Event(client, service, actors, {
          caseId,
          expectedCaseRevision: caseRevision,
          kind: "pending_reconciliation",
          amountCents: "70",
          reconciliationIntent: {
            operation: "replace_item",
            itemDefinition: {
              mode: "replacement",
              replacesRevisionId: r1.id,
              amountCents: "70"
            },
            coverages: [
              {
                sourceSelectionRef: issueAllocationSelection(
                  selectionRefs,
                  actors.preparerUserId,
                  caseId,
                  caseRevision,
                  withheld40
                ),
                amountCents: "40"
              },
              {
                sourceSelectionRef: issueAllocationSelection(
                  selectionRefs,
                  actors.preparerUserId,
                  caseId,
                  caseRevision,
                  withheld60
                ),
                amountCents: "30"
              }
            ]
          }
        });
        const r3 = await client.clearingReconciliationRevision.findUniqueOrThrow({
          where: { decisionEventVersionId: r3Decision.versionId }
        });
        assert.equal(r3.revisionNo, 3);
        assert.equal(r3.replacesRevisionId, r1.id);
        const restoredProjection = await new ClearingReconciliationReaderService(
          client as never,
          new CompanyRoleResolverService(client as never)
        ).readClearingReconciliationRiskInTransaction(client as never, {
          projectId: fixture.projectId
        });
        assert.equal(restoredProjection.relationshipCompleteness, "complete");
        assert.equal(
          restoredProjection.items.find((item) => item.itemId === r1.itemId)
            ?.currentRevisionId,
          r3.id
        );

        const coverageCapCase = await client.clearingCase.create({
          data: {
            id: `${prefix}_coverage_cap_case`,
            projectId: fixture.projectId,
            constructionEnterpriseAssignmentId: fixture.assignmentId,
            category: "management_fee",
            governedSubjectKey: `${prefix}_coverage_cap_subject`,
            authoritativeGrossCapCents: 1000n,
            createdByUserId: actors.preparerUserId
          }
        });
        const coverageCapSource = await confirmLegacyEvent(service, actors, {
          caseId: coverageCapCase.id,
          expectedCaseRevision: coverageCapCase.revision,
          kind: "withheld",
          amountCents: "100"
        });
        let coverageCapRevision = await currentCaseRevision(client, coverageCapCase.id);
        const coverageCapOpen = await confirmV1Event(client, service, actors, {
          caseId: coverageCapCase.id,
          expectedCaseRevision: coverageCapRevision,
          kind: "pending_reconciliation",
          amountCents: "100",
          reconciliationIntent: {
            operation: "open_item",
            itemDefinition: { mode: "independent", amountCents: "100" },
            coverages: [{
              sourceSelectionRef: issueAllocationSelection(
                selectionRefs,
                actors.preparerUserId,
                coverageCapCase.id,
                coverageCapRevision,
                coverageCapSource
              ),
              amountCents: "100"
            }]
          }
        });
        const coverageCapTarget = await client.clearingReconciliationRevision.findUniqueOrThrow({
          where: { decisionEventVersionId: coverageCapOpen.versionId }
        });
        coverageCapRevision = await currentCaseRevision(client, coverageCapCase.id);
        const excessCoverageSource = await confirmLegacyEvent(service, actors, {
          caseId: coverageCapCase.id,
          expectedCaseRevision: coverageCapRevision,
          kind: "withheld",
          amountCents: "10"
        });
        coverageCapRevision = await currentCaseRevision(client, coverageCapCase.id);
        const eventCountBeforeExcessCoverage = await client.clearingEvent.count({
          where: { clearingCaseId: coverageCapCase.id }
        });
        await expect(service.createEvent(actors.preparerUserId, coverageCapCase.id, {
          idempotencyKey: randomUUID(),
          expectedRevision: coverageCapRevision,
          kind: "coverage_added",
          amountCents: "1",
          evidenceLevel: "B",
          reconciliationIntent: {
            operation: "add_coverage",
            targetRevisionId: coverageCapTarget.id,
            coverages: [{
              sourceSelectionRef: issueAllocationSelection(
                selectionRefs,
                actors.preparerUserId,
                coverageCapCase.id,
                coverageCapRevision,
                excessCoverageSource
              ),
              amountCents: "1"
            }]
          }
        })).rejects.toThrow(/超过目标 revision 当前未解决金额/iu);
        assert.equal(
          await client.clearingEvent.count({ where: { clearingCaseId: coverageCapCase.id } }),
          eventCountBeforeExcessCoverage
        );

        const correctedCaseId = `${prefix}_corrected_capacity_case`;
        const correctedCase = await client.clearingCase.create({
          data: {
            id: correctedCaseId,
            projectId: fixture.projectId,
            constructionEnterpriseAssignmentId: fixture.assignmentId,
            category: "management_fee",
            governedSubjectKey: `${prefix}_corrected_capacity_subject`,
            authoritativeGrossCapCents: 1000n,
            createdByUserId: actors.preparerUserId
          }
        });
        const correctedSource = await confirmLegacyEvent(service, actors, {
          caseId: correctedCaseId,
          expectedCaseRevision: correctedCase.revision,
          kind: "withheld",
          amountCents: "100"
        });
        let correctedCaseRevision = await currentCaseRevision(client, correctedCaseId);
        const correctedOpen = await confirmV1Event(client, service, actors, {
          caseId: correctedCaseId,
          expectedCaseRevision: correctedCaseRevision,
          kind: "pending_reconciliation",
          amountCents: "100",
          reconciliationIntent: {
            operation: "open_item",
            itemDefinition: { mode: "independent", amountCents: "100" },
            coverages: [{
              sourceSelectionRef: issueAllocationSelection(
                selectionRefs,
                actors.preparerUserId,
                correctedCaseId,
                correctedCaseRevision,
                correctedSource
              ),
              amountCents: "100"
            }]
          }
        });
        const correctedR1 = await client.clearingReconciliationRevision.findUniqueOrThrow({
          where: { decisionEventVersionId: correctedOpen.versionId }
        });
        correctedCaseRevision = await currentCaseRevision(client, correctedCaseId);
        const correctedReversal = await confirmV1Event(client, service, actors, {
          caseId: correctedCaseId,
          expectedCaseRevision: correctedCaseRevision,
          kind: "technical_reversal",
          amountCents: "100",
          reconciliationIntent: {
            operation: "reverse_definition",
            targetRevisionId: correctedR1.id
          }
        });
        const correctedReversalRow = await client.clearingReconciliationDefinitionReversal.findUniqueOrThrow({
          where: { decisionEventVersionId: correctedReversal.versionId }
        });
        correctedCaseRevision = await currentCaseRevision(client, correctedCaseId);
        await confirmLegacyEvent(service, actors, {
          caseId: correctedCaseId,
          expectedCaseRevision: correctedCaseRevision,
          kind: "final_confirmed",
          amountCents: "100",
          allocations: [{
            sourceEventVersionId: correctedSource,
            sourceKind: "withheld",
            amountCents: "100"
          }]
        });
        correctedCaseRevision = await currentCaseRevision(client, correctedCaseId);
        const correctedEventCount = await client.clearingEvent.count({
          where: { clearingCaseId: correctedCaseId }
        });
        await expect(service.createEvent(actors.preparerUserId, correctedCaseId, {
          idempotencyKey: randomUUID(),
          expectedRevision: correctedCaseRevision,
          kind: "pending_reconciliation",
          amountCents: "100",
          evidenceLevel: "B",
          reconciliationIntent: {
            operation: "replace_item",
            itemDefinition: {
              mode: "replacement",
              replacesRevisionId: correctedR1.id,
              correctsDefinitionReversalId: correctedReversalRow.id,
              amountCents: "100"
            },
            coverages: [{
              sourceSelectionRef: issueAllocationSelection(
                selectionRefs,
                actors.preparerUserId,
                correctedCaseId,
                correctedCaseRevision,
                correctedSource
              ),
              amountCents: "100"
            }]
          }
        })).rejects.toThrow(/暂扣覆盖来源容量已漂移/iu);
        assert.equal(
          await client.clearingEvent.count({ where: { clearingCaseId: correctedCaseId } }),
          correctedEventCount
        );
      } finally {
        await client.$disconnect();
      }
    },
    90_000
  );

  integrationTest(
    "fails closed when definition reversal would restore coverage beyond source capacity",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      const prefix = `pol275_restore_guard_${randomUUID().replace(/-/gu, "")}`;
      const caseId = `${prefix}_case`;
      const actors = {
        preparerUserId: `${prefix}_preparer`,
        attesterUserId: `${prefix}_attester`,
        confirmerUserId: `${prefix}_confirmer`
      };
      try {
        await client.$connect();
        const fixture = await seedOperatingLedgerFixture(client, { prefix, ...actors });
        const clearingCase = await client.clearingCase.create({
          data: {
            id: caseId,
            projectId: fixture.projectId,
            constructionEnterpriseAssignmentId: fixture.assignmentId,
            category: "management_fee",
            governedSubjectKey: `${prefix}_subject`,
            authoritativeGrossCapCents: 1000n,
            createdByUserId: actors.preparerUserId
          }
        });
        const selectionRefs = new AffiliateClearingSelectionRefService({ secret: `${prefix}_secret` });
        const service = clearingService(client, actors, selectionRefs);
        const withheld = await confirmLegacyEvent(service, actors, {
          caseId,
          expectedCaseRevision: clearingCase.revision,
          kind: "withheld",
          amountCents: "100"
        });
        let caseRevision = (await client.clearingCase.findUniqueOrThrow({ where: { id: caseId }, select: { revision: true } })).revision;
        const open = await confirmV1Event(client, service, actors, {
          caseId,
          expectedCaseRevision: caseRevision,
          kind: "pending_reconciliation",
          amountCents: "100",
          reconciliationIntent: {
            operation: "open_item",
            itemDefinition: { mode: "independent", amountCents: "100" },
            coverages: [{
              sourceSelectionRef: issueAllocationSelection(selectionRefs, actors.preparerUserId, caseId, caseRevision, withheld),
              amountCents: "100"
            }]
          }
        });
        const r1 = await client.clearingReconciliationRevision.findUniqueOrThrow({ where: { decisionEventVersionId: open.versionId } });
        caseRevision = (await client.clearingCase.findUniqueOrThrow({ where: { id: caseId }, select: { revision: true } })).revision;
        const replacement = await confirmV1Event(client, service, actors, {
          caseId,
          expectedCaseRevision: caseRevision,
          kind: "pending_reconciliation",
          amountCents: "20",
          reconciliationIntent: {
            operation: "replace_item",
            itemDefinition: { mode: "replacement", replacesRevisionId: r1.id, amountCents: "20" },
            coverages: [{
              sourceSelectionRef: issueAllocationSelection(selectionRefs, actors.preparerUserId, caseId, caseRevision, withheld),
              amountCents: "20"
            }]
          }
        });
        const r2 = await client.clearingReconciliationRevision.findUniqueOrThrow({ where: { decisionEventVersionId: replacement.versionId } });
        caseRevision = (await client.clearingCase.findUniqueOrThrow({ where: { id: caseId }, select: { revision: true } })).revision;
        await confirmLegacyEvent(service, actors, {
          caseId,
          expectedCaseRevision: caseRevision,
          kind: "final_confirmed",
          amountCents: "80",
          allocations: [{
            sourceEventVersionId: withheld,
            sourceKind: "withheld",
            amountCents: "80"
          }]
        });
        caseRevision = (await client.clearingCase.findUniqueOrThrow({ where: { id: caseId }, select: { revision: true } })).revision;
        const eventCountBefore = await client.clearingEvent.count({ where: { clearingCaseId: caseId } });
        await expect(service.createEvent(actors.preparerUserId, caseId, {
          idempotencyKey: randomUUID(),
          expectedRevision: caseRevision,
          kind: "technical_reversal",
          amountCents: "20",
          evidenceLevel: "B",
          reconciliationIntent: {
            operation: "reverse_definition",
            targetRevisionId: r2.id
          }
        })).rejects.toThrow(/恢复超过暂扣来源容量/iu);
        assert.equal(
          await client.clearingEvent.count({ where: { clearingCaseId: caseId } }),
          eventCountBefore
        );
      } finally {
        await client.$disconnect();
      }
    },
    90_000
  );

  integrationTest(
    "rejects malformed frozen ordinals, nested keys, missing impacts and post-seal extras",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      const prefix = `pol275_closure_${randomUUID().replace(/-/gu, "")}`;
      const actors = {
        preparerUserId: `${prefix}_preparer`,
        attesterUserId: `${prefix}_attester`,
        confirmerUserId: `${prefix}_confirmer`
      };
      try {
        await client.$connect();
        const fixture = await seedOperatingLedgerFixture(client, { prefix, ...actors });
        const selectionRefs = new AffiliateClearingSelectionRefService({ secret: `${prefix}_secret` });
        const service = clearingService(client, actors, selectionRefs);

        const validCase = await client.clearingCase.create({
          data: {
            id: `${prefix}_valid_case`,
            projectId: fixture.projectId,
            constructionEnterpriseAssignmentId: fixture.assignmentId,
            category: "management_fee",
            governedSubjectKey: `${prefix}_valid_subject`,
            authoritativeGrossCapCents: 1000n,
            createdByUserId: actors.preparerUserId
          }
        });
        const opened = await confirmV1Event(client, service, actors, {
          caseId: validCase.id,
          expectedCaseRevision: validCase.revision,
          kind: "pending_reconciliation",
          amountCents: "25",
          reconciliationIntent: {
            operation: "open_item",
            itemDefinition: { mode: "independent", amountCents: "25" },
            coverages: []
          }
        });
        const revision = await client.clearingReconciliationRevision.findUniqueOrThrow({ where: { decisionEventVersionId: opened.versionId } });
        const coverage = await client.clearingReconciliationCoverage.findFirstOrThrow({ where: { decisionEventVersionId: opened.versionId } });
        const currentCase = await client.clearingCase.findUniqueOrThrow({ where: { id: validCase.id }, select: { revision: true } });
        const preparedFinal = await prepareAndAttestV1Event(client, service, actors, {
          caseId: validCase.id,
          expectedCaseRevision: currentCase.revision,
          kind: "final_confirmed",
          amountCents: "25",
          reconciliationIntent: {
            operation: "resolve",
            resolutions: [{
              reconciliationRevisionId: revision.id,
              amountCents: "25",
              lines: [{
                sourceKind: "withheld_coverage",
                sourceSelectionRef: issueAllocationSelection(selectionRefs, actors.preparerUserId, validCase.id, currentCase.revision, coverage.id),
                amountCents: "25"
              }]
            }],
            ordinaryAllocations: []
          }
        });
        const submittedFinal = await client.clearingEventVersion.findUniqueOrThrow({
          where: { id: preparedFinal.versionId }
        });
        for (const [caseSuffix, expectedError, mutate] of [
          ["ordinal", /resolution\/line 字段、来源或 ordinal 无效/iu, (payload: Record<string, unknown>) => {
            const intent = payload.reconciliationIntent as {
              resolutions: Array<{ lines: Array<Record<string, unknown>> }>;
            };
            intent.resolutions[0]!.lines[0]!.lineNo = 2;
          }],
          ["nested", /resolution\/line 字段、来源或 ordinal 无效/iu, (payload: Record<string, unknown>) => {
            const intent = payload.reconciliationIntent as {
              resolutions: Array<{ lines: Array<Record<string, unknown>> }>;
            };
            intent.resolutions[0]!.lines[0]!.unexpected = "forbidden";
          }],
          ["numeric_cents", /resolution\/line 字段、来源或 ordinal 无效/iu, (payload: Record<string, unknown>) => {
            const intent = payload.reconciliationIntent as {
              resolutions: Array<Record<string, unknown>>;
            };
            intent.resolutions[0]!.amountCents = 25;
          }],
          ["unknown_purpose", /allocation 字段、来源或 ordinal 无效/iu, (payload: Record<string, unknown>) => {
            const intent = payload.reconciliationIntent as {
              eventAllocations: Array<Record<string, unknown>>;
            };
            intent.eventAllocations[0]!.purpose = "unknown_purpose";
          }],
          ["mixed_branch", /operation 分支不互斥或包含无关关系/iu, (payload: Record<string, unknown>) => {
            const intent = payload.reconciliationIntent as Record<string, unknown>;
            intent.definitionReversal = {
              definitionReversalId: "forbidden",
              targetRevisionId: "forbidden",
              targetDecisionEventVersionId: "forbidden",
              targetDecisionEventVersionFingerprint: "b".repeat(64),
              reversedAmountCents: "25"
            };
          }],
          ["planned_id", /plannedIds 与冻结关系集合不闭合/iu, (payload: Record<string, unknown>) => {
            const intent = payload.reconciliationIntent as {
              plannedIds: { resolutionIds: string[] };
            };
            intent.plannedIds.resolutionIds = ["wrong-resolution-id"];
          }]
        ] as const) {
          await expectMalformedFrozenResolutionRejected(
            client,
            { ...submittedFinal, eventKind: "final_confirmed" },
            actors,
            caseSuffix,
            mutate,
            expectedError
          );
        }
        const pairedCase = await client.clearingCase.create({
          data: {
            id: `${prefix}_paired_case`,
            projectId: fixture.projectId,
            constructionEnterpriseAssignmentId: fixture.assignmentId,
            category: "management_fee",
            governedSubjectKey: `${prefix}_paired_subject`,
            authoritativeGrossCapCents: 1000n,
            createdByUserId: actors.preparerUserId
          }
        });
        const pairedDecision = await confirmV1Event(client, service, actors, {
          caseId: pairedCase.id,
          expectedCaseRevision: pairedCase.revision,
          kind: "pending_reconciliation",
          amountCents: "25",
          reconciliationIntent: {
            operation: "open_item",
            itemDefinition: { mode: "independent", amountCents: "25" },
            coverages: []
          }
        });
        const pairedVersion = await client.clearingEventVersion.findUniqueOrThrow({
          where: { id: pairedDecision.versionId }
        });
        await expectMalformedFrozenResolutionRejected(
          client,
          { ...pairedVersion, eventKind: "pending_reconciliation" },
          actors,
          "planned_pair_event",
          (payload) => {
            const intent = payload.reconciliationIntent as {
              plannedPairedWithheld: Record<string, unknown>;
            };
            intent.plannedPairedWithheld.clearingEventId = "wrong-clearing-event-id";
          },
          /原子配对暂扣与冻结计划不一致/iu
        );
        const frozenFinalIntent = (submittedFinal.payloadSnapshot as {
          reconciliationIntent: {
            eventAllocations: Array<{
              clearingAllocationId: string;
              allocationSourceKind: string;
              sourceEventVersionId: string;
              amountCents: string;
            }>;
          };
        }).reconciliationIntent;
        const frozenFinalAllocation = frozenFinalIntent.eventAllocations[0]!;
        await expect(client.$transaction(async (tx) => {
          await tx.clearingConfirmation.create({
            data: {
              eventVersionId: preparedFinal.versionId,
              confirmedByUserId: actors.confirmerUserId,
              confirmerActorSetSnapshot: [actors.confirmerUserId]
            }
          });
          await tx.clearingAllocation.create({
            data: {
              id: frozenFinalAllocation.clearingAllocationId,
              eventVersionId: preparedFinal.versionId,
              sourceEventVersionId: frozenFinalAllocation.sourceEventVersionId,
              sourceKind: frozenFinalAllocation.allocationSourceKind,
              amountCents: BigInt(frozenFinalAllocation.amountCents),
              sourceRemainingAfterCents: 0n
            }
          });
          await tx.$queryRaw(Prisma.sql`
            SELECT public."pol275_append_reconciliation_set"(
              ${preparedFinal.versionId},
              ${preparedFinal.fingerprint}
            )
          `);
        })).rejects.toThrow(/冻结意图与普通经营影响集合不闭合/iu);
        const finalCase = await client.clearingCase.findUniqueOrThrow({
          where: { id: validCase.id },
          select: { revision: true }
        });
        await service.confirmEvent(
          actors.confirmerUserId,
          preparedFinal.eventId,
          {
            idempotencyKey: randomUUID(),
            expectedRevision: preparedFinal.eventRevision,
            expectedCaseRevision: finalCase.revision,
            eventVersionId: preparedFinal.versionId,
            expectedFingerprint: preparedFinal.fingerprint,
            confirmed: true
          }
        );
        const finalDecision = {
          eventId: preparedFinal.eventId,
          versionId: preparedFinal.versionId
        };
        const sourceLinks = await client.clearingImpactLink.findMany({
          where: { eventVersionId: finalDecision.versionId },
          orderBy: { sourceImpactKey: "asc" }
        });
        assert.deepEqual(sourceLinks.map((link) => link.sourceImpactKey), [
          "original:confirmed-cost",
          "original:construction-enterprise-funds-decrease",
          "original:construction-enterprise-funds-release"
        ]);
        await expect(client.$executeRaw(Prisma.sql`
          INSERT INTO "ClearingImpactLink" (
            "id", "eventVersionId", "operatingFactId", "operatingImpactId",
            "sourceImpactKey", "amountCents"
          ) VALUES (
            ${randomUUID()}, ${finalDecision.versionId},
            ${sourceLinks[0]!.operatingFactId}, ${sourceLinks[0]!.operatingImpactId},
            'forbidden:extra', 1
          )
        `)).rejects.toThrow(/已封印/iu);
      } finally {
        await client.$disconnect();
      }
    },
    90_000
  );

  integrationTest(
    "supports cumulative same-source coverage relief for coverage lines and ordinary remainder",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      const prefix = `pol275_same_source_${randomUUID().replace(/-/gu, "")}`;
      const actors = {
        preparerUserId: `${prefix}_preparer`,
        attesterUserId: `${prefix}_attester`,
        confirmerUserId: `${prefix}_confirmer`
      };
      try {
        await client.$connect();
        const fixture = await seedOperatingLedgerFixture(client, { prefix, ...actors });
        const selectionRefs = new AffiliateClearingSelectionRefService({
          secret: `${prefix}_secret`
        });
        const service = clearingService(client, actors, selectionRefs);
        const createCase = (suffix: string) => client.clearingCase.create({
          data: {
            id: `${prefix}_${suffix}_case`,
            projectId: fixture.projectId,
            constructionEnterpriseAssignmentId: fixture.assignmentId,
            category: "management_fee",
            governedSubjectKey: `${prefix}_${suffix}_subject`,
            authoritativeGrossCapCents: 1000n,
            createdByUserId: actors.preparerUserId
          }
        });

        const splitCase = await createCase("split");
        const splitSource = await confirmLegacyEvent(service, actors, {
          caseId: splitCase.id,
          expectedCaseRevision: splitCase.revision,
          kind: "withheld",
          amountCents: "100"
        });
        let caseRevision = await currentCaseRevision(client, splitCase.id);
        const splitOpen = await confirmV1Event(client, service, actors, {
          caseId: splitCase.id,
          expectedCaseRevision: caseRevision,
          kind: "pending_reconciliation",
          amountCents: "100",
          reconciliationIntent: {
            operation: "open_item",
            itemDefinition: { mode: "independent", amountCents: "100" },
            coverages: [{
              sourceSelectionRef: issueAllocationSelection(
                selectionRefs,
                actors.preparerUserId,
                splitCase.id,
                caseRevision,
                splitSource
              ),
              amountCents: "40"
            }]
          }
        });
        const splitRevision = await client.clearingReconciliationRevision.findUniqueOrThrow({
          where: { decisionEventVersionId: splitOpen.versionId }
        });
        caseRevision = await currentCaseRevision(client, splitCase.id);
        await confirmV1Event(client, service, actors, {
          caseId: splitCase.id,
          expectedCaseRevision: caseRevision,
          kind: "coverage_added",
          amountCents: "60",
          reconciliationIntent: {
            operation: "add_coverage",
            targetRevisionId: splitRevision.id,
            coverages: [{
              sourceSelectionRef: issueAllocationSelection(
                selectionRefs,
                actors.preparerUserId,
                splitCase.id,
                caseRevision,
                splitSource
              ),
              amountCents: "60"
            }]
          }
        });
        const splitCoverages = await client.clearingReconciliationCoverage.findMany({
          where: { reconciliationRevisionId: splitRevision.id },
          orderBy: { amountCents: "asc" }
        });
        caseRevision = await currentCaseRevision(client, splitCase.id);
        const splitResolution = await confirmV1Event(client, service, actors, {
          caseId: splitCase.id,
          expectedCaseRevision: caseRevision,
          kind: "final_confirmed",
          amountCents: "100",
          reconciliationIntent: {
            operation: "resolve",
            resolutions: [{
              reconciliationRevisionId: splitRevision.id,
              amountCents: "100",
              lines: splitCoverages.map((coverage) => ({
                sourceKind: "withheld_coverage",
                sourceSelectionRef: issueAllocationSelection(
                  selectionRefs,
                  actors.preparerUserId,
                  splitCase.id,
                  caseRevision,
                  coverage.id
                ),
                amountCents: coverage.amountCents.toString()
              }))
            }],
            ordinaryAllocations: []
          }
        });
        const splitAllocations = await client.clearingAllocation.findMany({
          where: { eventVersionId: splitResolution.versionId }
        });
        assert.equal(splitAllocations.length, 2);
        assert.equal(
          splitAllocations.reduce((sum, allocation) => sum + allocation.amountCents, 0n),
          100n
        );

        const remainderCase = await createCase("remainder");
        const remainderSource = await confirmLegacyEvent(service, actors, {
          caseId: remainderCase.id,
          expectedCaseRevision: remainderCase.revision,
          kind: "withheld",
          amountCents: "100"
        });
        caseRevision = await currentCaseRevision(client, remainderCase.id);
        const remainderOpen = await confirmV1Event(client, service, actors, {
          caseId: remainderCase.id,
          expectedCaseRevision: caseRevision,
          kind: "pending_reconciliation",
          amountCents: "40",
          reconciliationIntent: {
            operation: "open_item",
            itemDefinition: { mode: "independent", amountCents: "40" },
            coverages: [{
              sourceSelectionRef: issueAllocationSelection(
                selectionRefs,
                actors.preparerUserId,
                remainderCase.id,
                caseRevision,
                remainderSource
              ),
              amountCents: "40"
            }]
          }
        });
        const remainderRevision = await client.clearingReconciliationRevision.findUniqueOrThrow({
          where: { decisionEventVersionId: remainderOpen.versionId }
        });
        const remainderCoverage = await client.clearingReconciliationCoverage.findFirstOrThrow({
          where: { reconciliationRevisionId: remainderRevision.id }
        });
        caseRevision = await currentCaseRevision(client, remainderCase.id);
        const remainderResolution = await confirmV1Event(client, service, actors, {
          caseId: remainderCase.id,
          expectedCaseRevision: caseRevision,
          kind: "final_confirmed",
          amountCents: "100",
          reconciliationIntent: {
            operation: "resolve",
            resolutions: [{
              reconciliationRevisionId: remainderRevision.id,
              amountCents: "40",
              lines: [{
                sourceKind: "withheld_coverage",
                sourceSelectionRef: issueAllocationSelection(
                  selectionRefs,
                  actors.preparerUserId,
                  remainderCase.id,
                  caseRevision,
                  remainderCoverage.id
                ),
                amountCents: "40"
              }]
            }],
            ordinaryAllocations: [{
              sourceKind: "withheld",
              sourceSelectionRef: issueAllocationSelection(
                selectionRefs,
                actors.preparerUserId,
                remainderCase.id,
                caseRevision,
                remainderSource
              ),
              amountCents: "60"
            }]
          }
        });
        const remainderAllocations = await client.clearingAllocation.findMany({
          where: { eventVersionId: remainderResolution.versionId },
          orderBy: { createdAt: "asc" }
        });
        assert.equal(remainderAllocations.length, 2);
        assert.equal(
          remainderAllocations.reduce((sum, allocation) => sum + allocation.amountCents, 0n),
          100n
        );
      } finally {
        await client.$disconnect();
      }
    },
    90_000
  );

  integrationTest(
    "serializes approved coverage, replacement, allocation and permission-revoke races",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
      const prefix = `pol275_races_${randomUUID().replace(/-/gu, "")}`;
      const actors = {
        preparerUserId: `${prefix}_preparer`,
        attesterUserId: `${prefix}_attester`,
        confirmerUserId: `${prefix}_confirmer`
      };
      try {
        await client.$connect();
        const fixture = await seedOperatingLedgerFixture(client, { prefix, ...actors });
        const selectionRefs = new AffiliateClearingSelectionRefService({ secret: `${prefix}_secret` });
        const service = clearingService(client, actors, selectionRefs);
        const createCase = (suffix: string) => client.clearingCase.create({
          data: {
            id: `${prefix}_${suffix}_case`,
            projectId: fixture.projectId,
            constructionEnterpriseAssignmentId: fixture.assignmentId,
            category: "management_fee",
            governedSubjectKey: `${prefix}_${suffix}_subject`,
            authoritativeGrossCapCents: 1000n,
            createdByUserId: actors.preparerUserId
          }
        });
        const confirmCandidate = (
          candidate: Awaited<ReturnType<typeof prepareAndAttestV1Event>>,
          expectedCaseRevision: number
        ) => service.confirmEvent(actors.confirmerUserId, candidate.eventId, {
          idempotencyKey: randomUUID(),
          expectedRevision: candidate.eventRevision,
          expectedCaseRevision,
          eventVersionId: candidate.versionId,
          expectedFingerprint: candidate.fingerprint,
          confirmed: true
        });

        const coverageRaceCase = await createCase("coverage");
        const coverageSource = await confirmLegacyEvent(service, actors, {
          caseId: coverageRaceCase.id,
          expectedCaseRevision: coverageRaceCase.revision,
          kind: "withheld",
          amountCents: "100"
        });
        let revisionNo = await currentCaseRevision(client, coverageRaceCase.id);
        const coverageOpen = await confirmV1Event(client, service, actors, {
          caseId: coverageRaceCase.id,
          expectedCaseRevision: revisionNo,
          kind: "pending_reconciliation",
          amountCents: "100",
          reconciliationIntent: {
            operation: "open_item",
            itemDefinition: { mode: "independent", amountCents: "100" },
            coverages: [{
              sourceSelectionRef: issueAllocationSelection(selectionRefs, actors.preparerUserId, coverageRaceCase.id, revisionNo, coverageSource),
              amountCents: "40"
            }]
          }
        });
        const coverageRevision = await client.clearingReconciliationRevision.findUniqueOrThrow({ where: { decisionEventVersionId: coverageOpen.versionId } });
        const coverageCandidates = [];
        for (let index = 0; index < 2; index += 1) {
          revisionNo = await currentCaseRevision(client, coverageRaceCase.id);
          coverageCandidates.push(await prepareAndAttestV1Event(client, service, actors, {
            caseId: coverageRaceCase.id,
            expectedCaseRevision: revisionNo,
            kind: "coverage_added",
            amountCents: "60",
            reconciliationIntent: {
              operation: "add_coverage",
              targetRevisionId: coverageRevision.id,
              coverages: [{
                sourceSelectionRef: issueAllocationSelection(selectionRefs, actors.preparerUserId, coverageRaceCase.id, revisionNo, coverageSource),
                amountCents: "60"
              }]
            }
          }));
        }
        revisionNo = await currentCaseRevision(client, coverageRaceCase.id);
        assertExactlyOneFulfilled(await Promise.allSettled(
          coverageCandidates.map((candidate) => confirmCandidate(candidate, revisionNo))
        ));
        assert.equal(
          await client.clearingReconciliationCoverage.aggregate({
            where: { reconciliationRevisionId: coverageRevision.id },
            _sum: { amountCents: true }
          }).then((value) => value._sum.amountCents),
          100n
        );

        const revisionRaceCase = await createCase("revision");
        const revisionOpen = await confirmV1Event(client, service, actors, {
          caseId: revisionRaceCase.id,
          expectedCaseRevision: revisionRaceCase.revision,
          kind: "pending_reconciliation",
          amountCents: "100",
          reconciliationIntent: {
            operation: "open_item",
            itemDefinition: { mode: "independent", amountCents: "100" },
            coverages: []
          }
        });
        const currentRevision = await client.clearingReconciliationRevision.findUniqueOrThrow({ where: { decisionEventVersionId: revisionOpen.versionId } });
        const currentCoverage = await client.clearingReconciliationCoverage.findFirstOrThrow({ where: { decisionEventVersionId: revisionOpen.versionId } });
        revisionNo = await currentCaseRevision(client, revisionRaceCase.id);
        const resolutionCandidate = await prepareAndAttestV1Event(client, service, actors, {
          caseId: revisionRaceCase.id,
          expectedCaseRevision: revisionNo,
          kind: "final_confirmed",
          amountCents: "100",
          reconciliationIntent: {
            operation: "resolve",
            resolutions: [{
              reconciliationRevisionId: currentRevision.id,
              amountCents: "100",
              lines: [{
                sourceKind: "withheld_coverage",
                sourceSelectionRef: issueAllocationSelection(selectionRefs, actors.preparerUserId, revisionRaceCase.id, revisionNo, currentCoverage.id),
                amountCents: "100"
              }]
            }],
            ordinaryAllocations: []
          }
        });
        revisionNo = await currentCaseRevision(client, revisionRaceCase.id);
        const replacementCandidate = await prepareAndAttestV1Event(client, service, actors, {
          caseId: revisionRaceCase.id,
          expectedCaseRevision: revisionNo,
          kind: "pending_reconciliation",
          amountCents: "100",
          reconciliationIntent: {
            operation: "replace_item",
            itemDefinition: { mode: "replacement", replacesRevisionId: currentRevision.id, amountCents: "100" },
            coverages: [{
              sourceSelectionRef: issueAllocationSelection(selectionRefs, actors.preparerUserId, revisionRaceCase.id, revisionNo, currentCoverage.withheldEventVersionId),
              amountCents: "100"
            }]
          }
        });
        revisionNo = await currentCaseRevision(client, revisionRaceCase.id);
        assertExactlyOneFulfilled(await Promise.allSettled([
          confirmCandidate(resolutionCandidate, revisionNo),
          confirmCandidate(replacementCandidate, revisionNo)
        ]));

        const allocationCoverageCase = await createCase("allocation_coverage");
        const allocationCoverageSource = await confirmLegacyEvent(service, actors, {
          caseId: allocationCoverageCase.id,
          expectedCaseRevision: allocationCoverageCase.revision,
          kind: "withheld",
          amountCents: "100"
        });
        revisionNo = await currentCaseRevision(client, allocationCoverageCase.id);
        const allocationCoverageOpen = await confirmV1Event(client, service, actors, {
          caseId: allocationCoverageCase.id,
          expectedCaseRevision: revisionNo,
          kind: "pending_reconciliation",
          amountCents: "100",
          reconciliationIntent: {
            operation: "open_item",
            itemDefinition: { mode: "independent", amountCents: "100" },
            coverages: [{
              sourceSelectionRef: issueAllocationSelection(selectionRefs, actors.preparerUserId, allocationCoverageCase.id, revisionNo, allocationCoverageSource),
              amountCents: "40"
            }]
          }
        });
        const allocationCoverageRevision = await client.clearingReconciliationRevision.findUniqueOrThrow({ where: { decisionEventVersionId: allocationCoverageOpen.versionId } });
        revisionNo = await currentCaseRevision(client, allocationCoverageCase.id);
        const allocationCandidate = await prepareLegacyEvent(service, actors, {
          caseId: allocationCoverageCase.id,
          expectedCaseRevision: revisionNo,
          kind: "final_confirmed",
          amountCents: "60",
          allocations: [{ sourceEventVersionId: allocationCoverageSource, sourceKind: "withheld", amountCents: "60" }]
        });
        revisionNo = await currentCaseRevision(client, allocationCoverageCase.id);
        const additionalCoverageCandidate = await prepareAndAttestV1Event(client, service, actors, {
          caseId: allocationCoverageCase.id,
          expectedCaseRevision: revisionNo,
          kind: "coverage_added",
          amountCents: "60",
          reconciliationIntent: {
            operation: "add_coverage",
            targetRevisionId: allocationCoverageRevision.id,
            coverages: [{
              sourceSelectionRef: issueAllocationSelection(selectionRefs, actors.preparerUserId, allocationCoverageCase.id, revisionNo, allocationCoverageSource),
              amountCents: "60"
            }]
          }
        });
        revisionNo = await currentCaseRevision(client, allocationCoverageCase.id);
        assertExactlyOneFulfilled(await Promise.allSettled([
          service.confirmEvent(actors.confirmerUserId, allocationCandidate.eventId, {
            idempotencyKey: randomUUID(),
            expectedRevision: allocationCandidate.eventRevision,
            allocations: [{ sourceEventVersionId: allocationCoverageSource, sourceKind: "withheld", amountCents: "60" }]
          }),
          confirmCandidate(additionalCoverageCandidate, revisionNo)
        ]));

        const restoreRaceCase = await createCase("restore");
        const restoreSource = await confirmLegacyEvent(service, actors, {
          caseId: restoreRaceCase.id,
          expectedCaseRevision: restoreRaceCase.revision,
          kind: "withheld",
          amountCents: "100"
        });
        revisionNo = await currentCaseRevision(client, restoreRaceCase.id);
        const restoreOpen = await confirmV1Event(client, service, actors, {
          caseId: restoreRaceCase.id,
          expectedCaseRevision: revisionNo,
          kind: "pending_reconciliation",
          amountCents: "100",
          reconciliationIntent: {
            operation: "open_item",
            itemDefinition: { mode: "independent", amountCents: "100" },
            coverages: [{
              sourceSelectionRef: issueAllocationSelection(selectionRefs, actors.preparerUserId, restoreRaceCase.id, revisionNo, restoreSource),
              amountCents: "100"
            }]
          }
        });
        const restoreR1 = await client.clearingReconciliationRevision.findUniqueOrThrow({ where: { decisionEventVersionId: restoreOpen.versionId } });
        revisionNo = await currentCaseRevision(client, restoreRaceCase.id);
        const restoreReplacement = await confirmV1Event(client, service, actors, {
          caseId: restoreRaceCase.id,
          expectedCaseRevision: revisionNo,
          kind: "pending_reconciliation",
          amountCents: "20",
          reconciliationIntent: {
            operation: "replace_item",
            itemDefinition: { mode: "replacement", replacesRevisionId: restoreR1.id, amountCents: "20" },
            coverages: [{
              sourceSelectionRef: issueAllocationSelection(selectionRefs, actors.preparerUserId, restoreRaceCase.id, revisionNo, restoreSource),
              amountCents: "20"
            }]
          }
        });
        const restoreR2 = await client.clearingReconciliationRevision.findUniqueOrThrow({ where: { decisionEventVersionId: restoreReplacement.versionId } });
        revisionNo = await currentCaseRevision(client, restoreRaceCase.id);
        const restoreCandidate = await prepareAndAttestV1Event(client, service, actors, {
          caseId: restoreRaceCase.id,
          expectedCaseRevision: revisionNo,
          kind: "technical_reversal",
          amountCents: "20",
          reconciliationIntent: { operation: "reverse_definition", targetRevisionId: restoreR2.id }
        });
        revisionNo = await currentCaseRevision(client, restoreRaceCase.id);
        const competingAllocation = await prepareLegacyEvent(service, actors, {
          caseId: restoreRaceCase.id,
          expectedCaseRevision: revisionNo,
          kind: "final_confirmed",
          amountCents: "80",
          allocations: [{ sourceEventVersionId: restoreSource, sourceKind: "withheld", amountCents: "80" }]
        });
        revisionNo = await currentCaseRevision(client, restoreRaceCase.id);
        assertExactlyOneFulfilled(await Promise.allSettled([
          confirmCandidate(restoreCandidate, revisionNo),
          service.confirmEvent(actors.confirmerUserId, competingAllocation.eventId, {
            idempotencyKey: randomUUID(),
            expectedRevision: competingAllocation.eventRevision,
            allocations: [{ sourceEventVersionId: restoreSource, sourceKind: "withheld", amountCents: "80" }]
          })
        ]));

        const permissionRaceCase = await createCase("permission_revoke");
        const permissionRaceCandidate = await prepareAndAttestV1Event(
          client,
          service,
          actors,
          {
            caseId: permissionRaceCase.id,
            expectedCaseRevision: permissionRaceCase.revision,
            kind: "pending_reconciliation",
            amountCents: "10",
            reconciliationIntent: {
              operation: "open_item",
              itemDefinition: { mode: "independent", amountCents: "10" },
              coverages: []
            }
          }
        );
        const canonicalRoles = new CompanyRoleResolverService(client as never);
        let roleRevokedBetweenSnapshots = false;
        const racingRoles = {
          resolveActiveRoleScopes: async (userId: string, projectId?: string) => {
            const roles = await canonicalRoles.resolveActiveRoleScopes(userId, projectId);
            if (userId === actors.confirmerUserId && !roleRevokedBetweenSnapshots) {
              roleRevokedBetweenSnapshots = true;
              await client.userPosition.deleteMany({
                where: { userId, projectId: null }
              });
            }
            return roles;
          },
          resolveActiveRoleScopesInTransaction: (
            tx: Prisma.TransactionClient,
            userId: string,
            projectId?: string
          ) => canonicalRoles.resolveActiveRoleScopesInTransaction(tx as never, userId, projectId)
        };
        const racingService = new ClearingService(
          client as never,
          racingRoles as never,
          new OperatingLedgerService(client as never),
          new AuditService(client as never),
          undefined,
          selectionRefs
        );
        revisionNo = await currentCaseRevision(client, permissionRaceCase.id);
        await expect(racingService.confirmEvent(
          actors.confirmerUserId,
          permissionRaceCandidate.eventId,
          {
            idempotencyKey: randomUUID(),
            expectedRevision: permissionRaceCandidate.eventRevision,
            expectedCaseRevision: revisionNo,
            eventVersionId: permissionRaceCandidate.versionId,
            expectedFingerprint: permissionRaceCandidate.fingerprint,
            confirmed: true
          }
        )).rejects.toThrow(/权限或委托已变化/iu);
        assert.equal(roleRevokedBetweenSnapshots, true);
        assert.equal(
          await client.clearingConfirmation.count({
            where: { eventVersionId: permissionRaceCandidate.versionId }
          }),
          0
        );
        assert.equal(
          await client.clearingReconciliationDecisionSeal.count({
            where: { decisionEventVersionId: permissionRaceCandidate.versionId }
          }),
          0
        );
        const denyAudit = await client.auditLog.findFirstOrThrow({
          where: {
            action: "clearing.event.confirm.denied",
            businessType: "clearing_event",
            businessId: permissionRaceCandidate.eventId
          }
        });
        assert.equal(
          (denyAudit.metadata as { reasonCode?: string }).reasonCode,
          "clearing_confirm_authorization_drift"
        );
      } finally {
        await client.$disconnect();
      }
    },
    180_000
  );

  integrationTest(
    "confirms V1 as a real non-superuser runtime while denying direct relation DML and owner escalation",
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
      const prefix = `pol275_runtime_${randomUUID().replace(/-/gu, "")}`;
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
        const clearingCase = await client.clearingCase.create({
          data: {
            id: `${prefix}_case`,
            projectId: operatingFixture.projectId,
            constructionEnterpriseAssignmentId: operatingFixture.assignmentId,
            category: "management_fee",
            governedSubjectKey: `${prefix}_subject`,
            authoritativeGrossCapCents: 1000n,
            createdByUserId: preparerUserId
          }
        });
        const actors = { preparerUserId, attesterUserId, confirmerUserId };
        const selectionRefs = new AffiliateClearingSelectionRefService({
          secret: `${prefix}_selection_secret`
        });
        const adminService = clearingService(client, actors, selectionRefs);
        const candidate = await prepareAndAttestV1Event(
          client,
          adminService,
          actors,
          {
            caseId: clearingCase.id,
            expectedCaseRevision: clearingCase.revision,
            kind: "pending_reconciliation",
            amountCents: "25",
            reconciliationIntent: {
              operation: "open_item",
              itemDefinition: { mode: "independent", amountCents: "25" },
              coverages: []
            }
          }
        );
        await client.$executeRawUnsafe(
          `CREATE ROLE "${probeRole}" LOGIN INHERIT PASSWORD '${probePassword}'`
        );
        await client.$executeRawUnsafe(
          `GRANT "jg_pol275_runtime" TO "${probeRole}"`
        );
        await client.$executeRawUnsafe(`
          DO $pol275_runtime_grants$
          DECLARE target RECORD;
          BEGIN
            FOR target IN
              SELECT schemaname, tablename
              FROM pg_tables
              WHERE schemaname = 'public'
                AND tablename NOT IN (
                  'ClearingReconciliationItem',
                  'ClearingReconciliationRevision',
                  'ClearingReconciliationCoverage',
                  'ClearingReconciliationResolution',
                  'ClearingReconciliationDefinitionReversal',
                  'ClearingReconciliationResolutionLine',
                  'ClearingReconciliationDecisionSeal'
                )
            LOOP
              EXECUTE format(
                'GRANT SELECT, INSERT, UPDATE ON TABLE %I.%I TO %I',
                target.schemaname,
                target.tablename,
                '${probeRole}'
              );
            END LOOP;
          END
          $pol275_runtime_grants$
        `);
        await client.$executeRawUnsafe(
          `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO "${probeRole}"`
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
        const currentCase = await client.clearingCase.findUniqueOrThrow({
          where: { id: clearingCase.id },
          select: { revision: true }
        });
        const runtimeService = clearingService(
          probeClient,
          actors,
          selectionRefs
        );
        await runtimeService.confirmEvent(confirmerUserId, candidate.eventId, {
          idempotencyKey: randomUUID(),
          expectedRevision: candidate.eventRevision,
          expectedCaseRevision: currentCase.revision,
          eventVersionId: candidate.versionId,
          expectedFingerprint: candidate.fingerprint,
          confirmed: true
        });
        assert.equal(
          await client.clearingReconciliationDecisionSeal.count({
            where: { decisionEventVersionId: candidate.versionId }
          }),
          1
        );
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
          `DROP OWNED BY "${probeRole}"`
        ).catch(() => undefined);
        await client.$executeRawUnsafe(
          `REVOKE "jg_pol275_runtime" FROM "${probeRole}"`
        ).catch(() => undefined);
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
        for (const kind of [
          "coverage_added",
          "continued_withheld",
          "technical_reversal"
        ]) {
          const directEventId = `${prefix}_${kind}_direct_event`;
          const directVersionId = `${prefix}_${kind}_direct_version`;
          await expect(client.$transaction(async (tx) => {
            await tx.clearingEvent.create({
              data: {
                id: directEventId,
                clearingCaseId: caseId,
                kind,
                workflowStatus: "submitted",
                revision: 1,
                currentVersionNo: 1,
                createdByUserId: preparerUserId
              }
            });
            await tx.clearingEventVersion.create({
              data: {
                id: directVersionId,
                clearingEventId: directEventId,
                clearingCaseId: caseId,
                versionNo: 1,
                workflowStatus: "submitted",
                amountCents: 1n,
                currencyCode: "CNY",
                evidenceLevel: "A",
                payloadSnapshot: {},
                actorSetSnapshot: [preparerUserId],
                fingerprint: "a".repeat(64),
                createdByUserId: preparerUserId
              }
            });
            await tx.clearingConfirmation.create({
              data: {
                eventVersionId: directVersionId,
                confirmedByUserId: confirmerUserId,
                confirmerActorSetSnapshot: [confirmerUserId]
              }
            });
          })).rejects.toThrow(/新核对事件确认必须使用 V1 意图/iu);
          assert.equal(
            await client.clearingEvent.count({ where: { id: directEventId } }),
            0
          );
        }
        const unsealedEventId = `${prefix}_unsealed_direct_event`;
        const unsealedVersionId = `${prefix}_unsealed_direct_version`;
        await expect(client.$transaction(async (tx) => {
          await tx.clearingEvent.create({
            data: {
              id: unsealedEventId,
              clearingCaseId: caseId,
              kind: "coverage_added",
              workflowStatus: "submitted",
              revision: 1,
              currentVersionNo: 1,
              createdByUserId: preparerUserId
            }
          });
          await tx.clearingEventVersion.create({
            data: {
              id: unsealedVersionId,
              clearingEventId: unsealedEventId,
              clearingCaseId: caseId,
              versionNo: 1,
              workflowStatus: "submitted",
              amountCents: 1n,
              currencyCode: "CNY",
              evidenceLevel: "A",
              payloadSnapshot: {
                reconciliationIntent: {
                  schema: "clearing_reconciliation_intent/V1"
                }
              },
              actorSetSnapshot: [preparerUserId],
              fingerprint: "b".repeat(64),
              createdByUserId: preparerUserId
            }
          });
          await tx.clearingConfirmation.create({
            data: {
              eventVersionId: unsealedVersionId,
              confirmedByUserId: confirmerUserId,
              confirmerActorSetSnapshot: [confirmerUserId]
            }
          });
          await tx.$executeRawUnsafe(
            'SET CONSTRAINTS "ClearingConfirmation_pol275_v1_closure" IMMEDIATE'
          );
        })).rejects.toThrow(/V1 确认缺少同事务决策封印/iu);
        assert.equal(
          await client.clearingEvent.count({ where: { id: unsealedEventId } }),
          0
        );
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
  _actors: {
    preparerUserId: string;
    attesterUserId: string;
    confirmerUserId: string;
  },
  selectionRefs?: AffiliateClearingSelectionRefService,
  authorities?: AffiliateClearingAuthorityService
) {
  const roleResolver = new CompanyRoleResolverService(client as never);
  return new ClearingService(
    client as never,
    roleResolver as never,
    new OperatingLedgerService(client as never),
    new AuditService(client as never),
    authorities,
    selectionRefs
  );
}

function clearingRoleResolver(actors: {
  preparerUserId: string;
  attesterUserId: string;
  confirmerUserId: string;
}) {
  const resolve = jest.fn(async (userId: string) =>
    userId === actors.confirmerUserId
      ? ["finance_director"]
      : ["finance_staff"]
  );
  return {
    resolveActiveRoleScopes: resolve,
    resolveActiveRoleScopesInTransaction: jest.fn(
      async (_tx: unknown, userId: string) => resolve(userId)
    )
  };
}

async function createAuthorityBackedClearingCase(
  client: PrismaClient,
  actors: {
    preparerUserId: string;
    attesterUserId: string;
    confirmerUserId: string;
  },
  fixture: {
    projectId: string;
    assignmentId: string;
    companyId: string;
  },
  selectionRefs: AffiliateClearingSelectionRefService,
  prefix: string
) {
  await client.projectMember.createMany({
    data: [
      {
        id: `${prefix}_contract_staff_member`,
        projectId: fixture.projectId,
        userId: actors.preparerUserId,
        positionKey: "contract_staff"
      },
      {
        id: `${prefix}_contract_director_member`,
        projectId: fixture.projectId,
        userId: actors.confirmerUserId,
        positionKey: "contract_director"
      }
    ]
  });
  const contractFileId = `${prefix}_affiliate_contract_file`;
  const signatureFileId = `${prefix}_contract_director_signature_file`;
  const authorityEvidenceFileId = `${prefix}_authority_evidence_file`;
  await client.fileObject.createMany({
    data: [
      {
        id: contractFileId,
        bucket: "private-local",
        objectKey: `tests/${contractFileId}.pdf`,
        originalName: "POL-275挂靠管理协议.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        uploadedByUserId: actors.preparerUserId,
        contentSha256: "a".repeat(64),
        storageStatus: "active"
      },
      {
        id: signatureFileId,
        bucket: "private-local",
        objectKey: `tests/${signatureFileId}.png`,
        originalName: "POL-275合同主管签名.png",
        mimeType: "image/png",
        sizeBytes: 100,
        uploadedByUserId: actors.confirmerUserId,
        contentSha256: "b".repeat(64),
        storageStatus: "active"
      },
      {
        id: authorityEvidenceFileId,
        bucket: "private-local",
        objectKey: `tests/${authorityEvidenceFileId}.pdf`,
        originalName: "POL-275保证金权威条款.pdf",
        mimeType: "application/pdf",
        sizeBytes: 100,
        uploadedByUserId: actors.preparerUserId,
        contentSha256: "c".repeat(64),
        storageStatus: "active"
      }
    ]
  });
  await client.handwrittenSignatureVersion.create({
    data: {
      id: `${prefix}_contract_director_signature_version`,
      userId: actors.confirmerUserId,
      fileId: signatureFileId,
      contentSha256: "b".repeat(64),
      source: "canvas"
    }
  });

  const audit = new AuditService(client as never);
  const contractService = new ProjectAffiliateCompanyContractService(
    client as never,
    audit,
    { confirmPassword: jest.fn().mockResolvedValue(undefined) } as never
  );
  const contract = await contractService.record(
    fixture.projectId,
    actors.preparerUserId,
    {
      contractReference: `${prefix}-AFFILIATE-CONTRACT`,
      contractName: "POL-275挂靠管理协议",
      signedAt: "2026-08-01",
      rightsObligationsSummary: "双方确认保证金权威上限、返还条件与清算边界。",
      companyEntityId: fixture.companyId,
      fileId: contractFileId,
      idempotencyKey: randomUUID()
    }
  );
  await contractService.confirm(
    fixture.projectId,
    contract.id,
    actors.confirmerUserId,
    {
      confirmationPassword: "local-pg16-only",
      confirmationActionId: randomUUID()
    }
  );

  const roleResolver = clearingRoleResolver(actors);
  const authorityService = new AffiliateClearingAuthorityService(
    client as never,
    roleResolver as never,
    selectionRefs,
    audit
  );
  const contractOptions = await authorityService.options(
    actors.preparerUserId,
    fixture.projectId
  );
  const rawContractSelectionRef = contractOptions.options.find(
    (option) =>
      option.optionKind === "contract" &&
      typeof option.label === "string" &&
      option.label.includes(contract.contractReference)
  )?.selectionRef;
  assert.equal(typeof rawContractSelectionRef, "string");
  const contractSelectionRef = rawContractSelectionRef as string;
  const authorityIdempotencyKey = randomUUID();
  await authorityService.createAuthority(actors.preparerUserId, {
    idempotencyKey: authorityIdempotencyKey,
    expectedRevision: 0,
    contractSelectionRef,
    effectiveFrom: "2026-08-01",
    evidenceRef: authorityEvidenceFileId,
    wageLines: [],
    guaranteeObligations: [
      {
        selectionRef: contractSelectionRef,
        baseAmountCents: "1000",
        calculationMode: "FIXED_AMOUNT",
        fixedAmountCents: "1000",
        returnCondition: "核对完成后按确认结果返还",
        evidenceCoordinate: "挂靠管理协议保证金条款"
      }
    ]
  });
  const authority = await client.affiliateClearingAuthorityVersion.findUniqueOrThrow({
    where: { idempotencyKey: authorityIdempotencyKey }
  });
  await authorityService.submitAuthority(
    actors.preparerUserId,
    authority.id,
    { idempotencyKey: randomUUID(), expectedRevision: 1 }
  );
  await authorityService.confirmAuthority(
    actors.confirmerUserId,
    authority.id,
    { idempotencyKey: randomUUID(), expectedRevision: 2 }
  );
  const authorityOptions = await authorityService.options(
    actors.preparerUserId,
    fixture.projectId
  );
  const rawAuthoritySelectionRef = authorityOptions.options.find(
    (option) => option.optionKind === "guarantee"
  )?.selectionRef;
  assert.equal(typeof rawAuthoritySelectionRef, "string");
  const authoritySelectionRef = rawAuthoritySelectionRef as string;

  const service = clearingService(
    client,
    actors,
    selectionRefs,
    authorityService
  );
  const created = await service.createCase(actors.preparerUserId, {
    idempotencyKey: randomUUID(),
    expectedRevision: 0,
    category: "deposit",
    authoritySelectionRef,
    guaranteeTrancheAmountCents: "1000"
  }) as { id: string };
  const clearingCase = await client.clearingCase.findUniqueOrThrow({
    where: { id: created.id }
  });
  return { clearingCase, service };
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
    kind:
      | "pending_reconciliation"
      | "coverage_added"
      | "final_confirmed"
      | "supplemental"
      | "returned"
      | "continued_withheld"
      | "technical_reversal";
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
    kind:
      | "pending_reconciliation"
      | "coverage_added"
      | "final_confirmed"
      | "supplemental"
      | "returned"
      | "continued_withheld"
      | "technical_reversal";
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
      businessReason: "POL-275 本机 PG16 核对关系与经营影响闭合验证",
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
    kind: "withheld" | "final_confirmed";
    amountCents: string;
    businessReason?: string;
    requiresAttestation?: boolean;
    allocations?: Array<{
      sourceEventVersionId: string;
      sourceKind: "withheld" | "authority_cap";
      amountCents: string;
    }>;
  }
): Promise<string> {
  const prepared = await prepareLegacyEvent(service, actors, input);
  const confirmationRevision = input.requiresAttestation
    ? eventResult(await service.attestEvent(
        actors.attesterUserId,
        prepared.eventId,
        {
          idempotencyKey: randomUUID(),
          expectedRevision: prepared.eventRevision
        }
      )).revision
    : prepared.eventRevision;
  await service.confirmEvent(actors.confirmerUserId, prepared.eventId, {
    idempotencyKey: randomUUID(),
    expectedRevision: confirmationRevision,
    allocations: input.allocations ?? []
  });
  return prepared.versionId;
}

async function prepareLegacyEvent(
  service: ClearingService,
  actors: {
    preparerUserId: string;
    attesterUserId: string;
    confirmerUserId: string;
  },
  input: {
    caseId: string;
    expectedCaseRevision: number;
    kind: "withheld" | "final_confirmed";
    amountCents: string;
    businessReason?: string;
    requiresAttestation?: boolean;
    allocations?: Array<{
      sourceEventVersionId: string;
      sourceKind: "withheld" | "authority_cap";
      amountCents: string;
    }>;
  }
): Promise<{
  eventId: string;
  versionId: string;
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
      evidenceLevel: "A",
      ...(input.businessReason
        ? { businessReason: input.businessReason }
        : { payload: { reason: "POL-275 no-V1 compatibility probe" } })
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
  return {
    eventId: prepared.id,
    versionId: submitted.versionId,
    eventRevision: submitted.revision
  };
}

function issueAllocationSelection(
  selectionRefs: AffiliateClearingSelectionRefService,
  actorUserId: string,
  caseId: string,
  revision: number,
  selectedKey: string
): string {
  return selectionRefs.issue({
    actorUserId,
    authorityVersionId: caseId,
    authorityFingerprint: caseId,
    purpose: "allocation",
    selectedKey,
    revision
  });
}

async function confirmationTime(
  client: PrismaClient,
  eventVersionId: string
): Promise<Date> {
  const confirmation = await client.clearingConfirmation.findUniqueOrThrow({
    where: { eventVersionId },
    select: { confirmedAt: true }
  });
  return confirmation.confirmedAt;
}

async function currentCaseRevision(
  client: PrismaClient,
  caseId: string
): Promise<number> {
  return (await client.clearingCase.findUniqueOrThrow({
    where: { id: caseId },
    select: { revision: true }
  })).revision;
}

async function expectMalformedFrozenResolutionRejected(
  client: PrismaClient,
  source: {
    clearingCaseId: string;
    amountCents: bigint;
    currencyCode: string;
    payloadSnapshot: Prisma.JsonValue;
    eventKind: "pending_reconciliation" | "final_confirmed";
  },
  actors: {
    preparerUserId: string;
    attesterUserId: string;
    confirmerUserId: string;
  },
  suffix: string,
  mutate: (payload: Record<string, unknown>) => void,
  expectedError: RegExp
): Promise<void> {
  const payload = JSON.parse(
    JSON.stringify(source.payloadSnapshot)
  ) as Record<string, unknown>;
  mutate(payload);
  const eventId = `malformed_${suffix}_${randomUUID()}`;
  const versionId = `malformed_version_${suffix}_${randomUUID()}`;
  const fingerprint = (suffix === "ordinal" ? "d" : "e").repeat(64);
  await expect(client.$transaction(async (tx) => {
    await tx.clearingEvent.create({
      data: {
        id: eventId,
        clearingCaseId: source.clearingCaseId,
        kind: source.eventKind,
        workflowStatus: "submitted",
        revision: 2,
        currentVersionNo: 1,
        createdByUserId: actors.preparerUserId
      }
    });
    await tx.clearingEventVersion.create({
      data: {
        id: versionId,
        clearingEventId: eventId,
        clearingCaseId: source.clearingCaseId,
        versionNo: 1,
        workflowStatus: "submitted",
        amountCents: source.amountCents,
        currencyCode: source.currencyCode,
        evidenceLevel: "A",
        payloadSnapshot: payload as Prisma.InputJsonValue,
        actorSetSnapshot: [actors.preparerUserId],
        fingerprint,
        createdByUserId: actors.preparerUserId
      }
    });
    await tx.clearingConfirmation.create({
      data: {
        eventVersionId: versionId,
        confirmedByUserId: actors.confirmerUserId,
        confirmerActorSetSnapshot: [actors.confirmerUserId]
      }
    });
    await tx.$queryRaw(Prisma.sql`
      SELECT public."pol275_append_reconciliation_set"(
        ${versionId},
        ${fingerprint}
      )
    `);
  })).rejects.toThrow(expectedError);
  assert.equal(
    await client.clearingEvent.count({ where: { id: eventId } }),
    0
  );
}

function assertExactlyOneFulfilled(
  results: ReadonlyArray<PromiseSettledResult<unknown>>
): void {
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1
  );
  assert.equal(
    results.filter((result) => result.status === "rejected").length,
    1
  );
}

async function seedOperatingLedgerFixture(
  client: PrismaClient,
  fixture: {
    prefix: string;
    preparerUserId: string;
    attesterUserId: string;
    confirmerUserId: string;
  }
): Promise<{ projectId: string; assignmentId: string; companyId: string }> {
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
  const financeStaffPosition = await client.position.upsert({
    where: { key: "finance_staff" },
    create: {
      id: "pol275-finance-staff-position",
      key: "finance_staff",
      name: "财务人员"
    },
    update: {},
    select: { id: true }
  });
  const financeDirectorPosition = await client.position.upsert({
    where: { key: "finance_director" },
    create: {
      id: "pol275-finance-director-position",
      key: "finance_director",
      name: "财务负责人"
    },
    update: {},
    select: { id: true }
  });
  await client.userPosition.createMany({
    data: [
      {
        id: `${fixture.prefix}_preparer_finance_staff`,
        userId: fixture.preparerUserId,
        positionId: financeStaffPosition.id
      },
      {
        id: `${fixture.prefix}_attester_finance_staff`,
        userId: fixture.attesterUserId,
        positionId: financeStaffPosition.id
      },
      {
        id: `${fixture.prefix}_confirmer_finance_director`,
        userId: fixture.confirmerUserId,
        positionId: financeDirectorPosition.id
      }
    ]
  });
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
  return {
    projectId: project.id,
    assignmentId: assignment.id,
    companyId: company.id
  };
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
