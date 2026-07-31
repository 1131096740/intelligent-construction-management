import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma, PrismaClient, type PrismaClient as PrismaClientType } from "@prisma/client";

const DATABASE_NAME = "jiangkong_project_expense_finance_concurrency";
const EXPECTED_MIGRATION_COUNT = readdirSync(
  resolve(__dirname, "../../prisma/migrations"),
  { withFileTypes: true }
).filter((entry) => entry.isDirectory()).length;

describe("project expense finance PostgreSQL concurrency", () => {
  const integrationTest =
    process.env.RUN_PROJECT_EXPENSE_FINANCE_CONCURRENCY === "1"
      ? it
      : it.skip;

  integrationTest(
    "keeps idempotency, cumulative money, audit and archive facts closed",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const clients = [0, 1, 2].map(
        () =>
          new PrismaClient({
            datasources: { db: { url: databaseUrl } }
          })
      );
      const fixture = fixtureIds();

      try {
        await Promise.all(clients.map((client) => client.$connect()));
        await assertFullyMigrated(clients[2]!);
        await assertProjectExpenseFinanceSchema(clients[2]!);
        await seedFixture(clients[0]!, fixture);

        await verifyDirectInsertRequiresIdempotency(clients[0]!, fixture);
        await verifyClosedAuditRequired(clients[0]!, fixture);
        await verifyImmutableFinanceFact(clients[0]!, fixture);
        await verifyActorAndAuditRemainClosed(clients[0]!, fixture);
        await verifyConcurrentCumulativeLimit(clients, fixture);
        await verifyParentProjectionGuard(clients[0]!, fixture);
        await verifyConcurrentFinanceArchiveUniqueness(clients, fixture);
      } finally {
        await Promise.allSettled(
          clients.map((client) => client.$disconnect())
        );
      }
    },
    90_000
  );
});

type Fixture = ReturnType<typeof fixtureIds>;

function fixtureIds() {
  const prefix = `pefc_${randomUUID().replace(/-/gu, "")}`;
  return {
    prefix,
    actorUserId: `${prefix}_finance`,
    projectId: `${prefix}_project`,
    requests: {
      direct: `${prefix}_request_direct`,
      audit: `${prefix}_request_audit`,
      immutable: `${prefix}_request_immutable`,
      concurrent: `${prefix}_request_concurrent`
    }
  };
}

function assertDedicatedDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || process.env.NODE_ENV === "production") {
    throw new Error("项目支出财务并发测试必须连接非生产隔离数据库");
  }
  const parsed = new URL(databaseUrl);
  if (!new Set(["postgresql:", "postgres:"]).has(parsed.protocol)) {
    throw new Error("项目支出财务并发测试只允许 PostgreSQL");
  }
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(parsed.hostname)) {
    throw new Error("项目支出财务并发测试只允许使用本机 PostgreSQL");
  }
  if (parsed.pathname !== `/${DATABASE_NAME}`) {
    throw new Error("项目支出财务并发测试只允许使用固定专用数据库");
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
  assert(
    migrationCount?.count === BigInt(EXPECTED_MIGRATION_COUNT),
    `项目支出财务并发测试要求完整 ${EXPECTED_MIGRATION_COUNT} 个迁移`
  );
}

