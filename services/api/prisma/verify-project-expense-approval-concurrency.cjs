"use strict";

const { createHash } = require("node:crypto");
const { Prisma, PrismaClient } = require("@prisma/client");
const { AuditService } = require("../dist/audit/audit.service");
const {
  ProjectExpenseService
} = require("../dist/project-expense/project-expense.service");

const DATABASE_NAME =
  "jiangkong_project_expense_approval_concurrency";
const PROJECT_ID = "project-expense-approval-concurrency-project";
const APPLICANT_USER_ID = "project-expense-approval-applicant";
const REVIEWER_USER_ID = "project-expense-approval-reviewer";
const CHAIRMAN_USER_ID = "project-expense-approval-chairman";
const GENERAL_MANAGER_USER_ID =
  "project-expense-approval-general-manager";
const ORDINARY_SELF_USER_ID =
  "project-expense-approval-ordinary-self";
const LEADER_SELF_USER_ID =
  "project-expense-approval-leader-self";
const NO_SIGNATURE_USER_ID =
  "project-expense-approval-no-signature";
const BAD_SIGNATURE_USER_ID =
  "project-expense-approval-bad-signature";
const REQUESTED_AMOUNT_CENTS = 1_000n;
const APPROVED_AMOUNT_CENTS = 800n;
const OCCUPIED_FINANCING_CENTS = 400n;
const EXPECTED_REMAINING_OCCUPIED_CENTS = 200n;
const SIGNATURE_BYTES = {
  [REVIEWER_USER_ID]: Buffer.from(
    "project-expense-approval-reviewer-signature"
  ),
  [CHAIRMAN_USER_ID]: Buffer.from(
    "project-expense-approval-chairman-signature"
  ),
  [GENERAL_MANAGER_USER_ID]: Buffer.from(
    "project-expense-approval-general-manager-signature"
  ),
  [LEADER_SELF_USER_ID]: Buffer.from(
    "project-expense-approval-leader-self-signature"
  )
};

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
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} 在 ${timeoutMs}ms 内未到达`)),
          timeoutMs
        );
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function assertLocalRuntime() {
  const databaseUrlText = process.env.DATABASE_URL ?? "";
  let databaseUrl;
  try {
    databaseUrl = new URL(databaseUrlText);
  } catch {
    throw new Error("项目支出审批并发验收 DATABASE_URL 不是有效 URL");
  }
  assert(
    ["postgresql:", "postgres:"].includes(databaseUrl.protocol),
    "项目支出审批并发验收只能连接 PostgreSQL"
  );
  assert(
    ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
      databaseUrl.hostname
    ),
    "项目支出审批并发验收拒绝连接非本机数据库"
  );
  assert(
    databaseUrl.pathname === `/${DATABASE_NAME}`,
    "项目支出审批并发验收只允许连接专用的一次性临时数据库"
  );
  assert(
    process.env.NODE_ENV === "test",
    "项目支出审批并发验收要求 NODE_ENV=test"
  );
}

function signatureFixture(userId) {
  const bytes = SIGNATURE_BYTES[userId];
  assert(bytes, `缺少 ${userId} 的签名验收字节`);
  return {
    fileId: `${userId}-signature-file`,
    versionId: `${userId}-signature-version`,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

function governedNode(name, candidateUserIdsByRole) {
  const roleKeys = Object.keys(candidateUserIdsByRole);
  return {
    name,
    mode: "any",
    roleKeys,
    candidateUserIdsByRole,
    candidateUserIds: [
      ...new Set(Object.values(candidateUserIdsByRole).flat())
    ]
  };
}

function twoReviewerNodes() {
  return [
    governedNode("项目经理初审", {
      project_manager: [REVIEWER_USER_ID]
    }),
    governedNode("项目经理复审", {
      project_manager: [REVIEWER_USER_ID]
    })
  ];
}

function finalOrNode() {
  return governedNode("董事长/总经理", {
    chairman: [CHAIRMAN_USER_ID],
    general_manager: [GENERAL_MANAGER_USER_ID]
  });
}

async function seedSignature(userId) {
  const signature = signatureFixture(userId);
  await clientA.fileObject.create({
    data: {
      id: signature.fileId,
      bucket: "local-private",
      objectKey: `project-expense-approval/${signature.fileId}.png`,
      originalName: `${userId}.png`,
      mimeType: "image/png",
      sizeBytes: SIGNATURE_BYTES[userId].length,
      uploadedByUserId: userId,
      contentSha256: signature.sha256,
      storageStatus: "active"
    }
  });
  await clientA.handwrittenSignatureVersion.create({
    data: {
      id: signature.versionId,
      userId,
      fileId: signature.fileId,
      contentSha256: signature.sha256,
      source: "canvas"
    }
  });
}

async function seedBaseFacts() {
  await clientA.project.create({
    data: {
      id: PROJECT_ID,
      code: "PROJECT-EXPENSE-APPROVAL-CONCURRENCY",
      name: "项目支出审批 PostgreSQL 并发验收临时项目"
    }
  });
  const users = [
    [APPLICANT_USER_ID, "项目支出审批验收申请人"],
    [REVIEWER_USER_ID, "项目支出审批验收项目经理"],
    [CHAIRMAN_USER_ID, "项目支出审批验收董事长"],
    [GENERAL_MANAGER_USER_ID, "项目支出审批验收总经理"],
    [ORDINARY_SELF_USER_ID, "项目支出审批验收普通自审人"],
    [LEADER_SELF_USER_ID, "项目支出审批验收领导自审人"],
    [NO_SIGNATURE_USER_ID, "项目支出审批验收缺失签名人"],
    [BAD_SIGNATURE_USER_ID, "项目支出审批验收错误签名人"]
  ];
  await clientA.user.createMany({
    data: users.map(([id, name]) => ({
      id,
      name,
      isActive: true,
      mustChangePassword: false
    }))
  });
  await clientA.projectMember.createMany({
    data: [
      [REVIEWER_USER_ID, "project_manager"],
      [REVIEWER_USER_ID, "comprehensive_director"],
      [REVIEWER_USER_ID, "finance_director"],
      [CHAIRMAN_USER_ID, "chairman"],
      [GENERAL_MANAGER_USER_ID, "general_manager"],
      [ORDINARY_SELF_USER_ID, "comprehensive_director"],
      [LEADER_SELF_USER_ID, "chairman"],
      [NO_SIGNATURE_USER_ID, "chairman"],
      [BAD_SIGNATURE_USER_ID, "chairman"]
    ].map(([userId, positionKey]) => ({
      projectId: PROJECT_ID,
      userId,
      positionKey
    }))
  });
  for (const userId of [
    REVIEWER_USER_ID,
    CHAIRMAN_USER_ID,
    GENERAL_MANAGER_USER_ID,
    LEADER_SELF_USER_ID
  ]) {
    await seedSignature(userId);
  }

  const badFileSha256 = createHash("sha256")
    .update("project-expense-bad-signature-file")
    .digest("hex");
  const badVersionSha256 = createHash("sha256")
    .update("project-expense-bad-signature-version")
    .digest("hex");
  await clientA.fileObject.create({
    data: {
      id: `${BAD_SIGNATURE_USER_ID}-signature-file`,
      bucket: "local-private",
      objectKey:
        `project-expense-approval/${BAD_SIGNATURE_USER_ID}.png`,
      originalName: `${BAD_SIGNATURE_USER_ID}.png`,
      mimeType: "image/png",
      sizeBytes: 32,
      uploadedByUserId: BAD_SIGNATURE_USER_ID,
      contentSha256: badFileSha256,
      storageStatus: "active"
    }
  });
  await clientA.handwrittenSignatureVersion.create({
    data: {
      id: `${BAD_SIGNATURE_USER_ID}-signature-version`,
      userId: BAD_SIGNATURE_USER_ID,
      fileId: `${BAD_SIGNATURE_USER_ID}-signature-file`,
      contentSha256: badVersionSha256,
      source: "canvas"
    }
  });
}

async function createExpenseFixture(label, options = {}) {
  const expenseId = `project-expense-approval-${label}`;
  const approvalInstanceId = `${expenseId}-approval`;
  const requestedAmountCents =
    options.requestedAmountCents ?? REQUESTED_AMOUNT_CENTS;
  const applicantUserId =
    options.applicantUserId ?? APPLICANT_USER_ID;
  const expense = await clientA.projectExpenseRequest.create({
    data: {
      id: expenseId,
      projectId: PROJECT_ID,
      code: `ZC-APPROVAL-${label.toUpperCase()}`,
      expenseType: "reimbursement",
      expenseSubtype: "reimbursement",
      paymentSubject: "建工智管",
      reason: `项目支出审批并发验收 ${label}`,
      requestedAmountCents,
      approvedAmountCents: null,
      paidAmountCents: options.paidAmountCents ?? 0n,
      paymentMethod: "bank_transfer",
      handlerUserId: applicantUserId,
      applicantUserId,
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
      frozenNodes: options.frozenNodes ?? [finalOrNode()],
      applicantUserId
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
        frozenNodes: options.frozenNodes ?? [finalOrNode()],
        applicantUserId
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

async function verifyRealCreateGovernedRoute() {
  const service = new ProjectExpenseService(
    clientA,
    new AuditService()
  );
  const created = await service.create(
    PROJECT_ID,
    APPLICANT_USER_ID,
    {
      code: "ZC-APPROVAL-REAL-CREATE",
      expenseType: "reimbursement",
      expenseSubtype: "reimbursement",
      paymentSubject: "建工智管",
      reason: "真实 create 冻结候选人与签名链验收",
      requestedAmountCents: REQUESTED_AMOUNT_CENTS.toString(),
      paymentMethod: "bank_transfer"
    }
  );
  const approval = await clientA.approvalInstance.findFirst({
    where: {
      businessType: "project_expense_request",
      businessId: created.id,
      flowType: "project_expense.approve",
      status: "in_progress"
    }
  });
  assert(approval, "真实 create 必须生成项目支出审批实例");
  const frozenNodes = approval.frozenNodes;
  assert(
    Array.isArray(frozenNodes) &&
      frozenNodes.length === 4 &&
      frozenNodes.every(
        (node) =>
          Array.isArray(node.candidateUserIds) &&
          node.candidateUserIds.length > 0 &&
          node.candidateUserIdsByRole &&
          typeof node.candidateUserIdsByRole === "object"
      ),
    "真实 create 必须为每个节点冻结非空 governed 候选人"
  );
  assert(
    frozenNodes[0].candidateUserIdsByRole.comprehensive_director.includes(
      REVIEWER_USER_ID
    ) &&
      !frozenNodes[0].candidateUserIds.includes(APPLICANT_USER_ID),
    "真实 create 必须冻结综合部审批人且排除普通申请人"
  );

  const detail = await service.getApprovalDetail(
    PROJECT_ID,
    created.id,
    REVIEWER_USER_ID
  );
  const context = detail.reviewApprovalContext;
  assert(
    context &&
      detail.availableActions.filter(
        (action) => action.key === "review_approval" && action.enabled
      ).length === 1,
    "真实 create 的冻结候选人必须可以通过 GET 获取唯一审批动作"
  );
  await service.reviewApproval(
    PROJECT_ID,
    created.id,
    REVIEWER_USER_ID,
    { decision: "approve", ...context }
  );
  const facts = await readFacts({ expenseId: created.id });
  assert(
    facts.expense?.status === "approval_pending" &&
      facts.approvalInstances.length === 1 &&
      facts.approvalInstances[0].currentNodeIndex === 1 &&
      facts.actionLogs.length === 1,
    "真实 create -> GET -> POST 必须只推进一个审批节点"
  );
  assertSignedAction(
    facts.actionLogs[0],
    REVIEWER_USER_ID,
    "真实 create governed 审批"
  );
  assertZeroDownstream(facts, "真实 create governed 审批");
  console.log(
    "ok project expense real create route: frozen candidates, GET capability, signed POST, one-node advance, zero downstream"
  );
}

function reviewInput(fixture, decision, overrides = {}) {
  return {
    decision,
    expectedExpenseUpdatedAt: fixture.expectedExpenseUpdatedAt,
    expectedApprovalInstanceId:
      fixture.expectedApprovalInstanceId,
    expectedNodeIndex: fixture.expectedNodeIndex,
    expectedApprovalUpdatedAt:
      fixture.expectedApprovalUpdatedAt,
    ...overrides
  };
}

function createReviewPrisma(client, backendPid) {
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

function createExpenseService(client, audit, backendPid, auth) {
  return new ProjectExpenseService(
    createReviewPrisma(client, backendPid),
    audit,
    auth
  );
}

function passwordAuth(expectedPassword = "current-password") {
  const calls = [];
  return {
    calls,
    confirmPassword: async (userId, password) => {
      calls.push([userId, password]);
      if (password !== expectedPassword) {
        throw new Error("当前密码不正确，请重新输入");
      }
      return { ok: true };
    }
  };
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

async function observeDirectBlock(firstPid, secondPid) {
  let bestSnapshot = [];
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const sessions = await observerClient.$queryRaw(
      Prisma.sql`
        SELECT
          pid::int AS "pid",
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
    `未观察到项目支出审批 backend ${secondPid} 被 ${firstPid} 直接阻塞；` +
      `最接近快照 ${JSON.stringify(bestSnapshot)}`
  );
}

