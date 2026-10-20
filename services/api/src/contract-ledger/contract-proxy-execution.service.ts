import { recordIndependentApproval } from "../approval/independent-approval-evidence";
import { ledgerApprovalFacts } from "../approval/ledger-approval-facts";
import {companyTransferReservedProxy} from "../company-transfer/company-transfer.balance";
import {contractBankProjectWhere} from "./contract-bank-project";
import {validateProxyBank,validateProxyReceivingBank,businessDay} from "./contract-proxy-bank";
import { allocatedProxyAmount } from "./contract-proxy-capacity";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import type { RoleKey } from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";
import { AuthService } from "../auth/auth.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { AuditService } from "../audit/audit.service";
import { snapshotApprovalSignature } from "../approval/approval-signature-snapshot";
import { acquireFileBusinessBindingTransactionLock, hasNonReceiptBusinessFileBinding } from "../file/file-business-binding";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import { ProjectFundingAvailabilityService } from "../project-funding/project-funding-availability.service";
import { lockEconomicProject, money } from "./contract-economic-coverage";
import { loadProxyDebt, payerKey, proxyPayers, type ProxySource } from "./contract-proxy-source";
export interface PrepareProxyExecution { receivingBankObservationId?:string; bankObservationId?:string; allocations?:Array<{sourceRef:string;amountCents:string}>; projectId:string;sourceRef:string;entryKind:"payment"|"refund"|"repayment";originalId?:string;amountCents:string;occurredAt:string;actualPayerKey:string;bankReference:string;evidenceFileId:string;reason:string;paymentRequestId?:string;idempotencyKey:string;confirmationPassword:string }
@Injectable()
export class ContractProxyExecutionService {
 constructor(private readonly prisma:PrismaService,private readonly visibility:ProjectVisibilityService,private readonly auth:AuthService,private readonly audit:AuditService,private readonly sources:OperatingSourceReplayService,private readonly funding:ProjectFundingAvailabilityService){}
 private async authorize(tx:Prisma.TransactionClient,actor:string,projectId:string,confirm=false){
  if(!(await this.visibility.visibleProjectIdsInTransaction(tx,actor)).includes(projectId))throw new ForbiddenException("无权办理该项目代付");
  const roles=(await this.visibility.effectiveRoleKeysByProjectInTransaction(tx,actor,[projectId])).get(projectId)??[];
  if(!roles.some(r=>(confirm?["finance_director"]:["finance_staff","finance_director"]).includes(r)))throw new ForbiddenException("该动作须由所属项目财务岗位办理");
  return roles as RoleKey[];
 }
 async bankOptions(actor:string,projectId:string){return this.prisma.$transaction(async tx=>{
  await this.authorize(tx,actor,projectId);
  const contracts=await tx.contract.findMany({where:{projectId},select:{id:true}});
  const versions=await tx.contractVersion.findMany({where:{contractId:{in:contracts.map(c=>c.id)},effectiveAt:{not:null}},select:{companyEntityIdSnapshot:true}});
  const companies=[...new Set([...(await proxyPayers(tx,projectId,new Date())).filter(p=>p.kind==="participating_company").map(p=>p.id),...versions.flatMap(v=>v.companyEntityIdSnapshot?[v.companyEntityIdSnapshot]:[])])];
  const claims=[...await tx.bankTransactionClaim.findMany({select:{observationId:true}}),...await tx.contractProxyBankClaim.findMany({select:{observationId:true}}),...await tx.contractBankEventClaim.findMany({select:{observationId:true}}),...await tx.companyTransferBankClaim.findMany({select:{observationId:true}})];
  return (await tx.verifiedBankTransactionObservation.findMany({where:{...await contractBankProjectWhere(tx,projectId),holderCompanyEntityId:{in:companies},id:{notIn:claims.map(c=>c.observationId)}},orderBy:{occurredAt:"desc"},take:1000})).map(o=>({value:o.reference,label:`${o.holderNameSnapshot} · ${o.direction==="inflow"?"到账":"出款"} · ${o.amountCents/100n}.${(o.amountCents%100n).toString().padStart(2,"0")} 元 · ${o.occurredAt.toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}`}));
 });}
 async list(actor:string,projectId:string){return this.prisma.$transaction(async tx=>{
  const roles=await this.authorize(tx,actor,projectId);
  const [normal,external,entries,payers,requests,observations]=await Promise.all([
   tx.settlement.findMany({where:{projectId,status:{in:["effective","partially_paid","paid"]}},select:{id:true,code:true},take:1001}),
   tx.projectAffiliateSettlementFact.findMany({where:{projectId,status:"confirmed",entryKind:"original",affiliateCompanyContractId:null},select:{ledgerId:true,periodLabel:true},take:1001}),
   tx.contractProxyExecution.findMany({where:{projectId},orderBy:{createdAt:"desc"},take:1001}),proxyPayers(tx,projectId,new Date()),
   tx.paymentRequest.findMany({where:{projectId,status:{in:["approved_pending_payment","partially_paid"]},settlementId:{not:null}},select:{id:true,code:true,settlementId:true,approvedAmountCents:true,requestedAmountCents:true,paidAmountCents:true}}),
   tx.verifiedBankTransactionObservation.findMany({where:{...await contractBankProjectWhere(tx,projectId),holderCompanyEntityId:{in:(await proxyPayers(tx,projectId,new Date())).filter(p=>p.kind==="participating_company").map(p=>p.id)}},orderBy:{occurredAt:"desc"},take:1000})
  ]);
  if([normal,external,entries].some(r=>r.length>1000))throw new BadRequestException("项目代付范围过大，请按原业务台账核对后缩小范围");
  const claims=await tx.bankTransactionClaim.findMany({where:{observationId:{in:observations.map(o=>o.id)}}});const otherClaims=[...await tx.contractBankEventClaim.findMany({select:{observationId:true}}),...await tx.companyTransferBankClaim.findMany({select:{observationId:true}})];const proxyClaims=await tx.contractProxyBankClaim.findMany({where:{observationId:{in:observations.map(o=>o.id)}}});
  return {canPrepare:true,canReview:roles.includes("finance_director"),observations:observations.filter(o=>![...claims,...proxyClaims,...otherClaims].some(c=>c.observationId===o.id)).map(o=>({value:o.id,label:`${o.holderNameSnapshot} · ${o.direction==="inflow"?"入账":"出账"} · ${o.amountCents/100n}.${(o.amountCents%100n).toString().padStart(2,"0")} 元 · ${o.occurredAt.toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})}`})),requests:requests.map(r=>({id:r.id,label:r.code,sourceRef:`settlement:${r.settlementId}`,remainingCents:((r.approvedAmountCents??r.requestedAmountCents)-r.paidAmountCents).toString()})),sources:[...normal.map(s=>({value:`settlement:${s.id}`,label:`表内/原结算 · ${s.code}`})),...external.map(s=>({value:`affiliate_settlement:${s.ledgerId}`,label:`表外结算 · ${s.periodLabel}`}))],payers:payers.map(p=>({value:payerKey(p),label:p.name})),entries:entries.map(r=>({...r,amountCents:r.amountCents.toString(),canConfirm:r.status==="pending_confirm"&&r.recordedByUserId!==actor&&roles.includes("finance_director")}))};
 });}
 async prepare(actor:string,input:PrepareProxyExecution){
  if(!input||typeof input.projectId!=="string"||typeof input.sourceRef!=="string"||typeof input.evidenceFileId!=="string"||typeof input.actualPayerKey!=="string"||typeof input.reason!=="string"||!input.reason.trim()||input.reason.length>2000||typeof input.bankReference!=="string"||!input.bankReference.trim()||input.bankReference.length>160||typeof input.idempotencyKey!=="string"||!input.idempotencyKey.trim()||!["payment","refund","repayment"].includes(input.entryKind))throw new BadRequestException("请完整填写代付、退款或归还依据与银行流水");
  const amount=money(input.amountCents,"实际金额");if(amount<=0n)throw new BadRequestException("实际金额须大于零");
  const occurredAt=new Date(input.occurredAt);if(Number.isNaN(occurredAt.getTime())||occurredAt>new Date())throw new BadRequestException("实际收付日期无效或晚于当前时间");
  await this.auth.confirmPassword(actor,input.confirmationPassword);
  const fingerprint=createHash("sha256").update(JSON.stringify({...input,confirmationPassword:undefined,actor})).digest("hex");
  return this.prisma.$transaction(async tx=>{
   await this.authorize(tx,actor,input.projectId);await lockEconomicProject(tx,input.projectId);
   const replay=await tx.contractProxyExecution.findUnique({where:{idempotencyKey:input.idempotencyKey}});
   if(replay){if(replay.requestFingerprint!==fingerprint||replay.recordedByUserId!==actor)throw new ConflictException("操作凭据已用于其他付款事实");return {id:replay.id,status:replay.status};}
   let source:ProxySource;
   let sourceRef=input.sourceRef;
   let requestId=input.paymentRequestId?.trim()||null;
   if(input.entryKind==="payment"){
    if(input.originalId)throw new BadRequestException("新的代付不能伪装成原款更正");
    const debt=await loadProxyDebt(tx,input.projectId,sourceRef);
    const payer=(await proxyPayers(tx,input.projectId,occurredAt)).find(p=>payerKey(p)===input.actualPayerKey);
    if(!payer||payerKey(payer)===payerKey(debt.source.debtor))throw new BadRequestException("请选择与原债务人不同且在付款日期有效的实际出款主体；自付使用原付款入口");
    if(!input.allocations&&amount>debt.amountCents-debt.paidCents)throw new ConflictException("代付超过原结算未清余额");
    source={...debt.source,actualPayer:payer};
    if(input.allocations){
     const parts=normalizeProxyAllocations(input.allocations,amount);
     if(!parts.some(p=>p.sourceRef===sourceRef))throw new BadRequestException("首笔结算必须包含在本次核销分配中");
     const allocations=[];
     for(const part of parts){
      const item=await loadProxyDebt(tx,input.projectId,part.sourceRef);
      if(payerKey(item.source.debtor)!==payerKey(source.debtor)||payerKey(item.source.payee)!==payerKey(source.payee)||item.source.contractRelationship!==source.contractRelationship)throw new BadRequestException("一笔银行代付的多笔核销须属于同一债务主体及真实收款方；不同出款不得合并");
      if(BigInt(part.amountCents)>item.amountCents-item.paidCents)throw new ConflictException("分配金额超过该笔结算未清余额");
      allocations.push({...part,reference:item.source.reference});
     }
     source={...source,allocations,sourceRefs:allocations.map(a=>a.sourceRef),reference:allocations.map(a=>a.reference).join("、")};
    }
    if(requestId){
     if(source.allocations&&source.allocations.length>1)throw new BadRequestException("单笔付款审批只能执行其批准结算，多笔已发生代付须逐项说明依据");
     const request=await tx.paymentRequest.findFirst({where:{id:requestId,projectId:input.projectId,status:{in:["approved_pending_payment","partially_paid"]}}});
     if(!request||sourceRef!==`settlement:${request.settlementId}`||amount>(request.approvedAmountCents??request.requestedAmountCents)-request.paidAmountCents)throw new ConflictException("付款申请未批准、与原结算不符或超过尚未实付额度");
     if(request.paymentSubjectType==="affiliate")source.approvedPayer={kind:"construction_enterprise",id:source.affiliate.businessPartyVersionId,name:source.affiliate.name};
     else {const version=await tx.contractVersion.findUniqueOrThrow({where:{id:request.contractVersionId}});if(!version.companyEntityIdSnapshot||!version.companyEntityNameSnapshot)throw new ConflictException("批准付款公司缺少冻结身份");source.approvedPayer={kind:"participating_company",id:version.companyEntityIdSnapshot,name:version.companyEntityNameSnapshot};}
    }
   }else{
    const original=await tx.contractProxyExecution.findFirst({where:{id:input.originalId,projectId:input.projectId,status:"confirmed",entryKind:"payment"}});
    if(!original)throw new BadRequestException("退款或归还须关联原已确认代付款");
    if(businessDay(occurredAt)<businessDay(original.occurredAt))throw new BadRequestException("退款或归还日期不能早于原代付日期");
    source=original.frozenSource as unknown as ProxySource;sourceRef=original.sourceRef;requestId=original.paymentRequestId;
    if(input.entryKind==="repayment"){if(source.debtor.kind==="participating_company"&&source.actualPayer.kind==="participating_company")throw new BadRequestException("公司间归还请通过公司互转申请，由董事长或总经理终审后执行");}
    await this.assertReturnCapacity(tx,original.id,original.amountCents,amount);
    if(source.allocations){
     const parts=normalizeProxyAllocations(input.allocations,amount);
     const returns=await tx.contractProxyExecution.findMany({where:{originalId:original.id,status:"confirmed"}});
     const allocations=parts.map(part=>{
      const originalPart=source.allocations!.find(a=>a.sourceRef===part.sourceRef);
      const used=returns.reduce((sum,r)=>sum+allocatedProxyAmount(r,part.sourceRef),0n);
      if(!originalPart||BigInt(part.amountCents)+used>BigInt(originalPart.amountCents))throw new ConflictException("退款或归还分项超过原款该笔核销的未清金额");
      return {...part,reference:originalPart.reference};
     });
     source={...source,allocations,sourceRefs:allocations.map(a=>a.sourceRef)};
    }
   }
   await acquireFileBusinessBindingTransactionLock(tx);
   const observation=await validateProxyBank(tx,source,input.entryKind,amount,occurredAt,input.bankObservationId,input.projectId);
   const receivingObservation=await validateProxyReceivingBank(tx,source,input.entryKind,amount,occurredAt,input.receivingBankObservationId,input.projectId);
   const file=await tx.fileObject.findUnique({where:{id:input.evidenceFileId}});
   if(!file||file.uploadedByUserId!==actor||file.storageStatus!=="active"||!file.contentSha256||await hasNonReceiptBusinessFileBinding(tx,[file.id]))throw new BadRequestException("请使用本人上传、有效且未重复绑定的付款凭证");
   const actualKey=input.entryKind==="repayment"?payerKey(source.debtor):input.entryKind==="refund"?payerKey(source.payee):payerKey(source.actualPayer);
   const row=await tx.contractProxyExecution.create({data:{projectId:input.projectId,sourceRef,entryKind:input.entryKind,originalId:input.originalId??null,amountCents:amount,occurredAt:observation?.occurredAt??occurredAt,bankObservationId:observation?.id??null,receivingBankObservationId:receivingObservation?.id??null,actualPayerKey:actualKey,bankReference:input.bankReference.trim(),evidenceFileId:file.id,evidenceSha256:file.contentSha256,reason:input.reason.trim(),paymentRequestId:requestId,frozenSource:JSON.parse(JSON.stringify(source)),recordedByUserId:actor,idempotencyKey:input.idempotencyKey,requestFingerprint:fingerprint}});
   await this.audit.record(tx,{actorUserId:actor,action:"contract.proxy_execution.prepare",businessType:"contract_proxy_execution",businessId:row.id,metadata:{projectId:input.projectId,entryKind:input.entryKind,postFactException:!requestId}});
   return {id:row.id,status:row.status};
  });
 }
 private async assertReturnCapacity(tx:Prisma.TransactionClient,id:string,original:bigint,amount:bigint){
  const used=await tx.contractProxyExecution.aggregate({where:{originalId:id,status:"confirmed"},_sum:{amountCents:true}});
  if((used._sum.amountCents??0n)+amount+await companyTransferReservedProxy(tx,id)>original)throw new ConflictException("退款或归还超过原代付尚未结清余额，须先核对已归还款项");
 }
 async decide(actor:string,id:string,input:{decision:"confirm"|"return";confirmationPassword:string}){
  if(!input||!["confirm","return"].includes(input.decision))throw new BadRequestException("处理动作不正确");
  await this.auth.confirmPassword(actor,input.confirmationPassword);
  return this.prisma.$transaction(async tx=>{
   const initial=await tx.contractProxyExecution.findUnique({where:{id}});if(!initial)throw new NotFoundException("代付记录不存在");
   await this.authorize(tx,actor,initial.projectId,true);await this.funding.lockFundingContext(tx,initial.projectId);
   const row=await tx.contractProxyExecution.findUniqueOrThrow({where:{id}});
   if(row.status==="confirmed"&&input.decision==="confirm"&&row.confirmedByUserId===actor)return {id:row.id,status:row.status};
   if(row.status!=="pending_confirm")throw new ConflictException("该记录已处理，请刷新核对");
   if(row.recordedByUserId===actor)throw new ForbiddenException("代付经办人与财务确认人必须分离");
   if(input.decision==="return"){
    await tx.contractProxyExecution.update({where:{id},data:{status:"returned"}});
    await this.audit.record(tx,{actorUserId:actor,action:"contract.proxy_execution.return",businessType:"contract_proxy_execution",businessId:id,metadata:{projectId:row.projectId}});
    return {id,status:"returned"};
   }
   const source=row.frozenSource as unknown as ProxySource;
   if(row.entryKind==="repayment"){if(source.debtor.kind==="participating_company"&&source.actualPayer.kind==="participating_company")throw new BadRequestException("公司间归还请通过公司互转申请，由董事长或总经理终审后执行");}
   if(row.entryKind==="payment"){
    for(const part of source.allocations??[{sourceRef:row.sourceRef,amountCents:row.amountCents.toString()}]){
     const debt=await loadProxyDebt(tx,row.projectId,part.sourceRef);
     if(payerKey(debt.source.debtor)!==payerKey(source.debtor)||payerKey(debt.source.payee)!==payerKey(source.payee)||debt.source.contractRelationship!==source.contractRelationship||BigInt(part.amountCents)>debt.amountCents-debt.paidCents)throw new ConflictException("原结算余额或债务主体已变化，不能重复核销");
    }
   }else{
    const original=await tx.contractProxyExecution.findUniqueOrThrow({where:{id:row.originalId!}});
    if(row.occurredAt<original.occurredAt)throw new ConflictException("退款或归还日期不能早于原代付日期");
    await this.assertReturnCapacity(tx,original.id,original.amountCents,row.amountCents);
    if(source.allocations){
     const returns=await tx.contractProxyExecution.findMany({where:{originalId:original.id,status:"confirmed"}});
     for(const part of source.allocations)if(BigInt(part.amountCents)+returns.reduce((sum,r)=>sum+allocatedProxyAmount(r,part.sourceRef),0n)>allocatedProxyAmount(original,part.sourceRef))throw new ConflictException("该结算对应代付款已退回或归还，不能重复清偿");
    }
   }
   await acquireFileBusinessBindingTransactionLock(tx);
   const file=await tx.fileObject.findUnique({where:{id:row.evidenceFileId}});
   if(file?.storageStatus!=="active"||file.contentSha256!==row.evidenceSha256)throw new ConflictException("付款凭证已变化，不能确认");
   const observation=await validateProxyBank(tx,source,row.entryKind,row.amountCents,row.occurredAt,row.bankObservationId,row.projectId);
   const receivingObservation=await validateProxyReceivingBank(tx,source,row.entryKind,row.amountCents,row.occurredAt,row.receivingBankObservationId,row.projectId);
   if(receivingObservation)await tx.contractProxyBankClaim.create({data:{observationId:receivingObservation.id,proxyExecutionId:row.id}});
   if(observation)await tx.contractProxyBankClaim.create({data:{observationId:observation.id,proxyExecutionId:row.id}});
   const confirmedAt = new Date();
   const signature=await snapshotApprovalSignature(tx,actor,{required:true});
   if(row.paymentRequestId&&row.entryKind!=="repayment"){
    const request=await tx.paymentRequest.findUniqueOrThrow({where:{id:row.paymentRequestId}});
    const paid=request.paidAmountCents+(row.entryKind==="refund"?-row.amountCents:row.amountCents);
    const approved=request.approvedAmountCents??request.requestedAmountCents;
    if(paid<0n||paid>approved||!["approved_pending_payment","partially_paid","paid"].includes(request.status))throw new ConflictException("付款申请额度或状态已变化");
    await tx.paymentRequest.update({where:{id:request.id},data:{paidAmountCents:paid,status:paid>=approved?"paid":paid>0n?"partially_paid":"approved_pending_payment"}});
   }
   if(row.entryKind==="payment"&&source.actualPayer.kind==="participating_company")await this.funding.allocateExecution(tx,{projectId:row.projectId,executionType:"contract_proxy_execution",executionId:row.id,businessType:"contract_proxy_execution",businessId:row.id,amountCents:row.amountCents,occurredAt:row.occurredAt,actorUserId:actor});
   if(row.entryKind==="repayment"&&source.debtor.kind==="participating_company"&&source.actualPayer.kind==="construction_enterprise")await this.funding.allocateExecution(tx,{projectId:row.projectId,executionType:"contract_proxy_execution",executionId:row.id,businessType:"contract_proxy_execution",businessId:row.id,amountCents:row.amountCents,occurredAt:row.occurredAt,actorUserId:actor});
   if(row.entryKind==="refund"&&source.actualPayer.kind==="participating_company")await this.funding.reverseExecution(tx,{projectId:row.projectId,executionType:"contract_proxy_execution",executionId:row.originalId!,amountCents:row.amountCents,occurredAt:row.occurredAt,reversalKey:row.id,reason:row.reason,actorUserId:actor});
   const confirmed=await tx.contractProxyExecution.update({where:{id},data:{status:"confirmed",confirmedByUserId:actor,confirmedAt,confirmationSignatureVersionId:signature.versionId}});
   await this.sources.appendConfirmedSourceIfEnabledInTransaction(tx,{projectId:row.projectId,sourceType:"contract_proxy_execution",sourceBusinessId:row.id},actor);
   if (signature) await recordIndependentApproval(tx, { businessType: "contract_proxy_execution", businessId: id, applicantUserId: row.recordedByUserId, actorUserId: actor,
     roleKey: "finance_director", nodeName: "财务主管", signedAt: confirmedAt, form: await ledgerApprovalFacts(tx, "contract_proxy_execution", id) });
   await this.audit.record(tx,{actorUserId:actor,action:"contract.proxy_execution.confirm",businessType:"contract_proxy_execution",businessId:id,metadata:{projectId:row.projectId,entryKind:row.entryKind,amountCents:row.amountCents.toString()}});
   return {id,status:confirmed.status};
  },{timeout:30000});
 }
}

export function normalizeProxyAllocations(value:unknown,total:bigint){
 if(!Array.isArray(value)||!value.length||value.length>50)throw new BadRequestException("请明确本次真实款项核销的结算及金额，最多50笔");
 const seen=new Set<string>();
 const rows=value.map(raw=>{
  if(!raw||typeof raw!=="object"||typeof raw.sourceRef!=="string"||! /^(settlement|affiliate_settlement):[^:]+$/u.test(raw.sourceRef)||seen.has(raw.sourceRef))throw new BadRequestException("核销结算不能缺失或重复");
  seen.add(raw.sourceRef);
  const amount=money(raw.amountCents,"核销金额");if(amount<=0n)throw new BadRequestException("核销分配金额必须大于零");
  return {sourceRef:raw.sourceRef as string,amountCents:amount.toString()};
 }).sort((a,b)=>a.sourceRef.localeCompare(b.sourceRef));
 if(rows.reduce((sum,r)=>sum+BigInt(r.amountCents),0n)!==total)throw new BadRequestException("核销分配合计必须等于本次真实收付金额");
 return rows;
}
