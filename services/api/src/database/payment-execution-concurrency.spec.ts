import { randomUUID } from "node:crypto";
import type { HttpException } from "@nestjs/common";
import {
  Prisma,
  PrismaClient,
  type PrismaClient as PrismaClientType
} from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { FileService } from "../file/file.service";
import { PaymentAmountService } from "../payment/payment-amount.service";
import { PaymentRequestService } from "../payment/payment-request.service";
import { ProjectFundingAvailabilityService } from "../project-funding/project-funding-availability.service";

const DATABASE_NAME = "jiangkong_payment_execution_concurrency";
const EXPECTED_MIGRATION_COUNT = 131;
const COMPANY_ENTITY_ID = "payment-execution-company";
const COMPANY_ENTITY_NAME = "付款实付并发验收建设有限公司";
const COMPANY_ENTITY_CREDIT_CODE = "91310000PAYEXEC0001";

describe("payment execution PostgreSQL concurrency", () => {
  const integrationTest =
    process.env.RUN_PAYMENT_EXECUTION_CONCURRENCY === "1" ? it : it.skip;

  integrationTest(
    "keeps remaining amount, idempotency, voucher and funding facts atomic on the fully migrated schema",
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
        await assertPaymentExecutionSchema(clients[2]!);
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
        await verifyFundingShortageZeroWrite(clients[0]!, fixture);
        await assertPaymentExecutionImmutable(
          clients[0]!,
          fixture.scenarios.remaining
        );
      } finally {
        for (const gate of releaseGates) gate.resolve(undefined);
        await Promise.allSettled(pendingOperations);
        await cleanupFixture(clients[0]!, fixture).catch(() => undefined);
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
  const prefix = `pec_${randomUUID().replace(/-/gu, "")}`;
  const scenario = (label: string) => ({
    label,
    projectId: `${prefix}_project_${label}`,
    contractId: `${prefix}_contract_${label}`,
    contractVersionId: `${prefix}_version_${label}`,
    paymentTermsVersionId: `${prefix}_terms_${label}`,
    settlementId: `${prefix}_settlement_${label}`,
    paymentId: `${prefix}_payment_${label}`,
    receiptId: `${prefix}_receipt_${label}`
  });
  return {
    prefix,
    actorUserId: `${prefix}_finance`,
    scenarios: {
      remaining: scenario("remaining"),
      replay: scenario("replay"),
      crossA: scenario("cross_a"),
      crossB: scenario("cross_b"),
      shortage: scenario("shortage")
    },
    vouchers: {
      remainingA: `${prefix}_voucher_remaining_a`,
      remainingB: `${prefix}_voucher_remaining_b`,
      replay: `${prefix}_voucher_replay`,
      crossShared: `${prefix}_voucher_cross_shared`,
      shortage: `${prefix}_voucher_shortage`
    }
  };
}

function assertDedicatedDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || process.env.NODE_ENV === "production") {
    throw new Error("付款实付并发测试必须连接非生产隔离数据库");
  }
  const parsed = new URL(databaseUrl);
  if (!["postgresql:", "postgres:"].includes(parsed.protocol)) {
    throw new Error("付款实付并发测试只允许 PostgreSQL");
  }
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(parsed.hostname)) {
    throw new Error("付款实付并发测试只允许使用本机 PostgreSQL");
  }
  if (parsed.pathname !== `/${DATABASE_NAME}`) {
    throw new Error("付款实付并发测试只允许使用固定专用数据库");
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
      `付款实付并发测试要求完整 ${EXPECTED_MIGRATION_COUNT} 个迁移`
    );
  }
}

