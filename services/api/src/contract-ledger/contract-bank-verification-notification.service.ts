import { ConflictException, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma, type AuditLog, type ContractBankVerificationRequest } from "@prisma/client";
import { auditDutyNoticeId, auditDutyNoticeStatus, dispatchAuditDutyNotices, retryFailedAuditDutyNotice, type AuditDutySmsMessage } from "../approval/audit-duty-notification-delivery";
import { approvalIndependentDutyTarget } from "../approval/approval-duty-sms-intent";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { canReviewPendingBankVerification } from "./contract-bank-verification-access";
import { PrismaService } from "../database/prisma.service";
import { formatMoneyCentsAsPlainYuan } from "../money/decimal-money";

const ownedKind = "owned_bank_verification_duty_notification";
const projectKind = "project_bank_verification_duty_notification";
type NoticeKind = typeof ownedKind | typeof projectKind;
type Duty = Pick<ContractBankVerificationRequest,"id"|"projectId"|"status"|"recordedByUserId">;

@Injectable()
export class ContractBankVerificationNotificationService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(ContractBankVerificationNotificationService.name);
  constructor(private readonly prisma: PrismaService, private readonly sms: ApprovalSmsService,
    private readonly visibility: ProjectVisibilityService = new ProjectVisibilityService(prisma)) {}

  onModuleInit() {
    if (process.env.NODE_ENV === "test" || process.env.SKIP_DATABASE_CONNECT === "true" || !this.sms.available()) return;
    this.timer = setInterval(() => { void this.afterCommit(); }, 60_000);
    this.timer.unref();
    void this.afterCommit();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async queue(tx: Prisma.TransactionClient, row: Duty) {
    if (row.status !== "pending_confirm") return;
    const kind = row.projectId === null ? ownedKind : projectKind;
    const position = await tx.position.findUnique({where:{key:"finance_director"},select:{id:true}});
    if (!position) return;
    const assignments = await tx.userPosition.findMany({
      where:{positionId:position.id,projectId:null,userId:{not:row.recordedByUserId}},select:{userId:true}
    });
    const eligible = [];
    for (const recipientId of new Set(assignments.map(assignment=>assignment.userId))) {
      if (await canReviewPendingBankVerification(tx,this.visibility,recipientId,row)) eligible.push(recipientId);
    }
    if (eligible.length) await tx.auditLog.createMany({skipDuplicates:true,data:eligible.map(recipientId=>({
      id:auditDutyNoticeId(kind,row.id,recipientId),actorUserId:row.recordedByUserId,action:"queued",businessType:kind,
      businessId:row.id,metadata:{recipientId,projectId:row.projectId}
    }))});
  }

  private async lockDuty(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "ContractBankVerificationRequest" WHERE "id"=${id} FOR UPDATE`);
  }

  private noticeAccess(kind: NoticeKind) {
    return { prisma: this.prisma, sms: this.sms, kind,
      lockDuty: (tx: Prisma.TransactionClient, id: string) => this.lockDuty(tx, id),
      currentMessage: (tx: Prisma.TransactionClient, intent: AuditLog) => this.currentMessage(tx, intent, kind),
      canAccess: async (tx: Prisma.TransactionClient, intent: AuditLog) => {
        if (!intent.businessId) return false;
        const row=await tx.contractBankVerificationRequest.findUnique({where:{id:intent.businessId},select:{
          id:true,projectId:true,status:true,recordedByUserId:true
        }});
        return this.authorized(tx,intent,kind,row);
      } };
  }

  async notificationStatus(id: string, actorId: string) {
    const scope = await this.prisma.contractBankVerificationRequest.findUnique({where:{id},select:{projectId:true,status:true}});
    if (scope?.status !== "pending_confirm") return null;
    return auditDutyNoticeStatus(this.noticeAccess(scope.projectId===null ? ownedKind : projectKind),id,actorId);
  }

  async retry(id: string, actorId: string, attemptId: string) {
    const attempt=await this.prisma.auditLog.findUnique({where:{id:attemptId}});
    const kind=attempt?.businessType;
    const data=(attempt?.metadata??{}) as Prisma.JsonObject;
    if ((kind!==ownedKind && kind!==projectKind) || attempt?.businessId!==id || attempt.action!=="queued" ||
        data.recipientId!==actorId) throw new ConflictException("当前待办或短信记录已变化，请刷新");
    const result=await retryFailedAuditDutyNotice(this.noticeAccess(kind),id,actorId,attemptId);
    if (result.enqueued) void this.afterCommit();
    return result.status;
  }

  async afterCommit() {
    try {
      for (const kind of [ownedKind,projectKind] as const) {
        const access=this.noticeAccess(kind);
        await dispatchAuditDutyNotices(access.prisma,access.sms,access.kind,access.lockDuty,access.currentMessage);
      }
    } catch {
      this.logger.warn("银行核验通知暂未完成，保留记录以供核对");
    }
  }

  private async authorized(tx: Prisma.TransactionClient,intent: AuditLog,kind: NoticeKind,row: Duty|null) {
    const {recipientId,projectId}=(intent.metadata??{}) as Prisma.JsonObject;
    return Boolean(row && intent.businessType===kind && row.id===intent.businessId && typeof recipientId==="string" &&
      (kind===ownedKind ? row.projectId===null : !!row.projectId && row.projectId===projectId) &&
      await canReviewPendingBankVerification(tx,this.visibility,recipientId,row));
  }

  private async currentMessage(tx: Prisma.TransactionClient,intent: AuditLog,kind:NoticeKind): Promise<AuditDutySmsMessage|null> {
    const {recipientId} = (intent.metadata ?? {}) as Prisma.JsonObject;
    if (!intent.businessId || typeof recipientId !== "string") return null;
    const row = await tx.contractBankVerificationRequest.findUnique({where:{id:intent.businessId},select:{
      id:true,projectId:true,status:true,recordedByUserId:true,companyName:true,amountCents:true,direction:true
    }});
    if (!row || !await this.authorized(tx,intent,kind,row)) return null;
    const [recipient,author,project] = await Promise.all([
      tx.user.findUnique({where:{id:recipientId},select:{isActive:true,phone:true}}),
      tx.user.findUnique({where:{id:row.recordedByUserId},select:{name:true}}),
      row.projectId ? tx.project.findUnique({where:{id:row.projectId},select:{name:true}}) : null
    ]);
    if (!recipient?.isActive) return null;
    return {phone:recipient.phone ?? "",intent:{
      businessLabel:row.projectId ? "项目银行流水核验" : "自有资金银行流水核验",dutyName:"独立核验银行流水",businessCode:"银行流水核验",
      scopeName:row.projectId ? project?.name ?? "所属项目" : "公司自有资金",initiatorName:author?.name ?? "登记人待核对",
      subject:row.direction === "inflow" ? "银行到账核验" : "银行出款核验",participants:[row.companyName],
      amountText:`${formatMoneyCentsAsPlainYuan(row.amountCents)} 元`,
      targetPath:approvalIndependentDutyTarget("contract_bank_verification",row.id)
    }};
  }
}
