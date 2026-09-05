import { createHash, randomUUID } from "node:crypto";

import { Prisma, PrismaClient } from "@prisma/client";
import { Test, TestingModule } from "@nestjs/testing";

import { AuditService } from "../audit/audit.service";
import { CompanyRoleResolverService } from "../auth/company-role-resolver.service";
import { PrismaService } from "../database/prisma.service";
import { WageStatementService } from "../wage-statement/wage-statement.service";
import { HistoricalWageTakeoverSelectionRefService } from "./historical-wage-takeover-selection-ref.service";
import {
  HistoricalWageTakeoverService,
  historicalWageLegacyFingerprint
} from "./historical-wage-takeover.service";
import { fingerprint } from "./operating-takeover.utils";

const RUN_POSTGRES =
  process.env.RUN_HISTORICAL_WAGE_TAKEOVER_DATABASE === "1";
const describePostgres = RUN_POSTGRES ? describe : describe.skip;
const databaseUrl = process.env.HISTORICAL_WAGE_TAKEOVER_DATABASE_URL;
const STAFF_POSITION_ID = "21900000-0000-4000-8000-000000000001";
const DIRECTOR_POSITION_ID = "21900000-0000-4000-8000-000000000002";

type SeededLegacy = {
  factId: string;
  projectId: string;
  sourceType: "project_wage";
  sourceBusinessId: string;
  sourceVersion: number;
  sourceFingerprint: string;
  amountCents: bigint;
  entryKind: "original" | "correction" | "reversal";
  direction: "increase" | "decrease";
  adjustsFactId: string | null;
  adjustmentRoot: {
    factId: string;
    sourceBusinessId: string;
    sourceVersion: number;
    sourceFingerprint: string;
  } | null;
  costImpactId: string;
  costImpactFingerprint: string;
  payableImpactId: string;
  payableImpactFingerprint: string;
};

type SeededActors = {
  preparerId: string;
  reviewerId: string;
  confirmerId: string;
  compensatorId: string;
  employeeId: string;
};

type SeededProject = {
  id: string;
  code: string;
  name: string;
  serviceSnapshotId: string;
  amountCents: bigint;
};

type SeededFixture = {
  grade: "A" | "B" | "C";
  now: Date;
  actors: SeededActors;
  companyId: string;
  evidenceFileId: string;
  projects: SeededProject[];
  legacy: SeededLegacy[];
  sourceVersionId?: string;
  sourceFingerprint?: string;
  selectionRef: string;
};

type PreparedScope = {
  atomicScopeVersionId: string;
  grade: "A" | "B" | "C";
  status: string;
  projectCount: number;
  rowCount: number;
  commandSelectionRef: string;
};

type ScopedSelection = {
  atomicScopeVersionId: string;
  commandSelectionRef: string;
};