function assertConflict(error, label) {
  assert(
    error &&
      typeof error.getStatus === "function" &&
      error.getStatus() === 409,
    `${label} 必须严格返回 409，实际 ${errorText(error)}`
  );
}

async function runReviewRace({
  fixture,
  winnerDecision,
  winnerActorUserId,
  winnerOverrides,
  loserDecision,
  loserActorUserId,
  loserOverrides
}) {
  const firstBackendPid = deferred();
  const secondBackendPid = deferred();
  const firstAuditEntered = deferred();
  const releaseFirstAudit = deferred();
  const firstService = createExpenseService(
    clientA,
    pausingAudit(
      `project_expense.approval.${winnerDecision}`,
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
    firstResultPromise = capture(
      firstService.reviewApproval(
        PROJECT_ID,
        fixture.expenseId,
        winnerActorUserId,
        reviewInput(
          fixture,
          winnerDecision,
          winnerOverrides
        )
      )
    );
    await waitFor(
      firstAuditEntered.promise,
      `首个审批事务审计 project_expense.approval.${winnerDecision}`
    );
    const firstPid = await waitFor(
      firstBackendPid.promise,
      "首个审批 PostgreSQL backend PID"
    );
    secondResultPromise = capture(
      secondService.reviewApproval(
        PROJECT_ID,
        fixture.expenseId,
        loserActorUserId,
        reviewInput(fixture, loserDecision, loserOverrides)
      )
    );
    const secondPid = await waitFor(
      secondBackendPid.promise,
      "第二个审批 PostgreSQL backend PID"
    );
    assert(
      Number.isInteger(firstPid) &&
        Number.isInteger(secondPid) &&
        firstPid !== secondPid,
      "项目支出审批并发验收必须捕获两个不同的 PostgreSQL backend PID"
    );
    try {
      await observeDirectBlock(firstPid, secondPid);
    } catch (error) {
      blockError = error;
    }
  } finally {
    releaseFirstAudit.resolve(undefined);
  }
  const winner = firstResultPromise
    ? await firstResultPromise
    : { status: "rejected", reason: new Error("winner 未启动") };
  const loser = secondResultPromise
    ? await secondResultPromise
    : { status: "rejected", reason: new Error("loser 未启动") };
  if (blockError) throw blockError;
  assert(
    winner.status === "fulfilled",
    `${winnerDecision} winner 必须成功，实际 ${
      winner.status === "rejected"
        ? errorText(winner.reason)
        : winner.status
    }`
  );
  assert(
    loser.status === "rejected",
    `${loserDecision} loser 必须失败`
  );
  assertConflict(loser.reason, `${loserDecision} loser`);
  return { winner: winner.value, loserError: loser.reason };
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
    quotaUsages,
    auditLogs,
    executionCount,
    financeRecordCount,
    fundingAllocationCount
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
    }),
    clientA.projectExpenseExecution.count({
      where: { projectExpenseRequestId: fixture.expenseId }
    }),
    clientA.financeRecord.count({
      where: { projectExpenseRequestId: fixture.expenseId }
    }),
    clientA.projectFundingAllocation.count({
      where: {
        businessType: "project_expense_request",
        businessId: fixture.expenseId
      }
    })
  ]);
  return {
    expense,
    approvalInstances,
    actionLogs,
    quotaUsages,
    auditLogs,
    executionCount,
    financeRecordCount,
    fundingAllocationCount
  };
}

