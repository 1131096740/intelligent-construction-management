import { randomUUID } from "node:crypto";
import {
  ConflictException,
  type HttpException
} from "@nestjs/common";
import {
  Prisma,
  PrismaClient,
  type PrismaClient as PrismaClientType
} from "@prisma/client";
import { SettlementDraftService } from "../settlement/settlement-draft.service";
import { SettlementSubmissionService } from "../settlement/settlement-submission.service";

const DATABASE_NAME =
  "jiangkong_settlement_draft_lifecycle_concurrency";
const EXPECTED_MIGRATION_COUNT = 130;

describe("settlement draft lifecycle database concurrency", () => {
  const integrationTest =
    process.env.RUN_SETTLEMENT_DRAFT_LIFECYCLE_CONCURRENCY === "1"
      ? it
      : it.skip;

  integrationTest(
    "serializes submission and abandonment in both winner orders on the fully migrated schema",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const clients = [0, 1, 2].map(() => new PrismaClient({
        datasources: { db: { url: databaseUrl } }
      }));
      const fixture = fixtureIds();
      const releaseGates: Array<Deferred<void>> = [];
      const pendingOperations: Array<Promise<unknown>> = [];

      try {
        await assertFullyMigrated(clients[2]!);
        await seedCore(clients[0]!, fixture);

        await seedDraft(
          clients[0]!,
          fixture,
          fixture.submitDraftId,
          fixture.submitProcessId,
          1
        );
        const submitPause = deferred();
        releaseGates.push(submitPause);
        const submitReached = deferred();
        const abandonLoserPid = deferred<number>();
        const submitServices = services(
          clients,
          fixture,
          undefined,
          async (tx, draftId) => {
            const settlement = await insertSettlement(tx, fixture, draftId);
            if (draftId === fixture.submitDraftId) {
              submitReached.resolve(undefined);
              await submitPause.promise;
            }
            return settlement;
          },
          {
            draftTransactionStarted: abandonLoserPid.resolve
          }
        );

        const submitFirst = submitServices.submission.submitDraft(
          fixture.projectId,
          fixture.submitDraftId,
          fixture.ownerUserId,
          3
        );
        pendingOperations.push(submitFirst);
        await submitReached.promise;
        const abandonSecond = submitServices.draft.abandon(
          fixture.projectId,
          fixture.submitDraftId,
          fixture.ownerUserId,
          {
            expectedRevision: 3,
            action: "delete_pristine_draft"
          }
        );
        pendingOperations.push(abandonSecond);
        await waitUntilBlocked(
          clients[2]!,
          await abandonLoserPid.promise
        );
        submitPause.resolve(undefined);
        const submitWinnerResults = await Promise.allSettled([
          submitFirst,
          abandonSecond
        ]);

        expect(submitWinnerResults[0].status).toBe("fulfilled");
        expect(submitWinnerResults[1].status).toBe("rejected");
        expect(conflictStatus(submitWinnerResults[1])).toBe(409);
        expect(await draftState(
          clients[0]!,
          fixture.submitDraftId
        )).toEqual([{
          status: "submitted",
          revision: 4,
          submittedSettlementId: fixture.submitSettlementId
        }]);
        expect(await countById(
          clients[0]!,
          "Settlement",
          fixture.submitSettlementId
        )).toBe(1n);
        expect(await countByBusinessId(
          clients[0]!,
          "ApprovalInstance",
          fixture.submitSettlementId
        )).toBe(1n);
        expect(await lifecycleAuditCount(
          clients[0]!,
          fixture.submitDraftId
        )).toBe(0n);

        await clients[0]!.$executeRaw(Prisma.sql`
          UPDATE "ContractSettlementProcess"
          SET "status" = 'effective'
          WHERE "id" = ${fixture.submitProcessId}
        `);
        await seedDraft(
          clients[0]!,
          fixture,
          fixture.abandonDraftId,
          fixture.abandonProcessId,
          2
        );
        await seedAbandonmentEvidence(clients[0]!, fixture);

        const abandonPause = deferred();
        releaseGates.push(abandonPause);
        const abandonReached = deferred();
        const submitLoserPid = deferred<number>();
        const abandonServices = services(
          clients,
          fixture,
          {
            pauseDraftId: fixture.abandonDraftId,
            reached: abandonReached,
            release: abandonPause
          },
          undefined,
          {
            submissionTransactionStarted: submitLoserPid.resolve
          }
        );
        const abandonFirst = abandonServices.draft.abandon(
          fixture.projectId,
          fixture.abandonDraftId,
          fixture.ownerUserId,
          {
            expectedRevision: 3,
            action: "abandon_application",
            reason: "并发测试终止申请"
          }
        );
        pendingOperations.push(abandonFirst);
        await abandonReached.promise;
        const submitSecond = abandonServices.submission.submitDraft(
          fixture.projectId,
          fixture.abandonDraftId,
          fixture.ownerUserId,
          3
        );
        pendingOperations.push(submitSecond);
        await waitUntilBlocked(
          clients[2]!,
          await submitLoserPid.promise
        );
        abandonPause.resolve(undefined);
        const abandonWinnerResults = await Promise.allSettled([
          abandonFirst,
          submitSecond
        ]);

        expect(abandonWinnerResults[0].status).toBe("fulfilled");
        expect(abandonWinnerResults[1].status).toBe("rejected");
        expect(conflictStatus(abandonWinnerResults[1])).toBe(409);
        expect(await draftState(
          clients[0]!,
          fixture.abandonDraftId
        )).toEqual([{
          status: "abandoned",
          revision: 4,
          submittedSettlementId: null
        }]);
        expect(await countById(
          clients[0]!,
          "Settlement",
          fixture.abandonSettlementId
        )).toBe(0n);
        expect(await countByBusinessId(
          clients[0]!,
          "ApprovalInstance",
          fixture.abandonSettlementId
        )).toBe(0n);
        expect(await lifecycleAuditCount(
          clients[0]!,
          fixture.abandonDraftId
        )).toBe(1n);
        expect(await statusById(
          clients[0]!,
          "ContractSettlementProcess",
          fixture.abandonProcessId
        )).toEqual([{ status: "voided" }]);
        expect(await statusById(
          clients[0]!,
          "SettlementSignedDocument",
          fixture.signedDocumentId
        )).toEqual([{ status: "invalidated" }]);
        expect(await statusById(
          clients[0]!,
          "SettlementLineAttachment",
          fixture.attachmentId
        )).toEqual([{ status: "invalidated" }]);
        expect(await clients[0]!.$queryRaw<Array<{ status: string }>>(
          Prisma.sql`
            SELECT "storageStatus" AS status
            FROM "FileObject"
            WHERE "id" = ${fixture.attachmentFileId}
          `
        )).toEqual([{ status: "active" }]);
      } finally {
        for (const gate of releaseGates) gate.resolve(undefined);
        await Promise.allSettled(pendingOperations);
        await cleanupFixture(clients[0]!, fixture).catch(() => undefined);
        await Promise.allSettled(
          clients.map((client) => client.$disconnect())
        );
      }
    },
    60_000
  );
});

