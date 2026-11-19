import {readFileSync} from "node:fs";
import {join} from "node:path";
import PizZip from "pizzip";
import {assertAutomaticPartyMapping} from "./contract-automatic-party-mapping";
import {readLayoutSourcePositions,prepareLayoutSourceMapping} from "../contract-template/layout-field-mapping";

it.each(["material-purchase-real-v1.docx","equipment-rental-real-v1.docx","labor-subcontract-real-v1.docx","generic-contract-v1.docx"])("rejects extra automatic company binding in ordinary body for %s",name=>{
 const original=readFileSync(join(__dirname,"../../assets/templates",name));
 for(const repack of [false,true]){
  const zip=new PizZip(original);zip.comment="fictional repack";const source=repack?zip.generate({type:"nodebuffer"}):original,positions=readLayoutSourcePositions(source).positions;
  const bindings=positions.flatMap(p=>[["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{相对方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].flatMap(([token,fieldKey])=>{const start=p.text.indexOf(token);return start<0?[]:[{positionId:p.positionId,start,end:start+token.length,fieldKey}]}));
  if(name.startsWith("generic")){const p=positions.find(x=>x.part==="word/document.xml"&&x.paragraphIndex===13)!;const start=p.text.indexOf("建工智管建设有限公司");bindings.push({positionId:p.positionId,start,end:start+"建工智管建设有限公司".length,fieldKey:"party.owner.name"});}
  const valid=prepareLayoutSourceMapping(source,"fixture",1,bindings).mapping;expect(()=>assertAutomaticPartyMapping(source,valid)).not.toThrow();
  const target=positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex>=30&&p.paragraphIndex<45&&p.text.length>=3&&!/[{}]/u.test(p.text))!;
  for(const key of ["party.owner.name","party.counterparty.name","field.counterpartyName"]){const bad=prepareLayoutSourceMapping(source,"fixture",1,[...bindings,{positionId:target.positionId,start:0,end:3,fieldKey:key}]).mapping;expect(()=>assertAutomaticPartyMapping(source,bad)).toThrow("正文内容已保留");}
 }
});

it("does not classify a changed custom template or inspect free text",()=>{
 const original=readFileSync(join(__dirname,"../../assets/templates/material-purchase-real-v1.docx")),zip=new PizZip(original);zip.file("synthetic-custom-part","fictional");const source=zip.generate({type:"nodebuffer"}),positions=readLayoutSourcePositions(source).positions;
 const bindings=positions.flatMap(p=>[["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].flatMap(([token,fieldKey])=>{const start=p.text.indexOf(token);return start<0?[]:[{positionId:p.positionId,start,end:start+token.length,fieldKey}]}));
 const target=positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===51)!;bindings.push({positionId:target.positionId,start:0,end:3,fieldKey:"party.owner.name"});
 const mapping=prepareLayoutSourceMapping(source,"fixture",1,bindings).mapping;expect(()=>assertAutomaticPartyMapping(source,mapping)).not.toThrow();
});

it("fails closed for forged bank mappings while leaving independent bank projection unchanged",()=>{
 const source=readFileSync(join(__dirname,"../../assets/templates/material-purchase-real-v1.docx")),positions=readLayoutSourcePositions(source).positions,p=positions.find(x=>x.part==="word/document.xml"&&x.paragraphIndex===205)!;
 const mapping={protocolVersion:1 as const,sourceFileId:"fixture",sourceSha256:"0".repeat(64),draftRevision:1,fingerprint:"fixture",bindings:[{positionId:p.positionId,start:0,end:1,fieldKey:"party.owner.bankAccount"}]};
 expect(()=>assertAutomaticPartyMapping(source,mapping)).toThrow("合同正文内容已保留");expect(mapping.bindings[0].fieldKey).toBe("party.owner.bankAccount");
});