async function assertProjectExpenseFinanceSchema(client: PrismaClientType) {
  const requiredIndexes = [
    "FinanceRecord_idempotencyKey_key",
    "AuditLog_project_expense_finance_record_key",
    "PdfDocument_project_expense_finance_archive_key"
  ];
  const indexes = await client.$queryRaw<Array<{ name: string }>>(Prisma.sql`
    SELECT indexname AS name
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname IN (${Prisma.join(requiredIndexes)})
  `);
  const actualIndexes = new Set(indexes.map((index) => index.name));
  for (const index of requiredIndexes) {
    assert(actualIndexes.has(index), `项目支出财务并发测试缺少索引 ${index}`);
  }

  const requiredConstraints = [
    "FinanceRecord_project_expense_owner_fk",
    "FinanceRecord_createdByUserId_fkey",
    "FinanceRecord_project_expense_idempotency_key_format_check",
    "FinanceRecord_project_expense_source_check",
    "FinanceRecord_project_expense_amount_positive_check"
  ];
  const constraints = await client.$queryRaw<
    Array<{ name: string; validated: boolean }>
  >(Prisma.sql`
    SELECT conname AS name, convalidated AS validated
    FROM pg_constraint
    WHERE conname IN (${Prisma.join(requiredConstraints)})
  `);
  const constraintByName = new Map(
    constraints.map((constraint) => [constraint.name, constraint.validated])
  );
  for (const constraint of requiredConstraints) {
    assert(
      constraintByName.get(constraint) === true,
      `项目支出财务并发测试要求约束 ${constraint} 已安装且 validated`
    );
  }

  const requiredTriggers = [
    "FinanceRecord_project_expense_insert_guard",
    "FinanceRecord_project_expense_immutable",
    "FinanceRecord_project_expense_closed_fact_guard",
    "AuditLog_project_expense_finance_closed_fact_guard",
    "AuditLog_project_expense_finance_immutable",
    "ProjectExpenseRequest_finance_projection_guard"
  ];
  const triggers = await client.$queryRaw<Array<{ name: string }>>(Prisma.sql`
    SELECT tgname AS name
    FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgname IN (${Prisma.join(requiredTriggers)})
  `);
  const actualTriggers = new Set(triggers.map((trigger) => trigger.name));
  for (const trigger of requiredTriggers) {
    assert(actualTriggers.has(trigger), `项目支出财务并发测试缺少触发器 ${trigger}`);
  }

  const [column] = await client.$queryRaw<Array<{ nullable: string }>>`
    SELECT is_nullable AS nullable
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'FinanceRecord'
      AND column_name = 'idempotencyKey'
  `;
  assert(column?.nullable === "YES", "项目支出财务幂等键必须保留 legacy NULL");
}

async function seedFixture(client: PrismaClientType, fixture: Fixture) {
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "User" (
      "id", "name", "mustChangePassword", "isActive", "updatedAt"
    ) VALUES (
      ${fixture.actorUserId}, '项目支出财务测试员', FALSE, TRUE, CURRENT_TIMESTAMP
    )
  `);
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "Project" ("id", "code", "name", "updatedAt")
    VALUES (
      ${fixture.projectId}, ${`${fixture.prefix}_project_code`},
      '项目支出财务并发项目', CURRENT_TIMESTAMP
    )
  `);

  for (const [index, requestId] of Object.values(fixture.requests).entries()) {
    await client.$executeRaw(Prisma.sql`
      INSERT INTO "ProjectExpenseRequest" (
        "id", "projectId", "code", "expenseType", "expenseSubtype",
        "paymentSubject", "reason", "requestedAmountCents",
        "approvedAmountCents", "paidAmountCents", "paymentMethod",
        "handlerUserId", "applicantUserId", "status", "updatedAt"
      ) VALUES (
        ${requestId}, ${fixture.projectId}, ${`${fixture.prefix}_request_${index}`},
        'comprehensive_expense', 'travel', '项目支出财务测试',
        '数据库并发验收', 2000, 2000, 1000, 'bank_transfer',
        ${fixture.actorUserId}, ${fixture.actorUserId}, 'partially_paid',
        CURRENT_TIMESTAMP
      )
    `);
  }
}

async function verifyDirectInsertRequiresIdempotency(
  client: PrismaClientType,
  fixture: Fixture
) {
  const recordId = `${fixture.prefix}_finance_missing_key`;
  await expectDatabaseError(
    () =>
      client.$executeRaw(Prisma.sql`
        INSERT INTO "FinanceRecord" (
          "id", "projectId", "projectExpenseRequestId", "direction",
          "amountCents", "occurredAt", "createdByUserId"
        ) VALUES (
          ${recordId}, ${fixture.projectId}, ${fixture.requests.direct},
          'outflow', 100, '2026-07-31T00:00:00.000Z', ${fixture.actorUserId}
        )
      `),
    "project_expense_finance_idempotency_required"
  );
  await assertFinanceCount(client, recordId, 0n);
}

