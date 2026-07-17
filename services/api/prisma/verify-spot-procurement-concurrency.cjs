const { Prisma, PrismaClient } = require("@prisma/client");
const { AuditService } = require("../dist/audit/audit.service");
const {
  SpotProcurementBalanceService
} = require("../dist/spot-procurement/spot-procurement-balance.service");
const {
  SpotProcurementPaymentService
} = require("../dist/spot-procurement/spot-procurement-payment.service");
const {
  SpotProcurementPilotService
} = require("../dist/spot-procurement/spot-procurement-pilot.service");
const {
  calculateProjectCashPoolBigInt,
  spotProcurementPaymentToMoneyRequestValue
} = require("../dist/money/decimal-money");

const DATABASE_NAME = "jiangkong_spot_procurement_concurrency_verify";
const PROJECT_ID = "concurrency-project";
const EXECUTION_PROJECT_ID = "concurrency-execution-project";
const CASH_SHORT_PROJECT_ID = "concurrency-cash-short-project";
const HANDLER_USER_ID = "concurrency-material-staff";
const FINANCE_USER_ID = "concurrency-finance-staff";
const SUPPORT_FILE_ID = "spot-procurement-concurrency-support";
const ACTIVE_PAYMENT_STATUSES = new Set([
  "approval_pending",
  "approved",
  "approved_pending_payment",
  "partially_paid",
  "paid",
  "settled"
]);

const clientA = new PrismaClient();
const clientB = new PrismaClient();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertBigint(actual, expected, label) {
  assert(typeof actual === "bigint", `${label} 必须由 Prisma 读取为 bigint`);
  assert(actual === expected, `${label} 应为 ${expected}，实际为 ${actual}`);
}

function comparable(value) {
  return JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? `${item}n` : item
  );
}

function assertUnchanged(before, after, label) {
  assert(
    comparable(after) === comparable(before),
    `${label} 在失败释放后发生了变化`
  );
}

function errorText(error) {
  if (error && typeof error === "object") {
    if (typeof error.message === "string") return error.message;
    if (typeof error.getResponse === "function") {
      return JSON.stringify(error.getResponse());
    }
  }
  return String(error);
}

function isConflictOrP2034(error) {
  return (
    error?.code === "P2034" ||
    (typeof error?.getStatus === "function" && error.getStatus() === 409)
  );
}

function isRawPostgresSerializationFailure(error) {
  return (
    error?.code === "P2010" &&
    String(error?.meta?.code) === "40001"
  );
}

function assertOneWinner(results, label, options = {}) {
  const fulfilled = results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert(
    fulfilled.length === 1 && rejected.length === 1,
    `${label} 必须恰好一笔成功、一笔失败，实际 ${results
      .map((result) => result.status)
      .join("/")}`
  );
  const loser = rejected[0].reason;
  if (options.rawP2034) {
    assert(
      loser?.code === "P2034",
      `${label} 失败方必须保留原始 P2034，实际 ${errorText(loser)}`
    );
  } else {
    assert(
      isConflictOrP2034(loser) ||
        (options.allowRawPostgresSerialization &&
          isRawPostgresSerializationFailure(loser)),
      `${label} 失败方必须是 Conflict/P2034，实际 ${errorText(loser)}`
    );
  }
  return fulfilled[0].index;
}

