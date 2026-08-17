import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { HttpException } from "@nestjs/common";
import {
  Prisma,
  PrismaClient,
  type PrismaClient as PrismaClientType
} from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { FileService } from "../file/file.service";
import { ProjectExpenseService } from "../project-expense/project-expense.service";
import { ProjectFundingAvailabilityService } from "../project-funding/project-funding-availability.service";

const DATABASE_NAME = "jiangkong_project_expense_execution_concurrency";
const EXPECTED_MIGRATION_COUNT = readdirSync(
  resolve(__dirname, "../../prisma/migrations"),
  { withFileTypes: true }
).filter((entry) => entry.isDirectory()).length;

describe("project expense execution PostgreSQL concurrency", () => {
  const integrationTest =
    process.env.RUN_PROJECT_EXPENSE_EXECUTION_CONCURRENCY === "1"
      ? it
      : it.skip;

  integrationTest(
    "keeps remaining amount, idempotency, voucher and funding facts atomic",
    async () => {
      const databaseUrl = assertDedicatedDatabase();
      const clients = [0, 1, 2].map(
        () =>
          new PrismaClient({
            datasources: { db: { url: databaseUrl } }
          })
      );
      const fixture = fixtureIds();
      const releaseGates: Array<Deferred<void>> = [];
      const pendingOperations: Array<Promise<unknown>> = [];

      try {
        await Promise.all(clients.map((client) => client.$connect()));
        await assertFullyMigrated(clients[2]!);
        await assertProjectExpenseExecutionSchema(clients[2]!);
        await seedFixture(clients[0]!, fixture);

        await verifyRemainingCompetition(
          clients,
          fixture,
          releaseGates,
          pendingOperations
        );
        await verifyIdempotentReplay(
          clients,
          fixture,
          releaseGates,
          pendingOperations
        );
        await verifyCrossProjectVoucherUniqueness(
          clients,
          fixture,
          releaseGates,
          pendingOperations
        );
        await verifySplitFunding(clients[0]!, fixture);
        await verifyFundingShortageZeroWrite(clients[0]!, fixture);
        await verifyClosedFactTrigger(clients[0]!, fixture);
        await assertProjectExpenseExecutionImmutable(
          clients[0]!,
          fixture.scenarios.remaining
        );
      } finally {
        for (const gate of releaseGates) gate.resolve(undefined);
        await Promise.allSettled(pendingOperations);
        await Promise.allSettled(
          clients.map((client) => client.$disconnect())
        );
      }
    },
    90_000
  );
});

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type AuditRecorder = {
  record(
    client: Parameters<AuditService["record"]>[0],
    input: Parameters<AuditService["record"]>[1]
  ): Promise<unknown>;
};

type Fixture = ReturnType<typeof fixtureIds>;
type Scenario = Fixture["scenarios"][keyof Fixture["scenarios"]];

function fixtureIds() {
  const prefix = `peec_${randomUUID().replace(/-/gu, "")}`;
  const scenario = (label: string) => ({
    label,
    projectId: `${prefix}_project_${label}`,
    requestId: `${prefix}_request_${label}`,
    receiptId: `${prefix}_receipt_${label}`,
    receiptVoucherId: `${prefix}_receipt_voucher_${label}`
  });
  return {
    prefix,
    actorUserId: `${prefix}_finance`,
    scenarios: {
      remaining: scenario("remaining"),
      replay: scenario("replay"),
      crossA: scenario("cross_a"),
      crossB: scenario("cross_b"),
      split: scenario("split"),
      shortage: scenario("shortage")
    },
    vouchers: {
      remainingA: `${prefix}_voucher_remaining_a`,
      remainingB: `${prefix}_voucher_remaining_b`,
      replay: `${prefix}_voucher_replay`,
      crossShared: `${prefix}_voucher_cross_shared`,
      split: `${prefix}_voucher_split`,
      shortage: `${prefix}_voucher_shortage`
    },
    splitQuotaId: `${prefix}_split_quota`,
    splitQuotaAttachmentId: `${prefix}_split_quota_attachment`
  };
}

function assertDedicatedDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || process.env.NODE_ENV === "production") {
    throw new Error("项目支出实付并发测试必须连接非生产隔离数据库");
  }
  const parsed = new URL(databaseUrl);
  if (!new Set(["postgresql:", "postgres:"]).has(parsed.protocol)) {
    throw new Error("项目支出实付并发测试只允许 PostgreSQL");
  }
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(parsed.hostname)) {
    throw new Error("项目支出实付并发测试只允许使用本机 PostgreSQL");
  }
  if (parsed.pathname !== `/${DATABASE_NAME}`) {
    throw new Error("项目支出实付并发测试只允许使用固定专用数据库");
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
    `项目支出实付并发测试要求完整 ${EXPECTED_MIGRATION_COUNT} 个迁移`
  );
}

async function assertProjectExpenseExecutionSchema(client: PrismaClientType) {
  const requiredIndexes = [
    "ProjectExpenseRequest_id_projectId_key",
    "ProjectFinancingQuota_id_projectId_key",
    "ProjectExpenseExecution_idempotencyKey_key",
    "ProjectExpenseExecution_voucherFileId_key"
  ];
  const indexes = await client.$queryRaw<Array<{ name: string }>>(Prisma.sql`
    SELECT indexname AS name
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname IN (
        'ProjectExpenseRequest_id_projectId_key',
        'ProjectFinancingQuota_id_projectId_key',
        'ProjectExpenseExecution_idempotencyKey_key',
        'ProjectExpenseExecution_voucherFileId_key'
      )
  `);
  const actualIndexes = new Set(indexes.map((index) => index.name));
  for (const index of requiredIndexes) {
    assert(actualIndexes.has(index), `项目支出实付并发测试缺少索引 ${index}`);
  }

  const requiredConstraints = [
    "ProjectExpenseExecution_request_fk",
    "ProjectExpenseExecution_project_fk",
    "ProjectExpenseExecution_voucher_file_fk",
    "ProjectExpenseExecution_executor_fk",
    "ProjectFundingAllocation_quota_project_fk",
    "ProjectFundingAllocation_project_expense_execution_guard",
    "ProjectExpenseExecution_amountCents_positive_check",
    "ProjectExpenseExecution_idempotency_key_format_check",
    "ProjectExpenseRequest_payment_status_amount_check",
    "ProjectExpenseRequest_paidAmountCents_nonnegative_check",
    "ProjectExpenseRequest_paidAmountCents_lte_approved_check"
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
      `项目支出实付并发测试要求约束 ${constraint} 已安装且 validated`
    );
  }

  const requiredTriggers = [
    "ProjectExpenseExecution_immutable",
    "ProjectExpenseExecution_closed_fact_guard",
    "ProjectFundingAllocation_project_expense_owner_guard",
    "ProjectFundingAllocation_project_expense_total_guard"
  ];
  const triggers = await client.$queryRaw<Array<{ name: string }>>(
    Prisma.sql`
      SELECT trigger.tgname AS name
      FROM pg_trigger trigger
      JOIN pg_class relation ON relation.oid = trigger.tgrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = current_schema()
        AND trigger.tgname IN (${Prisma.join(requiredTriggers)})
        AND NOT trigger.tgisinternal
    `
  );
  const actualTriggers = new Set(triggers.map((trigger) => trigger.name));
  for (const trigger of requiredTriggers) {
    assert(
      actualTriggers.has(trigger),
      `项目支出实付并发测试要求触发器 ${trigger} 已安装`
    );
  }
}

