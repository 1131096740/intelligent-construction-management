import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  Prisma,
  PrismaClient,
  type PrismaClient as PrismaClientType
} from "@prisma/client";

const DATABASE_NAME =
  "jiangkong_project_expense_receipt_concurrency";
const EXPECTED_MIGRATION_COUNT = readdirSync(
  resolve(__dirname, "../../prisma/migrations"),
  { withFileTypes: true }
).filter((entry) => entry.isDirectory()).length;

describe("project expense receipt PostgreSQL concurrency", () => {
  const integrationTest =
    process.env.RUN_PROJECT_EXPENSE_RECEIPT_CONCURRENCY === "1"
      ? it
      : it.skip;

  integrationTest(
    "closes receipt, audit, actor and idempotency facts under concurrency",
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
        await assertReceiptSchema(clients[2]!);
        await seedFixture(clients[0]!, fixture);

        await verifyCoordinatesCannotChangeDuringConfirmation(
          clients[0]!,
          fixture
        );
        await verifyReceiptWithoutAuditRollsBack(
          clients[0]!,
          fixture
        );
        await verifyMismatchedAuditRollsBack(
          clients[0]!,
          fixture
        );
        await verifyAuditWithoutReceiptRollsBack(
          clients[0]!,
          fixture
        );
        await verifyReceiptFirstAndPaymentFirst(
          clients[0]!,
          fixture
        );
        await verifyReceiptAndAuditImmutable(
          clients[0]!,
          fixture
        );
        await verifyActorAndIdempotencyClosed(
          clients[0]!,
          fixture
        );
        await verifyConcurrentReceiptWinner(clients, fixture);
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
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

interface ReceiptConcurrencyControl {
  backendPid: Deferred<number>;
  entered?: Deferred<void>;
  release?: Promise<void>;
}

function fixtureIds() {
  const prefix = `perc_${randomUUID().replace(/-/gu, "")}`;
  return {
    prefix,
    actorUserId: `${prefix}_material`,
    otherUserId: `${prefix}_other`,
    projectId: `${prefix}_project`,
    requests: {
      noAudit: `${prefix}_no_audit`,
      badAudit: `${prefix}_bad_audit`,
      orphanAudit: `${prefix}_orphan_audit`,
      receiptFirst: `${prefix}_receipt_first`,
      paymentFirst: `${prefix}_payment_first`,
      immutable: `${prefix}_immutable`,
      actorAndKey: `${prefix}_actor_key`,
      concurrent: `${prefix}_concurrent`,
      uniqueKeyPeer: `${prefix}_unique_key_peer`
    }
  };
}

function assertDedicatedDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || process.env.NODE_ENV === "production") {
    throw new Error(
      "项目支出收货并发测试必须连接非生产隔离数据库"
    );
  }
  const parsed = new URL(databaseUrl);
  if (!new Set(["postgresql:", "postgres:"]).has(parsed.protocol)) {
    throw new Error("项目支出收货并发测试只允许 PostgreSQL");
  }
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(parsed.hostname)) {
    throw new Error("项目支出收货并发测试只允许本机 PostgreSQL");
  }
  if (parsed.pathname !== `/${DATABASE_NAME}`) {
    throw new Error("项目支出收货并发测试只允许固定专用数据库");
  }
  return databaseUrl;
}

async function assertFullyMigrated(client: PrismaClientType) {
  const [migrationCount] = await client.$queryRaw<
    Array<{ count: bigint }>
  >`
    SELECT COUNT(*)::bigint AS count
    FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL
      AND rolled_back_at IS NULL
  `;
  assert(
    migrationCount?.count === BigInt(EXPECTED_MIGRATION_COUNT),
    `项目支出收货并发测试要求完整 ${EXPECTED_MIGRATION_COUNT} 个迁移`
  );
}

