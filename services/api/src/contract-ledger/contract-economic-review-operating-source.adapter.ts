import { isDeepStrictEqual } from "node:util";
import { chinaDateOnly, normalizeBusinessAmount } from "@jiangkong/shared-domain";
import { Prisma } from "@prisma/client";
import { BadRequestException } from "@nestjs/common";
import type { OperatingSourceAdapter,OperatingSourceLocator,OperatingSourceSnapshot,OperatingSourceFactInput } from "../operating-ledger/operating-source-adapter";
import { occurredBeforeEffectiveDate,sourceJson,requiredJsonRecord,requiredJsonText,requiredJsonMoney,requiredJsonDate } from "../operating-ledger/formal-operating-source.helpers";
import type { AppendOperatingFactInput } from "../operating-ledger/operating-ledger.service";
export class ContractEconomicReviewOperatingSourceAdapter implements OperatingSourceAdapter {
 readonly sourceType="contract_economic_review";
 async readProjectSnapshots(tx:Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],projectId:string){
  const rows=await tx.contractEconomicReview.findMany({where:{projectId,status:"confirmed"}});
  return (await Promise.all(rows.map(row=>this.snapshots(tx,row)))).flat();
 }
 async readSourceSnapshot(tx:Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],locator:OperatingSourceLocator){
  const id=locator.sourceBusinessId.split(":")[0];
  const row=await tx.contractEconomicReview.findFirst({where:{id,projectId:locator.projectId,status:"confirmed"}});
  return row?(await this.snapshots(tx,row)).find(s=>s.sourceBusinessId===locator.sourceBusinessId)??null:null;
 }
 private async snapshots(tx:Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],row:{id:string;projectId:string;revision:number;confirmedAt:Date|null;contractReviewedById:string|null;financeReviewedById:string|null;frozenSources:unknown}):Promise<OperatingSourceSnapshot[]>{
  if(!row.confirmedAt||!Array.isArray(row.frozenSources))throw new BadRequestException("正式履约复核缺少冻结依据");
  const snapshots: OperatingSourceSnapshot[] = row.frozenSources.filter(d=>{
   if(!d.formal||!d.operatingBaseline)return false;
   if(d.coverageNumericProtocolVersion===2||d.numericProtocolVersion===2){
    if(typeof d.excludedDeltaYuan!=="string")throw new BadRequestException("履约复核缺少已确认的四位调整金额");
    return normalizeBusinessAmount(d.excludedDeltaYuan,{allowNegative:true})!=="0.0000";
   }
   return d.excludedDeltaCents!=="0";
  }).map(d=>({
   projectId:row.projectId,sourceType:this.sourceType,sourceBusinessId:`${row.id}:${d.ref}`,sourceBusinessCode:`履约范围复核/${d.reference}`,sourceVersion:row.revision,status:"confirmed",
   sourceSnapshot:sourceJson({contractRelationship:d.operatingBaseline.sourceSnapshot.contractRelationship??(d.ref.startsWith("affiliate:")?"outside":undefined),
    sourceRef:d.ref,...(d.coverageNumericProtocolVersion===2||d.numericProtocolVersion===2
     ?{numericProtocolVersion:2,reviewId:row.id,excludedDeltaYuan:normalizeBusinessAmount(d.excludedDeltaYuan,{allowNegative:true})}
     :{excludedDeltaCents:d.excludedDeltaCents}),baseline:d.operatingBaseline,occurredAt:row.confirmedAt!.toISOString(),confirmedByUserId:row.financeReviewedById??row.contractReviewedById})
  }));
  return Promise.all(snapshots.map(snapshot => this.withArchiveReviewDay(tx, snapshot)));
 }
 private async withArchiveReviewDay(tx:Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],snapshot:OperatingSourceSnapshot):Promise<OperatingSourceSnapshot>{
  const source=requiredJsonRecord(snapshot.sourceSnapshot,"履约复核"),baseline=requiredJsonRecord(source.baseline,"原合同承诺");
  if(source.numericProtocolVersion!==2||baseline.originalSourceType!=="contract_version")return snapshot;
  const original=await tx.operatingFact.findUnique({where:{id:requiredJsonText(baseline,"originalOperatingFactId","原经营事实")},select:{id:true,projectId:true,status:true,entryKind:true,factKind:true,sourceType:true,sourceBusinessId:true,sourceVersion:true,numericProtocolVersion:true,sourceSnapshot:true,occurredAt:true}});
  if(!original||original.projectId!==snapshot.projectId||original.status!=="confirmed"||original.entryKind!=="original"||original.factKind!=="downstream_contract"||original.sourceType!=="contract_version"||original.sourceBusinessId!==baseline.originalSourceBusinessId||original.sourceVersion!==baseline.originalSourceVersion||original.numericProtocolVersion!==baseline.numericProtocolVersion||!isDeepStrictEqual(original.sourceSnapshot,baseline.sourceSnapshot))throw new BadRequestException("履约复核的原经营事实与冻结来源不一致");
  if(original.sourceSnapshot===null)throw new BadRequestException("原合同经营来源为空");
  const originalSource=requiredJsonRecord(original.sourceSnapshot,"原合同来源");
  if(originalSource.archiveProtocolVersion!==2)return snapshot;
  const archive=await tx.contractArchiveFile.findUnique({where:{id:requiredJsonText(originalSource,"archiveAuthorityId","原归档权威")},select:{archiveProtocolVersion:true,status:true,contractVersionId:true,confirmedAt:true,authoritySnapshot:true,authoritySha256:true}});
  const authority=archive?.authoritySnapshot&&requiredJsonRecord(archive.authoritySnapshot,"原归档依据");
  if(!archive||archive.archiveProtocolVersion!==2||archive.status!=="confirmed"||archive.contractVersionId!==original.sourceBusinessId||!archive.confirmedAt||archive.confirmedAt.getTime()!==original.occurredAt.getTime()||archive.authoritySha256!==originalSource.archiveAuthoritySha256||!authority||authority.projectId!==snapshot.projectId||authority.sourceBasisSha256!==originalSource.sourceBasisSha256||!isDeepStrictEqual(authority.sourceBasis,originalSource.sourceBasis))throw new BadRequestException("履约复核的原归档权威已不一致");
  return {...snapshot,sourceSnapshot:sourceJson({...source,archiveV2ReviewBusinessDay:chinaDateOnly(requiredJsonDate(source,"occurredAt","履约复核"))})};
 }
 toOperatingFactInput(snapshot:OperatingSourceSnapshot):OperatingSourceFactInput {
  const s=requiredJsonRecord(snapshot.sourceSnapshot,"履约复核"),b=requiredJsonRecord(s.baseline,"原合同承诺");
  const numeric2=s.numericProtocolVersion===2;
  const deltaYuan=numeric2?normalizeBusinessAmount(requiredJsonText(s,"excludedDeltaYuan","履约复核"),{allowNegative:true}):null;
  if(numeric2&&(deltaYuan===null||deltaYuan==="0.0000"))throw new BadRequestException("履约复核四位调整必须是已确认的非零金额");
  const delta=numeric2?null:requiredJsonMoney(s,"excludedDeltaCents","重叠范围调整");
  const money=numeric2?{numericProtocolVersion:2 as const,amountCents:null,amountYuan:new Prisma.Decimal(deltaYuan!).abs().toFixed(4)}:{amountCents:delta!<0n?-delta!:delta!};
  const direction=numeric2?(new Prisma.Decimal(deltaYuan!).gt(0)?"decrease" as const:"increase" as const):delta!>0n?"decrease" as const:"increase" as const;
  const subjects=b.subjects as unknown as AppendOperatingFactInput["subjects"];
  if(!subjects?.debtor||!subjects.creditor)throw new BadRequestException("履约复核缺少冻结债务和债权主体");
  const occurredAt=requiredJsonDate(s,"occurredAt","履约复核");
  // Only the tx-aware source reader emits this value after rebinding the
  // confirmed review's immutable original Fact to its persisted Archive2.
  // The writer independently revalidates the full source again.
  const beforeEffective = typeof s.archiveV2ReviewBusinessDay === "string"
    ? s.archiveV2ReviewBusinessDay < requiredJsonDate(b,"operatingLedgerEffectiveDate","履约复核启用日期").toISOString().slice(0,10)
    : occurredBeforeEffectiveDate(occurredAt,requiredJsonDate(b,"operatingLedgerEffectiveDate","履约复核启用日期"));
  return {entryKind:"original",input:{projectId:snapshot.projectId,sourceType:this.sourceType,sourceBusinessId:snapshot.sourceBusinessId,sourceBusinessCode:snapshot.sourceBusinessCode,sourceVersion:snapshot.sourceVersion,
   idempotencyKey:`${this.sourceType}:${snapshot.sourceBusinessId}`,occurredAt,confirmedAt:occurredAt,confirmedByUserId:requiredJsonText(s,"confirmedByUserId","履约复核"),
   factKind:"downstream_contract",operatingLevel:"project",evidenceLevel:"A",...money,currencyCode:"CNY",direction:"neutral",isBeforeOperatingLedgerEffectiveDate:beforeEffective,
   affiliateAssignmentId:requiredJsonText(b,"affiliateAssignmentId","原合同承诺"),affiliateBusinessPartyVersionId:requiredJsonText(b,"affiliateBusinessPartyVersionId","原合同承诺"),affiliateNameSnapshot:requiredJsonText(b,"affiliateNameSnapshot","原合同承诺"),
   affiliateCreditCodeSnapshot:typeof b.affiliateCreditCodeSnapshot==="string"?b.affiliateCreditCodeSnapshot:undefined,sourceSnapshot:snapshot.sourceSnapshot,basisSnapshot:sourceJson({authority:"confirmed_contract_economic_review"}),subjects,
   impacts:[{idempotencyKey:`${this.sourceType}:${snapshot.sourceBusinessId}:commitment`,sourceImpactKey:"contract_commitment_reference",impactKind:"contract_commitment_reference",...money,direction,subjectRole:"debtor",subject:subjects.debtor,description:"履约复核调整重复承诺；不改变原文书、不自动更正成本或欠款"}]
  }};
 }
}
