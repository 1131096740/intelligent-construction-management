import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma, type AuditLog } from "@prisma/client";
import { auditDutyNoticeId, auditDutyNoticeStatus, dispatchAuditDutyNotices, retryFailedAuditDutyNotice, type AuditDutySmsMessage } from "../approval/audit-duty-notification-delivery";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { PrismaService } from "../database/prisma.service";
import { currentFundCompanyRoles } from "./fund-account-duty";
import { currentFundTransferDuty, fundTransferCashAccess, fundTransferDutyLabel, fundTransferRoles, FUND_TRANSFER_TARGET } from "./fund-account-transfer-duty";

const kind = "registered_fund_transfer_duty_notification";
const accounts = {sourceAccount: {include: {company: {select: {name: true}}}},
  destinationAccount: {include: {company: {select: {name: true}}}}} as const;
type Transfer = Prisma.RegisteredFundTransferGetPayload<{include: typeof accounts}>;

@Injectable()
export class FundAccountTransferNotificationService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(FundAccountTransferNotificationService.name);
  constructor(private readonly prisma: PrismaService, private readonly sms: ApprovalSmsService) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test" || process.env.SKIP_DATABASE_CONNECT === "true" || !this.sms.available()) return;
    this.timer = setInterval(() => { void this.afterCommit(); }, 60_000);
    this.timer.unref();
    void this.afterCommit();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async queue(tx: Prisma.TransactionClient, transferId: string, actorUserId: string) {
    const row = await tx.registeredFundTransfer.findUnique({where: {id: transferId}, include: accounts});
    if (!row || !["pending_receipt", "rejected_held"].includes(row.status)) return;
    const account = row.status === "pending_receipt" ? row.destinationAccount : row.sourceAccount;
    const roles = fundTransferRoles(account.kind);
    const positions = await tx.position.findMany({where: {key: {in: [...roles]}}, select: {id: true}});
    const assignments = await tx.userPosition.findMany({
      where: {projectId: null, positionId: {in: positions.map(position => position.id)}}, select: {userId: true}
    });
    const eligible = [];
    for (const recipientId of new Set(assignments.map(assignment => assignment.userId))) {
      if (await this.currentDuty(tx, row, recipientId)) eligible.push(recipientId);
    }
    if (eligible.length) await tx.auditLog.createMany({skipDuplicates: true, data: eligible.map(recipientId => ({
      id: auditDutyNoticeId(kind, row.id, String(row.revision), recipientId), actorUserId, action: "queued", businessType: kind,
      businessId: row.id, metadata: {recipientId, revision: row.revision}
    }))});
  }

  private async lockDuty(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "RegisteredFundTransfer" WHERE "id" = ${id} FOR UPDATE`);
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
    const access = this.noticeAccess();
    const result = await retryFailedAuditDutyNotice({
      ...access,
      currentMessage: async (tx, current) => {
        if (current.id !== attemptId) {
          const expected = await tx.auditLog.findUnique({ where: { id: attemptId } });
          const previous = expected?.metadata as Prisma.JsonObject | null | undefined;
          const latest = current.metadata as Prisma.JsonObject | null;
          if (expected?.businessType !== kind || expected.businessId !== id || expected.action !== "queued" ||
              previous?.recipientId !== actorId || previous.revision !== latest?.revision) return null;
        }
        return access.currentMessage(tx, current);
      }
    }, id, actorId, attemptId);
    if (result.enqueued) void this.afterCommit();
    return result.status;
  }

  async afterCommit() {
    try {
      const access = this.noticeAccess();
      await dispatchAuditDutyNotices(access.prisma, access.sms, access.kind, access.lockDuty, access.currentMessage);
    } catch {
      this.logger.warn("资金账户转款通知暂未完成，保留记录以供核对");
    }
  }

  private async currentDuty(tx: Prisma.TransactionClient, row: Transfer, recipientId: string) {
    const roles = await currentFundCompanyRoles(tx, recipientId);
    const cashId = row.sourceAccount.kind === "public_cash" ? row.sourceAccount.id : row.destinationAccount.id;
    const cash = await fundTransferCashAccess(tx, recipientId, cashId);
    return currentFundTransferDuty(row, recipientId, roles, cash);
  }

  private async currentMessage(tx: Prisma.TransactionClient, intent: AuditLog): Promise<AuditDutySmsMessage | null> {
    const {recipientId, revision} = (intent.metadata ?? {}) as Prisma.JsonObject;
    if (!intent.businessId || typeof recipientId !== "string") return null;
    const row = await tx.registeredFundTransfer.findUnique({where: {id: intent.businessId}, include: accounts});
    if (!row || row.revision !== revision) return null;
    const duty = await this.currentDuty(tx, row, recipientId);
    if (!duty) return null;
    const [recipient, applicant] = await Promise.all([
      tx.user.findUnique({where: {id: recipientId}, select: {phone: true, isActive: true}}),
      tx.user.findUnique({where: {id: row.createdByUserId}, select: {name: true}})
    ]);
    if (!recipient?.isActive) return null;
    const accountLabel = (account: Transfer["sourceAccount"]) => account.kind === "public_cash"
      ? "公共现金" : account.company?.name ?? "公司资金账户";
    const dutyName = fundTransferDutyLabel(duty);
    return {phone: recipient.phone ?? "", intent: {
      businessLabel: "资金账户转款", dutyName, businessCode: "资金账户转款", scopeName: "资金账户",
      initiatorName: applicant?.name ?? "发起人待核对", subject: dutyName,
      participants: [accountLabel(row.sourceAccount), accountLabel(row.destinationAccount)],
      amountText: `${row.amountYuan.toFixed(4)} 元`, targetPath: FUND_TRANSFER_TARGET
    }};
  }
}