async function assertReceiptSchema(client: PrismaClientType) {
  const requiredIndexes = [
    "ProjectExpenseRequest_receiptConfirmationIdempotencyKey_key",
    "AuditLog_project_expense_receipt_confirm_business_key"
  ];
  const indexes = await client.$queryRaw<Array<{ name: string }>>(
    Prisma.sql`
      SELECT indexname AS name
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname IN (${Prisma.join(requiredIndexes)})
    `
  );
  const actualIndexes = new Set(indexes.map((row) => row.name));
  for (const index of requiredIndexes) {
    assert(actualIndexes.has(index), `缺少收货事实索引 ${index}`);
  }

  const requiredConstraints = [
    "ProjectExpenseRequest_receiptConfirmedByUserId_fkey",
    "ProjectExpenseRequest_receipt_shape_check",
    "ProjectExpenseRequest_receipt_idempotency_format_check",
    "ProjectExpenseRequest_receipt_business_check"
  ];
  const constraints = await client.$queryRaw<
    Array<{ name: string; validated: boolean }>
  >(Prisma.sql`
    SELECT conname AS name, convalidated AS validated
    FROM pg_constraint
    WHERE conname IN (${Prisma.join(requiredConstraints)})
  `);
  const byName = new Map(
    constraints.map((row) => [row.name, row.validated])
  );
  for (const constraint of requiredConstraints) {
    assert(
      byName.get(constraint) === true,
      `收货事实约束 ${constraint} 未安装或未 validate`
    );
  }

  const requiredTriggers = [
    "ProjectExpenseRequest_receipt_fact_guard",
    "ProjectExpenseRequest_receipt_closed_fact_guard",
    "AuditLog_project_expense_receipt_closed_fact_guard",
    "AuditLog_project_expense_receipt_immutable"
  ];
  const triggers = await client.$queryRaw<Array<{ name: string }>>(
    Prisma.sql`
      SELECT tgname AS name
      FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgname IN (${Prisma.join(requiredTriggers)})
    `
  );
  const actualTriggers = new Set(triggers.map((row) => row.name));
  for (const trigger of requiredTriggers) {
    assert(actualTriggers.has(trigger), `缺少收货事实触发器 ${trigger}`);
  }

  const [column] = await client.$queryRaw<
    Array<{ nullable: string }>
  >`
    SELECT is_nullable AS nullable
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'ProjectExpenseRequest'
      AND column_name = 'receiptConfirmationIdempotencyKey'
  `;
  assert(
    column?.nullable === "YES",
    "收货幂等键必须为 legacy 事实保留 NULL"
  );
}

async function seedFixture(
  client: PrismaClientType,
  fixture: Fixture
) {
  for (const [userId, name] of [
    [fixture.actorUserId, "收货申请人"],
    [fixture.otherUserId, "其他人"]
  ]) {
    await client.$executeRaw(Prisma.sql`
      INSERT INTO "User" (
        "id", "name", "mustChangePassword", "isActive", "updatedAt"
      ) VALUES (
        ${userId}, ${name}, FALSE, TRUE, CURRENT_TIMESTAMP
      )
    `);
  }
  await client.$executeRaw(Prisma.sql`
    INSERT INTO "Project" ("id", "code", "name", "updatedAt")
    VALUES (
      ${fixture.projectId}, ${`${fixture.prefix}_project_code`},
      '收货并发项目', CURRENT_TIMESTAMP
    )
  `);

  for (const [index, requestId] of Object.values(
    fixture.requests
  ).entries()) {
    const status = requestId === fixture.requests.paymentFirst
      ? "paid"
      : "approved_pending_payment";
    const paidAmountCents = status === "paid" ? 2000 : 0;
    await client.$executeRaw(Prisma.sql`
      INSERT INTO "ProjectExpenseRequest" (
        "id", "projectId", "code", "expenseType", "expenseSubtype",
        "paymentSubject", "reason", "requestedAmountCents",
        "approvedAmountCents", "paidAmountCents", "paymentMethod",
        "handlerUserId", "applicantUserId", "purchaseExecutedByUserId",
        "purchaseExecutedAt", "status", "updatedAt"
      ) VALUES (
        ${requestId}, ${fixture.projectId},
        ${`${fixture.prefix}_request_${index}`}, 'spot_purchase',
        'spot_material_purchase', '收货并发测试', '数据库验收',
        2000, 2000, ${paidAmountCents}, 'bank_transfer',
        ${fixture.actorUserId}, ${fixture.actorUserId},
        ${fixture.actorUserId}, '2026-07-30T00:00:00.000Z',
        ${status}, '2026-07-31T00:00:00.000Z'
      )
    `);
  }
}