function assertLocalRuntime() {
  const databaseUrlText = process.env.DATABASE_URL ?? "";
  let databaseUrl;
  try {
    databaseUrl = new URL(databaseUrlText);
  } catch {
    throw new Error("零星采购并发验收 DATABASE_URL 不是有效 URL");
  }
  assert(
    ["postgresql:", "postgres:"].includes(databaseUrl.protocol),
    "零星采购并发验收只能连接 PostgreSQL"
  );
  assert(
    ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
      databaseUrl.hostname
    ),
    "零星采购并发验收拒绝连接非本机数据库"
  );
  assert(
    databaseUrl.pathname === `/${DATABASE_NAME}`,
    "零星采购并发验收只允许连接专用的一次性临时数据库"
  );
  assert(
    process.env.NODE_ENV === "test",
    "零星采购并发验收要求 NODE_ENV=test"
  );
  assert(
    (process.env.FILE_STORAGE_DRIVER ?? "").toLowerCase() === "local",
    "零星采购并发验收只允许本地文件存储"
  );
  const pilotProjectIds = new Set(
    (process.env.SPOT_PROCUREMENT_PILOT_PROJECT_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  assert(
    [PROJECT_ID, EXECUTION_PROJECT_ID, CASH_SHORT_PROJECT_ID].every(
      (projectId) => pilotProjectIds.has(projectId)
    ),
    "零星采购并发验收未显式开放全部专用临时项目"
  );
}

function fileAccessFor(prisma) {
  const assertFile = async (client, fileId, actorUserId) => {
    const file = await client.fileObject.findUnique({
      where: { id: fileId }
    });
    if (
      !file ||
      file.storageStatus !== "active" ||
      file.uploadedByUserId !== actorUserId
    ) {
      throw new Error("并发验收付款凭证不可用或无权访问");
    }
    return file;
  };
  return {
    assertCanDownloadFileById: (fileId, actorUserId) =>
      assertFile(prisma, fileId, actorUserId),
    assertCanDownloadFile: (tx, fileId, actorUserId) =>
      assertFile(tx, fileId, actorUserId)
  };
}

function servicesFor(prisma) {
  const audit = new AuditService();
  const balances = new SpotProcurementBalanceService(prisma, audit);
  const payment = new SpotProcurementPaymentService(
    prisma,
    audit,
    new SpotProcurementPilotService(),
    balances,
    {
      confirmPassword: async (_actorUserId, password) => {
        if (password !== "current-password") {
          throw new Error("当前密码不正确，请重新输入");
        }
      }
    },
    fileAccessFor(prisma),
    {
      tryRefreshLatestForBusiness: async () => undefined
    }
  );
  return { balances, payment };
}

async function seedVerificationFacts() {
  await clientA.project.createMany({
    data: [
      {
        id: PROJECT_ID,
        code: "CONCURRENCY-VERIFY",
        name: "零星采购 PostgreSQL 并发验收临时项目"
      },
      {
        id: EXECUTION_PROJECT_ID,
        code: "CONCURRENCY-EXECUTION",
        name: "零星采购实际付款并发验收项目"
      },
      {
        id: CASH_SHORT_PROJECT_ID,
        code: "CONCURRENCY-CASH-SHORT",
        name: "零星采购现金不足验收项目"
      }
    ]
  });
  await clientA.user.create({
    data: {
      id: HANDLER_USER_ID,
      name: "并发验收物资员",
      isActive: true,
      mustChangePassword: false
    }
  });
  await clientA.projectMember.create({
    data: {
      projectId: PROJECT_ID,
      userId: HANDLER_USER_ID,
      positionKey: "material_staff"
    }
  });
  await clientA.user.create({
    data: {
      id: FINANCE_USER_ID,
      name: "并发验收财务人员",
      isActive: true,
      mustChangePassword: false
    }
  });
  await clientA.projectMember.createMany({
    data: [
      {
        projectId: EXECUTION_PROJECT_ID,
        userId: FINANCE_USER_ID,
        positionKey: "finance_staff"
      },
      {
        projectId: CASH_SHORT_PROJECT_ID,
        userId: FINANCE_USER_ID,
        positionKey: "finance_staff"
      }
    ]
  });
  await clientA.fileObject.create({
    data: {
      id: SUPPORT_FILE_ID,
      bucket: "local-private",
      objectKey: "spot-procurement-concurrency/support.pdf",
      originalName: "零星采购并发验收支撑附件.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
      uploadedByUserId: HANDLER_USER_ID,
      storageStatus: "active"
    }
  });
  await clientA.projectReceipt.create({
    data: {
      projectId: EXECUTION_PROJECT_ID,
      receivedAt: new Date(),
      amountCents: 100_000n,
      payerName: "并发验收资金来源",
      sourceType: "general_contractor_payment",
      voucherFileId: SUPPORT_FILE_ID,
      recordedByUserId: FINANCE_USER_ID
    }
  });
}

async function createApprovedProcurement(prisma, input) {
  const projectId = input.projectId ?? PROJECT_ID;
  const handlerUserId = input.handlerUserId ?? HANDLER_USER_ID;
  await prisma.spotProcurement.create({
    data: {
      id: input.procurementId,
      projectId,
      code: input.code,
      supplierPartyId: null,
      supplierKey: input.supplierKey,
      supplierNameSnapshot: input.supplierName,
      applicantUserId: handlerUserId,
      handlerUserId,
      status: "approved_in_progress",
      approvedAmountCents: input.totalAmountCents
    }
  });
  await prisma.spotProcurementVersion.create({
    data: {
      id: input.versionId,
      procurementId: input.procurementId,
      versionNo: 1,
      status: "approved",
      reason: "本地 PostgreSQL 并发验收",
      supplierPartyId: null,
      supplierKey: input.supplierKey,
      supplierNameSnapshot: input.supplierName,
      handlerUserId,
      totalAmountCents: input.totalAmountCents,
      submittedAt: new Date(),
      approvedAt: new Date(),
      createdByUserId: handlerUserId
    }
  });
  await prisma.spotProcurement.update({
    where: { id: input.procurementId },
    data: { currentVersionId: input.versionId }
  });
}

async function createPaymentDraft(prisma, input) {
  const projectId = input.projectId ?? PROJECT_ID;
  const handlerUserId = input.handlerUserId ?? HANDLER_USER_ID;
  return prisma.spotProcurementPayment.create({
    data: {
      id: input.paymentId,
      projectId,
      procurementId: input.procurementId,
      procurementVersionId: input.versionId,
      code: input.code,
      status: input.status ?? "draft",
      settlementAmountCents: input.settlementAmountCents,
      supplierBalanceAmountCents: input.supplierBalanceAmountCents,
      companyPaymentAmountCents:
        input.settlementAmountCents - input.supplierBalanceAmountCents,
      paymentPath: "supplier_direct",
      paymentMethod:
        input.settlementAmountCents === input.supplierBalanceAmountCents
          ? null
          : "cash",
      payeeNameSnapshot: input.supplierName,
      expectedPaymentAt:
        input.settlementAmountCents === input.supplierBalanceAmountCents
          ? null
          : new Date(Date.now() + 24 * 60 * 60 * 1000),
      paymentNote: "本地 PostgreSQL 并发验收",
      supportingAttachmentFileId: SUPPORT_FILE_ID,
      handlerUserId,
      createdByUserId: handlerUserId,
      submittedAt:
        input.status === "approved_pending_payment"
          ? new Date()
          : undefined,
      approvedAt:
        input.status === "approved_pending_payment"
          ? new Date()
          : undefined
    }
  });
}

async function createExecutionVoucher(fileId) {
  return clientA.fileObject.create({
    data: {
      id: fileId,
      bucket: "local-private",
      objectKey: `spot-procurement-concurrency/${fileId}.pdf`,
      originalName: `${fileId}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 1,
      uploadedByUserId: FINANCE_USER_ID,
      storageStatus: "active"
    }
  });
}

async function createExecutionReadyPayment(input) {
  await createApprovedProcurement(clientA, {
    projectId: input.projectId ?? EXECUTION_PROJECT_ID,
    handlerUserId: HANDLER_USER_ID,
    procurementId: input.procurementId,
    versionId: input.versionId,
    code: input.procurementCode,
    supplierKey: input.supplierKey,
    supplierName: input.supplierName,
    totalAmountCents: input.settlementAmountCents
  });
  return createPaymentDraft(clientA, {
    projectId: input.projectId ?? EXECUTION_PROJECT_ID,
    handlerUserId: HANDLER_USER_ID,
    paymentId: input.paymentId,
    procurementId: input.procurementId,
    versionId: input.versionId,
    code: input.paymentCode,
    supplierName: input.supplierName,
    settlementAmountCents: input.settlementAmountCents,
    supplierBalanceAmountCents:
      input.supplierBalanceAmountCents ?? 0n,
    status: "approved_pending_payment"
  });
}

function executionInput({
  amountCents,
  voucherFileId,
  idempotencyKey,
  paidAt = new Date()
}) {
  return {
    amountCents: amountCents.toString(),
    paidAt: paidAt.toISOString(),
    paymentMethod: "bank_transfer",
    voucherFileId,
    idempotencyKey,
    confirmationPassword: "current-password"
  };
}

async function readProjectCash(projectId) {
  const [
    receipts,
    paymentRequests,
    expenseRequests,
    spotPayments
  ] = await Promise.all([
    clientA.projectReceipt.findMany({
      where: { projectId, voidedAt: null },
      select: { amountCents: true }
    }),
    clientA.paymentRequest.findMany({
      where: { projectId },
      select: {
        status: true,
        requestedAmountCents: true,
        approvedAmountCents: true,
        paidAmountCents: true
      }
    }),
    clientA.projectExpenseRequest.findMany({
      where: { projectId, voidedAt: null },
      select: {
        status: true,
        requestedAmountCents: true,
        approvedAmountCents: true,
        paidAmountCents: true
      }
    }),
    clientA.spotProcurementPayment.findMany({
      where: {
        projectId,
        status: {
          in: [
            "approval_pending",
            "approved_pending_payment",
            "partially_paid",
            "paid",
            "settled"
          ]
        }
      },
      select: {
        status: true,
        companyPaymentAmountCents: true,
        canceledCompanyPaymentAmountCents: true,
        paidAmountCents: true
      }
    })
  ]);
  return calculateProjectCashPoolBigInt({
    receiptAmountCents: receipts.map((row) => row.amountCents),
    paymentRequests,
    expenseRequests,
    spotProcurementPayments: spotPayments.map(
      spotProcurementPaymentToMoneyRequestValue
    )
  });
}

async function readExecutionFacts(paymentIds) {
  return Promise.all([
    clientA.spotProcurementPayment.findMany({
      where: { id: { in: paymentIds } },
      orderBy: { id: "asc" }
    }),
    clientA.spotProcurementPaymentExecution.findMany({
      where: { paymentId: { in: paymentIds } },
      orderBy: { id: "asc" }
    }),
    clientA.auditLog.findMany({
      where: {
        action: "spot_procurement.payment.execution.record",
        businessId: { in: paymentIds }
      },
      orderBy: { createdAt: "asc" }
    })
  ]);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitForBlockedQueries(prisma, queryNeedle, expectedCount) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS "count"
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND query LIKE ${`%${queryNeedle}%`}
    `;
    if ((rows[0]?.count ?? 0) >= expectedCount) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `未观察到 ${expectedCount} 个等待 ${queryNeedle} 行锁的真实 PostgreSQL 会话`
  );
}

async function runBehindDatabaseLock({
  blockerClient,
  observerClient,
  acquireLock,
  queryNeedle,
  start
}) {
  const acquired = deferred();
  const release = deferred();
  const blocker = blockerClient.$transaction(
    async (tx) => {
      await acquireLock(tx);
      acquired.resolve();
      await release.promise;
    },
    { timeout: 15_000, maxWait: 10_000 }
  );
  await acquired.promise;
  const resultsPromise = Promise.allSettled(start());
  try {
    await waitForBlockedQueries(observerClient, queryNeedle, 2);
  } finally {
    release.resolve();
    await blocker;
  }
  return resultsPromise;
}

async function verifyCumulativeCapacityCompetition(servicesA, servicesB) {
  const procurementId = "spot-concurrency-capacity";
  const versionId = `${procurementId}-v1`;
  const supplierName = "累计额度并发验收供应商";
  await createApprovedProcurement(clientA, {
    procurementId,
    versionId,
    code: "LXCG-CONC-CAP",
    supplierKey: "spot-concurrency-capacity-supplier",
    supplierName,
    totalAmountCents: 10_000n
  });
  const payments = await Promise.all(
    ["a", "b"].map((suffix) =>
      createPaymentDraft(clientA, {
        paymentId: `${procurementId}-payment-${suffix}`,
        procurementId,
        versionId,
        code: `LXCG-CONC-CAP-P-${suffix.toUpperCase()}`,
        supplierName,
        settlementAmountCents: 7_000n,
        supplierBalanceAmountCents: 0n
      })
    )
  );

  const results = await runBehindDatabaseLock({
    blockerClient: clientA,
    observerClient: clientB,
    acquireLock: (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "SpotProcurementVersion" WHERE "id" = ${versionId} FOR UPDATE`
      ),
    queryNeedle: "SpotProcurementVersion",
    start: () => [
      servicesA.payment.submit(payments[0].id, HANDLER_USER_ID),
      servicesB.payment.submit(payments[1].id, HANDLER_USER_ID)
    ]
  });
  assertOneWinner(results, "采购批准金额累计额度竞争");

  const persisted = await clientA.spotProcurementPayment.findMany({
    where: { procurementId }
  });
  const occupied = persisted
    .filter((payment) => ACTIVE_PAYMENT_STATUSES.has(payment.status))
    .reduce((sum, payment) => sum + payment.settlementAmountCents, 0n);
  assertBigint(occupied, 7_000n, "累计额度竞争后的有效付款合计");
  assert(
    persisted.filter((payment) => payment.status === "approval_pending")
      .length === 1 &&
      persisted.filter((payment) => payment.status === "draft").length === 1,
    "累计额度竞争失败方必须完整回滚并保留草稿"
  );
  assert(
    (await clientA.approvalInstance.count({
      where: {
        businessType: "spot_procurement_payment",
        businessId: { in: payments.map((payment) => payment.id) }
      }
    })) === 1,
    "累计额度竞争只能生成一个审批实例"
  );
  console.log(
    "ok spot procurement cumulative capacity: two real submissions -> one winner, one Conflict/P2034"
  );
}

async function verifyBalanceCompetitionAndRelease(servicesA, servicesB) {
  const competingSupplierKey =
    "spot-concurrency-balance-over-capacity-supplier";
  const competingSupplierName = "余额超额竞争验收供应商";
  const competingAccount =
    await clientA.supplierBalanceAccount.create({
      data: {
        id: "spot-concurrency-balance-over-capacity-account",
        projectId: PROJECT_ID,
        supplierKey: competingSupplierKey,
        supplierNameSnapshot: competingSupplierName,
        availableAmountCents: 10_000n,
        reservedAmountCents: 0n
      }
    });
  const competingPayments = [];
  for (const suffix of ["a", "b"]) {
    const procurementId = `spot-concurrency-balance-${suffix}`;
    const versionId = `${procurementId}-v1`;
    await createApprovedProcurement(clientA, {
      procurementId,
      versionId,
      code: `LXCG-CONC-BAL-${suffix.toUpperCase()}`,
      supplierKey: competingSupplierKey,
      supplierName: competingSupplierName,
      totalAmountCents: 10_000n
    });
    competingPayments.push(
      await createPaymentDraft(clientA, {
        paymentId: `${procurementId}-payment`,
        procurementId,
        versionId,
        code: `LXCG-CONC-BAL-${suffix.toUpperCase()}-P001`,
        supplierName: competingSupplierName,
        settlementAmountCents: 6_000n,
        supplierBalanceAmountCents: 6_000n
      })
    );
  }

  const competitionResults = await runBehindDatabaseLock({
    blockerClient: clientA,
    observerClient: clientB,
    acquireLock: (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "SupplierBalanceAccount" WHERE "id" = ${competingAccount.id} FOR UPDATE`
      ),
    queryNeedle: "SupplierBalanceAccount",
    start: () => [
      servicesA.payment.submit(
        competingPayments[0].id,
        HANDLER_USER_ID
      ),
      servicesB.payment.submit(
        competingPayments[1].id,
        HANDLER_USER_ID
      )
    ]
  });
  assertOneWinner(competitionResults, "同一供应商余额账户超额竞争");

  const afterCompetition =
    await clientA.supplierBalanceAccount.findUniqueOrThrow({
      where: { id: competingAccount.id }
    });
  assertBigint(
    afterCompetition.reservedAmountCents,
    6_000n,
    "余额超额竞争后的预留金额"
  );
  assert(
    (await clientA.supplierBalanceReservation.count({
      where: {
        accountId: competingAccount.id,
        status: "reserved"
      }
    })) === 1,
    "余额超额竞争只能留下一个有效 reservation"
  );

  const sequenceSupplierKey =
    "spot-concurrency-balance-sequence-supplier";
  const sequenceSupplierName = "余额流水并发验收供应商";
  const sequenceAccount =
    await clientA.supplierBalanceAccount.create({
      data: {
        id: "spot-concurrency-balance-sequence-account",
        projectId: PROJECT_ID,
        supplierKey: sequenceSupplierKey,
        supplierNameSnapshot: sequenceSupplierName,
        availableAmountCents: 10_000n,
        reservedAmountCents: 0n
      }
    });
  const sequenceInputs = [];
  for (const suffix of ["a", "b"]) {
    const procurementId = `spot-concurrency-sequence-${suffix}`;
    const versionId = `${procurementId}-v1`;
    await createApprovedProcurement(clientA, {
      procurementId,
      versionId,
      code: `LXCG-CONC-SEQ-${suffix.toUpperCase()}`,
      supplierKey: sequenceSupplierKey,
      supplierName: sequenceSupplierName,
      totalAmountCents: 5_000n
    });
    const payment = await createPaymentDraft(clientA, {
      paymentId: `${procurementId}-payment`,
      procurementId,
      versionId,
      code: `LXCG-CONC-SEQ-${suffix.toUpperCase()}-P001`,
      supplierName: sequenceSupplierName,
      settlementAmountCents: 3_000n,
      supplierBalanceAmountCents: 3_000n
    });
    sequenceInputs.push({
      projectId: PROJECT_ID,
      supplierKey: sequenceSupplierKey,
      paymentId: payment.id,
      procurementId,
      amountCents: 3_000n,
      actorUserId: HANDLER_USER_ID
    });
  }

  const reserveClients = [clientA, clientB];
  const reserveServices = [servicesA.balances, servicesB.balances];
  const reserveResults = await runBehindDatabaseLock({
    blockerClient: clientA,
    observerClient: clientB,
    acquireLock: (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "SupplierBalanceAccount" WHERE "id" = ${sequenceAccount.id} FOR UPDATE`
      ),
    queryNeedle: "SupplierBalanceAccount",
    start: () =>
      sequenceInputs.map((input, index) =>
        reserveClients[index].$transaction(
          (tx) => reserveServices[index].reserve(tx, input),
          {
            isolationLevel:
              Prisma.TransactionIsolationLevel.Serializable
          }
        )
      )
  });
  const reserveWinner = assertOneWinner(
    reserveResults,
    "同一余额账户两笔可容纳预留并发竞争",
    { allowRawPostgresSerialization: true }
  );
  const reserveLoser = reserveWinner === 0 ? 1 : 0;
  await reserveClients[reserveLoser].$transaction(
    (tx) =>
      reserveServices[reserveLoser].reserve(
        tx,
        sequenceInputs[reserveLoser]
      ),
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel.Serializable
    }
  );

  const reserveEntries =
    await clientA.supplierBalanceEntry.findMany({
      where: {
        accountId: sequenceAccount.id,
        entryType: "reserve"
      },
      orderBy: { sequenceNo: "asc" }
    });
  assert(
    reserveEntries.length === 2 &&
      reserveEntries[0].sequenceNo === 1n &&
      reserveEntries[1].sequenceNo === 2n,
    "同一余额账户的 reserve sequenceNo 必须唯一且连续为 1、2"
  );

  const releaseResults = await runBehindDatabaseLock({
    blockerClient: clientA,
    observerClient: clientB,
    acquireLock: (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "SupplierBalanceAccount" WHERE "id" = ${sequenceAccount.id} FOR UPDATE`
      ),
    queryNeedle: "SupplierBalanceAccount",
    start: () => [
      clientA.$transaction(
        (tx) =>
          servicesA.balances.releaseReservation(
            tx,
            {
              paymentId: sequenceInputs[0].paymentId,
              expectedAmountCents: 3_000n,
              expectedProjectId: PROJECT_ID,
              expectedSupplierKey: sequenceSupplierKey,
              actorUserId: HANDLER_USER_ID,
              reason: "本地并发释放验收 A"
            }
          ),
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable
        }
      ),
      clientB.$transaction(
        (tx) =>
          servicesB.balances.releaseReservation(
            tx,
            {
              paymentId: sequenceInputs[0].paymentId,
              expectedAmountCents: 3_000n,
              expectedProjectId: PROJECT_ID,
              expectedSupplierKey: sequenceSupplierKey,
              actorUserId: HANDLER_USER_ID,
              reason: "本地并发释放验收 B"
            }
          ),
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable
        }
      )
    ]
  });
  assertOneWinner(releaseResults, "同一 reservation 严格并发释放", {
    allowRawPostgresSerialization: true
  });

  const [finalAccount, releasedReservation, entries] =
    await Promise.all([
      clientA.supplierBalanceAccount.findUniqueOrThrow({
        where: { id: sequenceAccount.id }
      }),
      clientA.supplierBalanceReservation.findUniqueOrThrow({
        where: { paymentId: sequenceInputs[0].paymentId }
      }),
      clientA.supplierBalanceEntry.findMany({
        where: { accountId: sequenceAccount.id },
        orderBy: { sequenceNo: "asc" }
      })
    ]);
  assertBigint(
    finalAccount.reservedAmountCents,
    3_000n,
    "并发释放后的账户预留余额"
  );
  assert(
    releasedReservation.status === "released",
    "并发释放成功方必须把 reservation 标记为 released"
  );
  assert(
    entries.filter((entry) => entry.entryType === "release").length ===
      1,
    "并发释放只能生成一条 release 流水"
  );
  assert(
    entries.length === 3 &&
      entries.every(
        (entry, index) => entry.sequenceNo === BigInt(index + 1)
      ) &&
      new Set(entries.map((entry) => entry.sequenceNo.toString()))
        .size === entries.length,
    "同一余额账户的全部 sequenceNo 必须唯一且连续为 1、2、3"
  );
  assertBigint(
    entries.reduce(
      (sum, entry) => sum + entry.reservedDeltaCents,
      0n
    ),
    finalAccount.reservedAmountCents,
    "余额流水预留净额"
  );
  console.log(
    "ok supplier balance concurrency: over-capacity race, continuous sequenceNo, strict one-shot release"
  );
}

async function verifyMismatchedReservationReleaseFailsClosed(
  servicesA
) {
  const procurementId = "spot-concurrency-mismatched-payment";
  const versionId = `${procurementId}-v1`;
  const expectedSupplierKey =
    "spot-concurrency-mismatched-supplier-a";
  const expectedSupplierName = "错账验收供应商 A";
  const wrongProjectId = "concurrency-project-b";
  const wrongSupplierKey = "spot-concurrency-mismatched-supplier-b";
  const wrongSupplierName = "错账验收供应商 B";
  const amountCents = 2_500n;

  await clientA.project.create({
    data: {
      id: wrongProjectId,
      code: "CONCURRENCY-VERIFY-B",
      name: "零星采购错账验收临时项目 B"
    }
  });
  await createApprovedProcurement(clientA, {
    procurementId,
    versionId,
    code: "LXCG-CONC-MISMATCH-A",
    supplierKey: expectedSupplierKey,
    supplierName: expectedSupplierName,
    totalAmountCents: 5_000n
  });
  const payment = await createPaymentDraft(clientA, {
    paymentId: `${procurementId}-payment`,
    procurementId,
    versionId,
    code: "LXCG-CONC-MISMATCH-A-P001",
    supplierName: expectedSupplierName,
    settlementAmountCents: amountCents,
    supplierBalanceAmountCents: amountCents
  });
  await clientA.spotProcurementPayment.update({
    where: { id: payment.id },
    data: { status: "approval_pending", submittedAt: new Date() }
  });
  const expectedAccount =
    await clientA.supplierBalanceAccount.create({
      data: {
        id: "spot-concurrency-mismatched-account-a",
        projectId: PROJECT_ID,
        supplierKey: expectedSupplierKey,
        supplierNameSnapshot: expectedSupplierName,
        availableAmountCents: 5_000n,
        reservedAmountCents: 0n
      }
    });
  const wrongAccount =
    await clientA.supplierBalanceAccount.create({
      data: {
        id: "spot-concurrency-mismatched-account-b",
        projectId: wrongProjectId,
        supplierKey: wrongSupplierKey,
        supplierNameSnapshot: wrongSupplierName,
        availableAmountCents: 5_000n,
        reservedAmountCents: amountCents
      }
    });
  const reservation =
    await clientA.supplierBalanceReservation.create({
      data: {
        id: "spot-concurrency-mismatched-reservation",
        accountId: wrongAccount.id,
        paymentId: payment.id,
        amountCents,
        status: "reserved",
        reservedByUserId: HANDLER_USER_ID
      }
    });
  await clientA.supplierBalanceEntry.create({
    data: {
      accountId: wrongAccount.id,
      sequenceNo: 1n,
      reservationId: reservation.id,
      paymentId: payment.id,
      procurementId,
      entryType: "reserve",
      availableDeltaCents: 0n,
      reservedDeltaCents: amountCents,
      availableAmountAfterCents: 5_000n,
      reservedAmountAfterCents: amountCents,
      actorUserId: HANDLER_USER_ID,
      reason: "构造同金额跨项目跨供应商错账"
    }
  });

  const readFacts = () =>
    Promise.all([
      clientA.spotProcurementPayment.findUniqueOrThrow({
        where: { id: payment.id }
      }),
      clientA.spotProcurementVersion.findUniqueOrThrow({
        where: { id: versionId }
      }),
      clientA.supplierBalanceReservation.findUniqueOrThrow({
        where: { paymentId: payment.id }
      }),
      clientA.supplierBalanceAccount.findMany({
        where: {
          id: { in: [expectedAccount.id, wrongAccount.id] }
        },
        orderBy: { id: "asc" }
      }),
      clientA.supplierBalanceEntry.findMany({
        where: { accountId: wrongAccount.id },
        orderBy: { sequenceNo: "asc" }
      })
    ]);
  const before = await readFacts();
  const error = await clientA
    .$transaction(
      (tx) =>
        servicesA.balances.releaseReservation(tx, {
          paymentId: payment.id,
          expectedAmountCents: amountCents,
          expectedProjectId: PROJECT_ID,
          expectedSupplierKey,
          actorUserId: HANDLER_USER_ID,
          reason: "错账释放必须失败"
        }),
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.Serializable
      }
    )
    .then(
      () => null,
      (caught) => caught
    );
  assert(
    typeof error?.getStatus === "function" &&
      error.getStatus() === 409,
    `同金额错账释放必须返回 Conflict，实际 ${errorText(error)}`
  );
  assert(
    error.message === "供应商余额预留状态异常，请联系财务处理",
    `同金额错账释放必须返回固定中文提示，实际 ${errorText(error)}`
  );
  const after = await readFacts();
  assertUnchanged(before[0], after[0], "付款申请 A");
  assertUnchanged(before[1], after[1], "采购版本 A");
  assertUnchanged(before[2], after[2], "错误 reservation B");
  assertUnchanged(before[3], after[3], "供应商余额账户 A/B");
  assertUnchanged(before[4], after[4], "供应商余额流水");
  console.log(
    "ok mismatched reservation fail-closed: payment/version A cannot release same-amount reservation/account B"
  );
}

