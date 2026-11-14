import { assertNotDirectPendingSource } from "../contract/contract-direct-pending-policy";
import { hasDirectSigningInput } from "../contract/contract-direct-pending-source";
import { recordIndependentApproval, invalidateIndependentApproval } from "../approval/independent-approval-evidence";
import { ledgerApprovalFacts } from "../approval/ledger-approval-facts";
import { normalizeEconomicScope } from "./contract-economic-scope";
import { assertSettledScopesPreserved, economicScopeOptions, normalizeSettlementAllocations } from "./contract-economic-settlement";
import { OperatingSourceReplayService } from "../operating-ledger/operating-source-replay.service";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import type { RoleKey } from "@jiangkong/shared-domain";
import { PrismaService } from "../database/prisma.service";
import { ProjectVisibilityService } from "../auth/project-visibility.service";
import { AuthService } from "../auth/auth.service";
import { AuditService } from "../audit/audit.service";
import { documentFingerprint, economicDocuments, economicDocumentYuan, excludedAmount, excludedAmountYuan, latestEconomicReviews, lockEconomicProject, normalizeCoverage, suspectedOverlap } from "./contract-economic-coverage";

import { CONTRACT_ECONOMIC_REVIEW_PREPARER_ROLES as PREPARERS, CONTRACT_ECONOMIC_REVIEW_READER_ROLES as READERS } from "./contract-economic-review-access";
import { assertDirectReviewContinuity, assertDirectReviewQualification } from "./contract-direct-review-qualification";
import { unresolvedDirectReviewPairs } from "./contract-direct-review-overlap";
import { directReviewPins, hasFrozenDirectReview, lockDirectReviewFiles, readDirectReviewDocuments, readDirectReviewHistory, readProjectDirectReviewDocuments, readStoredDirectReviewPins, rethrowDirectReviewFileContention, reviewDocumentFingerprint, stripInternalDirectReviewProof } from "./contract-direct-review-source";