async function verifyReceiptWithoutAuditRollsBack(
  client: PrismaClientType,
  fixture: Fixture
) {
  await expectDatabaseError(
    () =>
      client.$transaction(async (tx) => {
        await updateReceiptFact(
          tx,
          fixture,
          fixture.requests.noAudit,
          randomUUID(),
          "缺少审计"
        );
        await tx.$executeRawUnsafe(
          'SET CONSTRAINTS "ProjectExpenseRequest_receipt_closed_fact_guard" IMMEDIATE'
        );
      }),
    "project_expense_receipt_closed_fact_mismatch"
  );
  await assertReceiptAbsent(client, fixture.requests.noAudit);
}

async function verifyCoordinatesCannotChangeDuringConfirmation(
  client: PrismaClientType,
  fixture: Fixture
) {
  const tamperedId = `${fixture.requests.noAudit}_tampered`;
  await expectDatabaseError(
    () =>
      client.projectExpenseRequest.update({
        where: { id: fixture.requests.noAudit },
        data: {
          id: tamperedId,
          receiptConfirmedByUserId: fixture.actorUserId,
          receiptConfirmedAt: new Date(
            "2026-07-31T01:00:00.000Z"
          ),
          receiptConfirmationIdempotencyKey: randomUUID(),
          receiptConfirmationNote: "确认时篡改主键"
        }
      }),
    "project_expense_receipt_coordinates_changed"
  );
  await assertReceiptAbsent(client, fixture.requests.noAudit);
  assert(
    await client.projectExpenseRequest.count({
      where: { id: tamperedId }
    }) === 0,
    "收货确认不得同时改写父记录主键"
  );
}

async function verifyMismatchedAuditRollsBack(
  client: PrismaClientType,
  fixture: Fixture
) {
  await expectDatabaseError(
    () =>
      client.$transaction(async (tx) => {
        const fact = await updateReceiptFact(
          tx,
          fixture,
          fixture.requests.badAudit,
          randomUUID(),
          "审计错绑"
        );
        await createReceiptAudit(tx, fixture, fact, {
          idempotencyKey: randomUUID()
        });
        await tx.$executeRawUnsafe(
          'SET CONSTRAINTS "ProjectExpenseRequest_receipt_closed_fact_guard" IMMEDIATE'
        );
      }),
    "project_expense_receipt_closed_fact_mismatch"
  );
  await assertReceiptAbsent(client, fixture.requests.badAudit);
}

async function verifyAuditWithoutReceiptRollsBack(
  client: PrismaClientType,
  fixture: Fixture
) {
  const idempotencyKey = randomUUID();
  await expectDatabaseError(
    () =>
      client.$transaction(async (tx) => {
        await tx.auditLog.create({
          data: {
            actorUserId: fixture.actorUserId,
            action: "project_expense.receipt.confirm",
            businessType: "project_expense_request",
            businessId: fixture.requests.orphanAudit,
            metadata: {
              code: `${fixture.prefix}_request_2`,
              projectId: fixture.projectId,
              idempotencyKey,
              confirmedByUserId: fixture.actorUserId,
              confirmedAt: "2026-07-31T01:00:00.000Z",
              note: "孤立审计",
              statusAtConfirmation: "approved_pending_payment",
              paymentCompleted: false,
              expectedExpenseUpdatedAt:
                "2026-07-31T00:00:00.000Z"
            }
          }
        });
        await tx.$executeRawUnsafe(
          'SET CONSTRAINTS "AuditLog_project_expense_receipt_closed_fact_guard" IMMEDIATE'
        );
      }),
    "project_expense_receipt_audit_closed_fact_mismatch"
  );
}

