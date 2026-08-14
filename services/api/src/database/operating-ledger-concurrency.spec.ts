import { randomUUID } from "node:crypto";
import * as assert from "node:assert/strict";

import { Prisma, PrismaClient } from "@prisma/client";

import {
  OperatingLedgerService,
  type AppendOperatingFactInput
} from "../operating-ledger/operating-ledger.service";

describe("operating ledger PostgreSQL concurrency", () => {
  const integrationTest =
    process.env.RUN_OPERATING_LEDGER_DATABASE === "1" ? it : it.skip;

  integrationTest(
    "keeps formal facts, impact entries, permission, idempotency and append-only guards closed",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const runtimeRoleTest = process.env.RUN_OPERATING_LEDGER_RUNTIME_ROLE_DATABASE === "1";
      const clients = [0, 1, 2].map(
        () => new PrismaClient({ datasources: { db: { url: databaseUrl } } })
      );
      const setupDatabaseUrl = runtimeRoleTest
        ? process.env.OPERATING_LEDGER_SETUP_DATABASE_URL
        : databaseUrl;
      if (!setupDatabaseUrl) {
        throw new Error(
          "runtime role 并发测试必须配置 owner-only OPERATING_LEDGER_SETUP_DATABASE_URL"
        );
      }
      const setupClient = runtimeRoleTest
        ? new PrismaClient({ datasources: { db: { url: setupDatabaseUrl } } })
        : clients[0]!;
      const fixture = fixtureIds();

      try {
        await Promise.all(clients.map((client) => client.$connect()));
        if (setupClient !== clients[0]!) await setupClient.$connect();
        await seedFixture(setupClient, fixture);
        const service = new OperatingLedgerService(clients[0]! as never);

        await expect(
          service.appendFromSource(baseInput(fixture, "forbidden"), fixture.projectManagerId)
        ).rejects.toThrow("只有当前项目财务人员可以登记经营事实");

        const first = await service.appendFromSource(baseInput(fixture, "formal"), fixture.financeUserId);
        const replay = await service.appendFromSource(
          { ...baseInput(fixture, "formal"), idempotencyKey: `${fixture.prefix}_replay` },
          fixture.financeUserId
        );
        expect(first).toEqual(expect.objectContaining({ created: true }));
        expect(replay).toEqual(expect.objectContaining({ id: first.id, created: false }));

        const [factSummary] = await clients[0]!.$queryRaw<
          Array<{ count: bigint; amount: bigint; status: string }>
        >(Prisma.sql`
          SELECT COUNT(*)::bigint AS count,
                 SUM("amountCents")::bigint AS amount,
                 MIN("status") AS status
          FROM "OperatingFact"
          WHERE "id" = ${first.id}
        `);
        assert.equal(factSummary?.count, 1n);
        assert.equal(factSummary?.amount, 1000n);
        assert.equal(factSummary?.status, "confirmed");

        const [impactSummary] = await clients[0]!.$queryRaw<
          Array<{ count: bigint; amount: bigint }>
        >(Prisma.sql`
          SELECT COUNT(*)::bigint AS count,
                 SUM("amountCents")::bigint AS amount
          FROM "OperatingImpactEntry"
          WHERE "factId" = ${first.id}
        `);
        assert.equal(impactSummary?.count, 2n);
        assert.equal(impactSummary?.amount, 2000n);
        const [subjectSnapshot] = await clients[0]!.$queryRaw<
          Array<{ subjectSnapshot: { costBearingCompany?: { companyEntityVersionId?: string } } }>
        >(Prisma.sql`
          SELECT "subjectSnapshot"
          FROM "OperatingFact"
          WHERE "id" = ${first.id}
        `);
        assert.equal(
          subjectSnapshot?.subjectSnapshot.costBearingCompany?.companyEntityVersionId,
          `${fixture.projectId}_company_version`
        );

        const correctionInput = baseInput(fixture, "correction");
        const correction = await service.appendCorrection(
          {
            ...correctionInput,
            amountCents: 500n,
            impacts: correctionInput.impacts.map((impact) => ({
              ...impact,
              amountCents: 500n
            })),
            adjustsFactId: first.id
          },
          fixture.financeUserId
        );
        const reversalInput = baseInput(fixture, "reversal");
        const reversal = await service.appendReversal(
          {
            ...reversalInput,
            adjustsFactId: first.id,
            impacts: [
              { ...reversalInput.impacts[0]!, direction: "decrease" },
              { ...reversalInput.impacts[1]!, direction: "decrease" }
            ]
          },
          fixture.financeUserId
        );
        assert.notEqual(correction.id, first.id);
        assert.notEqual(reversal.id, first.id);
        const adjustmentRows = await clients[0]!.$queryRaw<
          Array<{ entryKind: string; adjustsFactId: string | null }>
        >(Prisma.sql`
          SELECT "entryKind", "adjustsFactId"
          FROM "OperatingFact"
          WHERE "id" IN (${Prisma.join([correction.id, reversal.id])})
          ORDER BY "entryKind"
        `);
        assert.deepEqual(adjustmentRows, [
          { entryKind: "correction", adjustsFactId: first.id },
          { entryKind: "reversal", adjustsFactId: first.id }
        ]);
        const partialReversalInput = baseInput(fixture, "partial_reversal");
        await expect(
          service.appendReversal(
            {
              ...partialReversalInput,
              adjustsFactId: first.id,
              impacts: [{ ...partialReversalInput.impacts[0]!, direction: "decrease" }]
            },
            fixture.financeUserId
          )
        ).rejects.toThrow("全部影响");
        const duplicateReversalInput = baseInput(fixture, "duplicate_reversal");
        await expect(
          service.appendReversal(
            {
              ...duplicateReversalInput,
              adjustsFactId: first.id,
              impacts: [
                { ...duplicateReversalInput.impacts[0]!, direction: "decrease" },
                { ...duplicateReversalInput.impacts[1]!, direction: "decrease" }
              ]
            },
            fixture.financeUserId
          )
        ).rejects.toThrow("重复冲销");

        await expectDatabaseError(
          () =>
            runDirectWrite(clients[0]!, fixture.financeUserId, runtimeRoleTest, (tx) => tx.$executeRaw(Prisma.sql`
              UPDATE "OperatingFact" SET "amountCents" = 2000 WHERE "id" = ${first.id}
            `)),
          runtimeRoleTest ? "permission denied" : "只允许追加"
        );
        await expectDatabaseError(
          () =>
            runDirectWrite(clients[0]!, fixture.financeUserId, runtimeRoleTest, (tx) =>
              tx.$executeRaw(Prisma.sql`DELETE FROM "OperatingFact" WHERE "id" = ${first.id}`)
            ),
          runtimeRoleTest ? "permission denied" : "只允许追加"
        );
        await expectDatabaseError(
          () =>
            runDirectWrite(clients[0]!, fixture.financeUserId, runtimeRoleTest, (tx) =>
              tx.$executeRaw(Prisma.sql`TRUNCATE "OperatingImpactEntry"`)
            ),
          runtimeRoleTest ? "permission denied" : "只允许追加"
        );
        await expectDatabaseError(
          () =>
            runDirectWrite(clients[0]!, fixture.financeUserId, runtimeRoleTest, (tx) =>
              tx.$executeRaw(Prisma.sql`TRUNCATE "OperatingFact" CASCADE`)
            ),
          runtimeRoleTest ? "permission denied" : "只允许追加"
        );
        await expectDatabaseError(
          () =>
            runDirectWrite(clients[0]!, fixture.financeUserId, runtimeRoleTest, (tx) =>
              insertCrossProjectCorrection(tx, fixture, first.id)
            ),
          runtimeRoleTest ? "permission denied" : "同一项目"
        );
        await expectDatabaseError(
          () =>
            runDirectWrite(clients[0]!, fixture.financeUserId, runtimeRoleTest, (tx) =>
              insertInvalidParticipatingCompanyImpact(tx, fixture, first.id)
            ),
          runtimeRoleTest ? "permission denied" : "我方公司"
        );
        await expectDatabaseError(
          () =>
            runDirectWrite(clients[0]!, fixture.financeUserId, runtimeRoleTest, (tx) =>
              insertUnsupportedSubjectImpact(tx, fixture, first.id)
            ),
          runtimeRoleTest ? "permission denied" : "尚未接入该影响主体"
        );
        await setupClient.$executeRaw(Prisma.sql`
          UPDATE "Project" SET "isActive" = FALSE WHERE "id" = ${fixture.projectId}
        `);
        await expectDatabaseError(
          () =>
            runDirectWrite(clients[0]!, fixture.financeUserId, runtimeRoleTest, (tx) =>
              insertDirectFact(tx, fixture, "inactive", "施工企业一")
            ),
          runtimeRoleTest ? "permission denied" : "停用"
        );
        await setupClient.$executeRaw(Prisma.sql`
          UPDATE "Project" SET "isActive" = TRUE WHERE "id" = ${fixture.projectId}
        `);
        await expectDatabaseError(
          () =>
            runDirectWrite(clients[0]!, fixture.financeUserId, runtimeRoleTest, (tx) =>
              insertDirectFact(tx, fixture, "unauthorized", "施工企业一")
            ),
          runtimeRoleTest ? "permission denied" : "授权"
        );
        await expectDatabaseError(
          () =>
            runDirectWrite(clients[0]!, fixture.financeUserId, runtimeRoleTest, (tx) =>
              insertDirectFact(tx, fixture, "forged_snapshot", "伪造施工企业")
            ),
          runtimeRoleTest ? "permission denied" : "施工企业已失效"
        );
        await expectDatabaseError(
          () =>
            clients[0]!.$transaction(async (tx) => {
              await tx.$executeRaw(
                Prisma.sql`SELECT set_config('app.operating_ledger_actor', ${fixture.financeUserId}, true)`
              );
              return insertDirectFact(tx, fixture, "forged_guc", "施工企业一");
            }),
          runtimeRoleTest ? "permission denied" : "受控写入函数"
        );
        await expectDatabaseError(
          () =>
            clients[0]!.$queryRaw(
              Prisma.sql`SELECT * FROM public."appendOperatingFactThroughService"(NULL::public."OperatingLedgerFactWritePayload", ${fixture.financeUserId}, 'wrong-secret')`
            ),
          "写入授权上下文"
        );

        const concurrentInput = baseInput(fixture, "concurrent");
        concurrentInput.impacts = concurrentInput.impacts.slice(0, 1);
        const concurrentResults = await Promise.allSettled([
          new OperatingLedgerService(clients[1]! as never).appendFromSource(
            concurrentInput,
            fixture.financeUserId
          ),
          new OperatingLedgerService(clients[2]! as never).appendFromSource(
            { ...concurrentInput, idempotencyKey: `${fixture.prefix}_concurrent_replay` },
            fixture.financeUserId
          )
        ]);
        const concurrentErrors = concurrentResults
          .filter((result): result is PromiseRejectedResult => result.status === "rejected")
          .map((result) => String(result.reason?.message ?? result.reason));
        assert.equal(concurrentResults.every((result) => result.status === "fulfilled"), true, concurrentErrors.join("; "));
        const concurrentIds = concurrentResults.map((result) =>
          result.status === "fulfilled" ? result.value.id : null
        );
        expect(concurrentIds[0]).toBe(concurrentIds[1]);

        const [concurrentSummary] = await clients[0]!.$queryRaw<
          Array<{ factCount: bigint; impactCount: bigint; amount: bigint }>
        >(Prisma.sql`
          SELECT COUNT(DISTINCT fact."id")::bigint AS "factCount",
                 COUNT(impact."id")::bigint AS "impactCount",
                 COALESCE(SUM(impact."amountCents"), 0)::bigint AS amount
          FROM "OperatingFact" fact
          LEFT JOIN "OperatingImpactEntry" impact ON impact."factId" = fact."id"
          WHERE fact."sourceBusinessId" = ${`${fixture.prefix}_concurrent`}
        `);
        assert.equal(concurrentSummary?.factCount, 1n);
        assert.equal(concurrentSummary?.impactCount, 1n);
        assert.equal(concurrentSummary?.amount, 1000n);
      } finally {
        await Promise.allSettled(clients.map((client) => client.$disconnect()));
        if (setupClient !== clients[0]!) await setupClient.$disconnect();
      }
    },
    90_000
  );
});

