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
const roles = ["finance_staff"];
type Claim = Pick<ExpenseClaim, "id" | "code" | "projectId" | "claimType" | "status" | "requestedAmountCents" |
  "companyPayableAmountCents" | "fundedAmountCents" | "voidedAt">;

@Injectable()
export class ExpenseClaimFundingNotificationService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(ExpenseClaimFundingNotificationService.name);
  constructor(private readonly prisma: PrismaService, private readonly sms: ApprovalSmsService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test" || process.env.SKIP_DATABASE_CONNECT === "true" || !this.sms.available()) return;
    this.timer = setInterval(() => { void this.afterCommit(); }, 60_000);
    this.timer.unref();
    void this.afterCommit();
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