async function verifyReceiptFirstAndPaymentFirst(
  client: PrismaClientType,
  fixture: Fixture
) {
  const receiptFirst = await confirmReceipt(
    client,
    fixture,
    fixture.requests.receiptFirst,
    randomUUID(),
    "先收货后付款"
  );
  assert(
    receiptFirst.status === "approved_pending_payment" &&
      receiptFirst.paidAmountCents === 0n,
    "收货在付款前应可成为闭合事实"
  );
  await expectDatabaseError(
    () =>
      client.projectExpenseRequest.update({
        where: { id: fixture.requests.receiptFirst },
        data: { status: "voided" }
      }),
    "ProjectExpenseRequest_receipt_business_check"
  );
  await client.projectExpenseRequest.update({
    where: { id: fixture.requests.receiptFirst },
    data: { status: "paid", paidAmountCents: 2000n }
  });
  const receiptFirstAudit = await client.auditLog.findFirstOrThrow({
    where: {
      action: "project_expense.receipt.confirm",
      businessType: "project_expense_request",
      businessId: fixture.requests.receiptFirst
    },
    select: { metadata: true }
  });
  const receiptFirstMetadata =
    receiptFirstAudit.metadata as Record<string, unknown>;
  assert(
    receiptFirstMetadata.statusAtConfirmation ===
      "approved_pending_payment" &&
      receiptFirstMetadata.paymentCompleted === false,
    "付款状态后续推进不得改写原收货审计快照"
  );

  const paymentFirst = await confirmReceipt(
    client,
    fixture,
    fixture.requests.paymentFirst,
    randomUUID(),
    "先付款后收货"
  );
  assert(
    paymentFirst.status === "paid" &&
      paymentFirst.paidAmountCents === 2000n,
    "付款后应仍可确认收货"
  );
}

async function verifyReceiptAndAuditImmutable(
  client: PrismaClientType,
  fixture: Fixture
) {
  const fact = await confirmReceipt(
    client,
    fixture,
    fixture.requests.immutable,
    randomUUID(),
    "不可变收货"
  );
  await expectDatabaseError(
    () =>
      client.projectExpenseRequest.update({
        where: { id: fact.requestId },
        data: { receiptConfirmationNote: "篡改" }
      }),
    "project_expense_receipt_immutable_update"
  );
  for (const coordinateChange of [
    { id: `${fact.requestId}_tampered` },
    { code: `${fixture.prefix}_tampered_code` },
    { projectId: `${fixture.prefix}_tampered_project` },
    { expenseType: "reimbursement" },
    { applicantUserId: fixture.otherUserId },
    { purchaseExecutedAt: new Date("2026-07-29T00:00:00.000Z") }
  ]) {
    await expectDatabaseError(
      () =>
        client.projectExpenseRequest.update({
          where: { id: fact.requestId },
          data: coordinateChange
        }),
      "project_expense_receipt_coordinates_immutable"
    );
  }
  await expectDatabaseError(
    () =>
      client.projectExpenseRequest.delete({
        where: { id: fact.requestId }
      }),
    "project_expense_receipt_immutable_delete"
  );
  const audit = await client.auditLog.findFirstOrThrow({
    where: {
      action: "project_expense.receipt.confirm",
      businessType: "project_expense_request",
      businessId: fact.requestId
    }
  });
  await expectDatabaseError(
    () =>
      client.auditLog.update({
        where: { id: audit.id },
        data: { metadata: { changed: true } }
      }),
    "project_expense_receipt_audit_immutable_update"
  );
  await expectDatabaseError(
    () => client.auditLog.delete({ where: { id: audit.id } }),
    "project_expense_receipt_audit_immutable_delete"
  );
}

async function verifyActorAndIdempotencyClosed(
  client: PrismaClientType,
  fixture: Fixture
) {
  const key = randomUUID();
  await confirmReceipt(
    client,
    fixture,
    fixture.requests.actorAndKey,
    key,
    "演员与幂等闭合"
  );
  await expectDatabaseError(
    () =>
      client.user.delete({ where: { id: fixture.actorUserId } }),
    "ProjectExpenseRequest_receiptConfirmedByUserId_fkey"
  );
  await expectDatabaseError(
    () =>
      confirmReceipt(
        client,
        fixture,
        fixture.requests.uniqueKeyPeer,
        key,
        "重用幂等键"
      ),
    "receiptConfirmationIdempotencyKey"
  );
  await assertReceiptAbsent(
    client,
    fixture.requests.uniqueKeyPeer
  );
}