async function verifyExecutionRemainingCompetition(
  servicesA,
  servicesB
) {
  const procurementId = "spot-execution-remaining";
  const versionId = `${procurementId}-v1`;
  const payment = await createExecutionReadyPayment({
    procurementId,
    versionId,
    procurementCode: "LXCG-EXEC-REMAIN",
    paymentId: `${procurementId}-payment`,
    paymentCode: "LXCG-EXEC-REMAIN-P001",
    supplierKey: "spot-execution-remaining-supplier",
    supplierName: "实付剩余额度并发供应商",
    settlementAmountCents: 10_000n
  });
  const voucherIds = [
    "spot-execution-remaining-voucher-a",
    "spot-execution-remaining-voucher-b"
  ];
  await Promise.all(voucherIds.map(createExecutionVoucher));
  const results = await runBehindDatabaseLock({
    blockerClient: clientA,
    observerClient: clientB,
    acquireLock: (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "SpotProcurementVersion" WHERE "id" = ${versionId} FOR UPDATE`
      ),
    queryNeedle: "SpotProcurementVersion",
    start: () => [
      servicesA.payment.recordExecution(
        payment.id,
        FINANCE_USER_ID,
        executionInput({
          amountCents: 6_000n,
          voucherFileId: voucherIds[0],
          idempotencyKey: "spot-execution-remaining-key-a"
        })
      ),
      servicesB.payment.recordExecution(
        payment.id,
        FINANCE_USER_ID,
        executionInput({
          amountCents: 6_000n,
          voucherFileId: voucherIds[1],
          idempotencyKey: "spot-execution-remaining-key-b"
        })
      )
    ]
  });
  assertOneWinner(results, "同一付款剩余额度实际付款竞争");
  const [payments, executions, audits] =
    await readExecutionFacts([payment.id]);
  assertBigint(
    payments[0].paidAmountCents,
    6_000n,
    "同一付款并发后的累计已付"
  );
  assert(
    payments[0].status === "partially_paid",
    "同一付款并发成功方后必须保持部分已付"
  );
  assert(
    executions.length === 1 && audits.length === 1,
    "同一付款并发失败方不得留下 execution 或 audit 部分写入"
  );
  console.log(
    "ok spot execution remaining competition: one active execution, one rolled-back loser"
  );
}

async function verifyExecutionIdempotencyConcurrency(
  servicesA,
  servicesB
) {
  const procurementId = "spot-execution-idempotency";
  const versionId = `${procurementId}-v1`;
  const payment = await createExecutionReadyPayment({
    procurementId,
    versionId,
    procurementCode: "LXCG-EXEC-IDEMP",
    paymentId: `${procurementId}-payment`,
    paymentCode: "LXCG-EXEC-IDEMP-P001",
    supplierKey: "spot-execution-idempotency-supplier",
    supplierName: "实付幂等并发供应商",
    settlementAmountCents: 5_000n
  });
  const voucherFileId = "spot-execution-idempotency-voucher";
  await createExecutionVoucher(voucherFileId);
  const paidAt = new Date();
  const input = executionInput({
    amountCents: 2_000n,
    voucherFileId,
    idempotencyKey: "spot-execution-idempotency-key",
    paidAt
  });
  const results = await runBehindDatabaseLock({
    blockerClient: clientA,
    observerClient: clientB,
    acquireLock: (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "SpotProcurementVersion" WHERE "id" = ${versionId} FOR UPDATE`
      ),
    queryNeedle: "SpotProcurementVersion",
    start: () => [
      servicesA.payment.recordExecution(
        payment.id,
        FINANCE_USER_ID,
        input
      ),
      servicesB.payment.recordExecution(
        payment.id,
        FINANCE_USER_ID,
        input
      )
    ]
  });
  assert(
    results.every((result) => result.status === "fulfilled"),
    `同一幂等键并发必须都返回原记录，实际 ${results
      .map((result) => result.status)
      .join("/")}`
  );
  const executionIds = results.map(
    (result) => result.value.execution.id
  );
  assert(
    new Set(executionIds).size === 1,
    "同一幂等键并发必须返回同一个 executionId"
  );
  const [payments, executions, audits] =
    await readExecutionFacts([payment.id]);
  assertBigint(
    payments[0].paidAmountCents,
    2_000n,
    "幂等并发后的累计已付"
  );
  assert(
    executions.length === 1 && audits.length === 1,
    "同一幂等键并发只能生成一条 execution 和一条 audit"
  );
  console.log(
    "ok spot execution idempotency: concurrent retry returns one original execution"
  );
}