async function assertPaymentExecutionSchema(client: PrismaClientType) {
  const requiredIndexes = [
    "PaymentExecution_idempotencyKey_key",
    "PaymentExecution_voucherFileId_key"
  ];
  const indexes = await client.$queryRaw<Array<{ indexname: string }>>(
    Prisma.sql`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname IN (
          'PaymentExecution_idempotencyKey_key',
          'PaymentExecution_voucherFileId_key'
        )
    `
  );
  const actualIndexes = new Set(indexes.map((index) => index.indexname));
  for (const index of requiredIndexes) {
    if (!actualIndexes.has(index)) {
      throw new Error(`付款实付并发测试缺少索引 ${index}`);
    }
  }

  const requiredConstraints = [
    "PaymentExecution_request_fk",
    "PaymentExecution_settlement_fk",
    "PaymentExecution_voucher_file_fk",
    "PaymentExecution_amount_positive_check",
    "PaymentExecution_company_payer_snapshot_check",
    "PaymentExecution_idempotency_key_format_check",
    "PaymentRequest_payment_status_amount_check",
    "PaymentRequest_paid_nonnegative_check",
    "PaymentRequest_paid_lte_approved_check",
    "Settlement_payment_status_amount_check",
    "Settlement_paid_nonnegative_check",
    "Settlement_paid_lte_payable_check"
  ];
  const constraints = await client.$queryRaw<
    Array<{ name: string; validated: boolean }>
  >(Prisma.sql`
    SELECT conname AS name, convalidated AS validated
    FROM pg_constraint
    WHERE conname IN (
      'PaymentExecution_request_fk',
      'PaymentExecution_settlement_fk',
      'PaymentExecution_voucher_file_fk',
      'PaymentExecution_amount_positive_check',
      'PaymentExecution_company_payer_snapshot_check',
      'PaymentExecution_idempotency_key_format_check',
      'PaymentRequest_payment_status_amount_check',
      'PaymentRequest_paid_nonnegative_check',
      'PaymentRequest_paid_lte_approved_check',
      'Settlement_payment_status_amount_check',
      'Settlement_paid_nonnegative_check',
      'Settlement_paid_lte_payable_check'
    )
  `);
  const constraintByName = new Map(
    constraints.map((constraint) => [constraint.name, constraint.validated])
  );
  for (const constraint of requiredConstraints) {
    if (constraintByName.get(constraint) !== true) {
      throw new Error(
        `付款实付并发测试要求约束 ${constraint} 已安装且 validated`
      );
    }
  }

  const notNullColumns = await client.$queryRaw<Array<{ name: string }>>(
    Prisma.sql`
      SELECT attribute.attname AS name
      FROM pg_attribute attribute
      JOIN pg_class relation ON relation.oid = attribute.attrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = current_schema()
        AND relation.relname = 'PaymentExecution'
        AND attribute.attname IN (
          'idempotencyKey',
          'companyEntityIdSnapshot',
          'companyEntityNameSnapshot',
          'companyEntityCreditCodeSnapshot'
        )
        AND attribute.attnotnull
        AND NOT attribute.attisdropped
    `
  );
  if (notNullColumns.length !== 4) {
    throw new Error("付款实付并发测试要求幂等键与三项付款主体快照均为 NOT NULL");
  }

  const immutableTrigger = await client.$queryRaw<
    Array<{ name: string }>
  >(Prisma.sql`
    SELECT trigger.tgname AS name
    FROM pg_trigger trigger
    JOIN pg_class relation ON relation.oid = trigger.tgrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = current_schema()
      AND relation.relname = 'PaymentExecution'
      AND trigger.tgname = 'PaymentExecution_immutable'
      AND NOT trigger.tgisinternal
  `);
  if (immutableTrigger.length !== 1) {
    throw new Error("付款实付并发测试要求 PaymentExecution 不可变触发器已安装");
  }
}

async function assertPaymentExecutionImmutable(
  client: PrismaClientType,
  scenario: Scenario
) {
  const before = await client.paymentExecution.findFirstOrThrow({
    where: { paymentRequestId: scenario.paymentId },
    select: { id: true, amountCents: true }
  });
  await expectImmutableMutationFailure(
    () =>
      client.$executeRawUnsafe(
        `UPDATE "PaymentExecution" SET "amountCents" = "amountCents" + 1 WHERE "id" = $1`,
        before.id
      ),
    "payment_execution_immutable_update"
  );
  await expectImmutableMutationFailure(
    () =>
      client.$executeRawUnsafe(
        `DELETE FROM "PaymentExecution" WHERE "id" = $1`,
        before.id
      ),
    "payment_execution_immutable_delete"
  );
  const after = await client.paymentExecution.findUnique({
    where: { id: before.id },
    select: { amountCents: true }
  });
  assert(
    after?.amountCents === before.amountCents,
    "PaymentExecution UPDATE/DELETE 拒绝后原始金额事实必须保留"
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
    `PaymentExecution 非法变更必须以 ${marker} 拒绝`
  );
}

