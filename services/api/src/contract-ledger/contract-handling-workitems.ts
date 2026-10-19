import type {Prisma} from "@prisma/client";
import type {WorkItem} from "../me/me.service";
export async function contractHandlingWorkItems(tx:Prisma.TransactionClient,actor:string,scopes:Array<{projectId:string;roleKeys:readonly string[]}>,names:Map<string,string>):Promise<WorkItem[]>{
 const finance=scopes.filter(s=>s.roleKeys.includes("finance_director")).map(s=>s.projectId),contracts=scopes.filter(s=>s.roleKeys.includes("contract_director")).map(s=>s.projectId);
 const items:WorkItem[]=[];
 const add=(r:{id:string;projectId:string|null;createdAt:Date},type:string,title:string,label:string,section:string)=>items.push({id:`${type}:${r.id}`,type:"approval",businessType:type,businessId:r.id,projectId:r.projectId??undefined,projectName:names.get(r.projectId??"")??"所属项目",businessCode:title,title,amountText:"详见复核依据",currentNode:title,stayedText:`登记于 ${r.createdAt.toISOString().slice(0,10)}`,nextAction:"查看依据并独立复核",targetPath:`/合同工作台?projectId=${encodeURIComponent(r.projectId??"")}&ledgerSection=${section}`,tone:"warning",contractRelationshipLabel:label,accountingEffect:"确认后按原业务依据入账，不能重复确认成本或资金"});
 if(contracts.length||finance.length){
  const reviews=await tx.contractEconomicReview.findMany({where:{preparedByUserId:{not:actor},OR:[{projectId:{in:contracts},status:"pending_review"},{projectId:{in:finance},status:"pending_finance",contractReviewedById:{not:actor}}]}});
  for(const row of reviews)add(row,"contract_economic_review",row.status==="pending_finance"?"履约重复财务复核":"履约范围合同复核","关联文书履约复核","contracts");
 }
 if(contracts.length)for(const row of await tx.upwardContractAmountRevision.findMany({where:{projectId:{in:contracts},status:"pending_confirm",recordedByUserId:{not:actor}}}))add(row,"upward_contract_amount_revision","确认对上合同金额修订","对上（施工企业—我方）","contracts");
 if(finance.length){
  const bankRole=await tx.position?.findUnique({where:{key:"finance_director"},select:{id:true}});
  if(bankRole&&await tx.userPosition.count({where:{userId:actor,projectId:null,positionId:bankRole.id}}))for(const row of await tx.contractBankVerificationRequest.findMany({where:{projectId:{in:finance},status:"pending_confirm",recordedByUserId:{not:actor}}}))add(row,"contract_bank_verification","独立核验账户及银行流水","实际资金核验","payments");
  for(const row of await tx.contractProxyExecution.findMany({where:{projectId:{in:finance},status:"pending_confirm",recordedByUserId:{not:actor}}})){const snapshot=row.frozenSource as {contractRelationship?:string};add(row,"contract_proxy_execution","确认代付、退款或归还",snapshot.contractRelationship==="inside"?"表内（我方签约）":"表外（施工企业签约）","payments");}
  for(const row of await tx.upwardReceiptMatch.findMany({where:{projectId:{in:finance},status:"pending_confirm",recordedByUserId:{not:actor}}}))add(row,"upward_receipt_match","确认对上到账核销","对上（施工企业—我方）","receipts");
 }
 return items;
}
