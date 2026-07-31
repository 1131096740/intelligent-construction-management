#!/usr/bin/env node
"use strict";

const { Prisma, PrismaClient } = require("@prisma/client");
const { AuditService } = require("../dist/audit/audit.service");
const {
  ProjectExpenseService
} = require("../dist/project-expense/project-expense.service");

const DATABASE_NAME =
  "jiangkong_project_expense_withdrawal_concurrency";
const PROJECT_ID = "project-expense-withdrawal-project";
const APPLICANT_USER_ID = "project-expense-withdrawal-applicant";
const APPROVER_USER_ID = "project-expense-withdrawal-approver";
const REQUESTED_AMOUNT_CENTS = 1_000n;

const clientA = new PrismaClient();
const clientB = new PrismaClient();
const observerClient = new PrismaClient();

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function capture(promise) {
  return promise.then(
    (value) => ({ status: "fulfilled", value }),
    (reason) => ({ status: "rejected", reason })
  );
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
  const databaseUrlText = process.env.DATABASE_URL ?? "";
  let databaseUrl;
  try {
    databaseUrl = new URL(databaseUrlText);
  } catch {
    throw new Error(
      "项目支出撤回并发验收 DATABASE_URL 不是有效 URL"
    );
  }
  assert(
    ["postgresql:", "postgres:"].includes(databaseUrl.protocol),
    "项目支出撤回并发验收只能连接 PostgreSQL"
  );
  assert(
    ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
      databaseUrl.hostname
    ),
    "项目支出撤回并发验收拒绝连接非本机数据库"
  );
  assert(
    databaseUrl.pathname === `/${DATABASE_NAME}`,
    "项目支出撤回并发验收只允许连接专用的一次性临时数据库"
  );
  assert(
    process.env.NODE_ENV === "test",
    "项目支出撤回并发验收要求 NODE_ENV=test"
  );
}

function twoNodeApproval() {
  return [
    {
      name: "项目经理",
      mode: "any",
      roleKeys: ["project_manager"]
    },
    {
      name: "财务总监",
      mode: "any",
      roleKeys: ["finance_director"]
    }
  ];
}

async function seedBaseFacts() {
  await clientA.project.create({
    data: {
      id: PROJECT_ID,
      code: "PROJECT-EXPENSE-WITHDRAWAL-CONCURRENCY",
      name: "项目支出撤回 PostgreSQL 并发验收临时项目"
    }
  });
  await clientA.user.createMany({
    data: [
      {
        id: APPLICANT_USER_ID,
        name: "项目支出撤回验收申请人",
        isActive: true,
        mustChangePassword: false
      },
      {
        id: APPROVER_USER_ID,
        name: "项目支出撤回验收审批人",
        isActive: true,
        mustChangePassword: false
      }
    ]
  });
  await clientA.projectMember.create({
    data: {
      projectId: PROJECT_ID,
      userId: APPROVER_USER_ID,
      positionKey: "project_manager"
    }
  });
}

