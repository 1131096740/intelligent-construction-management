import { ContractProxyOperatingSourceAdapter } from "./contract-proxy-operating-source.adapter";
import { reduceOperatingProjection,type ProjectionFactInput } from "../operating-projection/operating-projection.reducer";
import type { ProxySource } from "./contract-proxy-source";
const source:ProxySource={contractRelationship:"inside",sourceRef:"settlement:s",reference:"JS-1",counterparty:"材料商",debtor:{kind:"participating_company",id:"company-a",name:"甲公司"},approvedPayer:{kind:"participating_company",id:"company-a",name:"甲公司"},actualPayer:{kind:"construction_enterprise",id:"enterprise",name:"施工企业"},payee:{kind:"downstream_counterparty",id:"supplier",name:"材料商"},affiliate:{assignmentId:"assignment",businessPartyVersionId:"enterprise",name:"施工企业"},operatingLedgerEffectiveDate:"2026-01-01T00:00:00Z",companyEntityId:"company-a",companyName:"甲公司"};
const adapter=new ContractProxyOperatingSourceAdapter();
function entry(eventKind:string,amountCents:string,original:ProxySource=source){return adapter.toOperatingFactInput({projectId:"p",sourceType:adapter.sourceType,sourceBusinessId:eventKind,sourceBusinessCode:"JS-1",sourceVersion:1,status:"confirmed",sourceSnapshot:{...original,eventKind,amountCents,occurredAt:"2026-10-01T00:00:00Z",confirmedAt:"2026-10-02T00:00:00Z",confirmedByUserId:"finance-director",evidenceFileId:"voucher"}}).input;}
function projection(items:ReturnType<typeof entry>[],company?:string){
 const facts:ProjectionFactInput[]=items.map(input=>({id:input.sourceBusinessId,projectId:"p",projectName:"隔离项目",projectCode:"P1",sourceType:input.sourceType,sourceBusinessId:input.sourceBusinessId,sourceVersion:1,sourceBusinessCode:"JS-1",occurredAt:input.occurredAt.toISOString(),confirmedAt:input.confirmedAt.toISOString(),affiliateBusinessPartyVersionId:"enterprise",affiliateNameSnapshot:"施工企业",factKind:input.factKind,operatingLevel:input.operatingLevel,evidenceLevel:"A",amountCents:input.amountCents,direction:input.direction,sourceSnapshot:input.sourceSnapshot,entryKind:"original",debtorSubject:input.subjects.debtor,subjectReferences:Object.values(input.subjects).filter(Boolean) as never,impacts:input.impacts.map((i,index)=>({...i,id:`${input.sourceBusinessId}-${index}`,subjectKind:i.subject?.kind,subjectId:i.subject?.id}))}));
 return reduceOperatingProjection({scope:{kind:"project",projectId:"p",projectIds:["p"],...(company?{filters:{companyEntityId:company}}:{})},facts,riskByProject:[],readAt:"2026-10-19T00:00:00Z",cutoffAt:"2026-10-19T00:00:00Z"});
}
describe("真实代付、退款与归还的单一资金事实",()=>{
 it.each([
  ["表内施工企业代付",source],
  ["表内另一我方公司代付",{...source,actualPayer:{kind:"participating_company",id:"company-b",name:"乙公司"}}],
  ["表外我方公司代付",{...source,contractRelationship:"outside",debtor:{kind:"construction_enterprise",id:"enterprise",name:"施工企业"},approvedPayer:{kind:"construction_enterprise",id:"enterprise",name:"施工企业"},actualPayer:{kind:"participating_company",id:"company-a",name:"甲公司"},companyEntityId:null,companyName:null}]
 ] as const)("%s：核销50、往来50、成本0，分类不随付款方改变",(_label,s)=>{
  const input=entry("payment","50",s as ProxySource);const view=projection([input]);
  expect(input.sourceSnapshot.contractRelationship).toBe(s.contractRelationship);
  expect(view.operating).toMatchObject({payableCents:"-50",confirmedCostCents:"0",confirmedIncomeCents:"0"});
  expect(view.actualFunds.interSubjectBalanceCents).toBe("50");
  expect(view.actualFunds.confirmedProjectOutflowsCents).toBe("50");
 });
 it("归还20只清主体往来，退款10只恢复原应付及资金",()=>{
  const result=projection([entry("payment","50"),entry("repayment","20"),entry("refund","10")]);
  expect(result.operating).toMatchObject({payableCents:"-40",confirmedCostCents:"0",confirmedIncomeCents:"0"});
  expect(result.actualFunds.interSubjectBalanceCents).toBe("20");
  expect(result.actualFunds.confirmedProjectOutflowsCents).toBe("50");
  expect(result.actualFunds.confirmedProjectInflowsCents).toBe("10");
 });
 it("甲公司应还与乙公司应收分别展示，不把替人支付误认为自己的下游债务",()=>{
  const s:ProxySource={...source,actualPayer:{kind:"participating_company",id:"company-b",name:"乙公司"}};
  const entries=[entry("payment","50",s),entry("repayment","20",s)];
  const a=projection(entries,"company-a"),b=projection(entries,"company-b");
  expect(a.operating.payableCents).toBe("-50");expect(b.operating.payableCents).toBe("0");
  expect(a.relationshipTotals?.find(r=>r.relationship==="inside")).toMatchObject({interSubjectPayableCents:"30",interSubjectReceivableCents:"0"});
  expect(b.relationshipTotals?.find(r=>r.relationship==="inside")).toMatchObject({interSubjectPayableCents:"0",interSubjectReceivableCents:"30"});
 });
});
