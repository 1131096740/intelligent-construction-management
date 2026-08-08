import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertValidUnifiedSocialCreditCode } from "../company-entity/unified-social-credit-code";

const localRequire = createRequire(__filename);
const {
  createControlledDockerEnv,
  createSpotProcurementRunnerCleanup
} = localRequire(
  "../../prisma/run-spot-procurement-concurrency-local.cjs"
) as {
  createControlledDockerEnv: (
    sourceEnv: Record<string, string | undefined>,
    fallbackHome: string
  ) => Record<string, string>;
  createSpotProcurementRunnerCleanup: (options: {
    commandRuntime: { stopAll: () => Promise<void> };
    dockerCommand: (
      args: string[],
      options?: Record<string, unknown>
    ) => Promise<unknown>;
    containerName: string;
    temporaryRoot: string;
    removeTemporaryRoot: (
      path: string,
      options: { recursive: true; force: true }
    ) => Promise<void>;
  }) => () => Promise<void>;
};
const {
  deriveFixtureUnifiedSocialCreditCode
} = localRequire(
  "../../prisma/spot-procurement-concurrency-fixtures.cjs"
) as {
  deriveFixtureUnifiedSocialCreditCode: (seed: string) => string;
};

describe("spot procurement PostgreSQL concurrency runner cleanup", () => {
  it("pins inspect, run, exec, wait, and cleanup to one controlled local Docker context", () => {
    expect(
      createControlledDockerEnv(
        {
          PATH: "/usr/bin",
          HOME: "/tmp/home",
          DOCKER_HOST: "unix:///tmp/docker.sock",
          DOCKER_CONTEXT: "local-test",
          POSTGRES_PASSWORD: "must-not-leak"
        },
        "/tmp/fallback"
      )
    ).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      DOCKER_HOST: "unix:///tmp/docker.sock",
      DOCKER_CONTEXT: "local-test"
    });

    const runner = readFileSync(
      join(process.cwd(), "prisma/run-spot-procurement-concurrency-local.cjs"),
      "utf8"
    );
    expect(runner.match(/command\(\s*docker,/gu) ?? []).toHaveLength(1);
    expect(runner).toContain("await waitForPostgres(containerName, dockerCommand)");
    expect(runner).toContain("dockerCommand,");
    expect(runner).toContain("extraEnv: { POSTGRES_PASSWORD: databasePassword }");
  });

  it("runs an idempotent second deploy and proves all 120 migrations finished", () => {
    const runner = readFileSync(
      join(process.cwd(), "prisma/run-spot-procurement-concurrency-local.cjs"),
      "utf8"
    );

    expect(runner).toContain("EXPECTED_MIGRATION_COUNT = 120");
    expect(
      runner.match(/"migrate",\s*"deploy"/gu) ?? []
    ).toHaveLength(2);
    expect(runner).toContain("_prisma_migrations");
    expect(runner).toContain(
      "20260808070000_contract_counterparty_signed_formal_files"
    );
    expect(runner).toContain("appliedMigrationCount");
    expect(runner).toContain("terminalMigrationCount");
  });

  it("can restrict the live verifier to the approved application review signature gate", () => {
    const runner = readFileSync(
      join(process.cwd(), "prisma/run-spot-procurement-concurrency-local.cjs"),
      "utf8"
    );
    const verifier = readFileSync(
      join(process.cwd(), "prisma/verify-spot-procurement-concurrency.cjs"),
      "utf8"
    );
    const scopedStart = verifier.indexOf(
      "if (verificationScope === APPLICATION_REVIEW_APPROVE_SCOPE)"
    );
    const scopedEnd = verifier.indexOf(
      "\n  if (verificationScope === PAYMENT_REVIEW_APPROVE_SCOPE)",
      scopedStart
    );
    const scopedBranch = verifier.slice(scopedStart, scopedEnd);

    expect(runner).toContain(
      "SPOT_PROCUREMENT_CONCURRENCY_SCOPE"
    );
    expect(verifier).toContain(
      'APPLICATION_REVIEW_APPROVE_SCOPE = "application-review-approve"'
    );
    expect(verifier).toContain(
      "verificationScope === APPLICATION_REVIEW_APPROVE_SCOPE"
    );
    expect(runner).toContain(
      'verificationScope === "application-review-approve"'
    );
    expect(runner).toContain(
      "零星采购申请审批签名 PostgreSQL 16 限定门禁通过"
    );
    expect(scopedBranch).toContain(
      "await verifyApplicationReviewCoordinateConcurrency()"
    );
    expect(scopedBranch).toContain(
      "await verifyApplicationReviewSignatureFailures()"
    );
    expect(scopedBranch).toContain(
      "await verifyApplicationReviewAuditRollback()"
    );
    expect(scopedStart).toBeGreaterThanOrEqual(0);
    expect(scopedEnd).toBeGreaterThan(scopedStart);
    expect(scopedBranch.match(/await verify/gu) ?? []).toHaveLength(3);
    expect(scopedBranch).not.toContain("Withdrawal");
    expect(scopedBranch).not.toContain("Payment");
    expect(scopedBranch).not.toContain("Receipt");
    expect(scopedBranch).not.toContain("Invoice");
  });

  it("can restrict the live verifier to the approved payment review signature gate", () => {
    const runner = readFileSync(
      join(process.cwd(), "prisma/run-spot-procurement-concurrency-local.cjs"),
      "utf8"
    );
    const verifier = readFileSync(
      join(process.cwd(), "prisma/verify-spot-procurement-concurrency.cjs"),
      "utf8"
    );
    const scopedStart = verifier.indexOf(
      "if (verificationScope === PAYMENT_REVIEW_APPROVE_SCOPE)"
    );
    const scopedEnd = verifier.indexOf(
      "\n  const servicesA = servicesFor(clientA);",
      scopedStart
    );
    const scopedBranch = verifier.slice(scopedStart, scopedEnd);

    expect(runner).toContain(
      "SPOT_PROCUREMENT_CONCURRENCY_SCOPE"
    );
    expect(verifier).toContain(
      'PAYMENT_REVIEW_APPROVE_SCOPE = "payment-review-approve"'
    );
    expect(verifier).toContain(
      "verificationScope === PAYMENT_REVIEW_APPROVE_SCOPE"
    );
    expect(runner).toContain(
      'verificationScope === "payment-review-approve"'
    );
    expect(runner).toContain(
      "零星采购付款审批签名 PostgreSQL 16 限定门禁通过"
    );
    expect(scopedStart).toBeGreaterThanOrEqual(0);
    expect(scopedEnd).toBeGreaterThan(scopedStart);
    expect(scopedBranch).toContain(
      "await verifyPaymentReviewRowLockOneWinner()"
    );
    expect(scopedBranch).toContain(
      "await verifyPaymentReviewSignatureFailures()"
    );
    expect(scopedBranch).toContain(
      "await verifyPaymentReviewAuditRollback()"
    );
    expect(scopedBranch.match(/await verify/gu) ?? []).toHaveLength(3);
    expect(scopedBranch).not.toContain("Coordinate");
    expect(scopedBranch).not.toContain("Application");
    expect(scopedBranch).not.toContain("Withdrawal");
    expect(scopedBranch).not.toContain("Receipt");
    expect(scopedBranch).not.toContain("Invoice");
  });

  it("derives a unique payer identity for each payment approval fixture", () => {
    const codes = [
      "spot-payment-review-row-lock",
      "spot-payment-review-signature-missing",
      "spot-payment-review-signature-sha-mismatch",
      "spot-payment-review-audit-rollback"
    ].map(deriveFixtureUnifiedSocialCreditCode);

    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toHaveLength(18);
      expect(assertValidUnifiedSocialCreditCode(code)).toBe(code);
    }
  });

  it("checks unified file-binding triggers by governed table instead of retired trigger names", () => {
    const verifier = readFileSync(
      join(process.cwd(), "prisma/verify-spot-procurement-concurrency.cjs"),
      "utf8"
    );

    expect(verifier).toContain("jg_enforce_exclusive_file_business_binding");
    expect(verifier).toContain("SpotProcurementPaymentExecution");
    expect(verifier).toContain("SpotProcurementPaymentAttachment");
    expect(verifier).toContain("SpotProcurementPaymentExecutionVoucher");
    expect(verifier).toContain("SpotProcurementPaymentInvoice");
    expect(verifier).toContain("ProjectFundingAvailabilityService");
    expect(verifier).toContain(
      "const projectFunding = new ProjectFundingAvailabilityService()"
    );
    expect(verifier).toContain("closure,\n    projectFunding");
    expect(verifier).not.toContain("jg_efb_spot_payment_attachment");
  });

  it("proves stale spot-procurement review coordinates lose after a direct PostgreSQL row-lock wait", () => {
    const verifier = readFileSync(
      join(process.cwd(), "prisma/verify-spot-procurement-concurrency.cjs"),
      "utf8"
    );
    const proofStart = verifier.indexOf(
      "async function verifyApplicationReviewCoordinateConcurrency"
    );
    const proofEnd = verifier.indexOf(
      "\nasync function ",
      proofStart + 1
    );
    const proof = verifier.slice(
      proofStart,
      proofEnd === -1 ? verifier.length : proofEnd
    );
    const signatureHelperStart = verifier.indexOf(
      "async function seedApplicationReviewSignature"
    );
    const signatureHelperEnd = verifier.indexOf(
      "\nasync function ",
      signatureHelperStart + 1
    );
    const signatureHelper = verifier.slice(
      signatureHelperStart,
      signatureHelperEnd === -1
        ? verifier.length
        : signatureHelperEnd
    );

    expect(proofStart).toBeGreaterThanOrEqual(0);
    expect(signatureHelperStart).toBeGreaterThanOrEqual(0);
    expect(verifier).toContain("SpotProcurementApplicationService");
    expect(verifier).toContain(
      "await verifyApplicationReviewCoordinateConcurrency()"
    );
    expect(verifier).toContain("observerClient.$connect()");
    expect(verifier).toContain("observerClient.$disconnect()");
    expect(proof).toContain("new SpotProcurementApplicationService");
    expect(proof).toContain("expectedVersionId");
    expect(proof).toContain("expectedApprovalInstanceId");
    expect(proof).toContain("expectedNodeIndex");
    expect(proof).toContain("firstReviewAuditEntered");
    expect(proof).toContain("firstReviewBackendPid");
    expect(proof).toContain("secondReviewBackendPid");
    expect(proof).toContain("pg_backend_pid()");
    expect(proof).toContain("pg_blocking_pids");
    expect(proof).toContain('results[0].status === "fulfilled"');
    expect(proof).toContain('results[1].status === "rejected"');
    expect(proof).toContain("getStatus() === 409");
    expect(proof).toContain("currentNodeIndex === 1");
    expect(proof).toContain("seedApplicationReviewSignature(");
    expect(proof).toContain("APPLICATION_REVIEWER_USER_ID");
    expect(proof).toContain(
      "applicationReviewSignatureFixture(APPLICATION_REVIEWER_USER_ID)"
    );
    expect(signatureHelper).toContain("fileObject.create");
    expect(signatureHelper).toContain('mimeType: "image/png"');
    expect(signatureHelper).toContain('storageStatus: "active"');
    expect(signatureHelper).toContain(
      "handwrittenSignatureVersion.create"
    );
    expect(signatureHelper).toContain('source: "canvas"');
    expect(proof).toContain("approvalActionLog.findMany");
    expect(proof).toContain("actionLogs.length === 1");
    expect(proof).toContain(
      'action.approvedRoleKey === "material_director"'
    );
    expect(proof).toContain(
      "action.representedUserId === APPLICATION_REVIEWER_USER_ID"
    );
    expect(proof).toContain(
      "action.signatureFileIdSnapshot === signature.fileId"
    );
    expect(proof).toContain(
      "action.signatureSha256Snapshot === signature.sha256"
    );
    expect(proof).toContain(
      "action.signatureVersionIdSnapshot === signature.versionId"
    );
    expect(proof).toContain("auditLog.count");
    expect(proof).toContain("spotProcurementPayment.count");
    expect(proof).toContain("spotProcurementReceipt.count");
  });

  it("fails missing and mismatched application approval signatures before every durable write", () => {
    const verifier = readFileSync(
      join(process.cwd(), "prisma/verify-spot-procurement-concurrency.cjs"),
      "utf8"
    );
    const proofStart = verifier.indexOf(
      "async function verifyApplicationReviewSignatureFailures"
    );
    const proofEnd = verifier.indexOf("\nasync function ", proofStart + 1);
    const proof = verifier.slice(
      proofStart,
      proofEnd === -1 ? verifier.length : proofEnd
    );

    expect(proofStart).toBeGreaterThanOrEqual(0);
    expect(verifier).toContain(
      "await verifyApplicationReviewSignatureFailures()"
    );
    expect(proof).toContain('label: "signature-missing"');
    expect(proof).toContain('label: "signature-sha-mismatch"');
    expect(proof).toContain("审批手写签名未配置");
    expect(proof).toContain("审批手写签名版本校验失败");
    expect(proof).toContain('failure.getStatus() === 400');
    expect(proof).toContain("snapshotApplicationApprovalState");
    expect(proof).toContain("assertUnchanged(before, after");
    expect(proof).toContain("actionLogCount === 0");
    expect(proof).toContain("auditLogCount === 0");
    expect(proof).toContain("paymentCount === 0");
    expect(proof).toContain("receiptCount === 0");
    expect(proof).toContain('root.status === "approval_pending"');
    expect(proof).toContain(
      'version.status === "approval_pending"'
    );
    expect(proof).toContain(
      'approval.status === "approval_pending"'
    );
    expect(proof).toContain("approval.currentNodeIndex === 0");
  });

  it("rolls signed application approval, node, business drafts, and audit rows back on a mid-audit fault", () => {
    const verifier = readFileSync(
      join(process.cwd(), "prisma/verify-spot-procurement-concurrency.cjs"),
      "utf8"
    );
    const proofStart = verifier.indexOf(
      "async function verifyApplicationReviewAuditRollback"
    );
    const proofEnd = verifier.indexOf("\nasync function ", proofStart + 1);
    const proof = verifier.slice(
      proofStart,
      proofEnd === -1 ? verifier.length : proofEnd
    );

    expect(proofStart).toBeGreaterThanOrEqual(0);
    expect(verifier).toContain(
      "await verifyApplicationReviewAuditRollback()"
    );
    expect(proof).toContain(
      'input.action === "spot_procurement.approval.approve"'
    );
    expect(proof).toContain(
      'throw new Error("injected application approval audit failure")'
    );
    expect(proof).toContain("observedCompletePreFailureState");
    expect(proof).toContain("approvalActionLog.findMany");
    expect(proof).toContain(
      "action.signatureFileIdSnapshot === signature.fileId"
    );
    expect(proof).toContain(
      "action.signatureSha256Snapshot === signature.sha256"
    );
    expect(proof).toContain(
      "action.signatureVersionIdSnapshot === signature.versionId"
    );
    expect(proof).toContain('approval.status === "approved"');
    expect(proof).toContain('root.status === "approved_in_progress"');
    expect(proof).toContain('version.status === "approved"');
    expect(proof).toContain("paymentCount === 1");
    expect(proof).toContain("receiptCount === 1");
    expect(proof).toContain("auditCount === 3");
    expect(proof).toContain("assertUnchanged(before, after");
    expect(proof).toContain("actionLogCount === 0");
    expect(proof).toContain("auditLogCount === 0");
    expect(proof).toContain("paymentCountAfter === 0");
    expect(proof).toContain("receiptCountAfter === 0");
  });

  it("proves one payment approval wins after a direct two-connection row-lock wait", () => {
    const verifier = readFileSync(
      join(process.cwd(), "prisma/verify-spot-procurement-concurrency.cjs"),
      "utf8"
    );
    const proofStart = verifier.indexOf(
      "async function verifyPaymentReviewRowLockOneWinner"
    );
    const proofEnd = verifier.indexOf("\nasync function ", proofStart + 1);
    const proof = verifier.slice(
      proofStart,
      proofEnd === -1 ? verifier.length : proofEnd
    );

    expect(proofStart).toBeGreaterThanOrEqual(0);
    expect(verifier).toContain(
      "await verifyPaymentReviewRowLockOneWinner()"
    );
    expect(verifier).toContain("pg_blocking_pids(pid)");
    expect(proof).toContain("paymentServicesFor(");
    expect(proof).toContain("firstReviewAuditEntered");
    expect(proof).toContain("firstReviewBackendPid");
    expect(proof).toContain("secondReviewBackendPid");
    expect(proof).toContain("pg_backend_pid()");
    expect(proof).toContain("waitForDirectBackendPidBlock");
    expect(proof).not.toContain("expectedVersionId");
    expect(proof).not.toContain("expectedApprovalInstanceId");
    expect(proof).not.toContain("expectedNodeIndex");
    expect(proof).not.toContain("Coordinate");
    expect(proof).toContain('results[0].status === "fulfilled"');
    expect(proof).toContain('results[1].status === "rejected"');
    expect(proof).toContain("getStatus() === 409");
    expect(proof).toContain(
      'after.payment.status === "approved_pending_payment"'
    );
    expect(proof).toContain('after.approval.status === "approved"');
    expect(proof).toContain("after.actionLogs.length === 1");
    expect(proof).toContain(
      'action.approvedRoleKey === "project_manager"'
    );
    expect(proof).toContain(
      "action.representedUserId === PAYMENT_REVIEWER_USER_ID"
    );
    expect(proof).toContain(
      "action.signatureFileIdSnapshot === signature.fileId"
    );
    expect(proof).toContain(
      "action.signatureSha256Snapshot === signature.sha256"
    );
    expect(proof).toContain(
      "action.signatureVersionIdSnapshot === signature.versionId"
    );
    expect(proof).toContain("after.auditLogs.length === 1");
    expect(proof).toContain("before.balanceAccount");
    expect(proof).toContain("before.balanceReservation");
    expect(proof).toContain("before.balanceEntries");
  });

  it("fails missing and SHA-drifted payment approval signatures with zero durable changes", () => {
    const verifier = readFileSync(
      join(process.cwd(), "prisma/verify-spot-procurement-concurrency.cjs"),
      "utf8"
    );
    const proofStart = verifier.indexOf(
      "async function verifyPaymentReviewSignatureFailures"
    );
    const proofEnd = verifier.indexOf("\nasync function ", proofStart + 1);
    const proof = verifier.slice(
      proofStart,
      proofEnd === -1 ? verifier.length : proofEnd
    );

    expect(proofStart).toBeGreaterThanOrEqual(0);
    expect(verifier).toContain(
      "await verifyPaymentReviewSignatureFailures()"
    );
    expect(proof).toContain('label: "signature-missing"');
    expect(proof).toContain('label: "signature-sha-mismatch"');
    expect(proof).toContain("审批手写签名未配置");
    expect(proof).toContain("审批手写签名版本校验失败");
    expect(proof).toContain("failure.getStatus() === 400");
    expect(proof).toContain("snapshotPaymentReviewState");
    expect(proof).toContain("assertUnchanged(before, after");
    expect(proof).toContain(
      'after.payment.status === "approval_pending"'
    );
    expect(proof).toContain(
      'after.approval.status === "approval_pending"'
    );
    expect(proof).toContain("after.actionLogs.length === 0");
    expect(proof).toContain("after.auditLogs.length === 0");
    expect(proof).toContain(
      "after.balanceAccount.reservedAmountCents === 1_000n"
    );
    expect(proof).toContain(
      'after.balanceReservation.status === "reserved"'
    );
    expect(proof).toContain("after.balanceEntries.length === 1");
  });

  it("rolls signed payment approval, final states, audit, and balance observation back on a mid-audit fault", () => {
    const verifier = readFileSync(
      join(process.cwd(), "prisma/verify-spot-procurement-concurrency.cjs"),
      "utf8"
    );
    const proofStart = verifier.indexOf(
      "async function verifyPaymentReviewAuditRollback"
    );
    const proofEnd = verifier.indexOf("\nasync function ", proofStart + 1);
    const proof = verifier.slice(
      proofStart,
      proofEnd === -1 ? verifier.length : proofEnd
    );

    expect(proofStart).toBeGreaterThanOrEqual(0);
    expect(verifier).toContain(
      "await verifyPaymentReviewAuditRollback()"
    );
    expect(proof).toContain(
      '"spot_procurement.payment.approval.approve"'
    );
    expect(proof).toContain(
      'throw new Error(\n          "injected payment approval audit failure"'
    );
    expect(proof).toContain("observedCompletePreFailureState");
    expect(proof).toContain("approvalActionLog.findMany");
    expect(proof).toContain(
      "action.signatureFileIdSnapshot === signature.fileId"
    );
    expect(proof).toContain(
      "action.signatureSha256Snapshot === signature.sha256"
    );
    expect(proof).toContain(
      "action.signatureVersionIdSnapshot === signature.versionId"
    );
    expect(proof).toContain('approval.status === "approved"');
    expect(proof).toContain(
      'payment.status === "approved_pending_payment"'
    );
    expect(proof).toContain("auditLogs.length === 1");
    expect(proof).toContain("comparable(balanceAccount)");
    expect(proof).toContain("comparable(balanceReservation)");
    expect(proof).toContain("comparable(balanceEntries)");
    expect(proof).toContain("assertUnchanged(before, after");
    expect(proof).toContain(
      'after.payment.status === "approval_pending"'
    );
    expect(proof).toContain(
      'after.approval.status === "approval_pending"'
    );
    expect(proof).toContain("after.actionLogs.length === 0");
    expect(proof).toContain("after.auditLogs.length === 0");
  });

  it("proves one exact-coordinate procurement withdrawal wins after a direct backend PID wait", () => {
    const verifier = readFileSync(
      join(process.cwd(), "prisma/verify-spot-procurement-concurrency.cjs"),
      "utf8"
    );
    const proofStart = verifier.indexOf(
      "async function verifyApplicationWithdrawalCoordinateConcurrency"
    );
    const proofEnd = verifier.indexOf(
      "\nasync function ",
      proofStart + 1
    );
    const proof = verifier.slice(
      proofStart,
      proofEnd === -1 ? verifier.length : proofEnd
    );

    expect(proofStart).toBeGreaterThanOrEqual(0);
    expect(verifier).toContain(
      "await verifyApplicationWithdrawalCoordinateConcurrency()"
    );
    expect(verifier).toContain(
      "async function waitForDirectBackendPidBlock"
    );
    expect(verifier).toContain("pg_blocking_pids(pid)");
    expect(proof).toContain("firstWithdrawalAuditEntered");
    expect(proof).toContain("firstWithdrawalBackendPid");
    expect(proof).toContain("secondWithdrawalBackendPid");
    expect(proof).toContain("await Promise.race([");
    expect(proof).toContain(
      "releaseFirstWithdrawalAudit.resolve(undefined)"
    );
    expect(proof).toContain("Promise.allSettled([firstRequest])");
    expect(proof).toContain("waitForDirectBackendPidBlock");
    expect(proof).toContain("withdrawApproval(");
    expect(proof).toContain("expectedVersionId");
    expect(proof).toContain("expectedApprovalInstanceId");
    expect(proof).toContain("expectedNodeIndex");
    expect(proof).toContain('results[0].status === "fulfilled"');
    expect(proof).toContain('results[1].status === "rejected"');
    expect(proof).toContain("getStatus() === 409");
    expect(proof).toContain("versions.length === 2");
    expect(proof).toContain('sourceVersion?.status === "withdrawn"');
    expect(proof).toContain('approval?.status === "withdrawn"');
    expect(proof).toContain("approvalActionLog.findMany");
    expect(proof).toContain("auditLog.findMany");
    expect(proof).toContain("frozenApplicationLineFacts");
    expect(proof).toContain("frozenApplicationAttachmentFacts");
    expect(proof).toContain("spotProcurementPayment.count");
    expect(proof).toContain("spotProcurementReceipt.count");
  });

  it("proves withdrawal and approval node advance have one strict-409 loser and a consistent terminal state", () => {
    const verifier = readFileSync(
      join(process.cwd(), "prisma/verify-spot-procurement-concurrency.cjs"),
      "utf8"
    );
    const proofStart = verifier.indexOf(
      "async function verifyApplicationWithdrawalVsNodeAdvanceCompetition"
    );
    const proofEnd = verifier.indexOf(
      "\nasync function ",
      proofStart + 1
    );
    const proof = verifier.slice(
      proofStart,
      proofEnd === -1 ? verifier.length : proofEnd
    );

    expect(proofStart).toBeGreaterThanOrEqual(0);
    expect(verifier).toContain(
      "await verifyApplicationWithdrawalVsNodeAdvanceCompetition()"
    );
    expect(proof).toContain("runBehindDatabaseLock");
    expect(proof).toContain("withdrawalService.withdrawApproval(");
    expect(proof).toContain("reviewService.review(");
    expect(proof).toContain('decision: "approve"');
    expect(proof).toContain("assertOneWinner(");
    expect(proof).toContain("loser.reason.getStatus() === 409");
    expect(proof).toContain("winnerIndex === 0");
    expect(proof).toContain('root?.status === "draft"');
    expect(proof).toContain('sourceVersion?.status === "withdrawn"');
    expect(proof).toContain('root?.status === "approval_pending"');
    expect(proof).toContain("approval.currentNodeIndex === 1");
    expect(proof).toContain("actionLogs.length === 1");
    expect(proof).toContain("auditLogs.length === 1");
    expect(proof).toContain("spotProcurementPayment.count");
    expect(proof).toContain("spotProcurementReceipt.count");
  });

  it("proves return to applicant creates one copied V2 draft with no payment or receipt facts", () => {
    const verifier = readFileSync(
      join(process.cwd(), "prisma/verify-spot-procurement-concurrency.cjs"),
      "utf8"
    );
    const proofStart = verifier.indexOf(
      "async function verifyApplicationReturnToApplicantTerminalState"
    );
    const proofEnd = verifier.indexOf(
      "\nasync function ",
      proofStart + 1
    );
    const proof = verifier.slice(
      proofStart,
      proofEnd === -1 ? verifier.length : proofEnd
    );

    expect(proofStart).toBeGreaterThanOrEqual(0);
    expect(verifier).toContain(
      "await verifyApplicationReturnToApplicantTerminalState()"
    );
    expect(proof).toContain("new SpotProcurementApplicationService");
    expect(proof).toContain("applicationService.review(");
    expect(proof).toContain('decision: "return_to_applicant"');
    expect(proof).toContain("expectedVersionId");
    expect(proof).toContain("expectedApprovalInstanceId");
    expect(proof).toContain("expectedNodeIndex");
    expect(proof).toContain("versions.length === 2");
    expect(proof).toContain('sourceVersion?.status === "returned"');
    expect(proof).toContain(
      'approval?.status === "returned_to_applicant"'
    );
    expect(proof).toContain('root?.status === "draft"');
    expect(proof).toContain("root.currentVersionId === draft.id");
    expect(proof).toContain("approvalActionLog.findMany");
    expect(proof).toContain("auditLog.findMany");
    expect(proof).toContain("frozenApplicationLineFacts");
    expect(proof).toContain("frozenApplicationAttachmentFacts");
    expect(proof).toContain("spotProcurementPayment.count");
    expect(proof).toContain("spotProcurementReceipt.count");
  });

  it("proves a withdrawal audit fault rolls the whole transaction back", () => {
    const verifier = readFileSync(
      join(process.cwd(), "prisma/verify-spot-procurement-concurrency.cjs"),
      "utf8"
    );
    const proofStart = verifier.indexOf(
      "async function verifyApplicationWithdrawalMidTransactionRollback"
    );
    const proofEnd = verifier.indexOf(
      "\nasync function ",
      proofStart + 1
    );
    const proof = verifier.slice(
      proofStart,
      proofEnd === -1 ? verifier.length : proofEnd
    );

    expect(proofStart).toBeGreaterThanOrEqual(0);
    expect(verifier).toContain(
      "await verifyApplicationWithdrawalMidTransactionRollback()"
    );
    expect(proof).toContain("new SpotProcurementApplicationService");
    expect(proof).toContain("applicationService.withdrawApproval(");
    expect(proof).toContain(
      'input.action === "spot_procurement.approval.withdraw"'
    );
    expect(proof).toContain(
      'throw new Error("injected withdrawal audit failure")'
    );
    expect(proof).toContain("expectedVersionId");
    expect(proof).toContain("expectedApprovalInstanceId");
    expect(proof).toContain("expectedNodeIndex");
    expect(proof).toContain("versions.length === 1");
    expect(proof).toContain('root?.status === "approval_pending"');
    expect(proof).toContain(
      "root.currentVersionId === fixture.versionId"
    );
    expect(proof).toContain(
      'sourceVersion?.status === "approval_pending"'
    );
    expect(proof).toContain(
      'approval?.status === "approval_pending"'
    );
    expect(proof).toContain("approvalActionLog.count");
    expect(proof).toContain("auditLog.count");
    expect(proof).toContain("actionLogCount === 0");
    expect(proof).toContain("auditLogCount === 0");
    expect(proof).toContain("spotProcurementPayment.count");
    expect(proof).toContain("spotProcurementReceipt.count");
  });

  it("fails legacy mixed-form withdrawal and return closed without changing any frozen fact", () => {
    const verifier = readFileSync(
      join(process.cwd(), "prisma/verify-spot-procurement-concurrency.cjs"),
      "utf8"
    );
    const fixtureStart = verifier.indexOf(
      "async function createLegacyPendingApplicationApprovalFixture"
    );
    const fixtureEnd = verifier.indexOf(
      "\nasync function ",
      fixtureStart + 1
    );
    const fixture = verifier.slice(
      fixtureStart,
      fixtureEnd === -1 ? verifier.length : fixtureEnd
    );
    const snapshotStart = verifier.indexOf(
      "async function snapshotApplicationApprovalState"
    );
    const snapshotEnd = verifier.indexOf(
      "\nasync function ",
      snapshotStart + 1
    );
    const snapshot = verifier.slice(
      snapshotStart,
      snapshotEnd === -1 ? verifier.length : snapshotEnd
    );

    expect(fixtureStart).toBeGreaterThanOrEqual(0);
    expect(snapshotStart).toBeGreaterThanOrEqual(0);
    for (const field of [
      "supplierPartyId",
      "supplierKey",
      "supplierNameSnapshot",
      "approvedAmountCents",
      "actualCostCents",
      "totalAmountCents",
      "invoiceMode",
      "invoiceType",
      "vatRateOptionId",
      "vatRateValueSnapshot",
      "vatRateLabelSnapshot",
      "unitPrice",
      "amountCents",
      "usageLocation"
    ]) {
      expect(fixture).toContain(field);
    }
    expect(fixture).toContain("spotProcurementLine.createMany");
    expect(fixture).toContain("spotProcurementAttachment.createMany");
    expect(snapshot).toContain("spotProcurement.findUniqueOrThrow");
    expect(snapshot).toContain("spotProcurementVersion.findMany");
    expect(snapshot).toContain("spotProcurementLine.findMany");
    expect(snapshot).toContain("spotProcurementAttachment.findMany");
    expect(snapshot).toContain("approvalInstance.findUniqueOrThrow");
    expect(snapshot).toContain("approvalActionLog.findMany");
    expect(snapshot).toContain("auditLog.findMany");
    expect(
      verifier.match(/assertLegacyApplicationFixtureComplete\(/gu) ?? []
    ).toHaveLength(3);

    for (const proofName of [
      "verifyLegacyApplicationWithdrawalFailsClosed",
      "verifyLegacyApplicationReturnToApplicantFailsClosed"
    ]) {
      const proofStart = verifier.indexOf(`async function ${proofName}`);
      const proofEnd = verifier.indexOf("\nasync function ", proofStart + 1);
      const proof = verifier.slice(
        proofStart,
        proofEnd === -1 ? verifier.length : proofEnd
      );

      expect(proofStart).toBeGreaterThanOrEqual(0);
      expect(verifier).toContain(`await ${proofName}()`);
      expect(proof).toContain("getStatus() === 409");
      expect(proof).toContain("assertUnchanged(before, after");
      expect(proof).toContain("after.versions.length === 1");
      expect(proof).toContain("version.versionNo === 2");
    }
  });

  it("proves successful real-form withdrawal and return keep every retired commercial field null", () => {
    const verifier = readFileSync(
      join(process.cwd(), "prisma/verify-spot-procurement-concurrency.cjs"),
      "utf8"
    );
    const helperStart = verifier.indexOf(
      "function assertRealApplicationLegacyFieldsNull"
    );
    const helperEnd = verifier.indexOf(
      "\nfunction ",
      helperStart + 1
    );
    const helper = verifier.slice(
      helperStart,
      helperEnd === -1 ? verifier.length : helperEnd
    );

    expect(helperStart).toBeGreaterThanOrEqual(0);
    for (const field of [
      "supplierPartyId",
      "supplierKey",
      "supplierNameSnapshot",
      "approvedAmountCents",
      "actualCostCents",
      "totalAmountCents",
      "invoiceMode",
      "invoiceType",
      "vatRateOptionId",
      "vatRateValueSnapshot",
      "vatRateLabelSnapshot",
      "unitPrice",
      "amountCents",
      "usageLocation"
    ]) {
      expect(helper).toContain(field);
    }
    expect(
      verifier.match(/assertRealApplicationLegacyFieldsNull\(/gu) ?? []
    ).toHaveLength(3);
  });

  it("removes the unique container name even when docker run has not settled", async () => {
    const containerName = "jiangkong-spot-concurrency-pending-run";
    const pendingDockerRun = new Promise<never>(() => undefined);
    const dockerCommand = jest
      .fn()
      .mockImplementation(
        (args: string[]) => {
          if (args[0] === "run") return pendingDockerRun;
          return Promise.resolve({ stdout: "", stderr: "" });
        }
      );
    const stopAll = jest.fn().mockResolvedValue(undefined);
    const removeTemporaryRoot = jest
      .fn()
      .mockResolvedValue(undefined);

    void dockerCommand([
      "run",
      "--detach",
      "--rm",
      "--name",
      containerName,
      "postgres:16"
    ]);
    const cleanup = createSpotProcurementRunnerCleanup({
      commandRuntime: { stopAll },
      dockerCommand,
      containerName,
      temporaryRoot: "/tmp/spot-concurrency-test",
      removeTemporaryRoot
    });

    await cleanup();

    expect(stopAll).toHaveBeenCalledTimes(1);
    expect(dockerCommand).toHaveBeenCalledWith(
      ["rm", "--force", containerName],
      { timeoutMs: 60_000 }
    );
    expect(removeTemporaryRoot).toHaveBeenCalledWith(
      "/tmp/spot-concurrency-test",
      { recursive: true, force: true }
    );
  });
});
