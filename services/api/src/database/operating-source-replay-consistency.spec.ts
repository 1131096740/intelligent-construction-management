import { randomUUID } from "node:crypto";
import * as assert from "node:assert/strict";

import { Prisma, PrismaClient } from "@prisma/client";

import { OperatingLedgerService } from "../operating-ledger/operating-ledger.service";
import {
  OperatingSourceAdapterRegistry,
  type OperatingSourceAdapter,
  type OperatingSourceLocator,
  type OperatingSourceSnapshot
} from "../operating-ledger/operating-source-adapter";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";

describe("operating source replay PostgreSQL consistency", () => {
  const integrationTest =
    process.env.RUN_OPERATING_SOURCE_REPLAY_DATABASE === "1" ? it : it.skip;

  integrationTest(
    "keeps formal source replay, permission, status, amount, concurrency and read-only comparison closed",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const clients = [0, 1, 2].map(
        () => new PrismaClient({ datasources: { db: { url: databaseUrl } } })
      );
      const fixture = fixtureIds();
      const adapter = new PostgreSqlTestSourceAdapter();

      try {
        await Promise.all(clients.map((client) => client.$connect()));
        await seedFixture(clients[0]!, fixture);
        const services = clients.map((client) =>
          createReplayService(
            client,
            new OperatingSourceAdapterRegistry([adapter], [adapter.sourceType])
          )
        );
        const missingAdapterBeforeReplay = createReplayService(
          clients[0]!,
          new OperatingSourceAdapterRegistry([], [adapter.sourceType])
        );
        await expect(
          missingAdapterBeforeReplay.compareProject(
            fixture.projectId,
            fixture.replayUserId
          )
        ).rejects.toThrow("缺少经营来源适配器");

        await expect(
          services[0]!.replaySource(draftLocator(fixture), fixture.projectManagerId)
        ).rejects.toThrow("只有当前项目财务人员可以登记经营事实");
        await expect(
          services[0]!.replaySource(draftLocator(fixture), fixture.replayUserId)
        ).rejects.toThrow("只有正式来源快照可以重放");
        await expectFactCounts(clients[0]!, fixture, 0n, 0n, 0n);

        const concurrent = await Promise.all([
          services[1]!.replaySource(formalLocator(fixture), fixture.replayUserId),
          services[2]!.replaySource(formalLocator(fixture), fixture.replayUserId)
        ]);
        expect(concurrent.map((result) => result.created).sort()).toEqual([false, true]);
        await expectFactCounts(clients[0]!, fixture, 1n, 2n, 2000n);

        const repeated = await services[0]!.replaySource(
          formalLocator(fixture),
          fixture.replayUserId
        );
        expect(repeated.created).toBe(false);
        await expectFactCounts(clients[0]!, fixture, 1n, 2n, 2000n);

        const clean = await services[0]!.compareProject(
          fixture.projectId,
          fixture.replayUserId
        );
        expect(clean).toEqual(
          expect.objectContaining({
            consistent: true,
            summary: {
              expectedFacts: 1,
              actualFacts: 1,
              expectedImpacts: 2,
              actualImpacts: 2,
              differenceCount: 0
            }
          })
        );

        const writingAdapter = new WritingTestSourceAdapter();
        const writeAttemptService = createReplayService(
          clients[0]!,
          new OperatingSourceAdapterRegistry(
            [adapter, writingAdapter],
            [adapter.sourceType, writingAdapter.sourceType]
          )
        );
        await expect(
          writeAttemptService.compareProject(fixture.projectId, fixture.replayUserId)
        ).rejects.toThrow("read-only transaction");
        await expectFactCounts(clients[0]!, fixture, 1n, 2n, 2000n);

        const comparisonReachedSource = deferred<void>();
        const releaseComparison = deferred<void>();
        const barrierAdapter = new PostgreSqlTestSourceAdapter(async () => {
          comparisonReachedSource.resolve();
          await releaseComparison.promise;
        });
        const barrierService = createReplayService(
          clients[0]!,
          new OperatingSourceAdapterRegistry(
            [barrierAdapter],
            [barrierAdapter.sourceType]
          )
        );
        const stableComparison = barrierService.compareProject(
          fixture.projectId,
          fixture.replayUserId
        );
        await comparisonReachedSource.promise;
        await clients[1]!.$executeRaw(Prisma.sql`
          UPDATE "POL04TestSource"
          SET "sourceVersion" = 2, "amountCents" = 1100
          WHERE "projectId" = ${fixture.projectId}
            AND "sourceBusinessId" = ${fixture.formalSourceId}
        `);
        releaseComparison.resolve();
        await expect(stableComparison).resolves.toEqual(
          expect.objectContaining({ consistent: true })
        );

        await clients[0]!.$executeRaw(Prisma.sql`
          UPDATE "POL04TestSource"
          SET "sourceVersion" = 2, "amountCents" = 1500
          WHERE "projectId" = ${fixture.projectId}
            AND "sourceBusinessId" = ${fixture.formalSourceId}
        `);
        const beforeCompare = await factCounts(clients[0]!, fixture);
        const drift = await services[0]!.compareProject(
          fixture.projectId,
          fixture.replayUserId
        );
        const afterCompare = await factCounts(clients[0]!, fixture);
        expect(afterCompare).toEqual(beforeCompare);
        expect(drift.consistent).toBe(false);
        expect(drift.differences.length).toBeGreaterThanOrEqual(3);
        expect(
          drift.differences.every(
            (difference) => difference.sourceBusinessCode === fixture.formalBusinessCode
          )
        ).toBe(true);
        expect(drift.differences.map((difference) => difference.field)).toEqual(
          expect.arrayContaining(["来源修订", "金额（元）"])
        );
        expect(JSON.stringify(drift)).not.toMatch(/sourceVersion|amountCents|confirmedByUserId/u);

        await clients[0]!.$executeRaw(Prisma.sql`
          UPDATE "ProjectParticipatingCompany"
          SET "companyNameSnapshot" = 'POL-04我方公司修订名'
          WHERE "projectId" = ${fixture.projectId}
            AND "companyEntityVersionId" = ${fixture.companyVersionId}
        `);
        await clients[0]!.$executeRaw(Prisma.sql`
          UPDATE "POL04TestSource"
          SET "impactLabel" = '修订影响'
          WHERE "projectId" = ${fixture.projectId}
            AND "sourceBusinessId" = ${fixture.formalSourceId}
        `);
        const subjectDrift = await services[0]!.compareProject(
          fixture.projectId,
          fixture.replayUserId
        );
        expect(subjectDrift.differences.map((difference) => difference.field)).toEqual(
          expect.arrayContaining(["事实主体快照", "影响主体快照"])
        );

        const missingRegistryService = createReplayService(
          clients[0]!,
          new OperatingSourceAdapterRegistry([], [adapter.sourceType])
        );
        await expect(
          missingRegistryService.compareProject(fixture.projectId, fixture.financeUserId)
        ).rejects.toThrow("缺少经营来源适配器");
      } finally {
        await Promise.allSettled(clients.map((client) => client.$disconnect()));
      }
    },
    90_000
  );
});