async function createExpenseFixture(label, options = {}) {
  const expenseId = `project-expense-withdrawal-${label}`;
  const approvalInstanceId = `${expenseId}-approval`;
  const expense = await clientA.projectExpenseRequest.create({
    data: {
      id: expenseId,
      projectId: PROJECT_ID,
      code: `ZC-WITHDRAW-${label.toUpperCase()}`,
      expenseType: "reimbursement",
      expenseSubtype: "reimbursement",
      paymentSubject: "建工智管",
      reason: `项目支出撤回并发验收 ${label}`,
      requestedAmountCents: REQUESTED_AMOUNT_CENTS,
      approvedAmountCents: null,
      paidAmountCents: 0n,
      paymentMethod: "bank_transfer",
      handlerUserId: APPLICANT_USER_ID,
      applicantUserId: APPLICANT_USER_ID,
      status: "approval_pending"
    }
  });
  const approval = await clientA.approvalInstance.create({
    data: {
      id: approvalInstanceId,
      flowType: "project_expense.approve",
      businessType: "project_expense_request",
      businessId: expenseId,
      status: "in_progress",
      currentNodeIndex: 0,
      frozenNodes: options.frozenNodes ?? twoNodeApproval(),
      applicantUserId: APPLICANT_USER_ID
    }
  });
  if (options.duplicateApproval) {
    await clientA.approvalInstance.create({
      data: {
        id: `${approvalInstanceId}-duplicate`,
        flowType: "project_expense.approve",
        businessType: "project_expense_request",
        businessId: expenseId,
        status: "in_progress",
        currentNodeIndex: 0,
        frozenNodes: options.frozenNodes ?? twoNodeApproval(),
        applicantUserId: APPLICANT_USER_ID
      }
    });
  }
  const quotaUsages = options.quotaUsages ?? [];
  if (quotaUsages.length > 0) {
    await clientA.projectExpenseFinancingQuotaUsage.createMany({
      data: quotaUsages.map((usage, index) => ({
        id: `${expenseId}-quota-usage-${index + 1}`,
        quotaId: `${expenseId}-quota-${index + 1}`,
        projectExpenseRequestId: expenseId,
        projectId: PROJECT_ID,
        amountCents: usage.amountCents,
        status: usage.status
      }))
    });
  }
  return {
    expenseId,
    approvalInstanceId,
    expectedExpenseUpdatedAt: expense.updatedAt.toISOString(),
    expectedApprovalInstanceId: approval.id,
    expectedNodeIndex: approval.currentNodeIndex,
    expectedApprovalUpdatedAt: approval.updatedAt.toISOString()
  };
}

function withdrawalInput(fixture) {
  return {
    expectedExpenseUpdatedAt: fixture.expectedExpenseUpdatedAt,
    expectedApprovalInstanceId:
      fixture.expectedApprovalInstanceId,
    expectedNodeIndex: fixture.expectedNodeIndex,
    expectedApprovalUpdatedAt:
      fixture.expectedApprovalUpdatedAt
  };
}

function createServicePrisma(client, backendPid) {
  return {
    $transaction: (operation, options) =>
      client.$transaction(
        async (tx) => {
          if (backendPid) {
            const rows = await tx.$queryRaw(
              Prisma.sql`SELECT pg_backend_pid()::int AS "pid"`
            );
            backendPid.resolve(Number(rows[0]?.pid));
          }
          return operation(tx);
        },
        {
          ...(options ?? {}),
          maxWait: 10_000,
          timeout: 20_000
        }
      )
  };
}

function createExpenseService(client, audit, backendPid) {
  return new ProjectExpenseService(
    createServicePrisma(client, backendPid),
    audit
  );
}