function businessStateSnapshot(facts) {
  return JSON.stringify(
    {
      expense: facts.expense,
      approvalInstances: facts.approvalInstances,
      actionLogs: facts.actionLogs,
      auditLogs: facts.auditLogs,
      quotaUsages: facts.quotaUsages,
      executionCount: facts.executionCount,
      financeRecordCount: facts.financeRecordCount,
      fundingAllocationCount: facts.fundingAllocationCount
    },
    (_key, value) =>
      typeof value === "bigint" ? `bigint:${value.toString()}` : value
  );
}

function sumUsageByStatus(usages, status) {
  return usages
    .filter((usage) => usage.status === status)
    .reduce((sum, usage) => sum + usage.amountCents, 0n);
}

function assertZeroDownstream(facts, label) {
  assert(
    facts.expense?.paidAmountCents === 0n &&
      facts.executionCount === 0 &&
      facts.financeRecordCount === 0 &&
      facts.fundingAllocationCount === 0,
    `${label} 不得产生实付、财务或资金分配，实际 ` +
      `${facts.expense?.paidAmountCents}/${facts.executionCount}/` +
      `${facts.financeRecordCount}/${facts.fundingAllocationCount}`
  );
}

function assertOriginalFacts(facts, label) {
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
    facts.actionLogs.length === 0 && facts.auditLogs.length === 0,
    `${label} 不得写入 ActionLog 或 AuditLog`
  );
  assertZeroDownstream(facts, label);
}