async function verifyConcurrentReceiptWinner(
  clients: PrismaClientType[],
  fixture: Fixture
) {
  const firstKey = randomUUID();
  const secondKey = randomUUID();
  const firstPid = deferred<number>();
  const secondPid = deferred<number>();
  const firstEntered = deferred();
  const releaseFirst = deferred();
  const firstOperation = confirmReceipt(
    clients[0]!,
    fixture,
    fixture.requests.concurrent,
    firstKey,
    "并发收货 A",
    {
      backendPid: firstPid,
      entered: firstEntered,
      release: releaseFirst.promise
    }
  );
  await within(
    firstEntered.promise,
    "收货并发 winner 未进入持锁暂停点"
  );
  const secondOperation = confirmReceipt(
    clients[1]!,
    fixture,
    fixture.requests.concurrent,
    secondKey,
    "并发收货 B",
    { backendPid: secondPid }
  );
  try {
    await observeDirectBlock(
      clients[2]!,
      await within(firstPid.promise, "收货并发 winner PID 未捕获"),
      await within(secondPid.promise, "收货并发 loser PID 未捕获")
    );
  } catch (error) {
    releaseFirst.resolve(undefined);
    await Promise.allSettled([firstOperation, secondOperation]);
    throw error;
  }
  releaseFirst.resolve(undefined);
  const attempts = await Promise.allSettled([
    firstOperation,
    secondOperation
  ]);
  assert(
    attempts[0]?.status === "fulfilled",
    `持锁的首个收货事实必须成为 winner，实际 ${String(attempts[0])}`
  );
  const rejected = attempts[1];
  const rejectedCode =
    rejected?.status === "rejected" &&
    rejected.reason &&
    typeof rejected.reason === "object" &&
    "code" in rejected.reason
      ? (rejected.reason as { code?: unknown }).code
      : undefined;
  const rejectedMessage =
    rejected?.status === "rejected" ? String(rejected.reason) : "";
  assert(
    rejected?.status === "rejected" &&
      (
        rejectedCode === "P2034" ||
        rejectedMessage.includes(
          "project_expense_receipt_immutable_update"
        ) ||
        rejectedMessage.includes("write conflict")
      ),
    "并发 loser 必须被串行化冲突或不可变收货事实拒绝"
  );
  const [request, audits] = await Promise.all([
    clients[2]!.projectExpenseRequest.findUniqueOrThrow({
      where: { id: fixture.requests.concurrent },
      select: {
        receiptConfirmedByUserId: true,
        receiptConfirmationIdempotencyKey: true,
        receiptConfirmationNote: true
      }
    }),
    clients[2]!.auditLog.findMany({
      where: {
        action: "project_expense.receipt.confirm",
        businessType: "project_expense_request",
        businessId: fixture.requests.concurrent
      },
      select: { actorUserId: true, metadata: true }
    })
  ]);
  const auditMetadata = audits[0]?.metadata as
    | Record<string, unknown>
    | undefined;
  assert(
    request.receiptConfirmedByUserId === fixture.actorUserId &&
      request.receiptConfirmationIdempotencyKey === firstKey &&
      request.receiptConfirmationNote === "并发收货 A",
    "并发收货父记录必须只保留持锁 winner 的 actor/key/note"
  );
  assert(
    audits.length === 1 &&
      audits[0]?.actorUserId === fixture.actorUserId &&
      auditMetadata?.idempotencyKey === firstKey,
    "并发收货必须只有一条与 winner 幂等键闭合的审计"
  );
}