type Fixture = ReturnType<typeof fixtureIds>;
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function fixtureIds() {
  const prefix = `sdlc_${randomUUID().replace(/-/gu, "")}`;
  return {
    prefix,
    ownerUserId: `${prefix}_owner`,
    projectId: `${prefix}_project`,
    contractId: `${prefix}_contract`,
    contractVersionId: `${prefix}_version`,
    paymentTermsVersionId: `${prefix}_terms`,
    submitDraftId: `${prefix}_draft_submit`,
    submitProcessId: `${prefix}_process_submit`,
    submitSettlementId: `${prefix}_settlement_submit`,
    abandonDraftId: `${prefix}_draft_abandon`,
    abandonProcessId: `${prefix}_process_abandon`,
    abandonSettlementId: `${prefix}_settlement_abandon`,
    signedDocumentId: `${prefix}_signed`,
    signedDocumentFileId: `${prefix}_file_signed`,
    lineId: `${prefix}_line`,
    attachmentId: `${prefix}_attachment`,
    attachmentFileId: `${prefix}_file_attachment`
  };
}

function assertDedicatedDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || process.env.NODE_ENV === "production") {
    throw new Error("结算草稿生命周期并发测试必须连接非生产隔离数据库");
  }
  const parsed = new URL(databaseUrl);
  if (!["postgresql:", "postgres:"].includes(parsed.protocol)) {
    throw new Error("结算草稿生命周期并发测试只允许 PostgreSQL");
  }
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(parsed.hostname)) {
    throw new Error("结算草稿生命周期并发测试只允许使用本机 PostgreSQL");
  }
  if (parsed.pathname !== `/${DATABASE_NAME}`) {
    throw new Error("结算草稿生命周期并发测试只允许使用固定专用数据库");
  }
  return databaseUrl;
}