async function verifyExecutionVoucherUniqueness(
  servicesA,
  servicesB
) {
  const voucherFileId = "spot-execution-shared-voucher";
  await createExecutionVoucher(voucherFileId);
  const payments = [];
  for (const suffix of ["a", "b"]) {
    const procurementId = `spot-execution-voucher-${suffix}`;
    payments.push(
      await createExecutionReadyPayment({
        procurementId,
        versionId: `${procurementId}-v1`,
        procurementCode: `LXCG-EXEC-VOUCHER-${suffix.toUpperCase()}`,
        paymentId: `${procurementId}-payment`,
        paymentCode: `LXCG-EXEC-VOUCHER-${suffix.toUpperCase()}-P001`,
        supplierKey: `spot-execution-voucher-supplier-${suffix}`,
        supplierName: `凭证唯一并发供应商 ${suffix.toUpperCase()}`,
        settlementAmountCents: 2_000n
      })
    );
  }
  const results = await runBehindDatabaseLock({
    blockerClient: clientA,
    observerClient: clientB,
    acquireLock: (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Project" WHERE "id" = ${EXECUTION_PROJECT_ID} FOR UPDATE`
      ),
    queryNeedle: 'FROM "Project"',
    start: () => [
      servicesA.payment.recordExecution(
        payments[0].id,
        FINANCE_USER_ID,
        executionInput({
          amountCents: 2_000n,
          voucherFileId,
          idempotencyKey: "spot-execution-shared-voucher-key-a"
        })
      ),
      servicesB.payment.recordExecution(
        payments[1].id,
        FINANCE_USER_ID,
        executionInput({
          amountCents: 2_000n,
          voucherFileId,
          idempotencyKey: "spot-execution-shared-voucher-key-b"
        })
      )
    ]
  });
  assertOneWinner(results, "同一凭证跨付款并发唯一");
  const [persistedPayments, executions, audits] =
    await readExecutionFacts(payments.map((payment) => payment.id));
  assert(
    executions.length === 1 && audits.length === 1,
    "同一凭证跨付款只能留下一个 execution 和 audit"
  );
  assert(
    persistedPayments.filter(
      (payment) => payment.status === "paid"
    ).length === 1 &&
      persistedPayments.filter(
        (payment) =>
          payment.status === "approved_pending_payment"
      ).length === 1,
    "同一凭证竞争失败方付款状态和已付金额必须完整回滚"
  );
  assert(
    persistedPayments.reduce(
      (sum, payment) => sum + payment.paidAmountCents,
      0n
    ) === 2_000n,
    "同一凭证竞争失败方不得增加累计已付"
  );
  console.log(
    "ok spot execution voucher uniqueness: one active voucher binding across payments"
  );
}