describePostgres(
  "HistoricalWageTakeoverService PostgreSQL 16 atomic migration boundary",
  () => {
    const prisma = new PrismaClient(
      databaseUrl ? { datasources: { db: { url: databaseUrl } } } : undefined
    );
    let moduleRef: TestingModule;
    let service: HistoricalWageTakeoverService;

    beforeAll(async () => {
      if (!databaseUrl || process.env.NODE_ENV === "production") {
        throw new Error(
          "POL-219 PG16 测试必须连接 runner 创建的非生产 disposable database"
        );
      }
      if (
        process.env.BUILD_COMMIT_SHA !== undefined ||
        !/^[0-9a-f]{40}$/u.test(process.env.GIT_COMMIT_SHA ?? "")
      ) {
        throw new Error(
          "POL-219 PG16 测试必须只使用 runner 从 candidate SHA 派生的 GIT_COMMIT_SHA"
        );
      }
      await prisma.$connect();
      moduleRef = await Test.createTestingModule({
        providers: [
          { provide: PrismaService, useValue: prisma },
          AuditService,
          CompanyRoleResolverService,
          {
            provide: WageStatementService,
            useFactory: (
              database: PrismaService,
              roles: CompanyRoleResolverService,
              audit: AuditService
            ) => new WageStatementService(database, roles, audit),
            inject: [
              PrismaService,
              CompanyRoleResolverService,
              AuditService
            ]
          },
          {
            provide: HistoricalWageTakeoverSelectionRefService,
            useFactory: () =>
              new HistoricalWageTakeoverSelectionRefService({
                secret: "historical-wage-takeover-pg-selection-secret"
              })
          },
          HistoricalWageTakeoverService
        ]
      }).compile();
      service = moduleRef.get(HistoricalWageTakeoverService);
      await prisma.position.createMany({
        data: [
          {
            id: STAFF_POSITION_ID,
            key: "finance_staff",
            name: "POL-219 动态财务人员"
          },
          {
            id: DIRECTOR_POSITION_ID,
            key: "finance_director",
            name: "POL-219 动态财务负责人"
          }
        ]
      });
    });

    afterAll(async () => {
      await moduleRef?.close();
      await prisma.$disconnect();
    });

    it("prepares A with one exact immutable reservation and no early canonical wage writes", async () => {
      const fixture = await seedAFixture(1);
      const prepared = await prepare(fixture);

      expect(prepared).toMatchObject({
        grade: "A",
        status: "prepared",
        projectCount: 1,
        rowCount: 1
      });
      const scope = await prisma.operatingTakeoverAtomicScopeVersion.findUniqueOrThrow(
        {
          where: { id: prepared.atomicScopeVersionId },
          include: {
            wageStatementReservation: true,
            projects: { include: { manifest: { include: { rows: true } } } }
          }
        }
      );
      const row = scope.projects[0]?.manifest.rows[0];
      expect(scope.reservedWageStatementVersionId).toEqual(expect.any(String));
      expect(scope.wageStatementReservation).toEqual(
        expect.objectContaining({
          id: scope.reservedWageStatementVersionId,
          atomicScopeVersionId: scope.id
        })
      );
      expect(row).toEqual(
        expect.objectContaining({
          evidenceLevel: "A",
          mappingDecision: "FORMAL",
          wageApprovedSourceVersionId: fixture.sourceVersionId,
          wageStatementReservationId: scope.reservedWageStatementVersionId
        })
      );
      await expect(
        prisma.wageStatementVersion.count({
          where: { sourceVersionId: fixture.sourceVersionId }
        })
      ).resolves.toBe(0);
      await expect(
        prisma.wageTakeoverProjectionEnvelope.count({
          where: { atomicScopeVersionId: scope.id }
        })
      ).resolves.toBe(0);
      await expect(
        prisma.operatingTakeoverLegacySourceBridge.count({
          where: { rowMappingId: row!.id }
        })
      ).resolves.toBe(0);

      await expect(
        prisma.wageTakeoverWageStatementReservation.update({
          where: { id: scope.reservedWageStatementVersionId! },
          data: { createdAt: new Date() }
        })
      ).rejects.toThrow("不可更新或删除");
    });

    it("keeps inactive apply receipt-only and leaves every formal target absent", async () => {
      const fixture = await seedAFixture(1);
      const prepared = await prepare(fixture);
      const before = await formalWriteCounts(prepared.atomicScopeVersionId);

      await expect(
        apply(fixture, prepared)
      ).resolves.toMatchObject({
        atomicScopeVersionId: prepared.atomicScopeVersionId,
        grade: "A",
        status: "inactive_applied",
        revision: 2,
        rowCount: 1
      });

      expect(await formalWriteCounts(prepared.atomicScopeVersionId)).toEqual(
        before
      );
      await expect(
        prisma.operatingTakeoverCommandReceipt.findMany({
          where: { atomicScopeVersionId: prepared.atomicScopeVersionId },
          orderBy: { createdAt: "asc" },
          select: { action: true, status: true }
        })
      ).resolves.toEqual([
        {
          action: "historical_wage_takeover.scope.create",
          status: "prepared"
        },
        {
          action: "historical_wage_takeover.scope.apply",
          status: "inactive_applied"
        }
      ]);
      await expect(
        prisma.auditLog.count({
          where: {
            businessId: prepared.atomicScopeVersionId,
            action: "operating_takeover.historical_wage.scope.apply"
          }
        })
      ).resolves.toBe(1);
    });

    it("accepts legal B dual attestation, rejects identity reuse with zero writes, and creates reconciliation-only refs", async () => {
      const fixture = await seedBFixture();
      const prepared = await prepare(fixture);
      await apply(fixture, prepared);

      const illegalCounts = await commandWriteCounts(
        prepared.atomicScopeVersionId
      );
      await expect(
        service.attest(
          fixture.actors.preparerId,
          {
            selectionRef: prepared.commandSelectionRef,
            idempotencyKey: randomUUID(),
            expectedRevision: 2,
            businessReason: "声明人不得复核自己的 B 级汇总"
          },
          at(fixture, 3)
        )
      ).rejects.toThrow("职责分离失败");
      expect(
        await commandWriteCounts(prepared.atomicScopeVersionId)
      ).toEqual(illegalCounts);

      const reviewerSelection = await reissue(
        fixture,
        prepared,
        fixture.actors.reviewerId,
        4
      );
      await expect(
        service.attest(
          fixture.actors.reviewerId,
          {
            selectionRef: reviewerSelection.commandSelectionRef,
            idempotencyKey: randomUUID(),
            expectedRevision: 2,
            businessReason: "独立复核 B 级历史工资汇总"
          },
          at(fixture, 5)
        )
      ).resolves.toMatchObject({ grade: "B", status: "attested", revision: 3 });

      const confirmerSelection = await reissue(
        fixture,
        prepared,
        fixture.actors.confirmerId,
        6
      );
      const paymentExecutionsBefore = await prisma.paymentExecution.count();
      await expect(
        service.activate(
          fixture.actors.confirmerId,
          {
            selectionRef: confirmerSelection.commandSelectionRef,
            idempotencyKey: randomUUID(),
            expectedRevision: 3,
            businessReason: "激活 B 级历史工资对账引用"
          },
          at(fixture, 7)
        )
      ).resolves.toMatchObject({
        grade: "B",
        status: "activated",
        revision: 4,
        rows: [
          expect.objectContaining({
            decision: "FORMAL",
            targetKind: "historical_wage_summary_authority_version"
          })
        ]
      });

      const authority = await prisma.historicalWageSummaryAuthorityVersion.findFirstOrThrow(
        {
          where: { atomicScopeVersionId: prepared.atomicScopeVersionId },
          include: {
            attestations: {
              orderBy: { createdAt: "asc" }
            },
            creditorLines: {
              orderBy: { stableBucketKey: "asc" }
            },
            payableRefs: {
              include: { historicalWageBalanceReconciliationVersion: true }
            }
          }
        }
      );
      expect(authority.attestations).toHaveLength(2);
      expect(
        authority.attestations.map(({ actorUserId }) => actorUserId)
      ).toEqual(
        expect.arrayContaining([
          fixture.actors.preparerId,
          fixture.actors.reviewerId
        ])
      );
      const attestationReceipts = await prisma.operatingTakeoverCommandReceipt.findMany(
        {
          where: {
            id: { in: authority.attestations.map(({ receiptId }) => receiptId) }
          },
          select: { id: true, createdTransactionId: true }
        }
      );
      const receiptTransactionById = new Map(
        attestationReceipts.map((receipt) => [
          receipt.id,
          receipt.createdTransactionId
        ])
      );
      for (const attestation of authority.attestations) {
        expect(attestation.createdTransactionId).toBe(
          receiptTransactionById.get(attestation.receiptId)
        );
      }
      expect(authority.payableRefs).toHaveLength(2);
      expect(new Set(authority.payableRefs.map((ref) => ref.stableBucketKey)).size).toBe(2);
      expect(new Set(authority.payableRefs.map((ref) => ref.wageCreditorCategoryCode))).toEqual(
        new Set(["employee_net_pay"])
      );
      const partiallySettled = authority.payableRefs.find(
        (ref) => ref.controlledScopeCode === "employees-a"
      );
      expect(partiallySettled).toEqual(
        expect.objectContaining({
          usageScope: "historical_reconciliation_only",
          newPaymentAllowed: false,
          settlementAllocationAllowed: false,
          targetKind: "historical_wage_balance_reconciliation_version",
          grossDebtCents: 3_000_000n,
          historicallySettledCents: 2_000_000n,
          outstandingBalanceCents: 1_000_000n,
          historicalWageBalanceReconciliationVersion: expect.objectContaining({
            projectId: fixture.projects[0]!.id,
            employmentCompanyId: fixture.companyId,
            grossDebtCents: 3_000_000n,
            historicallySettledCents: 2_000_000n,
            outstandingBalanceCents: 1_000_000n
          })
        })
      );
      const firstCreditorLine = authority.creditorLines[0]!;
      const creditorLineCount = authority.creditorLines.length;
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(
            "SET LOCAL session_replication_role = replica"
          );
          await tx.$executeRaw`
            INSERT INTO "HistoricalWageSummaryAuthorityCreditorLine"
            SELECT (jsonb_populate_record(
              NULL::"HistoricalWageSummaryAuthorityCreditorLine",
              to_jsonb(source_line) || jsonb_build_object('id', ${randomUUID()})
            )).* FROM "HistoricalWageSummaryAuthorityCreditorLine" source_line
            WHERE source_line."id" = ${firstCreditorLine.id}
          `;
        })
      ).rejects.toThrow();
      const forgedStableBucketKey = `${firstCreditorLine.stableBucketKey}-forged`;
      await expect(
        prisma.$executeRaw`
          INSERT INTO "HistoricalWageSummaryAuthorityCreditorLine"
          SELECT (jsonb_populate_record(
            NULL::"HistoricalWageSummaryAuthorityCreditorLine",
            to_jsonb(source_line) || jsonb_build_object(
              'id', ${randomUUID()},
              'stableBucketKey', ${forgedStableBucketKey},
              'stableBucketKeyFingerprint', ${sha(forgedStableBucketKey)}
            )
          )).* FROM "HistoricalWageSummaryAuthorityCreditorLine" source_line
          WHERE source_line."id" = ${firstCreditorLine.id}
        `
      ).rejects.toThrow("稳定 bucket");
      await expect(
        prisma.historicalWageSummaryAuthorityCreditorLine.count({
          where: { authorityVersionId: authority.id }
        })
      ).resolves.toBe(creditorLineCount);
      await expect(
        prisma.wageStatement.count({
          where: { employmentCompanyId: fixture.companyId }
        })
      ).resolves.toBe(0);
      await expect(prisma.paymentExecution.count()).resolves.toBe(
        paymentExecutionsBefore
      );
    });

    it("rejects a receipt whose canonical binding disagrees with its actor even when the snapshot hash is recomputed", async () => {
      const fixture = await seedAFixture(1);
      const prepared = await prepare(fixture);
      const receipt =
        await prisma.operatingTakeoverCommandReceipt.findFirstOrThrow({
          where: {
            atomicScopeVersionId: prepared.atomicScopeVersionId,
            action: "historical_wage_takeover.scope.create"
          }
        });
      const snapshot = receipt.commandSnapshot as Prisma.JsonObject;
      const binding = snapshot.binding as Prisma.JsonObject;
      const tamperedSnapshot: Prisma.JsonObject = {
        ...snapshot,
        binding: {
          ...binding,
          actorUserId: fixture.actors.reviewerId
        }
      };

      await expect(
        prisma.$executeRaw(
          Prisma.sql`
            INSERT INTO "OperatingTakeoverCommandReceipt" (
              "id", "manifestVersionId", "atomicScopeVersionId", "idempotencyKey",
              "action", "expectedRevision", "actorUserId", "delegatorUserId",
              "actorSetSnapshot", "permissionSnapshotFingerprint", "fingerprint",
              "status", "commandSnapshotSchemaVersion", "commandSnapshot",
              "resultSnapshot", "causalityFingerprint", "causesReceiptId"
            )
            SELECT
              ${randomUUID()}, "manifestVersionId", "atomicScopeVersionId", ${randomUUID()},
              "action", "expectedRevision", "actorUserId", "delegatorUserId",
              "actorSetSnapshot", "permissionSnapshotFingerprint", ${fingerprint(tamperedSnapshot)},
              "status", 1, CAST(${JSON.stringify(tamperedSnapshot)} AS JSONB),
              "resultSnapshot", "causalityFingerprint", "causesReceiptId"
            FROM "OperatingTakeoverCommandReceipt"
            WHERE "id" = ${receipt.id}
          `
        )
      ).rejects.toThrow(
        "POL-219 receipt 必须保存可精确重算指纹的版本化 canonical command snapshot"
      );

      const legacyReceipt =
        await prisma.operatingTakeoverCommandReceipt.create({
          data: {
            id: randomUUID(),
            manifestVersionId: (
              await prisma.operatingTakeoverManifestVersion.findFirstOrThrow({
                where: {
                  atomicScopeVersionId: prepared.atomicScopeVersionId
                },
                select: { id: true }
              })
            ).id,
            idempotencyKey: randomUUID(),
            action: "operating_takeover.legacy_receipt_compatibility_probe",
            expectedRevision: 0,
            actorUserId: fixture.actors.preparerId,
            actorSetSnapshot: {
              actualUserId: fixture.actors.preparerId,
              actorIds: [fixture.actors.preparerId]
            },
            permissionSnapshotFingerprint: sha("legacy permission snapshot"),
            fingerprint: sha("legacy command fingerprint"),
            status: "prepared",
            resultSnapshot: { compatible: true },
            causalityFingerprint: sha("legacy causality fingerprint")
          },
          select: {
            commandSnapshotSchemaVersion: true,
            commandSnapshot: true
          }
        });
      expect(legacyReceipt).toEqual({
        commandSnapshotSchemaVersion: null,
        commandSnapshot: null
      });
    });

    it("activates one multi-project A scope atomically at the reserved UUID without duplicating legacy facts", async () => {
      const fixture = await seedAFixture(2);
      const prepared = await prepare(fixture);
      await apply(fixture, prepared);
      const confirmerSelection = await reissue(
        fixture,
        prepared,
        fixture.actors.confirmerId,
        3
      );
      const legacyFactCount = await prisma.operatingFact.count();
      const legacyImpactCount = await prisma.operatingImpactEntry.count();

      const activated = (await service.activate(
        fixture.actors.confirmerId,
        {
          selectionRef: confirmerSelection.commandSelectionRef,
          idempotencyKey: randomUUID(),
          expectedRevision: 2,
          businessReason: "原子激活完整多项目 A 级工资范围"
        },
        at(fixture, 4)
      )) as {
        grade: string;
        status: string;
        revision: number;
        rows: Array<Record<string, unknown>>;
      };

      expect(activated).toMatchObject({
        grade: "A",
        status: "activated",
        revision: 3
      });
      expect(activated.rows).toHaveLength(2);
      const scope = await prisma.operatingTakeoverAtomicScopeVersion.findUniqueOrThrow(
        {
          where: { id: prepared.atomicScopeVersionId },
          include: { wageStatementReservation: true }
        }
      );
      const version = await prisma.wageStatementVersion.findUniqueOrThrow({
        where: { id: scope.reservedWageStatementVersionId! },
        include: {
          personLines: {
            include: {
              costComponents: true,
              creditorBreakdowns: true,
              projectAllocations: {
                include: {
                  componentAllocations: true,
                  creditorAllocations: true
                }
              }
            }
          },
          payableRefs: true,
          takeoverProjectionEnvelopes: {
            include: {
              costCells: true,
              payableRefs: true,
              legacyImpactBridges: { orderBy: { impactKind: "asc" } }
            }
          }
        }
      });
      expect(version.id).toBe(scope.wageStatementReservation!.id);
      expect(version).toMatchObject({
        status: "confirmed",
        projectionOrigin: "historical_takeover_legacy_link",
        sourceVersionId: fixture.sourceVersionId
      });
      expect(version.personLines).toHaveLength(1);
      expect(version.personLines[0]!.projectAllocations).toHaveLength(2);
      expect(
        version.personLines[0]!.projectAllocations.flatMap(
          ({ componentAllocations }) => componentAllocations
        )
      ).toHaveLength(2);
      expect(
        version.personLines[0]!.projectAllocations.flatMap(
          ({ creditorAllocations }) => creditorAllocations
        )
      ).toHaveLength(2);
      expect(version.payableRefs).toHaveLength(2);
      expect(version.takeoverProjectionEnvelopes).toHaveLength(2);
      expect(
        version.takeoverProjectionEnvelopes.every(
          (envelope) =>
            envelope.costCells.length === 1 &&
            envelope.payableRefs.length === 1 &&
            envelope.legacyImpactBridges.length === 2
        )
      ).toBe(true);
      for (const envelope of version.takeoverProjectionEnvelopes) {
        const legacy = fixture.legacy.find(
          (item) => item.projectId === envelope.projectId
        )!;
        expect(envelope.legacyImpactBridges).toEqual([
          expect.objectContaining({
            rowMappingId: envelope.rowMappingId,
            projectId: envelope.projectId,
            legacyImpactEntryId: legacy.costImpactId,
            impactKind: "confirmed_cost",
            direction: "increase",
            amountCents: legacy.amountCents,
            sourceFingerprint: legacy.costImpactFingerprint
          }),
          expect.objectContaining({
            rowMappingId: envelope.rowMappingId,
            projectId: envelope.projectId,
            legacyImpactEntryId: legacy.payableImpactId,
            impactKind: "payable_increase",
            direction: "increase",
            amountCents: legacy.amountCents,
            sourceFingerprint: legacy.payableImpactFingerprint
          })
        ]);
      }
      await expect(
        prisma.operatingTakeoverLegacySourceBridge.count({
          where: { rowMappingId: { in: await mappingIds(prepared) } }
        })
      ).resolves.toBe(2);
      await expect(prisma.operatingFact.count()).resolves.toBe(legacyFactCount);
      await expect(prisma.operatingImpactEntry.count()).resolves.toBe(
        legacyImpactCount
      );
    });

    it("replays exact activation without writes and rejects changed payload reuse without writes", async () => {
      const fixture = await seedAFixture(1);
      const prepared = await prepare(fixture);
      await apply(fixture, prepared);
      const confirmerSelection = await reissue(
        fixture,
        prepared,
        fixture.actors.confirmerId,
        3
      );
      const activationInput = {
        selectionRef: confirmerSelection.commandSelectionRef,
        idempotencyKey: randomUUID(),
        expectedRevision: 2,
        businessReason: "幂等激活 A 级历史工资"
      };
      const first = await service.activate(
        fixture.actors.confirmerId,
        activationInput,
        at(fixture, 4)
      );
      const afterFirst = await allWriteCounts();

      await expect(
        service.activate(
          fixture.actors.confirmerId,
          activationInput,
          at(fixture, 5)
        )
      ).resolves.toEqual(first);
      expect(await allWriteCounts()).toEqual(afterFirst);

      await expect(
        service.activate(
          fixture.actors.confirmerId,
          { ...activationInput, businessReason: "同键但已改变的激活理由" },
          at(fixture, 6)
        )
      ).rejects.toThrow("同一幂等键");
      expect(await allWriteCounts()).toEqual(afterFirst);
    });

    it("links a mixed signed A correction to one net legacy impact without losing canonical cell directions", async () => {
      const seeded = await seedMixedSignedCorrectionAFixture();
      const fixture = seeded.fixture;
      const prepared = await prepare(fixture);
      expect(prepared.grade).toBe("A");
      await apply(fixture, prepared);
      const confirmerSelection = await reissue(
        fixture,
        prepared,
        fixture.actors.confirmerId,
        3
      );
      const legacyFactsBefore = await prisma.operatingFact.count();
      const legacyImpactsBefore = await prisma.operatingImpactEntry.count();

      await expect(
        service.activate(
          fixture.actors.confirmerId,
          {
            selectionRef: confirmerSelection.commandSelectionRef,
            idempotencyKey: randomUUID(),
            expectedRevision: 2,
            businessReason: "激活同项目净增但 canonical cells 正负混合的工资更正"
          },
          at(fixture, 4)
        )
      ).resolves.toMatchObject({ grade: "A", status: "activated", revision: 3 });

      const version = await prisma.wageStatementVersion.findFirstOrThrow({
        where: { sourceVersionId: fixture.sourceVersionId },
        include: {
          payableRefs: { orderBy: [{ direction: "asc" }, { amountCents: "asc" }] },
          takeoverProjectionEnvelopes: {
            include: {
              costCells: { orderBy: [{ direction: "asc" }, { amountCents: "asc" }] },
              payableRefs: { orderBy: [{ direction: "asc" }, { amountCents: "asc" }] },
              legacyImpactBridges: { orderBy: { impactKind: "asc" } }
            }
          }
        }
      });
      expect(version).toMatchObject({
        kind: "correction",
        revision: 2,
        projectionOrigin: "historical_takeover_legacy_link",
        status: "confirmed"
      });
      expect(version.payableRefs).toHaveLength(2);
      expect(
        version.payableRefs.map(({ direction, amountCents, adjustsPayableRefId }) => ({
          direction,
          amountCents,
          hasRoot: Boolean(adjustsPayableRefId)
        }))
      ).toEqual([
        { direction: "decrease", amountCents: 200n, hasRoot: true },
        { direction: "increase", amountCents: 1200n, hasRoot: true }
      ]);
      expect(version.takeoverProjectionEnvelopes).toHaveLength(1);
      const envelope = version.takeoverProjectionEnvelopes[0]!;
      expect(
        envelope.costCells.map(({ direction, amountCents }) => ({
          direction,
          amountCents
        }))
      ).toEqual([
        { direction: "decrease", amountCents: 200n },
        { direction: "increase", amountCents: 1200n }
      ]);
      expect(
        envelope.payableRefs.map(({ direction, amountCents }) => ({
          direction,
          amountCents
        }))
      ).toEqual([
        { direction: "decrease", amountCents: 200n },
        { direction: "increase", amountCents: 1200n }
      ]);
      expect(envelope.legacyImpactBridges).toEqual([
        expect.objectContaining({
          legacyImpactEntryId: fixture.legacy[0]!.costImpactId,
          impactKind: "confirmed_cost",
          direction: "increase",
          amountCents: 1000n
        }),
        expect.objectContaining({
          legacyImpactEntryId: fixture.legacy[0]!.payableImpactId,
          impactKind: "payable_increase",
          direction: "increase",
          amountCents: 1000n
        })
      ]);
      expect(await prisma.operatingFact.count()).toBe(legacyFactsBefore);
      expect(await prisma.operatingImpactEntry.count()).toBe(legacyImpactsBefore);
    });

    it("materializes C only as an unresolved gap and never creates a formal wage target", async () => {
      const fixture = await seedCFixture();
      const formalBefore = await formalWriteCounts("not-created");
      const legacyFactsBefore = await prisma.operatingFact.count();
      const legacyImpactsBefore = await prisma.operatingImpactEntry.count();
      const prepared = await prepare(fixture);

      expect(prepared).toMatchObject({
        grade: "C",
        status: "prepared",
        projectCount: 1,
        rowCount: 1
      });
      await apply(fixture, prepared);
      const confirmerSelection = await reissue(
        fixture,
        prepared,
        fixture.actors.confirmerId,
        3
      );
      await expect(
        service.activate(
          fixture.actors.confirmerId,
          {
            selectionRef: confirmerSelection.commandSelectionRef,
            idempotencyKey: randomUUID(),
            expectedRevision: 2,
            businessReason: "仅登记无法形成工资权威闭合的 C 级缺口"
          },
          at(fixture, 4)
        )
      ).resolves.toMatchObject({
        grade: "C",
        status: "activated",
        rows: [
          expect.objectContaining({
            decision: "GAP",
            targetKind: "unresolved_wage_payable_gap"
          })
        ]
      });

      const scope = await prisma.operatingTakeoverAtomicScopeVersion.findUniqueOrThrow({
        where: { id: prepared.atomicScopeVersionId },
        include: {
          unresolvedWageGaps: true,
          projects: { include: { manifest: { include: { rows: true } } } }
        }
      });
      expect(scope.reservedWageStatementVersionId).toBeNull();
      expect(scope.unresolvedWageGaps).toHaveLength(1);
      expect(scope.unresolvedWageGaps[0]!.wageMonth).toBe("2026-08");
      expect(scope.projects[0]!.manifest.rows[0]).toEqual(
        expect.objectContaining({
          evidenceLevel: "C",
          mappingDecision: "GAP",
          sourceDiscriminator: null,
          wageApprovedSourceVersionId: null,
          wageStatementReservationId: null,
          historicalWageSummaryAuthorityVersionId: null
        })
      );
      expect(
        await prisma.operatingTakeoverLegacySourceBridge.findFirstOrThrow({
          where: { rowMappingId: scope.projects[0]!.manifest.rows[0]!.id }
        })
      ).toEqual(
        expect.objectContaining({
          mappingDecision: "GAP",
          targetKind: "unresolved_wage_payable_gap",
          targetRef: scope.unresolvedWageGaps[0]!.id
        })
      );
      expect(await prisma.operatingFact.count()).toBe(legacyFactsBefore);
      expect(await prisma.operatingImpactEntry.count()).toBe(legacyImpactsBefore);
      const formalAfter = await formalWriteCounts(prepared.atomicScopeVersionId);
      expect(formalAfter).toMatchObject({
        wageStatements: formalBefore.wageStatements,
        wageVersions: formalBefore.wageVersions,
        wagePeople: formalBefore.wagePeople,
        wagePayables: formalBefore.wagePayables,
        envelopes: 0,
        summaryRefs: 0,
        reconciliations: 0,
        gaps: 1,
        bridges: 1,
        paymentExecutions: formalBefore.paymentExecutions
      });
    });

    it("fails activation with zero writes when the reserved A target baseline drifts", async () => {
      const fixture = await seedAFixture(1);
      const prepared = await prepare(fixture);
      await apply(fixture, prepared);
      const confirmerSelection = await reissue(
        fixture,
        prepared,
        fixture.actors.confirmerId,
        3
      );
      await prisma.wageStatement.create({
        data: {
          id: randomUUID(),
          employmentCompanyId: fixture.companyId,
          wageMonth: "2026-08",
          currentRevision: 0,
          createdByUserId: fixture.actors.preparerId
        }
      });
      const before = await allWriteCounts();

      await expect(
        service.activate(
          fixture.actors.confirmerId,
          {
            selectionRef: confirmerSelection.commandSelectionRef,
            idempotencyKey: randomUUID(),
            expectedRevision: 2,
            businessReason: "目标工资承担单基线漂移必须零写入失败"
          },
          at(fixture, 4)
        )
      ).rejects.toThrow(/漂移|变化|占用/u);

      expect(await allWriteCounts()).toEqual(before);
      await expect(
        prisma.wageStatementVersion.count({
          where: { sourceVersionId: fixture.sourceVersionId }
        })
      ).resolves.toBe(0);
      await expect(
        prisma.operatingTakeoverLegacySourceBridge.count({
          where: { rowMappingId: { in: await mappingIds(prepared) } }
        })
      ).resolves.toBe(0);
    });

    it("serializes two real concurrent activation attempts so exactly one scope commit wins", async () => {
      const fixture = await seedAFixture(1);
      const prepared = await prepare(fixture);
      await apply(fixture, prepared);
      const confirmerSelection = await reissue(
        fixture,
        prepared,
        fixture.actors.confirmerId,
        3
      );
      const activate = (idempotencyKey: string) =>
        service.activate(
          fixture.actors.confirmerId,
          {
            selectionRef: confirmerSelection.commandSelectionRef,
            idempotencyKey,
            expectedRevision: 2,
            businessReason: "并发激活同一历史工资原子范围"
          },
          at(fixture, 4)
        );

      const outcomes = await Promise.allSettled([
        activate(randomUUID()),
        activate(randomUUID())
      ]);
      expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
      expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(1);
      await expect(
        prisma.operatingTakeoverCommandReceipt.count({
          where: {
            atomicScopeVersionId: prepared.atomicScopeVersionId,
            action: "historical_wage_takeover.scope.activate"
          }
        })
      ).resolves.toBe(1);
      await expect(
        prisma.wageStatementVersion.count({
          where: { sourceVersionId: fixture.sourceVersionId }
        })
      ).resolves.toBe(1);
      await expect(
        prisma.wageTakeoverProjectionEnvelope.count({
          where: { atomicScopeVersionId: prepared.atomicScopeVersionId }
        })
      ).resolves.toBe(1);
      await expect(
        prisma.wageTakeoverLegacyImpactBridge.count({
          where: { rowMappingId: { in: await mappingIds(prepared) } }
        })
      ).resolves.toBe(2);
    });

    it("compensates A eligibility without deleting canonical wages or reversing legacy facts", async () => {
      const fixture = await seedAFixture(2);
      const prepared = await prepare(fixture);
      await apply(fixture, prepared);
      const confirmerSelection = await reissue(
        fixture,
        prepared,
        fixture.actors.confirmerId,
        3
      );
      await service.activate(
        fixture.actors.confirmerId,
        {
          selectionRef: confirmerSelection.commandSelectionRef,
          idempotencyKey: randomUUID(),
          expectedRevision: 2,
          businessReason: "激活后验证接管资格补偿"
        },
        at(fixture, 4)
      );
      const before = await allWriteCounts();
      const compensationSelection = await reissue(
        fixture,
        prepared,
        fixture.actors.compensatorId,
        5
      );

      await expect(
        service.compensate(
          fixture.actors.compensatorId,
          {
            selectionRef: compensationSelection.commandSelectionRef,
            idempotencyKey: randomUUID(),
            expectedRevision: 3,
            businessReason: "只撤销 historical takeover 资格，不改写原工资事实"
          },
          at(fixture, 6)
        )
      ).resolves.toMatchObject({
        grade: "A",
        status: "compensated",
        revision: 4
      });

      const after = await allWriteCounts();
      expect(after).toMatchObject({
        statements: before.statements,
        versions: before.versions,
        people: before.people,
        components: before.components,
        creditors: before.creditors,
        allocations: before.allocations,
        costCells: before.costCells,
        creditorCells: before.creditorCells,
        payableRefs: before.payableRefs,
        envelopes: before.envelopes,
        envelopeCosts: before.envelopeCosts,
        envelopePayables: before.envelopePayables,
        impactBridges: before.impactBridges,
        bridges: before.bridges,
        operatingFacts: before.operatingFacts,
        operatingImpacts: before.operatingImpacts
      });
      await expect(
        prisma.wageTakeoverProjectionEnvelopeEligibilityRevocation.count({
          where: {
            envelope: { atomicScopeVersionId: prepared.atomicScopeVersionId }
          }
        })
      ).resolves.toBe(2);
    });

    it("rolls back the whole multi-project activation after an injected final-envelope database failure", async () => {
      const fixture = await seedAFixture(2);
      const prepared = await prepare(fixture);
      await apply(fixture, prepared);
      const confirmerSelection = await reissue(
        fixture,
        prepared,
        fixture.actors.confirmerId,
        3
      );
      await prisma.$executeRawUnsafe(`
        CREATE FUNCTION "pol219_test_fail_final_envelope"() RETURNS trigger AS $$
        BEGIN
          IF NEW."projectId" = (
            SELECT MAX(project_scope."projectId")
            FROM "OperatingTakeoverAtomicScopeProject" project_scope
            WHERE project_scope."atomicScopeVersionId" = NEW."atomicScopeVersionId"
          ) THEN
            RAISE EXCEPTION 'POL219_TEST_FINAL_ENVELOPE_FAILURE';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER "pol219_test_fail_final_envelope"
        BEFORE INSERT ON "WageTakeoverProjectionEnvelope"
        FOR EACH ROW EXECUTE FUNCTION "pol219_test_fail_final_envelope"()
      `);
      const before = await allWriteCounts();

      try {
        await expect(
          service.activate(
            fixture.actors.confirmerId,
            {
              selectionRef: confirmerSelection.commandSelectionRef,
              idempotencyKey: randomUUID(),
              expectedRevision: 2,
              businessReason: "验证后序数据库失败时整组回滚"
            },
            at(fixture, 4)
          )
        ).rejects.toThrow("POL219_TEST_FINAL_ENVELOPE_FAILURE");
      } finally {
        await prisma.$executeRawUnsafe(`
          DROP TRIGGER IF EXISTS "pol219_test_fail_final_envelope"
          ON "WageTakeoverProjectionEnvelope"
        `);
        await prisma.$executeRawUnsafe(
          'DROP FUNCTION IF EXISTS "pol219_test_fail_final_envelope"()'
        );
      }

      expect(await allWriteCounts()).toEqual(before);
      await expect(
        prisma.wageStatementVersion.count({
          where: { sourceVersionId: fixture.sourceVersionId }
        })
      ).resolves.toBe(0);
      await expect(
        prisma.wageTakeoverProjectionEnvelope.count({
          where: { atomicScopeVersionId: prepared.atomicScopeVersionId }
        })
      ).resolves.toBe(0);
      await expect(
        prisma.operatingTakeoverCommandReceipt.count({
          where: {
            atomicScopeVersionId: prepared.atomicScopeVersionId,
            action: "historical_wage_takeover.scope.activate"
          }
        })
      ).resolves.toBe(0);
    });

    async function seedAFixture(projectCount: 1 | 2): Promise<SeededFixture> {
      const fixture = await seedCore(projectCount);
      const evidenceSha256 = sha(`a-evidence:${fixture.evidenceFileId}`);
      await prisma.fileObject.create({
        data: {
          id: fixture.evidenceFileId,
          bucket: "pol219-dynamic",
          objectKey: `historical-wage/${fixture.evidenceFileId}`,
          originalName: "历史工资批准资料.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          sizeBytes: 219,
          uploadedByUserId: fixture.actors.preparerId,
          contentSha256: evidenceSha256
        }
      });
      const sourceVersionId = randomUUID();
      const projectAllocations = fixture.projects.map((project) => ({
        projectId: project.id,
        serviceSnapshotId: project.serviceSnapshotId,
        serviceMonth: "2026-08",
        serviceEvidenceSha256: evidenceSha256,
        amountCents: project.amountCents.toString()
      }));
      const sourceSnapshot = {
        employmentCompany: {
          id: fixture.companyId,
          name: "POL-219 工资承担公司"
        },
        wageMonth: "2026-08",
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
        externalReference: `POL219-${sourceVersionId}`,
        sourceVersion: "1",
        basisDate: "2026-08-31",
        evidence: {
          fileId: fixture.evidenceFileId,
          sha256: evidenceSha256
        },
        approvedPersonLines: [
          {
            employeeId: fixture.actors.employeeId,
            employmentSnapshotId: randomUUID(),
            employmentCompanyId: fixture.companyId,
            employmentPeriodStart: "2026-08-01",
            employmentPeriodEnd: "2026-08-31",
            positionCategory: "project_manager",
            approvedAmountCents: "1000",
            costComponents: [
              { componentCode: "gross_wage", amountCents: "1000" }
            ],
            creditorBreakdowns: [
              {
                creditorSubjectType: "employee_user",
                creditorUserId: fixture.actors.employeeId,
                creditorCategory: "employee_net_pay",
                amountCents: "1000"
              }
            ],
            projectAllocations,
            projectCostComponentAllocations: fixture.projects.map(
              (project) => ({
                projectId: project.id,
                serviceSnapshotId: project.serviceSnapshotId,
                componentCode: "gross_wage",
                amountCents: project.amountCents.toString()
              })
            ),
            projectCreditorAllocations: fixture.projects.map((project) => ({
              projectId: project.id,
              serviceSnapshotId: project.serviceSnapshotId,
              creditorSubjectType: "employee_user",
              creditorUserId: fixture.actors.employeeId,
              creditorCategory: "employee_net_pay",
              amountCents: project.amountCents.toString()
            }))
          }
        ]
      };
      const sourceFingerprint = fingerprint(sourceSnapshot);
      await prisma.wageApprovedSourceVersion.create({
        data: {
          id: sourceVersionId,
          employmentCompanyId: fixture.companyId,
          wageMonth: "2026-08",
          periodStart: new Date("2026-08-01T00:00:00.000Z"),
          periodEnd: new Date("2026-08-31T00:00:00.000Z"),
          sourceType: "external_approved_wage",
          externalReference: `POL219-${sourceVersionId}`,
          sourceVersion: "1",
          basisDate: new Date("2026-08-31T00:00:00.000Z"),
          evidenceFileId: fixture.evidenceFileId,
          evidenceSha256,
          sourceFingerprint,
          sourceSnapshot,
          createdByUserId: fixture.actors.preparerId
        }
      });
      await prisma.wageServiceBasisBinding.createMany({
        data: fixture.projects.map((project) => ({
          id: randomUUID(),
          sourceVersionId,
          projectId: project.id,
          serviceSnapshotId: project.serviceSnapshotId,
          serviceMonth: "2026-08",
          evidenceSha256,
          authorityFingerprint: fingerprint({
            sourceVersionId,
            projectId: project.id,
            serviceSnapshotId: project.serviceSnapshotId,
            serviceMonth: "2026-08",
            evidenceSha256
          })
        }))
      });
      const legacy = await seedLegacyRows(
        fixture,
        fixture.projects.map((project) => ({
          project,
          sourceSnapshot: {
            source: "POL-219 A-grade legacy wage",
            sourceVersionId
          }
        }))
      );
      const selectionRef = await issueASelection(fixture);
      return {
        ...fixture,
        grade: "A",
        legacy,
        sourceVersionId,
        sourceFingerprint,
        selectionRef
      };
    }

    async function seedMixedSignedCorrectionAFixture(): Promise<{
      fixture: SeededFixture;
    }> {
      const fixture = await seedCore(1);
      const project = fixture.projects[0]!;
      const secondEmployeeId = randomUUID();
      await prisma.user.create({
        data: { id: secondEmployeeId, name: "POL-219 工资正负混合人员" }
      });
      const externalReference = `POL219-MIXED-${randomUUID()}`;
      const people = [
        {
          employeeId: fixture.actors.employeeId,
          employmentSnapshotId: randomUUID(),
          positionCategory: "engineering_technical"
        },
        {
          employeeId: secondEmployeeId,
          employmentSnapshotId: randomUUID(),
          positionCategory: "quality_safety"
        }
      ];

      const persistSource = async (
        sourceVersion: "1" | "2",
        amounts: readonly [bigint, bigint]
      ) => {
        const sourceVersionId = randomUUID();
        const evidenceFileId = randomUUID();
        const evidenceSha256 = sha(`mixed-evidence:${evidenceFileId}`);
        await prisma.fileObject.create({
          data: {
            id: evidenceFileId,
            bucket: "pol219-dynamic",
            objectKey: `historical-wage/${evidenceFileId}`,
            originalName: `历史工资混合更正资料-v${sourceVersion}.xlsx`,
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            sizeBytes: 219,
            uploadedByUserId: fixture.actors.preparerId,
            contentSha256: evidenceSha256
          }
        });
        const approvedPersonLines = people.map((person, index) => {
          const amountCents = amounts[index]!;
          return {
            employeeId: person.employeeId,
            employmentSnapshotId: person.employmentSnapshotId,
            employmentCompanyId: fixture.companyId,
            employmentPeriodStart: "2026-08-01",
            employmentPeriodEnd: "2026-08-31",
            positionCategory: person.positionCategory,
            approvedAmountCents: amountCents.toString(),
            costComponents: [
              {
                componentCode: "gross_wage",
                amountCents: amountCents.toString()
              }
            ],
            creditorBreakdowns: [
              {
                creditorSubjectType: "employee_user",
                creditorUserId: person.employeeId,
                creditorCategory: "employee_net_pay",
                amountCents: amountCents.toString()
              }
            ],
            projectAllocations: [
              {
                projectId: project.id,
                serviceSnapshotId: project.serviceSnapshotId,
                serviceMonth: "2026-08",
                serviceEvidenceSha256: evidenceSha256,
                amountCents: amountCents.toString()
              }
            ],
            projectCostComponentAllocations: [
              {
                projectId: project.id,
                serviceSnapshotId: project.serviceSnapshotId,
                componentCode: "gross_wage",
                amountCents: amountCents.toString()
              }
            ],
            projectCreditorAllocations: [
              {
                projectId: project.id,
                serviceSnapshotId: project.serviceSnapshotId,
                creditorSubjectType: "employee_user",
                creditorUserId: person.employeeId,
                creditorCategory: "employee_net_pay",
                amountCents: amountCents.toString()
              }
            ]
          };
        });
        const sourceSnapshot = {
          employmentCompany: {
            id: fixture.companyId,
            name: "POL-219 工资承担公司"
          },
          wageMonth: "2026-08",
          periodStart: "2026-08-01",
          periodEnd: "2026-08-31",
          externalReference,
          sourceVersion,
          basisDate: "2026-08-31",
          evidence: {
            fileId: evidenceFileId,
            sha256: evidenceSha256
          },
          approvedPersonLines
        };
        const sourceFingerprint = fingerprint(sourceSnapshot);
        await prisma.wageApprovedSourceVersion.create({
          data: {
            id: sourceVersionId,
            employmentCompanyId: fixture.companyId,
            wageMonth: "2026-08",
            periodStart: new Date("2026-08-01T00:00:00.000Z"),
            periodEnd: new Date("2026-08-31T00:00:00.000Z"),
            sourceType: "external_approved_wage",
            externalReference,
            sourceVersion,
            basisDate: new Date("2026-08-31T00:00:00.000Z"),
            evidenceFileId,
            evidenceSha256,
            sourceFingerprint,
            sourceSnapshot,
            createdByUserId: fixture.actors.preparerId
          }
        });
        await prisma.wageServiceBasisBinding.create({
          data: {
            id: randomUUID(),
            sourceVersionId,
            projectId: project.id,
            serviceSnapshotId: project.serviceSnapshotId,
            serviceMonth: "2026-08",
            evidenceSha256,
            authorityFingerprint: fingerprint({
              sourceVersionId,
              projectId: project.id,
              serviceSnapshotId: project.serviceSnapshotId,
              serviceMonth: "2026-08",
              evidenceSha256
            })
          }
        });
        return { sourceVersionId, sourceFingerprint };
      };

      const baseSource = await persistSource("1", [1000n, 500n]);
      const baseLegacy = await seedLegacyRows(fixture, [
        {
          project: { ...project, amountCents: 1500n },
          sourceSnapshot: {
            source: "POL-219 A-grade mixed-sign base legacy wage",
            sourceVersionId: baseSource.sourceVersionId
          }
        }
      ]);
      const baseSelectionRef = await issueASelection(fixture);
      const baseFixture: SeededFixture = {
        ...fixture,
        grade: "A",
        legacy: baseLegacy,
        sourceVersionId: baseSource.sourceVersionId,
        sourceFingerprint: baseSource.sourceFingerprint,
        selectionRef: baseSelectionRef
      };
      const basePrepared = await prepare(baseFixture);
      await apply(baseFixture, basePrepared);
      const baseConfirmerSelection = await reissue(
        baseFixture,
        basePrepared,
        baseFixture.actors.confirmerId,
        3
      );
      await service.activate(
        baseFixture.actors.confirmerId,
        {
          selectionRef: baseConfirmerSelection.commandSelectionRef,
          idempotencyKey: randomUUID(),
          expectedRevision: 2,
          businessReason: "建立混合正负工资更正的 canonical 原始版本"
        },
        at(baseFixture, 4)
      );

      const correctionSource = await persistSource("2", [2200n, 300n]);
      const correctionLegacy = await seedLegacyRows(fixture, [
        {
          project: { ...project, amountCents: 1000n },
          sourceSnapshot: {
            source: "POL-219 A-grade mixed-sign correction legacy wage",
            sourceVersionId: correctionSource.sourceVersionId
          },
          entryKind: "correction",
          direction: "increase",
          adjusts: baseLegacy[0]
        }
      ]);
      const selectionRef = await issueASelection(fixture);
      return {
        fixture: {
          ...fixture,
          grade: "A",
          legacy: correctionLegacy,
          sourceVersionId: correctionSource.sourceVersionId,
          sourceFingerprint: correctionSource.sourceFingerprint,
          selectionRef
        }
      };
    }

    async function issueASelection(
      fixture: Awaited<ReturnType<typeof seedCore>>
    ) {
      const result = await service.options(
        fixture.actors.preparerId,
        fixture.projects[0]!.id,
        fixture.now
      );
      const candidates = result.options.filter((option) => option.grade === "A");
      expect(candidates).toHaveLength(1);
      return candidates[0]!.selectionRef;
    }

    async function seedBFixture(): Promise<SeededFixture> {
      const fixture = await seedCore(1);
      const evidenceSha256 = sha(`b-evidence:${fixture.evidenceFileId}`);
      await prisma.fileObject.create({
        data: {
          id: fixture.evidenceFileId,
          bucket: "pol219-dynamic",
          objectKey: `historical-wage/${fixture.evidenceFileId}`,
          originalName: "历史工资余额表.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          sizeBytes: 219,
          uploadedByUserId: fixture.actors.preparerId,
          contentSha256: evidenceSha256
        }
      });
      const project = {
        ...fixture.projects[0]!,
        amountCents: 4_000_000n
      };
      fixture.projects[0] = project;
      const coordinate = (rowNumber: string) => ({
        sourceObjectSha256: evidenceSha256,
        worksheetName: "历史工资表",
        rowNumber,
        columnNumber: null,
        normalizedRowSha256: sha(`summary-row:${rowNumber}`)
      });
      const summary = {
        schemaVersion: 1,
        sourceDiscriminator: "historical_wage_summary",
        sourceObjectId: `legacy-summary-${randomUUID()}`,
        sourceObjectCoordinate: coordinate("12"),
        originalSourceVersion: "V1",
        originalBusinessNumber: `WAGE-${randomUUID()}`,
        asOfDate: "2026-08-31",
        basisDate: null,
        sourceHeader: {
          employmentCompanyId: fixture.companyId,
          employmentCompanyNameSnapshot: "POL-219 工资承担公司",
          employmentCompanyCreditCodeSnapshot: creditCodeFor(fixture.companyId),
          projectId: project.id,
          projectCodeSnapshot: project.code,
          projectNameSnapshot: project.name,
          wageMonth: "2026-08",
          catalogVersion: "historical_wage_position_category_v1",
          positionCategoryCode: "engineering_technical",
          positionCategoryLabelSnapshot: "工程技术人员"
        },
        originalControlledScopeDescription: null,
        evidence: [
          {
            fileObjectId: fixture.evidenceFileId,
            contentSha256: evidenceSha256,
            evidenceCoordinate: coordinate("12")
          }
        ],
        sourceDeclarerSnapshot: { externalIdentityId: "legacy-declarer" },
        sourceEvidenceReviewerSnapshot: {
          externalIdentityId: "legacy-reviewer",
          evidence: [
            {
              fileObjectId: fixture.evidenceFileId,
              contentSha256: evidenceSha256,
              evidenceCoordinate: coordinate("12")
            }
          ]
        },
        sourceVersionFingerprint: null,
        lines: [
          {
            creditorCategoryCode: "employee_net_pay",
            creditorCategoryLabel: "员工实发工资",
            creditorIdentityKind: "aggregate_creditor_scope",
            creditorPartyVersionId: null,
            controlledScopeCode: "employees-a",
            controlledScopeDescription: null,
            controlledScopeEvidenceCoordinate: coordinate("13"),
            grossDebtCents: "3000000",
            historicallySettledCents: "2000000",
            outstandingBalanceCents: "1000000",
            debtStatus: "partially_settled",
            target: {
              kind: "historical_wage_balance_reconciliation_version",
              reconciliationAuthorityVersionId: randomUUID(),
              reconciliationReference: `BAL-${randomUUID()}`,
              schemaVersion: 1,
              sourceVersionFingerprint: null,
              reconciliationFingerprint: null,
              asOfDate: "2026-08-31",
              employmentCompanyId: fixture.companyId,
              employmentCompanyNameSnapshot: "POL-219 工资承担公司",
              employmentCompanyCreditCodeSnapshot: creditCodeFor(
                fixture.companyId
              ),
              projectId: project.id,
              projectCodeSnapshot: project.code,
              projectNameSnapshot: project.name,
              wageMonth: "2026-08",
              catalogVersion: "historical_wage_position_category_v1",
              positionCategoryCode: "engineering_technical",
              positionCategoryLabelSnapshot: "工程技术人员",
              wageCreditorCategoryCode: "employee_net_pay",
              wageCreditorCategoryLabelSnapshot: "员工实发工资",
              currencyCode: "CNY",
              debtStatus: "partially_settled",
              grossDebtCents: "3000000",
              historicallySettledCents: "2000000",
              outstandingBalanceCents: "1000000",
              evidence: [
                {
                  fileObjectId: fixture.evidenceFileId,
                  contentSha256: evidenceSha256,
                  evidenceCoordinate: coordinate("13")
                }
              ],
              supportingPaymentExecutions: []
            }
          },
          {
            creditorCategoryCode: "employee_net_pay",
            creditorCategoryLabel: "员工实发工资",
            creditorIdentityKind: "aggregate_creditor_scope",
            creditorPartyVersionId: null,
            controlledScopeCode: "employees-b",
            controlledScopeDescription: null,
            controlledScopeEvidenceCoordinate: coordinate("14"),
            grossDebtCents: "1000000",
            historicallySettledCents: "1000000",
            outstandingBalanceCents: "0",
            debtStatus: "settled",
            target: {
              kind: "historical_wage_balance_reconciliation_version",
              reconciliationAuthorityVersionId: randomUUID(),
              reconciliationReference: `BAL-${randomUUID()}`,
              schemaVersion: 1,
              sourceVersionFingerprint: null,
              reconciliationFingerprint: null,
              asOfDate: "2026-08-31",
              employmentCompanyId: fixture.companyId,
              employmentCompanyNameSnapshot: "POL-219 工资承担公司",
              employmentCompanyCreditCodeSnapshot: creditCodeFor(
                fixture.companyId
              ),
              projectId: project.id,
              projectCodeSnapshot: project.code,
              projectNameSnapshot: project.name,
              wageMonth: "2026-08",
              catalogVersion: "historical_wage_position_category_v1",
              positionCategoryCode: "engineering_technical",
              positionCategoryLabelSnapshot: "工程技术人员",
              wageCreditorCategoryCode: "employee_net_pay",
              wageCreditorCategoryLabelSnapshot: "员工实发工资",
              currencyCode: "CNY",
              debtStatus: "settled",
              grossDebtCents: "1000000",
              historicallySettledCents: "1000000",
              outstandingBalanceCents: "0",
              evidence: [
                {
                  fileObjectId: fixture.evidenceFileId,
                  contentSha256: evidenceSha256,
                  evidenceCoordinate: coordinate("14")
                }
              ],
              supportingPaymentExecutions: []
            }
          }
        ],
        assignedWageExclusions: [],
        assignedWageExclusionSetFingerprint: null
      };
      const legacy = await seedLegacyRows(fixture, [
        {
          project,
          sourceSnapshot: { historicalWageSummaryAuthority: summary }
        }
      ]);
      const result = await service.options(
        fixture.actors.preparerId,
        project.id,
        fixture.now
      );
      const candidates = result.options.filter((option) => option.grade === "B");
      expect(candidates).toHaveLength(1);
      const selectionRef = candidates[0]!.selectionRef;
      return { ...fixture, grade: "B", legacy, selectionRef };
    }

    async function seedCFixture(): Promise<SeededFixture> {
      const fixture = await seedCore(1);
      const legacy = await seedLegacyRows(fixture, [
        {
          project: fixture.projects[0]!,
          sourceSnapshot: {
            source: "POL-219 unresolved historical wage evidence",
            reasonCode: "NO_AUTHORITATIVE_WAGE_CLOSURE"
          }
        }
      ]);
      const result = await service.options(
        fixture.actors.preparerId,
        fixture.projects[0]!.id,
        fixture.now
      );
      expect(result.options).toEqual([
        expect.objectContaining({
          grade: "C",
          projectCount: 1,
          legacyFactCount: 1,
          selectionRef: expect.any(String)
        })
      ]);
      const selectionRef = result.options[0]!.selectionRef;
      return { ...fixture, grade: "C", legacy, selectionRef };
    }

    async function seedCore(projectCount: 1 | 2) {
      const now = new Date();
      const actors: SeededActors = {
        preparerId: randomUUID(),
        reviewerId: randomUUID(),
        confirmerId: randomUUID(),
        compensatorId: randomUUID(),
        employeeId: randomUUID()
      };
      const companyId = randomUUID();
      const amounts = projectCount === 1 ? [1000n] : [400n, 600n];
      const projects = amounts.map((amountCents, index) => ({
        id: randomUUID(),
        code: `POL219-${randomUUID()}`,
        name: `POL-219 动态项目 ${index + 1}`,
        serviceSnapshotId: randomUUID(),
        amountCents
      }));
      await prisma.user.createMany({
        data: [
          { id: actors.preparerId, name: "POL-219 制单财务" },
          { id: actors.reviewerId, name: "POL-219 独立复核财务" },
          { id: actors.confirmerId, name: "POL-219 激活财务负责人" },
          { id: actors.compensatorId, name: "POL-219 补偿财务负责人" },
          { id: actors.employeeId, name: "POL-219 工资人员" }
        ]
      });
      await prisma.userPosition.createMany({
        data: [
          {
            id: randomUUID(),
            userId: actors.preparerId,
            positionId: DIRECTOR_POSITION_ID,
            projectId: null
          },
          {
            id: randomUUID(),
            userId: actors.reviewerId,
            positionId: DIRECTOR_POSITION_ID,
            projectId: null
          },
          {
            id: randomUUID(),
            userId: actors.confirmerId,
            positionId: DIRECTOR_POSITION_ID,
            projectId: null
          },
          {
            id: randomUUID(),
            userId: actors.compensatorId,
            positionId: DIRECTOR_POSITION_ID,
            projectId: null
          }
        ]
      });
      await prisma.companyEntity.create({
        data: {
          id: companyId,
          name: "POL-219 工资承担公司",
          unifiedSocialCreditCode: creditCodeFor(companyId),
          dataStatus: "complete"
        }
      });
      await prisma.project.createMany({
        data: projects.map(({ id, code, name }) => ({ id, code, name }))
      });
      return {
        grade: "A" as const,
        now,
        actors,
        companyId,
        evidenceFileId: randomUUID(),
        projects,
        legacy: [] as SeededLegacy[],
        selectionRef: ""
      };
    }

    async function seedLegacyRows(
      fixture: Awaited<ReturnType<typeof seedCore>>,
      rows: Array<{
        project: SeededProject;
        sourceSnapshot: Prisma.InputJsonValue;
        entryKind?: "original" | "correction" | "reversal";
        direction?: "increase" | "decrease";
        adjusts?: SeededLegacy;
      }>
    ): Promise<SeededLegacy[]> {
      const seeded = rows.map(({
        project,
        sourceSnapshot,
        entryKind = "original",
        direction = "increase",
        adjusts
      }) => {
        const factId = randomUUID();
        const sourceBusinessId = `legacy-wage-${randomUUID()}`;
        const costImpactId = randomUUID();
        const payableImpactId = randomUUID();
        const impacts = [
          {
            id: costImpactId,
            impactKind: "confirmed_cost",
            amountCents: project.amountCents,
            direction,
            sourceImpactKey: "cost",
            impactSnapshot: { source: "POL-219 legacy confirmed cost" }
          },
          {
            id: payableImpactId,
            impactKind:
              direction === "increase" ? "payable_increase" : "payable_decrease",
            amountCents: project.amountCents,
            direction,
            sourceImpactKey: "payable",
            impactSnapshot: { source: "POL-219 legacy payable" }
          }
        ];
        const sourceFingerprint = historicalWageLegacyFingerprint({
          id: factId,
          projectId: project.id,
          sourceType: "project_wage",
          sourceBusinessId,
          sourceVersion: 1,
          amountCents: project.amountCents,
          occurredAt: new Date("2026-08-31T00:00:00.000Z"),
          costBearingCompanySubjectKind: "participating_company",
          costBearingCompanySubjectId: fixture.companyId,
          entryKind,
          adjustsFactId: adjusts?.factId ?? null,
          status: "confirmed",
          sourceSnapshot,
          impacts
        });
        return {
          factId,
          projectId: project.id,
          sourceType: "project_wage" as const,
          sourceBusinessId,
          sourceVersion: 1,
          sourceFingerprint,
          amountCents: project.amountCents,
          entryKind,
          direction,
          adjustsFactId: adjusts?.factId ?? null,
          adjustmentRoot: adjusts
            ? {
                factId: adjusts.factId,
                sourceBusinessId: adjusts.sourceBusinessId,
                sourceVersion: adjusts.sourceVersion,
                sourceFingerprint: adjusts.sourceFingerprint
              }
            : null,
          costImpactId,
          costImpactFingerprint: fingerprint({
            legacySourceFingerprint: sourceFingerprint,
            legacyImpactEntryId: costImpactId,
            impactKind: "confirmed_cost",
            direction,
            amountCents: project.amountCents,
            impactSnapshot: impacts[0]!.impactSnapshot
          }),
          payableImpactId,
          payableImpactFingerprint: fingerprint({
            legacySourceFingerprint: sourceFingerprint,
            legacyImpactEntryId: payableImpactId,
            impactKind: impacts[1]!.impactKind,
            direction,
            amountCents: project.amountCents,
            impactSnapshot: impacts[1]!.impactSnapshot
          }),
          sourceSnapshot,
          impacts
        };
      });
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          "SET LOCAL session_replication_role = replica"
        );
        for (const item of seeded) {
          await tx.operatingFact.create({
            data: {
              id: item.factId,
              projectId: item.projectId,
              sourceType: item.sourceType,
              sourceBusinessId: item.sourceBusinessId,
              sourceVersion: item.sourceVersion,
              sourceBusinessCode: `POL219-${item.sourceBusinessId}`,
              occurredAt: new Date("2026-08-31T00:00:00.000Z"),
              confirmedAt: new Date("2026-08-31T00:00:00.000Z"),
              affiliateAssignmentId: randomUUID(),
              affiliateBusinessPartyVersionId: randomUUID(),
              affiliateNameSnapshot: "POL-219 历史施工企业",
              operatingLedgerEffectiveDateSnapshot: new Date(
                "2026-09-01T00:00:00.000Z"
              ),
              isBeforeOperatingLedgerEffectiveDate: true,
              factKind: "project_wage",
              operatingLevel: "participating_company",
              costBearingCompanySubjectKind: "participating_company",
              costBearingCompanySubjectId: fixture.companyId,
              evidenceLevel: "A",
              amountCents: item.amountCents,
              direction: "neutral",
              subjectSnapshot: { source: "POL-219 dynamic fixture" },
              sourceSnapshot: item.sourceSnapshot,
              entryKind: item.entryKind,
              adjustsFactId: item.adjustsFactId,
              idempotencyKey: randomUUID(),
              recordedByUserId: fixture.actors.preparerId,
              confirmedByUserId: fixture.actors.preparerId,
              status: "confirmed"
            }
          });
          await tx.operatingImpactEntry.createMany({
            data: item.impacts.map((impact) => ({
              id: impact.id,
              factId: item.factId,
              projectId: item.projectId,
              sourceType: item.sourceType,
              sourceBusinessId: item.sourceBusinessId,
              sourceImpactKey: impact.sourceImpactKey,
              idempotencyKey: randomUUID(),
              impactKind: impact.impactKind,
              amountCents: impact.amountCents,
              direction: impact.direction,
              costCategoryCode:
                impact.impactKind === "confirmed_cost"
                  ? "crew_and_labor"
                  : null,
              impactSnapshot: impact.impactSnapshot
            }))
          });
        }
        await tx.$executeRawUnsafe(
          "SET LOCAL session_replication_role = origin"
        );
      });
      return seeded
        .map((item): SeededLegacy => ({
          factId: item.factId,
          projectId: item.projectId,
          sourceType: item.sourceType,
          sourceBusinessId: item.sourceBusinessId,
          sourceVersion: item.sourceVersion,
          sourceFingerprint: item.sourceFingerprint,
          amountCents: item.amountCents,
          entryKind: item.entryKind,
          direction: item.direction,
          adjustsFactId: item.adjustsFactId,
          adjustmentRoot: item.adjustmentRoot,
          costImpactId: item.costImpactId,
          costImpactFingerprint: item.costImpactFingerprint,
          payableImpactId: item.payableImpactId,
          payableImpactFingerprint: item.payableImpactFingerprint
        }))
        .sort((left, right) =>
          [
            left.projectId,
            left.sourceType,
            left.sourceBusinessId,
            left.sourceVersion
          ]
            .join(":")
            .localeCompare(
              [
                right.projectId,
                right.sourceType,
                right.sourceBusinessId,
                right.sourceVersion
              ].join(":")
            )
        );
    }

    async function prepare(fixture: SeededFixture): Promise<PreparedScope> {
      return (await service.createScope(
        fixture.actors.preparerId,
        {
          selectionRef: fixture.selectionRef,
          idempotencyKey: randomUUID(),
          expectedRevision: 0,
          businessReason: `准备 ${fixture.grade} 级历史工资接管`
        },
        at(fixture, 1)
      )) as PreparedScope;
    }

    async function apply(
      fixture: SeededFixture,
      prepared: PreparedScope
    ) {
      return service.apply(
        fixture.actors.preparerId,
        {
          selectionRef: prepared.commandSelectionRef,
          idempotencyKey: randomUUID(),
          expectedRevision: 1,
          businessReason: "执行只读集校验后的 inactive apply"
        },
        at(fixture, 2)
      );
    }

    function reissue(
      fixture: SeededFixture,
      prepared: PreparedScope,
      actorUserId: string,
      seconds: number
    ): Promise<ScopedSelection> {
      return service.issueScopedCommandSelection(
        actorUserId,
        { selectionRef: prepared.commandSelectionRef },
        at(fixture, seconds)
      );
    }

    async function mappingIds(prepared: PreparedScope) {
      const mappings = await prisma.operatingTakeoverRowMapping.findMany({
        where: {
          manifest: { atomicScopeVersionId: prepared.atomicScopeVersionId }
        },
        select: { id: true }
      });
      return mappings.map(({ id }) => id);
    }

    async function formalWriteCounts(atomicScopeVersionId: string) {
      const [
        wageStatements,
        wageVersions,
        wagePeople,
        wagePayables,
        envelopes,
        summaryRefs,
        reconciliations,
        gaps,
        bridges,
        impactBridges,
        paymentExecutions
      ] = await Promise.all([
        prisma.wageStatement.count(),
        prisma.wageStatementVersion.count(),
        prisma.wagePersonLine.count(),
        prisma.wagePayableRef.count(),
        prisma.wageTakeoverProjectionEnvelope.count({
          where: { atomicScopeVersionId }
        }),
        prisma.historicalWageSummaryPayableRef.count({
          where: { atomicScopeVersionId }
        }),
        prisma.historicalWageBalanceReconciliationVersion.count({
          where: { atomicScopeVersionId }
        }),
        prisma.unresolvedWagePayableGap.count({
          where: { atomicScopeVersionId }
        }),
        prisma.operatingTakeoverLegacySourceBridge.count({
          where: { rowMapping: { manifest: { atomicScopeVersionId } } }
        }),
        prisma.wageTakeoverLegacyImpactBridge.count({
          where: { rowMapping: { manifest: { atomicScopeVersionId } } }
        }),
        prisma.paymentExecution.count()
      ]);
      return {
        wageStatements,
        wageVersions,
        wagePeople,
        wagePayables,
        envelopes,
        summaryRefs,
        reconciliations,
        gaps,
        bridges,
        impactBridges,
        paymentExecutions
      };
    }

    async function commandWriteCounts(atomicScopeVersionId: string) {
      const [receipts, receiptLines, attestations, auditLogs] = await Promise.all([
        prisma.operatingTakeoverCommandReceipt.count({
          where: { atomicScopeVersionId }
        }),
        prisma.operatingTakeoverCommandReceiptLine.count({
          where: { receipt: { atomicScopeVersionId } }
        }),
        prisma.historicalWageSummaryAuthorityAttestation.count({
          where: { atomicScopeVersionId }
        }),
        prisma.auditLog.count({
          where: { businessId: atomicScopeVersionId }
        })
      ]);
      return { receipts, receiptLines, attestations, auditLogs };
    }

    async function allWriteCounts() {
      const [
        statements,
        versions,
        people,
        components,
        creditors,
        allocations,
        costCells,
        creditorCells,
        payableRefs,
        envelopes,
        envelopeCosts,
        envelopePayables,
        impactBridges,
        summaryAuthorities,
        summaryCreditorLines,
        summaryRefs,
        balanceReconciliations,
        summaryPaymentLinks,
        unresolvedGaps,
        envelopeRevocations,
        summaryRefRevocations,
        summaryAttestations,
        bridges,
        receipts,
        receiptLines,
        auditLogs,
        operatingFacts,
        operatingImpacts
      ] = await Promise.all([
        prisma.wageStatement.count(),
        prisma.wageStatementVersion.count(),
        prisma.wagePersonLine.count(),
        prisma.wageCostComponent.count(),
        prisma.wageCreditorBreakdown.count(),
        prisma.wageProjectAllocation.count(),
        prisma.wageProjectCostComponentAllocation.count(),
        prisma.wageProjectCreditorAllocation.count(),
        prisma.wagePayableRef.count(),
        prisma.wageTakeoverProjectionEnvelope.count(),
        prisma.wageTakeoverProjectionEnvelopeCostCell.count(),
        prisma.wageTakeoverProjectionEnvelopePayableRef.count(),
        prisma.wageTakeoverLegacyImpactBridge.count(),
        prisma.historicalWageSummaryAuthorityVersion.count(),
        prisma.historicalWageSummaryAuthorityCreditorLine.count(),
        prisma.historicalWageSummaryPayableRef.count(),
        prisma.historicalWageBalanceReconciliationVersion.count(),
        prisma.historicalWageSummaryPaymentExecutionLink.count(),
        prisma.unresolvedWagePayableGap.count(),
        prisma.wageTakeoverProjectionEnvelopeEligibilityRevocation.count(),
        prisma.historicalWageSummaryPayableRefEligibilityRevocation.count(),
        prisma.historicalWageSummaryAuthorityAttestation.count(),
        prisma.operatingTakeoverLegacySourceBridge.count(),
        prisma.operatingTakeoverCommandReceipt.count(),
        prisma.operatingTakeoverCommandReceiptLine.count(),
        prisma.auditLog.count(),
        prisma.operatingFact.count(),
        prisma.operatingImpactEntry.count()
      ]);
      return {
        statements,
        versions,
        people,
        components,
        creditors,
        allocations,
        costCells,
        creditorCells,
        payableRefs,
        envelopes,
        envelopeCosts,
        envelopePayables,
        impactBridges,
        summaryAuthorities,
        summaryCreditorLines,
        summaryRefs,
        balanceReconciliations,
        summaryPaymentLinks,
        unresolvedGaps,
        envelopeRevocations,
        summaryRefRevocations,
        summaryAttestations,
        bridges,
        receipts,
        receiptLines,
        auditLogs,
        operatingFacts,
        operatingImpacts
      };
    }
  }
);

function at(fixture: Pick<SeededFixture, "now">, seconds: number) {
  return new Date(fixture.now.getTime() + seconds * 1000);
}

function creditCodeFor(companyId: string) {
  return `91${companyId.replaceAll("-", "").slice(0, 16).toUpperCase()}`;
}

function sha(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