class PostgreSqlTestSourceAdapter implements OperatingSourceAdapter {
  readonly sourceType = "pol04_test_source";

  constructor(
    private readonly beforeProjectRead?: () => Promise<void>
  ) {}

  async readProjectSnapshots(
    tx: Prisma.TransactionClient,
    projectId: string
  ): Promise<readonly OperatingSourceSnapshot[]> {
    await this.beforeProjectRead?.();
    const rows = await tx.$queryRaw<TestSourceRow[]>(Prisma.sql`
      SELECT *
      FROM "POL04TestSource"
      WHERE "projectId" = ${projectId}
        AND "status" = 'confirmed'
      ORDER BY "sourceBusinessId"
    `);
    return rows.map((row) => testSourceSnapshot(row));
  }

  async readSourceSnapshot(
    tx: Prisma.TransactionClient,
    locator: OperatingSourceLocator
  ): Promise<OperatingSourceSnapshot | null> {
    const rows = await tx.$queryRaw<TestSourceRow[]>(Prisma.sql`
      SELECT *
      FROM "POL04TestSource"
      WHERE "projectId" = ${locator.projectId}
        AND "sourceBusinessId" = ${locator.sourceBusinessId}
      LIMIT 1
    `);
    return rows[0] ? testSourceSnapshot(rows[0]) : null;
  }

