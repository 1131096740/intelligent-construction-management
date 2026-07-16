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

const DATABASE_NAME = "jiangkong_spot_procurement_concurrency_verify";
const PROJECT_ID = "concurrency-project";
const HANDLER_USER_ID = "concurrency-material-staff";
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
    pilotProjectIds.has(PROJECT_ID),
    "零星采购并发验收未显式开放专用临时项目"
  );
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
      confirmPassword: async () => {
        throw new Error("并发验收不应进入审批自审密码校验");
      }
    }
  );
  return { balances, payment };
}

async function seedVerificationFacts() {
  await clientA.project.create({
    data: {
      id: PROJECT_ID,
      code: "CONCURRENCY-VERIFY",
      name: "零星采购 PostgreSQL 并发验收临时项目"
    }
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
}

async function createApprovedProcurement(prisma, input) {
  await prisma.spotProcurement.create({
    data: {
      id: input.procurementId,
      projectId: PROJECT_ID,
      code: input.code,
      supplierPartyId: null,
      supplierKey: input.supplierKey,
      supplierNameSnapshot: input.supplierName,
      applicantUserId: HANDLER_USER_ID,
      handlerUserId: HANDLER_USER_ID,
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
      handlerUserId: HANDLER_USER_ID,
      totalAmountCents: input.totalAmountCents,
      submittedAt: new Date(),
      approvedAt: new Date(),
      createdByUserId: HANDLER_USER_ID
    }
  });
  await prisma.spotProcurement.update({
    where: { id: input.procurementId },
    data: { currentVersionId: input.versionId }
  });
}

async function createPaymentDraft(prisma, input) {
  return prisma.spotProcurementPayment.create({
    data: {
      id: input.paymentId,
      projectId: PROJECT_ID,
      procurementId: input.procurementId,
      procurementVersionId: input.versionId,
      code: input.code,
      status: "draft",
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
      handlerUserId: HANDLER_USER_ID,
      createdByUserId: HANDLER_USER_ID
    }
  });
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
            sequenceInputs[0].paymentId,
            3_000n,
            HANDLER_USER_ID,
            "本地并发释放验收 A"
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
            sequenceInputs[0].paymentId,
            3_000n,
            HANDLER_USER_ID,
            "本地并发释放验收 B"
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
  await verifyRawP2034Sentinel();
  console.log(
    "零星采购真实 PostgreSQL 16 并发验收通过：累计额度、余额竞争、流水序号、严格释放、P2034"
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
