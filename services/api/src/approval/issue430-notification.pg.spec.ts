import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import type { RoleKey } from "@jiangkong/shared-domain";
import { AuditService } from "../audit/audit.service";
import type { AuthService } from "../auth/auth.service";
import type { PrismaService } from "../database/prisma.service";
import { ExpenseClaimFundingNotificationService } from "../expense-claim/expense-claim-funding-notification.service";
import { ExpenseClaimService } from "../expense-claim/expense-claim.service";
import { ProjectExpenseService } from "../project-expense/project-expense.service";
import { ProjectService } from "../project/project.service";
import { ApprovalProgressService } from "./approval-progress.service";
import { ApprovalTransitionNotificationService } from "./approval-transition-notification.service";
import { isOwnedIssue430NativeDatabase, issue430SmsProbe, verifyIssue430CorrectionDelivery } from "./issue430-notification.test-support";

const enabled = process.env.RUN_POL115_ENTRY_PG16 === "1";
const pg = enabled ? test : test.skip;
const transitionKind = "approval_transition_duty_notification";
const expenseKind = "expense_claim_approval_duty_notification";
const rollback = new Error("合成事务回滚");
const reviewerPhone = "issue430-reviewer";
const otherReviewerPhone = "issue430-other-reviewer";

async function databaseFixture() {
  const url = new URL(process.env.DATABASE_URL ?? "");
  expect(url.hostname).toBe("127.0.0.1");
  expect(url.pathname === "/jiangkong_pol115_entry_test" || isOwnedIssue430NativeDatabase(url)).toBe(true);
  expect(process.env.NODE_ENV).toBe("test");
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } }) as PrismaService;
  try {
    const probe = issue430SmsProbe();
    const project = await db.project.create({ data: { name: "合成短信项目", code: randomUUID() } });
    const applicant = await db.user.create({ data: { name: "合成申请人", phone: randomUUID() } });
    const createReviewer = async (label: string, roles: readonly RoleKey[]) => {
      const user = await db.user.create({ data: { name: "合成审批人", phone: `${label}-${randomUUID()}` } });
      for (const key of roles) {
        const position = await db.position.upsert({ where: { key }, create: { key, name: key }, update: {} });
        await db.userPosition.create({ data: { userId: user.id, positionId: position.id,
          projectId: key === "project_manager" ? project.id : null } });
      }
      return user;
    };
    const reviewer = await createReviewer(reviewerPhone, ["finance_director", "project_manager"]);
    const secondReviewer = await createReviewer(otherReviewerPhone, ["finance_director"]);
    const fundingApplicantRole = await db.position.upsert({
      where: { key: "finance_staff" }, create: { key: "finance_staff", name: "财务人员" }, update: {}
    });
    await db.userPosition.create({ data: { userId: applicant.id, positionId: fundingApplicantRole.id } });
    const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) } as unknown as AuthService;
    const audit = new AuditService();
    const progress = new ApprovalProgressService(db, probe.sms);
    const notifications = new ApprovalTransitionNotificationService(db, probe.sms, progress);
    const expenses = new ExpenseClaimFundingNotificationService(db, probe.sms);
    const makeFile = (userId: string) => db.fileObject.create({ data: {
      bucket: "issue430-synthetic", objectKey: randomUUID(), originalName: "合成附件.pdf",
      mimeType: "application/pdf", sizeBytes: 256, contentSha256: "a".repeat(64), uploadedByUserId: userId,
      storageStatus: "active"
    } });
    return { db, probe, project, applicant, reviewer, secondReviewer, auth, audit, notifications, expenses, makeFile };
  } catch (error) {
    await db.$disconnect();
    throw error;
  }
}