async function assertFullyMigrated(client: PrismaClientType) {
  const [migrationCount] = await client.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  `;
  if (migrationCount?.count !== BigInt(EXPECTED_MIGRATION_COUNT)) {
    throw new Error(
      `结算草稿生命周期并发测试要求完整 ${EXPECTED_MIGRATION_COUNT} 个迁移`
    );
  }
}

async function seedCore(client: PrismaClientType, fixture: Fixture) {
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "User" ("id", "name", "isActive", "updatedAt")
    VALUES (${fixture.ownerUserId}, '并发验收经办人', TRUE, NOW())
  `);
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "Project" ("id", "code", "name", "isActive", "updatedAt")
    VALUES (
      ${fixture.projectId},
      ${`${fixture.prefix}_project_code`},
      '结算生命周期并发验收项目',
      TRUE,
      NOW()
    )
  `);
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "ProjectAffiliateAssignment" (
      "id", "projectId", "businessPartyId", "businessPartyVersionId",
      "affiliateNameSnapshot", "effectiveFrom", "changeReason",
      "assignedByUserId", "updatedAt"
    ) VALUES (
      ${`${fixture.projectId}_construction_enterprise`},
      ${fixture.projectId},
      ${`${fixture.projectId}_party`},
      ${`${fixture.projectId}_party_version`},
      '结算生命周期并发验收施工企业',
      '2020-01-01',
      '数据库测试夹具',
      ${fixture.ownerUserId},
      NOW()
    )
  `);
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "Contract" (
      "id", "projectId", "code", "name", "counterparty",
      "contractTypeKey", "ownerUserId", "updatedAt"
    ) VALUES (
      ${fixture.contractId},
      ${fixture.projectId},
      ${`${fixture.prefix}_contract_code`},
      '结算生命周期并发验收合同',
      '验收相对方',
      'material_purchase',
      ${fixture.ownerUserId},
      NOW()
    )
  `);
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "ContractVersion" (
      "id", "contractId", "versionNo", "changeType", "status",
      "amountCents", "effectiveAt", "draftData", "templateSnapshot",
      "clauseSnapshot", "updatedAt"
    ) VALUES (
      ${fixture.contractVersionId},
      ${fixture.contractId},
      1,
      'original',
      'effective',
      100000,
      NOW(),
      '{}'::jsonb,
      '{}'::jsonb,
      '{}'::jsonb,
      NOW()
    )
  `);
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "PaymentTermsVersion" (
      "id", "contractId", "contractVersionId", "versionNo",
      "status", "originalText", "updatedAt"
    ) VALUES (
      ${fixture.paymentTermsVersionId},
      ${fixture.contractId},
      ${fixture.contractVersionId},
      1,
      'effective',
      '并发验收付款条款',
      NOW()
    )
  `);
}

async function seedDraft(
  client: PrismaClientType,
  fixture: Fixture,
  draftId: string,
  processId: string,
  sequenceNo: number
) {
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "ContractSettlementProcess" (
      "id", "contractId", "sequenceNo", "contractVersionId",
      "status", "isFinal", "updatedAt"
    ) VALUES (
      ${processId},
      ${fixture.contractId},
      ${sequenceNo},
      ${fixture.contractVersionId},
      'open',
      FALSE,
      NOW()
    )
  `);
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "SettlementDraft" (
      "id", "projectId", "contractId", "contractVersionId",
      "paymentTermsVersionId", "code", "periodLabel", "isFinal",
      "processId", "lines", "calculationVersion", "revision", "status",
      "ownerUserId", "governanceVersion", "updatedAt"
    ) VALUES (
      ${draftId},
      ${fixture.projectId},
      ${fixture.contractId},
      ${fixture.contractVersionId},
      ${fixture.paymentTermsVersionId},
      ${draftCode(fixture, draftId)},
      '2026-07',
      FALSE,
      ${processId},
      '[]'::jsonb,
      1,
      3,
      'draft',
      ${fixture.ownerUserId},
      1,
      NOW()
    )
  `);
  await client.$executeRaw(Prisma.sql`
    UPDATE "ContractSettlementProcess"
    SET "settlementDraftId" = ${draftId}
    WHERE "id" = ${processId}
  `);
}

async function seedAbandonmentEvidence(
  client: PrismaClientType,
  fixture: Fixture
) {
  for (const [fileId, suffix] of [
    [fixture.signedDocumentFileId, "signed"],
    [fixture.attachmentFileId, "attachment"]
  ] as const) {
    await client.$executeRaw(Prisma.sql`
      INSERT INTO "FileObject" (
        "id", "bucket", "objectKey", "originalName", "mimeType",
        "sizeBytes", "uploadedByUserId", "contentSha256", "storageStatus"
      ) VALUES (
        ${fileId},
        'local-test',
        ${`${fixture.prefix}/${suffix}.pdf`},
        ${`${suffix}.pdf`},
        'application/pdf',
        100,
        ${fixture.ownerUserId},
        ${"a".repeat(64)},
        'active'
      )
    `);
  }
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "SettlementSignedDocument" (
      "id", "settlementDraftId", "purpose", "fileId",
      "contentSha256", "pageCount", "sourceRevision",
      "businessSnapshotToken", "status", "generationStatus",
      "declarationSnapshot", "declaredByUserId", "declaredAt",
      "uploadedByUserId", "updatedAt"
    ) VALUES (
      ${fixture.signedDocumentId},
      ${fixture.abandonDraftId},
      'counterparty_signed_original',
      ${fixture.signedDocumentFileId},
      ${"b".repeat(64)},
      1,
      3,
      'concurrency-snapshot',
      'active',
      'not_applicable',
      '{"everyPageStamped":true}'::jsonb,
      ${fixture.ownerUserId},
      NOW(),
      ${fixture.ownerUserId},
      NOW()
    )
  `);
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "SettlementDraftLine" (
      "id", "settlementDraftId", "lineKey", "sourceType", "name",
      "calculationMode", "status", "sortOrder", "updatedAt"
    ) VALUES (
      ${fixture.lineId},
      ${fixture.abandonDraftId},
      'manual:1',
      'manual_adjustment',
      '并发验收明细',
      'manual_adjustment',
      'active',
      0,
      NOW()
    )
  `);
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "SettlementLineAttachment" (
      "id", "settlementDraftLineId", "fileId", "purpose",
      "status", "uploadedByUserId", "updatedAt"
    ) VALUES (
      ${fixture.attachmentId},
      ${fixture.lineId},
      ${fixture.attachmentFileId},
      'evidence',
      'active',
      ${fixture.ownerUserId},
      NOW()
    )
  `);
}