async function verifyClosedAuditRequired(
  client: PrismaClientType,
  fixture: Fixture
) {
  const missingAuditId = `${fixture.prefix}_finance_missing_audit`;
  await expectDatabaseError(
    () =>
      client.$executeRaw(Prisma.sql`
        INSERT INTO "FinanceRecord" (
          "id", "idempotencyKey", "projectId", "projectExpenseRequestId",
          "direction", "amountCents", "occurredAt", "createdByUserId"
        ) VALUES (
          ${missingAuditId}, ${randomUUID()}, ${fixture.projectId},
          ${fixture.requests.audit}, 'outflow', 100,
          '2026-07-31T00:00:00.000Z', ${fixture.actorUserId}
        )
      `),
    "project_expense_finance_closed_fact_mismatch"
  );
  await assertFinanceCount(client, missingAuditId, 0n);

  const mismatchId = `${fixture.prefix}_finance_bad_audit`;
  const mismatchKey = randomUUID();
  await expectDatabaseError(
    () =>
      client.$transaction(async (tx) => {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "FinanceRecord" (
            "id", "idempotencyKey", "projectId", "projectExpenseRequestId",
            "direction", "amountCents", "occurredAt", "createdByUserId"
          ) VALUES (
            ${mismatchId}, ${mismatchKey}, ${fixture.projectId},
            ${fixture.requests.audit}, 'outflow', 100,
            '2026-07-31T00:00:00.000Z', ${fixture.actorUserId}
          )
        `);
        await insertFinanceAudit(tx, {
          id: `${mismatchId}_audit`,
          actorUserId: fixture.actorUserId,
          requestId: fixture.requests.audit,
          financeRecordId: mismatchId,
          idempotencyKey: mismatchKey,
          amountCents: "99",
          occurredAt: "2026-07-31T00:00:00.000Z"
        });
        await tx.$executeRawUnsafe(
          'SET CONSTRAINTS "FinanceRecord_project_expense_closed_fact_guard" IMMEDIATE'
        );
      }),
    "project_expense_finance_closed_fact_mismatch"
  );
  await assertFinanceCount(client, mismatchId, 0n);
}

async function verifyImmutableFinanceFact(
  client: PrismaClientType,
  fixture: Fixture
) {
  const recordId = `${fixture.prefix}_finance_immutable`;
  const key = randomUUID();
  await insertClosedFinanceFact(client, {
    id: recordId,
    idempotencyKey: key,
    projectId: fixture.projectId,
    requestId: fixture.requests.immutable,
    actorUserId: fixture.actorUserId,
    amountCents: 300n,
    occurredAt: "2026-07-31T01:00:00.000Z"
  });

  await expectDatabaseError(
    () =>
      client.$executeRaw(Prisma.sql`
        UPDATE "FinanceRecord"
        SET "amountCents" = 301
        WHERE "id" = ${recordId}
      `),
    "project_expense_finance_immutable_update"
  );
  await expectDatabaseError(
    () =>
      client.$executeRaw(Prisma.sql`
        DELETE FROM "FinanceRecord" WHERE "id" = ${recordId}
      `),
    "project_expense_finance_immutable_delete"
  );
  await assertFinanceCount(client, recordId, 1n);
}

async function verifyActorAndAuditRemainClosed(
  client: PrismaClientType,
  fixture: Fixture
) {
  const missingActorRecordId = `${fixture.prefix}_finance_missing_actor`;
  await expectDatabaseError(
    () =>
      client.$executeRaw(Prisma.sql`
        INSERT INTO "FinanceRecord" (
          "id", "idempotencyKey", "projectId", "projectExpenseRequestId",
          "direction", "amountCents", "occurredAt", "createdByUserId"
        ) VALUES (
          ${missingActorRecordId}, ${randomUUID()}, ${fixture.projectId},
          ${fixture.requests.direct}, 'outflow', 100,
          '2026-07-31T01:30:00.000Z', ${`${fixture.prefix}_missing_actor`}
        )
      `),
    "project_expense_finance_actor_missing"
  );
  await assertFinanceCount(client, missingActorRecordId, 0n);

  const immutableRecordId = `${fixture.prefix}_finance_immutable`;
  const immutableAuditId = `${immutableRecordId}_audit`;
  await expectDatabaseError(
    () =>
      client.$executeRaw(Prisma.sql`
        UPDATE "AuditLog"
        SET "metadata" = jsonb_set(
          "metadata",
          '{amountCents}',
          to_jsonb('301'::text)
        )
        WHERE "id" = ${immutableAuditId}
      `),
    "project_expense_finance_audit_immutable_update"
  );
  await expectDatabaseError(
    () =>
      client.$executeRaw(Prisma.sql`
        DELETE FROM "AuditLog" WHERE "id" = ${immutableAuditId}
      `),
    "project_expense_finance_audit_immutable_delete"
  );

  const [immutableFact] = await client.$queryRaw<
    Array<{
      count: bigint;
      auditCount: bigint;
      auditAmountCents: string | null;
    }>
  >(Prisma.sql`
    SELECT
      COUNT(*)::bigint AS count,
      (
        SELECT COUNT(*)::bigint
        FROM "AuditLog" audit
        WHERE audit."id" = ${immutableAuditId}
      ) AS "auditCount",
      (
        SELECT audit."metadata"->>'amountCents'
        FROM "AuditLog" audit
        WHERE audit."id" = ${immutableAuditId}
      ) AS "auditAmountCents"
    FROM "FinanceRecord" finance
    WHERE finance."id" = ${immutableRecordId}
  `);
  assert(immutableFact?.count === 1n, "不可变财务事实必须继续保留");
  assert(immutableFact?.auditCount === 1n, "不可变财务审计必须继续保留");
  assert(
    immutableFact?.auditAmountCents === "300",
    "不可变财务审计金额不得被篡改"
  );

  const [immutableKey] = await client.$queryRaw<
    Array<{ idempotencyKey: string }>
  >(Prisma.sql`
    SELECT "idempotencyKey"
    FROM "FinanceRecord"
    WHERE "id" = ${immutableRecordId}
  `);
  assert(immutableKey, "不可变财务事实缺少幂等键");
  await expectDatabaseError(
    () =>
      insertFinanceAudit(client, {
        id: `${immutableAuditId}_duplicate`,
        actorUserId: fixture.actorUserId,
        requestId: fixture.requests.immutable,
        financeRecordId: immutableRecordId,
        idempotencyKey: immutableKey.idempotencyKey,
        amountCents: "300",
        occurredAt: "2026-07-31T01:00:00.000Z"
      }),
    "already exists"
  );

  await expectDatabaseError(
    () =>
      insertFinanceAudit(client, {
        id: `${immutableAuditId}_orphan`,
        actorUserId: fixture.actorUserId,
        requestId: fixture.requests.immutable,
        financeRecordId: `${fixture.prefix}_missing_finance`,
        idempotencyKey: randomUUID(),
        amountCents: "300",
        occurredAt: "2026-07-31T01:00:00.000Z"
      }),
    "project_expense_finance_audit_closed_fact_mismatch"
  );
  const [closedAudit] = await client.$queryRaw<Array<{ count: bigint }>>(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM "AuditLog"
      WHERE "action" = 'project_expense.finance.record'
        AND "businessType" = 'project_expense_request'
        AND "metadata"->>'financeRecordId' = ${immutableRecordId}
    `
  );
  assert(closedAudit?.count === 1n, "财务事实只能保留一条闭合审计");

  await expectDatabaseError(
    () =>
      client.$executeRaw(Prisma.sql`
        DELETE FROM "User" WHERE "id" = ${fixture.actorUserId}
      `),
    "FinanceRecord_createdByUserId_fkey"
  );
  const [actor] = await client.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "User"
    WHERE "id" = ${fixture.actorUserId}
  `;
  assert(actor?.count === 1n, "财务经办人身份必须继续保留");
}

async function verifyConcurrentCumulativeLimit(
  clients: PrismaClientType[],
  fixture: Fixture
) {
  const releaseFirst = deferred<void>();
  const firstReady = deferred<number>();
  const firstRecordId = `${fixture.prefix}_finance_concurrent_0`;
  const firstKey = randomUUID();
  const firstAttempt = clients[0]!.$transaction(async (tx) => {
    const blockerPid = await backendPid(tx);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "FinanceRecord" (
        "id", "idempotencyKey", "projectId", "projectExpenseRequestId",
        "direction", "amountCents", "occurredAt", "createdByUserId"
      ) VALUES (
        ${firstRecordId}, ${firstKey}, ${fixture.projectId},
        ${fixture.requests.concurrent}, 'outflow', 700,
        '2026-07-31T02:00:00.000Z', ${fixture.actorUserId}
      )
    `);
    await insertFinanceAudit(tx, {
      id: `${firstRecordId}_audit`,
      actorUserId: fixture.actorUserId,
      requestId: fixture.requests.concurrent,
      financeRecordId: firstRecordId,
      idempotencyKey: firstKey,
      amountCents: "700",
      occurredAt: "2026-07-31T02:00:00.000Z"
    });
    firstReady.resolve(blockerPid);
    await releaseFirst.promise;
  });

  const blockerPid = await firstReady.promise;
  await assertRequestAdvisoryLockHeld(clients[2]!, blockerPid);
  const secondRecordId = `${fixture.prefix}_finance_concurrent_1`;
  const secondKey = randomUUID();
  const secondAttempt = clients[1]!.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "FinanceRecord" (
        "id", "idempotencyKey", "projectId", "projectExpenseRequestId",
        "direction", "amountCents", "occurredAt", "createdByUserId"
      ) VALUES (
        ${secondRecordId}, ${secondKey}, ${fixture.projectId},
        ${fixture.requests.concurrent}, 'outflow', 700,
        '2026-07-31T02:00:00.000Z', ${fixture.actorUserId}
      )
    `);
    await insertFinanceAudit(tx, {
      id: `${secondRecordId}_audit`,
      actorUserId: fixture.actorUserId,
      requestId: fixture.requests.concurrent,
      financeRecordId: secondRecordId,
      idempotencyKey: secondKey,
      amountCents: "700",
      occurredAt: "2026-07-31T02:00:00.000Z"
    });
  });

  let secondResult: PromiseSettledResult<void> | undefined;
  try {
    [secondResult] = await Promise.allSettled([secondAttempt]);
  } finally {
    releaseFirst.resolve(undefined);
  }
  const [firstResult] = await Promise.allSettled([firstAttempt]);
  assert(secondResult, "并发项目支出财务 loser 未返回结果");
  const results = [firstResult, secondResult];
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  const outcomeEvidence = results
    .map((result) =>
      result.status === "fulfilled" ? "fulfilled" : String(result.reason)
    )
    .join("\n");
  assert(
    fulfilled.length === 1,
    `并发项目支出财务登记必须只有一个 winner：${outcomeEvidence}`
  );
  assert(
    rejected.length === 1,
    `并发项目支出财务登记必须拒绝一个 loser：${outcomeEvidence}`
  );
  assert(
    String(rejected[0]!.reason).includes(
      "project_expense_finance_concurrent_write"
    ),
    "并发 loser 必须由请求级 advisory NOWAIT 门拒绝"
  );

  await expectDatabaseError(
    () =>
      insertClosedFinanceFact(clients[1]!, {
        id: `${fixture.prefix}_finance_sequential_overflow`,
        idempotencyKey: randomUUID(),
        projectId: fixture.projectId,
        requestId: fixture.requests.concurrent,
        actorUserId: fixture.actorUserId,
        amountCents: 700n,
        occurredAt: "2026-07-31T02:01:00.000Z"
      }),
    "project_expense_finance_cumulative_exceeds_paid"
  );

  const [summary] = await clients[2]!.$queryRaw<
    Array<{ count: bigint; amount: bigint; auditCount: bigint }>
  >(Prisma.sql`
    SELECT
      COUNT(*)::bigint AS count,
      COALESCE(SUM(finance."amountCents"), 0)::bigint AS amount,
      (
        SELECT COUNT(*)::bigint
        FROM "AuditLog" audit
        WHERE audit."action" = 'project_expense.finance.record'
          AND audit."businessId" = ${fixture.requests.concurrent}
      ) AS "auditCount"
    FROM "FinanceRecord" finance
    WHERE finance."projectExpenseRequestId" = ${fixture.requests.concurrent}
  `);
  assert(summary?.count === 1n, "并发项目支出财务登记只能保留一条事实");
  assert(summary?.amount === 700n, "并发项目支出财务累计不得超过实付");
  assert(summary?.auditCount === 1n, "并发 loser 的审计必须完整回滚");
}

async function backendPid(client: Prisma.TransactionClient) {
  const [connection] = await client.$queryRaw<Array<{ pid: number }>>(
    Prisma.sql`SELECT pg_backend_pid()::int AS pid`
  );
  assert(connection, "项目支出财务并发验收未取得 backend pid");
  return Number(connection.pid);
}

async function assertRequestAdvisoryLockHeld(
  observer: PrismaClientType,
  backendPid: number
) {
  const [lock] = await observer.$queryRaw<Array<{ count: bigint }>>(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM pg_locks
      WHERE pid = CAST(${backendPid} AS integer)
        AND locktype = 'advisory'
        AND granted
        AND classid::bigint = 190731
    `
  );
  assert(
    lock?.count === 1n,
    `backend ${backendPid} 未持有项目支出财务请求级 advisory 锁`
  );
}

