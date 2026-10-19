import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../database/prisma.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { AuthService } from "../auth/auth.service";
import { AuditService } from "../audit/audit.service";
import { snapshotApprovalSignature } from "../approval/approval-signature-snapshot";
import { acquireFileBusinessBindingTransactionLock,hasNonReceiptBusinessFileBinding } from "../file/file-business-binding";
import { lockEconomicProject,money } from "./contract-economic-coverage";
export async function upwardAmountRevisions(tx:Pick<Prisma.TransactionClient,"upwardContractAmountRevision">,ids:string[],asOf:Date){
 return tx.upwardContractAmountRevision.findMany({where:{contractId:{in:ids},status:"confirmed",effectiveAt:{lte:asOf}},orderBy:[{effectiveAt:"desc"},{confirmedAt:"desc"},{id:"desc"}]});
}
export interface PrepareUpwardAmount {projectId:string;contractId:string;supersedesId?:string;amountNature:"fixed"|"uncapped";amountCents?:string;effectiveAt:string;reason:string;evidenceFileId:string;confirmationPassword:string;idempotencyKey:string}
@Injectable()
export class UpwardContractAmountService {
 constructor(private readonly prisma:PrismaService,private readonly visibility:ProjectVisibilityService,private readonly auth:AuthService,private readonly audit:AuditService){}
 private async authorize(tx:Prisma.TransactionClient,actor:string,projectId:string,action:"read"|"prepare"|"confirm"){
  if(!(await this.visibility.visibleProjectIdsInTransaction(tx,actor)).includes(projectId))throw new ForbiddenException("无权办理本项目对上金额修订");
  const roles=(await this.visibility.effectiveRoleKeysByProjectInTransaction(tx,actor,[projectId])).get(projectId)??[];
  const allowed=action==="confirm"?["contract_director"]:action==="prepare"?["contract_staff","contract_director"]:["contract_staff","contract_director","budget_staff","budget_director","finance_staff","finance_director","project_manager","chairman","general_manager"];
  if(!roles.some(r=>allowed.includes(r)))throw new ForbiddenException("当前岗位无权办理该动作");
  return roles;
 }
 async list(actor:string,projectId:string){return this.prisma.$transaction(async tx=>{
  const roles=await this.authorize(tx,actor,projectId,"read");
  const contracts=await tx.projectAffiliateCompanyContract.findMany({where:{projectId,status:"confirmed"}});
  const revisions=await tx.upwardContractAmountRevision.findMany({where:{projectId},orderBy:{createdAt:"desc"}});
  return {canPrepare:roles.some(r=>["contract_staff","contract_director"].includes(r)),contracts:contracts.map(c=>({id:c.id,label:`${c.contractReference} · ${c.companyEntityNameSnapshot}`,amountNature:c.amountNature,amountCents:c.amountCents?.toString()??null})),revisions:revisions.map(r=>({...r,amountCents:r.amountCents?.toString()??null,canConfirm:r.status==="pending_confirm"&&r.recordedByUserId!==actor&&roles.includes("contract_director")}))};
 });}
 async prepare(actor:string,input:PrepareUpwardAmount){
  if(!input||typeof input.projectId!=="string"||typeof input.contractId!=="string"||typeof input.reason!=="string"||!input.reason.trim()||input.reason.length>2000||typeof input.evidenceFileId!=="string"||typeof input.idempotencyKey!=="string"||!input.idempotencyKey.trim()||!["fixed","uncapped"].includes(input.amountNature))throw new BadRequestException("请完整填写对上合同金额修订依据");
  const amount=input.amountNature==="fixed"?money(input.amountCents,"修订后完整合同额"):null;
  if(input.amountNature==="uncapped"&&input.amountCents!==undefined)throw new BadRequestException("未约定总额不能同时填写固定金额");
  const date=new Date(input.effectiveAt);if(Number.isNaN(date.getTime())||date>new Date())throw new BadRequestException("请填写已发生的修订生效日期");
  await this.auth.confirmPassword(actor,input.confirmationPassword);
  const fingerprint=createHash("sha256").update(JSON.stringify({...input,confirmationPassword:undefined,actor})).digest("hex");
  return this.prisma.$transaction(async tx=>{
   await this.authorize(tx,actor,input.projectId,"prepare");await lockEconomicProject(tx,input.projectId);
   const replay=await tx.upwardContractAmountRevision.findUnique({where:{idempotencyKey:input.idempotencyKey}});
   if(replay){if(replay.requestFingerprint!==fingerprint)throw new ConflictException("操作凭据已用于其他修订");return {id:replay.id,status:replay.status};}
   const contract=await tx.projectAffiliateCompanyContract.findFirst({where:{id:input.contractId,projectId:input.projectId,status:"confirmed"}});
   if(!contract)throw new BadRequestException("只能追加修订已确认的对上合同");
   const previous=await tx.upwardContractAmountRevision.findFirst({where:{contractId:contract.id,status:"confirmed"},orderBy:[{effectiveAt:"desc"},{confirmedAt:"desc"},{id:"desc"}]});
   if((previous?.id??null)!==(input.supersedesId??null)||date<(previous?.effectiveAt??contract.signedAt))throw new ConflictException("修订依据已变化或日期早于现行版本，请刷新后追加更正");
   if(await tx.upwardContractAmountRevision.count({where:{contractId:contract.id,status:"pending_confirm"}}))throw new ConflictException("该合同已有待确认金额修订，请先处理");
   await acquireFileBusinessBindingTransactionLock(tx);
   const file=await tx.fileObject.findUnique({where:{id:input.evidenceFileId}});
   if(!file||file.uploadedByUserId!==actor||file.storageStatus!=="active"||!file.contentSha256||await hasNonReceiptBusinessFileBinding(tx,[file.id]))throw new BadRequestException("请上传本人持有且未重复绑定的金额修订依据");
   const row=await tx.upwardContractAmountRevision.create({data:{projectId:input.projectId,contractId:contract.id,supersedesId:previous?.id??null,amountNature:input.amountNature,amountCents:amount,effectiveAt:date,reason:input.reason.trim(),evidenceFileId:file.id,evidenceSha256:file.contentSha256,recordedByUserId:actor,idempotencyKey:input.idempotencyKey,requestFingerprint:fingerprint}});
   await this.audit.record(tx,{actorUserId:actor,action:"contract.upward_amount.prepare",businessType:"upward_contract_amount_revision",businessId:row.id,metadata:{projectId:input.projectId,contractId:contract.id}});
   return {id:row.id,status:row.status};
  });
 }
 async decide(actor:string,id:string,input:{decision:"confirm"|"return";confirmationPassword:string}){
  if(!input||!["confirm","return"].includes(input.decision))throw new BadRequestException("处理动作不正确");
  await this.auth.confirmPassword(actor,input.confirmationPassword);
  return this.prisma.$transaction(async tx=>{
   const initial=await tx.upwardContractAmountRevision.findUnique({where:{id}});if(!initial)throw new NotFoundException("修订不存在");
   await this.authorize(tx,actor,initial.projectId,"confirm");await lockEconomicProject(tx,initial.projectId);
   const row=await tx.upwardContractAmountRevision.findUniqueOrThrow({where:{id}});
   if(row.status==="confirmed"&&row.confirmedByUserId===actor&&input.decision==="confirm")return {id,status:row.status};
   if(row.status!=="pending_confirm")throw new ConflictException("修订已处理，请刷新");
   if(row.recordedByUserId===actor)throw new ForbiddenException("修订经办人与确认人须分离");
   const file=await tx.fileObject.findUnique({where:{id:row.evidenceFileId}});
   if(input.decision==="confirm"&&(file?.storageStatus!=="active"||file.contentSha256!==row.evidenceSha256))throw new ConflictException("依据文件已变化，请退回核对");
   if(input.decision==="confirm"){const latest=await tx.upwardContractAmountRevision.findFirst({where:{contractId:row.contractId,status:"confirmed"},orderBy:[{effectiveAt:"desc"},{confirmedAt:"desc"},{id:"desc"}]});if((latest?.id??null)!==row.supersedesId)throw new ConflictException("修订前序已经变化，请退回重新核对");}
   const signature=input.decision==="confirm"?await snapshotApprovalSignature(tx,actor,{required:true}):null;
   const status=input.decision==="confirm"?"confirmed":"returned";
   await tx.upwardContractAmountRevision.update({where:{id},data:{status,...(signature?{confirmedAt:new Date(),confirmedByUserId:actor,confirmationSignatureVersionId:signature.versionId}:{})}});
   await this.audit.record(tx,{actorUserId:actor,action:`contract.upward_amount.${input.decision}`,businessType:"upward_contract_amount_revision",businessId:id,metadata:{projectId:row.projectId,contractId:row.contractId,amountCents:row.amountCents?.toString()??null,amountNature:row.amountNature}});
   return {id,status};
  });
 }
}
