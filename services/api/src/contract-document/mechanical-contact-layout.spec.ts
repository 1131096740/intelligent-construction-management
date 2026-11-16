import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import PizZip from "pizzip";
import { createOfficialQualificationSample } from "./task12-official-qualification-sample";
import { prepareLayoutSourceMapping, readLayoutSourcePositions } from "../contract-template/layout-field-mapping";
import { applyMechanicalContactLayout } from "./mechanical-contact-layout";

const source=readFileSync(join(__dirname,"../../assets/templates/equipment-rental-real-v1.docx"));
const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const parse=(bytes:Buffer)=>new DOMParser().parseFromString(new PizZip(bytes).file("word/document.xml")!.asText(),"application/xml");
const text=(p:Element)=>Array.from(p.getElementsByTagNameNS(W,"t")).map(t=>t.textContent??"").join("");
const paragraphs=(bytes:Buffer)=>Array.from(parse(bytes).getElementsByTagNameNS(W,"p"));
const docxWithEditedContact=(bytes:Buffer)=>{const zip=new PizZip(bytes),doc=parse(bytes),p=Array.from(doc.getElementsByTagNameNS(W,"p")).find(p=>text(p).includes("身份证号")&&text(p).includes("移动电话"))!;p.getElementsByTagNameNS(W,"t").item(0)!.textContent="人工修改";zip.file("word/document.xml",new XMLSerializer().serializeToString(doc));return zip.generate({type:"nodebuffer"});};

describe("mechanical contact layout projection",()=>{
 it("preserves every source paragraph and makes four original pairs stay together",()=>{
   const updated=applyMechanicalContactLayout(source,source);
   expect(paragraphs(updated).map(text)).toEqual(paragraphs(source).map(text));
   const contacts=paragraphs(updated).filter(p=>text(p).includes("身份证号")&&text(p).includes("移动电话"));expect(contacts).toHaveLength(4);
   for(const p of contacts){expect(p.getElementsByTagNameNS(W,"keepLines").item(0)?.getAttributeNS(W,"val")).toBe("1");expect(p.getElementsByTagNameNS(W,"br")).toHaveLength(1);const previous=p.previousSibling as Element;expect(previous.getElementsByTagNameNS(W,"keepNext").item(0)?.getAttributeNS(W,"val")).toBe("1");}
 });
 it.each(["docx","officeDocx"] as const)("applies the same projection to qualification %s",name=>{
   const contacts=paragraphs(createOfficialQualificationSample(source)[name]).filter(p=>text(p).includes("身份证号")&&text(p).includes("移动电话"));
   expect(contacts).toHaveLength(4);for(const p of contacts)expect(p.getElementsByTagNameNS(W,"br")).toHaveLength(1);
 });
 it("preserves a user-edited contact paragraph while projecting remaining pairs",()=>{
   const edited=docxWithEditedContact(source),out=applyMechanicalContactLayout(source,edited);expect(paragraphs(out).map(text)).toEqual(paragraphs(edited).map(text));
   const editedParagraph=paragraphs(out).find(p=>text(p).includes("人工修改"))!;expect(editedParagraph.getElementsByTagNameNS(W,"br")).toHaveLength(0);
   expect(paragraphs(out).filter(p=>text(p).includes("身份证号")&&p.getElementsByTagNameNS(W,"br").length===1)).toHaveLength(3);
 });
 it("preserves a confirmed field binding in the contact paragraph",()=>{
   const positions=readLayoutSourcePositions(source).positions;
   const bindings=positions.flatMap(p=>[["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].flatMap(([token,fieldKey])=>{const start=p.text.indexOf(token);return start<0?[]:[{positionId:p.positionId,start,end:start+token.length,fieldKey}];}));
   const target=positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===78)!;
   const mapped=prepareLayoutSourceMapping(source,"layout",1,[...bindings,{positionId:target.positionId,start:0,end:2,fieldKey:"field.useLocation"}]).docx;
   const out=applyMechanicalContactLayout(source,mapped);expect(paragraphs(out).map(text)).toEqual(paragraphs(mapped).map(text));
   expect(paragraphs(out).find(p=>text(p).includes("{field.useLocation}"))?.getElementsByTagNameNS(W,"br")).toHaveLength(0);
 });
 it("rejects a different source rather than applying fixed coordinates",()=>{expect(()=>applyMechanicalContactLayout(Buffer.from("other"),createOfficialQualificationSample(source).docx)).toThrow();});
});