function assertSignedAction(action, userId, label) {
  const signature = signatureFixture(userId);
  assert(
    action?.signatureFileIdSnapshot === signature.fileId &&
      action.signatureSha256Snapshot === signature.sha256 &&
      action.signatureVersionIdSnapshot === signature.versionId,
    `${label} 必须冻结精确签名 file/SHA/version`
  );
}

async function rejectedError(promise) {
  return promise.then(
    () => null,
    (error) => error
  );
}

async function verifyIntermediateApproveRace() {
  const fixture = await createExpenseFixture("intermediate-race", {
    frozenNodes: twoReviewerNodes(),
    quotaUsages: [
      { amountCents: OCCUPIED_FINANCING_CENTS, status: "occupied" }
    ]
  });
  await runReviewRace({
    fixture,
    winnerDecision: "approve",
    winnerActorUserId: REVIEWER_USER_ID,
    loserDecision: "approve",
    loserActorUserId: REVIEWER_USER_ID
  });
  const facts = await readFacts(fixture);
  const approval = facts.approvalInstances[0];
  assert(
    facts.expense?.status === "approval_pending" &&
      facts.expense.approvedAmountCents === null &&
      approval?.status === "in_progress" &&
      approval.currentNodeIndex === 1,
    "非末节点 approve/approve 只能推进一次且支出继续审批中"
  );
  assert(
    facts.actionLogs.length === 1 &&
      facts.actionLogs[0].action === "approve" &&
      facts.actionLogs[0].actorUserId === REVIEWER_USER_ID &&
      facts.auditLogs.length === 1 &&
      facts.auditLogs[0].action ===
        "project_expense.approval.approve",
    "非末节点竞争必须只保留 winner 的一条动作与一条审计"
  );
  assertSignedAction(
    facts.actionLogs[0],
    REVIEWER_USER_ID,
    "非末节点 approve winner"
  );
  assert(
    sumUsageByStatus(facts.quotaUsages, "occupied") ===
      OCCUPIED_FINANCING_CENTS &&
      sumUsageByStatus(facts.quotaUsages, "released") === 0n,
    "非末节点审批不得移动融资额度"
  );
  assertZeroDownstream(facts, "非末节点 approve/approve");
  console.log(
    "ok project expense intermediate approve race: direct block, one node advance, stale loser 409, signed action, zero downstream"
  );
}

async function verifyFinalApproveWinner() {
  const fixture = await createExpenseFixture("final-approve-winner", {
    frozenNodes: [finalOrNode()],
    quotaUsages: [
      { amountCents: 150n, status: "occupied" },
      { amountCents: 250n, status: "occupied" }
    ]
  });
  await runReviewRace({
    fixture,
    winnerDecision: "approve",
    winnerActorUserId: CHAIRMAN_USER_ID,
    winnerOverrides: {
      approvedAmountCents: APPROVED_AMOUNT_CENTS.toString()
    },
    loserDecision: "reject",
    loserActorUserId: GENERAL_MANAGER_USER_ID,
    loserOverrides: { comment: "条件尚未满足" }
  });
  const facts = await readFacts(fixture);
  const approval = facts.approvalInstances[0];
  const action = facts.actionLogs[0];
  const auditActions = facts.auditLogs.map((audit) => audit.action);
  assert(
    facts.expense?.status === "approved_pending_payment" &&
      facts.expense.approvedAmountCents === APPROVED_AMOUNT_CENTS &&
      approval?.status === "approved" &&
      approval.currentNodeIndex === 1,
    "最终 approve winner 必须冻结批准金额并只进入已批待付"
  );
  assert(
    facts.actionLogs.length === 1 &&
      action.action === "approve" &&
      action.actorUserId === CHAIRMAN_USER_ID,
    "最终 approve winner 必须只保留董事长 approve 动作"
  );
  assertSignedAction(action, CHAIRMAN_USER_ID, "最终 approve winner");
  assert(
    auditActions.filter(
      (actionName) =>
        actionName === "project_expense.approval.approve"
    ).length === 1 &&
      auditActions.filter(
        (actionName) =>
          actionName ===
          "project_expense.cash_pool.release.approval_amount_reduced"
      ).length === 1 &&
      facts.auditLogs.length === 2,
    `最终 approve winner 审计不精确：${auditActions.join(",")}`
  );
  assert(
    sumUsageByStatus(facts.quotaUsages, "occupied") ===
      EXPECTED_REMAINING_OCCUPIED_CENTS &&
      sumUsageByStatus(facts.quotaUsages, "released") ===
        OCCUPIED_FINANCING_CENTS -
          EXPECTED_REMAINING_OCCUPIED_CENTS &&
      sumUsageByStatus(facts.quotaUsages, "used") === 0n,
    "最终 approve winner 必须按批准金额精确缩减融资额度"
  );
  assertZeroDownstream(facts, "最终 approve winner");
  console.log(
    "ok project expense final approve winner: direct block, signed winner, exact quota shrink, reject loser 409, zero downstream"
  );
}

