const { createHash } = require("node:crypto");
const { Prisma, PrismaClient } = require("@prisma/client");
const { AuditService } = require("../dist/audit/audit.service");
const {
  PaymentAmountService
} = require("../dist/payment/payment-amount.service");
const {
  PaymentRequestService
} = require("../dist/payment/payment-request.service");

const DATABASE_NAME =
  "jiangkong_payment_approval_concurrency_verify";
const PROJECT_ID = "payment-approval-concurrency-project";
const APPLICANT_USER_ID = "payment-approval-applicant";
const CHAIRMAN_USER_ID = "payment-approval-chairman";
const GENERAL_MANAGER_USER_ID = "payment-approval-general-manager";
const CONTRACT_ID = "payment-approval-contract";
const CONTRACT_VERSION_ID = "payment-approval-contract-v1";
const PAYMENT_TERMS_VERSION_ID =
  "payment-approval-contract-terms-v1";
const REQUESTED_AMOUNT_CENTS = 1_000n;
const APPROVED_AMOUNT_CENTS = 800n;
const OCCUPIED_FINANCING_CENTS = 400n;
const EXPECTED_REMAINING_OCCUPIED_CENTS = 200n;
const SIGNATURE_BYTES = {
  [CHAIRMAN_USER_ID]: Buffer.from(
    "payment-approval-chairman-signature"
  ),
  [GENERAL_MANAGER_USER_ID]: Buffer.from(
    "payment-approval-general-manager-signature"
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

function assertLocalRuntime() {
  const databaseUrlText = process.env.DATABASE_URL ?? "";
  let databaseUrl;
  try {
    databaseUrl = new URL(databaseUrlText);
  } catch {
    throw new Error("付款审批并发验收 DATABASE_URL 不是有效 URL");
  }
  assert(
    ["postgresql:", "postgres:"].includes(databaseUrl.protocol),
    "付款审批并发验收只能连接 PostgreSQL"
  );
  assert(
    ["127.0.0.1", "localhost", "::1", "[::1]"].includes(
      databaseUrl.hostname
    ),
    "付款审批并发验收拒绝连接非本机数据库"
  );
  assert(
    databaseUrl.pathname === `/${DATABASE_NAME}`,
    "付款审批并发验收只允许连接专用的一次性临时数据库"
  );
  assert(
    process.env.NODE_ENV === "test",
    "付款审批并发验收要求 NODE_ENV=test"
  );
}

function approvalNode(name = "董事长/总经理") {
  return {
    name,
    mode: "any",
    roleKeys: ["chairman", "general_manager"],
    candidateUserIdsByRole: {
      chairman: [CHAIRMAN_USER_ID],
      general_manager: [GENERAL_MANAGER_USER_ID]
    },
    candidateUserIds: [
      CHAIRMAN_USER_ID,
      GENERAL_MANAGER_USER_ID
    ]
  };
}

function signatureFixture(userId) {
  const bytes = SIGNATURE_BYTES[userId];
  assert(bytes, `缺少 ${userId} 的签名验收字节`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    fileId: `${userId}-signature-file`,
    versionId: `${userId}-signature-version`,
    sha256
  };
}

async function seedBaseFacts() {
  await clientA.project.create({
    data: {
      id: PROJECT_ID,
      code: "PAYMENT-APPROVAL-CONCURRENCY",
      name: "付款审批 PostgreSQL 并发验收临时项目"
    }
  });
  await clientA.user.createMany({
    data: [
      {
        id: APPLICANT_USER_ID,
        name: "付款审批并发验收申请人",
        isActive: true,
        mustChangePassword: false
      },
      {
        id: CHAIRMAN_USER_ID,
        name: "付款审批并发验收董事长",
        isActive: true,
        mustChangePassword: false
      },
      {
        id: GENERAL_MANAGER_USER_ID,
        name: "付款审批并发验收总经理",
        isActive: true,
        mustChangePassword: false
      }
    ]
  });
  await clientA.projectMember.createMany({
    data: [
      {
        projectId: PROJECT_ID,
        userId: APPLICANT_USER_ID,
        positionKey: "contract_staff"
      },
      {
        projectId: PROJECT_ID,
        userId: CHAIRMAN_USER_ID,
        positionKey: "chairman"
      },
      {
        projectId: PROJECT_ID,
        userId: GENERAL_MANAGER_USER_ID,
        positionKey: "general_manager"
      }
    ]
  });
  await clientA.contract.create({
    data: {
      id: CONTRACT_ID,
      projectId: PROJECT_ID,
      code: "HT-PAYMENT-APPROVAL-CONCURRENCY",
      name: "付款审批并发验收合同",
      counterparty: "付款审批并发验收相对方",
      contractTypeKey: "material_purchase",
      ownerUserId: APPLICANT_USER_ID
    }
  });
  await clientA.contractVersion.create({
    data: {
      id: CONTRACT_VERSION_ID,
      contractId: CONTRACT_ID,
      versionNo: 1,
      changeType: "original",
      status: "effective",
      amountCents: 10_000n,
      effectiveAt: new Date("2026-07-01T00:00:00.000Z"),
      signingSubjectType: "our_company",
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
      originalText: "付款审批并发验收付款条款"
    }
  });

  for (const userId of [
    CHAIRMAN_USER_ID,
    GENERAL_MANAGER_USER_ID
  ]) {
    const signature = signatureFixture(userId);
    await clientA.fileObject.create({
      data: {
        id: signature.fileId,
        bucket: "local-private",
        objectKey: `payment-approval-concurrency/${signature.fileId}.png`,
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
}

async function createPaymentFixture(label, options = {}) {
  const paymentId = `payment-approval-${label}`;
  const approvalInstanceId = `${paymentId}-approval`;
  const code = `FK-PAYMENT-${label.toUpperCase()}`;
  const frozenNodes = options.frozenNodes ?? [approvalNode()];
  const payment = await clientA.paymentRequest.create({
    data: {
      id: paymentId,
      projectId: PROJECT_ID,
      settlementId: null,
      sourceType: "contract_due",
      contractId: CONTRACT_ID,
      contractVersionId: CONTRACT_VERSION_ID,
      paymentTermsVersionId: PAYMENT_TERMS_VERSION_ID,
      paymentTermsStageId: null,
      code,
      status: "approval_pending",
      requestedAmountCents: REQUESTED_AMOUNT_CENTS,
      approvedAmountCents: null,
      paidAmountCents: 0n
    }
  });
  const approval = await clientA.approvalInstance.create({
    data: {
      id: approvalInstanceId,
      flowType: "payment.approve",
      businessType: "payment_request",
      businessId: paymentId,
      status: "in_progress",
      currentNodeIndex: 0,
      frozenNodes,
      applicantUserId: APPLICANT_USER_ID
    }
  });
  if (options.duplicateApproval) {
    await clientA.approvalInstance.create({
      data: {
        id: `${approvalInstanceId}-duplicate`,
        flowType: "payment.approve",
        businessType: "payment_request",
        businessId: paymentId,
        status: "in_progress",
        currentNodeIndex: 0,
        frozenNodes,
        applicantUserId: APPLICANT_USER_ID
      }
    });
  }
  await clientA.projectFinancingQuotaUsage.create({
    data: {
      id: `${paymentId}-financing-usage`,
      quotaId: `${paymentId}-financing-quota`,
      paymentRequestId: paymentId,
      projectId: PROJECT_ID,
      amountCents: OCCUPIED_FINANCING_CENTS,
      status: "occupied"
    }
  });
  return {
    paymentId,
    approvalInstanceId,
    expectedPaymentUpdatedAt: payment.updatedAt.toISOString(),
    expectedApprovalInstanceId: approval.id,
    expectedNodeIndex: approval.currentNodeIndex,
    expectedApprovalUpdatedAt: approval.updatedAt.toISOString()
  };
}

function createReviewPrisma(client, backendPid) {
  return {
    $transaction: (operation, options) =>
      client.$transaction(
        async (tx) => {
          const rows = await tx.$queryRaw(
            Prisma.sql`SELECT pg_backend_pid()::int AS "pid"`
          );
          backendPid.resolve(Number(rows[0]?.pid));
          return operation(tx);
        },
        {
          ...(options ?? {}),
          maxWait: 10_000,
          timeout: 15_000
        }
      )
  };
}

function approvalFormsNoop() {
  return {
    generateForInstance: async () => undefined
  };
}

function createPaymentService(prisma, audit) {
  return new PaymentRequestService(
    new PaymentAmountService(),
    prisma,
    audit,
    undefined,
    undefined,
    undefined,
    approvalFormsNoop(),
    undefined
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

async function observeDirectBlock(firstPid, secondPid) {
  let bestSnapshot = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
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
    `未观察到付款审批 backend ${secondPid} 被 ${firstPid} 直接阻塞；最接近快照 ${JSON.stringify(bestSnapshot)}`
  );
}

function approvalInput(
  fixture,
  decision,
  { includeApprovedAmount = true } = {}
) {
  return {
    decision,
    ...(decision === "approve"
      ? includeApprovedAmount
        ? { approvedAmountCents: APPROVED_AMOUNT_CENTS.toString() }
        : {}
      : { comment: "付款条件尚未满足" }),
    expectedPaymentUpdatedAt: fixture.expectedPaymentUpdatedAt,
    expectedApprovalInstanceId:
      fixture.expectedApprovalInstanceId,
    expectedNodeIndex: fixture.expectedNodeIndex,
    expectedApprovalUpdatedAt:
      fixture.expectedApprovalUpdatedAt
  };
}

async function runReviewRace({
  fixture,
  winnerDecision,
  winnerActorUserId,
  loserDecision,
  loserActorUserId,
  winnerInputOptions,
  loserInputOptions
}) {
  const firstReviewBackendPid = deferred();
  const secondReviewBackendPid = deferred();
  const firstReviewAuditEntered = deferred();
  const releaseFirstReviewAudit = deferred();
  const firstService = createPaymentService(
    createReviewPrisma(clientA, firstReviewBackendPid),
    pausingAudit(
      `payment.approval.${winnerDecision}`,
      firstReviewAuditEntered,
      releaseFirstReviewAudit
    )
  );
  const secondService = createPaymentService(
    createReviewPrisma(clientB, secondReviewBackendPid),
    new AuditService()
  );

  const firstRequest = firstService.reviewApproval(
    fixture.paymentId,
    winnerActorUserId,
    approvalInput(fixture, winnerDecision, winnerInputOptions)
  );
  await firstReviewAuditEntered.promise;
  const firstPid = await firstReviewBackendPid.promise;
  const secondRequest = secondService.reviewApproval(
    fixture.paymentId,
    loserActorUserId,
    approvalInput(fixture, loserDecision, loserInputOptions)
  );
  const secondPid = await secondReviewBackendPid.promise;
  assert(
    Number.isInteger(firstPid) &&
      Number.isInteger(secondPid) &&
      firstPid !== secondPid,
    "付款审批并发验收必须捕获两个不同的 PostgreSQL backend PID"
  );

  let blockError = null;
  try {
    await observeDirectBlock(firstPid, secondPid);
  } catch (error) {
    blockError = error;
  } finally {
    releaseFirstReviewAudit.resolve(undefined);
  }
  const results = await Promise.allSettled([
    firstRequest,
    secondRequest
  ]);
  if (blockError) throw blockError;
  assert(
    results[0].status === "fulfilled",
    `${winnerDecision} winner 必须成功，实际 ${
      results[0].status === "rejected"
        ? errorText(results[0].reason)
        : results[0].status
    }`
  );
  assert(
    results[1].status === "rejected" &&
      typeof results[1].reason?.getStatus === "function" &&
      results[1].reason.getStatus() === 409,
    `${loserDecision} loser 必须严格返回 409，实际 ${
      results[1].status === "rejected"
        ? errorText(results[1].reason)
        : results[1].status
    }`
  );
  return {
    winnerResult: results[0].value,
    loserError: results[1].reason
  };
}

async function readPaymentFacts(fixture) {
  const [
    payment,
    approvalInstances,
    actionLogs,
    auditLogs,
    financingUsages,
    paymentExecutionCount,
    paymentExecutionAllocationCount,
    financeRecordCount,
    projectFundingAllocationCount
  ] = await Promise.all([
    clientA.paymentRequest.findUnique({
      where: { id: fixture.paymentId }
    }),
    clientA.approvalInstance.findMany({
      where: {
        businessType: "payment_request",
        businessId: fixture.paymentId,
        flowType: "payment.approve"
      },
      orderBy: { id: "asc" }
    }),
    clientA.approvalActionLog.findMany({
      where: {
        approvalInstanceId: {
          in: await clientA.approvalInstance
            .findMany({
              where: {
                businessType: "payment_request",
                businessId: fixture.paymentId,
                flowType: "payment.approve"
              },
              select: { id: true }
            })
            .then((rows) => rows.map((row) => row.id))
        }
      },
      orderBy: { createdAt: "asc" }
    }),
    clientA.auditLog.findMany({
      where: {
        businessType: "payment_request",
        businessId: fixture.paymentId
      },
      orderBy: { createdAt: "asc" }
    }),
    clientA.projectFinancingQuotaUsage.findMany({
      where: { paymentRequestId: fixture.paymentId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    }),
    clientA.paymentExecution.count({
      where: { paymentRequestId: fixture.paymentId }
    }),
    clientA.paymentExecutionAllocation.count({
      where: { paymentRequestId: fixture.paymentId }
    }),
    clientA.financeRecord.count({
      where: { paymentRequestId: fixture.paymentId }
    }),
    clientA.projectFundingAllocation.count({
      where: {
        businessType: "payment_request",
        businessId: fixture.paymentId
      }
    })
  ]);
  return {
    payment,
    approvalInstances,
    actionLogs,
    auditLogs,
    financingUsages,
    paymentExecutionCount,
    paymentExecutionAllocationCount,
    financeRecordCount,
    projectFundingAllocationCount
  };
}

function sumUsageByStatus(usages, status) {
  return usages
    .filter((usage) => usage.status === status)
    .reduce((sum, usage) => sum + usage.amountCents, 0n);
}

function assertZeroActualPayment(facts, label) {
  assert(
    facts.payment?.paidAmountCents === 0n,
    `${label} 必须保持付款申请实付金额为 0`
  );
  assert(
    facts.paymentExecutionCount === 0 &&
      facts.paymentExecutionAllocationCount === 0 &&
      facts.financeRecordCount === 0 &&
      facts.projectFundingAllocationCount === 0,
    `${label} 不得生成 PaymentExecution/Allocation/FinanceRecord/资金分配，实际 ${facts.paymentExecutionCount}/${facts.paymentExecutionAllocationCount}/${facts.financeRecordCount}/${facts.projectFundingAllocationCount}`
  );
}

async function verifyApproveWinner() {
  const fixture = await createPaymentFixture("approve-wins");
  await runReviewRace({
    fixture,
    winnerDecision: "approve",
    winnerActorUserId: CHAIRMAN_USER_ID,
    loserDecision: "reject",
    loserActorUserId: GENERAL_MANAGER_USER_ID
  });
  const facts = await readPaymentFacts(fixture);
  const approval = facts.approvalInstances[0];
  const action = facts.actionLogs[0];
  const signature = signatureFixture(CHAIRMAN_USER_ID);

  assert(
    facts.payment?.status === "approved_pending_payment" &&
      facts.payment.approvedAmountCents === APPROVED_AMOUNT_CENTS,
    "approve winner 必须只进入 approved_pending_payment 并冻结批准金额"
  );
  assert(
    facts.approvalInstances.length === 1 &&
      approval.status === "approved" &&
      approval.currentNodeIndex === 1,
    "approve winner 必须只完成一个审批实例并将最终节点推进一次"
  );
  assert(
    facts.actionLogs.length === 1 &&
      action.action === "approve" &&
      action.actorUserId === CHAIRMAN_USER_ID &&
      action.approvedRoleKey === "chairman",
    "approve winner 必须只留下董事长的一条 approve ActionLog"
  );
  assert(
    action.signatureFileIdSnapshot === signature.fileId &&
      action.signatureSha256Snapshot === signature.sha256 &&
      action.signatureVersionIdSnapshot === signature.versionId,
    "approve winner 必须冻结完整且匹配的签名 file/SHA/version"
  );
  const auditActions = facts.auditLogs.map((log) => log.action);
  assert(
    auditActions.filter(
      (actionName) => actionName === "payment.approval.approve"
    ).length === 1 &&
      auditActions.filter(
        (actionName) =>
          actionName ===
          "payment.financing_quota.release.approval_amount_reduced"
      ).length === 1 &&
      facts.auditLogs.length === 2,
    `approve winner 必须精确保留审批与额度缩减审计各一条，实际 ${auditActions.join(",")}`
  );
  assert(
    sumUsageByStatus(facts.financingUsages, "occupied") ===
      EXPECTED_REMAINING_OCCUPIED_CENTS &&
      sumUsageByStatus(facts.financingUsages, "released") ===
        OCCUPIED_FINANCING_CENTS -
          EXPECTED_REMAINING_OCCUPIED_CENTS &&
      sumUsageByStatus(facts.financingUsages, "used") === 0n,
    "approve winner 必须按批准金额精确缩减融资额度且金额守恒"
  );
  assertZeroActualPayment(facts, "approve winner");
  console.log(
    "ok payment approval approve-winner status race: direct backend block, 状态门竞争 loser 409, one signed action, exact quota shrink, zero actual payment"
  );
}

async function verifyRejectWinner() {
  const fixture = await createPaymentFixture("reject-wins");
  await runReviewRace({
    fixture,
    winnerDecision: "reject",
    winnerActorUserId: GENERAL_MANAGER_USER_ID,
    loserDecision: "approve",
    loserActorUserId: CHAIRMAN_USER_ID
  });
  const facts = await readPaymentFacts(fixture);
  const approval = facts.approvalInstances[0];
  const action = facts.actionLogs[0];

  assert(
    facts.payment?.status === "approval_rejected" &&
      facts.payment.approvedAmountCents === null,
    "reject winner 必须进入 approval_rejected 且不得冻结批准金额"
  );
  assert(
    facts.approvalInstances.length === 1 &&
      approval.status === "rejected" &&
      approval.currentNodeIndex === 0,
    "reject winner 必须只驳回一个审批实例且不得推进节点"
  );
  assert(
    facts.actionLogs.length === 1 &&
      action.action === "reject" &&
      action.actorUserId === GENERAL_MANAGER_USER_ID &&
      action.approvedRoleKey === "general_manager",
    "reject winner 必须只留下总经理的一条 reject ActionLog"
  );
  assert(
    action.signatureFileIdSnapshot === null &&
      action.signatureSha256Snapshot === null &&
      action.signatureVersionIdSnapshot === null,
    "reject winner 不得伪造审批签名快照"
  );
  const auditActions = facts.auditLogs.map((log) => log.action);
  assert(
    auditActions.filter(
      (actionName) => actionName === "payment.approval.reject"
    ).length === 1 &&
      auditActions.filter(
        (actionName) =>
          actionName === "payment.financing_quota.release.reject"
      ).length === 1 &&
      facts.auditLogs.length === 2,
    `reject winner 必须精确保留驳回与额度释放审计各一条，实际 ${auditActions.join(",")}`
  );
  assert(
    sumUsageByStatus(facts.financingUsages, "occupied") === 0n &&
      sumUsageByStatus(facts.financingUsages, "released") ===
        OCCUPIED_FINANCING_CENTS &&
      sumUsageByStatus(facts.financingUsages, "used") === 0n,
    "reject winner 必须完整释放融资额度且金额守恒"
  );
  assertZeroActualPayment(facts, "reject winner");
  console.log(
    "ok payment approval reject-winner status race: direct backend block, 状态门竞争 loser 409, one unsigned action, exact quota release, zero actual payment"
  );
}

async function verifyStaleCoordinateLoserAfterNodeAdvance() {
  const fixture = await createPaymentFixture("stale-coordinate", {
    frozenNodes: [
      approvalNode("stale-coordinate-node-0"),
      approvalNode("stale-coordinate-node-1")
    ]
  });
  const { loserError } = await runReviewRace({
    fixture,
    winnerDecision: "approve",
    winnerActorUserId: CHAIRMAN_USER_ID,
    loserDecision: "approve",
    loserActorUserId: GENERAL_MANAGER_USER_ID,
    winnerInputOptions: { includeApprovedAmount: false },
    loserInputOptions: { includeApprovedAmount: false }
  });
  assert(
    errorText(loserError).includes("付款审批坐标已变化"),
    "付款仍在 approval_pending 时，旧四坐标 loser 必须严格返回 409"
  );

  const facts = await readPaymentFacts(fixture);
  const approval = facts.approvalInstances[0];
  const action = facts.actionLogs[0];
  const audit = facts.auditLogs[0];
  const frozenNodes = approval?.frozenNodes;
  const signature = signatureFixture(CHAIRMAN_USER_ID);

  assert(
    facts.payment?.status === "approval_pending" &&
      facts.payment.approvedAmountCents === null &&
      facts.payment.updatedAt.toISOString() !==
        fixture.expectedPaymentUpdatedAt &&
      facts.approvalInstances.length === 1 &&
      approval.id === fixture.expectedApprovalInstanceId &&
      approval.status === "in_progress" &&
      approval.currentNodeIndex === 1 &&
      approval.updatedAt.toISOString() !==
        fixture.expectedApprovalUpdatedAt,
    "stale-coordinate winner 必须只推进到 node1"
  );
  assert(
    Array.isArray(frozenNodes) &&
      frozenNodes.length === 2 &&
      frozenNodes[0]?.name === "stale-coordinate-node-0" &&
      frozenNodes[0]?.approvedRoleKeys?.length === 1 &&
      frozenNodes[0].approvedRoleKeys[0] === "chairman" &&
      frozenNodes[1]?.name === "stale-coordinate-node-1" &&
      (frozenNodes[1]?.approvedRoleKeys?.length ?? 0) === 0,
    "stale-coordinate winner 必须只完成 node0，node1 不得被 loser 改写"
  );
  assert(
    facts.actionLogs.length === 1 &&
      action.action === "approve" &&
      action.actorUserId === CHAIRMAN_USER_ID &&
      action.approvedRoleKey === "chairman" &&
      action.signatureFileIdSnapshot === signature.fileId &&
      action.signatureSha256Snapshot === signature.sha256 &&
      action.signatureVersionIdSnapshot === signature.versionId &&
      facts.auditLogs.length === 1 &&
      audit.action === "payment.approval.approve" &&
      audit.actorUserId === CHAIRMAN_USER_ID,
    "stale-coordinate winner 必须只写一条 ActionLog 与一条 AuditLog"
  );
  assert(
    sumUsageByStatus(facts.financingUsages, "occupied") ===
      OCCUPIED_FINANCING_CENTS &&
      sumUsageByStatus(facts.financingUsages, "released") === 0n &&
      sumUsageByStatus(facts.financingUsages, "used") === 0n,
    "stale-coordinate 非末节点不得移动融资额度"
  );
  assertZeroActualPayment(facts, "stale-coordinate winner");
  console.log(
    "ok payment approval stale-coordinate: direct backend block, payment remains approval_pending, old four-coordinate loser 409, exactly one node/action/audit"
  );
}

async function verifyDuplicateApprovalFailsClosed() {
  const fixture = await createPaymentFixture("duplicate", {
    duplicateApproval: true
  });
  const service = createPaymentService(clientA, new AuditService());
  const error = await service
    .reviewApproval(
      fixture.paymentId,
      CHAIRMAN_USER_ID,
      approvalInput(fixture, "approve")
    )
    .then(
      () => null,
      (caught) => caught
    );
  assert(
    error &&
      typeof error.getStatus === "function" &&
      error.getStatus() === 409,
    `重复进行中审批实例必须严格返回 409，实际 ${errorText(error)}`
  );
  const facts = await readPaymentFacts(fixture);
  assert(
    facts.payment?.status === "approval_pending" &&
      facts.payment.approvedAmountCents === null &&
      facts.approvalInstances.length === 2 &&
      facts.approvalInstances.every(
        (approval) =>
          approval.status === "in_progress" &&
          approval.currentNodeIndex === 0
      ),
    "重复审批实例失败关闭后付款和两个实例必须保持原状"
  );
  assert(
    facts.actionLogs.length === 0 &&
      facts.auditLogs.length === 0,
    "重复审批实例失败关闭不得写 ActionLog 或 AuditLog"
  );
  assert(
    sumUsageByStatus(facts.financingUsages, "occupied") ===
      OCCUPIED_FINANCING_CENTS &&
      sumUsageByStatus(facts.financingUsages, "released") === 0n,
    "重复审批实例失败关闭不得移动融资额度"
  );
  assertZeroActualPayment(facts, "重复审批实例失败关闭");
  console.log(
    "ok payment approval duplicate instances: strict 409 and zero writes"
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
    await verifyApproveWinner();
    await verifyRejectWinner();
    await verifyStaleCoordinateLoserAfterNodeAdvance();
    await verifyDuplicateApprovalFailsClosed();
    console.log(
      "付款审批 PostgreSQL 16 并发验收通过：approve/reject 状态门竞争 loser 409；双节点四坐标竞争 loser 409；直接阻塞、精确日志/签名/额度、重复实例失败关闭且零实付"
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