async function verifyExecutionProjectSerialization(
  servicesA,
  servicesB
) {
  const inputs = [];
  for (const suffix of ["a", "b"]) {
    const procurementId = `spot-execution-project-lock-${suffix}`;
    const payment = await createExecutionReadyPayment({
      procurementId,
      versionId: `${procurementId}-v1`,
      procurementCode: `LXCG-EXEC-LOCK-${suffix.toUpperCase()}`,
      paymentId: `${procurementId}-payment`,
      paymentCode: `LXCG-EXEC-LOCK-${suffix.toUpperCase()}-P001`,
      supplierKey: `spot-execution-lock-supplier-${suffix}`,
      supplierName: `项目锁串行供应商 ${suffix.toUpperCase()}`,
      settlementAmountCents: 3_000n
    });
    const voucherFileId = `spot-execution-project-lock-voucher-${suffix}`;
    await createExecutionVoucher(voucherFileId);
    inputs.push({
      payment,
      voucherFileId,
      idempotencyKey: `spot-execution-project-lock-key-${suffix}`
    });
  }
  const before = await readProjectCash(EXECUTION_PROJECT_ID);
  const results = await runBehindDatabaseLock({
    blockerClient: clientA,
    observerClient: clientB,
    acquireLock: (tx) =>
      tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Project" WHERE "id" = ${EXECUTION_PROJECT_ID} FOR UPDATE`
      ),
    queryNeedle: 'FROM "Project"',
    start: () =>
      inputs.map((input, index) =>
        [servicesA, servicesB][index].payment.recordExecution(
          input.payment.id,
          FINANCE_USER_ID,
          executionInput({
            amountCents: 3_000n,
            voucherFileId: input.voucherFileId,
            idempotencyKey: input.idempotencyKey
          })
        )
      )
  });
  const winnerIndex = assertOneWinner(
    results,
    "不同付款同项目 Serializable 串行竞争"
  );
  const loserIndex = winnerIndex === 0 ? 1 : 0;
  const [afterRacePayments, afterRaceExecutions, afterRaceAudits] =
    await readExecutionFacts(
      inputs.map((input) => input.payment.id)
    );
  assert(
    afterRaceExecutions.length === 1 &&
      afterRaceAudits.length === 1 &&
      afterRacePayments.filter(
        (payment) => payment.status === "paid"
      ).length === 1 &&
      afterRacePayments.filter(
        (payment) =>
          payment.status === "approved_pending_payment"
      ).length === 1,
    "项目锁竞争失败方必须零 execution、零 audit 且付款状态不变"
  );
  await [servicesA, servicesB][
    loserIndex
  ].payment.recordExecution(
    inputs[loserIndex].payment.id,
    FINANCE_USER_ID,
    executionInput({
      amountCents: 3_000n,
      voucherFileId: inputs[loserIndex].voucherFileId,
      idempotencyKey: inputs[loserIndex].idempotencyKey
    })
  );
  const after = await readProjectCash(EXECUTION_PROJECT_ID);
  assertBigint(
    after.actualPaidCents - before.actualPaidCents,
    6_000n,
    "项目锁串行后的实际已付增量"
  );
  assertBigint(
    before.occupiedCents - after.occupiedCents,
    6_000n,
    "项目锁串行后的占用释放量"
  );
  assertBigint(
    before.actualPaidCents + before.occupiedCents,
    after.actualPaidCents + after.occupiedCents,
    "项目锁串行前后已付加占用守恒"
  );
  assert(
    after.availableCents >= before.availableCents,
    "项目锁串行后可用资金不得下降"
  );
  assert(
    after.actualPaidCents + after.occupiedCents <=
      after.actualReceiptsCents,
    "项目锁串行后总承诺不得超过项目实收"
  );
  const paymentIds = inputs.map((input) => input.payment.id);
  const [payments, executions, audits] =
    await readExecutionFacts(paymentIds);
  assert(
    payments.every(
      (payment) =>
        payment.status === "paid" &&
        payment.paidAmountCents ===
          payment.companyPaymentAmountCents
    ) &&
      executions.length === 2 &&
      audits.length === 2,
    "项目锁串行的两笔付款都必须各自不超批准额度且完整留痕"
  );
  console.log(
    "ok spot execution project serialization: one Serializable winner, clean loser retry, occupied-to-paid cash invariant"
  );
}