function fixtureIds() {
  const prefix = `pol03_${randomUUID().replace(/-/gu, "")}`;
  return {
    prefix,
    financeUserId: `${prefix}_finance`,
    projectManagerId: `${prefix}_manager`,
    projectId: `${prefix}_project`,
    otherProjectId: `${prefix}_other_project`,
    assignmentId: `${prefix}_assignment`,
    otherAssignmentId: `${prefix}_other_assignment`,
    affiliateVersionId: `${prefix}_affiliate_version`,
    otherAffiliateVersionId: `${prefix}_other_affiliate_version`
  };
}

function assertDedicatedDatabase() {
  const databaseUrl = process.env.OPERATING_LEDGER_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl || process.env.NODE_ENV === "production") {
    throw new Error("经营事实账并发测试必须连接非生产隔离数据库");
  }
  const parsed = new URL(databaseUrl);
  if (!["postgresql:", "postgres:"].includes(parsed.protocol)) {
    throw new Error("经营事实账并发测试只允许 PostgreSQL");
  }
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new Error("经营事实账并发测试只允许使用本机 PostgreSQL");
  }
  if (!["/jiangkong_database_dynamic_misc", "/jiangkong_operating_ledger_test"].includes(parsed.pathname)) {
    throw new Error("经营事实账并发测试只允许一次性隔离数据库");
  }
  return databaseUrl;
}

