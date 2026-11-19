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

describe("source-qualified mechanical heading layout",()=>{
 const heading=(bytes:Buffer)=>paragraphs(bytes).find(p=>text(p).replace(/\s/gu,"")==="第十条不可抗力")!;
 const keep=(p:Element)=>p.getElementsByTagNameNS(W,"keepNext").item(0)?.getAttributeNS(W,"val");
 const alter=(edit:(doc:ReturnType<typeof parse>)=>void)=>{const zip=new PizZip(source),doc=parse(source);edit(doc);zip.file("word/document.xml",new XMLSerializer().serializeToString(doc));return zip.generate({type:"nodebuffer"});};
 it("preserves v1 semantics and keeps all text and empty paragraph under v2",()=>{
   const old=applyMechanicalContactLayout(source,source,"mechanical-contact-layout-v1"),current=applyMechanicalContactLayout(source,source,"mechanical-contact-layout-v2");
   expect(keep(heading(old))).not.toBe("1");expect(keep(heading(current))).toBe("1");expect(paragraphs(current).map(text)).toEqual(paragraphs(source).map(text));
   const body=parse(current).getElementsByTagNameNS(W,"body").item(0)!;const parts=Array.from(body.childNodes).filter(n=>n.nodeType===1) as Element[];const trailing=parts.at(-2)!;
   expect(trailing.localName).toBe("p");expect(text(trailing)).toBe("");expect(trailing.getElementsByTagNameNS(W,"spacing").item(0)?.getAttributeNS(W,"line")).toBe("20");
 });
 it.each(["docx","officeDocx"] as const)("applies v2 heading and retained empty paragraph to qualification %s",name=>{
   const bytes=createOfficialQualificationSample(source)[name],body=parse(bytes).getElementsByTagNameNS(W,"body").item(0)!;
   const parts=Array.from(body.childNodes).filter(n=>n.nodeType===1) as Element[];
   expect(keep(heading(bytes))).toBe("1");expect(text(parts.at(-2)!)).toBe("");
   expect(parts.at(-2)!.getElementsByTagNameNS(W,"spacing").item(0)?.getAttributeNS(W,"line")).toBe("20");
 });
 it("does not change heading or a nonempty edited trailing paragraph",()=>{
   const edited=alter(doc=>{const b=doc.getElementsByTagNameNS(W,"body").item(0)!,parts=Array.from(b.childNodes).filter(n=>n.nodeType===1) as Element[],p=parts.at(-2)!,run=doc.createElementNS(W,"w:r"),t=doc.createElementNS(W,"w:t");t.textContent="虚构保留编辑";run.appendChild(t);p.appendChild(run);});
   const out=applyMechanicalContactLayout(source,edited,"mechanical-contact-layout-v2");expect(keep(heading(out))).not.toBe("1");expect(paragraphs(out).map(text)).toEqual(paragraphs(edited).map(text));
 });
 it("preserves an empty trailing paragraph with user-owned structure",()=>{
   const edited=alter(doc=>{const b=doc.getElementsByTagNameNS(W,"body").item(0)!,parts=Array.from(b.childNodes).filter(n=>n.nodeType===1) as Element[],p=parts.at(-2)!,marker=doc.createElementNS(W,"w:bookmarkStart");marker.setAttributeNS(W,"w:id","99");marker.setAttributeNS(W,"w:name","user-marker");p.appendChild(marker);});
   const out=applyMechanicalContactLayout(source,edited,"mechanical-contact-layout-v2");expect(keep(heading(out))).not.toBe("1");expect(parse(out).getElementsByTagNameNS(W,"bookmarkStart").length).toBe(parse(edited).getElementsByTagNameNS(W,"bookmarkStart").length);
 });
 it("preserves a confirmed mapping in the first clause",()=>{
   const positions=readLayoutSourcePositions(source).positions;
   const bindings=positions.flatMap(p=>[["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].flatMap(([token,fieldKey])=>{const start=p.text.indexOf(token);return start<0?[]:[{positionId:p.positionId,start,end:start+token.length,fieldKey}];}));
   const target=positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===163)!;
   const mapped=prepareLayoutSourceMapping(source,"layout",1,[...bindings,{positionId:target.positionId,start:0,end:1,fieldKey:"field.useLocation"}]).docx;
   const out=applyMechanicalContactLayout(source,mapped,"mechanical-contact-layout-v2");expect(keep(heading(out))).not.toBe("1");expect(paragraphs(out).map(text)).toEqual(paragraphs(mapped).map(text));
 });
 it("does not change trailing layout when the next clause is edited",()=>{
   const edited=alter(doc=>{const h=Array.from(doc.getElementsByTagNameNS(W,"p")).find(p=>text(p).replace(/\s/gu,"")==="第十条不可抗力")!,next=h.nextSibling as Element;next.getElementsByTagNameNS(W,"t").item(0)!.textContent="虚构保留正文";});
   const out=applyMechanicalContactLayout(source,edited,"mechanical-contact-layout-v2");expect(keep(heading(out))).not.toBe("1");expect(paragraphs(out).map(text)).toEqual(paragraphs(edited).map(text));
 });
});
