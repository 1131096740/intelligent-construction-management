import { approvalDutyTarget, type ApprovalDutySmsIntent } from "../approval/approval-duty-sms-intent";
import { formatMoneyCentsAsPlainYuan } from "../money/decimal-money";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma, type AuditLog, type Settlement } from "@prisma/client";
import { auditDutyNoticeId, auditDutyNoticeStatus, dispatchAuditDutyNotices, retryFailedAuditDutyNotice, type AuditDutySmsMessage } from "../approval/audit-duty-notification-delivery";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { loadEffectiveProjectApprovalAssignments } from "../approval/project-approval-assignments";
import { PrismaService } from "../database/prisma.service";

const kind = "settlement_signed_archive_duty_notification";
const role = ["contract_director"];
type SettlementDuty = Pick<Settlement, "id" | "projectId" | "status" | "governanceVersion" | "code">;

@Injectable()
export class SettlementArchiveNotificationService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(SettlementArchiveNotificationService.name);
  constructor(private readonly prisma: PrismaService, private readonly sms: ApprovalSmsService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test" || process.env.SKIP_DATABASE_CONNECT === "true" || !this.sms.available()) return;
    this.timer = setInterval(() => { void this.afterCommit(); }, 60_000);
    this.timer.unref();
    void this.afterCommit();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async pendingProject(tx: Prisma.TransactionClient, settlement: SettlementDuty | null) {
    if (settlement?.governanceVersion !== 1 || settlement.status !== "pending_archive_confirm") return null;
    const project = await tx.project.findUnique({ where: { id: settlement.projectId }, select: { isActive: true, name: true } });
    return project?.isActive ? project : null;
  }

  async queue(tx: Prisma.TransactionClient, settlement: SettlementDuty, actorUserId: string) {
    if (!await this.pendingProject(tx, settlement)) return;
    const assignments = await loadEffectiveProjectApprovalAssignments(tx, settlement.projectId, role);
    const recipients = new Set(assignments.filter(row => row.userIsActive).map(row => row.userId));
    if (!recipients.size) return;
    await tx.auditLog.createMany({
      skipDuplicates: true,
      data: [...recipients].map(recipientId => ({
        id: auditDutyNoticeId(kind, settlement.id, recipientId), actorUserId, action: "queued", businessType: kind, businessId: settlement.id,
        metadata: { recipientId }
      }))
    });
  }

  private async lockDuty(tx: Prisma.TransactionClient, businessId: string) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Settlement" WHERE "id" = ${businessId} FOR UPDATE`);
  }

  async afterCommit() {
    try {
      await dispatchAuditDutyNotices(this.prisma, this.sms, kind,
        (tx, businessId) => this.lockDuty(tx, businessId), (tx, intent) => this.currentMessage(tx, intent));
    } catch {
      this.logger.warn("结算归档通知暂未完成，保留记录以供核对");
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
    const settlementId = intent.businessId;
    const recipientId = (intent.metadata as Prisma.JsonObject | null)?.recipientId;
    if (!settlementId || typeof recipientId !== "string") return null;
    const settlement = await tx.settlement.findUnique({ where: { id: settlementId } });
    const project = await this.pendingProject(tx, settlement);
    if (!settlement || !project ||
      !(await loadEffectiveProjectApprovalAssignments(tx, settlement.projectId, role, recipientId))
        .some(row => row.userIsActive && row.userId === recipientId)) return null;
    const recipient = await tx.user.findUnique({ where: { id: recipientId }, select: { phone: true, isActive: true } });
    if (!recipient?.isActive) return null;
    return {phone:recipient.phone ?? "",intent:await settlementArchiveDutySmsIntent(tx,settlement,project.name,"结算待办","确认最终结算文件")};
  }
}

export async function settlementArchiveDutySmsIntent(tx: Prisma.TransactionClient, settlement: Settlement, projectName: string,
    businessLabel: string, dutyName: string, originalApplicantId?: string): Promise<ApprovalDutySmsIntent> {
  const applicantId = settlement.preparedByUserId || originalApplicantId;
  const [contract, preparer] = await Promise.all([
    tx.contract.findUnique({where:{id:settlement.contractId},select:{name:true,companyEntityName:true,counterparty:true}}),
    applicantId ? tx.user.findUnique({where:{id:applicantId},select:{name:true}}) : null,
  ]);
  return {
    businessLabel,dutyName,businessCode:settlement.code,scopeName:projectName,initiatorName:preparer?.name ?? "发起人待核对",
    subject:contract ? `${contract.name}结算` : "结算归档",
    participants:[contract?.companyEntityName,contract?.counterparty].filter((name):name is string=>Boolean(name)),
    amountText:`${formatMoneyCentsAsPlainYuan(settlement.amountCents)} 元`,targetPath:approvalDutyTarget("settlement",settlement.code),
  };
}