function pausingAudit(action, entered, release) {
  const persistedAudit = new AuditService();
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

function finalWithdrawalAuditFailure() {
  const persistedAudit = new AuditService();
  const evidence = { observedCompletePreFailureState: false };
  const audit = {
    record: async (tx, input) => {
      if (input.action === "project_expense.approval.withdraw") {
        const [
          request,
          instances,
          actionCount,
          quotaUsages,
          auditLogs
        ] = await Promise.all([
          tx.projectExpenseRequest.findUnique({
            where: { id: input.businessId }
          }),
          tx.approvalInstance.findMany({
            where: {
              businessType: "project_expense_request",
              businessId: input.businessId,
              flowType: "project_expense.approve"
            }
          }),
          tx.approvalActionLog.count({
            where: {
              approvalInstanceId: {
                in: await tx.approvalInstance
                  .findMany({
                    where: {
                      businessType: "project_expense_request",
                      businessId: input.businessId,
                      flowType: "project_expense.approve"
                    },
                    select: { id: true }
                  })
                  .then((rows) => rows.map((row) => row.id))
              }
            }
          }),
          tx.projectExpenseFinancingQuotaUsage.findMany({
            where: { projectExpenseRequestId: input.businessId }
          }),
          tx.auditLog.findMany({
            where: {
              businessType: "project_expense_request",
              businessId: input.businessId
            }
          })
        ]);
        assert(
          request?.status === "withdrawn" &&
            instances.length === 1 &&
            instances[0].status === "withdrawn" &&
            actionCount === 1 &&
            quotaUsages.length > 0 &&
            quotaUsages.every(
              (usage) => usage.status === "released"
            ) &&
            auditLogs.length === 1 &&
            auditLogs[0].action ===
              "project_expense.cash_pool.release.withdraw",
          "注入最终主审计故障前必须已执行支出/实例/动作/额度/释放审计写入"
        );
        evidence.observedCompletePreFailureState = true;
        throw new Error("injected final withdrawal audit failure");
      }
      return persistedAudit.record(tx, input);
    }
  };
  return { audit, evidence };
}

async function observeDirectBlock(firstPid, secondPid) {
  let bestSnapshot = [];
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const sessions = await observerClient.$queryRaw(
      Prisma.sql`
        SELECT
          pid::int AS "pid",
          state,
          wait_event_type AS "waitEventType",
          query,
          pg_blocking_pids(pid) AS "blockingPids"
        FROM pg_stat_activity
        WHERE pid IN (${firstPid}, ${secondPid})
      `
    );
    const firstSession = sessions.find(
      (session) => Number(session.pid) === firstPid
    );
    const secondSession = sessions.find(
      (session) => Number(session.pid) === secondPid
    );
    const blockers = Array.isArray(secondSession?.blockingPids)
      ? secondSession.blockingPids.map(Number)
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
      firstSession &&
      secondSession?.waitEventType === "Lock" &&
      blockers.includes(firstPid)
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `未观察到项目支出撤回 backend ${secondPid} 被 ${firstPid} 直接阻塞；` +
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
  const firstService = createExpenseService(
    clientA,
    pausingAudit(
      firstAuditAction,
      firstAuditEntered,
      releaseFirstAudit
    ),
    firstBackendPid
  );
  const secondService = createExpenseService(
    clientB,
    new AuditService(),
    secondBackendPid
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
      "项目支出撤回并发验收必须捕获两个不同的 PostgreSQL backend PID"
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
      businessType: "project_expense_request",
      businessId: fixture.expenseId,
      flowType: "project_expense.approve"
    },
    orderBy: { id: "asc" }
  });
  const approvalInstanceIds = approvalInstances.map(
    (instance) => instance.id
  );
  const [
    expense,
    actionLogs,
    actionLogCount,
    quotaUsages,
    auditLogs
  ] = await Promise.all([
    clientA.projectExpenseRequest.findUnique({
      where: { id: fixture.expenseId }
    }),
    clientA.approvalActionLog.findMany({
      where: {
        approvalInstanceId: { in: approvalInstanceIds }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    }),
    clientA.approvalActionLog.count({
      where: {
        approvalInstanceId: { in: approvalInstanceIds }
      }
    }),
    clientA.projectExpenseFinancingQuotaUsage.findMany({
      where: { projectExpenseRequestId: fixture.expenseId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    }),
    clientA.auditLog.findMany({
      where: {
        businessType: "project_expense_request",
        businessId: fixture.expenseId
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    })
  ]);
  return {
    expense,
    approvalInstances,
    actionLogs,
    actionLogCount,
    quotaUsages,
    auditLogs
  };
}

function sumUsageByStatus(usages, status) {
  return usages
    .filter((usage) => usage.status === status)
    .reduce((sum, usage) => sum + usage.amountCents, 0n);
}

function assertConflict(error, label) {
  assert(
    error &&
      typeof error.getStatus === "function" &&
      error.getStatus() === 409,
    `${label} 必须严格返回 409，实际 ${errorText(error)}`
  );
}

function assertNoWrites(facts, label) {
  assert(
    facts.expense?.status === "approval_pending" &&
      facts.expense.approvedAmountCents === null &&
      facts.expense.paidAmountCents === 0n,
    `${label} 必须保持项目支出原状`
  );
  assert(
    facts.approvalInstances.every(
      (instance) =>
        instance.status === "in_progress" &&
        instance.currentNodeIndex === 0
    ),
    `${label} 不得改写审批实例`
  );
  assert(
    facts.actionLogCount === 0 &&
      facts.actionLogs.length === 0 &&
      facts.auditLogs.length === 0,
    `${label} 不得写入 ActionLog 或 AuditLog`
  );
}

async function verifySameCoordinateDoubleWithdrawal() {
  const fixture = await createExpenseFixture("same-coordinate");
  const input = withdrawalInput(fixture);
  const results = await runObservedRace({
    firstAuditAction: "project_expense.approval.withdraw",
    firstOperation: (service) =>
      service.withdrawApproval(
        PROJECT_ID,
        fixture.expenseId,
        APPLICANT_USER_ID,
        input
      ),
    secondOperation: (service) =>
      service.withdrawApproval(
        PROJECT_ID,
        fixture.expenseId,
        APPLICANT_USER_ID,
        input
      )
  });
  assert(
    results[0].status === "fulfilled" &&
      results[1].status === "rejected",
    `同坐标双撤回必须一胜一败，实际 ${results
      .map((result) => result.status)
      .join("/")}`
  );
  assert(
    typeof results[1].reason?.getStatus === "function" &&
      results[1].reason.getStatus() === 400 &&
      errorText(results[1].reason).includes(
        "当前项目支出状态不可撤回"
      ),
    `同坐标 loser 必须因 winner 已撤回的权威状态失败，实际 ${errorText(
      results[1].reason
    )}`
  );
  const facts = await readFacts(fixture);
  assert(
    facts.expense?.status === "withdrawn" &&
      facts.approvalInstances.length === 1 &&
      facts.approvalInstances[0].status === "withdrawn",
    "同坐标双撤回 winner 必须只撤回精确支出单与审批实例"
  );
  assert(
    facts.actionLogCount === 1 &&
      facts.actionLogs[0].action === "withdraw" &&
      facts.auditLogs.length === 1 &&
      facts.auditLogs[0].action ===
        "project_expense.approval.withdraw",
    "同坐标双撤回必须只保留 winner 的一条动作和一条主审计"
  );
  console.log(
    "ok project expense same-coordinate double withdrawal: pg_blocking_pids direct block, one winner/one loser, one action/audit"
  );
}

async function verifyNodeAdvanceWins() {
  const fixture = await createExpenseFixture("node-advance-wins");
  const staleInput = withdrawalInput(fixture);
  const results = await runObservedRace({
    firstAuditAction: "project_expense.approval.approve",
    firstOperation: (service) =>
      service.reviewApproval(
        PROJECT_ID,
        fixture.expenseId,
        APPROVER_USER_ID,
        { decision: "approve" }
      ),
    secondOperation: (service) =>
      service.withdrawApproval(
        PROJECT_ID,
        fixture.expenseId,
        APPLICANT_USER_ID,
        staleInput
      )
  });
  assert(
    results[0].status === "fulfilled" &&
      results[1].status === "rejected",
    "节点推进 winner 与旧坐标撤回 loser 的胜负必须确定"
  );
  assertConflict(results[1].reason, "节点推进后的旧四坐标撤回");
  const facts = await readFacts(fixture);
  const approval = facts.approvalInstances[0];
  assert(
    facts.expense?.status === "approval_pending" &&
      facts.expense.approvedAmountCents === null &&
      facts.expense.paidAmountCents === 0n &&
      facts.approvalInstances.length === 1 &&
      approval.status === "in_progress" &&
      approval.currentNodeIndex === 1,
    "节点推进 winner 必须只将进行中审批从 node0 推到 node1"
  );
  assert(
    facts.actionLogCount === 1 &&
      facts.actionLogs[0].action === "approve" &&
      facts.actionLogs[0].actorUserId === APPROVER_USER_ID &&
      facts.auditLogs.length === 1 &&
      facts.auditLogs[0].action ===
        "project_expense.approval.approve",
    "旧坐标撤回 loser 不得在节点推进 winner 之外留下部分写"
  );
  console.log(
    "ok project expense node-advance winner: pg_blocking_pids direct block, stale four-coordinate withdrawal 409, zero loser writes"
  );
}

async function verifyWithdrawalWinsBeforeNodeAdvance() {
  const fixture = await createExpenseFixture(
    "withdrawal-wins",
    {
      quotaUsages: [
        { amountCents: 250n, status: "occupied" },
        { amountCents: 350n, status: "occupied" }
      ]
    }
  );
  const results = await runObservedRace({
    firstAuditAction: "project_expense.approval.withdraw",
    firstOperation: (service) =>
      service.withdrawApproval(
        PROJECT_ID,
        fixture.expenseId,
        APPLICANT_USER_ID,
        withdrawalInput(fixture)
      ),
    secondOperation: (service) =>
      service.reviewApproval(
        PROJECT_ID,
        fixture.expenseId,
        APPROVER_USER_ID,
        { decision: "approve" }
      )
  });
  assert(
    results[0].status === "fulfilled" &&
      results[1].status === "rejected",
    "撤回 winner 与节点推进 loser 的胜负必须确定"
  );
  assert(
    typeof results[1].reason?.getStatus === "function" &&
      results[1].reason.getStatus() === 400 &&
      errorText(results[1].reason).includes(
        "当前项目支出状态不可审批"
      ),
    `节点推进 loser 必须因 winner 已撤回的权威状态失败，实际 ${errorText(
      results[1].reason
    )}`
  );
  const facts = await readFacts(fixture);
  assert(
    facts.expense?.status === "withdrawn" &&
      facts.approvalInstances.length === 1 &&
      facts.approvalInstances[0].status === "withdrawn" &&
      facts.approvalInstances[0].currentNodeIndex === 0,
    "撤回 winner 必须保持原节点并终止支出单和审批实例"
  );
  assert(
    facts.actionLogCount === 1 &&
      facts.actionLogs[0].action === "withdraw" &&
      facts.auditLogs.map((audit) => audit.action).sort().join(",") ===
        [
          "project_expense.approval.withdraw",
          "project_expense.cash_pool.release.withdraw"
        ].sort().join(","),
    "节点推进 loser 不得在撤回 winner 之外留下部分写"
  );
  assert(
    sumUsageByStatus(facts.quotaUsages, "occupied") === 0n &&
      sumUsageByStatus(facts.quotaUsages, "released") === 600n,
    "撤回 winner 必须释放全部已占用额度"
  );
  console.log(
    "ok project expense withdrawal winner: pg_blocking_pids direct block, node advance rejected, zero loser writes"
  );
}

async function verifyDuplicateActiveInstancesFailClosed() {
  const fixture = await createExpenseFixture("duplicate-active", {
    duplicateApproval: true,
    quotaUsages: [{ amountCents: 400n, status: "occupied" }]
  });
  const service = createExpenseService(
    clientA,
    new AuditService()
  );
  const error = await service
    .withdrawApproval(
      PROJECT_ID,
      fixture.expenseId,
      APPLICANT_USER_ID,
      withdrawalInput(fixture)
    )
    .then(
      () => null,
      (caught) => caught
    );
  assertConflict(error, "重复进行中审批实例");
  const facts = await readFacts(fixture);
  assert(
    facts.approvalInstances.length === 2,
    "重复实例验收夹具必须保留两条进行中实例"
  );
  assertNoWrites(facts, "重复进行中审批实例失败关闭");
  assert(
    sumUsageByStatus(facts.quotaUsages, "occupied") === 400n &&
      sumUsageByStatus(facts.quotaUsages, "released") === 0n,
    "重复实例失败关闭不得移动额度"
  );
  console.log(
    "ok project expense duplicate active instances: strict 409 and zero writes"
  );
}

async function verifyOccupiedQuotaRowsRelease() {
  const fixture = await createExpenseFixture("quota-release", {
    quotaUsages: [
      { amountCents: 100n, status: "occupied" },
      { amountCents: 200n, status: "occupied" },
      { amountCents: 300n, status: "occupied" }
    ]
  });
  const service = createExpenseService(
    clientA,
    new AuditService()
  );
  await service.withdrawApproval(
    PROJECT_ID,
    fixture.expenseId,
    APPLICANT_USER_ID,
    withdrawalInput(fixture)
  );
  const facts = await readFacts(fixture);
  assert(
    facts.quotaUsages.length === 3 &&
      facts.quotaUsages.every(
        (usage) => usage.status === "released"
      ) &&
      sumUsageByStatus(facts.quotaUsages, "released") === 600n,
    "撤回必须释放所有 occupied 额度行且金额守恒"
  );
  assert(
    facts.auditLogs.some(
      (audit) =>
        audit.action ===
          "project_expense.cash_pool.release.withdraw" &&
        audit.metadata?.releasedAmountCents === "600"
    ),
    "多条 occupied 额度释放必须留下精确合计审计"
  );
  console.log(
    "ok project expense occupied quota rows: every row released and amount conserved"
  );
}

async function verifyUsedQuotaBlocks() {
  const fixture = await createExpenseFixture("used-quota-blocks", {
    quotaUsages: [
      { amountCents: 450n, status: "occupied" },
      { amountCents: 150n, status: "used" }
    ]
  });
  const service = createExpenseService(
    clientA,
    new AuditService()
  );
  const error = await service
    .withdrawApproval(
      PROJECT_ID,
      fixture.expenseId,
      APPLICANT_USER_ID,
      withdrawalInput(fixture)
    )
    .then(
      () => null,
      (caught) => caught
    );
  assert(
    errorText(error).includes("已有实付资金占用"),
    `used 额度必须阻断撤回，实际 ${errorText(error)}`
  );
  const facts = await readFacts(fixture);
  assertNoWrites(facts, "used 额度阻断");
  assert(
    sumUsageByStatus(facts.quotaUsages, "occupied") === 450n &&
      sumUsageByStatus(facts.quotaUsages, "used") === 150n &&
      sumUsageByStatus(facts.quotaUsages, "released") === 0n,
    "used 额度阻断后 occupied/used 额度必须原样保留"
  );
  console.log(
    "ok project expense used quota: withdrawal blocked and every fact unchanged"
  );
}

async function verifyFinalAuditFailureRollsBack() {
  const fixture = await createExpenseFixture("audit-rollback", {
    quotaUsages: [
      { amountCents: 275n, status: "occupied" },
      { amountCents: 325n, status: "occupied" }
    ]
  });
  const { audit, evidence } = finalWithdrawalAuditFailure();
  const service = createExpenseService(clientA, audit);
  const error = await service
    .withdrawApproval(
      PROJECT_ID,
      fixture.expenseId,
      APPLICANT_USER_ID,
      withdrawalInput(fixture)
    )
    .then(
      () => null,
      (caught) => caught
    );
  assert(
    errorText(error).includes(
      "injected final withdrawal audit failure"
    ),
    `最终主审计故障必须透传失败，实际 ${errorText(error)}`
  );
  assert(
    evidence.observedCompletePreFailureState,
    "最终主审计故障必须注入在前置事务写入全部完成之后"
  );
  const facts = await readFacts(fixture);
  assertNoWrites(facts, "最终主审计故障回滚");
  assert(
    sumUsageByStatus(facts.quotaUsages, "occupied") === 600n &&
      sumUsageByStatus(facts.quotaUsages, "released") === 0n,
    "最终主审计失败必须回滚已执行的全部额度释放"
  );
  console.log(
    "ok project expense final audit failure: request/instance/action/quota/release-audit all rolled back"
  );
}

async function main() {
  assertLocalRuntime();
  await Promise.all([
    clientA.$connect(),
    clientB.$connect(),
    observerClient.$connect()
  ]);
  try {
    await seedBaseFacts();
    await verifySameCoordinateDoubleWithdrawal();
    await verifyNodeAdvanceWins();
    await verifyWithdrawalWinsBeforeNodeAdvance();
    await verifyDuplicateActiveInstancesFailClosed();
    await verifyOccupiedQuotaRowsRelease();
    await verifyUsedQuotaBlocks();
    await verifyFinalAuditFailureRollsBack();
    console.log(
      "项目支出撤回 PostgreSQL 16 并发验收通过：同坐标双撤回一胜一败；节点推进/撤回双胜序；旧四坐标 409 零部分写；重复实例失败关闭；多额度释放与 used 阻断；最终主审计故障全事务回滚"
    );
  } finally {
    await Promise.allSettled([
      clientA.$disconnect(),
      clientB.$disconnect(),
      observerClient.$disconnect()
    ]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