async function confirmReceipt(
  client: PrismaClientType,
  fixture: Fixture,
  requestId: string,
  idempotencyKey: string,
  note: string,
  control?: ReceiptConcurrencyControl
) {
  return client.$transaction(
    async (tx) => {
      if (control) {
        const [connection] = await tx.$queryRaw<
          Array<{ pid: number }>
        >(Prisma.sql`SELECT pg_backend_pid()::int AS pid`);
        if (!connection) {
          throw new Error("未捕获收货并发 PostgreSQL backend PID");
        }
        control.backendPid.resolve(connection.pid);
      }
      const fact = await updateReceiptFact(
        tx,
        fixture,
        requestId,
        idempotencyKey,
        note
      );
      await createReceiptAudit(tx, fixture, fact);
      await tx.$executeRawUnsafe(
        'SET CONSTRAINTS "ProjectExpenseRequest_receipt_closed_fact_guard", "AuditLog_project_expense_receipt_closed_fact_guard" IMMEDIATE'
      );
      if (control?.entered) {
        control.entered.resolve(undefined);
        if (!control.release) {
          throw new Error("收货并发暂停点缺少 release gate");
        }
        await control.release;
      }
      return fact;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

async function observeDirectBlock(
  observer: PrismaClientType,
  blockerPid: number,
  blockedPid: number
) {
  let bestSnapshot: unknown = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [session] = await observer.$queryRaw<
      Array<{
        waitEventType: string | null;
        blockingPids: number[];
        query: string;
      }>
    >(Prisma.sql`
      SELECT
        wait_event_type AS "waitEventType",
        pg_blocking_pids(CAST(${blockedPid} AS integer))::int[]
          AS "blockingPids",
        query
      FROM pg_stat_activity
      WHERE pid = CAST(${blockedPid} AS integer)
    `);
    bestSnapshot = session
      ? {
          waitEventType: session.waitEventType,
          blockingPids: session.blockingPids.map(Number),
          query: session.query.replace(/\s+/gu, " ").slice(0, 180)
        }
      : null;
    if (
      session?.waitEventType === "Lock" &&
      session.blockingPids.map(Number).includes(blockerPid)
    ) {
      return;
    }
    await new Promise((resolvePromise) =>
      setTimeout(resolvePromise, 20)
    );
  }
  throw new Error(
    `未观察到收货 backend ${blockedPid} 被 ${blockerPid} 直接阻塞；最接近快照 ${JSON.stringify(bestSnapshot)}`
  );
}

async function updateReceiptFact(
  tx: Prisma.TransactionClient,
  fixture: Fixture,
  requestId: string,
  idempotencyKey: string,
  note: string
) {
  const request = await tx.projectExpenseRequest.findUniqueOrThrow({
    where: { id: requestId },
    select: {
      id: true,
      code: true,
      projectId: true,
      status: true,
      paidAmountCents: true,
      updatedAt: true
    }
  });
  const confirmedAt = new Date("2026-07-31T01:00:00.000Z");
  const updated = await tx.projectExpenseRequest.update({
    where: { id: requestId },
    data: {
      receiptConfirmedByUserId: fixture.actorUserId,
      receiptConfirmedAt: confirmedAt,
      receiptConfirmationIdempotencyKey: idempotencyKey,
      receiptConfirmationNote: note
    },
    select: { updatedAt: true }
  });
  return {
    requestId: request.id,
    code: request.code,
    projectId: request.projectId,
    actorUserId: fixture.actorUserId,
    status: request.status,
    paidAmountCents: request.paidAmountCents,
    idempotencyKey,
    confirmedAt,
    note,
    expectedExpenseUpdatedAt: request.updatedAt,
    updatedAt: updated.updatedAt
  };
}

async function createReceiptAudit(
  tx: Prisma.TransactionClient,
  _fixture: Fixture,
  fact: Awaited<ReturnType<typeof updateReceiptFact>>,
  overrides: Record<string, unknown> = {}
) {
  await tx.auditLog.create({
    data: {
      actorUserId: fact.actorUserId,
      action: "project_expense.receipt.confirm",
      businessType: "project_expense_request",
      businessId: fact.requestId,
      metadata: {
        code: fact.code,
        projectId: fact.projectId,
        idempotencyKey: fact.idempotencyKey,
        confirmedByUserId: fact.actorUserId,
        confirmedAt: fact.confirmedAt.toISOString(),
        note: fact.note,
        statusAtConfirmation: fact.status,
        paymentCompleted: fact.status === "paid",
        expectedExpenseUpdatedAt:
          fact.expectedExpenseUpdatedAt.toISOString(),
        ...overrides
      }
    }
  });
}

async function assertReceiptAbsent(
  client: PrismaClientType,
  requestId: string
) {
  const request = await client.projectExpenseRequest.findUniqueOrThrow({
    where: { id: requestId },
    select: {
      receiptConfirmedAt: true,
      receiptConfirmationIdempotencyKey: true
    }
  });
  assert(
    request.receiptConfirmedAt === null &&
      request.receiptConfirmationIdempotencyKey === null,
    "失败的收货事实必须整体回滚"
  );
}

async function expectDatabaseError(
  operation: () => Promise<unknown>,
  marker: string
) {
  try {
    await operation();
  } catch (error) {
    assert(
      String(error).includes(marker),
      `预期数据库错误 ${marker}，实际为 ${String(error)}`
    );
    return;
  }
  throw new Error(`预期数据库操作失败：${marker}`);
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function within<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = 5_000
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(label)),
          timeoutMs
        );
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