async function verifyFinalRejectWinner() {
  const fixture = await createExpenseFixture("final-reject-winner", {
    frozenNodes: [finalOrNode()],
    quotaUsages: [
      { amountCents: 175n, status: "occupied" },
      { amountCents: 225n, status: "occupied" }
    ]
  });
  await runReviewRace({
    fixture,
    winnerDecision: "reject",
    winnerActorUserId: GENERAL_MANAGER_USER_ID,
    winnerOverrides: { comment: "付款事实不完整" },
    loserDecision: "approve",
    loserActorUserId: CHAIRMAN_USER_ID,
    loserOverrides: {
      approvedAmountCents: APPROVED_AMOUNT_CENTS.toString()
    }
  });
  const facts = await readFacts(fixture);
  const approval = facts.approvalInstances[0];
  const action = facts.actionLogs[0];
  const auditActions = facts.auditLogs.map((audit) => audit.action);
  assert(
    facts.expense?.status === "rejected" &&
      facts.expense.approvedAmountCents === null &&
      approval?.status === "rejected" &&
      approval.currentNodeIndex === 0,
    "最终 reject winner 必须驳回支出和实例且不冻结批准金额"
  );
  assert(
    facts.actionLogs.length === 1 &&
      action.action === "reject" &&
      action.actorUserId === GENERAL_MANAGER_USER_ID &&
      action.signatureFileIdSnapshot === null &&
      action.signatureSha256Snapshot === null &&
      action.signatureVersionIdSnapshot === null,
    "最终 reject winner 必须只保留一条无签名驳回动作"
  );
  assert(
    auditActions.filter(
      (actionName) =>
        actionName === "project_expense.approval.reject"
    ).length === 1 &&
      auditActions.filter(
        (actionName) =>
          actionName === "project_expense.cash_pool.release.reject"
      ).length === 1 &&
      facts.auditLogs.length === 2,
    `最终 reject winner 审计不精确：${auditActions.join(",")}`
  );
  assert(
    sumUsageByStatus(facts.quotaUsages, "occupied") === 0n &&
      sumUsageByStatus(facts.quotaUsages, "released") ===
        OCCUPIED_FINANCING_CENTS,
    "最终 reject winner 必须释放全部融资额度"
  );
  assertZeroDownstream(facts, "最终 reject winner");
  console.log(
    "ok project expense final reject winner: direct block, unsigned reject, full quota release, approve loser 409, zero downstream"
  );
}

async function verifyStaleCoordinateAfterNodeAdvance() {
  const fixture = await createExpenseFixture("stale-coordinate", {
    frozenNodes: twoReviewerNodes(),
    quotaUsages: [
      { amountCents: OCCUPIED_FINANCING_CENTS, status: "occupied" }
    ]
  });
  const service = createExpenseService(
    clientA,
    new AuditService()
  );
  const staleInput = reviewInput(fixture, "approve");
  await service.reviewApproval(
    PROJECT_ID,
    fixture.expenseId,
    REVIEWER_USER_ID,
    staleInput
  );
  const error = await rejectedError(
    service.reviewApproval(
      PROJECT_ID,
      fixture.expenseId,
      REVIEWER_USER_ID,
      staleInput
    )
  );
  assertConflict(error, "节点推进后的旧四坐标");
  const facts = await readFacts(fixture);
  assert(
    facts.expense?.status === "approval_pending" &&
      facts.approvalInstances[0]?.currentNodeIndex === 1 &&
      facts.actionLogs.length === 1 &&
      facts.auditLogs.length === 1,
    "旧四坐标 loser 不得在节点推进 winner 之外留下写入"
  );
  assertZeroDownstream(facts, "节点推进旧四坐标");
  console.log(
    "ok project expense stale coordinates: node remains pending at index 1, old four-coordinate review 409, zero loser writes"
  );
}

async function verifyDuplicateActiveInstancesFailClosed() {
  const fixture = await createExpenseFixture("duplicate-active", {
    frozenNodes: [finalOrNode()],
    duplicateApproval: true,
    quotaUsages: [
      { amountCents: OCCUPIED_FINANCING_CENTS, status: "occupied" }
    ]
  });
  const service = createExpenseService(
    clientA,
    new AuditService()
  );
  const error = await rejectedError(
    service.reviewApproval(
      PROJECT_ID,
      fixture.expenseId,
      CHAIRMAN_USER_ID,
      reviewInput(fixture, "approve", {
        approvedAmountCents: APPROVED_AMOUNT_CENTS.toString()
      })
    )
  );
  assertConflict(error, "重复进行中项目支出审批实例");
  const facts = await readFacts(fixture);
  assert(
    facts.approvalInstances.length === 2,
    "重复实例夹具必须真实保留两条活动实例"
  );
  assertOriginalFacts(facts, "重复活动审批实例失败关闭");
  assert(
    sumUsageByStatus(facts.quotaUsages, "occupied") ===
      OCCUPIED_FINANCING_CENTS &&
      sumUsageByStatus(facts.quotaUsages, "released") === 0n,
    "重复实例失败关闭不得移动融资额度"
  );
  console.log(
    "ok project expense duplicate active instances: strict 409 and zero writes"
  );
}

async function verifyAmountGates() {
  const cases = [
    {
      label: "amount-non-final",
      frozenNodes: twoReviewerNodes(),
      actorUserId: REVIEWER_USER_ID,
      approvedAmountCents: APPROVED_AMOUNT_CENTS.toString(),
      expectedMessage: "最终"
    },
    {
      label: "amount-over-requested",
      frozenNodes: [finalOrNode()],
      actorUserId: CHAIRMAN_USER_ID,
      approvedAmountCents: "1001",
      expectedMessage: "超过"
    },
    {
      label: "amount-zero",
      frozenNodes: [finalOrNode()],
      actorUserId: CHAIRMAN_USER_ID,
      approvedAmountCents: "0",
      expectedMessage: "大于零"
    }
  ];
  for (const item of cases) {
    const fixture = await createExpenseFixture(item.label, {
      frozenNodes: item.frozenNodes,
      quotaUsages: [
        { amountCents: OCCUPIED_FINANCING_CENTS, status: "occupied" }
      ]
    });
    const service = createExpenseService(
      clientA,
      new AuditService()
    );
    const error = await rejectedError(
      service.reviewApproval(
        PROJECT_ID,
        fixture.expenseId,
        item.actorUserId,
        reviewInput(fixture, "approve", {
          approvedAmountCents: item.approvedAmountCents
        })
      )
    );
    assert(
      errorText(error).includes(item.expectedMessage),
      `${item.label} 应包含 ${item.expectedMessage}，实际 ${errorText(error)}`
    );
    const facts = await readFacts(fixture);
    assertOriginalFacts(facts, item.label);
    assert(
      sumUsageByStatus(facts.quotaUsages, "occupied") ===
        OCCUPIED_FINANCING_CENTS,
      `${item.label} 不得移动融资额度`
    );
  }
  console.log(
    "ok project expense amount gates: non-final, over-requested and zero amounts all fail with zero writes"
  );
}