pg("费用报销并联逐人入队及退回修改持久化", async () => {
  const { db, probe, project, applicant, reviewer, secondReviewer, audit, expenses } = await databaseFixture();
  try {
    const service = new ExpenseClaimService(db, {} as never, audit, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, expenses);
    const company = await db.companyEntity.create({ data: { name: "合成费用公司" } });
    const createCase = () => db.$transaction(async tx => {
      const claim = await tx.expenseClaim.create({ data: {
        code: randomUUID(), claimType: "reimbursement", status: "approval_pending", projectId: project.id,
        companyEntityId: company.id, companyEntityNameSnapshot: company.name, applicantUserId: applicant.id,
        applicantNameSnapshot: applicant.name, handledByUserId: applicant.id, handledByNameSnapshot: applicant.name,
        reason: "合成报销事由", requestedAmountCents: 100n, companyPayableAmountCents: 100n,
        submittedAt: new Date()
      } });
      const round = await tx.approvalInstance.create({ data: {
        flowType: "expense_claim.approve", businessType: "expense_claim", businessId: claim.id, applicantUserId: applicant.id,
        status: "in_progress", currentNodeIndex: 0, frozenNodes: [
          { name: "财务主管", mode: "any", roleKeys: ["finance_director"], roleScopesByRole: { finance_director: "global" } },
          { name: "项目经理", mode: "any", roleKeys: ["project_manager"], roleScopesByRole: { project_manager: "project" } }
        ].map(node => ({ ...node, protocolVersion: 1, executionMode: "parallel", candidatePolicy: "current_role_scope" })) as Prisma.InputJsonValue
      } });
      const pending = await tx.expenseClaim.update({ where: { id: claim.id }, data: { approvalInstanceId: round.id } });
      return { claim: pending, round };
    });
    const first = await createCase();
    const queueDuties = (tx: Prisma.TransactionClient) => expenses.queueApprovalDuties(tx, first.claim, first.round, applicant.id);
    const queued = (businessId: string) => ({ businessType: expenseKind, businessId, action: "queued" });
    await expect(db.$transaction(async tx => {
      await queueDuties(tx);
      await queueDuties(tx);
      expect(await tx.auditLog.count({ where: queued(first.claim.id) })).toBeGreaterThanOrEqual(3);
      throw rollback;
    })).rejects.toThrow(rollback);
    expect(await db.auditLog.count({ where: queued(first.claim.id) })).toBe(0);
    await db.$transaction(async tx => { await queueDuties(tx); await queueDuties(tx); });
    const rows = await db.auditLog.findMany({ where: queued(first.claim.id), select: { metadata: true } });
    expect(rows.map(row => row.metadata)).toEqual(expect.arrayContaining([
      expect.objectContaining({ recipientId: reviewer.id, approvalDutyIndex: 0 }),
      expect.objectContaining({ recipientId: reviewer.id, approvalDutyIndex: 1 }),
      expect.objectContaining({ recipientId: secondReviewer.id, approvalDutyIndex: 0 })
    ]));
    const ids = rows.map(row => JSON.stringify(row.metadata));
    expect(new Set(ids).size).toBe(rows.length);
    probe.enable();
    await expenses.afterCommit();
    const financeDuty = await expenses.approvalStatus(first.claim.id, reviewer.id, 0, first.round.id);
    const projectDuty = await expenses.approvalStatus(first.claim.id, reviewer.id, 1, first.round.id);
    const wrongRoundId = randomUUID();
    expect(await expenses.approvalStatus(first.claim.id, reviewer.id, 0, wrongRoundId)).toBeNull();
    expect(await expenses.approvalStatus(first.claim.id, reviewer.id, undefined, first.round.id)).toBeNull();
    expect(financeDuty).toMatchObject({ status: "failed", canRetry: true });
    expect(projectDuty).toMatchObject({ status: "failed", canRetry: true });
    expect(projectDuty!.attemptId).not.toBe(financeDuty!.attemptId);
    expect(probe.sends.filter(phone => phone === reviewer.phone)).toHaveLength(2);
    await expect(expenses.retryApproval(first.claim.id, reviewer.id, financeDuty!.attemptId, 1, first.round.id))
      .rejects.toThrow("短信记录已更新");
    await expect(expenses.retryApproval(first.claim.id, reviewer.id, financeDuty!.attemptId, 0, wrongRoundId))
      .rejects.toThrow("当前待办或短信记录已变化");
    probe.setOutcome("accepted");
    const retryFinance = () => expenses.retryApproval(first.claim.id, reviewer.id, financeDuty!.attemptId, 0, first.round.id);
    const retried = await retryFinance();
    expect(retried).toMatchObject({ status: "accepted", canRetry: false });
    expect(await retryFinance()).toEqual(retried);
    await expect(expenses.retryApproval(first.claim.id, reviewer.id, financeDuty!.attemptId, 0, wrongRoundId))
      .rejects.toThrow("当前待办或短信记录已变化");
    expect(await expenses.retryApproval(first.claim.id, reviewer.id, projectDuty!.attemptId, 1, first.round.id))
      .toMatchObject({ status: "accepted", canRetry: false });
    expect(probe.sends.filter(phone => phone === reviewer.phone)).toHaveLength(4);
    probe.disable();

    const roundsByClaim = new Map<string, string>();
    const reject = async ({ claim, round }: typeof first) => {
      roundsByClaim.set(claim.id, round.id);
      const result = await service.review(claim.id, reviewer.id, { decision: "reject", comment: "补充合成材料",
        approvalInstanceId: round.id, approvalDutyIndex: 0 });
      expect(result.status).toBe("draft");
      await db.$transaction(async tx => {
        expect(await expenses.queueApprovalCorrection(tx, claim.id, round, reviewer.id)).toBe(false);
      });
      const correction = await db.auditLog.findMany({ where: { ...queued(claim.id), metadata: { path: ["duty"], equals: "correction" } } });
      expect(correction).toHaveLength(1);
      expect(correction[0]?.metadata).toMatchObject({ recipientId: applicant.id, approvalInstanceId: round.id });
    };
    await reject(first);
    await verifyIssue430CorrectionDelivery({
      scenario: "expense_claim", deliveryKey: first.claim.id,
      applicant, otherActorId: secondReviewer.id, probe, sendPending: () => expenses.afterCommit(),
      status: (key, actor) => expenses.approvalStatus(key, actor, undefined, roundsByClaim.get(key)),
      retry: (key, actor, attempt) => expenses.retryApproval(key, actor, attempt, undefined, roundsByClaim.get(key)),
      queueUnknown: async () => { const unknown = await createCase(); await reject(unknown); return unknown.claim.id; }
    });
    const resubmitted = await createCase();
    await reject(resubmitted);
    await db.$transaction(async tx => {
      const next = await tx.approvalInstance.create({ data: {
        businessType: resubmitted.round.businessType, businessId: resubmitted.claim.id,
        flowType: resubmitted.round.flowType, applicantUserId: resubmitted.round.applicantUserId,
        status: "in_progress", currentNodeIndex: 0, frozenNodes: resubmitted.round.frozenNodes as Prisma.InputJsonValue
      } });
      await tx.expenseClaim.update({ where: { id: resubmitted.claim.id }, data: {
        status: "approval_pending", approvalInstanceId: next.id, companyPayableAmountCents: 100n
      } });
    });
    const before = probe.sends.length;
    probe.enable();
    await expenses.afterCommit();
    expect(probe.sends).toHaveLength(before);
    expect(await db.auditLog.count({ where: { ...queued(resubmitted.claim.id), action: "cancelled" } })).toBe(1);
    expect(await expenses.approvalStatus(resubmitted.claim.id, applicant.id, undefined, resubmitted.round.id)).toBeNull();
  } finally { await db.$disconnect(); }
}, 30_000);

