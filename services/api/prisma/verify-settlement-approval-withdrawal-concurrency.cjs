#!/usr/bin/env node
"use strict";

const { Prisma, PrismaClient } = require("@prisma/client");
const {
  DATABASE_NAME,
  assertVerificationScope,
  comparable,
  reviewInput,
  settlementApprovalNodes,
  twoNodeSettlementApprovalNodes,
  withdrawalCoordinates
} = require("./settlement-approval-withdrawal-concurrency-fixtures.cjs");

const PROJECT_ID = "settlement-withdrawal-concurrency-project";
const APPLICANT_USER_ID =
  "settlement-withdrawal-concurrency-applicant";
const APPROVER_USER_ID =
  "settlement-withdrawal-concurrency-approver";
const OUTSIDER_USER_ID =
  "settlement-withdrawal-concurrency-outsider";
const CONTRACT_ID = "settlement-withdrawal-concurrency-contract";
const CONTRACT_VERSION_ID =
  "settlement-withdrawal-concurrency-contract-version";
const PAYMENT_TERMS_VERSION_ID =
  "settlement-withdrawal-concurrency-payment-terms";
let settlementFixtureSequence = 0;

let clientA;
let clientB;
let observerClient;
let AuditService;
let SettlementService;

function loadRuntimeServices() {
  if (!AuditService || !SettlementService) {
    ({ AuditService } = require("../dist/audit/audit.service"));
    ({ SettlementService } = require(
      "../dist/settlement/settlement.service"
    ));
  }
}

