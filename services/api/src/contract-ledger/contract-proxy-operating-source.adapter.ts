import { BadRequestException } from "@nestjs/common";
import type { OperatingSourceAdapter, OperatingSourceSnapshot, OperatingSourceLocator, OperatingSourceFactInput } from "../operating-ledger/operating-source-adapter";
import type { AppendOperatingFactInput } from "../operating-ledger/operating-ledger.service";
import { sourceJson } from "../operating-ledger/formal-operating-source.helpers";
import type { ProxySource,ProxySubject } from "./contract-proxy-source";
export class ContractProxyOperatingSourceAdapter implements OperatingSourceAdapter {
 readonly sourceType="contract_proxy_execution";
 async readProjectSnapshots(tx:Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],projectId:string){return (await tx.contractProxyExecution.findMany({where:{projectId,status:"confirmed"}})).map(r=>this.snapshot(r));}
 async readSourceSnapshot(tx:Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],locator:OperatingSourceLocator){const row=await tx.contractProxyExecution.findFirst({where:{id:locator.sourceBusinessId,projectId:locator.projectId,status:"confirmed"}});return row?this.snapshot(row):null;}
 private snapshot(row:{id:string;projectId:string;entryKind:string;originalId:string|null;amountCents:bigint;occurredAt:Date;confirmedAt:Date|null;confirmedByUserId:string|null;frozenSource:unknown;evidenceFileId:string;evidenceSha256:string;bankReference:string;reason:string}):OperatingSourceSnapshot{
  if(!row.confirmedAt||!row.confirmedByUserId)throw new BadRequestException("代付缺少财务确认依据");
  const source=row.frozenSource as ProxySource;
  return {projectId:row.projectId,sourceType:this.sourceType,sourceBusinessId:row.id,sourceBusinessCode:`${source.reference}代付往来`,sourceVersion:1,status:"confirmed",sourceSnapshot:sourceJson({...source,eventKind:row.entryKind,originalId:row.originalId,amountCents:row.amountCents.toString(),occurredAt:row.occurredAt.toISOString(),confirmedAt:row.confirmedAt.toISOString(),confirmedByUserId:row.confirmedByUserId,evidenceFileId:row.evidenceFileId,evidenceSha256:row.evidenceSha256,bankReference:row.bankReference,reason:row.reason})};
 }
 toOperatingFactInput(snapshot:OperatingSourceSnapshot):OperatingSourceFactInput{
  const s=snapshot.sourceSnapshot as unknown as ProxySource&{eventKind:string;amountCents:string;occurredAt:string;confirmedAt:string;confirmedByUserId:string;evidenceFileId:string};
  const amount=BigInt(s.amountCents);if(amount<=0n||!["payment","refund","repayment"].includes(s.eventKind))throw new BadRequestException("代付往来事实无效");
  const impacts:AppendOperatingFactInput["impacts"]=[];
  const impact=(key:string,kind:AppendOperatingFactInput["impacts"][number]["impactKind"],direction:"increase"|"decrease",subject:ProxySubject,role:"debtor"|"payee"|"actual_payer",description:string)=>impacts.push({idempotencyKey:`${this.sourceType}:${snapshot.sourceBusinessId}:${key}`,sourceImpactKey:key,impactKind:kind,amountCents:amount,direction,subjectRole:role,subject,description,impactSnapshot:sourceJson({debtor:s.debtor,actualPayer:s.actualPayer,internalTransfer:s.eventKind==="repayment"})});
  const funds=(key:string,subject:ProxySubject,direction:"increase"|"decrease")=>impact(key,`${subject.kind==="construction_enterprise"?"construction_enterprise":"company_project"}_funds_${direction}`,direction,subject,"actual_payer","实际资金变动，不重复确认成本");
  if(s.eventKind==="repayment"){
   funds("return-out",s.debtor,"decrease");funds("return-in",s.actualPayer,"increase");
   impact("relationship","inter_subject_balance_decrease","decrease",s.actualPayer,"actual_payer","归还代付款只清偿主体往来");
  }else{
   const refund=s.eventKind==="refund";
   impact("payable",refund?"payable_increase":"payable_decrease",refund?"increase":"decrease",s.payee,"payee",refund?"退款恢复原下游应付，不作为收入":"代付核销原债务，原合同分类不变");
   funds("funds",s.actualPayer,refund?"increase":"decrease");
   impact("relationship",refund?"inter_subject_balance_decrease":"inter_subject_balance_increase",refund?"decrease":"increase",s.actualPayer,"actual_payer",refund?"退款冲回未结清代付往来":"形成实际出款方对原债务人的代付往来");
  }
  return {entryKind:"original",input:{projectId:snapshot.projectId,sourceType:this.sourceType,sourceBusinessId:snapshot.sourceBusinessId,sourceBusinessCode:snapshot.sourceBusinessCode,sourceVersion:1,idempotencyKey:`${this.sourceType}:${snapshot.sourceBusinessId}`,occurredAt:new Date(s.occurredAt),confirmedAt:new Date(s.confirmedAt),confirmedByUserId:s.confirmedByUserId,factKind:"downstream_payment",operatingLevel:"project",evidenceLevel:"A",amountCents:amount,currencyCode:"CNY",direction:s.eventKind==="repayment"?"neutral":s.eventKind==="refund"?"inflow":"outflow",isBeforeOperatingLedgerEffectiveDate:new Date(s.occurredAt)<new Date(s.operatingLedgerEffectiveDate),affiliateAssignmentId:s.affiliate.assignmentId,affiliateBusinessPartyVersionId:s.affiliate.businessPartyVersionId,affiliateNameSnapshot:s.affiliate.name,affiliateCreditCodeSnapshot:s.affiliate.creditCode??undefined,sourceSnapshot:snapshot.sourceSnapshot,basisSnapshot:sourceJson({authority:"confirmed_contract_proxy_execution",evidenceFileId:s.evidenceFileId}),subjects:{debtor:s.debtor,creditor:s.payee,approvedPayer:s.approvedPayer,actualPayer:s.eventKind==="repayment"?s.debtor:s.actualPayer,payee:s.eventKind==="repayment"?s.actualPayer:s.payee},impacts}};
 }
}