pg.each(["project_expense_request", "project_financing_quota", "project_settlement_exception_quota"] as const)(
  "%s 实际审批事务撤销、职责去重和驳回短信",
  async businessType => {
    const { db, probe, project, applicant, reviewer, secondReviewer, auth, audit, notifications, makeFile } = await databaseFixture();
    try {
      const projects = new ProjectService(db, audit, auth, undefined, undefined, undefined, undefined, undefined, notifications);
      const projectExpense = new ProjectExpenseService(db, audit, auth, undefined, undefined, undefined, notifications);
      const seed = async () => {
        if (businessType === "project_financing_quota") {
          const attachment = await makeFile(applicant.id);
          await projects.requestProjectFinancingQuota(project.id, applicant.id, {
            amountCents: "100", reason: "合成额度事由", attachmentFileId: attachment.id, idempotencyKey: randomUUID()
          });
          return db.projectFinancingQuota.findUniqueOrThrow({ where: { attachmentFileId: attachment.id } });
        }
        if (businessType === "project_settlement_exception_quota") {
          const attachment = await makeFile(applicant.id);
          const contract = await db.contract.create({ data: { code: randomUUID(), name: "合成额度合同",
            counterparty: "合成相对方", projectId: project.id, ownerUserId: applicant.id } });
          await projects.requestSettlementExceptionQuota(project.id, applicant.id, {
            amountCents: "100", reason: "合成例外事由", attachmentFileId: attachment.id,
            contractId: contract.id, validUntil: new Date(Date.now() + 86_400_000).toISOString()
          });
          return db.projectSettlementExceptionQuota.findFirstOrThrow({ where: { attachmentFileId: attachment.id } });
        }
        return db.$transaction(async tx => {
          const request = await tx.projectExpenseRequest.create({ data: {
            projectId: project.id, code: randomUUID(), expenseType: "loan_reserve", expenseSubtype: "project_reserve",
            paymentSubject: "合成付款主体", reason: "合成历史支出", requestedAmountCents: 100n, paymentMethod: "bank_transfer",
            handlerUserId: applicant.id, applicantUserId: applicant.id, status: "approval_pending"
          } });
          const round = await tx.approvalInstance.create({ data: { businessId: request.id, businessType,
            flowType: "project_expense.approve", applicantUserId: applicant.id, status: "in_progress", currentNodeIndex: 0,
            frozenNodes: [{ name: "财务主管", mode: "any", roleKeys: ["finance_director"],
              candidateUserIdsByRole: { finance_director: [reviewer.id, secondReviewer.id] } }]
          } });
          await notifications.queue(tx, round.id, applicant.id);
          return request;
        });
      };
      const roundFor = (businessId: string) => db.approvalInstance.findFirstOrThrow({ where: { businessId, businessType } });
      const first = await seed();
      const round = await roundFor(first.id);
      const queued = (id: string) => ({ businessType: transitionKind, businessId: id, action: "queued" });
      await db.$transaction(tx => notifications.queue(tx, round.id, applicant.id));
      const approvalRows = await db.auditLog.findMany({ where: queued(round.id) });
      const expected = businessType === "project_settlement_exception_quota" ? [reviewer] : [reviewer, secondReviewer];
      for (const actor of expected) {
        expect(approvalRows.filter(row => (row.metadata as Prisma.JsonObject).recipientId === actor.id)).toHaveLength(1);
      }
      expect(approvalRows.map(row => row.metadata)).toContainEqual({ duty: 0, recipientId: reviewer.id });

      const reject = async (record: typeof first, target: typeof round) => {
        if (businessType === "project_expense_request") {
          await projectExpense.reviewApproval(project.id, record.id, reviewer.id, {
            decision: "reject", comment: "合成驳回", expectedExpenseUpdatedAt: record.updatedAt.toISOString(),
            expectedApprovalInstanceId: target.id, expectedApprovalUpdatedAt: target.updatedAt.toISOString(), expectedNodeIndex: 0
          });
        } else if (businessType === "project_settlement_exception_quota") {
          await projects.reviewSettlementExceptionQuota(project.id, record.id, reviewer.id, {
            decision: "reject", confirmationPassword: "synthetic", comment: "合成驳回"
          });
        } else {
          const signatureFile = await makeFile(reviewer.id);
          await db.handwrittenSignatureVersion.create({ data: { userId: reviewer.id, fileId: signatureFile.id, contentSha256: "a".repeat(64) } });
          const proof = await projects.getProjectFinancingQuotaReviewCapability(project.id, record.id, reviewer.id);
          await projects.reviewProjectFinancingQuota(project.id, record.id, reviewer.id, {
            decision: "reject", confirmationPassword: "synthetic", comment: "合成驳回",
            actionId: randomUUID(), expectedLifecycleToken: proof.lifecycleToken
          });
        }
      };
      const originalQueue = notifications.queue.bind(notifications);
      jest.spyOn(notifications, "queue").mockImplementationOnce(async (...args) => {
        expect(args[3]).toBe(true);
        expect(await originalQueue(...args)).toBe(true);
        throw rollback;
      });
      await expect(reject(first, round)).rejects.toThrow(rollback);
      expect((await roundFor(first.id)).status).toBe("in_progress");
      expect(await db.auditLog.count({ where: queued(round.id) })).toBe(approvalRows.length);

      await reject(first, round);
      expect((await roundFor(first.id)).status).toBe("rejected");
      const correction = await db.auditLog.findMany({ where: { ...queued(round.id), metadata: { path: ["duty"], equals: "correction" } } });
      expect(correction.map(row => row.metadata)).toEqual([{ duty: "correction", recipientId: applicant.id }]);
      await verifyIssue430CorrectionDelivery({
        scenario: businessType, deliveryKey: round.id,
        applicant, otherActorId: secondReviewer.id, probe, sendPending: () => notifications.afterCommit(),
        status: (id, actor) => notifications.status(id, actor), retry: (id, actor, attempt) => notifications.retry(id, actor, attempt),
        queueUnknown: async () => {
          const unknown = await seed();
          const unknownRound = await roundFor(unknown.id);
          await reject(unknown, unknownRound);
          return unknownRound.id;
        }
      });
    } finally { await db.$disconnect(); }
  }, 30_000
);