async function verifyApprovedAmountBelowPaidFailsClosed() {
  const paidAmountCents = 700n;
  const fixture = await createExpenseFixture(
    "amount-below-paid",
    {
      frozenNodes: [finalOrNode()],
      paidAmountCents,
      quotaUsages: [
        { amountCents: OCCUPIED_FINANCING_CENTS, status: "occupied" }
      ]
    }
  );
  const beforeFacts = await readFacts(fixture);
  assert(
    beforeFacts.expense?.paidAmountCents === paidAmountCents &&
      beforeFacts.actionLogs.length === 0 &&
      beforeFacts.auditLogs.length === 0 &&
      sumUsageByStatus(beforeFacts.quotaUsages, "occupied") ===
        OCCUPIED_FINANCING_CENTS,
    "批准金额低于已实付夹具必须包含既有实付、原始审批和未移动融资额度"
  );
  const beforeState = businessStateSnapshot(beforeFacts);
  const service = createExpenseService(
    clientA,
    new AuditService()
  );
  const error = await rejectedError(
    service.reviewApproval(
      PROJECT_ID,
      fixture.expenseId,
      CHAIRMAN_USER_ID,
      reviewInput(fixture, "approve", {
        approvedAmountCents: "600"
      })
    )
  );
  assert(
    typeof error?.getStatus === "function" &&
      error.getStatus() === 400 &&
      errorText(error) === "批准金额不能低于已实付金额",
    `批准金额低于已实付必须稳定返回 400 业务拒绝，实际 ${errorText(error)}`
  );
  const afterFacts = await readFacts(fixture);
  assert(
    businessStateSnapshot(afterFacts) === beforeState,
    "批准金额低于已实付被拒绝后，支出、实例、动作、审计、融资及下游事实必须逐字节保持不变"
  );
  console.log(
    "ok project expense amount below paid: stable 400 rejection and exact zero change across request/instance/action/audit/financing"
  );
}

async function verifyUsedFinancingShrinkFailsClosed() {
  const fixture = await createExpenseFixture(
    "used-financing-shrink",
    {
      frozenNodes: [finalOrNode()],
      quotaUsages: [
        { amountCents: 100n, status: "occupied" },
        { amountCents: 300n, status: "used" }
      ]
    }
  );
  const service = createExpenseService(
    clientA,
    new AuditService()
  );
  const error = await rejectedError(
    service.reviewApproval(
      PROJECT_ID,
      fixture.expenseId,
      CHAIRMAN_USER_ID,
      reviewInput(fixture, "approve", {
        approvedAmountCents: "200"
      })
    )
  );
  assert(
    errorText(error).includes("已使用融资额度"),
    `used 融资额度无法缩减时必须失败，实际 ${errorText(error)}`
  );
  const facts = await readFacts(fixture);
  assertOriginalFacts(facts, "used 融资额度缩减失败关闭");
  assert(
    sumUsageByStatus(facts.quotaUsages, "occupied") === 100n &&
      sumUsageByStatus(facts.quotaUsages, "used") === 300n &&
      sumUsageByStatus(facts.quotaUsages, "released") === 0n,
    "used 融资额度缩减失败必须保持全部额度原状"
  );
  console.log(
    "ok project expense used financing shrink: impossible reduction fails and rolls back every write"
  );
}

async function verifyGovernedSignatureFailures() {
  const cases = [
    {
      label: "signature-missing",
      actorUserId: NO_SIGNATURE_USER_ID,
      node: governedNode("董事长审批", {
        chairman: [NO_SIGNATURE_USER_ID]
      }),
      expectedMessage: "手写签名未配置"
    },
    {
      label: "signature-bad-sha",
      actorUserId: BAD_SIGNATURE_USER_ID,
      node: governedNode("董事长审批", {
        chairman: [BAD_SIGNATURE_USER_ID]
      }),
      expectedMessage: "签名版本校验失败"
    }
  ];
  for (const item of cases) {
    const fixture = await createExpenseFixture(item.label, {
      frozenNodes: [item.node],
      quotaUsages: [
        { amountCents: OCCUPIED_FINANCING_CENTS, status: "occupied" }
      ]
    });
    const service = createExpenseService(
      clientA,
      new AuditService()
    );
    const error = await rejectedError(
      service.reviewApproval(
        PROJECT_ID,
        fixture.expenseId,
        item.actorUserId,
        reviewInput(fixture, "approve", {
          approvedAmountCents: APPROVED_AMOUNT_CENTS.toString()
        })
      )
    );
    assert(
      errorText(error).includes(item.expectedMessage),
      `${item.label} 必须由签名门阻断，实际 ${errorText(error)}`
    );
    const facts = await readFacts(fixture);
    assertOriginalFacts(facts, item.label);
    assert(
      sumUsageByStatus(facts.quotaUsages, "occupied") ===
        OCCUPIED_FINANCING_CENTS,
      `${item.label} 不得移动融资额度`
    );
  }
  console.log(
    "ok project expense governed signatures: missing and mismatched SHA both fail with zero writes"
  );
}

async function verifyLegacyRoleOnlyApprovalCompatibility() {
  const fixture = await createExpenseFixture("legacy-role-only", {
    frozenNodes: [
      {
        name: "历史项目经理审批",
        mode: "any",
        roleKeys: ["project_manager"]
      }
    ]
  });
  const service = createExpenseService(
    clientA,
    new AuditService()
  );
  await service.reviewApproval(
    PROJECT_ID,
    fixture.expenseId,
    REVIEWER_USER_ID,
    reviewInput(fixture, "approve")
  );
  const facts = await readFacts(fixture);
  const action = facts.actionLogs[0];
  assert(
    facts.expense?.status === "approved_pending_payment" &&
      facts.expense.approvedAmountCents === REQUESTED_AMOUNT_CENTS &&
      facts.approvalInstances[0]?.status === "approved" &&
      facts.actionLogs.length === 1 &&
      action.signatureFileIdSnapshot === null &&
      action.signatureSha256Snapshot === null &&
      action.signatureVersionIdSnapshot === null,
    "legacy role-only 审批必须兼容成功且不得伪造签名"
  );
  assertZeroDownstream(facts, "legacy role-only approve");
  console.log(
    "ok project expense legacy role-only approval: compatible unsigned approve and zero downstream"
  );
}

