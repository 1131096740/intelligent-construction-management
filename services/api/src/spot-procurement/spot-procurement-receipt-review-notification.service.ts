import { Injectable, Logger } from "@nestjs/common";
import { Prisma, type AuditLog } from "@prisma/client";
import { approvalDutyTarget } from "../approval/approval-duty-sms-intent";
import { auditDutyNoticeId, auditDutyNoticeStatus, dispatchAuditDutyNotices, retryFailedAuditDutyNotice, type AuditDutySmsMessage } from "../approval/audit-duty-notification-delivery";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { loadEffectiveProjectApprovalAssignments } from "../approval/project-approval-assignments";
import { PrismaService } from "../database/prisma.service";
import { formatMoneyCentsAsPlainYuan } from "../money/decimal-money";
import { SpotProcurementPilotService } from "./spot-procurement-pilot.service";
import { readSpotReceiptReviewDuty } from "./spot-procurement-receipt-review-duty";

const kind = "spot_receipt_review_duty_notification";
const role = ["material_director"];

@Injectable()
export class SpotProcurementReceiptReviewNotificationService {
  private readonly logger = new Logger(SpotProcurementReceiptReviewNotificationService.name);
  constructor(private readonly prisma: PrismaService, private readonly sms: ApprovalSmsService, private readonly pilot: SpotProcurementPilotService) {}

  async queue(tx: Prisma.TransactionClient, procurementId: string, actorUserId: string) {
    const duty = await readSpotReceiptReviewDuty(tx, procurementId, this.pilot);
    if (!duty) return false;
    const { receipt } = duty;
    const assignments = await loadEffectiveProjectApprovalAssignments(tx, receipt.projectId, role);
    const recipients = new Set(assignments.filter(row => row.userIsActive).map(row => row.userId));
    if (!recipients.size) return false;
    const written = await tx.auditLog.createMany({ skipDuplicates: true, data: [...recipients].map(recipientId => ({
      id: auditDutyNoticeId(kind, receipt.id, String(receipt.currentRevisionNo), recipientId),
      actorUserId, action: "queued", businessType: kind, businessId: procurementId,
      metadata: { receiptId: receipt.id, revision: receipt.currentRevisionNo, recipientId }
    })) });
    return written.count > 0;
  }

  private async lockDuty(tx: Prisma.TransactionClient, procurementId: string) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SpotProcurement" WHERE "id" = ${procurementId} FOR UPDATE`);
  }

  private noticeAccess() {
    return { prisma: this.prisma, sms: this.sms, kind,
      lockDuty: (tx: Prisma.TransactionClient, id: string) => this.lockDuty(tx, id),
      currentMessage: (tx: Prisma.TransactionClient, intent: AuditLog) => this.currentMessage(tx, intent) };
  }

  notificationStatus(id: string, actorId: string) {
    return auditDutyNoticeStatus(this.noticeAccess(), id, actorId);
  }

  async retry(id: string, actorId: string, attemptId: string) {
    const result = await retryFailedAuditDutyNotice(this.noticeAccess(), id, actorId, attemptId);
    if (result.enqueued) void this.afterCommit();
    return result.status;
  }

  async afterCommit() {
    try {
      const access = this.noticeAccess();
      await dispatchAuditDutyNotices(access.prisma, access.sms, access.kind, access.lockDuty, access.currentMessage);
    } catch {
      this.logger.warn("收货复核通知暂未完成，保留记录以供核对");
    }
  }

  private async currentMessage(tx: Prisma.TransactionClient, attempt: AuditLog): Promise<AuditDutySmsMessage | null> {
    const meta = attempt.metadata as Prisma.JsonObject | null;
    const recipient = meta?.recipientId;
    if (!attempt.businessId || typeof recipient !== "string") return null;
    const duty = await readSpotReceiptReviewDuty(tx, attempt.businessId, this.pilot);
    if (!duty || duty.receipt.id !== meta?.receiptId || duty.receipt.currentRevisionNo !== meta?.revision) return null;
    if (!(await loadEffectiveProjectApprovalAssignments(tx, duty.receipt.projectId, role, recipient))
      .some(row => row.userId === recipient && row.userIsActive)) return null;
    const user = await tx.user.findUnique({ where: { id: recipient }, select: { phone: true, isActive: true } });
    if (!user?.isActive) return null;
    const parties = [duty.version.supplierNameSnapshot ?? duty.procurement.supplierNameSnapshot].filter((name): name is string => Boolean(name));
    return { phone: user.phone ?? "", intent: {
      businessLabel: "零星采购待办", dutyName: "复核收货", businessCode: duty.procurement.code,
      scopeName: duty.project.name, initiatorName: duty.version.applicationNameSnapshot,
      subject: "零星采购收货", participants: parties,
      amountText: `${formatMoneyCentsAsPlainYuan(duty.receipt.actualCostCents)} 元`,
      targetPath: approvalDutyTarget("spotReceipt", duty.procurement.id)
    } };
  }
}