async function seedFixture(client: PrismaClient, fixture: ReturnType<typeof fixtureIds>) {
  for (const userId of [fixture.financeUserId, fixture.projectManagerId]) {
    await client.$executeRaw(Prisma.sql`
      INSERT INTO "User" ("id", "name", "mustChangePassword", "isActive", "updatedAt")
      VALUES (${userId}, 'POL-03测试用户', FALSE, TRUE, CURRENT_TIMESTAMP)
    `);
  }
  for (const project of [
    [fixture.projectId, `${fixture.prefix}_project`, "POL-03经营事实项目"],
    [fixture.otherProjectId, `${fixture.prefix}_other_project`, "POL-03跨项目项目"]
  ] as const) {
    await client.$executeRaw(Prisma.sql`
      INSERT INTO "Project" (
        "id", "code", "name", "updatedAt"
      ) VALUES (
        ${project[0]}, ${project[1]}, ${project[2]}, CURRENT_TIMESTAMP
      )
    `);
  }
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "ProjectMember" ("id", "projectId", "userId", "positionKey")
    VALUES
      (${`${fixture.prefix}_member_finance`}, ${fixture.projectId}, ${fixture.financeUserId}, 'finance_staff'),
      (${`${fixture.prefix}_member_manager`}, ${fixture.projectId}, ${fixture.projectManagerId}, 'project_manager')
  `);
  for (const assignment of [
    [fixture.assignmentId, fixture.projectId, fixture.affiliateVersionId, "施工企业一"],
    [fixture.otherAssignmentId, fixture.otherProjectId, fixture.otherAffiliateVersionId, "施工企业二"]
  ] as const) {
    await client.$executeRaw(Prisma.sql`
      INSERT INTO "ProjectAffiliateAssignment" (
        "id", "projectId", "businessPartyId", "businessPartyVersionId",
        "affiliateNameSnapshot", "effectiveFrom", "changeReason", "assignedByUserId", "updatedAt"
      ) VALUES (
        ${assignment[0]}, ${assignment[1]}, ${`${assignment[0]}_party`}, ${assignment[2]},
        ${assignment[3]}, DATE '2026-01-01', 'POL-03测试', ${fixture.financeUserId}, CURRENT_TIMESTAMP
      )
    `);
  }
  for (const projectId of [fixture.projectId, fixture.otherProjectId]) {
    await client.$executeRaw(Prisma.sql`
      INSERT INTO "CompanyEntity" (
        "id", "name", "dataStatus", "currentVersionNo", "isActive", "createdAt", "updatedAt"
      ) VALUES (
        ${`${projectId}_company`}, '我方测试公司', 'legacy_incomplete', 1, TRUE,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `);
    await client.$executeRaw(Prisma.sql`
      INSERT INTO "CompanyEntityVersion" (
        "id", "companyEntityId", "versionNo", "name", "isActive", "action", "createdAt"
      ) VALUES (
        ${`${projectId}_company_version`}, ${`${projectId}_company`}, 1,
        '我方测试公司', TRUE, 'POL-03_TEST', CURRENT_TIMESTAMP
      )
    `);
    await client.$executeRaw(Prisma.sql`
      INSERT INTO "ProjectParticipatingCompany" (
        "id", "projectId", "companyEntityId", "companyEntityVersionId",
        "companyNameSnapshot", "effectiveFrom", "changeReason", "addedByUserId", "updatedAt"
      ) VALUES (
        ${`${projectId}_company_assignment`}, ${projectId}, ${`${projectId}_company`},
        ${`${projectId}_company_version`}, '我方测试公司', DATE '2026-01-01',
        'POL-03测试', ${fixture.financeUserId}, CURRENT_TIMESTAMP
      )
    `);
  }
  await client.$executeRaw(Prisma.sql`
    UPDATE "Project"
    SET "operatingLedgerEffectiveDate" = DATE '2026-08-01'
    WHERE "id" IN (${Prisma.join([fixture.projectId, fixture.otherProjectId])})
  `);
}

function baseInput(
  fixture: ReturnType<typeof fixtureIds>,
  suffix: string
): AppendOperatingFactInput {
  return {
    projectId: fixture.projectId,
    sourceType: "pol03_test_source",
    sourceBusinessId: `${fixture.prefix}_${suffix}`,
    sourceBusinessCode: `POL03-${suffix}`,
    sourceVersion: 1,
    idempotencyKey: `${fixture.prefix}_${suffix}_request`,
    occurredAt: new Date("2026-08-14T00:00:00.000Z"),
    confirmedAt: new Date("2026-08-14T01:00:00.000Z"),
    confirmedByUserId: fixture.financeUserId,
    factKind: "expense",
    operatingLevel: "project",
    evidenceLevel: "A",
    amountCents: 1000n,
    currencyCode: "CNY",
    direction: "outflow",
    isBeforeOperatingLedgerEffectiveDate: false,
    affiliateAssignmentId: fixture.assignmentId,
    affiliateBusinessPartyVersionId: fixture.affiliateVersionId,
    affiliateNameSnapshot: "施工企业一",
    sourceSnapshot: { source: "POL-03 PostgreSQL test", suffix },
    subjects: {
      costBearingCompany: {
        kind: "participating_company",
        id: `${fixture.projectId}_company_version`
      }
    },
    impacts: [
      {
        idempotencyKey: `${fixture.prefix}_${suffix}_cost`,
        sourceImpactKey: "cost",
        impactKind: "confirmed_cost",
        amountCents: 1000n,
        direction: "increase",
        costCategoryCode: "project_daily_expense",
        impactSnapshot: { kind: "cost" }
      },
      {
        idempotencyKey: `${fixture.prefix}_${suffix}_payable`,
        sourceImpactKey: "payable",
        impactKind: "payable_increase",
        amountCents: 1000n,
        direction: "increase",
        subjectRole: "debtor",
        subject: { kind: "construction_enterprise", id: fixture.affiliateVersionId },
        impactSnapshot: { kind: "payable" }
      }
    ]
  };
}

type OperatingLedgerRawClient = Pick<PrismaClient, "$executeRaw">;

async function runDirectWrite<T>(
  client: PrismaClient,
  actorUserId: string,
  runtimeRoleTest: boolean,
  action: (tx: OperatingLedgerRawClient) => Promise<T>
) {
  if (runtimeRoleTest) return action(client);
  const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
  if (!secret) throw new Error("OPERATING_LEDGER_DB_WRITE_SECRET 未配置");
  return client.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT public."authorizeOperatingLedgerWrite"(${actorUserId}, ${secret})`
    );
    return action(tx);
  });
}