async function verifyParentProjectionGuard(
  client: PrismaClientType,
  fixture: Fixture
) {
  await expectDatabaseError(
    () =>
      client.$executeRaw(Prisma.sql`
        UPDATE "ProjectExpenseRequest"
        SET "paidAmountCents" = 600
        WHERE "id" = ${fixture.requests.concurrent}
      `),
    "project_expense_finance_cumulative_exceeds_paid"
  );
  await expectDatabaseError(
    () =>
      client.$executeRaw(Prisma.sql`
        UPDATE "ProjectExpenseRequest"
        SET "status" = 'voided', "paidAmountCents" = 0
        WHERE "id" = ${fixture.requests.concurrent}
      `),
    "project_expense_finance_request_status_mismatch"
  );
}

async function verifyConcurrentFinanceArchiveUniqueness(
  clients: PrismaClientType[],
  fixture: Fixture
) {
  const attempts = [0, 1].map((index) =>
    clients[index]!.$executeRaw(Prisma.sql`
      INSERT INTO "PdfDocument" (
        "id", "businessType", "businessId", "fileId", "templateKey"
      ) VALUES (
        ${`${fixture.prefix}_pdf_${index}`}, 'project_expense_request',
        ${fixture.requests.concurrent}, ${`${fixture.prefix}_pdf_file_${index}`},
        'project_expense_finance_archive'
      )
    `)
  );
  const results = await Promise.allSettled(attempts);
  assert(
    results.filter((result) => result.status === "fulfilled").length === 1,
    "项目支出财务归档并发只能有一个 winner"
  );
  assert(
    results.filter((result) => result.status === "rejected").length === 1,
    "项目支出财务归档并发必须拒绝一个 duplicate"
  );
  const [count] = await clients[2]!.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "PdfDocument"
    WHERE "businessType" = 'project_expense_request'
      AND "businessId" = ${fixture.requests.concurrent}
      AND "templateKey" = 'project_expense_finance_archive'
  `;
  assert(count?.count === 1n, "项目支出财务归档只能保留一个 PDF");
}

async function insertClosedFinanceFact(
  client: PrismaClientType,
  input: {
    id: string;
    idempotencyKey: string;
    projectId: string;
    requestId: string;
    actorUserId: string;
    amountCents: bigint;
    occurredAt: string;
  }
) {
  await client.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "FinanceRecord" (
        "id", "idempotencyKey", "projectId", "projectExpenseRequestId",
        "direction", "amountCents", "occurredAt", "createdByUserId"
      ) VALUES (
        ${input.id}, ${input.idempotencyKey}, ${input.projectId},
        ${input.requestId}, 'outflow', ${input.amountCents},
        ${new Date(input.occurredAt)}, ${input.actorUserId}
      )
    `);
    await insertFinanceAudit(tx, {
      id: `${input.id}_audit`,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      financeRecordId: input.id,
      idempotencyKey: input.idempotencyKey,
      amountCents: input.amountCents.toString(),
      occurredAt: input.occurredAt
    });
  });
}

