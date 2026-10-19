import {businessDay} from "./contract-proxy-bank";
import {BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException} from "@nestjs/common";
import {Prisma} from "@prisma/client";
import {createHash} from "node:crypto";
import {PrismaService} from "../database/prisma.service";
import {ProjectVisibilityService} from "../auth/project-visibility.service";
import {AuthService} from "../auth/auth.service";
import {AuditService} from "../audit/audit.service";
import {snapshotApprovalSignature} from "../approval/approval-signature-snapshot";
import {OperatingSourceReplayService} from "../operating-ledger/operating-source-replay.service";
import {lockEconomicProject,money} from "./contract-economic-coverage";
import {matchedUpwardReceipts} from "./upward-receipt-capacity";
export interface PrepareReceiptMatch {projectId:string;receiptFactId:string;settlementLedgerId:string;originalId?:string;amountCents:string;occurredAt:string;reason:string;confirmationPassword:string;idempotencyKey:string}
@Injectable()
export class UpwardReceiptMatchService {
 constructor(private readonly prisma:PrismaService,private readonly visibility:ProjectVisibilityService,private readonly auth:AuthService,private readonly audit:AuditService,private readonly sources:OperatingSourceReplayService){}
 private async authorize(tx:Prisma.TransactionClient,actor:string,projectId:string,confirm=false){
  if(!(await this.visibility.visibleProjectIdsInTransaction(tx,actor)).includes(projectId))throw new ForbiddenException("无权核对该项目到账");
  const roles=(await this.visibility.effectiveRoleKeysByProjectInTransaction(tx,actor,[projectId])).get(projectId)??[];
  if(!roles.some(r=>(confirm?["finance_director"]:["finance_staff","finance_director"]).includes(r)))throw new ForbiddenException("到账核销由项目财务办理");return roles;
 }
 async list(actor:string,projectId:string){return this.prisma.$transaction(async tx=>{
  const roles=await this.authorize(tx,actor,projectId);
  const receipts=await tx.operatingFact.findMany({where:{projectId,sourceType:"fund_execution",direction:"inflow",status:"confirmed",impacts:{some:{impactKind:"company_project_funds_increase",direction:"increase"}}},include:{impacts:true}});
  const reversedIds=new Set((await tx.fundExecution.findMany({where:{reversesFundExecutionId:{in:receipts.flatMap(r=>r.fundExecutionId?[r.fundExecutionId]:[])}},select:{reversesFundExecutionId:true}})).map(r=>r.reversesFundExecutionId));
  const availableReceipts=receipts.filter(r=>!reversedIds.has(r.fundExecutionId));
  const settlements=await tx.projectAffiliateSettlementFact.findMany({where:{projectId,entryKind:"original",status:"confirmed",affiliateCompanyContractId:{not:null}}});
  const matches=await tx.upwardReceiptMatch.findMany({where:{projectId},orderBy:{createdAt:"desc"}});
  return {receipts:await Promise.all(availableReceipts.map(async r=>({id:r.id,label:`到账 ${r.occurredAt.toISOString().slice(0,10)} · ${r.amountCents.toString()} 分`,amountCents:r.amountCents.toString(),matchedCents:(await matchedUpwardReceipts(tx,{receiptFactId:r.id})).toString(),occurredAt:r.occurredAt}))),settlements:settlements.map(s=>({id:s.ledgerId,label:`${s.periodLabel} · ${s.counterpartyName}`})),matches:matches.map(r=>({...r,amountCents:r.amountCents.toString(),canConfirm:r.status==="pending_confirm"&&r.recordedByUserId!==actor&&roles.includes("finance_director")}))};
 });}
 private async context(tx:Prisma.TransactionClient,input:PrepareReceiptMatch,amount:bigint,excludeId?:string){
  const receipt=await tx.operatingFact.findFirst({where:{id:input.receiptFactId,projectId:input.projectId,sourceType:"fund_execution",direction:"inflow",status:"confirmed"},include:{impacts:true}});
  if(!receipt||!receipt.fundExecutionId||receipt.payeeSubjectKind!=="participating_company"||!receipt.payeeSubjectId||!receipt.impacts.some(i=>i.impactKind==="company_project_funds_increase"&&i.direction==="increase"))throw new BadRequestException("请选择已正式归入本项目的真实公司到账，不能另造收款");
  await tx.$queryRaw`SELECT "id" FROM "FundExecution" WHERE "id"=${receipt.fundExecutionId} FOR UPDATE`;
  const reversed=await tx.fundExecution.count({where:{reversesFundExecutionId:receipt.fundExecutionId}});
  if(reversed&&!input.originalId)throw new ConflictException("该到账已有反向处理，请先完成资金核对");
  const rows=await tx.projectAffiliateSettlementFact.findMany({where:{projectId:input.projectId,ledgerId:input.settlementLedgerId,status:"confirmed"}});
  const original=rows.find(r=>r.entryKind==="original");
  const contract=original?.affiliateCompanyContractId?await tx.projectAffiliateCompanyContract.findUnique({where:{id:original.affiliateCompanyContractId}}):null;
  if(!original||!contract||contract.companyEntityId!==receipt.payeeSubjectId||contract.affiliateAssignmentId!==receipt.affiliateAssignmentId)throw new BadRequestException("到账公司、施工企业与对上结算不一致");
  const date=new Date(input.occurredAt);
  if(businessDay(date)<businessDay(receipt.occurredAt)||businessDay(date)<businessDay(original.settledAt))throw new BadRequestException("核销日期不能早于到账或结算日期");
  if(input.originalId){
   const prior=await tx.upwardReceiptMatch.findFirst({where:{id:input.originalId,projectId:input.projectId,status:"confirmed",originalId:null,receiptFactId:receipt.id,settlementLedgerId:original.ledgerId}});
   if(!prior||businessDay(date)<businessDay(prior.occurredAt))throw new BadRequestException("解除匹配须关联原已确认核销");
   const returns=await tx.upwardReceiptMatch.aggregate({where:{originalId:prior.id,status:"confirmed"},_sum:{amountCents:true}});
   if(amount+(returns._sum.amountCents??0n)>prior.amountCents)throw new ConflictException("解除金额超过原有效核销");
  }else{
   if(amount+await matchedUpwardReceipts(tx,{receiptFactId:receipt.id},true,excludeId)>receipt.amountCents)throw new ConflictException("核销超过该到账未匹配金额");
   const paid=await tx.projectUpstreamFundFact.findMany({where:{projectId:input.projectId,factType:"affiliate_remittance_to_company",affiliateSettlementFactId:{in:rows.map(r=>r.id)},OR:[{status:"confirmed"},{status:"pending_confirm",effectDirection:"increase"}]}});
   const net=rows.reduce((s,r)=>s+(r.effectDirection==="decrease"?-r.amountCents:r.amountCents),0n);
   const used=paid.reduce((s,r)=>s+(r.effectDirection==="decrease"?-r.amountCents:r.amountCents),0n)+await matchedUpwardReceipts(tx,{settlementLedgerId:original.ledgerId},true,excludeId);
   if(amount+used>net)throw new ConflictException("核销超过对上结算未收余额");
  }
  const project=await tx.project.findUniqueOrThrow({where:{id:input.projectId}});
  if(!project.operatingLedgerEffectiveDate)throw new ConflictException("请先明确该项目经营启用范围");
  return {contractRelationship:"upward",reference:original.periodLabel,companyEntityId:contract.companyEntityId,companyName:contract.companyEntityNameSnapshot,affiliate:{assignmentId:receipt.affiliateAssignmentId,businessPartyVersionId:receipt.affiliateBusinessPartyVersionId,name:receipt.affiliateNameSnapshot,creditCode:receipt.affiliateCreditCodeSnapshot},operatingLedgerEffectiveDate:project.operatingLedgerEffectiveDate.toISOString(),receiptFactId:receipt.id,fundExecutionId:receipt.fundExecutionId,settlementLedgerId:original.ledgerId,affiliateCompanyContractId:contract.id};
 }
 async prepare(actor:string,input:PrepareReceiptMatch){
  if(!input||![input.projectId,input.receiptFactId,input.settlementLedgerId,input.reason,input.idempotencyKey].every(v=>typeof v==="string"&&v.trim())||input.reason.length>2000)throw new BadRequestException("请填写到账、对上结算和核销依据");
  const amount=money(input.amountCents,"核销金额"),date=new Date(input.occurredAt);if(amount<=0n||Number.isNaN(date.getTime())||date>new Date())throw new BadRequestException("金额或核销日期无效");
  await this.auth.confirmPassword(actor,input.confirmationPassword);
  const fingerprint=createHash("sha256").update(JSON.stringify({...input,confirmationPassword:undefined,actor})).digest("hex");
  return this.prisma.$transaction(async tx=>{
   await this.authorize(tx,actor,input.projectId);await lockEconomicProject(tx,input.projectId);
   const replay=await tx.upwardReceiptMatch.findUnique({where:{idempotencyKey:input.idempotencyKey}});if(replay){if(replay.requestFingerprint!==fingerprint)throw new ConflictException("操作凭据已用于其他核销");return {id:replay.id,status:replay.status};}
   const frozenSource=await this.context(tx,input,amount);
   const row=await tx.upwardReceiptMatch.create({data:{projectId:input.projectId,receiptFactId:input.receiptFactId,settlementLedgerId:input.settlementLedgerId,originalId:input.originalId??null,amountCents:amount,occurredAt:date,reason:input.reason.trim(),frozenSource,recordedByUserId:actor,idempotencyKey:input.idempotencyKey,requestFingerprint:fingerprint}});
   await this.audit.record(tx,{actorUserId:actor,action:"contract.receipt_match.prepare",businessType:"upward_receipt_match",businessId:row.id,metadata:{projectId:row.projectId}});return {id:row.id,status:row.status};
  });
 }
 async decide(actor:string,id:string,input:{decision:"confirm"|"return";confirmationPassword:string}){
  if(!input||!["confirm","return"].includes(input.decision))throw new BadRequestException("核销动作无效");await this.auth.confirmPassword(actor,input.confirmationPassword);
  return this.prisma.$transaction(async tx=>{
   const first=await tx.upwardReceiptMatch.findUnique({where:{id}});if(!first)throw new NotFoundException("核销不存在");
   await this.authorize(tx,actor,first.projectId,true);await lockEconomicProject(tx,first.projectId);
   const row=await tx.upwardReceiptMatch.findUniqueOrThrow({where:{id}});
   if(row.status==="confirmed"&&row.confirmedByUserId===actor&&input.decision==="confirm")return {id,status:row.status};
   if(row.status!=="pending_confirm"||row.recordedByUserId===actor)throw new ConflictException("核销已处理或经办人与确认人未分离");
   if(input.decision==="confirm")await this.context(tx,{...row,originalId:row.originalId??undefined,amountCents:row.amountCents.toString(),occurredAt:row.occurredAt.toISOString(),confirmationPassword:""},row.amountCents,row.id);
   const signature=input.decision==="confirm"?await snapshotApprovalSignature(tx,actor,{required:true}):null;
   const status=input.decision==="confirm"?"confirmed":"returned";
   await tx.upwardReceiptMatch.update({where:{id},data:{status,...(signature?{confirmedByUserId:actor,confirmedAt:new Date(),confirmationSignatureVersionId:signature.versionId}:{})}});
   if(signature)await this.sources.appendConfirmedSourceIfEnabledInTransaction(tx,{projectId:row.projectId,sourceType:"upward_receipt_match",sourceBusinessId:id},actor);
   await this.audit.record(tx,{actorUserId:actor,action:`contract.receipt_match.${input.decision}`,businessType:"upward_receipt_match",businessId:id,metadata:{projectId:row.projectId}});return {id,status};
  },{timeout:30000});
 }
}
