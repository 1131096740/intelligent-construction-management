import { ledgerDutySmsStatus, retryLedgerDutySms, retryLedgerDutySmsMessage } from "./independent-ledger-duty-sms";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { AuditLog, Prisma, UpwardContractAmountRevision } from "@prisma/client";
import { auditDutyNoticeId, dispatchAuditDutyNotices, type AuditDutySmsMessage } from "../approval/audit-duty-notification-delivery";
import { approvalIndependentDutyTarget } from "../approval/approval-duty-sms-intent";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { loadEffectiveProjectApprovalAssignments } from "../approval/project-approval-assignments";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { PrismaService } from "../database/prisma.service";
import { formatMoneyCentsAsPlainYuan } from "../money/decimal-money";
import { lockEconomicProject } from "./contract-economic-coverage";
import { canReviewUpwardAmount } from "./upward-amount-access";

const kind="upward_amount_revision_duty_notification";
type Revision=Pick<UpwardContractAmountRevision,"id"|"projectId"|"recordedByUserId"|"status">;

@Injectable()
export class UpwardAmountNotificationService implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;
  private readonly logger=new Logger(UpwardAmountNotificationService.name);
  constructor(private readonly prisma:PrismaService,private readonly sms:ApprovalSmsService,
    private readonly visibility:ProjectVisibilityService=new ProjectVisibilityService(prisma)) {}

  onModuleInit() {
    if (process.env.NODE_ENV==="test" || process.env.SKIP_DATABASE_CONNECT==="true" || !this.sms.available()) return;
    this.timer=setInterval(()=>{void this.afterCommit();},60_000);
    this.timer.unref();
    void this.afterCommit();
  }
  onModuleDestroy() {if(this.timer)clearInterval(this.timer);}

  async queue(tx:Prisma.TransactionClient,row:Revision) {
    if (row.status!=="pending_confirm") return;
    const candidates=await loadEffectiveProjectApprovalAssignments(tx,row.projectId,["contract_director"]);
    const people=new Set(candidates.filter(candidate=>candidate.userIsActive && candidate.projectId===row.projectId &&
      candidate.roleKey==="contract_director").map(candidate=>candidate.userId));
    const recipients=[];
    for(const actor of people)if(await canReviewUpwardAmount(tx,this.visibility,actor,row))recipients.push(actor);
    if(recipients.length)await tx.auditLog.createMany({skipDuplicates:true,data:recipients.map(recipientId=>({
      id:auditDutyNoticeId(kind,row.id,recipientId),actorUserId:row.recordedByUserId,action:"queued",businessType:kind,
      businessId:row.id,metadata:{recipientId,projectId:row.projectId}
    }))});
  }

  private noticeAccess() {
    return {
      prisma: this.prisma, sms: this.sms, kind,
      lockDuty: async (tx: Prisma.TransactionClient, id: string) => {
        const location = await tx.upwardContractAmountRevision.findUnique({ where: { id }, select: { projectId: true } });
        if (location) await lockEconomicProject(tx, location.projectId);
      },
      currentMessage: (tx: Prisma.TransactionClient, attempt: AuditLog) => this.currentMessage(tx, attempt),
      originalId: (attempt: AuditLog, recipientId: string) => auditDutyNoticeId(kind, attempt.businessId ?? "", recipientId)
    };
  }

  status(id: string, actorId: string) {
    return ledgerDutySmsStatus(this.noticeAccess(), id, actorId);
  }

  retry(id: string, actorId: string, attemptId: string) {
    return retryLedgerDutySms(this.noticeAccess(), () => this.afterCommit(), id, actorId, attemptId);
  }

  async afterCommit() {
    try {
      const access = this.noticeAccess();
      await dispatchAuditDutyNotices(this.prisma, this.sms, kind, access.lockDuty,
        (tx, intent) => retryLedgerDutySmsMessage(access, tx, intent));
    } catch {
      this.logger.warn("对上金额修订通知暂未完成，保留记录以供核对");
    }
  }

  private async currentMessage(tx:Prisma.TransactionClient,attempt:AuditLog):Promise<AuditDutySmsMessage|null> {
    const {recipientId,projectId}=(attempt.metadata??{}) as Prisma.JsonObject;
    if(!attempt.businessId || typeof recipientId!=="string" || typeof projectId!=="string")return null;
    const row=await tx.upwardContractAmountRevision.findUnique({where:{id:attempt.businessId},select:{
      id:true,status:true,projectId:true,contractId:true,recordedByUserId:true,amountNature:true,amountCents:true
    }});
    if(!row || row.projectId!==projectId || !await canReviewUpwardAmount(tx,this.visibility,recipientId,row))return null;
    const [contract,project,recipient,author]=await Promise.all([
      tx.projectAffiliateCompanyContract.findFirst({where:{id:row.contractId,projectId:row.projectId,status:"confirmed"},select:{
        contractName:true,contractReference:true,affiliateNameSnapshot:true,companyEntityNameSnapshot:true
      }}),
      tx.project.findUnique({where:{id:row.projectId},select:{name:true}}),
      tx.user.findUnique({where:{id:recipientId},select:{phone:true,isActive:true}}),
      tx.user.findUnique({where:{id:row.recordedByUserId},select:{name:true}})
    ]);
    if(!contract || !recipient?.isActive)return null;
    return {phone:recipient.phone??"",intent:{
      businessLabel:"对上合同金额修订",dutyName:"复核合同金额修订",businessCode:contract.contractReference,
      scopeName:project?.name??"所属项目",initiatorName:author?.name??"登记人待核对",subject:contract.contractName,
      participants:[contract.affiliateNameSnapshot,contract.companyEntityNameSnapshot].filter(Boolean),
      amountText:row.amountNature==="uncapped"?"未约定总额":row.amountCents===null?"金额待确定":
        `修订为 ${formatMoneyCentsAsPlainYuan(row.amountCents)} 元`,
      targetPath:approvalIndependentDutyTarget("upward_contract_amount_revision",row.id)
    }};
  }
}