function services(
  clients: PrismaClient[],
  fixture: Fixture,
  auditPause?: {
    pauseDraftId: string;
    reached: Deferred<void>;
    release: Deferred<void>;
  },
  submitWriter: (
    tx: Prisma.TransactionClient,
    draftId: string
  ) => Promise<{ id: string }> = (tx, draftId) =>
    insertSettlement(tx, fixture, draftId),
  hooks: {
    draftTransactionStarted?: (pid: number) => void;
    submissionTransactionStarted?: (pid: number) => void;
  } = {}
) {
  const submissionClient = transactionClient(
    clients[0]!,
    hooks.submissionTransactionStarted
  );
  const draftClient = transactionClient(
    clients[1]!,
    hooks.draftTransactionStarted
  );
  const audit = {
    record: async (
      tx: Prisma.TransactionClient,
      input: {
        actorUserId: string;
        action: string;
        businessType: string;
        businessId: string;
        metadata?: unknown;
      }
    ) => {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "AuditLog" (
          "id", "actorUserId", "action", "businessType",
          "businessId", "metadata"
        ) VALUES (
          ${randomUUID()},
          ${input.actorUserId},
          ${input.action},
          ${input.businessType},
          ${input.businessId},
          ${JSON.stringify(input.metadata ?? {})}::jsonb
        )
      `);
      if (auditPause?.pauseDraftId === input.businessId) {
        auditPause.reached.resolve(undefined);
        await auditPause.release.promise;
      }
    }
  };
  const processes = {
    voidOpenDraftProcess: async (
      tx: Prisma.TransactionClient,
      processId: string,
      _draftId: string,
      actorUserId: string,
      reason: string
    ) => {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "ContractSettlementProcess"
        SET
          "status" = 'voided',
          "endedAt" = NOW(),
          "endedByUserId" = ${actorUserId},
          "endedReason" = ${reason}
        WHERE "id" = ${processId}
      `);
    },
    linkSettlement: async (
      tx: Prisma.TransactionClient,
      processId: string,
      _draftId: string,
      settlementId: string
    ) => {
      await tx.$executeRaw(Prisma.sql`
        UPDATE "ContractSettlementProcess"
        SET "settlementId" = ${settlementId}
        WHERE "id" = ${processId}
      `);
    }
  };
  const settlementCore = {
    prepareSubmission: (input: unknown) => ({ input }),
    submitInTransaction: (
      tx: Prisma.TransactionClient,
      prepared: { input?: { code?: string } }
    ) => {
      const draftId =
        prepared.input?.code === draftCode(fixture, fixture.submitDraftId)
          ? fixture.submitDraftId
          : fixture.abandonDraftId;
      return submitWriter(tx, draftId);
    },
    finalizeSubmission: async (settlement: { id: string }) => settlement,
    persistContractCapacityDenial: async () => undefined,
    persistGovernanceDenial: async () => undefined,
    rethrowSubmissionError: (error: unknown): never => {
      throw error;
    }
  };
  const documents = {
    assertReadyForSubmission: async () => ({}),
    persistDenial: async () => undefined
  };
  const frozen = {
    assertCurrentFacts: async () => ({ id: "frozen" })
  };

  return {
    draft: new SettlementDraftService(
      draftClient as never,
      audit as never,
      processes as never
    ),
    submission: new SettlementSubmissionService(
      submissionClient as never,
      settlementCore as never,
      documents as never,
      frozen as never,
      processes as never
    )
  };
}