async function verifyOrdinarySelfReviewFailsClosed() {
  const fixture = await createExpenseFixture("ordinary-self-review", {
    applicantUserId: ORDINARY_SELF_USER_ID,
    frozenNodes: [
      governedNode("综合部主管审批", {
        comprehensive_director: [ORDINARY_SELF_USER_ID]
      })
    ],
    quotaUsages: [
      { amountCents: OCCUPIED_FINANCING_CENTS, status: "occupied" }
    ]
  });
  const auth = passwordAuth();
  const service = createExpenseService(
    clientA,
    new AuditService(),
    undefined,
    auth
  );
  const error = await rejectedError(
    service.reviewApproval(
      PROJECT_ID,
      fixture.expenseId,
      ORDINARY_SELF_USER_ID,
      reviewInput(fixture, "approve")
    )
  );
  assert(
    errorText(error).includes("申请人不能审批自己发起的业务"),
    `普通自审必须被拒绝，实际 ${errorText(error)}`
  );
  assert(
    auth.calls.length === 0,
    "普通岗位自审失败不得进入密码确认"
  );
  const facts = await readFacts(fixture);
  assertOriginalFacts(facts, "普通岗位自审失败关闭");
  assert(
    sumUsageByStatus(facts.quotaUsages, "occupied") ===
      OCCUPIED_FINANCING_CENTS,
    "普通岗位自审失败不得移动额度"
  );
  console.log(
    "ok project expense ordinary self review: blocked before password/signature and zero writes"
  );
}

async function verifyLeaderSelfReview() {
  const leaderNode = governedNode("董事长/总经理", {
    chairman: [LEADER_SELF_USER_ID],
    general_manager: [GENERAL_MANAGER_USER_ID]
  });
  const missingReasonFixture = await createExpenseFixture(
    "leader-self-missing-reason",
    {
      applicantUserId: LEADER_SELF_USER_ID,
      frozenNodes: [leaderNode]
    }
  );
  const missingReasonAuth = passwordAuth();
  const missingReasonService = createExpenseService(
    clientA,
    new AuditService(),
    undefined,
    missingReasonAuth
  );
  const missingReasonError = await rejectedError(
    missingReasonService.reviewApproval(
      PROJECT_ID,
      missingReasonFixture.expenseId,
      LEADER_SELF_USER_ID,
      reviewInput(missingReasonFixture, "approve", {
        confirmationPassword: "current-password"
      })
    )
  );
  assert(
    errorText(missingReasonError).includes("自审原因"),
    "领导自审缺少原因必须失败"
  );
  assert(
    missingReasonAuth.calls.length === 0,
    "领导自审缺少原因不得确认密码"
  );
  assertOriginalFacts(
    await readFacts(missingReasonFixture),
    "领导自审缺少原因"
  );

  const wrongPasswordFixture = await createExpenseFixture(
    "leader-self-wrong-password",
    {
      applicantUserId: LEADER_SELF_USER_ID,
      frozenNodes: [leaderNode]
    }
  );
  const wrongPasswordAuth = passwordAuth();
  const wrongPasswordService = createExpenseService(
    clientA,
    new AuditService(),
    undefined,
    wrongPasswordAuth
  );
  const wrongPasswordError = await rejectedError(
    wrongPasswordService.reviewApproval(
      PROJECT_ID,
      wrongPasswordFixture.expenseId,
      LEADER_SELF_USER_ID,
      reviewInput(wrongPasswordFixture, "approve", {
        selfReviewReason: "业务紧急",
        confirmationPassword: "wrong-password"
      })
    )
  );
  assert(
    errorText(wrongPasswordError).includes("当前密码不正确"),
    "领导自审密码错误必须失败"
  );
  assertOriginalFacts(
    await readFacts(wrongPasswordFixture),
    "领导自审密码错误"
  );

  const successFixture = await createExpenseFixture(
    "leader-self-success",
    {
      applicantUserId: LEADER_SELF_USER_ID,
      frozenNodes: [leaderNode]
    }
  );
  const successAuth = passwordAuth();
  const successService = createExpenseService(
    clientA,
    new AuditService(),
    undefined,
    successAuth
  );
  await successService.reviewApproval(
    PROJECT_ID,
    successFixture.expenseId,
    LEADER_SELF_USER_ID,
    reviewInput(successFixture, "approve", {
      approvedAmountCents: APPROVED_AMOUNT_CENTS.toString(),
      selfReviewReason: "  业务紧急且由本人发起  ",
      confirmationPassword: "current-password"
    })
  );
  const facts = await readFacts(successFixture);
  const action = facts.actionLogs[0];
  const audit = facts.auditLogs.find(
    (item) => item.action === "project_expense.approval.approve"
  );
  assert(
    successAuth.calls.length === 1 &&
      successAuth.calls[0][0] === LEADER_SELF_USER_ID &&
      successAuth.calls[0][1] === "current-password",
    "领导自审成功必须确认当前账号密码一次"
  );
  assert(
    action?.metadata?.selfReview === true &&
      action.metadata.selfReviewReason ===
        "业务紧急且由本人发起" &&
      audit?.metadata?.selfReview === true &&
      audit.metadata.selfReviewReason ===
        "业务紧急且由本人发起",
    "领导自审成功必须记录修剪后的原因和自审标记"
  );
  assert(
    !JSON.stringify(action.metadata).includes("current-password") &&
      !JSON.stringify(audit.metadata).includes("current-password"),
    "领导自审 Action/Audit 不得持久化密码"
  );
  assertSignedAction(action, LEADER_SELF_USER_ID, "领导自审成功");
  assertZeroDownstream(facts, "领导自审成功");
  console.log(
    "ok project expense leader self review: missing reason/wrong password zero-write, success signed with trimmed metadata and no secret"
  );
}