async function insertCrossProjectCorrection(
  client: OperatingLedgerRawClient,
  fixture: ReturnType<typeof fixtureIds>,
  originalFactId: string
) {
  return client.$executeRaw(Prisma.sql`
    INSERT INTO "OperatingFact" (
      "id", "projectId", "sourceType", "sourceBusinessId", "sourceVersion", "sourceBusinessCode",
      "occurredAt", "confirmedAt", "affiliateAssignmentId", "affiliateBusinessPartyVersionId",
      "affiliateNameSnapshot", "operatingLedgerEffectiveDateSnapshot", "isBeforeOperatingLedgerEffectiveDate",
      "factKind", "operatingLevel", "evidenceLevel", "amountCents", "currencyCode", "direction",
      "subjectSnapshot", "sourceSnapshot", "entryKind", "adjustsFactId", "idempotencyKey", "recordedByUserId", "confirmedByUserId", "status"
    ) VALUES (
      ${`${fixture.prefix}_cross_project_fact`}, ${fixture.otherProjectId}, 'pol03_test_source',
      ${`${fixture.prefix}_cross_project`}, 1, 'POL03-CROSS', '2026-08-14', '2026-08-14',
      ${fixture.otherAssignmentId}, ${fixture.otherAffiliateVersionId}, '施工企业二', DATE '2026-08-01', FALSE,
      'expense', 'project', 'A', 1000, 'CNY', 'outflow', '{}'::jsonb, '{}'::jsonb, 'correction', ${originalFactId},
      ${`${fixture.prefix}_cross_project_key`}, ${fixture.financeUserId}, ${fixture.financeUserId}, 'confirmed'
    )
  `);
}

