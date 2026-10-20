import { BadRequestException, ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { operatingContractRelationship } from "@jiangkong/shared-domain";
import { contractProxyPaid } from "./contract-proxy-capacity";
export type ProxySubject={kind:"participating_company"|"construction_enterprise"|"downstream_counterparty";id:string;name:string};
export interface ProxySource {
 allocations?: Array<{sourceRef:string;amountCents:string;reference:string}>;sourceRefs?:string[];
 contractRelationship:"inside"|"outside";sourceRef:string;reference:string;counterparty:string;
 debtor:ProxySubject;payee:ProxySubject;approvedPayer:ProxySubject;actualPayer:ProxySubject;
 affiliate:{assignmentId:string;businessPartyVersionId:string;name:string;creditCode?:string|null};operatingLedgerEffectiveDate:string;
 companyEntityId:string|null;companyName:string|null;
}
export async function loadProxyDebt(tx:Prisma.TransactionClient,projectId:string,ref:string){
 const [kind,id]=ref.split(":");
 if(!id||!["settlement","affiliate_settlement"].includes(kind))throw new BadRequestException("请选择已确认的下游结算");
 let amount=0n,paid=0n,reference="",counterparty="",contractId:string|null=null,sourceId=id;
 if(kind==="settlement"){
  await tx.$queryRaw`SELECT "id" FROM "Settlement" WHERE "id"=${id} FOR UPDATE`;
  const row=await tx.settlement.findFirst({where:{id,projectId,status:{in:["effective","partially_paid","paid"]}}});
  if(!row)throw new BadRequestException("结算尚未正式确认或不属于本项目");
  amount=row.payableAmountCents;paid=row.paidAmountCents;reference=row.code;contractId=row.contractId;
  const c=await tx.contract.findUniqueOrThrow({where:{id:row.contractId}});counterparty=c.counterparty;
  const legacy=await tx.projectProxyPayment.aggregate({where:{settlementId:id,voidedAt:null},_sum:{amountCents:true}});
  const allocated=await tx.paymentExecutionAllocation.aggregate({where:{settlementId:id,allocationType:"contract_due_payment"},_sum:{amountCents:true}});
  paid+=(legacy._sum.amountCents??0n)+(allocated._sum.amountCents??0n);
 }else{
  const rows=await tx.projectAffiliateSettlementFact.findMany({where:{projectId,ledgerId:id,status:"confirmed",affiliateCompanyContractId:null}});
  const original=rows.find(r=>r.entryKind==="original");if(!original)throw new BadRequestException("表外结算尚未确认；对上应收不能作为代付下游债务");
  amount=rows.reduce((s,r)=>s+(r.effectDirection==="decrease"?-r.amountCents:r.amountCents),0n);sourceId=original.id;reference=original.periodLabel;counterparty=original.counterpartyName;
  const payments=await tx.projectAffiliatePaymentFact.findMany({where:{projectId,settlementLedgerId:id,status:{in:["pending_confirm","confirmed"]}}});
  paid=payments.filter(r=>r.status==="confirmed"||r.effectDirection!=="decrease").reduce((s,r)=>s+(r.effectDirection==="decrease"?-r.amountCents:r.amountCents),0n);
 }
 const fact=await tx.operatingFact.findFirst({where:{projectId,sourceType:kind==="settlement"?"settlement":"project_affiliate_settlement_fact",sourceBusinessId:sourceId,status:"confirmed"}});
 const project=await tx.project.findUnique({where:{id:projectId},select:{operatingLedgerEffectiveDate:true}});
 if(!fact||!project?.operatingLedgerEffectiveDate)throw new ConflictException("该结算尚未形成可核对的正式经营依据，请先完成受影响范围的接管");
 const classification=operatingContractRelationship(fact.sourceType,fact.sourceSnapshot);
 if(!["inside","outside"].includes(classification)||!fact.debtorSubjectId||!fact.creditorSubjectId||!fact.affiliateAssignmentId||!fact.affiliateBusinessPartyVersionId)throw new ConflictException("原合同分类或债务主体不完整，不能依据实际付款人猜测");
 let debtorId=fact.debtorSubjectId,companyId:string|null=null,companyName:string|null=null;
 if(fact.debtorSubjectKind==="participating_company"){
  const version=await tx.companyEntityVersion.findUnique({where:{id:debtorId}});
  const company=await tx.companyEntity.findUnique({where:{id:version?.companyEntityId??debtorId}});
  if(!company)throw new ConflictException("原债务公司无法核对");companyId=company.id;companyName=version?.name??(typeof (fact.sourceSnapshot as Record<string,unknown>).companyEntityNameSnapshot==="string"?(fact.sourceSnapshot as Record<string,string>).companyEntityNameSnapshot:company.name);debtorId=company.id;
 }else if(fact.debtorSubjectKind!=="construction_enterprise")throw new ConflictException("原债务主体不是我方公司或施工企业");
 const debtor:ProxySubject={kind:fact.debtorSubjectKind,id:debtorId,name:companyName??fact.affiliateNameSnapshot??"施工企业"};
 const source:Omit<ProxySource,"actualPayer">={contractRelationship:classification as "inside"|"outside",sourceRef:ref,reference,counterparty,debtor,approvedPayer:debtor,payee:{kind:"downstream_counterparty",id:fact.creditorSubjectId,name:counterparty},affiliate:{assignmentId:fact.affiliateAssignmentId,businessPartyVersionId:fact.affiliateBusinessPartyVersionId,name:fact.affiliateNameSnapshot??"施工企业",creditCode:fact.affiliateCreditCodeSnapshot},operatingLedgerEffectiveDate:project.operatingLedgerEffectiveDate.toISOString(),companyEntityId:companyId,companyName};
 return {source,amountCents:amount,paidCents:paid+await contractProxyPaid(tx,ref),contractId};
}
export async function proxyPayers(tx:Prisma.TransactionClient,projectId:string,date:Date):Promise<ProxySubject[]>{
 const [companies,affiliate]=await Promise.all([
  tx.projectParticipatingCompany.findMany({where:{projectId,effectiveFrom:{lte:date},OR:[{endedAt:null},{endedAt:{gt:date}}]}}),
  tx.projectAffiliateAssignment.findFirst({where:{projectId,effectiveFrom:{lte:date},OR:[{endedAt:null},{endedAt:{gt:date}}]},orderBy:{effectiveFrom:"desc"}})
 ]);
 return [...companies.filter(c=>c.companyCreditCodeSnapshot).map(c=>({kind:"participating_company" as const,id:c.companyEntityId,name:c.companyNameSnapshot})),...(affiliate?[{kind:"construction_enterprise" as const,id:affiliate.businessPartyVersionId,name:affiliate.affiliateNameSnapshot}]:[])];
}
export function payerKey(s:ProxySubject){return `${s.kind}:${s.id}`;}
