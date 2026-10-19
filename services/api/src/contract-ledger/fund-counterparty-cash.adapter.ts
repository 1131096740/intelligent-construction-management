import type {Prisma} from "@prisma/client";
import type {OperatingSourceAdapter,OperatingSourceSnapshot,OperatingSourceLocator,OperatingSourceFactInput} from "../operating-ledger/operating-source-adapter";
import {sourceJson,requiredJsonRecord,requiredJsonText,requiredJsonDate,requiredJsonMoney} from "../operating-ledger/formal-operating-source.helpers";
/** The other subject view of an original bank receipt (or its actual bank reversal), never a settlement match. */
export class FundCounterpartyCashAdapter implements OperatingSourceAdapter {
 readonly sourceType="fund_execution_counterparty";
 async readProjectSnapshots(tx:Prisma.TransactionClient,projectId:string){
  const rows=await tx.operatingFact.findMany({where:{projectId,sourceType:"fund_execution",status:"confirmed"},include:{impacts:true}});
  return rows.flatMap(r=>{const snapshot=this.snapshot(r);return snapshot?[snapshot]:[];});
 }
 async readSourceSnapshot(tx:Prisma.TransactionClient,l:OperatingSourceLocator){const row=await tx.operatingFact.findFirst({where:{id:l.sourceBusinessId,projectId:l.projectId,sourceType:"fund_execution",status:"confirmed"},include:{impacts:true}});return row?this.snapshot(row):null;}
 private snapshot(r:Prisma.OperatingFactGetPayload<{include:{impacts:true}}> ):OperatingSourceSnapshot|null{
  const cash=r.impacts.find(i=>i.impactKind==="company_project_funds_increase"&&i.subjectKind==="participating_company");
  if(!cash||r.actualPayerSubjectKind!=="construction_enterprise"||!r.actualPayerSubjectId||!r.payeeSubjectId)return null;
  return {projectId:r.projectId,sourceType:this.sourceType,sourceBusinessId:r.id,sourceBusinessCode:r.sourceBusinessCode,sourceVersion:1,status:"confirmed",sourceSnapshot:sourceJson({amountCents:cash.amountCents.toString(),cashDirection:cash.direction,occurredAt:r.occurredAt.toISOString(),confirmedAt:r.confirmedAt!.toISOString(),confirmedByUserId:r.confirmedByUserId,actualPayerId:r.actualPayerSubjectId,companyId:r.payeeSubjectId,affiliateAssignmentId:r.affiliateAssignmentId,affiliateBusinessPartyVersionId:r.affiliateBusinessPartyVersionId,affiliateNameSnapshot:r.affiliateNameSnapshot,affiliateCreditCodeSnapshot:r.affiliateCreditCodeSnapshot,isBeforeOperatingLedgerEffectiveDate:r.isBeforeOperatingLedgerEffectiveDate,originalBankFactId:r.id,originalBankImpactId:cash.id,bankSourceSnapshot:r.sourceSnapshot})};
 }
 toOperatingFactInput(snapshot:OperatingSourceSnapshot):OperatingSourceFactInput{
  const s=requiredJsonRecord(snapshot.sourceSnapshot,"原银行现金依据"),amount=requiredJsonMoney(s,"amountCents","实际现金"),direction=s.cashDirection==="increase"?"decrease" as const:"increase" as const;
  const payer={kind:"construction_enterprise" as const,id:requiredJsonText(s,"actualPayerId","拨款方")},payee={kind:"participating_company" as const,id:requiredJsonText(s,"companyId","到账公司")};
  return {entryKind:"original",input:{projectId:snapshot.projectId,sourceType:this.sourceType,sourceBusinessId:snapshot.sourceBusinessId,sourceBusinessCode:snapshot.sourceBusinessCode,sourceVersion:1,idempotencyKey:`${this.sourceType}:${snapshot.sourceBusinessId}`,occurredAt:requiredJsonDate(s,"occurredAt","银行日期"),confirmedAt:requiredJsonDate(s,"confirmedAt","确认时间"),confirmedByUserId:requiredJsonText(s,"confirmedByUserId","确认人"),factKind:"fund_movement",operatingLevel:"project",evidenceLevel:"A",amountCents:amount,currencyCode:"CNY",direction:"neutral",isBeforeOperatingLedgerEffectiveDate:s.isBeforeOperatingLedgerEffectiveDate===true,affiliateAssignmentId:requiredJsonText(s,"affiliateAssignmentId","企业归属"),affiliateBusinessPartyVersionId:requiredJsonText(s,"affiliateBusinessPartyVersionId","企业版本"),affiliateNameSnapshot:requiredJsonText(s,"affiliateNameSnapshot","企业名称"),affiliateCreditCodeSnapshot:typeof s.affiliateCreditCodeSnapshot==="string"?s.affiliateCreditCodeSnapshot:undefined,sourceSnapshot:snapshot.sourceSnapshot,basisSnapshot:sourceJson({authority:"original_bank_fact_counterparty_view",originalBankFactId:snapshot.sourceBusinessId}),subjects:{actualPayer:payer,payee},impacts:[{idempotencyKey:`${this.sourceType}:${snapshot.sourceBusinessId}:cash`,sourceImpactKey:"affiliate_cash",impactKind:direction==="decrease"?"construction_enterprise_funds_decrease":"construction_enterprise_funds_increase",amountCents:amount,direction,subjectRole:"actual_payer",subject:payer,description:"原银行到账或实际冲回的施工企业资金视角"}]}};
 }
}