async function insertInvalidParticipatingCompanyImpact(
  client: OperatingLedgerRawClient,
  fixture: ReturnType<typeof fixtureIds>,
  factId: string
) {
  return client.$executeRaw(Prisma.sql`
    INSERT INTO "OperatingImpactEntry" (
      "id", "factId", "projectId", "sourceType", "sourceBusinessId", "sourceImpactKey",
      "idempotencyKey", "impactKind", "amountCents", "direction", "subjectRole",
      "subjectKind", "subjectId", "costCategoryCode", "impactSnapshot"
    ) VALUES (
      ${`${fixture.prefix}_invalid_impact`}, ${factId}, ${fixture.projectId}, 'pol03_test_source',
      ${`${fixture.prefix}_formal`}, 'invalid-participant', ${`${fixture.prefix}_invalid_impact_key`},
      'confirmed_cost', 1, 'increase', 'cost_bearing_company', 'participating_company',
      ${`${fixture.prefix}_not_participant`}, 'project_daily_expense', '{}'::jsonb
    )
  `);
}

async function insertUnsupportedSubjectImpact(
  client: OperatingLedgerRawClient,
  fixture: ReturnType<typeof fixtureIds>,
  factId: string
) {
  return client.$executeRaw(Prisma.sql`
    INSERT INTO "OperatingImpactEntry" (
      "id", "factId", "projectId", "sourceType", "sourceBusinessId", "sourceImpactKey",
      "idempotencyKey", "impactKind", "amountCents", "direction", "subjectRole",
      "subjectKind", "subjectId", "costCategoryCode", "impactSnapshot"
    ) VALUES (
      ${`${fixture.prefix}_unsupported_impact`}, ${factId}, ${fixture.projectId}, 'pol03_test_source',
      ${`${fixture.prefix}_formal`}, 'unsupported-subject', ${`${fixture.prefix}_unsupported_impact_key`},
      'confirmed_cost', 1, 'increase', 'payee', 'employee', ${`${fixture.prefix}_employee`},
      'project_daily_expense', '{}'::jsonb
    )
  `);
}