function finalReviewAuditFailure(decision) {
  const persistedAudit = new AuditService();
  const evidence = { observedCompletePreFailureState: false };
  const targetAction = `project_expense.approval.${decision}`;
  const injectedMessage =
    decision === "approve"
      ? "injected final approve audit failure"
      : "injected final reject audit failure";
  return {
    evidence,
    injectedMessage,
    audit: {
      record: async (tx, input) => {
        if (input.action !== targetAction) {
          return persistedAudit.record(tx, input);
        }
        const instance = await tx.approvalInstance.findFirst({
          where: {
            businessType: "project_expense_request",
            businessId: input.businessId,
            flowType: "project_expense.approve"
          }
        });
        const [request, actions, quotaUsages, auditLogs] =
          await Promise.all([
            tx.projectExpenseRequest.findUnique({
              where: { id: input.businessId }
            }),
            tx.approvalActionLog.findMany({
              where: {
                approvalInstanceId: instance?.id ?? "missing-instance"
              }
            }),
            tx.projectExpenseFinancingQuotaUsage.findMany({
              where: {
                projectExpenseRequestId: input.businessId
              }
            }),
            tx.auditLog.findMany({
              where: {
                businessType: "project_expense_request",
                businessId: input.businessId
              }
            })
          ]);
        const action = actions[0];
        const occupied = sumUsageByStatus(quotaUsages, "occupied");
        const released = sumUsageByStatus(quotaUsages, "released");
        const expectedReleaseAudit =
          decision === "approve"
            ? "project_expense.cash_pool.release.approval_amount_reduced"
            : "project_expense.cash_pool.release.reject";
        const complete =
          request &&
          instance &&
          actions.length === 1 &&
          action.action === decision &&
          auditLogs.length === 1 &&
          auditLogs[0].action === expectedReleaseAudit &&
          (decision === "approve"
            ? request.status === "approved_pending_payment" &&
              request.approvedAmountCents ===
                APPROVED_AMOUNT_CENTS &&
              instance.status === "approved" &&
              action.signatureFileIdSnapshot !== null &&
              occupied === EXPECTED_REMAINING_OCCUPIED_CENTS &&
              released ===
                OCCUPIED_FINANCING_CENTS -
                  EXPECTED_REMAINING_OCCUPIED_CENTS
            : request.status === "rejected" &&
              request.approvedAmountCents === null &&
              instance.status === "rejected" &&
              action.signatureFileIdSnapshot === null &&
              occupied === 0n &&
              released === OCCUPIED_FINANCING_CENTS);
        assert(
          complete,
          `${decision} 主审计故障注入前必须已完成业务、实例、动作、签名和额度写入`
        );
        evidence.observedCompletePreFailureState = true;
        throw new Error(injectedMessage);
      }
    }
  };
}

async function verifyAuditFailureRollsBack(decision) {
  const fixture = await createExpenseFixture(
    `${decision}-audit-rollback`,
    {
      frozenNodes: [finalOrNode()],
      quotaUsages: [
        { amountCents: 150n, status: "occupied" },
        { amountCents: 250n, status: "occupied" }
      ]
    }
  );
  const { audit, evidence, injectedMessage } =
    finalReviewAuditFailure(decision);
  const service = createExpenseService(clientA, audit);
  const actorUserId =
    decision === "approve"
      ? CHAIRMAN_USER_ID
      : GENERAL_MANAGER_USER_ID;
  const overrides =
    decision === "approve"
      ? { approvedAmountCents: APPROVED_AMOUNT_CENTS.toString() }
      : { comment: "审计回滚验收驳回" };
  const error = await rejectedError(
    service.reviewApproval(
      PROJECT_ID,
      fixture.expenseId,
      actorUserId,
      reviewInput(fixture, decision, overrides)
    )
  );
  assert(
    errorText(error).includes(injectedMessage),
    `${decision} 最终主审计故障必须透传，实际 ${errorText(error)}`
  );
  assert(
    evidence.observedCompletePreFailureState,
    `${decision} 审计故障必须注入在全部前置写入完成之后`
  );
  const facts = await readFacts(fixture);
  assertOriginalFacts(facts, `${decision} 最终主审计故障回滚`);
  assert(
    sumUsageByStatus(facts.quotaUsages, "occupied") ===
      OCCUPIED_FINANCING_CENTS &&
      sumUsageByStatus(facts.quotaUsages, "released") === 0n,
    `${decision} 最终主审计故障必须回滚全部额度移动`
  );
}

async function verifyApproveAuditFailureRollsBack() {
  await verifyAuditFailureRollsBack("approve");
  console.log(
    "ok project expense approve audit failure: request/instance/signed action/quota/release audit all rolled back"
  );
}

async function verifyRejectAuditFailureRollsBack() {
  await verifyAuditFailureRollsBack("reject");
  console.log(
    "ok project expense reject audit failure: request/instance/unsigned action/quota/release audit all rolled back"
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
    await verifyRealCreateGovernedRoute();
    await verifyIntermediateApproveRace();
    await verifyFinalApproveWinner();
    await verifyFinalRejectWinner();
    await verifyStaleCoordinateAfterNodeAdvance();
    await verifyDuplicateActiveInstancesFailClosed();
    await verifyAmountGates();
    await verifyApprovedAmountBelowPaidFailsClosed();
    await verifyUsedFinancingShrinkFailsClosed();
    await verifyGovernedSignatureFailures();
    await verifyLegacyRoleOnlyApprovalCompatibility();
    await verifyOrdinarySelfReviewFailsClosed();
    await verifyLeaderSelfReview();
    await verifyApproveAuditFailureRollsBack();
    await verifyRejectAuditFailureRollsBack();
    console.log(
      "项目支出审批 PostgreSQL 16 验收通过：真实阻塞和旧四坐标 409；approve/reject 双向赢家；签名、金额、自审、重复实例与额度门；双主审计故障全回滚；全程零新增实付/财务/资金分配"
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
