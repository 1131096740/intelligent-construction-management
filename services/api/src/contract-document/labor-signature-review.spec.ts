import {readFileSync} from "node:fs";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {DOMParser,XMLSerializer} from "@xmldom/xmldom";
import PizZip from "pizzip";
import {readLayoutSourcePositions} from "../contract-template/layout-field-mapping";
import {assertSignatureSupplementMapping,renderContractBody} from "./contract-body-document";
const source=readFileSync(join(__dirname,"../../assets/templates/labor-subcontract-real-v1.docx"));
const values={"contract.name":"虚构合同","contract.temporaryCode":"TEST","document.watermark":"草稿","party.owner.name":"虚构甲方","party.counterparty.name":"虚构乙方"};
const parsed=readLayoutSourcePositions(source),id=(i:number)=>parsed.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===i)?.positionId??createHash("sha256").update(JSON.stringify([parsed.sourceSha256,i])).digest("hex");
const options={partyDetailsVersion:"built-in-labor-signature-review-v3" as never};
it("preserves role-specific main signature text and requires company and bank review",()=>{
 const plan={protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256:parsed.sourceSha256,edits:[{positionId:id(145),text:"甲方个人签署说明"},{positionId:id(146),text:"乙方个人签署说明"}]};
 expect(()=>renderContractBody(source,source,{values},[],"layout",plan,options)).toThrow("核对");
 const preview=renderContractBody(source,source,{values},[],"layout",plan,{...options,partyDetailsConflictPreview:true});
 expect(preview.signatureSupplementReview?.entries).toEqual([{role:"party_a",id:id(145),text:"甲方个人签署说明"},{role:"party_b",id:id(146),text:"乙方个人签署说明"}]);
 const reviewed={...plan,signatureSupplementReviewDigest:preview.signatureSupplementReview!.digest};
 const out=renderContractBody(source,source,{values},[],"layout",reviewed,options).docx;
 const doc=new DOMParser().parseFromString(new PizZip(out).file("word/document.xml")!.asText(),"application/xml");const all=doc.documentElement!.textContent!;
 expect(all).toContain("甲方个人签署说明");expect(all).toContain("乙方个人签署说明");expect(all).toContain("甲方签署（盖章）");expect(all).toContain("乙方签署（盖章）");
 expect(()=>renderContractBody(source,source,{values},[],"layout",{...reviewed,edits:[{...plan.edits[0],text:"修改后"},plan.edits[1]]},options)).toThrow("核对");
});
it.each([141,142,143,163,184,185,199,200,201,202,203,204,205,231,232,233,234])("blocks ambiguous or signature label edits at %i without losing original",index=>{
 const plan={protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256:parsed.sourceSha256,edits:[{positionId:id(index),text:"无法安全归属的原文"}]};
 expect(()=>renderContractBody(source,source,{values},[],"layout",plan,options)).toThrow("已有编辑");
 const preview=renderContractBody(source,source,{values},[],"layout",plan,{...options,partyDetailsConflictPreview:true});
 expect(preview.laborSignatureRecovery?.entries).toContainEqual({id:id(index),text:"无法安全归属的原文",kind:"edit"});
 expect(plan.edits[0].text).toBe("无法安全归属的原文");
});
it.each([141,184,199,231])("refuses changed mappings in protected signature area %i without edits",index=>{
 const zip=new PizZip(source),doc=new DOMParser().parseFromString(zip.file("word/document.xml")!.asText(),"application/xml"),paragraph=doc.getElementsByTagName("w:p").item(index)!;
 paragraph.getElementsByTagName("w:t").item(0)!.textContent="{field.useLocation}";
 zip.file("word/document.xml",new XMLSerializer().serializeToString(doc));const mapped=zip.generate({type:"nodebuffer"});
 expect(()=>assertSignatureSupplementMapping(source,mapped,"layout",undefined)).toThrow("映射冲突");
});
it("preserves v2 legacy snapshot behavior and independent attachment signatures",()=>{
 const out=renderContractBody(source,source,{values},[],"layout",undefined,{partyDetailsVersion:"built-in-labor-party-glyph-banks-v2"}).docx;
 const doc=new DOMParser().parseFromString(new PizZip(out).file("word/document.xml")!.asText(),"application/xml"),text=doc.documentElement!.textContent!;
 expect(text).not.toContain("甲方签署（盖章）");expect(text).toContain("民工工资兑现承诺书");expect(text).toContain("发包人：(盖章)");
});
it("retains all original attachment signature paragraph text in the new body document",()=>{
 const sourceDoc=new DOMParser().parseFromString(new PizZip(source).file("word/document.xml")!.asText(),"application/xml");
 const result=renderContractBody(source,source,{values},[],"layout",undefined,options).docx;
 const outputDoc=new DOMParser().parseFromString(new PizZip(result).file("word/document.xml")!.asText(),"application/xml");
 const paragraphs=(doc:typeof sourceDoc)=>Array.from(doc.getElementsByTagName("w:p")).map(p=>Array.from(p.getElementsByTagName("w:t")).map(t=>t.textContent??"").join(""));
 const before=paragraphs(sourceDoc),after=paragraphs(outputDoc);
 let cursor=0;
 for(const index of [184,185,199,200,201,202,203,204,205,231,232,233,234]){const found=after.findIndex((text,i)=>i>=cursor&&text===before[index]);expect(found).toBeGreaterThanOrEqual(cursor);cursor=found+1;}
});