function presentReview<T extends { frozenSources: Prisma.JsonValue | null }>(row: T) {
  const projected: T & { directSourcePins?: unknown } = { ...row };
  delete projected.directSourcePins;
  return { ...projected, frozenSources: stripInternalDirectReviewProof(row.frozenSources) };
}
export interface PrepareEconomicReview {
 targetSourceRef?:string; supersedesReviewId?: string; projectId: string; leftSourceRef: string; rightSourceRef: string; relation: string;
 coverage: unknown; reason: string; idempotencyKey: string; confirmationPassword: string; expectedDirectSources?: unknown;
}
@Injectable()
export class ContractEconomicReviewService {
 constructor(private readonly prisma: PrismaService, private readonly visibility: ProjectVisibilityService, private readonly auth: AuthService, private readonly audit: AuditService, private readonly operatingSources: OperatingSourceReplayService) {}
 private async authorize(tx: Prisma.TransactionClient, actor: string, projectId: string, allowed: readonly RoleKey[]) {
   const visible = await this.visibility.visibleProjectIdsInTransaction(tx, actor);
   if (!visible.includes(projectId)) throw new ForbiddenException("当前账号无权办理该项目履约复核");
   const roles = (await this.visibility.effectiveRoleKeysByProjectInTransaction(tx,actor,[projectId])).get(projectId) ?? [];
   if (!roles.some(r=>allowed.includes(r))) throw new ForbiddenException("当前岗位没有履约复核权限");
   return roles;
 }
 async counterparties(actor:string,projectId:string){return this.prisma.$transaction(async tx=>{
   await this.authorize(tx,actor,projectId,READERS);
   const parties=await tx.businessParty.findMany({where:{status:"active"}});
   const versions=await tx.businessPartyVersion.findMany({where:{businessPartyId:{in:parties.map(p=>p.id)}},orderBy:{versionNo:"desc"}});
   const companies=await tx.companyEntityVersion.findMany({select:{name:true,unifiedSocialCreditCode:true}});
   return parties.filter(p=>!companies.some(c=>c.name===p.name||(p.unifiedSocialCreditCode&&c.unifiedSocialCreditCode===p.unifiedSocialCreditCode))).flatMap(p=>{
    const v=versions.find(v=>v.businessPartyId===p.id),snapshot=v?.snapshot as Record<string,unknown>|undefined;
    return v&&typeof snapshot?.name==="string"?[{value:v.id,label:snapshot.name}]:[];
   });
 });}
 async list(actor: string, projectId: string) {
   if (!projectId) throw new BadRequestException("请选择所属项目");
   return this.prisma.$transaction(async tx=>{
     const roles=await this.authorize(tx,actor,projectId,READERS);
     const documents=await economicDocuments(tx,projectId);
     const reviews=await tx.contractEconomicReview.findMany({where:{projectId},orderBy:{createdAt:"desc"}});
     const candidates: Array<{leftSourceRef:string;rightSourceRef:string;reason:string}> = [];
     for(let i=0;i<documents.length;i++) for(let j=i+1;j<documents.length;j++) {
       const a=documents[i],b=documents[j];
       const pair = [a.ref,b.ref].sort();
       const resolved = reviews.some(r=>r.status==="confirmed"&&r.leftSourceRef===pair[0]&&r.rightSourceRef===pair[1]&&r.leftFingerprint===documentFingerprint(documents.find(d=>d.ref===pair[0])!)&&r.rightFingerprint===documentFingerprint(documents.find(d=>d.ref===pair[1])!));
       if (suspectedOverlap(a,b) && !resolved) candidates.push({leftSourceRef:a.ref,rightSourceRef:b.ref,reason:"相同相对方及相近合同资料，须核对履约分项"});
     }
     const pending = await tx.settlement.findMany({where:{projectId,status:"pending_archive_confirm"},select:{id:true,contractId:true,contractVersionId:true,code:true,amountCents:true}});
     const pendingExternal=await tx.projectAffiliateSettlementFact.findMany({where:{projectId,status:"pending_confirm",affiliateCompanyContractId:null},select:{id:true,contractLedgerId:true,periodLabel:true,amountCents:true,effectDirection:true}});
     const pendingSettlements=[];
     for(const row of [...pending.map(r=>({ref:`settlement:${r.id}`,contractRef:`contract:${r.contractId}`,targetVersionId:r.contractVersionId,label:r.code,amountCents:r.amountCents.toString()})),...pendingExternal.map(r=>({ref:`affiliate_settlement:${r.id}`,contractRef:`affiliate:${r.contractLedgerId}`,targetVersionId:undefined,label:r.periodLabel,amountCents:(r.effectDirection==="decrease"?-r.amountCents:r.amountCents).toString()}))]){
       const selected=await economicDocuments(tx,projectId,{targetRef:row.contractRef,targetVersionId:row.targetVersionId});
       const doc=selected.find(d=>d.ref===row.contractRef);if(!doc)continue;
       const valid=reviews.filter(r=>r.status==="confirmed"&&(r.leftSourceRef===doc.ref?r.leftFingerprint===documentFingerprint(doc):r.rightSourceRef===doc.ref&&r.rightFingerprint===documentFingerprint(doc)));
       const options=economicScopeOptions(doc,valid);
       if(options)pendingSettlements.push({...row,scopes:options.scopes.map(s=>({...s,capacityCents:s.capacityCents?.toString()??null}))});
     }
     const historical=reviews.filter(review=>review.status==="confirmed"&&hasFrozenDirectReview(review));
     if (historical.length) await assertDirectReviewQualification(tx,"read");
     const directHistory=await readDirectReviewHistory(tx,projectId,historical);
     const directSources = await readProjectDirectReviewDocuments(tx, projectId);
     const directCandidates = directSources && {
       directCandidateSourceStatus: directSources.status,
       directCandidates: directSources.status === "unavailable" ? null
         : (await unresolvedDirectReviewPairs(tx, projectId, directSources.documents, documents, reviews, new Date()))
           .filter(pair => pair.suspected)
           .map(({ leftSourceRef, rightSourceRef }) => ({ leftSourceRef, rightSourceRef, reason: "相同相对方及相近合同资料，须核对履约分项" }))
     };
     return {pendingSettlements,...directCandidates,documents:documents.map(d=>({...d,amountCents:d.amountCents?.toString()??null,settledCents:d.settledCents.toString()})),
       reviews:reviews.map(r=>({...presentReview(r),...(directHistory.has(r.id)?{directEvidence:directHistory.get(r.id)}:{}),canContractReview:r.status==="pending_review"&&r.preparedByUserId!==actor&&roles.includes("contract_director"),
         canFinanceReview:r.status==="pending_finance"&&r.preparedByUserId!==actor&&r.contractReviewedById!==actor&&roles.includes("finance_director")})),
       canReview:roles.some(r=>["contract_director","finance_director"].includes(r)),candidates,canPrepare:roles.some(r=>PREPARERS.includes(r))};
   },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
 }
 async prepareSettlement(actor:string,input:{projectId:string;sourceRef:string;allocations:unknown;confirmationPassword:string}) {
   if(!input||typeof input.projectId!=="string"||typeof input.sourceRef!=="string")throw new BadRequestException("请选择本次结算");
   await this.auth.confirmPassword(actor,input.confirmationPassword);
   return this.prisma.$transaction(async tx=>{
     await this.authorize(tx,actor,input.projectId,PREPARERS);
     await lockEconomicProject(tx,input.projectId);
     const [kind,id]=input.sourceRef.split(":");
     const normal=kind==="settlement"?await tx.settlement.findFirst({where:{id,projectId:input.projectId,status:"pending_archive_confirm"}}):null;
     const external=kind==="affiliate_settlement"?await tx.projectAffiliateSettlementFact.findFirst({where:{id,projectId:input.projectId,status:"pending_confirm",affiliateCompanyContractId:null}}):null;
     if(!normal&&!external)throw new BadRequestException("当前结算不存在或已正式确认，不能修改履约分配");
     const ref=normal?`contract:${normal.contractId}`:`affiliate:${external!.contractLedgerId}`;
     const amount=normal?normal.amountCents:external!.effectDirection==="decrease"?-external!.amountCents:external!.amountCents;
     const documents=await economicDocuments(tx,input.projectId,{targetRef:ref,targetVersionId:normal?.contractVersionId});
     const doc=documents.find(d=>d.ref===ref);
     if(!doc)throw new BadRequestException("结算原合同不可用");
     const reviews=await tx.contractEconomicReview.findMany({where:{projectId:input.projectId,status:"confirmed",OR:[{leftSourceRef:ref},{rightSourceRef:ref}]}});
     const options=economicScopeOptions(doc,reviews.filter(r=>r.leftSourceRef===doc.ref?r.leftFingerprint===documentFingerprint(doc):r.rightFingerprint===documentFingerprint(doc)));if(!options)throw new BadRequestException("该合同没有需分配的重叠履约分项");
     const allocations=normalizeSettlementAllocations(input.allocations,options,amount);
     const data={projectId:input.projectId,sourceRef:input.sourceRef,contractRef:ref,amountCents:amount,reviewFingerprint:options.fingerprint,allocations:allocations as Prisma.InputJsonValue,preparedByUserId:actor};
     const row=await tx.contractEconomicSettlementCoverage.upsert({where:{sourceRef:input.sourceRef},create:data,update:data});
     await this.audit.record(tx,{actorUserId:actor,action:"contract.economic_settlement.prepare",businessType:"contract_economic_settlement",businessId:row.id,metadata:{projectId:input.projectId,sourceRef:input.sourceRef}});
     return {id:row.id,status:row.status};
   });
 }
 async prepare(actor:string,input:PrepareEconomicReview) {
   if (!input||typeof input.projectId!=="string"||typeof input.leftSourceRef!=="string"||typeof input.rightSourceRef!=="string"||typeof input.reason!=="string"||typeof input.idempotencyKey!=="string")throw new BadRequestException("履约复核资料格式不正确");
   if (!input.reason?.trim() || input.reason.length>2000 || !input.idempotencyKey?.trim()) throw new BadRequestException("请填写履约关系说明及本次操作凭据");
   await this.auth.confirmPassword(actor,input.confirmationPassword);
   const result=await this.prisma.$transaction(async tx=>{
     await this.authorize(tx,actor,input.projectId,PREPARERS);
     await lockEconomicProject(tx,input.projectId);
     let documents=await economicDocuments(tx,input.projectId);
     const refs=[input.leftSourceRef,input.rightSourceRef].sort();
     const pins=directReviewPins(input.expectedDirectSources,refs);
     const qualification=pins.length ? await assertDirectReviewQualification(tx) : null;
     const directDocuments=await readDirectReviewDocuments(tx,input.projectId,pins);
     const pendingTargets=documents.filter(d=>refs.includes(d.ref)&&!d.formal&&d.hasFormalHistory);
     if(input.targetSourceRef&&!refs.includes(input.targetSourceRef))throw new BadRequestException("本次生效目标须为所选两份文书之一");
     if(pendingTargets.length>1&&!input.targetSourceRef)throw new BadRequestException("两份文书均有待生效变更，请选择本次先确认的文书；另一份按当前有效版本复核");
     const target=pendingTargets.find(d=>d.ref===input.targetSourceRef)??(!input.targetSourceRef?pendingTargets[0]:undefined);
     if(input.targetSourceRef&&!target)throw new ConflictException("所选生效目标已经变化，请刷新文书后核对");
     if(target)documents=await economicDocuments(tx,input.projectId,{targetRef:target.ref,targetVersionId:target.targetVersionId});
     if(refs[0]===refs[1]) throw new BadRequestException("请选择两份不同的原文书");
     const available=[...directDocuments,...documents];
     const left=available.find(d=>d.ref===refs[0]),right=available.find(d=>d.ref===refs[1]);
     if(!left||!right) throw new NotFoundException("所选文书不存在或不属于该项目");
     for (const document of [left,right]) if (!("directSourcePin" in document) && document.ref.startsWith("contract:") && document.targetVersionId) await assertNotDirectPendingSource(tx, document.targetVersionId);
     // 输入左右顺序必须与页面顺序一致，排序后同步交换覆盖数据和归属。
     const raw=input.leftSourceRef===refs[0]?input.coverage:Array.isArray(input.coverage)?input.coverage.map(r=>({...r,leftAmountCents:r.rightAmountCents,rightAmountCents:r.leftAmountCents,leftAmountYuan:r.rightAmountYuan,rightAmountYuan:r.leftAmountYuan,owner:r.owner==="left"?"right":"left"})):input.coverage;
     const coverage=normalizeCoverage(raw,input.relation,left,right);
     const canonical={targetSourceRef:target?.ref??null,targetVersionId:target?.targetVersionId??null,supersedesReviewId:input.supersedesReviewId??null,projectId:input.projectId,leftSourceRef:refs[0],rightSourceRef:refs[1],relation:input.relation,coverage,reason:input.reason.trim(),leftFingerprint:reviewDocumentFingerprint(left),rightFingerprint:reviewDocumentFingerprint(right)};
     const fingerprint=createHash("sha256").update(JSON.stringify(pins.length ? { ...canonical, directSourcePins: pins } : canonical)).digest("hex");
     const replay=await tx.contractEconomicReview.findUnique({where:{idempotencyKey:input.idempotencyKey}});
     if(replay){if(replay.preparedByUserId!==actor||replay.requestFingerprint!==fingerprint)throw new ConflictException("本次凭据已用于其他履约复核");return presentReview(replay);}
     const existing=await tx.contractEconomicReview.findFirst({where:{projectId:input.projectId,leftSourceRef:refs[0],rightSourceRef:refs[1],leftFingerprint:canonical.leftFingerprint,rightFingerprint:canonical.rightFingerprint,status:{in:["pending_review","pending_finance"]}}});
     if(existing)throw new ConflictException("同一版本文书已存在履约复核，请打开原记录继续办理");
     const previous=await tx.contractEconomicReview.findFirst({where:{projectId:input.projectId,leftSourceRef:refs[0],rightSourceRef:refs[1],status:"confirmed"},orderBy:{confirmedAt:"desc"}});
     if(previous && input.supersedesReviewId!==previous.id)throw new ConflictException("该对文书已有确认复核，请从原复核发起追加更正，保留前后依据");
     if(!previous && input.supersedesReviewId)throw new ConflictException("更正所依据的原复核不存在");
     const financeRequired=coverage.length>0&&(left.formal||right.formal||left.hasFormalHistory||right.hasFormalHistory||left.settledCents>0n||right.settledCents>0n);
     if (qualification && (financeRequired || (pins.length===1 && coverage.length>0))) throw new ConflictException("该复核涉及混合来源的金额分配，当前暂不能办理");
     const row=qualification ? await (async () => {
       const id=randomUUID();
       await assertDirectReviewContinuity(tx,qualification);
       const result=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`
         INSERT INTO public."ContractEconomicReview"
           ("id","projectId","leftSourceRef","rightSourceRef","leftFingerprint","rightFingerprint","relation","coverage","reason",
            "preparedByUserId","idempotencyKey","requestFingerprint","targetSourceRef","targetVersionId","supersedesReviewId","financeRequired","directSourcePins")
         VALUES (${id},${input.projectId},${refs[0]},${refs[1]},${canonical.leftFingerprint},${canonical.rightFingerprint},${input.relation},
           ${JSON.stringify(coverage)}::jsonb,${canonical.reason},${actor},${input.idempotencyKey},${fingerprint},
           ${canonical.targetSourceRef},${canonical.targetVersionId},${canonical.supersedesReviewId},${financeRequired},${JSON.stringify(pins)}::jsonb)
         RETURNING "id"
       `);
       if(result.length!==1||result[0]?.id!==id) throw new ConflictException("直签复核未取得实际保存记录，请刷新后核对");
       return tx.contractEconomicReview.findUniqueOrThrow({where:{id}});
     })() : await tx.contractEconomicReview.create({data:{...canonical,coverage:coverage as unknown as Prisma.InputJsonValue,
       preparedByUserId:actor,idempotencyKey:input.idempotencyKey,requestFingerprint:fingerprint,financeRequired}});
     await this.audit.record(tx,{actorUserId:actor,action:"contract.economic_review.prepare",businessType:"contract_economic_review",businessId:row.id,metadata:{projectId:input.projectId,relation:row.relation}});
     if (qualification) await assertDirectReviewContinuity(tx,qualification);
     return presentReview(row);
   });
   if (input.expectedDirectSources!==undefined) {
     const persisted=await this.prisma.contractEconomicReview.findUnique({where:{id:result.id}});
     if (!persisted || persisted.projectId!==input.projectId || persisted.preparedByUserId!==actor ||
       persisted.idempotencyKey!==input.idempotencyKey || persisted.requestFingerprint!==result.requestFingerprint) {
       throw new ServiceUnavailableException("履约复核保存结果尚未完整核对，请保留原办理凭据");
     }
   }
   return result;
 }
 async decide(actor:string,id:string,input:{revision:number;decision:"confirm"|"return";reason?:string;confirmationPassword:string}) {
   if(!input||!Number.isInteger(input.revision)||input.revision<1||!["confirm","return"].includes(input.decision))throw new BadRequestException("复核动作或版本不正确");
   await this.auth.confirmPassword(actor,input.confirmationPassword);
   const outcome=await this.prisma.$transaction(async tx=>{
     const initial=await tx.contractEconomicReview.findUnique({where:{id}});if(!initial)throw new NotFoundException("履约复核不存在");
     await lockEconomicProject(tx,initial.projectId);
     const row=await tx.contractEconomicReview.findUniqueOrThrow({where:{id}});
     await this.authorize(tx,actor,row.projectId,row.status==="pending_finance"?["finance_director"]:["contract_director"]);
     if(row.revision!==input.revision||!["pending_review","pending_finance"].includes(row.status))throw new ConflictException("履约复核状态已变化，请刷新后继续");
     if(row.preparedByUserId===actor||row.contractReviewedById===actor)throw new ForbiddenException("经办人与必要复核人须分离");
     const refs=[row.leftSourceRef,row.rightSourceRef];
     const contractIds=refs.filter(ref=>ref.startsWith("contract:")).map(ref=>ref.slice("contract:".length));
     const contracts=contractIds.length ? await tx.contract.findMany({
       where:{id:{in:contractIds},projectId:row.projectId},select:{id:true}
     }) : [];
     const originals=contracts.length ? await tx.contractVersion.findMany({
       where:{contractId:{in:contracts.map(contract=>contract.id)},versionNo:1},
       select:{contractId:true,draftData:true}
     }) : [];
     const marked=originals.filter(source=>hasDirectSigningInput(source.draftData));
     const qualification=marked.length ? await assertDirectReviewQualification(tx) : null;
     const pins=qualification ? await readStoredDirectReviewPins(tx,id,refs) : [];
     if (marked.length!==pins.length||marked.some(source=>!pins.some(pin=>pin.sourceRef===`contract:${source.contractId}`))) {
       throw new ConflictException("履约复核未保存真实直签来源，请按当前资料重新发起");
     }
     if(input.decision==="return"){
       if(!input.reason?.trim())throw new BadRequestException("请填写退回原因");
       const returned=await tx.contractEconomicReview.update({where:{id},data:{status:"returned",returnedAt:new Date(),returnReason:input.reason.trim(),revision:{increment:1}}});
       await invalidateIndependentApproval(tx, { businessType: "contract_economic_review", businessId: id, actorUserId: actor, reason: input.reason.trim(), invalidatedAt: new Date() });
       await this.audit.record(tx,{actorUserId:actor,action:"contract.economic_review.return",businessType:"contract_economic_review",businessId:id,metadata:{projectId:row.projectId,reason:input.reason.trim()}});
       if (qualification) await assertDirectReviewContinuity(tx,qualification);
       return { review: presentReview(returned), direct: Boolean(qualification) };
     }
     let directDocuments=await readDirectReviewDocuments(tx,row.projectId,pins);
     if (qualification) {
       await lockDirectReviewFiles(tx,directDocuments);
       const refreshed=await readDirectReviewDocuments(tx,row.projectId,pins);
       if (refreshed.some((source,index)=>JSON.stringify(source.fileIds)!==JSON.stringify(directDocuments[index].fileIds))) {
         throw new ConflictException("原件范围已变化，请按当前资料重新核对");
       }
       directDocuments=refreshed;
       await assertDirectReviewContinuity(tx,qualification);
     }
     const documents=[...directDocuments,...await economicDocuments(tx,row.projectId,row.targetSourceRef?{targetRef:row.targetSourceRef,targetVersionId:row.targetVersionId??undefined}:undefined)];
     const left=documents.find(d=>d.ref===row.leftSourceRef),right=documents.find(d=>d.ref===row.rightSourceRef);
     if(!left||!right||reviewDocumentFingerprint(left)!==row.leftFingerprint||reviewDocumentFingerprint(right)!==row.rightFingerprint)throw new ConflictException("原文书已发生变化，请退回后按最新资料重新复核");
     const latest=await tx.contractEconomicReview.findFirst({where:{projectId:row.projectId,leftSourceRef:row.leftSourceRef,rightSourceRef:row.rightSourceRef,status:"confirmed"},orderBy:{confirmedAt:"desc"}});
     if((latest?.id??null)!==row.supersedesReviewId)throw new ConflictException("原履约复核已被更新，请退回后重新核对");
     const coverage=normalizeCoverage(row.coverage,row.relation,left,right);
     const numeric2=left.numericProtocolVersion===2||right.numericProtocolVersion===2;
     const Decimal=Prisma.Decimal.clone({precision:60});
     for(const d of [left,right]) {
       const prior=await tx.contractEconomicReview.findMany({where:{projectId:row.projectId,status:"confirmed",OR:[{leftSourceRef:d.ref},{rightSourceRef:d.ref}],NOT:{leftSourceRef:row.leftSourceRef,rightSourceRef:row.rightSourceRef}}});
       for(const previous of latestEconomicReviews(prior)) for(const oldLine of previous.coverage as unknown as import("./contract-economic-coverage").EconomicCoverage[]) for(const line of coverage) {
         if(normalizeEconomicScope(oldLine.scope)!==normalizeEconomicScope(line.scope))continue;
         const oldOwner=oldLine.owner==="left"?previous.leftSourceRef:previous.rightSourceRef;
         const newOwner=line.owner==="left"?row.leftSourceRef:row.rightSourceRef;
         if(oldOwner!==newOwner)throw new ConflictException("同一履约分项已有唯一归属，请关联原归属文书，不能多次分配或形成循环替代");
       }
       await assertSettledScopesPreserved(tx,d,[...latestEconomicReviews(prior),{...row,coverage,confirmedAt:new Date()}]);
       if(numeric2){
         const excluded=latestEconomicReviews(prior).reduce((sum,r)=>sum.plus(excludedAmountYuan(r,d.ref)),new Decimal(excludedAmountYuan({...row,coverage},d.ref)));
         const total=economicDocumentYuan(d);
         if(total!==null&&(excluded.gt(total)||new Decimal(d.settledCents.toString()).div(100).gt(new Decimal(total).minus(excluded))))throw new ConflictException("重叠部分已有确认结算或超出原金额；须先按原结算更正流程处理，不能直接冲掉成本或欠款");
         continue;
       }
       const excluded=excludedAmount({...row,coverage},d.ref)+latestEconomicReviews(prior).reduce((sum,r)=>sum+excludedAmount(r,d.ref),0n);
       if(d.amountCents!==null && (excluded>d.amountCents||d.settledCents>d.amountCents-excluded))throw new ConflictException("重叠部分已有确认结算或超出原金额；须先按原结算更正流程处理，不能直接冲掉成本或欠款");
     }
     const financeRequired=row.financeRequired||(coverage.length>0&&(left.formal||right.formal||left.hasFormalHistory||right.hasFormalHistory||left.settledCents>0n||right.settledCents>0n));
     if (qualification && (financeRequired || (pins.length===1 && coverage.length>0))) throw new ConflictException("该复核涉及混合来源的金额分配，当前暂不能办理");
     const finish=row.status==="pending_finance"||!financeRequired;
     const frozenSources=[];
     if(finish) for(const d of [left,right]) {
       const previous=await tx.contractEconomicReview.findMany({where:{projectId:row.projectId,leftSourceRef:row.leftSourceRef,rightSourceRef:row.rightSourceRef,status:"confirmed"},orderBy:{confirmedAt:"desc"}});
       const delta=numeric2?new Decimal(excludedAmountYuan(row,d.ref)).minus(previous[0]?excludedAmountYuan(previous[0],d.ref):"0.0000"):excludedAmount(row,d.ref)-(previous[0]?excludedAmount(previous[0],d.ref):0n);
       const nonzero=typeof delta==="bigint"?delta!==0n:!delta.isZero();
       let baseline=null;
       if(d.formal&&nonzero){
         const original=await tx.operatingFact.findFirst({where:{projectId:row.projectId,sourceType:d.ref.startsWith("contract:")?"contract_version":"project_affiliate_contract_fact",sourceBusinessId:d.version.split(":")[0]}});
         if(!original)throw new ConflictException("原合同承诺尚未完成经营接管，不能自动调整历史金额；请先核对该范围的基线");
         const epoch=await tx.project.findUniqueOrThrow({where:{id:row.projectId},select:{operatingLedgerEffectiveDate:true}});
         baseline={...(numeric2?{originalOperatingFactId:original.id,originalSourceType:original.sourceType,originalSourceBusinessId:original.sourceBusinessId,originalSourceVersion:original.sourceVersion,numericProtocolVersion:original.numericProtocolVersion,amountState:original.numericProtocolVersion===2&&original.amountYuan===null?"unknown":"known",amountCents:original.numericProtocolVersion===2?null:original.amountCents?.toString(),amountYuan:original.numericProtocolVersion===2?original.amountYuan?.toFixed(4)??null:null}:{}),operatingLedgerEffectiveDate:epoch.operatingLedgerEffectiveDate?.toISOString(),sourceSnapshot:original.sourceSnapshot,affiliateAssignmentId:original.affiliateAssignmentId,affiliateBusinessPartyVersionId:original.affiliateBusinessPartyVersionId,affiliateNameSnapshot:original.affiliateNameSnapshot,affiliateCreditCodeSnapshot:original.affiliateCreditCodeSnapshot,
           subjects:{debtor:{kind:original.debtorSubjectKind,id:original.debtorSubjectId},creditor:{kind:original.creditorSubjectKind,id:original.creditorSubjectId}}};
       }
       const frozen: import("./contract-economic-coverage").EconomicDocument &
         Partial<Pick<import("./contract-direct-review-source").DirectReviewDocument, "directSourcePin" | "fileIds">> = { ...d };
       delete frozen.directSourcePin;
       delete frozen.fileIds;
       frozenSources.push({...frozen,...(typeof delta==="bigint"?{excludedDeltaCents:delta.toString()}:{coverageNumericProtocolVersion:2 as const,excludedDeltaYuan:delta.toFixed(4)}),operatingBaseline:baseline});
     }
     const confirmedAt = new Date();
     const frozenJson=finish?JSON.stringify(frozenSources,(_key,value)=>typeof value==="bigint"?value.toString():value):null;
     let updated;
     if (qualification) {
       const result=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`
         UPDATE public."ContractEconomicReview"
         SET "status"='confirmed',"revision"="revision"+1,"contractReviewedById"=${actor},"confirmedAt"=${confirmedAt},"frozenSources"=${frozenJson}::jsonb
         WHERE "id"=${id} AND "revision"=${row.revision} AND "status"='pending_review'
         RETURNING "id"
       `).catch(rethrowDirectReviewFileContention);
       if(result.length!==1||result[0]?.id!==id)throw new ConflictException("履约复核状态已变化，请刷新后继续");
       updated=await tx.contractEconomicReview.findUniqueOrThrow({where:{id}});
     } else {
       updated=await tx.contractEconomicReview.update({where:{id},data:{financeRequired,revision:{increment:1},status:finish?"confirmed":"pending_finance",
         ...(row.status==="pending_review"?{contractReviewedById:actor}:{financeReviewedById:actor}),
         ...(frozenJson!==null?{confirmedAt,frozenSources:JSON.parse(frozenJson)}:{} )}});
     }
     await recordIndependentApproval(tx, { businessType: "contract_economic_review", businessId: id, applicantUserId: row.preparedByUserId, actorUserId: actor,
       roleKey: row.status === "pending_review" ? "contract_director" : "finance_director", nodeName: row.status === "pending_review" ? "合同部主管" : "财务主管",
       stageIndex: row.status === "pending_review" ? 0 : 1,
       preserveHistoricalContinuation: row.status === "pending_finance",
       nodes: [{ name: "合同部主管", mode: "any", roleKeys: ["contract_director"] }, ...(financeRequired ? [{ name: "财务主管", mode: "any" as const, roleKeys: ["finance_director"] }] : [])],
       signedAt: confirmedAt, form: await ledgerApprovalFacts(tx, "contract_economic_review", id) });
     if(finish) for(const d of frozenSources) if(d.formal&&d.operatingBaseline&&("excludedDeltaYuan" in d?d.excludedDeltaYuan!=="0.0000":d.excludedDeltaCents!=="0")) await this.operatingSources.appendConfirmedSourceIfEnabledInTransaction(tx,{projectId:row.projectId,sourceType:"contract_economic_review",sourceBusinessId:`${row.id}:${d.ref}`},actor);
     await this.audit.record(tx,{actorUserId:actor,action:"contract.economic_review.review",businessType:"contract_economic_review",businessId:id,metadata:{projectId:row.projectId,status:updated.status}});
     if (qualification) await assertDirectReviewContinuity(tx,qualification);
     return { review: presentReview(updated), direct: Boolean(qualification) };
   });
   if (!outcome.direct) return outcome.review;
   return this.prisma.$transaction(async tx=>{
     const persisted=await tx.contractEconomicReview.findUnique({where:{id}});
     if (!persisted || persisted.revision!==outcome.review.revision || persisted.status!==outcome.review.status ||
       persisted.projectId!==outcome.review.projectId || persisted.requestFingerprint!==outcome.review.requestFingerprint) {
       throw new ServiceUnavailableException("履约复核办理结果尚未完整核对，请查询原复核记录");
     }
     await assertDirectReviewQualification(tx,"read");
     if (persisted.status==="confirmed") {
       const proof=await readDirectReviewHistory(tx,persisted.projectId,[persisted]);
       if (!proof.has(id)) throw new ServiceUnavailableException("履约复核原件留存尚未完整核对");
     }
     return presentReview(persisted);
   });
 }
}