async function insertSettlement(
  tx: Prisma.TransactionClient,
  fixture: Fixture,
  draftId: string
) {
  const isSubmit = draftId === fixture.submitDraftId;
  const settlementId = isSubmit
    ? fixture.submitSettlementId
    : fixture.abandonSettlementId;
  const processId = isSubmit
    ? fixture.submitProcessId
    : fixture.abandonProcessId;
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "Settlement" (
      "id", "projectId", "contractId", "contractVersionId",
      "paymentTermsVersionId", "code", "periodLabel", "status",
      "amountCents", "payableAmountCents", "paidAmountCents",
      "processId", "updatedAt"
    ) VALUES (
      ${settlementId},
      ${fixture.projectId},
      ${fixture.contractId},
      ${fixture.contractVersionId},
      ${fixture.paymentTermsVersionId},
      ${`${fixture.prefix}_${isSubmit ? "formal_submit" : "formal_abandon"}`},
      '2026-07',
      'approval_pending',
      100,
      100,
      0,
      ${processId},
      NOW()
    )
  `);
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "ApprovalInstance" (
      "id", "flowType", "businessType", "businessId", "status",
      "currentNodeIndex", "frozenNodes", "applicantUserId", "updatedAt"
    ) VALUES (
      ${`${fixture.prefix}_approval_${isSubmit ? "submit" : "abandon"}`},
      'settlement.approve',
      'settlement',
      ${settlementId},
      'in_progress',
      0,
      '[]'::jsonb,
      ${fixture.ownerUserId},
      NOW()
    )
  `);
  return { id: settlementId };
}

function transactionClient(
  client: PrismaClient,
  transactionStarted?: (pid: number) => void
) {
  return {
    $transaction: <T>(
      callback: (tx: Prisma.TransactionClient) => Promise<T>,
      options?: { isolationLevel?: Prisma.TransactionIsolationLevel }
    ) => client.$transaction(async (tx) => {
      const [connection] = await tx.$queryRaw<Array<{ pid: number }>>`
        SELECT pg_backend_pid()::int AS pid
      `;
      if (connection) transactionStarted?.(connection.pid);
      return callback(tx);
    }, options)
  };
}