async function seedFixture(client: PrismaClientType, fixture: Fixture) {
  await client.user.create({
    data: {
      id: fixture.actorUserId,
      name: "项目支出实付并发验收财务人员",
      isActive: true,
      mustChangePassword: false
    }
  });
  for (const scenario of Object.values(fixture.scenarios)) {
    await client.project.create({
      data: {
        id: scenario.projectId,
        code: `${scenario.projectId}_code`,
        name: `项目支出实付并发验收 ${scenario.label}`
      }
    });
    await client.projectAffiliateAssignment.create({
      data: {
        id: `${scenario.projectId}_construction_enterprise`,
        projectId: scenario.projectId,
        businessPartyId: `${scenario.projectId}_party`,
        businessPartyVersionId: `${scenario.projectId}_party_version`,
        affiliateNameSnapshot: "项目支出实付并发验收施工企业",
        effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
        changeReason: "数据库测试夹具",
        assignedByUserId: fixture.actorUserId
      }
    });
    await client.projectMember.create({
      data: {
        projectId: scenario.projectId,
        userId: fixture.actorUserId,
        positionKey: "finance_staff"
      }
    });
    await client.fileObject.create({
      data: fileFact(
        scenario.receiptVoucherId,
        fixture.actorUserId,
        fixture.prefix
      )
    });
    await client.projectReceipt.create({
      data: {
        id: scenario.receiptId,
        projectId: scenario.projectId,
        receivedAt: new Date("2026-07-30T00:00:00.000Z"),
        amountCents:
          scenario.label === "shortage"
            ? 200n
            : scenario.label === "split"
              ? 300n
              : 1_000n,
        payerName: "项目业主",
        sourceType: "general_contractor_payment",
        voucherFileId: scenario.receiptVoucherId,
        recordedByUserId: fixture.actorUserId
      }
    });
    await client.projectExpenseRequest.create({
      data: {
        id: scenario.requestId,
        projectId: scenario.projectId,
        code: `${scenario.requestId}_code`,
        expenseType: "comprehensive_expense",
        expenseSubtype: "travel",
        paymentSubject: "项目支出实付并发验收",
        reason: "本地 PostgreSQL 16 并发验收",
        requestedAmountCents: 1_000n,
        approvedAmountCents: 1_000n,
        paidAmountCents: 0n,
        paymentMethod: "bank_transfer",
        handlerUserId: fixture.actorUserId,
        applicantUserId: fixture.actorUserId,
        status: "approved_pending_payment"
      }
    });
  }
  await client.fileObject.createMany({
    data: Object.values(fixture.vouchers).map((fileId) =>
      fileFact(fileId, fixture.actorUserId, fixture.prefix)
    )
  });
  await client.fileObject.create({
    data: fileFact(
      fixture.splitQuotaAttachmentId,
      fixture.actorUserId,
      fixture.prefix
    )
  });
  await client.projectFinancingQuota.create({
    data: {
      id: fixture.splitQuotaId,
      projectId: fixture.scenarios.split.projectId,
      amountCents: 700n,
      reason: "项目支出现金加垫资拆分验收",
      attachmentFileId: fixture.splitQuotaAttachmentId,
      attachmentFileSha256Snapshot: "a".repeat(64),
      requestedByUserId: fixture.actorUserId,
      requestedByRoleKey: "finance_staff",
      requestIdempotencyKey: randomUUID(),
      requestFingerprint: "b".repeat(64),
      approvedByUserId: fixture.actorUserId,
      approvedAt: new Date("2026-07-29T00:00:00.000Z"),
      status: "approved"
    }
  });
  await client.approvalInstance.create({
    data: {
      id: `${fixture.prefix}_split_quota_approval`,
      flowType: "project_financing_quota.approve",
      businessType: "project_financing_quota",
      businessId: fixture.splitQuotaId,
      status: "approved",
      currentNodeIndex: 2,
      frozenNodes: [
        {
          name: "财务主管",
          mode: "any",
          roleKeys: ["finance_director"],
          approvedRoleKeys: ["finance_director"]
        },
        {
          name: "董事长/总经理",
          mode: "any",
          roleKeys: ["chairman", "general_manager"],
          approvedRoleKeys: ["chairman"]
        }
      ],
      applicantUserId: fixture.actorUserId
    }
  });
}

