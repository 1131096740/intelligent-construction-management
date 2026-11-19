import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Prisma, type AuditLog } from "@prisma/client";
import { approvalDutyTarget } from "../approval/approval-duty-sms-intent";
import { auditDutyNoticeId, auditDutyNoticeStatus, dispatchAuditDutyNotices, retryFailedAuditDutyNotice, type AuditDutySmsMessage } from "../approval/audit-duty-notification-delivery";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { PrismaService } from "../database/prisma.service";
import { formatMoneyCentsAsPlainYuan } from "../money/decimal-money";
import { currentSpotPaymentDuty, spotPaymentDutyAssignments, spotPaymentDutySelect } from "./spot-payment-execution-duty";
import { SpotProcurementPilotService } from "./spot-procurement-pilot.service";

const kind="spot_payment_execution_duty_notification";
type Payment=Prisma.SpotProcurementPaymentGetPayload<{select:typeof spotPaymentDutySelect}>;

@Injectable()
export class SpotPaymentExecutionNotificationService implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;
  private readonly logger=new Logger(SpotPaymentExecutionNotificationService.name);
  constructor(private readonly prisma:PrismaService,private readonly sms:ApprovalSmsService,private readonly pilot:SpotProcurementPilotService) {}

  onModuleInit() {
    if (process.env.NODE_ENV==="test" || process.env.SKIP_DATABASE_CONNECT==="true" || !this.sms.available()) return;
    this.timer=setInterval(()=>{void this.afterCommit();},60_000);
    this.timer.unref();
    void this.afterCommit();
  }
  onModuleDestroy(){if(this.timer)clearInterval(this.timer);}

  async queue(tx:Prisma.TransactionClient,payment:Payment,roundId:string,actorUserId:string) {
    if (!await currentSpotPaymentDuty(tx,this.pilot,payment)) return;
    const assignments=await spotPaymentDutyAssignments(tx,payment.projectId);
    const recipients=new Set(assignments.filter(row=>row.userIsActive && row.projectId===payment.projectId && row.roleKey==="finance_staff").map(row=>row.userId));
    if (recipients.size) await tx.auditLog.createMany({skipDuplicates:true,data:[...recipients].map(recipientId=>({
      id:auditDutyNoticeId(kind,payment.id,roundId,recipientId),actorUserId,action:"queued",businessType:kind,
      businessId:payment.id,metadata:{recipientId,roundId}
    }))});
  }

  private async lockDuty(tx:Prisma.TransactionClient,id:string) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "SpotProcurementPayment" WHERE "id"=${id} FOR UPDATE`);
  }

  private noticeAccess() {
    return {prisma:this.prisma,sms:this.sms,kind,
      lockDuty:(tx:Prisma.TransactionClient,id:string)=>this.lockDuty(tx,id),
      currentMessage:(tx:Prisma.TransactionClient,intent:AuditLog)=>this.currentMessage(tx,intent)};
  }

  notificationStatus(id:string,actorId:string) {
    return auditDutyNoticeStatus(this.noticeAccess(),id,actorId);
  }

  async retry(id:string,actorId:string,attemptId:string) {
    const result=await retryFailedAuditDutyNotice(this.noticeAccess(),id,actorId,attemptId);
    if (result.enqueued) void this.afterCommit();
    return result.status;
  }

  async afterCommit() {
    try {
      const access=this.noticeAccess();
      await dispatchAuditDutyNotices(access.prisma,access.sms,access.kind,access.lockDuty,access.currentMessage);
    } catch {
      this.logger.warn("零星材料实付通知暂未完成，保留记录以供核对");
    }
  }

  private async currentMessage(tx:Prisma.TransactionClient,intent:AuditLog):Promise<AuditDutySmsMessage|null> {
    const {recipientId,roundId}=(intent.metadata??{}) as Prisma.JsonObject;
    if (!intent.businessId || typeof recipientId!=="string" || typeof roundId!=="string") return null;
    const [payment,round]=await Promise.all([
      tx.spotProcurementPayment.findUnique({where:{id:intent.businessId},select:spotPaymentDutySelect}),
      tx.approvalInstance.findUnique({where:{id:roundId},select:{businessId:true,businessType:true,flowType:true,status:true,applicantUserId:true}})
    ]);
    if (!payment || round?.businessId!==payment.id || round.businessType!=="spot_procurement_payment" ||
        round.flowType!=="spot_procurement.payment.approve" || round.status!=="approved") return null;
    const remaining=await currentSpotPaymentDuty(tx,this.pilot,payment);
    if (remaining===null || !(await spotPaymentDutyAssignments(tx,payment.projectId,recipientId))
      .some(row=>row.userIsActive && row.projectId===payment.projectId && row.roleKey==="finance_staff" && row.userId===recipientId)) return null;
    const [recipient,applicant,project]=await Promise.all([
      tx.user.findUnique({where:{id:recipientId},select:{isActive:true,phone:true}}),
      tx.user.findUnique({where:{id:round.applicantUserId},select:{name:true}}),
      tx.project.findUnique({where:{id:payment.projectId},select:{name:true}})
    ]);
    if (!recipient?.isActive) return null;
    return {phone:recipient.phone??"",intent:{
      businessLabel:"零星材料待实付",dutyName:"登记实付并上传凭证",businessCode:payment.code,
      scopeName:project?.name??"所属项目",initiatorName:applicant?.name??"申请人待核对",
      subject:"登记零星材料实际付款",participants:[payment.payerCompanyNameSnapshot,payment.payeeNameSnapshot].filter((name):name is string=>!!name),
      amountText:`待实付 ${formatMoneyCentsAsPlainYuan(remaining)} 元`,
      details:[`已实付 ${formatMoneyCentsAsPlainYuan(payment.paidAmountCents)} 元`],
      targetPath:approvalDutyTarget("spotPayment",payment.id)
    }};
  }
}
