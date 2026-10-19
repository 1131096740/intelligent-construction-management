import {requireCompanyFinance} from "../company-transfer/company-transfer.access";
import {BadRequestException,ConflictException,ForbiddenException,Injectable,NotFoundException} from "@nestjs/common";
import type {Prisma} from "@prisma/client";
import {createHash,randomUUID} from "node:crypto";
import {PrismaService} from "../database/prisma.service";
import {ProjectVisibilityService} from "../auth/project-visibility.service";
import {AuthService} from "../auth/auth.service";
import {AuditService} from "../audit/audit.service";
import {snapshotApprovalSignature} from "../approval/approval-signature-snapshot";
import {acquireFileBusinessBindingTransactionLock} from "../file/file-business-binding";
import {VerifiedBankTransactionObservationService} from "../fund-execution/verified-bank-transaction-observation.service";
import {lockEconomicProject,money} from "./contract-economic-coverage";
import {proxyPayers} from "./contract-proxy-source";
export interface PrepareBankVerification{projectId?:string|null;companyEntityId:string;accountNumber:string;bankReference:string;direction:"inflow"|"outflow";amountCents:string;occurredAt:string;evidenceFileId:string;reason:string;idempotencyKey:string;confirmationPassword:string}
const digest=(s:string)=>createHash("sha256").update(s).digest("hex");
@Injectable()
export class ContractBankVerificationService{
 constructor(private readonly prisma:PrismaService,private readonly visibility:ProjectVisibilityService,private readonly auth:AuthService,private readonly audit:AuditService){}
 private async authorize(tx:Prisma.TransactionClient,actor:string,projectId:string|null){
  if(!projectId){await requireCompanyFinance(tx,actor);return;}
  if(!(await this.visibility.visibleProjectIdsInTransaction(tx,actor)).includes(projectId))throw new ForbiddenException("无权核验本项目银行流水");
  const roles=(await this.visibility.effectiveRoleKeysByProjectInTransaction(tx,actor,[projectId])).get(projectId)??[];
  if(!roles.some(r=>["finance_staff","finance_director"].includes(r)))throw new ForbiddenException("银行流水由所属项目财务岗位办理");
 }
 private async isDirector(tx:Prisma.TransactionClient,actor:string){const role=await tx.position.findUnique({where:{key:"finance_director"},select:{id:true}});return role?tx.userPosition.count({where:{userId:actor,projectId:null,positionId:role.id}}):0;}
 private async companies(tx:Prisma.TransactionClient,projectId:string|null){
  const repaymentCompanies=await tx.$queryRaw<Array<{id:string}>>`SELECT "sourceCompanyId" AS id FROM "CompanyTransfer" WHERE kind='repayment' AND status='approved' AND "sourceProjectId" IS NOT DISTINCT FROM ${projectId}::text UNION SELECT "destinationCompanyId" AS id FROM "CompanyTransfer" WHERE kind='repayment' AND status='approved' AND "destinationProjectId" IS NOT DISTINCT FROM ${projectId}::text`;
  const repaymentIds=repaymentCompanies.map(c=>c.id).filter(Boolean);
  if(!projectId)return tx.companyEntity.findMany({where:{OR:[{isActive:true},{id:{in:repaymentIds}}]},select:{id:true,name:true,unifiedSocialCreditCode:true}});
  const contracts=await tx.contract.findMany({where:{projectId},select:{id:true}}),versions=await tx.contractVersion.findMany({where:{contractId:{in:contracts.map(c=>c.id)},effectiveAt:{not:null}},select:{companyEntityIdSnapshot:true}});
  const ids=[...(await proxyPayers(tx,projectId,new Date())).filter(p=>p.kind==="participating_company").map(p=>p.id),...versions.flatMap(v=>v.companyEntityIdSnapshot?[v.companyEntityIdSnapshot]:[])];
  return tx.companyEntity.findMany({where:{OR:[{id:{in:ids},isActive:true},{id:{in:repaymentIds}}]},select:{id:true,name:true,unifiedSocialCreditCode:true}});
 }
 async list(actor:string,projectId:string|null,page=1,status="pending_confirm"){if(!Number.isSafeInteger(page)||page<1||page>100000||!["pending_confirm","confirmed","returned","all"].includes(status))throw new BadRequestException("核验列表页码或状态无效");return this.prisma.$transaction(async tx=>{await this.authorize(tx,actor,projectId);const companies=await this.companies(tx,projectId);const where={projectId,...(status==="all"?{}:{status})};const total=await tx.contractBankVerificationRequest.count({where});const rows=await tx.contractBankVerificationRequest.findMany({where,orderBy:[{createdAt:"desc"},{id:"asc"}],skip:(page-1)*50,take:50});const director=await this.isDirector(tx,actor);return {page,pageSize:50,total,companies:companies.map(c=>({value:c.id,label:c.name})),rows:rows.map(r=>({id:r.id,evidenceFileId:r.evidenceFileId,companyName:r.companyName,accountLast4:r.accountLast4,bankReference:r.bankReference,direction:r.direction,amountCents:r.amountCents.toString(),occurredAt:r.occurredAt.toISOString(),status:r.status,reason:r.reason,canConfirm:r.status==="pending_confirm"&&r.recordedByUserId!==actor&&director>0}))};});}
 async prepare(actor:string,input:PrepareBankVerification){
  if(!input||![input.companyEntityId,input.accountNumber,input.bankReference,input.evidenceFileId,input.reason,input.idempotencyKey].every(v=>typeof v==="string"&&v.trim())||!["inflow","outflow"].includes(input.direction))throw new BadRequestException("请完整填写银行流水与核验依据");
  const account=input.accountNumber.normalize("NFKC").replace(/[\s-]/gu,"");if(!/^[0-9A-Za-z]{8,40}$/u.test(account)||input.bankReference.length>160||input.reason.length>2000)throw new BadRequestException("银行账号、交易流水号或说明格式不正确");
  const amount=money(input.amountCents,"交易金额"),date=new Date(input.occurredAt);if(amount<=0n||Number.isNaN(date.getTime())||date>new Date())throw new BadRequestException("银行金额或发生时间无效");
  await this.auth.confirmPassword(actor,input.confirmationPassword);
  const accountHash=digest(account.toLowerCase()),bankIdentity=digest(`${input.companyEntityId}|${accountHash}|${input.bankReference.normalize("NFKC").replace(/\s/gu,"").toLowerCase()}`);
  const fingerprint=digest(JSON.stringify({...input,accountNumber:undefined,accountHash,confirmationPassword:undefined,actor}));
  return this.prisma.$transaction(async tx=>{
   await this.authorize(tx,actor,input.projectId||null);if(input.projectId)await lockEconomicProject(tx,input.projectId);
   const replay=await tx.contractBankVerificationRequest.findUnique({where:{idempotencyKey:input.idempotencyKey}});if(replay){if(replay.requestFingerprint!==fingerprint)throw new ConflictException("操作凭据已用于其他银行核验");return {id:replay.id,status:replay.status};}
   const company=(await this.companies(tx,input.projectId||null)).find(c=>c.id===input.companyEntityId);if(!company?.unifiedSocialCreditCode)throw new BadRequestException("请选择本项目有完整法人档案的公司");
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${bankIdentity},0))`;
   if(await tx.contractBankVerificationRequest.count({where:{bankIdentity,status:{not:"returned"}}}))throw new ConflictException("这笔银行流水已提交核验，请打开原记录，不要跨项目重复登记");
   await acquireFileBusinessBindingTransactionLock(tx);const file=await tx.fileObject.findUnique({where:{id:input.evidenceFileId}});if(!file||file.uploadedByUserId!==actor||file.storageStatus!=="active"||!file.contentSha256)throw new BadRequestException("请上传本人持有的有效银行交易回单");
   const row=await tx.contractBankVerificationRequest.create({data:{projectId:input.projectId||null,companyEntityId:company.id,companyName:company.name,companyCreditCode:company.unifiedSocialCreditCode,accountHash,accountLast4:account.slice(-4),bankReference:input.bankReference.trim(),bankIdentity,direction:input.direction,amountCents:amount,occurredAt:date,evidenceFileId:file.id,evidenceSha256:file.contentSha256,reason:input.reason.trim(),recordedByUserId:actor,idempotencyKey:input.idempotencyKey,requestFingerprint:fingerprint}});
   await this.audit.record(tx,{actorUserId:actor,action:"contract.bank_verification.prepare",businessType:"contract_bank_verification",businessId:row.id,metadata:{projectId:row.projectId}});return {id:row.id,status:row.status};
  });
 }
 async decide(actor:string,id:string,input:{decision:"confirm"|"return";holderEvidenceFileId?:string;accountNumber?:string;confirmationPassword:string}){
  if(!input||!["confirm","return"].includes(input.decision))throw new BadRequestException("核验动作不正确");await this.auth.confirmPassword(actor,input.confirmationPassword);
  return this.prisma.$transaction(async tx=>{
   const initial=await tx.contractBankVerificationRequest.findUnique({where:{id}});if(!initial)throw new NotFoundException("核验申请不存在");await this.authorize(tx,actor,initial.projectId);if(initial.projectId)await lockEconomicProject(tx,initial.projectId);
   await tx.$queryRaw`SELECT "id" FROM "ContractBankVerificationRequest" WHERE "id"=${id} FOR UPDATE`;
   const row=await tx.contractBankVerificationRequest.findUniqueOrThrow({where:{id}});
   if(!(await this.isDirector(tx,actor))||actor===row.recordedByUserId)throw new ForbiddenException("须由独立的公司财务负责人核验账户持有人");
   if(row.status==="confirmed"&&input.decision==="confirm"&&row.confirmedByUserId===actor)return {id,status:row.status};if(row.status!=="pending_confirm")throw new ConflictException("银行核验已处理，请刷新");
   if(input.decision==="return"){await tx.contractBankVerificationRequest.update({where:{id},data:{status:"returned"}});await this.audit.record(tx,{actorUserId:actor,action:"contract.bank_verification.return",businessType:"contract_bank_verification",businessId:id,metadata:{projectId:row.projectId}});return {id,status:"returned"};}
   if(typeof input.accountNumber!=="string"||digest(input.accountNumber.normalize("NFKC").replace(/[\s-]/gu,"").toLowerCase())!==row.accountHash)throw new BadRequestException("独立核对的完整银行账号与原回单登记不一致，请退回修正");
   if(!input.holderEvidenceFileId)throw new BadRequestException("请上传账户开户名称及账号核验依据，核对其与原交易回单一致");
   await acquireFileBusinessBindingTransactionLock(tx);
   const holderFile=await tx.fileObject.findUnique({where:{id:input.holderEvidenceFileId}});
   if(!holderFile||holderFile.id===row.evidenceFileId||holderFile.uploadedByUserId!==actor||holderFile.storageStatus!=="active"||!holderFile.contentSha256)throw new BadRequestException("请使用本人上传、独立核对的账户证明");
   const file=await tx.fileObject.findUnique({where:{id:row.evidenceFileId}});if(file?.storageStatus!=="active"||file.contentSha256!==row.evidenceSha256)throw new ConflictException("原银行交易依据已变化，请退回重新核验");
   const signature=await snapshotApprovalSignature(tx,actor,{required:true}),secret=process.env.OPERATING_LEDGER_DB_WRITE_SECRET?.trim();if(!secret)throw new ForbiddenException("资金核验写入密钥未配置");
   await tx.$executeRaw`SELECT public."authorizeOperatingLedgerWrite"(${actor},${secret})`;
   const [issued]=await tx.$queryRaw<Array<{id:string}>>`SELECT public.issue_contract_bank_holder(${id},${actor},${input.holderEvidenceFileId},${signature.versionId},${row.accountHash}) AS id`;
   const observation=await new VerifiedBankTransactionObservationService(this.prisma).recordInTransaction(tx,{reference:`contract-bank:${row.id}`,payerVerificationId:issued.id,transactionSourceType:"contract_bank_verification",transactionSourceId:row.id,transactionSourceIdentity:row.bankIdentity,transactionEvidenceFileId:row.evidenceFileId,transactionExecutedByUserId:row.recordedByUserId,amountCents:row.amountCents,currencyCode:"CNY",direction:row.direction as "inflow"|"outflow",occurredAt:row.occurredAt,createdByUserId:actor,auditRequestId:randomUUID()});
   await tx.contractBankVerificationRequest.update({where:{id},data:{status:"confirmed",confirmedByUserId:actor,confirmedAt:new Date(),signatureVersionId:signature.versionId,holderEvidenceFileId:input.holderEvidenceFileId,payerVerificationId:issued.id,observationId:observation.id}});
   await this.audit.record(tx,{actorUserId:actor,action:"contract.bank_verification.confirm",businessType:"contract_bank_verification",businessId:id,metadata:{projectId:row.projectId,observationId:observation.id}});return {id,status:"confirmed"};
  },{timeout:30000});
 }
}