function fileFact(fileId: string, actorUserId: string, prefix: string) {
  return {
    id: fileId,
    bucket: "local-private",
    objectKey: `${prefix}/${fileId}.pdf`,
    originalName: `${fileId}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 128,
    uploadedByUserId: actorUserId,
    contentSha256: "a".repeat(64),
    storageStatus: "active"
  };
}

async function verifyRemainingCompetition(
  clients: PrismaClient[],
  fixture: Fixture,
  releaseGates: Array<Deferred<void>>,
  pendingOperations: Array<Promise<unknown>>
) {
  const scenario = fixture.scenarios.remaining;
  const coordinates = await expenseCoordinates(clients[0]!, scenario.requestId);
  const firstPid = deferred<number>();
  const secondPid = deferred<number>();
  const entered = deferred<void>();
  const release = deferred<void>();
  releaseGates.push(release);
  const first = expenseService(clients[0]!, firstPid, pausingAudit(entered, release));
  const second = expenseService(clients[1]!, secondPid, new AuditService());
  const paidAt = new Date(Date.now() - 60_000).toISOString();
  const firstOperation = first.recordExecution(
    scenario.projectId,
    scenario.requestId,
    fixture.actorUserId,
    executionInput(
      coordinates.updatedAt,
      randomUUID(),
      "700",
      paidAt,
      fixture.vouchers.remainingA
    )
  );
  pendingOperations.push(firstOperation);
  await within(entered.promise, "remaining winner 未进入审计暂停点");
  const secondOperation = second.recordExecution(
    scenario.projectId,
    scenario.requestId,
    fixture.actorUserId,
    executionInput(
      coordinates.updatedAt,
      randomUUID(),
      "700",
      paidAt,
      fixture.vouchers.remainingB
    )
  );
  pendingOperations.push(secondOperation);
  await observeDirectBlock(
    clients[2]!,
    await within(firstPid.promise, "remaining winner PID 未捕获"),
    await within(secondPid.promise, "remaining loser PID 未捕获")
  );
  release.resolve(undefined);
  const results = await Promise.allSettled([firstOperation, secondOperation]);
  assert(results[0].status === "fulfilled", "remaining winner 必须成功");
  assert(
    results[1].status === "rejected" && conflictStatus(results[1]) === 409,
    `remaining loser 必须返回 409，实际 ${resultError(results[1])}`
  );
  const facts = await expenseFacts(clients[0]!, scenario);
  assert(
    facts.request?.status === "partially_paid" &&
      facts.request.paidAmountCents === 700n,
    "remaining competition 必须只累计一笔 700 分实付"
  );
  assertSingleWriteFacts(facts, "remaining competition");
}

async function verifyIdempotentReplay(
  clients: PrismaClient[],
  fixture: Fixture,
  releaseGates: Array<Deferred<void>>,
  pendingOperations: Array<Promise<unknown>>
) {
  const scenario = fixture.scenarios.replay;
  const coordinates = await expenseCoordinates(clients[0]!, scenario.requestId);
  const firstPid = deferred<number>();
  const secondPid = deferred<number>();
  const entered = deferred<void>();
  const release = deferred<void>();
  releaseGates.push(release);
  const first = expenseService(clients[0]!, firstPid, pausingAudit(entered, release));
  const second = expenseService(clients[1]!, secondPid, new AuditService());
  const input = executionInput(
    coordinates.updatedAt,
    randomUUID(),
    "400",
    new Date(Date.now() - 60_000).toISOString(),
    fixture.vouchers.replay
  );
  const firstOperation = first.recordExecution(
    scenario.projectId,
    scenario.requestId,
    fixture.actorUserId,
    input
  );
  pendingOperations.push(firstOperation);
  await within(entered.promise, "same-key winner 未进入审计暂停点");
  const secondOperation = second.recordExecution(
    scenario.projectId,
    scenario.requestId,
    fixture.actorUserId,
    input
  );
  pendingOperations.push(secondOperation);
  await observeDirectBlock(
    clients[2]!,
    await within(firstPid.promise, "same-key winner PID 未捕获"),
    await within(secondPid.promise, "same-key replay PID 未捕获")
  );
  release.resolve(undefined);
  const results = await Promise.allSettled([firstOperation, secondOperation]);
  assert(
    results[0].status === "fulfilled" && results[1].status === "fulfilled",
    `same-key 两次调用必须都成功，实际 ${resultError(results[0])}/${resultError(results[1])}`
  );
  assert(
    resultId(results[0]) === resultId(results[1]),
    "same-key replay 必须返回同一 ProjectExpenseExecution"
  );
  assertSingleWriteFacts(
    await expenseFacts(clients[0]!, scenario),
    "same-key replay"
  );
}

async function verifyCrossProjectVoucherUniqueness(
  clients: PrismaClient[],
  fixture: Fixture,
  releaseGates: Array<Deferred<void>>,
  pendingOperations: Array<Promise<unknown>>
) {
  const firstScenario = fixture.scenarios.crossA;
  const secondScenario = fixture.scenarios.crossB;
  const [firstCoordinates, secondCoordinates] = await Promise.all([
    expenseCoordinates(clients[0]!, firstScenario.requestId),
    expenseCoordinates(clients[0]!, secondScenario.requestId)
  ]);
  const firstPid = deferred<number>();
  const secondPid = deferred<number>();
  const entered = deferred<void>();
  const release = deferred<void>();
  releaseGates.push(release);
  const first = expenseService(clients[0]!, firstPid, pausingAudit(entered, release));
  const second = expenseService(clients[1]!, secondPid, new AuditService());
  const paidAt = new Date(Date.now() - 60_000).toISOString();
  const firstOperation = first.recordExecution(
    firstScenario.projectId,
    firstScenario.requestId,
    fixture.actorUserId,
    executionInput(
      firstCoordinates.updatedAt,
      randomUUID(),
      "300",
      paidAt,
      fixture.vouchers.crossShared
    )
  );
  pendingOperations.push(firstOperation);
  await within(entered.promise, "cross-project winner 未进入审计暂停点");
  const secondOperation = second.recordExecution(
    secondScenario.projectId,
    secondScenario.requestId,
    fixture.actorUserId,
    executionInput(
      secondCoordinates.updatedAt,
      randomUUID(),
      "300",
      paidAt,
      fixture.vouchers.crossShared
    )
  );
  pendingOperations.push(secondOperation);
  await observeDirectBlock(
    clients[2]!,
    await within(firstPid.promise, "cross-project winner PID 未捕获"),
    await within(secondPid.promise, "cross-project loser PID 未捕获")
  );
  release.resolve(undefined);
  const results = await Promise.allSettled([firstOperation, secondOperation]);
  assert(results[0].status === "fulfilled", "cross-project winner 必须成功");
  assert(
    results[1].status === "rejected" && conflictStatus(results[1]) === 409,
    `cross-project loser 必须返回 409，实际 ${resultError(results[1])}`
  );
  assertSingleWriteFacts(
    await expenseFacts(clients[0]!, firstScenario),
    "cross-project winner"
  );
  assertZeroWriteFacts(
    await expenseFacts(clients[0]!, secondScenario),
    "cross-project loser"
  );
  assert(
    (await clients[0]!.projectExpenseExecution.count({
      where: { voucherFileId: fixture.vouchers.crossShared }
    })) === 1,
    "跨项目同一凭证只能绑定一条项目支出实付"
  );
}

async function verifyFundingShortageZeroWrite(
  client: PrismaClient,
  fixture: Fixture
) {
  const scenario = fixture.scenarios.shortage;
  const coordinates = await expenseCoordinates(client, scenario.requestId);
  const service = expenseService(client, deferred<number>(), new AuditService());
  const error = await service
    .recordExecution(
      scenario.projectId,
      scenario.requestId,
      fixture.actorUserId,
      executionInput(
        coordinates.updatedAt,
        randomUUID(),
        "500",
        new Date(Date.now() - 60_000).toISOString(),
        fixture.vouchers.shortage
      )
    )
    .then(
      () => null,
      (caught: unknown) => caught
    );
  assert(
    errorText(error).includes(
      "项目可用资金不足，当前最多可实际支付 200 分"
    ),
    `资金不足必须返回稳定业务错误，实际 ${errorText(error)}`
  );
  assertZeroWriteFacts(await expenseFacts(client, scenario), "funding shortage");
}

async function verifySplitFunding(
  client: PrismaClient,
  fixture: Fixture
) {
  const scenario = fixture.scenarios.split;
  const coordinates = await expenseCoordinates(client, scenario.requestId);
  const service = expenseService(client, deferred<number>(), new AuditService());
  await service.recordExecution(
    scenario.projectId,
    scenario.requestId,
    fixture.actorUserId,
    executionInput(
      coordinates.updatedAt,
      randomUUID(),
      "1000",
      new Date(Date.now() - 60_000).toISOString(),
      fixture.vouchers.split
    )
  );
  const facts = await expenseFacts(client, scenario);
  assert(facts.executionCount === 1, "split funding 必须只有一条实付");
  assert(facts.auditCount === 1, "split funding 必须只有一条审计");
  assert(
    facts.request?.status === "paid" &&
      facts.request.paidAmountCents === 1_000n,
    "split funding 必须把父级准确更新为已支付 1000 分"
  );
  assert(facts.allocationCount === 2, "split funding 必须生成两条资金分配");
  const allocations = await client.projectFundingAllocation.findMany({
    where: {
      executionType: "project_expense_execution",
      businessId: scenario.requestId,
      direction: "debit"
    },
    orderBy: { sourceType: "asc" },
    select: {
      sourceType: true,
      sourceId: true,
      amountCents: true
    }
  });
  const financing = allocations.find(
    (allocation) => allocation.sourceType === "financing_quota"
  );
  const cash = allocations.find(
    (allocation) => allocation.sourceType === "project_cash"
  );
  assert(
    cash?.amountCents === 300n &&
      cash.sourceId === null &&
      financing?.amountCents === 700n &&
      financing.sourceId === fixture.splitQuotaId,
    "split funding 必须先用 300 分项目现金，再用本项目 700 分垫资额度"
  );
}

async function verifyClosedFactTrigger(
  client: PrismaClient,
  fixture: Fixture
) {
  const scenario = fixture.scenarios.shortage;
  let failure;
  try {
    await client.projectExpenseExecution.create({
      data: {
        idempotencyKey: randomUUID(),
        projectExpenseRequestId: scenario.requestId,
        projectId: scenario.projectId,
        amountCents: 1n,
        paidAt: new Date(Date.now() - 60_000),
        executedByUserId: fixture.actorUserId,
        voucherFileId: fixture.vouchers.shortage
      }
    });
  } catch (error) {
    failure = error;
  }
  assert(
    failure &&
      String(failure).includes(
        "project_expense_execution_closed_fact_mismatch"
      ),
    "缺少父级累计、资金分配和审计的直接实付必须在提交时失败"
  );
  assertZeroWriteFacts(
    await expenseFacts(client, scenario),
    "closed fact trigger"
  );
}

async function assertProjectExpenseExecutionImmutable(
  client: PrismaClientType,
  scenario: Scenario
) {
  const before = await client.projectExpenseExecution.findFirstOrThrow({
    where: { projectExpenseRequestId: scenario.requestId },
    select: { id: true, amountCents: true }
  });
  await expectImmutableMutationFailure(
    () =>
      client.$executeRawUnsafe(
        `UPDATE "ProjectExpenseExecution" SET "amountCents" = "amountCents" + 1 WHERE "id" = $1`,
        before.id
      ),
    "project_expense_execution_immutable_update"
  );
  await expectImmutableMutationFailure(
    () =>
      client.$executeRawUnsafe(
        `DELETE FROM "ProjectExpenseExecution" WHERE "id" = $1`,
        before.id
      ),
    "project_expense_execution_immutable_delete"
  );
}

async function expectImmutableMutationFailure(
  mutation: () => Promise<unknown>,
  marker: string
) {
  let failure;
  try {
    await mutation();
  } catch (error) {
    failure = error;
  }
  assert(
    failure && String(failure).includes(marker),
    `项目支出实付非法变更必须以 ${marker} 拒绝`
  );
}

function expenseService(
  client: PrismaClient,
  backendPid: Deferred<number>,
  audit: AuditRecorder
) {
  const transactionPrisma = {
    projectExpenseExecution: client.projectExpenseExecution,
    projectExpenseRequest: client.projectExpenseRequest,
    $transaction: <T>(
      operation: (tx: Prisma.TransactionClient) => Promise<T>,
      options?: {
        isolationLevel?: Prisma.TransactionIsolationLevel;
        maxWait?: number;
        timeout?: number;
      }
    ) =>
      client.$transaction(
        async (tx) => {
          const [connection] = await tx.$queryRaw<Array<{ pid: number }>>(
            Prisma.sql`SELECT pg_backend_pid()::int AS pid`
          );
          if (connection) backendPid.resolve(connection.pid);
          return operation(tx);
        },
        { ...(options ?? {}), maxWait: 10_000, timeout: 20_000 }
      )
  };
  const files = new FileService(client as never, audit as never);
  return new ProjectExpenseService(
    transactionPrisma as never,
    audit as never,
    { confirmPassword: async () => undefined } as never,
    files,
    new ProjectFundingAvailabilityService()
  );
}

function pausingAudit(
  entered: Deferred<void>,
  release: Deferred<void>
): AuditRecorder {
  const persistedAudit = new AuditService();
  let paused = false;
  return {
    record: async (tx, input) => {
      const result = await persistedAudit.record(tx, input);
      if (input.action === "project_expense.execution.record" && !paused) {
        paused = true;
        entered.resolve(undefined);
        await release.promise;
      }
      return result;
    }
  };
}

function executionInput(
  expectedExpenseUpdatedAt: string,
  idempotencyKey: string,
  amountCents: string,
  paidAt: string,
  voucherFileId: string
) {
  return {
    expectedExpenseUpdatedAt,
    idempotencyKey,
    amountCents,
    paidAt,
    voucherFileId,
    confirmationPassword: "local-concurrency-confirmation"
  } as never;
}

async function expenseCoordinates(
  client: PrismaClientType,
  requestId: string
) {
  const request = await client.projectExpenseRequest.findUnique({
    where: { id: requestId },
    select: { updatedAt: true }
  });
  if (!request) throw new Error(`未找到项目支出并发夹具 ${requestId}`);
  return { updatedAt: request.updatedAt.toISOString() };
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
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error(
    `未观察到 backend ${blockedPid} 被 ${blockerPid} 直接阻塞；最接近快照 ${JSON.stringify(bestSnapshot)}`
  );
}

async function expenseFacts(client: PrismaClientType, scenario: Scenario) {
  const [
    request,
    executionCount,
    allocationCount,
    allocations,
    auditCount
  ] = await Promise.all([
    client.projectExpenseRequest.findUnique({
      where: { id: scenario.requestId },
      select: { status: true, paidAmountCents: true }
    }),
    client.projectExpenseExecution.count({
      where: { projectExpenseRequestId: scenario.requestId }
    }),
    client.projectFundingAllocation.count({
      where: {
        executionType: "project_expense_execution",
        businessId: scenario.requestId,
        direction: "debit"
      }
    }),
    client.projectFundingAllocation.findMany({
      where: {
        executionType: "project_expense_execution",
        businessId: scenario.requestId,
        direction: "debit"
      },
      select: { amountCents: true }
    }),
    client.auditLog.count({
      where: {
        action: "project_expense.execution.record",
        businessType: "project_expense_request",
        businessId: scenario.requestId
      }
    })
  ]);
  return {
    request,
    executionCount,
    allocationCount,
    allocations,
    auditCount
  };
}

function assertSingleWriteFacts(
  facts: Awaited<ReturnType<typeof expenseFacts>>,
  label: string
) {
  assert(facts.executionCount === 1, `${label} 必须只有一条实付`);
  assert(facts.allocationCount === 1, `${label} 必须只有一条资金分配`);
  assert(facts.auditCount === 1, `${label} 必须只有一条审计`);
  assert(
    facts.allocations.reduce((sum, row) => sum + row.amountCents, 0n) ===
      facts.request?.paidAmountCents,
    `${label} 资金分配必须等于父级已付金额`
  );
}

function assertZeroWriteFacts(
  facts: Awaited<ReturnType<typeof expenseFacts>>,
  label: string
) {
  assert(facts.executionCount === 0, `${label} 不得写实付`);
  assert(facts.allocationCount === 0, `${label} 不得写资金分配`);
  assert(facts.auditCount === 0, `${label} 不得写审计`);
  assert(
    facts.request?.status === "approved_pending_payment" &&
      facts.request.paidAmountCents === 0n,
    `${label} 父级必须保持待支付且零已付`
  );
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function within<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 10_000);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function conflictStatus(result: PromiseRejectedResult) {
  const reason = result.reason as Partial<HttpException>;
  return typeof reason?.getStatus === "function" ? reason.getStatus() : null;
}

function resultId(result: PromiseSettledResult<unknown>) {
  if (result.status !== "fulfilled" || !result.value) return null;
  return (result.value as { id?: string }).id ?? null;
}

function resultError(result: PromiseSettledResult<unknown>) {
  return result.status === "rejected" ? errorText(result.reason) : "fulfilled";
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
