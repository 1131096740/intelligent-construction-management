import {UpwardReceiptMatchOperatingSourceAdapter} from "./upward-receipt-match-operating-source.adapter";
const adapter=new UpwardReceiptMatchOperatingSourceAdapter();
function input(reverse=false){return adapter.toOperatingFactInput({projectId:"p",sourceType:adapter.sourceType,sourceBusinessId:"match",sourceBusinessCode:"对上第一期",sourceVersion:1,status:"confirmed",sourceSnapshot:{contractRelationship:"upward",originalId:reverse?"original":null,amountCents:"20000",companyEntityId:"a",affiliate:{assignmentId:"assignment",businessPartyVersionId:"e",name:"施工企业"},occurredAt:"2026-08-23T00:00:00Z",confirmedAt:"2026-10-19T00:00:00Z",confirmedByUserId:"reviewer",operatingLedgerEffectiveDate:"2026-07-01T00:00:00Z"}}).input;}
describe("先到账后匹配：同笔现金只保留一次",()=>{
 it("到账20000核销只减少应收，不再增加公司现金、成本或收入",()=>{const fact=input();expect(fact.impacts.map(i=>[i.impactKind,i.direction,i.amountCents])).toEqual([["receivable_decrease","decrease",20000n]]);expect(fact.subjects.creditor).toEqual({kind:"participating_company",id:"a"});});
 it("解除匹配反向恢复对上应收，不触碰原公司真实到账",()=>{expect(input(true).impacts.map(i=>[i.impactKind,i.direction,i.amountCents])).toEqual([["receivable_increase","increase",20000n]]);});
});