  toOperatingFactInput(snapshot: OperatingSourceSnapshot) {
    const source = snapshot as TestOperatingSourceSnapshot;
    return {
      projectId: source.projectId,
      sourceType: source.sourceType,
      sourceBusinessId: source.sourceBusinessId,
      sourceBusinessCode: source.sourceBusinessCode,
      sourceVersion: source.sourceVersion,
      idempotencyKey: `${source.sourceBusinessId}:fact`,
      occurredAt: source.occurredAt,
      confirmedAt: source.confirmedAt,
      confirmedByUserId: source.confirmedByUserId,
      factKind: "expense" as const,
      operatingLevel: "project" as const,
      evidenceLevel: "A" as const,
      amountCents: source.amountCents,
      currencyCode: "CNY",
      direction: "outflow" as const,
      isBeforeOperatingLedgerEffectiveDate: false,
      affiliateAssignmentId: source.affiliateAssignmentId,
      affiliateBusinessPartyVersionId: source.affiliateVersionId,
      affiliateNameSnapshot: source.affiliateNameSnapshot,
      sourceSnapshot: source.sourceSnapshot,
      subjects: {
        costBearingCompany: {
          kind: "participating_company" as const,
          id: source.companyVersionId
        }
      },
      impacts: [
        {
          idempotencyKey: `${source.sourceBusinessId}:cost`,
          sourceImpactKey: "cost",
          impactKind: "confirmed_cost" as const,
          amountCents: source.amountCents,
          direction: "increase" as const,
          costCategoryCode: "project_daily_expense" as const,
          impactSnapshot: { source: "POL-04 PostgreSQL test", kind: "cost" }
        },
        {
          idempotencyKey: `${source.sourceBusinessId}:payable`,
          sourceImpactKey: "payable",
          impactKind: "payable_increase" as const,
          amountCents: source.amountCents,
          direction: "increase" as const,
          subjectRole: "debtor" as const,
          subject: {
            kind: "construction_enterprise" as const,
            id: source.affiliateVersionId
          },
          impactSnapshot: {
            source: "POL-04 PostgreSQL test",
            kind: "payable",
            label: source.impactLabel
          }
        }
      ]
    };
  }
}

class WritingTestSourceAdapter implements OperatingSourceAdapter {
  readonly sourceType = "pol04_writing_test_source";

  async readProjectSnapshots(tx: Prisma.TransactionClient) {
    await tx.$executeRaw(Prisma.sql`
      UPDATE "POL04TestSource" SET "amountCents" = "amountCents"
    `);
    return [];
  }

  async readSourceSnapshot() {
    return null;
  }

  toOperatingFactInput(): never {
    throw new Error("只读写入探针不生成经营事实");
  }
}

function createReplayService(
  client: PrismaClient,
  registry: OperatingSourceAdapterRegistry
) {
  const ledger = new OperatingLedgerService(client as never);
  return new OperatingSourceReplayService(client as never, ledger, registry);
}

function fixtureIds() {
  const prefix = `pol04_${randomUUID().replace(/-/gu, "")}`;
  return {
    prefix,
    financeUserId: `${prefix}_finance`,
    replayUserId: `${prefix}_replay_finance`,
    projectManagerId: `${prefix}_manager`,
    projectId: `${prefix}_project`,
    assignmentId: `${prefix}_assignment`,
    affiliateVersionId: `${prefix}_affiliate_version`,
    companyId: `${prefix}_company`,
    companyVersionId: `${prefix}_company_version`,
    formalSourceId: `${prefix}_formal`,
    draftSourceId: `${prefix}_draft`,
    formalBusinessCode: "POL-04正式来源一号",
    draftBusinessCode: "POL-04草稿来源一号"
  };
}

