import { expenseReminderIntent } from "../approval/approval-reminder-business-intent";
import { activeApprovalNodeIndexes, isParallelApprovalRound } from "../approval/parallel-approval-protocol";
import { EXPENSE_CURRENT_ROLE_SCOPE, isPureExpenseReimbursement, loadExpenseApprovalCandidateIds, loadExpenseApprovalRoleScopes, resolveExpenseParallelDutyIdentity } from "./expense-claim-parallel-approval";
import { approvalDutyTarget } from "../approval/approval-duty-sms-intent";
import { formatMoneyCentsAsPlainYuan } from "../money/decimal-money";
import { expenseClaimFundingDuty } from "./expense-claim-funding-duty";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma, type AuditLog, type ExpenseClaim } from "@prisma/client";
import { auditDutyNoticeId, auditDutyNoticeStatus, dispatchAuditDutyNotices, retryFailedAuditDutyNotice, type AuditDutySmsMessage } from "../approval/audit-duty-notification-delivery";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { loadEffectiveProjectApprovalAssignments } from "../approval/project-approval-assignments";
import { PrismaService } from "../database/prisma.service";

const kind = "expense_claim_funding_duty_notification";
const approvalKind = "expense_claim_approval_duty_notification";
const roles = ["finance_staff"];
type Claim = Pick<ExpenseClaim, "id" | "code" | "projectId" | "claimType" | "status" | "requestedAmountCents" |
  "companyPayableAmountCents" | "fundedAmountCents" | "voidedAt">;