function createAuditService() {
  loadRuntimeServices();
  return new AuditService();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function errorText(error) {
  if (error && typeof error === "object") {
    if (typeof error.getResponse === "function") {
      return JSON.stringify(error.getResponse());
    }
    if (typeof error.message === "string") return error.message;
  }
  return String(error);
}

function capture(promise) {
  return promise.then(
    (value) => ({ status: "fulfilled", value }),
    (reason) => ({ status: "rejected", reason })
  );
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

async function waitFor(promise, label, timeoutMs = 10_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} 在 ${timeoutMs}ms 内未到达`)),
          timeoutMs
        );
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function assertLocalRuntime() {
  assertVerificationScope(process.env);
  const databaseUrlText = process.env.DATABASE_URL ?? "";
  let databaseUrl;
  try {
    databaseUrl = new URL(databaseUrlText);
  } catch {
    throw new Error("结算审批撤回并发门 DATABASE_URL 不是有效 URL");
  }
  assert(
    ["postgresql:", "postgres:"].includes(databaseUrl.protocol),
    "结算审批撤回并发门只能连接 PostgreSQL"
  );
  assert(
    ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
      databaseUrl.hostname
    ),
    "结算审批撤回并发门拒绝连接非本机数据库"
  );
  assert(
    databaseUrl.pathname === `/${DATABASE_NAME}`,
    "结算审批撤回并发门只允许连接固定的一次性专库"
  );
  assert(
    process.env.NODE_ENV === "test",
    "结算审批撤回并发门要求 NODE_ENV=test"
  );
  assert(
    (process.env.FILE_STORAGE_DRIVER ?? "").toLowerCase() === "local",
    "结算审批撤回并发门只允许本地文件存储"
  );
  assert(
    process.env.SETTLEMENT_APPROVAL_WITHDRAWAL_DATABASE_URL ===
      databaseUrlText,
    "结算审批撤回并发门要求显式重复确认专库 URL"
  );
}

async function seedBaseFacts() {
  await clientA.project.create({
    data: {
      id: PROJECT_ID,
      code: "SETTLEMENT-WITHDRAWAL-CONCURRENCY",
      name: "结算审批撤回 PostgreSQL 并发门临时项目"
    }
  });
  await clientA.user.createMany({
    data: [
      {
        id: APPLICANT_USER_ID,
        name: "结算审批撤回并发门申请人",
        isActive: true,
        mustChangePassword: false
      },
      {
        id: APPROVER_USER_ID,
        name: "结算审批撤回并发门审批人",
        isActive: true,
        mustChangePassword: false
      },
      {
        id: OUTSIDER_USER_ID,
        name: "结算审批撤回并发门无权账号",
        isActive: true,
        mustChangePassword: false
      }
    ]
  });
  await clientA.projectMember.create({
    data: {
      projectId: PROJECT_ID,
      userId: APPROVER_USER_ID,
      positionKey: "contract_director"
    }
  });
  await clientA.contract.create({
    data: {
      id: CONTRACT_ID,
      projectId: PROJECT_ID,
      code: "HT-SETTLEMENT-WITHDRAWAL-CONCURRENCY",
      name: "结算审批撤回并发门临时合同",
      counterparty: "结算审批撤回并发门临时相对方"
    }
  });
  await clientA.contractVersion.create({
    data: {
      id: CONTRACT_VERSION_ID,
      contractId: CONTRACT_ID,
      versionNo: 1,
      changeType: "original",
      status: "effective",
      amountCents: 100_000n,
      draftData: {},
      templateSnapshot: {},
      clauseSnapshot: {}
    }
  });
  await clientA.paymentTermsVersion.create({
    data: {
      id: PAYMENT_TERMS_VERSION_ID,
      contractId: CONTRACT_ID,
      contractVersionId: CONTRACT_VERSION_ID,
      versionNo: 1,
      status: "effective",
      originalText: "结算审批撤回并发门临时付款条款"
    }
  });
}

function settlementPeriodLabel(sequence) {
  assert(
    Number.isInteger(sequence) && sequence > 0,
    "结算审批撤回并发门期间序号必须为正整数"
  );
  return `WITHDRAWAL-GATE-${sequence}`;
}

async function createSettlementFixture(label, options = {}) {
  settlementFixtureSequence += 1;
  const settlementId = `settlement-withdrawal-${label}`;
  const settlement = await clientA.settlement.create({
    data: {
      id: settlementId,
      projectId: PROJECT_ID,
      contractId: CONTRACT_ID,
      contractVersionId: CONTRACT_VERSION_ID,
      paymentTermsVersionId: PAYMENT_TERMS_VERSION_ID,
      code: `JS-WITHDRAW-${label.toUpperCase()}`,
      periodLabel: settlementPeriodLabel(
        settlementFixtureSequence
      ),
      status: "approval_pending",
      amountCents: 10_000n,
      payableAmountCents: 8_000n,
      paidAmountCents: 0n,
      governanceVersion: null
    }
  });
  const approval = await clientA.approvalInstance.create({
    data: {
      id: `${settlementId}-approval`,
      flowType: "settlement.approve",
      businessType: "settlement",
      businessId: settlement.id,
      status: "in_progress",
      currentNodeIndex: 0,
      frozenNodes:
        options.approvalNodes ?? settlementApprovalNodes(),
      applicantUserId: APPLICANT_USER_ID
    }
  });
  const quotaUsages = options.quotaUsages ?? [];
  if (quotaUsages.length > 0) {
    await clientA.projectSettlementExceptionQuotaUsage.createMany({
      data: quotaUsages.map((usage, index) => ({
        id: `${settlementId}-quota-usage-${index + 1}`,
        quotaId: `${settlementId}-quota-${index + 1}`,
        settlementId: settlement.id,
        projectId: PROJECT_ID,
        contractId: CONTRACT_ID,
        amountCents: usage.amountCents,
        status: usage.status
      }))
    });
  }
  return {
    settlementId: settlement.id,
    approvalInstanceId: approval.id,
    expectedSettlementUpdatedAt: settlement.updatedAt.toISOString(),
    expectedApprovalInstanceId: approval.id,
    expectedNodeIndex: approval.currentNodeIndex,
    expectedApprovalUpdatedAt: approval.updatedAt.toISOString()
  };
}

function createServicePrisma(client, options = {}) {
  return {
    approvalInstance: {
      findFirst: (input) => client.approvalInstance.findFirst(input)
    },
    $transaction: (operation, transactionOptions) => {
      options.beforeTransaction?.();
      return client.$transaction(
        async (tx) => {
          if (options.backendPid) {
            const rows = await tx.$queryRaw(
              Prisma.sql`SELECT pg_backend_pid()::int AS "pid"`
            );
            options.backendPid.resolve(Number(rows[0]?.pid));
          }
          const serviceTx = options.transformTx
            ? options.transformTx(tx)
            : tx;
          return operation(serviceTx);
        },
        {
          ...(transactionOptions ?? {}),
          maxWait: 10_000,
          timeout: 20_000
        }
      );
    }
  };
}

function createSettlementService(client, audit, options = {}) {
  loadRuntimeServices();
  return new SettlementService(
    createServicePrisma(client, options),
    audit
  );
}

function pausingAudit(action, entered, release) {
  const persistedAudit = createAuditService();
  let paused = false;
  return {
    record: async (tx, input) => {
      await persistedAudit.record(tx, input);
      if (input.action === action && !paused) {
        paused = true;
        entered.resolve(undefined);
        await release.promise;
      }
    }
  };
}

async function observeDirectBlock(firstPid, secondPid) {
  let bestSnapshot = [];
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const sessions = await observerClient.$queryRaw(
      Prisma.sql`
        SELECT
          pid::int AS "pid",
          wait_event_type AS "waitEventType",
          pg_blocking_pids(pid) AS "blockingPids",
          query
        FROM pg_stat_activity
        WHERE pid IN (${firstPid}, ${secondPid})
      `
    );
    const second = sessions.find(
      (session) => Number(session.pid) === secondPid
    );
    const blockers = Array.isArray(second?.blockingPids)
      ? second.blockingPids.map(Number)
      : [];
    bestSnapshot = sessions.map((session) => ({
      pid: Number(session.pid),
      waitEventType: session.waitEventType,
      blockingPids: Array.isArray(session.blockingPids)
        ? session.blockingPids.map(Number)
        : [],
      query: String(session.query).replace(/\s+/gu, " ").slice(0, 180)
    }));
    if (
      second?.waitEventType === "Lock" &&
      blockers.includes(firstPid)
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `未观察到结算审批撤回 backend ${secondPid} 被 ${firstPid} 直接阻塞；` +
      `最接近快照 ${JSON.stringify(bestSnapshot)}`
  );
}

async function runObservedRace({
  firstAuditAction,
  firstOperation,
  secondOperation
}) {
  const firstBackendPid = deferred();
  const secondBackendPid = deferred();
  const firstAuditEntered = deferred();
  const releaseFirstAudit = deferred();
  const firstService = createSettlementService(
    clientA,
    pausingAudit(
      firstAuditAction,
      firstAuditEntered,
      releaseFirstAudit
    ),
    { backendPid: firstBackendPid }
  );
  const secondService = createSettlementService(
    clientB,
    createAuditService(),
    { backendPid: secondBackendPid }
  );
  let firstResultPromise;
  let secondResultPromise;
  let blockError;
  try {
    firstResultPromise = capture(firstOperation(firstService));
    await waitFor(
      firstAuditEntered.promise,
      `首个事务审计 ${firstAuditAction}`
    );
    const firstPid = await waitFor(
      firstBackendPid.promise,
      "首个 PostgreSQL backend PID"
    );
    secondResultPromise = capture(secondOperation(secondService));
    const secondPid = await waitFor(
      secondBackendPid.promise,
      "第二个 PostgreSQL backend PID"
    );
    assert(
      Number.isInteger(firstPid) &&
        Number.isInteger(secondPid) &&
        firstPid !== secondPid,
      "结算审批撤回并发门必须捕获两个独立 backend PID"
    );
    try {
      await observeDirectBlock(firstPid, secondPid);
    } catch (error) {
      blockError = error;
    }
  } finally {
    releaseFirstAudit.resolve(undefined);
  }
  const firstResult = firstResultPromise
    ? await firstResultPromise
    : { status: "rejected", reason: new Error("首个事务未启动") };
  const secondResult = secondResultPromise
    ? await secondResultPromise
    : { status: "rejected", reason: new Error("第二个事务未启动") };
  if (blockError) throw blockError;
  return [firstResult, secondResult];
}

async function readFacts(fixture) {
  const approvalInstances = await clientA.approvalInstance.findMany({
    where: {
      businessType: "settlement",
      businessId: fixture.settlementId,
      flowType: "settlement.approve"
    },
    orderBy: { id: "asc" }
  });
  const approvalInstanceIds = approvalInstances.map(
    (instance) => instance.id
  );
  const [settlement, actionLogs, quotaUsages, auditLogs] =
    await Promise.all([
      clientA.settlement.findUnique({
        where: { id: fixture.settlementId }
      }),
      clientA.approvalActionLog.findMany({
        where: {
          approvalInstanceId: { in: approvalInstanceIds }
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }),
      clientA.projectSettlementExceptionQuotaUsage.findMany({
        where: { settlementId: fixture.settlementId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      }),
      clientA.auditLog.findMany({
        where: {
          businessType: "settlement",
          businessId: fixture.settlementId
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      })
    ]);
  return {
    settlement,
    approvalInstances,
    actionLogs,
    quotaUsages,
    auditLogs
  };
}

function assertFactsUnchanged(before, after, label) {
  assert(
    comparable(after) === comparable(before),
    `${label} 必须保持 Settlement/Approval/ActionLog/quota/Audit 全部不变`
  );
}

function assertWithdrawalConflict(error, label) {
  assert(
    typeof error?.getStatus === "function" &&
      error.getStatus() === 409 &&
      error?.getResponse?.()?.code ===
        "SETTLEMENT_APPROVAL_WITHDRAWAL_CONFLICT",
    `${label} 必须返回稳定 409 SETTLEMENT_APPROVAL_WITHDRAWAL_CONFLICT，实际 ${errorText(
      error
    )}`
  );
}

function assertOneWinner(results, label) {
  assert(
    results[0].status === "fulfilled" &&
      results[1].status === "rejected",
    `${label} 必须按编排顺序一胜一败，实际 ${results
      .map((result) => `${result.status}:${
        result.status === "rejected" ? errorText(result.reason) : "ok"
      }`)
      .join("/")}`
  );
}

function actions(facts) {
  return facts.auditLogs.map((audit) => audit.action).sort();
}

function assertQuotaState(facts, status, label) {
  assert(
    facts.quotaUsages.length === 2 &&
      facts.quotaUsages.every((usage) => usage.status === status),
    `${label} 的两条额度占用应全部为 ${status}`
  );
}

async function verifySameCoordinateDoubleWithdrawal() {
  const fixture = await createSettlementFixture("double", {
    quotaUsages: [
      { amountCents: 100n, status: "occupied" },
      { amountCents: 200n, status: "occupied" }
    ]
  });
  const input = withdrawalCoordinates(fixture);
  const results = await runObservedRace({
    firstAuditAction: "settlement.approval.withdraw",
    firstOperation: (service) =>
      service.withdrawApproval(
        fixture.settlementId,
        APPLICANT_USER_ID,
        input
      ),
    secondOperation: (service) =>
      service.withdrawApproval(
        fixture.settlementId,
        APPLICANT_USER_ID,
        input
      )
  });
  assertOneWinner(results, "同坐标双撤回");
  assertWithdrawalConflict(results[1].reason, "同坐标双撤回 loser");
  const facts = await readFacts(fixture);
  assert(
    facts.settlement?.status === "withdrawn" &&
      facts.approvalInstances.length === 1 &&
      facts.approvalInstances[0].status === "withdrawn" &&
      facts.actionLogs.length === 1 &&
      facts.actionLogs[0].action === "withdraw",
    "同坐标双撤回只能保留 winner 的结算/实例/动作写入"
  );
  assertQuotaState(facts, "released", "同坐标双撤回 winner");
  assert(
    actions(facts).join(",") ===
      [
        "settlement.approval.withdraw",
        "settlement.exception_quota.release.withdraw"
      ].sort().join(","),
    "同坐标双撤回只能保留一次额度释放审计和一次主审计"
  );
  console.log(
    "ok settlement same-coordinate double withdrawal: direct block, one winner, one stable 409 loser"
  );
}

const REVIEW_EXPECTATIONS = {
  approve: {
    auditAction: "settlement.approval.approve",
    settlementStatus: "approved_pending_archive",
    instanceStatus: "approved",
    action: "approve",
    quotaStatus: "occupied",
    releaseAuditAction: null
  },
  reject: {
    auditAction: "settlement.approval.reject",
    settlementStatus: "approval_rejected",
    instanceStatus: "rejected",
    action: "reject",
    quotaStatus: "released",
    releaseAuditAction: "settlement.exception_quota.release.reject"
  },
  return_to_applicant: {
    auditAction: "settlement.approval.return_to_applicant",
    settlementStatus: "approval_rejected",
    instanceStatus: "returned_to_applicant",
    action: "return_to_applicant",
    quotaStatus: "released",
    releaseAuditAction:
      "settlement.exception_quota.release.return_to_applicant"
  }
};

async function verifyReviewWins(decision) {
  const expected = REVIEW_EXPECTATIONS[decision];
  const fixture = await createSettlementFixture(
    `review-${decision.replaceAll("_", "-")}-wins`,
    {
      quotaUsages: [
        { amountCents: 100n, status: "occupied" },
        { amountCents: 200n, status: "occupied" }
      ]
    }
  );
  const results = await runObservedRace({
    firstAuditAction: expected.auditAction,
    firstOperation: (service) =>
      service.reviewApproval(
        fixture.settlementId,
        APPROVER_USER_ID,
        reviewInput(decision)
      ),
    secondOperation: (service) =>
      service.withdrawApproval(
        fixture.settlementId,
        APPLICANT_USER_ID,
        withdrawalCoordinates(fixture)
      )
  });
  assertOneWinner(results, `${decision} winner × withdraw loser`);
  assertWithdrawalConflict(
    results[1].reason,
    `${decision} winner 后的撤回 loser`
  );
  const facts = await readFacts(fixture);
  assert(
    facts.settlement?.status === expected.settlementStatus &&
      facts.approvalInstances.length === 1 &&
      facts.approvalInstances[0].status === expected.instanceStatus &&
      facts.actionLogs.length === 1 &&
      facts.actionLogs[0].action === expected.action,
    `${decision} winner 后不得混入撤回部分写`
  );
  assertQuotaState(
    facts,
    expected.quotaStatus,
    `${decision} winner`
  );
  assert(
    actions(facts).join(",") ===
      [
        expected.auditAction,
        ...(expected.releaseAuditAction
          ? [expected.releaseAuditAction]
          : [])
      ].sort().join(","),
    `${decision} winner 后撤回 loser 不得留下审计`
  );
  console.log(
    `ok settlement review ${decision} winner: direct block, withdrawal stable 409, zero loser writes`
  );
}

async function verifyWithdrawalWins(decision) {
  const fixture = await createSettlementFixture(
    `withdraw-wins-${decision.replaceAll("_", "-")}`,
    {
      quotaUsages: [
        { amountCents: 100n, status: "occupied" },
        { amountCents: 200n, status: "occupied" }
      ]
    }
  );
  const results = await runObservedRace({
    firstAuditAction: "settlement.approval.withdraw",
    firstOperation: (service) =>
      service.withdrawApproval(
        fixture.settlementId,
        APPLICANT_USER_ID,
        withdrawalCoordinates(fixture)
      ),
    secondOperation: (service) =>
      service.reviewApproval(
        fixture.settlementId,
        APPROVER_USER_ID,
        reviewInput(decision)
      )
  });
  assertOneWinner(results, `withdraw winner × ${decision} loser`);
  const facts = await readFacts(fixture);
  assert(
    facts.settlement?.status === "withdrawn" &&
      facts.approvalInstances.length === 1 &&
      facts.approvalInstances[0].status === "withdrawn" &&
      facts.actionLogs.length === 1 &&
      facts.actionLogs[0].action === "withdraw",
    `撤回 winner 后 ${decision} loser 不得留下部分写`
  );
  assertQuotaState(facts, "released", "撤回 winner");
  assert(
    actions(facts).join(",") ===
      [
        "settlement.approval.withdraw",
        "settlement.exception_quota.release.withdraw"
      ].sort().join(","),
    `撤回 winner 后 ${decision} loser 不得留下审计`
  );
  console.log(
    `ok settlement withdrawal winner vs ${decision}: direct block, one winner, zero loser writes`
  );
}

async function verifyTwoNodeApproveProgressWinsWithdrawal() {
  const fixture = await createSettlementFixture(
    "two-node-approve-progress-wins",
    {
      approvalNodes: twoNodeSettlementApprovalNodes(),
      quotaUsages: [
        { amountCents: 100n, status: "occupied" },
        { amountCents: 200n, status: "occupied" }
      ]
    }
  );
  const results = await runObservedRace({
    firstAuditAction: "settlement.approval.approve",
    firstOperation: (service) =>
      service.reviewApproval(
        fixture.settlementId,
        APPROVER_USER_ID,
        reviewInput("approve")
      ),
    secondOperation: (service) =>
      service.withdrawApproval(
        fixture.settlementId,
        APPLICANT_USER_ID,
        withdrawalCoordinates(fixture)
      )
  });
  assertOneWinner(
    results,
    "两节点中段 approve 推进 winner × withdraw loser"
  );
  assertWithdrawalConflict(
    results[1].reason,
    "两节点中段 approve 推进后的撤回 loser"
  );
  const facts = await readFacts(fixture);
  assert(
    facts.settlement?.status === "approval_pending" &&
      facts.approvalInstances.length === 1 &&
      facts.approvalInstances[0].status === "in_progress" &&
      facts.approvalInstances[0].currentNodeIndex === 1 &&
      facts.actionLogs.length === 1 &&
      facts.actionLogs[0].action === "approve",
    "两节点中段推进必须只保留 approve winner 的节点与动作写入"
  );
  assertQuotaState(facts, "occupied", "两节点中段 approve winner");
  assert(
    actions(facts).join(",") === "settlement.approval.approve",
    "两节点中段推进后撤回 loser 不得留下审计"
  );
  console.log(
    "ok settlement two-node mid-flow approve progression: direct block, withdrawal stable 409, approval_pending retained"
  );
}

async function verifyNonApplicantZeroWrites() {
  const fixture = await createSettlementFixture("non-applicant", {
    quotaUsages: [
      { amountCents: 100n, status: "occupied" },
      { amountCents: 200n, status: "occupied" }
    ]
  });
  const before = await readFacts(fixture);
  let transactionCalls = 0;
  const service = createSettlementService(clientA, createAuditService(), {
    beforeTransaction: () => {
      transactionCalls += 1;
      throw new Error(
        "non-applicant withdrawal entered transaction unexpectedly"
      );
    }
  });
  const error = await service
    .withdrawApproval(
      fixture.settlementId,
      OUTSIDER_USER_ID,
      withdrawalCoordinates(fixture)
    )
    .then(
      () => null,
      (caught) => caught
    );
  assert(
    typeof error?.getStatus === "function" &&
      error.getStatus() === 403 &&
      transactionCalls === 0,
    `非申请人必须返回 403，实际 ${errorText(error)}`
  );
  assertFactsUnchanged(
    before,
    await readFacts(fixture),
    "非申请人撤回"
  );
  console.log(
    "ok settlement non-applicant withdrawal: 403 before transaction and zero writes"
  );
}

async function verifyDuplicateActiveInstanceZeroWrites() {
  const fixture = await createSettlementFixture("duplicate-active", {
    quotaUsages: [
      { amountCents: 100n, status: "occupied" },
      { amountCents: 200n, status: "occupied" }
    ]
  });
  await clientA.approvalInstance.create({
    data: {
      id: `${fixture.settlementId}-duplicate-active-approval`,
      flowType: "settlement.approve",
      businessType: "settlement",
      businessId: fixture.settlementId,
      status: "in_progress",
      currentNodeIndex: 0,
      frozenNodes: settlementApprovalNodes(),
      applicantUserId: APPLICANT_USER_ID
    }
  });
  const before = await readFacts(fixture);
  assert(
    before.approvalInstances.filter(
      (instance) => instance.status === "in_progress"
    ).length === 2,
    "重复活动实例夹具必须精确包含两个 in_progress"
  );
  const service = createSettlementService(
    clientA,
    createAuditService()
  );
  const error = await service
    .withdrawApproval(
      fixture.settlementId,
      APPLICANT_USER_ID,
      withdrawalCoordinates(fixture)
    )
    .then(
      () => null,
      (caught) => caught
    );
  assertWithdrawalConflict(error, "重复活动审批实例");
  const after = await readFacts(fixture);
  assertFactsUnchanged(before, after, "重复活动审批实例");
  assert(
    after.quotaUsages.every(
      (usage) => usage.status === "occupied"
    ) && after.actionLogs.length === 0 && after.auditLogs.length === 0,
    "重复活动审批实例 409 必须保持额度、动作和审计零写"
  );
  console.log(
    "ok settlement duplicate-active withdrawal: stable 409 and all facts unchanged"
  );
}

async function expectCoordinateConflict(fixture, input, label) {
  const before = await readFacts(fixture);
  assert(
    before.quotaUsages.length > 0 &&
      before.quotaUsages.every(
        (usage) => usage.status === "occupied"
      ),
    `${label} 必须以已占用额度为前置夹具`
  );
  const service = createSettlementService(
    clientA,
    createAuditService()
  );
  const error = await service
    .withdrawApproval(
      fixture.settlementId,
      APPLICANT_USER_ID,
      input
    )
    .then(
      () => null,
      (caught) => caught
  );
  assertWithdrawalConflict(error, label);
  const after = await readFacts(fixture);
  assertFactsUnchanged(before, after, label);
  assert(
    after.quotaUsages.every(
      (usage) => usage.status === "occupied"
    ) &&
      !actions(after).some((action) =>
        action.startsWith("settlement.exception_quota.release.")
      ),
    `${label} 不得释放额度或留下释放审计`
  );
}

function createCoordinateDriftFixture(label) {
  return createSettlementFixture(label, {
    quotaUsages: [
      { amountCents: 100n, status: "occupied" }
    ]
  });
}

async function verifyCoordinateDriftZeroWrites() {
  const settlementDrift = await createCoordinateDriftFixture(
    "settlement-coordinate-drift"
  );
  await expectCoordinateConflict(
    settlementDrift,
    {
      ...withdrawalCoordinates(settlementDrift),
      expectedSettlementUpdatedAt: "2026-01-01T00:00:00.000Z"
    },
    "结算 updatedAt 漂移"
  );

  const nodeDrift = await createCoordinateDriftFixture(
    "node-coordinate-drift"
  );
  await expectCoordinateConflict(
    nodeDrift,
    {
      ...withdrawalCoordinates(nodeDrift),
      expectedNodeIndex: 1
    },
    "审批节点漂移"
  );

  const approvalTimeDrift = await createCoordinateDriftFixture(
    "approval-time-drift"
  );
  await expectCoordinateConflict(
    approvalTimeDrift,
    {
      ...withdrawalCoordinates(approvalTimeDrift),
      expectedApprovalUpdatedAt: "2026-01-01T00:00:00.000Z"
    },
    "审批 updatedAt 漂移"
  );

  const instanceDrift = await createCoordinateDriftFixture(
    "approval-instance-drift"
  );
  const staleInstance = await clientA.approvalInstance.create({
    data: {
      id: `${instanceDrift.settlementId}-stale-approval`,
      flowType: "settlement.approve",
      businessType: "settlement",
      businessId: instanceDrift.settlementId,
      status: "withdrawn",
      currentNodeIndex: 0,
      frozenNodes: settlementApprovalNodes(),
      applicantUserId: APPLICANT_USER_ID
    }
  });
  await expectCoordinateConflict(
    instanceDrift,
    {
      ...withdrawalCoordinates(instanceDrift),
      expectedApprovalInstanceId: staleInstance.id,
      expectedApprovalUpdatedAt: staleInstance.updatedAt.toISOString()
    },
    "审批实例 ID 漂移"
  );
  console.log(
    "ok settlement withdrawal four-coordinate drift: every case stable 409 and zero writes"
  );
}

async function verifyQuotaReleaseOnce() {
  const fixture = await createSettlementFixture("quota-release-once", {
    quotaUsages: [
      { amountCents: 100n, status: "occupied" },
      { amountCents: 200n, status: "occupied" },
      { amountCents: 300n, status: "released" }
    ]
  });
  const service = createSettlementService(
    clientA,
    createAuditService()
  );
  await service.withdrawApproval(
    fixture.settlementId,
    APPLICANT_USER_ID,
    withdrawalCoordinates(fixture)
  );
  const facts = await readFacts(fixture);
  const releaseAudits = facts.auditLogs.filter(
    (audit) =>
      audit.action ===
      "settlement.exception_quota.release.withdraw"
  );
  assert(
    facts.quotaUsages.length === 3 &&
      facts.quotaUsages.every(
        (usage) => usage.status === "released"
      ) &&
      releaseAudits.length === 1 &&
      releaseAudits[0].metadata?.releasedUsageCount === 2 &&
      facts.auditLogs.filter(
        (audit) => audit.action === "settlement.approval.withdraw"
      ).length === 1,
    "撤回必须只释放 occupied 行一次，并精确记录 releasedUsageCount=2"
  );
  console.log(
    "ok settlement quota release once: two occupied rows released, pre-released row retained, one release audit"
  );
}

function actionLogFailureInjection(evidence) {
  return (tx) =>
    new Proxy(tx, {
      get(target, property, receiver) {
        if (property !== "approvalActionLog") {
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function"
            ? value.bind(target)
            : value;
        }
        return {
          create: async (input) => {
            await tx.approvalActionLog.create(input);
            const [settlement, instance, actionCount] =
              await Promise.all([
                tx.settlement.findUnique({
                  where: { id: evidence.settlementId }
                }),
                tx.approvalInstance.findUnique({
                  where: { id: evidence.approvalInstanceId }
                }),
                tx.approvalActionLog.count({
                  where: {
                    approvalInstanceId:
                      evidence.approvalInstanceId
                  }
                })
              ]);
            assert(
              settlement?.status === "withdrawn" &&
                instance?.status === "withdrawn" &&
                actionCount === 1,
              "ActionLog 故障注入前必须已经写入结算、实例和动作"
            );
            evidence.observed = true;
            throw new Error(
              "injected settlement withdrawal action-log failure"
            );
          }
        };
      }
    });
}

function auditFailureInjection(action, expectedAuditCount, evidence) {
  const persistedAudit = createAuditService();
  return {
    record: async (tx, input) => {
      await persistedAudit.record(tx, input);
      if (input.action !== action) return;
      const [settlement, instance, actionCount, quotas, audits] =
        await Promise.all([
          tx.settlement.findUnique({
            where: { id: input.businessId }
          }),
          tx.approvalInstance.findFirst({
            where: {
              businessType: "settlement",
              businessId: input.businessId,
              flowType: "settlement.approve"
            }
          }),
          tx.approvalActionLog.count({
            where: {
              approvalInstanceId: evidence.approvalInstanceId
            }
          }),
          tx.projectSettlementExceptionQuotaUsage.findMany({
            where: { settlementId: input.businessId }
          }),
          tx.auditLog.findMany({
            where: {
              businessType: "settlement",
              businessId: input.businessId
            }
          })
        ]);
      assert(
        settlement?.status === "withdrawn" &&
          instance?.status === "withdrawn" &&
          actionCount === 1 &&
          quotas.length === 2 &&
          quotas.every((quota) => quota.status === "released") &&
          audits.length === expectedAuditCount,
        `${action} 故障注入点必须位于预期事务中段`
      );
      evidence.observed = true;
      throw new Error(`injected ${action} failure`);
    }
  };
}

async function verifyInjectedFailureRollback({
  label,
  serviceFactory,
  expectedMessage
}) {
  const fixture = await createSettlementFixture(label, {
    quotaUsages: [
      { amountCents: 100n, status: "occupied" },
      { amountCents: 200n, status: "occupied" }
    ]
  });
  const before = await readFacts(fixture);
  const evidence = {
    observed: false,
    settlementId: fixture.settlementId,
    approvalInstanceId: fixture.approvalInstanceId
  };
  const service = serviceFactory(fixture, evidence);
  const error = await service
    .withdrawApproval(
      fixture.settlementId,
      APPLICANT_USER_ID,
      withdrawalCoordinates(fixture)
    )
    .then(
      () => null,
      (caught) => caught
    );
  assert(
    errorText(error).includes(expectedMessage),
    `${label} 必须命中精确故障注入，实际 ${errorText(error)}`
  );
  assert(evidence.observed, `${label} 必须证明故障注入位置`);
  assertFactsUnchanged(before, await readFacts(fixture), label);
}

async function verifyActionLogFailureRollsBack() {
  await verifyInjectedFailureRollback({
    label: "action-log-rollback",
    serviceFactory: (_fixture, evidence) =>
      createSettlementService(clientA, createAuditService(), {
        transformTx: actionLogFailureInjection(evidence)
      }),
    expectedMessage:
      "injected settlement withdrawal action-log failure"
  });
  console.log(
    "ok settlement ActionLog failure: settlement/instance/action all rolled back"
  );
}

async function verifyQuotaReleaseAuditFailureRollsBack() {
  await verifyInjectedFailureRollback({
    label: "quota-audit-rollback",
    serviceFactory: (_fixture, evidence) =>
      createSettlementService(
        clientA,
        auditFailureInjection(
          "settlement.exception_quota.release.withdraw",
          1,
          evidence
        )
      ),
    expectedMessage:
      "injected settlement.exception_quota.release.withdraw failure"
  });
  console.log(
    "ok settlement quota-release Audit failure: settlement/instance/action/quota/audit all rolled back"
  );
}

async function verifyFinalAuditFailureRollsBack() {
  await verifyInjectedFailureRollback({
    label: "final-audit-rollback",
    serviceFactory: (_fixture, evidence) =>
      createSettlementService(
        clientA,
        auditFailureInjection(
          "settlement.approval.withdraw",
          2,
          evidence
        )
      ),
    expectedMessage:
      "injected settlement.approval.withdraw failure"
  });
  console.log(
    "ok settlement final Audit failure: settlement/instance/action/quota/both audits all rolled back"
  );
}

async function main() {
  assertLocalRuntime();
  clientA = new PrismaClient();
  clientB = new PrismaClient();
  observerClient = new PrismaClient();
  await Promise.all([
    clientA.$connect(),
    clientB.$connect(),
    observerClient.$connect()
  ]);
  try {
    await seedBaseFacts();
    await verifySameCoordinateDoubleWithdrawal();
    for (const decision of [
      "approve",
      "reject",
      "return_to_applicant"
    ]) {
      await verifyReviewWins(decision);
      await verifyWithdrawalWins(decision);
    }
    await verifyTwoNodeApproveProgressWinsWithdrawal();
    await verifyNonApplicantZeroWrites();
    await verifyDuplicateActiveInstanceZeroWrites();
    await verifyCoordinateDriftZeroWrites();
    await verifyQuotaReleaseOnce();
    await verifyActionLogFailureRollsBack();
    await verifyQuotaReleaseAuditFailureRollsBack();
    await verifyFinalAuditFailureRollsBack();
    console.log(
      "结算审批撤回 PostgreSQL 16 门禁通过：空库业务夹具；双撤回单赢家；撤回与 approve/reject/return 双胜序固定锁序单赢家；非申请人/四坐标漂移零写；额度只释放一次；ActionLog、额度释放 Audit、最终 Audit 三个中段故障全事务回滚"
    );
  } finally {
    await Promise.allSettled([
      clientA.$disconnect(),
      clientB.$disconnect(),
      observerClient.$disconnect()
    ]);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  assertLocalRuntime,
  settlementPeriodLabel,
  main
};