async function insertDirectFact(
  client: OperatingLedgerRawClient,
  fixture: ReturnType<typeof fixtureIds>,
  suffix: string,
  affiliateNameSnapshot: string
) {
  return client.$executeRaw(Prisma.sql`
    INSERT INTO "OperatingFact" (
      "id", "projectId", "sourceType", "sourceBusinessId", "sourceVersion", "sourceBusinessCode",
      "occurredAt", "confirmedAt", "affiliateAssignmentId", "affiliateBusinessPartyVersionId",
      "affiliateNameSnapshot", "operatingLedgerEffectiveDateSnapshot", "isBeforeOperatingLedgerEffectiveDate",
      "factKind", "operatingLevel", "evidenceLevel", "amountCents", "currencyCode", "direction",
      "subjectSnapshot", "sourceSnapshot", "entryKind", "idempotencyKey", "recordedByUserId", "confirmedByUserId", "status"
    ) VALUES (
      ${`${fixture.prefix}_${suffix}_fact`}, ${fixture.projectId}, 'pol03_test_source',
      ${`${fixture.prefix}_${suffix}`}, 1, ${`POL03-${suffix}`}, '2026-08-14', '2026-08-14',
      ${fixture.assignmentId}, ${fixture.affiliateVersionId}, ${affiliateNameSnapshot}, DATE '2026-08-01', FALSE,
      'expense', 'project', 'A', 1, 'CNY', 'outflow', '{}'::jsonb, '{}'::jsonb, 'original',
      ${`${fixture.prefix}_${suffix}_key`}, ${fixture.financeUserId}, ${fixture.financeUserId}, 'confirmed'
    )
  `);
}

async function expectDatabaseError(action: () => Promise<unknown>, message: string) {
  await expect(action()).rejects.toThrow(message);
}