async function waitUntilBlocked(
  monitor: PrismaClientType,
  blockedPid: number
) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const [state] = await monitor.$queryRaw<Array<{ blockerCount: number }>>(
      Prisma.sql`
        SELECT cardinality(
          pg_blocking_pids(CAST(${blockedPid} AS integer))
        )::int
          AS "blockerCount"
      `
    );
    if ((state?.blockerCount ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("loser 未在时限内进入 PostgreSQL 锁等待");
}

async function draftState(client: PrismaClientType, draftId: string) {
  return client.$queryRaw<Array<{
    status: string;
    revision: number;
    submittedSettlementId: string | null;
  }>>(Prisma.sql`
    SELECT "status", "revision", "submittedSettlementId"
    FROM "SettlementDraft"
    WHERE "id" = ${draftId}
  `);
}

async function countById(
  client: PrismaClientType,
  table: "Settlement",
  id: string
) {
  const [result] = await client.$queryRaw<Array<{ count: bigint }>>(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM "Settlement"
      WHERE "id" = ${id}
    `
  );
  void table;
  return result!.count;
}

async function countByBusinessId(
  client: PrismaClientType,
  table: "ApprovalInstance",
  businessId: string
) {
  const [result] = await client.$queryRaw<Array<{ count: bigint }>>(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM "ApprovalInstance"
      WHERE "businessId" = ${businessId}
    `
  );
  void table;
  return result!.count;
}

async function lifecycleAuditCount(
  client: PrismaClientType,
  businessId: string
) {
  const [result] = await client.$queryRaw<Array<{ count: bigint }>>(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM "AuditLog"
      WHERE "businessId" = ${businessId}
        AND "action" IN (
          'settlement.draft.delete',
          'settlement.application.abandon'
        )
    `
  );
  return result!.count;
}

async function statusById(
  client: PrismaClientType,
  table:
    | "ContractSettlementProcess"
    | "SettlementSignedDocument"
    | "SettlementLineAttachment",
  id: string
) {
  if (table === "ContractSettlementProcess") {
    return client.$queryRaw<Array<{ status: string }>>(Prisma.sql`
      SELECT "status" FROM "ContractSettlementProcess" WHERE "id" = ${id}
    `);
  }
  if (table === "SettlementSignedDocument") {
    return client.$queryRaw<Array<{ status: string }>>(Prisma.sql`
      SELECT "status" FROM "SettlementSignedDocument" WHERE "id" = ${id}
    `);
  }
  return client.$queryRaw<Array<{ status: string }>>(Prisma.sql`
    SELECT "status" FROM "SettlementLineAttachment" WHERE "id" = ${id}
  `);
}

async function cleanupFixture(client: PrismaClientType, fixture: Fixture) {
  const prefix = `${fixture.prefix}%`;
  await client.$executeRaw(Prisma.sql`
    DELETE FROM "SettlementLineAttachment" WHERE "id" LIKE ${prefix}
  `);
  await client.$executeRaw(Prisma.sql`
    DELETE FROM "SettlementSignedDocument" WHERE "id" LIKE ${prefix}
  `);
  await client.$executeRaw(Prisma.sql`
    DELETE FROM "SettlementDraftLine" WHERE "id" LIKE ${prefix}
  `);
  await client.$executeRaw(Prisma.sql`
    DELETE FROM "ApprovalInstance" WHERE "id" LIKE ${prefix}
  `);
  await client.$executeRaw(Prisma.sql`
    DELETE FROM "AuditLog" WHERE "businessId" LIKE ${prefix}
  `);
  await client.$executeRaw(Prisma.sql`
    UPDATE "ContractSettlementProcess"
    SET "settlementDraftId" = NULL, "settlementId" = NULL
    WHERE "id" LIKE ${prefix}
  `);
  await client.$executeRaw(Prisma.sql`
    DELETE FROM "SettlementDraft" WHERE "id" LIKE ${prefix}
  `);
  await client.$executeRaw(Prisma.sql`
    DELETE FROM "Settlement" WHERE "id" LIKE ${prefix}
  `);
  await client.$executeRaw(Prisma.sql`
    DELETE FROM "ContractSettlementProcess" WHERE "id" LIKE ${prefix}
  `);
  await client.$executeRaw(Prisma.sql`
    DELETE FROM "PaymentTermsVersion" WHERE "id" = ${fixture.paymentTermsVersionId}
  `);
  await client.$executeRaw(Prisma.sql`
    DELETE FROM "ContractVersion" WHERE "id" = ${fixture.contractVersionId}
  `);
  await client.$executeRaw(Prisma.sql`
    DELETE FROM "Contract" WHERE "id" = ${fixture.contractId}
  `);
  await client.$executeRaw(Prisma.sql`
    DELETE FROM "Project" WHERE "id" = ${fixture.projectId}
  `);
  await client.$executeRaw(Prisma.sql`
    DELETE FROM "FileObject" WHERE "id" LIKE ${prefix}
  `);
  await client.$executeRaw(Prisma.sql`
    DELETE FROM "User" WHERE "id" = ${fixture.ownerUserId}
  `);
}

function draftCode(fixture: Fixture, draftId: string) {
  return `${fixture.prefix}_${draftId === fixture.submitDraftId ? "draft_submit" : "draft_abandon"}`;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function conflictStatus(result: PromiseSettledResult<unknown>) {
  if (result.status !== "rejected") return null;
  const reason = result.reason as HttpException | undefined;
  if (reason instanceof ConflictException) return reason.getStatus();
  return typeof reason?.getStatus === "function" ? reason.getStatus() : null;
}
