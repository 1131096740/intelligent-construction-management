import { BadRequestException } from "@nestjs/common";
import type { OperatingSourceAdapter,OperatingSourceLocator,OperatingSourceSnapshot,OperatingSourceFactInput } from "../operating-ledger/operating-source-adapter";
import { occurredBeforeEffectiveDate,sourceJson,requiredJsonRecord,requiredJsonText,requiredJsonMoney,requiredJsonDate } from "../operating-ledger/formal-operating-source.helpers";
import type { AppendOperatingFactInput } from "../operating-ledger/operating-ledger.service";
export class ContractEconomicReviewOperatingSourceAdapter implements OperatingSourceAdapter {
 readonly sourceType="contract_economic_review";
 async readProjectSnapshots(tx:Parameters<OperatingSourceAdapter["readProjectSnapshots"]>[0],projectId:string){
  const rows=await tx.contractEconomicReview.findMany({where:{projectId,status:"confirmed"}});
  return rows.flatMap(row=>this.snapshots(row));
 }
 async readSourceSnapshot(tx:Parameters<OperatingSourceAdapter["readSourceSnapshot"]>[0],locator:OperatingSourceLocator){
  const id=locator.sourceBusinessId.split(":")[0];
  const row=await tx.contractEconomicReview.findFirst({where:{id,projectId:locator.projectId,status:"confirmed"}});
  return row?this.snapshots(row).find(s=>s.sourceBusinessId===locator.sourceBusinessId)??null:null;
 }
 private snapshots(row:{id:string;projectId:string;revision:number;confirmedAt:Date|null;contractReviewedById:string|null;financeReviewedById:string|null;frozenSources:unknown}):OperatingSourceSnapshot[]{
  if(!row.confirmedAt||!Array.isArray(row.frozenSources))throw new BadRequestException("正式履约复核缺少冻结依据");
  return row.frozenSources.filter(d=>d.formal&&d.operatingBaseline&&d.excludedDeltaCents!=="0").map(d=>({
   projectId:row.projectId,sourceType:this.sourceType,sourceBusinessId:`${row.id}:${d.ref}`,sourceBusinessCode:`履约范围复核/${d.reference}`,sourceVersion:row.revision,status:"confirmed",
   sourceSnapshot:sourceJson({contractRelationship:d.operatingBaseline.sourceSnapshot.contractRelationship??(d.ref.startsWith("affiliate:")?"outside":undefined),
    sourceRef:d.ref,excludedDeltaCents:d.excludedDeltaCents,baseline:d.operatingBaseline,occurredAt:row.confirmedAt!.toISOString(),confirmedByUserId:row.financeReviewedById??row.contractReviewedById})
  }));
 }
 toOperatingFactInput(snapshot:OperatingSourceSnapshot):OperatingSourceFactInput {
  const s=requiredJsonRecord(snapshot.sourceSnapshot,"履约复核"),b=requiredJsonRecord(s.baseline,"原合同承诺"),delta=requiredJsonMoney(s,"excludedDeltaCents","重叠范围调整");
  const amount=delta<0n?-delta:delta;
  const subjects=b.subjects as unknown as AppendOperatingFactInput["subjects"];
  if(!subjects?.debtor||!subjects.creditor)throw new BadRequestException("履约复核缺少冻结债务和债权主体");
  const occurredAt=requiredJsonDate(s,"occurredAt","履约复核");
  return {entryKind:"original",input:{projectId:snapshot.projectId,sourceType:this.sourceType,sourceBusinessId:snapshot.sourceBusinessId,sourceBusinessCode:snapshot.sourceBusinessCode,sourceVersion:snapshot.sourceVersion,
   idempotencyKey:`${this.sourceType}:${snapshot.sourceBusinessId}`,occurredAt,confirmedAt:occurredAt,confirmedByUserId:requiredJsonText(s,"confirmedByUserId","履约复核"),
   factKind:"downstream_contract",operatingLevel:"project",evidenceLevel:"A",amountCents:amount,currencyCode:"CNY",direction:"neutral",isBeforeOperatingLedgerEffectiveDate:occurredBeforeEffectiveDate(occurredAt,requiredJsonDate(b,"operatingLedgerEffectiveDate","履约复核启用日期")),
   affiliateAssignmentId:requiredJsonText(b,"affiliateAssignmentId","原合同承诺"),affiliateBusinessPartyVersionId:requiredJsonText(b,"affiliateBusinessPartyVersionId","原合同承诺"),affiliateNameSnapshot:requiredJsonText(b,"affiliateNameSnapshot","原合同承诺"),
   affiliateCreditCodeSnapshot:typeof b.affiliateCreditCodeSnapshot==="string"?b.affiliateCreditCodeSnapshot:undefined,sourceSnapshot:snapshot.sourceSnapshot,basisSnapshot:sourceJson({authority:"confirmed_contract_economic_review"}),subjects,
   impacts:[{idempotencyKey:`${this.sourceType}:${snapshot.sourceBusinessId}:commitment`,sourceImpactKey:"contract_commitment_reference",impactKind:"contract_commitment_reference",amountCents:amount,direction:delta>0n?"decrease":"increase",subjectRole:"debtor",subject:subjects.debtor,description:"履约复核调整重复承诺；不改变原文书、不自动更正成本或欠款"}]
  }};
 }
}