async function verifyExecutionCashShortageZeroWrite(servicesA) {
  const procurementId = "spot-execution-cash-short";
  const payment = await createExecutionReadyPayment({
    projectId: CASH_SHORT_PROJECT_ID,
    procurementId,
    versionId: `${procurementId}-v1`,
    procurementCode: "LXCG-EXEC-CASH-SHORT",
    paymentId: `${procurementId}-payment`,
    paymentCode: "LXCG-EXEC-CASH-SHORT-P001",
    supplierKey: "spot-execution-cash-short-supplier",
    supplierName: "现金不足验收供应商",
    settlementAmountCents: 1_000n
  });
  const voucherFileId = "spot-execution-cash-short-voucher";
  await createExecutionVoucher(voucherFileId);
  const before = await readExecutionFacts([payment.id]);
  const error = await servicesA.payment
    .recordExecution(
      payment.id,
      FINANCE_USER_ID,
      executionInput({
        amountCents: 1_000n,
        voucherFileId,
        idempotencyKey: "spot-execution-cash-short-key"
      })
    )
    .then(
      () => null,
      (caught) => caught
    );
  assert(
    error?.message ===
      "项目现金不足，当前最多可实际支付 0 分",
    `现金不足必须固定中文阻断，实际 ${errorText(error)}`
  );
  const after = await readExecutionFacts([payment.id]);
  assertUnchanged(before[0], after[0], "现金不足付款");
  assertUnchanged(before[1], after[1], "现金不足 execution");
  assertUnchanged(before[2], after[2], "现金不足 audit");
  console.log(
    "ok spot execution cash shortage: transaction leaves payment/execution/audit unchanged"
  );
}