async function insertFinanceAudit(
  client: Pick<Prisma.TransactionClient, "$executeRaw">,
  input: {
    id: string;
    actorUserId: string;
    requestId: string;
    financeRecordId: string;
    idempotencyKey: string;
    amountCents: string;
    occurredAt: string;
  }
) {
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "AuditLog" (
      "id", "actorUserId", "action", "businessType", "businessId", "metadata"
    ) VALUES (
      ${input.id}, ${input.actorUserId}, 'project_expense.finance.record',
      'project_expense_request', ${input.requestId},
      jsonb_build_object(
        'financeRecordId', ${input.financeRecordId},
        'idempotencyKey', ${input.idempotencyKey},
        'amountCents', ${input.amountCents},
        'occurredAt', ${input.occurredAt}
      )
    )
  `);
}

async function assertFinanceCount(
  client: PrismaClientType,
  recordId: string,
  expected: bigint
) {
  const [result] = await client.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "FinanceRecord"
    WHERE "id" = ${recordId}
  `;
  assert(result?.count === expected, `财务事实 ${recordId} 数量不符合预期`);
}

async function expectDatabaseError(
  action: () => Promise<unknown>,
  marker: string
) {
  try {
    await action();
  } catch (error) {
    assert(
      String(error).includes(marker),
      `数据库错误缺少预期 marker ${marker}: ${String(error)}`
    );
    return;
  }
  throw new Error(`数据库操作应失败并返回 ${marker}`);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