@Injectable()
export class ExpenseClaimFundingNotificationService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private approvalReconcileBusy = false;
  private approvalCursor?: string;
  private readonly logger = new Logger(ExpenseClaimFundingNotificationService.name);
  constructor(private readonly prisma: PrismaService, private readonly sms: ApprovalSmsService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test" || process.env.SKIP_DATABASE_CONNECT === "true" || !this.sms.available()) return;
    this.timer = setInterval(() => { void this.reconcilePendingApprovalDuties(); }, 60_000);
    this.timer.unref();
    void this.reconcilePendingApprovalDuties();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async queue(tx: Prisma.TransactionClient, claim: Claim, actorUserId: string) {
    const duty = expenseClaimFundingDuty(claim, false)?.duty;
    if (!duty || claim.voidedAt || !claim.projectId || !(await tx.project.findUnique({ where: { id: claim.projectId }, select: { isActive: true } }))?.isActive) return false;
    const positions = await loadEffectiveProjectApprovalAssignments(tx, claim.projectId, roles);
    const recipients = new Set(positions.filter(row => row.userIsActive).map(row => row.userId));
    if (!recipients.size) return false;
    const write = await tx.auditLog.createMany({ skipDuplicates: true, data: [...recipients].map(recipientId => ({
      id: auditDutyNoticeId(kind, claim.id, duty, recipientId), action: "queued", businessType: kind, businessId: claim.id,
      actorUserId, metadata: { recipientId, duty }
    })) });
    return write.count > 0;
  }

  async queueApprovalDuties(
    tx: Prisma.TransactionClient,
    claim: Pick<ExpenseClaim, "id" | "projectId" | "status" | "approvalInstanceId">,
    round: { id: string; frozenNodes: unknown },
    actorUserId: string
  ) {
    const nodes = round.frozenNodes;
    if (claim.status !== "approval_pending" || claim.approvalInstanceId !== round.id ||
        !isParallelApprovalRound(nodes)) return false;
    const recipients = await loadExpenseApprovalCandidateIds(tx, claim.projectId, nodes);
    const rows = activeApprovalNodeIndexes(nodes, 0).flatMap(index =>
      recipients[index].map(recipientId => ({
        id: auditDutyNoticeId(approvalKind, claim.id, round.id, String(index), recipientId),
        action: "queued",
        businessType: approvalKind,
        businessId: claim.id,
        actorUserId,
        metadata: { recipientId, approvalInstanceId: round.id, approvalDutyIndex: index }
      }))
    );
    if (!rows.length) return false;
    return (await tx.auditLog.createMany({ skipDuplicates: true, data: rows })).count > 0;
  }

  async reconcilePendingApprovalDuties() {
    if (this.approvalReconcileBusy) return;
    this.approvalReconcileBusy = true;
    try {
      // Pull only pending pure reimbursements. A newly staffed duty enters the same
      // persistent queue as a duty that had an assignee at the time of submission.
      const claims = await this.prisma.expenseClaim.findMany({
        where: { claimType: "reimbursement", status: "approval_pending", voidedAt: null,
          generalProcurementId: null, actualPurchaseBatchId: null, approvalInstanceId: { not: null },
          ...(this.approvalCursor ? { id: { gt: this.approvalCursor } } : {}) },
        select: { id: true },
        orderBy: { id: "asc" },
        take: 100
      });
      this.approvalCursor = claims.length === 100 ? claims.at(-1)?.id : undefined;
      for (const { id } of claims) await this.prisma.$transaction(async tx => {
        await this.lockDuty(tx, id);
        const claim = await tx.expenseClaim.findUnique({
          where: { id },
          select: { id: true, status: true, claimType: true, projectId: true, approvalInstanceId: true,
            actualPurchaseBatchId: true, generalProcurementId: true, voidedAt: true }
        });
        if (!claim?.approvalInstanceId || claim.status !== "approval_pending" || claim.voidedAt ||
            !isPureExpenseReimbursement(claim)) return;
        const round = await tx.approvalInstance.findUnique({ where: { id: claim.approvalInstanceId } });
        const nodes: unknown = round?.frozenNodes;
        if (!round || round.status !== "in_progress" || round.businessType !== "expense_claim" ||
            round.flowType !== "expense_claim.approve" || round.businessId !== claim.id ||
            !isParallelApprovalRound(nodes) || !nodes.some(node => node.candidatePolicy === EXPENSE_CURRENT_ROLE_SCOPE)) return;
        await this.queueApprovalDuties(tx, claim, round, round.applicantUserId);
      });
    } catch {
      this.logger.warn("费用审批待办通知同步暂未完成，保留记录以供核对");
    } finally {
      try { await this.afterCommit(); }
      finally { this.approvalReconcileBusy = false; }
    }
  }

  private async lockDuty(tx: Prisma.TransactionClient, businessId: string) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ExpenseClaim" WHERE "id" = ${businessId} FOR UPDATE`);
  }

  async afterCommit() {
    try {
      await dispatchAuditDutyNotices(this.prisma, this.sms, kind,
        (tx, businessId) => this.lockDuty(tx, businessId), (tx, intent) => this.currentMessage(tx, intent));
    } catch {
      this.logger.warn("费用资金办理通知暂未完成，保留记录以供核对");
    }
    try {
      await dispatchAuditDutyNotices(this.prisma, this.sms, approvalKind,
        (tx, businessId) => this.lockDuty(tx, businessId), (tx, intent) => this.currentApprovalMessage(tx, intent));
    } catch {
      this.logger.warn("费用审批通知暂未完成，保留记录以供核对");
    }
  }

  private noticeAccess() {
    return {
      prisma: this.prisma, sms: this.sms, kind,
      lockDuty: (tx: Prisma.TransactionClient, id: string) => this.lockDuty(tx, id),
      currentMessage: (tx: Prisma.TransactionClient, intent: AuditLog) => this.currentMessage(tx, intent)
    };
  }

  notificationStatus(id: string, actorId: string) {
    return auditDutyNoticeStatus(this.noticeAccess(), id, actorId);
  }

  async retry(id: string, actorId: string, attemptId: string) {
    const result = await retryFailedAuditDutyNotice(this.noticeAccess(), id, actorId, attemptId);
    if (result.enqueued) void this.afterCommit();
    return result.status;
  }

  private async currentApprovalMessage(tx: Prisma.TransactionClient, intent: AuditLog): Promise<AuditDutySmsMessage | null> {
    const data = intent.metadata as Prisma.JsonObject | null;
    const recipientId = data?.recipientId;
    const instanceId = data?.approvalInstanceId;
    const nodeIndex = data?.approvalDutyIndex;
    if (!intent.businessId || typeof recipientId !== "string" || typeof instanceId !== "string" ||
        typeof nodeIndex !== "number" || !Number.isInteger(nodeIndex)) return null;
    const claim = await tx.expenseClaim.findUnique({
      where: { id: intent.businessId },
      select: { id: true, projectId: true, claimType: true, generalProcurementId: true, actualPurchaseBatchId: true,
        approvalInstanceId: true, status: true, voidedAt: true }
    });
    if (!claim || !isPureExpenseReimbursement(claim) || claim.voidedAt ||
        claim.status !== "approval_pending" || claim.approvalInstanceId !== instanceId) return null;
    const round = await tx.approvalInstance.findUnique({
      where: { id: instanceId },
      select: { status: true, businessId: true, businessType: true, flowType: true, frozenNodes: true }
    });
    const nodes: unknown = round?.frozenNodes;
    if (round?.status !== "in_progress" || round.businessId !== claim.id || round.businessType !== "expense_claim" ||
        round.flowType !== "expense_claim.approve" || !isParallelApprovalRound(nodes) ||
        !activeApprovalNodeIndexes(nodes, 0).includes(nodeIndex)) return null;
    const node = nodes[nodeIndex];
    if (typeof node.name !== "string") return null;
    const user = await tx.user.findUnique({ where: { id: recipientId }, select: { phone: true, isActive: true } });
    if (!user?.isActive) return null;
    const roleScopes = await loadExpenseApprovalRoleScopes(tx, recipientId, claim.projectId);
    const identity = resolveExpenseParallelDutyIdentity({ node, actorUserId: recipientId, actorRoleScopes: roleScopes });
    if (!identity) return null;
    const project = claim.projectId ? await tx.project.findUnique({
      where: { id: claim.projectId }, select: { isActive: true, name: true }
    }) : null;
    if (claim.projectId && !project?.isActive) return null;
    const message = await expenseReminderIntent(tx, claim.id, {
      projectId: claim.projectId, projectName: project?.name, businessLabel: "费用报销", dutyName: node.name
    });
    return message ? { phone: user.phone ?? "", intent: message } : null;
  }

  private async currentMessage(tx: Prisma.TransactionClient, intent: AuditLog): Promise<AuditDutySmsMessage | null> {
    const id = intent.businessId;
    const data = intent.metadata as Prisma.JsonObject | null;
    const recipientId = data?.recipientId;
    if (!id || typeof recipientId !== "string") return null;
    const claim = await tx.expenseClaim.findUnique({ where: { id } });
    if (!claim?.projectId || claim.voidedAt) return null;
    const duty = expenseClaimFundingDuty(claim, true);
    if (!duty || duty.duty !== data?.duty) return null;
    const project = await tx.project.findUnique({ where: { id: claim.projectId }, select: { isActive: true, name: true } });
    if (!project?.isActive) return null;
    const assignments = await loadEffectiveProjectApprovalAssignments(tx, claim.projectId, roles, recipientId);
    if (!assignments.some(row => row.userIsActive && row.userId === recipientId)) return null;
    const user = await tx.user.findUnique({ where: { id: recipientId }, select: { phone: true, isActive: true } });
    if (!user?.isActive) return null;
    const lines = claim.claimType === "reimbursement" ? await tx.expenseClaimLine.findMany({
      where: { expenseClaimId: claim.id }, select: { expenseCategory: true, amountCents: true },
      orderBy: { sortOrder: "asc" }, take: 3
    }) : [];
    return { phone: user.phone ?? "", intent: {
      businessLabel: "费用待办", dutyName: duty.label, businessCode: claim.code,
      scopeName: project.name, initiatorName: claim.applicantNameSnapshot,
      subject: duty.duty === "disbursement" ? "项目借款" : claim.claimType === "reimbursement" ? "费用报销" : "零星费用",
      participants: [claim.companyEntityNameSnapshot, claim.payeeNameSnapshot ?? claim.applicantNameSnapshot],
      amountText: `${formatMoneyCentsAsPlainYuan(duty.remaining)} 元`,
      totalText: `${formatMoneyCentsAsPlainYuan(claim.requestedAmountCents)} 元`,
      details: lines.map(line => `${line.expenseCategory.trim().replace(/\s+/gu, " ").slice(0, 24)} ${formatMoneyCentsAsPlainYuan(line.amountCents)} 元`),
      targetPath: approvalDutyTarget("expense", claim.id)
    } };
  }
}
