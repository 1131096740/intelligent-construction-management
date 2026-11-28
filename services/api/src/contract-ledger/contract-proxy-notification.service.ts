import { ledgerDutySmsStatus, retryLedgerDutySms, retryLedgerDutySmsMessage } from "./independent-ledger-duty-sms";
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { AuditLog, ContractProxyExecution, Prisma } from "@prisma/client";
import { auditDutyNoticeId, dispatchAuditDutyNotices, type AuditDutySmsMessage } from "../approval/audit-duty-notification-delivery";
import { approvalIndependentDutyTarget } from "../approval/approval-duty-sms-intent";
import { ApprovalSmsService } from "../approval/approval-sms.service";
import { loadEffectiveProjectApprovalAssignments } from "../approval/project-approval-assignments";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { PrismaService } from "../database/prisma.service";
import { formatMoneyCentsAsPlainYuan } from "../money/decimal-money";
import { lockEconomicProject } from "./contract-economic-coverage";
import { canConfirmProxyPending } from "./contract-proxy-access";
import { payerKey, type ProxySubject } from "./contract-proxy-source";

const kind="contract_proxy_confirmation_duty_notification";
type ProxyDuty=Pick<ContractProxyExecution,"id"|"projectId"|"status"|"recordedByUserId">;
function frozenParty(value:Prisma.JsonValue|undefined):ProxySubject|null {
  if(!value || typeof value!=="object" || Array.isArray(value))return null;
  const {kind,id,name}=value;
  if((kind!=="participating_company" && kind!=="construction_enterprise" && kind!=="downstream_counterparty") ||
    typeof id!=="string" || !id || typeof name!=="string" || !name.trim())return null;
  return {kind,id,name};
}

@Injectable()
export class ContractProxyNotificationService implements OnModuleInit,OnModuleDestroy {
  private timer?:ReturnType<typeof setInterval>;
  private readonly logger=new Logger(ContractProxyNotificationService.name);
  constructor(private readonly prisma:PrismaService,private readonly sms:ApprovalSmsService,
    private readonly visibility:ProjectVisibilityService=new ProjectVisibilityService(prisma)) {}

  onModuleInit() {
    if(process.env.NODE_ENV==="test" || process.env.SKIP_DATABASE_CONNECT==="true" || !this.sms.available())return;
    this.timer=setInterval(()=>{void this.afterCommit();},60_000);
    this.timer.unref();
    void this.afterCommit();
  }
  onModuleDestroy() {if(this.timer)clearInterval(this.timer);}

  async queue(tx:Prisma.TransactionClient,row:ProxyDuty) {
    if(row.status!=="pending_confirm")return;
    const candidates=await loadEffectiveProjectApprovalAssignments(tx,row.projectId,["finance_director"]);
    const ids=new Set(candidates.filter(candidate=>candidate.projectId===row.projectId&&candidate.userIsActive&&candidate.roleKey==="finance_director").map(candidate=>candidate.userId));
    const recipients=[];
    for(const id of ids)if(await canConfirmProxyPending(tx,this.visibility,id,row))recipients.push(id);
    if(recipients.length)await tx.auditLog.createMany({skipDuplicates:true,data:recipients.map(recipientId=>({
      id:auditDutyNoticeId(kind,row.id,recipientId),actorUserId:row.recordedByUserId,action:"queued",businessType:kind,
      businessId:row.id,metadata:{recipientId,projectId:row.projectId}
    }))});
  }

  private noticeAccess() {
    return {
      prisma: this.prisma, sms: this.sms, kind,
      lockDuty: async (tx: Prisma.TransactionClient, id: string) => {
        const location = await tx.contractProxyExecution.findUnique({ where: { id }, select: { projectId: true } });
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
      this.logger.warn("代付资金确认通知暂未完成，保留记录以供核对");
    }
  }

  private async currentMessage(tx:Prisma.TransactionClient,attempt:AuditLog):Promise<AuditDutySmsMessage|null> {
    const {recipientId,projectId}=(attempt.metadata??{}) as Prisma.JsonObject;
    if(!attempt.businessId || typeof recipientId!=="string" || typeof projectId!=="string")return null;
    const row=await tx.contractProxyExecution.findUnique({where:{id:attempt.businessId},select:{
      id:true,status:true,projectId:true,recordedByUserId:true,entryKind:true,amountCents:true,actualPayerKey:true,frozenSource:true
    }});
    if(!row || row.projectId!==projectId || !await canConfirmProxyPending(tx,this.visibility,recipientId,row))return null;
    const source=row.frozenSource;
    if(!source || typeof source!=="object" || Array.isArray(source))return null;
    const debtor=frozenParty(source.debtor),payee=frozenParty(source.payee),actual=frozenParty(source.actualPayer);
    if(!debtor || !payee || !actual)return null;
    const flow=row.entryKind==="payment"?{label:"核对实际代付",actor:actual,receiver:payee}
      :row.entryKind==="refund"?{label:"核对代付款退款",actor:payee,receiver:actual}
      :row.entryKind==="repayment"?{label:"核对代付款归还",actor:debtor,receiver:actual}:null;
    if(!flow || payerKey(flow.actor)!==row.actualPayerKey)return null;
    const [project,recipient,author]=await Promise.all([
      tx.project.findUnique({where:{id:row.projectId},select:{name:true}}),
      tx.user.findUnique({where:{id:recipientId},select:{phone:true,isActive:true}}),
      tx.user.findUnique({where:{id:row.recordedByUserId},select:{name:true}})
    ]);
    if(!recipient?.isActive)return null;
    return {phone:recipient.phone??"",intent:{
      businessLabel:"代付资金确认",dutyName:flow.label,businessCode:typeof source.reference==="string"&&source.reference.trim()?source.reference:"代付资金确认",
      scopeName:project?.name??"所属项目",initiatorName:author?.name??"登记人待核对",subject:flow.label,
      participants:[`出款方：${flow.actor.name}`,`收款方：${flow.receiver.name}`],
      amountText:`${formatMoneyCentsAsPlainYuan(row.amountCents)} 元`,
      targetPath:approvalIndependentDutyTarget("contract_proxy_execution",row.id)
    }};
  }
}
