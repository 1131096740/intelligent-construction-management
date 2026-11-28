import { ledgerDutySmsStatus, retryLedgerDutySms, retryLedgerDutySmsMessage } from "./independent-ledger-duty-sms";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { AuditLog, ContractEconomicReview, Prisma } from "@prisma/client";
import { auditDutyNoticeId, dispatchAuditDutyNotices, type AuditDutySmsMessage } from "../approval/audit-duty-notification-delivery";
import { approvalIndependentDutyTarget } from "../approval/approval-duty-sms-intent";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { loadEffectiveProjectApprovalAssignments } from "../approval/project-approval-assignments";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { PrismaService } from "../database/prisma.service";
import { lockEconomicProject, type EconomicDocument } from "./contract-economic-coverage";
import { canReviewEconomicFinance } from "./contract-economic-review-access";

const kind="contract_economic_finance_duty_notification";
type FinanceDuty=Pick<ContractEconomicReview,"id"|"projectId"|"status"|"financeRequired"|"preparedByUserId"|"contractReviewedById"|"revision">;
@Injectable()
export class EconomicFinanceNotificationService implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;
  private readonly logger=new Logger(EconomicFinanceNotificationService.name);
  constructor(private readonly prisma:PrismaService,private readonly sms:ApprovalSmsService,
    private readonly visibility:ProjectVisibilityService=new ProjectVisibilityService(prisma)) {}

  onModuleInit() {
    if(process.env.NODE_ENV==="test" || process.env.SKIP_DATABASE_CONNECT==="true" || !this.sms.available())return;
    this.timer=setInterval(()=>{void this.afterCommit();},60_000);
    this.timer.unref();
    void this.afterCommit();
  }
  onModuleDestroy() {if(this.timer)clearInterval(this.timer);}

  async queue(tx:Prisma.TransactionClient,row:FinanceDuty,documents:readonly Pick<EconomicDocument,"reference"|"title"|"counterparty">[]) {
    if(row.status!=="pending_finance")return;
    const references=documents.map(doc=>doc.reference).filter(Boolean);
    const titles=documents.map(doc=>doc.title).filter(Boolean);
    const parties=[...new Set(documents.map(doc=>doc.counterparty).filter(Boolean))];
    const candidates=await loadEffectiveProjectApprovalAssignments(tx,row.projectId,["finance_director"]);
    const ids=new Set(candidates.filter(candidate=>candidate.projectId===row.projectId&&candidate.userIsActive&&candidate.roleKey==="finance_director").map(candidate=>candidate.userId));
    const recipients=[];
    for(const id of ids)if(await canReviewEconomicFinance(tx,this.visibility,id,row))recipients.push(id);
    if(recipients.length)await tx.auditLog.createMany({skipDuplicates:true,data:recipients.map(recipientId=>({
      id:auditDutyNoticeId(kind,row.id,String(row.revision),recipientId),actorUserId:row.contractReviewedById,action:"queued",businessType:kind,
      businessId:row.id,metadata:{recipientId,projectId:row.projectId,revision:row.revision,references,titles,parties}
    }))});
  }

  private noticeAccess() {
    return {
      prisma: this.prisma, sms: this.sms, kind,
      lockDuty: async (tx: Prisma.TransactionClient, id: string) => {
        const location = await tx.contractEconomicReview.findUnique({ where: { id }, select: { projectId: true } });
        if (location) await lockEconomicProject(tx, location.projectId);
      },
      currentMessage: (tx: Prisma.TransactionClient, attempt: AuditLog) => this.currentMessage(tx, attempt),
      originalId: (attempt: AuditLog, recipientId: string) => auditDutyNoticeId(kind, attempt.businessId ?? "", String((attempt.metadata as Prisma.JsonObject)?.revision), recipientId)
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
      this.logger.warn("履约财务复核通知暂未完成，保留记录以供核对");
    }
  }

  private async currentMessage(tx:Prisma.TransactionClient,attempt:AuditLog):Promise<AuditDutySmsMessage|null> {
    const {recipientId,projectId,revision,references,titles,parties}=(attempt.metadata??{}) as Prisma.JsonObject;
    if(!attempt.businessId || typeof recipientId!=="string" || typeof projectId!=="string")return null;
    const row=await tx.contractEconomicReview.findUnique({where:{id:attempt.businessId},select:{
      id:true,status:true,projectId:true,preparedByUserId:true,contractReviewedById:true,financeRequired:true,revision:true
    }});
    if(!row || row.projectId!==projectId || row.revision!==revision ||
      !await canReviewEconomicFinance(tx,this.visibility,recipientId,row))return null;
    const names=(value:Prisma.JsonValue|undefined)=>Array.isArray(value)?value.filter((item):item is string=>typeof item==="string"):[];
    const [project,recipient,author]=await Promise.all([
      tx.project.findUnique({where:{id:row.projectId},select:{name:true}}),
      tx.user.findUnique({where:{id:recipientId},select:{phone:true,isActive:true}}),
      tx.user.findUnique({where:{id:row.preparedByUserId},select:{name:true}})
    ]);
    if(!recipient?.isActive)return null;
    return {phone:recipient.phone??"",intent:{
      businessLabel:"履约重复财务复核",dutyName:"复核履约重复金额",
      businessCode:names(references).join("、")||"履约重复复核",scopeName:project?.name??"所属项目",
      initiatorName:author?.name??"登记人待核对",subject:names(titles).join("、")||"复核文书履约重复",
      participants:names(parties),amountText:"按文书分项复核",
      targetPath:approvalIndependentDutyTarget("contract_economic_review",row.id)
    }};
  }
}