function createBarrier(parties, timeoutMs = 5_000) {
  let arrived = 0;
  const gate = deferred();
  const timer = setTimeout(
    () => gate.reject(new Error("原始 P2034 并发屏障超时")),
    timeoutMs
  );
  return async () => {
    arrived += 1;
    if (arrived === parties) {
      clearTimeout(timer);
      gate.resolve();
    }
    await gate.promise;
  };
}

async function verifyRawP2034Sentinel() {
  const account = await clientA.supplierBalanceAccount.create({
    data: {
      id: "spot-concurrency-p2034-account",
      projectId: PROJECT_ID,
      supplierKey: "spot-concurrency-p2034-supplier",
      supplierNameSnapshot: "P2034 哨兵供应商",
      availableAmountCents: 100n,
      reservedAmountCents: 0n
    }
  });
  const barrier = createBarrier(2);
  const mutate = (client) =>
    client.$transaction(
      async (tx) => {
        const snapshot =
          await tx.supplierBalanceAccount.findUniqueOrThrow({
            where: { id: account.id }
          });
        await barrier();
        await tx.supplierBalanceAccount.update({
          where: { id: account.id },
          data: {
            availableAmountCents:
              snapshot.availableAmountCents + 1n
          }
        });
      },
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 15_000
      }
    );
  const results = await Promise.allSettled([
    mutate(clientA),
    mutate(clientB)
  ]);
  assertOneWinner(results, "原始 PostgreSQL Serializable 冲突哨兵", {
    rawP2034: true
  });
  const persisted =
    await clientA.supplierBalanceAccount.findUniqueOrThrow({
      where: { id: account.id }
    });
  assertBigint(
    persisted.availableAmountCents,
    101n,
    "P2034 哨兵最终金额"
  );
  console.log(
    "ok raw P2034 sentinel: PostgreSQL 16 Serializable conflict preserved by Prisma"
  );
}

async function main() {
  assertLocalRuntime();
  await Promise.all([clientA.$connect(), clientB.$connect()]);
  const servicesA = servicesFor(clientA);
  const servicesB = servicesFor(clientB);
  await seedVerificationFacts();
  await verifyCumulativeCapacityCompetition(servicesA, servicesB);
  await verifyBalanceCompetitionAndRelease(servicesA, servicesB);
  await verifyMismatchedReservationReleaseFailsClosed(servicesA);
  await verifyExecutionRemainingCompetition(
    servicesA,
    servicesB
  );
  await verifyExecutionIdempotencyConcurrency(
    servicesA,
    servicesB
  );
  await verifyExecutionVoucherUniqueness(
    servicesA,
    servicesB
  );
  await verifyExecutionProjectSerialization(
    servicesA,
    servicesB
  );
  await verifyExecutionCashShortageZeroWrite(servicesA);
  await verifyRawP2034Sentinel();
  console.log(
    "零星采购真实 PostgreSQL 16 并发验收通过：付款提交、余额、实际付款上限、幂等、凭证唯一、项目现金串行、现金不足零写、P2034"
  );
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await Promise.allSettled([
        clientA.$disconnect(),
        clientB.$disconnect()
      ]);
    });
}