async function seedFixture(client: PrismaClientType, fixture: Fixture) {
  await client.user.create({
    data: {
      id: fixture.actorUserId,
      name: "付款实付并发验收财务人员",
      isActive: true,
      mustChangePassword: false
    }
  });
  await client.companyEntity.create({
    data: {
      id: COMPANY_ENTITY_ID,
      name: COMPANY_ENTITY_NAME,
      unifiedSocialCreditCode: COMPANY_ENTITY_CREDIT_CODE,
      dataStatus: "complete",
      currentVersionNo: 1,
      isActive: true
    }
  });

  for (const scenario of Object.values(fixture.scenarios)) {
    const cashAmountCents = scenario.label === "shortage" ? 200n : 1_000n;
    await seedScenario(
      client,
      fixture.actorUserId,
      scenario,
      cashAmountCents
    );
  }

  await client.fileObject.createMany({
    data: Object.values(fixture.vouchers).map((fileId) => ({
      id: fileId,
      bucket: "local-private",
      objectKey: `${fixture.prefix}/${fileId}.pdf`,
      originalName: `${fileId}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 128,
      uploadedByUserId: fixture.actorUserId,
      contentSha256: "a".repeat(64),
      storageStatus: "active"
    }))
  });
}

async function seedScenario(
  client: PrismaClientType,
  actorUserId: string,
  scenario: Scenario,
  cashAmountCents: bigint
) {
  await client.project.create({
    data: {
      id: scenario.projectId,
      code: `${scenario.projectId}_code`,
      name: `付款实付并发验收项目 ${scenario.label}`
    }
  });
  await client.projectAffiliateAssignment.create({
    data: {
      id: `${scenario.projectId}_construction_enterprise`,
      projectId: scenario.projectId,
      businessPartyId: `${scenario.projectId}_party`,
      businessPartyVersionId: `${scenario.projectId}_party_version`,
      affiliateNameSnapshot: "付款实付并发验收施工企业",
      effectiveFrom: new Date("2020-01-01T00:00:00.000Z"),
      changeReason: "数据库测试夹具",
      assignedByUserId: actorUserId
    }
  });
  await client.projectMember.create({
    data: {
      projectId: scenario.projectId,
      userId: actorUserId,
      positionKey: "finance_staff"
    }
  });
  await client.contract.create({
    data: {
      id: scenario.contractId,
      projectId: scenario.projectId,
      code: `${scenario.contractId}_code`,
      name: `付款实付并发验收合同 ${scenario.label}`,
      counterparty: "付款实付并发验收相对方",
      companyEntityId: COMPANY_ENTITY_ID,
      companyEntityName: COMPANY_ENTITY_NAME,
      contractTypeKey: "material_purchase",
      ownerUserId: actorUserId
    }
  });
  await client.contractVersion.create({
    data: {
      id: scenario.contractVersionId,
      contractId: scenario.contractId,
      versionNo: 1,
      changeType: "original",
      status: "effective",
      amountCents: 10_000n,
      effectiveAt: new Date("2026-07-01T00:00:00.000Z"),
      signingSubjectType: "our_company",
      companyEntityIdSnapshot: COMPANY_ENTITY_ID,
      companyEntityNameSnapshot: COMPANY_ENTITY_NAME,
      companyEntityCreditCodeSnapshot: COMPANY_ENTITY_CREDIT_CODE,
      draftData: {},
      templateSnapshot: {},
      clauseSnapshot: {}
    }
  });
  await client.paymentTermsVersion.create({
    data: {
      id: scenario.paymentTermsVersionId,
      contractId: scenario.contractId,
      contractVersionId: scenario.contractVersionId,
      versionNo: 1,
      status: "effective",
      originalText: "付款实付并发验收付款条款"
    }
  });
  await client.settlement.create({
    data: {
      id: scenario.settlementId,
      projectId: scenario.projectId,
      contractId: scenario.contractId,
      contractVersionId: scenario.contractVersionId,
      paymentTermsVersionId: scenario.paymentTermsVersionId,
      code: `${scenario.settlementId}_code`,
      periodLabel: "2026-07",
      status: "effective",
      amountCents: 1_000n,
      payableAmountCents: 1_000n,
      paidAmountCents: 0n
    }
  });
  await client.paymentRequest.create({
    data: {
      id: scenario.paymentId,
      projectId: scenario.projectId,
      settlementId: scenario.settlementId,
      sourceType: "settlement",
      contractId: scenario.contractId,
      contractVersionId: scenario.contractVersionId,
      paymentTermsVersionId: scenario.paymentTermsVersionId,
      paymentTermsStageId: null,
      code: `${scenario.paymentId}_code`,
      status: "approved_pending_payment",
      requestedAmountCents: 1_000n,
      approvedAmountCents: 1_000n,
      paidAmountCents: 0n,
      paymentSubjectType: "our_company"
    }
  });
  await client.projectReceipt.create({
    data: {
      id: scenario.receiptId,
      projectId: scenario.projectId,
      receivedAt: new Date("2026-07-01T00:00:00.000Z"),
      amountCents: cashAmountCents,
      payerName: "付款实付并发验收建设单位",
      sourceType: "general_contractor_payment",
      voucherFileId: `${scenario.receiptId}_voucher`,
      recordedByUserId: actorUserId
    }
  });
}

async function verifyRemainingCompetition(
  clients: PrismaClient[],
  fixture: Fixture,
  releaseGates: Array<Deferred<void>>,
  pendingOperations: Array<Promise<unknown>>
) {
  const scenario = fixture.scenarios.remaining;
  const payment = await paymentCoordinates(clients[0]!, scenario.paymentId);
  const firstPid = deferred<number>();
  const secondPid = deferred<number>();
  const firstAuditEntered = deferred();
  const releaseFirstAudit = deferred();
  releaseGates.push(releaseFirstAudit);
  const firstService = paymentService(
    clients[0]!,
    firstPid,
    pausingAudit(firstAuditEntered, releaseFirstAudit)
  );
  const secondService = paymentService(
    clients[1]!,
    secondPid,
    new AuditService()
  );
  const paidAt = new Date(Date.now() - 60_000).toISOString();
  const firstOperation = firstService.recordExecution(
    scenario.paymentId,
    fixture.actorUserId,
    executionInput(
      payment.updatedAt,
      randomUUID(),
      "700",
      paidAt,
      fixture.vouchers.remainingA
    )
  );
  pendingOperations.push(firstOperation);
  await within(firstAuditEntered.promise, "remaining winner 未进入审计暂停点");
  const secondOperation = secondService.recordExecution(
    scenario.paymentId,
    fixture.actorUserId,
    executionInput(
      payment.updatedAt,
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
  releaseFirstAudit.resolve(undefined);
  const results = await Promise.allSettled([
    firstOperation,
    secondOperation
  ]);

  assert(results[0].status === "fulfilled", "remaining winner 必须成功");
  assert(
    results[1].status === "rejected" &&
      conflictStatus(results[1]) === 409,
    `remaining competition loser 必须返回 409，实际 ${resultError(results[1])}`
  );
  const facts = await paymentFacts(clients[0]!, scenario);
  assert(
    facts.payment?.status === "partially_paid" &&
      facts.payment.paidAmountCents === 700n,
    "remaining competition 必须只累计一笔 700 分实付"
  );
  assert(
    facts.settlement?.status === "partially_paid" &&
      facts.settlement.paidAmountCents === 700n,
    "remaining competition 必须只累计一笔结算实付"
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
  const payment = await paymentCoordinates(clients[0]!, scenario.paymentId);
  const firstPid = deferred<number>();
  const secondPid = deferred<number>();
  const firstAuditEntered = deferred();
  const releaseFirstAudit = deferred();
  releaseGates.push(releaseFirstAudit);
  const firstService = paymentService(
    clients[0]!,
    firstPid,
    pausingAudit(firstAuditEntered, releaseFirstAudit)
  );
  const secondService = paymentService(
    clients[1]!,
    secondPid,
    new AuditService()
  );
  const input = executionInput(
    payment.updatedAt,
    randomUUID(),
    "400",
    new Date(Date.now() - 60_000).toISOString(),
    fixture.vouchers.replay
  );
  const firstOperation = firstService.recordExecution(
    scenario.paymentId,
    fixture.actorUserId,
    input
  );
  pendingOperations.push(firstOperation);
  await within(firstAuditEntered.promise, "same-key winner 未进入审计暂停点");
  const secondOperation = secondService.recordExecution(
    scenario.paymentId,
    fixture.actorUserId,
    input
  );
  pendingOperations.push(secondOperation);
  await observeDirectBlock(
    clients[2]!,
    await within(firstPid.promise, "same-key winner PID 未捕获"),
    await within(secondPid.promise, "same-key replay PID 未捕获")
  );
  releaseFirstAudit.resolve(undefined);
  const results = await Promise.allSettled([
    firstOperation,
    secondOperation
  ]);

  assert(
    results[0].status === "fulfilled" &&
      results[1].status === "fulfilled",
    `same-key 两次调用必须都成功，实际 ${resultError(results[0])}/${resultError(results[1])}`
  );
  const firstId = resultId(results[0]);
  const secondId = resultId(results[1]);
  assert(
    firstId && firstId === secondId,
    "same-key replay 必须返回同一 PaymentExecution"
  );
  const facts = await paymentFacts(clients[0]!, scenario);
  assert(
    facts.payment?.status === "partially_paid" &&
      facts.payment.paidAmountCents === 400n,
    "same-key replay 不得重复累计付款申请实付金额"
  );
  assert(
    facts.settlement?.status === "partially_paid" &&
      facts.settlement.paidAmountCents === 400n,
    "same-key replay 不得重复累计结算实付金额"
  );
  assertSingleWriteFacts(facts, "same-key replay");
}

async function verifyCrossProjectVoucherUniqueness(
  clients: PrismaClient[],
  fixture: Fixture,
  releaseGates: Array<Deferred<void>>,
  pendingOperations: Array<Promise<unknown>>
) {
  const firstScenario = fixture.scenarios.crossA;
  const secondScenario = fixture.scenarios.crossB;
  const [firstPayment, secondPayment] = await Promise.all([
    paymentCoordinates(clients[0]!, firstScenario.paymentId),
    paymentCoordinates(clients[0]!, secondScenario.paymentId)
  ]);
  const firstPid = deferred<number>();
  const secondPid = deferred<number>();
  const firstAuditEntered = deferred();
  const releaseFirstAudit = deferred();
  releaseGates.push(releaseFirstAudit);
  const firstService = paymentService(
    clients[0]!,
    firstPid,
    pausingAudit(firstAuditEntered, releaseFirstAudit)
  );
  const secondService = paymentService(
    clients[1]!,
    secondPid,
    new AuditService()
  );
  const paidAt = new Date(Date.now() - 60_000).toISOString();
  const firstOperation = firstService.recordExecution(
    firstScenario.paymentId,
    fixture.actorUserId,
    executionInput(
      firstPayment.updatedAt,
      randomUUID(),
      "300",
      paidAt,
      fixture.vouchers.crossShared
    )
  );
  pendingOperations.push(firstOperation);
  await within(firstAuditEntered.promise, "cross-project winner 未进入审计暂停点");
  const secondOperation = secondService.recordExecution(
    secondScenario.paymentId,
    fixture.actorUserId,
    executionInput(
      secondPayment.updatedAt,
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
  releaseFirstAudit.resolve(undefined);
  const results = await Promise.allSettled([
    firstOperation,
    secondOperation
  ]);

  assert(results[0].status === "fulfilled", "cross-project winner 必须成功");
  assert(
    results[1].status === "rejected" &&
      conflictStatus(results[1]) === 409,
    `cross-project same voucher loser 必须返回 409，实际 ${resultError(results[1])}`
  );
  const firstFacts = await paymentFacts(clients[0]!, firstScenario);
  const secondFacts = await paymentFacts(clients[0]!, secondScenario);
  assertSingleWriteFacts(firstFacts, "cross-project winner");
  assertZeroWriteFacts(secondFacts, "cross-project loser");
  assert(
    await clients[0]!.paymentExecution.count({
      where: { voucherFileId: fixture.vouchers.crossShared }
    }) === 1,
    "跨项目同一付款凭证全库只能绑定一条实付事实"
  );
}

async function verifyFundingShortageZeroWrite(
  client: PrismaClient,
  fixture: Fixture
) {
  const scenario = fixture.scenarios.shortage;
  const payment = await paymentCoordinates(client, scenario.paymentId);
  const service = paymentService(
    client,
    deferred<number>(),
    new AuditService()
  );
  const error = await service
    .recordExecution(
      scenario.paymentId,
      fixture.actorUserId,
      executionInput(
        payment.updatedAt,
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
  assertZeroWriteFacts(
    await paymentFacts(client, scenario),
    "funding shortage"
  );
}

function paymentService(
  client: PrismaClient,
  backendPid: Deferred<number>,
  audit: AuditRecorder
) {
  const transactionPrisma = {
    paymentExecution: client.paymentExecution,
    paymentRequest: client.paymentRequest,
    contractVersion: client.contractVersion,
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
        {
          ...(options ?? {}),
          maxWait: 10_000,
          timeout: 20_000
        }
      )
  };
  const files = new FileService(
    client as never,
    audit as never
  );
  const projectFunding = new ProjectFundingAvailabilityService();
  return new PaymentRequestService(
    new PaymentAmountService(),
    transactionPrisma as never,
    audit as never,
    files,
    {
      confirmPassword: async () => undefined
    } as never,
    undefined,
    undefined,
    projectFunding
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
      if (
        input.action === "payment.execution.record" &&
        !paused
      ) {
        paused = true;
        entered.resolve(undefined);
        await release.promise;
      }
      return result;
    }
  };
}

function executionInput(
  expectedPaymentUpdatedAt: string,
  idempotencyKey: string,
  amountCents: string,
  paidAt: string,
  voucherFileId: string
) {
  return {
    expectedPaymentUpdatedAt,
    idempotencyKey,
    amountCents,
    paidAt,
    voucherFileId,
    confirmationPassword: "local-concurrency-confirmation"
  };
}

async function paymentCoordinates(
  client: PrismaClientType,
  paymentId: string
) {
  const payment = await client.paymentRequest.findUnique({
    where: { id: paymentId },
    select: { updatedAt: true }
  });
  if (!payment) throw new Error(`未找到并发付款夹具 ${paymentId}`);
  return { updatedAt: payment.updatedAt.toISOString() };
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
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `未观察到 backend ${blockedPid} 被 ${blockerPid} 直接阻塞；最接近快照 ${JSON.stringify(bestSnapshot)}`
  );
}

async function paymentFacts(
  client: PrismaClientType,
  scenario: Scenario
) {
  const [
    payment,
    settlement,
    paymentExecutionCount,
    projectFundingAllocationCount,
    auditCount
  ] = await Promise.all([
    client.paymentRequest.findUnique({
      where: { id: scenario.paymentId },
      select: {
        status: true,
        paidAmountCents: true
      }
    }),
    client.settlement.findUnique({
      where: { id: scenario.settlementId },
      select: {
        status: true,
        paidAmountCents: true
      }
    }),
    client.paymentExecution.count({
      where: { paymentRequestId: scenario.paymentId }
    }),
    client.projectFundingAllocation.count({
      where: {
        businessType: "payment_request",
        businessId: scenario.paymentId
      }
    }),
    client.auditLog.count({
      where: {
        businessId: scenario.paymentId,
        action: "payment.execution.record"
      }
    })
  ]);
  return {
    payment,
    settlement,
    paymentExecutionCount,
    projectFundingAllocationCount,
    auditCount
  };
}

function assertSingleWriteFacts(
  facts: Awaited<ReturnType<typeof paymentFacts>>,
  label: string
) {
  assert(
    facts.paymentExecutionCount === 1,
    `${label} 必须只有一条 PaymentExecution`
  );
  assert(
    facts.projectFundingAllocationCount === 1,
    `${label} 必须只有一条项目资金扣减`
  );
  assert(
    facts.auditCount === 1,
    `${label} 必须只有一条付款实付审计`
  );
}

function assertZeroWriteFacts(
  facts: Awaited<ReturnType<typeof paymentFacts>>,
  label: string
) {
  assert(
    facts.payment?.status === "approved_pending_payment" &&
      facts.payment.paidAmountCents === 0n,
    `${label} 必须保持付款申请为已批待付且实付 0`
  );
  assert(
    facts.settlement?.status === "effective" &&
      facts.settlement.paidAmountCents === 0n,
    `${label} 必须保持结算为 effective 且实付 0`
  );
  assert(
    facts.paymentExecutionCount === 0 &&
      facts.projectFundingAllocationCount === 0 &&
      facts.auditCount === 0,
    `${label} 必须保持 PaymentExecution/资金扣减/审计全为 0`
  );
}

async function cleanupFixture(
  client: PrismaClientType,
  fixture: Fixture
) {
  const startsWith = fixture.prefix;
  await client.auditLog.deleteMany({
    where: { businessId: { startsWith } }
  });
  await client.projectFundingAllocation.deleteMany({
    where: { projectId: { startsWith } }
  });
  await client.paymentExecution.deleteMany({
    where: { paymentRequestId: { startsWith } }
  });
  await client.paymentRequest.deleteMany({
    where: { id: { startsWith } }
  });
  await client.settlement.deleteMany({
    where: { id: { startsWith } }
  });
  await client.projectReceipt.deleteMany({
    where: { id: { startsWith } }
  });
  await client.fileObject.deleteMany({
    where: { id: { startsWith } }
  });
  await client.paymentTermsVersion.deleteMany({
    where: { id: { startsWith } }
  });
  await client.contractVersion.deleteMany({
    where: { id: { startsWith } }
  });
  await client.contract.deleteMany({
    where: { id: { startsWith } }
  });
  await client.projectMember.deleteMany({
    where: { projectId: { startsWith } }
  });
  await client.project.deleteMany({
    where: { id: { startsWith } }
  });
  await client.user.deleteMany({
    where: { id: { startsWith } }
  });
  await client.companyEntity.deleteMany({
    where: { id: COMPANY_ENTITY_ID }
  });
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function within<T>(
  promise: Promise<T>,
  message: string
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), 10_000);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function conflictStatus(result: PromiseSettledResult<unknown>) {
  if (result.status !== "rejected") return null;
  const reason = result.reason as HttpException | undefined;
  if (
    reason &&
    typeof reason.getStatus === "function" &&
    reason.getStatus() === 409
  ) {
    return 409;
  }
  return null;
}

function resultId(result: PromiseSettledResult<unknown>) {
  if (result.status !== "fulfilled") return null;
  const value = result.value as { id?: unknown } | null;
  return typeof value?.id === "string" ? value.id : null;
}

function resultError(result: PromiseSettledResult<unknown>) {
  return result.status === "rejected" ? errorText(result.reason) : "fulfilled";
}

function errorText(error: unknown) {
  if (error && typeof error === "object") {
    const source = error as {
      message?: unknown;
      getResponse?: () => unknown;
    };
    if (typeof source.message === "string") return source.message;
    if (typeof source.getResponse === "function") {
      return JSON.stringify(source.getResponse());
    }
  }
  return String(error);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
