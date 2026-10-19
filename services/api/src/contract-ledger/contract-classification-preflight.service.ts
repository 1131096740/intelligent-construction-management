import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { OperatingSourceAdapterRegistry } from "../operating-ledger/operating-source-adapter";
import { CONTRACT_RELATIONSHIP_LABELS,operatingContractRelationship } from "@jiangkong/shared-domain";
const TYPES=["fund_execution_counterparty","contract_economic_review","contract_version","project_affiliate_contract_fact","project_affiliate_settlement_fact","project_upstream_fund_fact","settlement","payment_execution","project_proxy_payment","project_affiliate_payment_fact","contract_proxy_execution","upward_receipt_match"];
function canonical(value:unknown):string{
 if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;
 if(value&&typeof value==="object")return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>`${JSON.stringify(key)}:${canonical(v)}`).join(",")}}`;
 return JSON.stringify(value);
}
@Injectable()
export class ContractClassificationPreflightService {
 constructor(private readonly prisma:PrismaService,private readonly visibility:ProjectVisibilityService,private readonly registry:OperatingSourceAdapterRegistry){}
 async inspect(actor:string,projectId:string){
  if(!projectId)throw new BadRequestException("请选择预检项目");
  return this.prisma.$transaction(async tx=>{
   await tx.$executeRaw`SET TRANSACTION READ ONLY`;
   if(!(await this.visibility.visibleProjectIdsInTransaction(tx,actor)).includes(projectId))throw new ForbiddenException("无权预检该项目");
   const roles=(await this.visibility.effectiveRoleKeysByProjectInTransaction(tx,actor,[projectId])).get(projectId)??[];
   if(!roles.some(r=>["contract_director","budget_director","finance_director","project_manager","chairman","general_manager"].includes(r)))throw new ForbiddenException("仅项目负责人及专业主管可查看历史口径预检");
   const facts=await tx.operatingFact.findMany({where:{projectId,status:"confirmed",sourceType:{in:TYPES}},include:{impacts:true},take:10001});
   if(facts.length>10000)throw new BadRequestException("历史范围超过预检上限，请分批核对，不能按部分结果认定完整");
   const differences=[];
   for(const fact of facts){
    const adapter=this.registry.require(fact.sourceType);
    try {
     const source=await adapter.readSourceSnapshot(tx,{projectId,sourceType:fact.sourceType,sourceBusinessId:fact.sourceBusinessId});
     if(!source){differences.push({reference:fact.sourceBusinessCode,status:"原业务依据缺失",relationship:CONTRACT_RELATIONSHIP_LABELS[operatingContractRelationship(fact.sourceType,fact.sourceSnapshot)],beforeAmountCents:fact.amountCents.toString(),afterAmountCents:null,reason:"需要专业核对原单据与已冻结事实，不自动删除或覆盖"});continue;}
     const next=adapter.toOperatingFactInput(source).input;
     const financial=(impacts:Array<{impactKind:string;direction:string;amountCents:bigint}>)=>impacts.map(i=>({kind:i.impactKind,direction:i.direction,amount:i.amountCents.toString()})).sort((a,b)=>canonical(a).localeCompare(canonical(b)));
     if(canonical(financial([...next.impacts]))!==canonical(financial(fact.impacts))||canonical(source.sourceSnapshot)!==canonical(fact.sourceSnapshot))differences.push({reference:fact.sourceBusinessCode,status:"口径或冻结依据有差异",relationship:CONTRACT_RELATIONSHIP_LABELS[operatingContractRelationship(fact.sourceType,source.sourceSnapshot)],beforeAmountCents:fact.amountCents.toString(),afterAmountCents:next.amountCents.toString(),reason:"保留原经营事实；须另行确认映射、更正或接管，不直接重放新口径"});
    }catch{
     differences.push({reference:fact.sourceBusinessCode,status:"资料不足，暂不能推导",relationship:CONTRACT_RELATIONSHIP_LABELS[operatingContractRelationship(fact.sourceType,fact.sourceSnapshot)],beforeAmountCents:fact.amountCents.toString(),afterAmountCents:null,reason:"原金额保留；核对签约身份、原版本、归档与接管依据后再处理"});
    }
   }
   const formalSources=[
    ...(await tx.contractVersion.findMany({where:{contractId:{in:(await tx.contract.findMany({where:{projectId},select:{id:true}})).map(r=>r.id)},effectiveAt:{not:null}},select:{id:true}})).map(r=>({type:"contract_version",id:r.id})),
    ...(await tx.projectAffiliateContractFact.findMany({where:{projectId,status:"confirmed"},select:{id:true}})).map(r=>({type:"project_affiliate_contract_fact",id:r.id})),
    ...(await tx.projectAffiliateSettlementFact.findMany({where:{projectId,status:"confirmed"},select:{id:true}})).map(r=>({type:"project_affiliate_settlement_fact",id:r.id})),
    ...(await tx.settlement.findMany({where:{projectId,status:{in:["effective","partially_paid","paid"]}},select:{id:true}})).map(r=>({type:"settlement",id:r.id}))
   ];
   const requestIds=(await tx.paymentRequest.findMany({where:{projectId},select:{id:true}})).map(r=>r.id);
   formalSources.push(...(await tx.paymentExecution.findMany({where:{paymentRequestId:{in:requestIds}},select:{id:true}})).map(r=>({type:"payment_execution",id:r.id})));
   formalSources.push(...(await tx.projectProxyPayment.findMany({where:{projectId,voidedAt:null},select:{id:true}})).map(r=>({type:"project_proxy_payment",id:r.id})));
   for(const [type,rows] of [
    ["project_upstream_fund_fact",await tx.projectUpstreamFundFact.findMany({where:{projectId,status:"confirmed"},select:{id:true}})],
    ["project_affiliate_payment_fact",await tx.projectAffiliatePaymentFact.findMany({where:{projectId,status:"confirmed"},select:{id:true}})],
    ["contract_proxy_execution",await tx.contractProxyExecution.findMany({where:{projectId,status:"confirmed"},select:{id:true}})],
    ["upward_receipt_match",await tx.upwardReceiptMatch.findMany({where:{projectId,status:"confirmed"},select:{id:true}})]
   ] as const)formalSources.push(...rows.map(r=>({type,id:r.id})));
   const originalCash=await tx.operatingFact.findMany({where:{projectId,status:"confirmed",sourceType:"fund_execution",actualPayerSubjectKind:"construction_enterprise",impacts:{some:{impactKind:"company_project_funds_increase",subjectKind:"participating_company"}}},select:{id:true}});
   formalSources.push(...originalCash.map(r=>({type:"fund_execution_counterparty",id:r.id})));
   const present=new Set(facts.map(f=>`${f.sourceType}:${f.sourceBusinessId}`));
   const unprojectedFormalSources=formalSources.filter(f=>!present.has(`${f.type}:${f.id}`)).length;
   const unclassified=await tx.projectAffiliateContractFact.count({where:{projectId,counterpartyVersionId:null}});
   const unsettledReviews=await tx.contractEconomicReview.count({where:{projectId,status:{in:["pending_review","pending_finance"]}}});
   return {projectId,readAt:new Date().toISOString(),readOnly:true,unprojectedFormalSources,checkedFacts:facts.length,unclassifiedExternalDocuments:unclassified,pendingEconomicReviews:unsettledReviews,differences,notice:"只读预检，不改历史数据、不生成经营事实。相同来源重新投影也不等于完成历史更正；正式转换与部署须单独确认。"};
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,timeout:60000});
 }
}