async function seedFixture(client: PrismaClient, fixture: ReturnType<typeof fixtureIds>) {
  const secret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
  if (!secret) throw new Error("POL-04 PostgreSQL 测试缺少经营账写入密钥");
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "OperatingLedgerWriteSecret" ("id", "secretHash")
    VALUES (1, crypt(${secret}, gen_salt('bf')))
    ON CONFLICT ("id") DO UPDATE SET "secretHash" = EXCLUDED."secretHash"
  `);
  for (const userId of [
    fixture.financeUserId,
    fixture.replayUserId,
    fixture.projectManagerId
  ]) {
    await client.$executeRaw(Prisma.sql`
      INSERT INTO "User" ("id", "name", "mustChangePassword", "isActive", "updatedAt")
      VALUES (${userId}, 'POL-04测试用户', FALSE, TRUE, CURRENT_TIMESTAMP)
    `);
  }
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "Project" ("id", "code", "name", "updatedAt")
    VALUES (${fixture.projectId}, ${fixture.projectId}, 'POL-04来源重放项目', CURRENT_TIMESTAMP)
  `);
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "ProjectMember" ("id", "projectId", "userId", "positionKey")
    VALUES
      (${`${fixture.prefix}_finance_member`}, ${fixture.projectId}, ${fixture.financeUserId}, 'finance_staff'),
      (${`${fixture.prefix}_replay_member`}, ${fixture.projectId}, ${fixture.replayUserId}, 'finance_staff'),
      (${`${fixture.prefix}_manager_member`}, ${fixture.projectId}, ${fixture.projectManagerId}, 'project_manager')
  `);
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "ProjectAffiliateAssignment" (
      "id", "projectId", "businessPartyId", "businessPartyVersionId",
      "affiliateNameSnapshot", "effectiveFrom", "changeReason", "assignedByUserId", "updatedAt"
    ) VALUES (
      ${fixture.assignmentId}, ${fixture.projectId}, ${`${fixture.prefix}_affiliate`},
      ${fixture.affiliateVersionId}, 'POL-04施工企业', DATE '2026-01-01',
      'POL-04测试', ${fixture.financeUserId}, CURRENT_TIMESTAMP
    )
  `);
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "CompanyEntity" (
      "id", "name", "dataStatus", "currentVersionNo", "isActive", "createdAt", "updatedAt"
    ) VALUES (
      ${fixture.companyId}, 'POL-04我方公司', 'legacy_incomplete', 1, TRUE,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `);
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "CompanyEntityVersion" (
      "id", "companyEntityId", "versionNo", "name", "isActive", "action", "createdAt"
    ) VALUES (
      ${fixture.companyVersionId}, ${fixture.companyId}, 1, 'POL-04我方公司', TRUE,
      'POL04_TEST', CURRENT_TIMESTAMP
    )
  `);
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "ProjectParticipatingCompany" (
      "id", "projectId", "companyEntityId", "companyEntityVersionId",
      "companyNameSnapshot", "effectiveFrom", "changeReason", "addedByUserId", "updatedAt"
    ) VALUES (
      ${`${fixture.prefix}_company_assignment`}, ${fixture.projectId}, ${fixture.companyId},
      ${fixture.companyVersionId}, 'POL-04我方公司', DATE '2026-01-01',
      'POL-04测试', ${fixture.financeUserId}, CURRENT_TIMESTAMP
    )
  `);
  await client.$executeRaw(Prisma.sql`
    UPDATE "Project"
    SET "operatingLedgerEffectiveDate" = DATE '2026-08-01'
    WHERE "id" = ${fixture.projectId}
  `);
  await client.$executeRaw(Prisma.sql`
    CREATE TABLE IF NOT EXISTS "POL04TestSource" (
      "projectId" TEXT NOT NULL,
      "sourceBusinessId" TEXT NOT NULL,
      "sourceBusinessCode" TEXT NOT NULL,
      "sourceVersion" INTEGER NOT NULL,
      "status" TEXT NOT NULL,
      "amountCents" BIGINT NOT NULL,
      "occurredAt" TIMESTAMPTZ NOT NULL,
      "confirmedAt" TIMESTAMPTZ NOT NULL,
      "confirmedByUserId" TEXT NOT NULL,
      "impactLabel" TEXT NOT NULL,
      "affiliateAssignmentId" TEXT NOT NULL,
      "affiliateVersionId" TEXT NOT NULL,
      "affiliateNameSnapshot" TEXT NOT NULL,
      "companyVersionId" TEXT NOT NULL,
      PRIMARY KEY ("projectId", "sourceBusinessId")
    )
  `);
  for (const source of [
    [fixture.formalSourceId, fixture.formalBusinessCode, "confirmed"],
    [fixture.draftSourceId, fixture.draftBusinessCode, "draft"]
  ] as const) {
    await client.$executeRaw(Prisma.sql`
      INSERT INTO "POL04TestSource" (
        "projectId", "sourceBusinessId", "sourceBusinessCode", "sourceVersion", "status",
        "amountCents", "occurredAt", "confirmedAt", "confirmedByUserId",
        "impactLabel", "affiliateAssignmentId", "affiliateVersionId",
        "affiliateNameSnapshot", "companyVersionId"
      ) VALUES (
        ${fixture.projectId}, ${source[0]}, ${source[1]}, 1, ${source[2]}, 1000,
        '2026-08-14T00:00:00.000Z', '2026-08-14T01:00:00.000Z', ${fixture.financeUserId},
        '原始影响', ${fixture.assignmentId}, ${fixture.affiliateVersionId}, 'POL-04施工企业',
        ${fixture.companyVersionId}
      )
    `);
  }
}

function formalLocator(fixture: ReturnType<typeof fixtureIds>) {
  return locator(fixture, fixture.formalSourceId);
}

function draftLocator(fixture: ReturnType<typeof fixtureIds>) {
  return locator(fixture, fixture.draftSourceId);
}

function locator(fixture: ReturnType<typeof fixtureIds>, sourceBusinessId: string) {
  return {
    projectId: fixture.projectId,
    sourceType: "pol04_test_source",
    sourceBusinessId
  };
}

function testSourceSnapshot(row: TestSourceRow): TestOperatingSourceSnapshot {
  return {
    projectId: row.projectId,
    sourceType: "pol04_test_source",
    sourceBusinessId: row.sourceBusinessId,
    sourceBusinessCode: row.sourceBusinessCode,
    sourceVersion: row.sourceVersion,
    status: row.status as "confirmed",
    sourceSnapshot: {
      businessCode: row.sourceBusinessCode,
      amountCents: row.amountCents.toString()
    },
    amountCents: row.amountCents,
    occurredAt: row.occurredAt,
    confirmedAt: row.confirmedAt,
    confirmedByUserId: row.confirmedByUserId,
    impactLabel: row.impactLabel,
    affiliateAssignmentId: row.affiliateAssignmentId,
    affiliateVersionId: row.affiliateVersionId,
    affiliateNameSnapshot: row.affiliateNameSnapshot,
    companyVersionId: row.companyVersionId
  };
}

async function expectFactCounts(
  client: PrismaClient,
  fixture: ReturnType<typeof fixtureIds>,
  expectedFacts: bigint,
  expectedImpacts: bigint,
  expectedImpactAmount: bigint
) {
  const counts = await factCounts(client, fixture);
  assert.deepEqual(counts, {
    factCount: expectedFacts,
    impactCount: expectedImpacts,
    impactAmount: expectedImpactAmount
  });
}

async function factCounts(client: PrismaClient, fixture: ReturnType<typeof fixtureIds>) {
  const rows = await client.$queryRaw<
    Array<{ factCount: bigint; impactCount: bigint; impactAmount: bigint }>
  >(Prisma.sql`
    SELECT COUNT(DISTINCT fact."id")::bigint AS "factCount",
           COUNT(impact."id")::bigint AS "impactCount",
           COALESCE(SUM(impact."amountCents"), 0)::bigint AS "impactAmount"
    FROM "OperatingFact" fact
    LEFT JOIN "OperatingImpactEntry" impact ON impact."factId" = fact."id"
    WHERE fact."projectId" = ${fixture.projectId}
      AND fact."sourceType" = 'pol04_test_source'
  `);
  return rows[0]!;
}

function assertDedicatedDatabase() {
  const databaseUrl = process.env.OPERATING_LEDGER_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl || process.env.NODE_ENV === "production") {
    throw new Error("经营来源重放测试必须连接非生产隔离数据库");
  }
  const parsed = new URL(databaseUrl);
  if (
    !["postgresql:", "postgres:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname) ||
    parsed.pathname !== "/jiangkong_database_dynamic_misc"
  ) {
    throw new Error("经营来源重放测试只允许本机一次性 PostgreSQL 16 专库");
  }
  return databaseUrl;
}

interface TestSourceRow {
  projectId: string;
  sourceBusinessId: string;
  sourceBusinessCode: string;
  sourceVersion: number;
  status: string;
  amountCents: bigint;
  occurredAt: Date;
  confirmedAt: Date;
  confirmedByUserId: string;
  impactLabel: string;
  affiliateAssignmentId: string;
  affiliateVersionId: string;
  affiliateNameSnapshot: string;
  companyVersionId: string;
}

interface TestOperatingSourceSnapshot extends OperatingSourceSnapshot {
  amountCents: bigint;
  occurredAt: Date;
  confirmedAt: Date;
  confirmedByUserId: string;
  impactLabel: string;
  affiliateAssignmentId: string;
  affiliateVersionId: string;
  affiliateNameSnapshot: string;
  companyVersionId: string;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
