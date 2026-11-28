import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readLayoutSourcePositions, prepareLayoutSourceMapping } from "../contract-template/layout-field-mapping";
import { join } from "node:path";
import PizZip from "pizzip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { renderContractDocx } from "./contract-docx-renderer";
import { renderContractBody } from "./contract-body-document";
import { appendDocxImageAttachments } from "./docx-attachment-appender";
import { appendLegacySignatureBankFields, prepareLegacyPartyRoleBindings, removeMechanicalPartyDetailsFromLegacyDocx } from "./contract-mechanical-party-placement";
const values={"contract.name":"虚构合同","contract.temporaryCode":"TEST","document.watermark":"草稿","party.owner.name":"虚构甲公司","party.counterparty.name":"虚构乙公司","party.owner.openingBank":"虚构甲开户行","party.owner.bankAccount":"A001","party.counterparty.openingBank":"虚构乙开户行","party.counterparty.bankAccount":"B001"};
it.each([["material-purchase-real-v1.docx",206,213],["equipment-rental-real-v1.docx",189,195]])("new legacy %s preserves mapped supplement before signature and bank fields",(name,ownerIndex,otherIndex)=>{
 const source=readFileSync(join(__dirname,"../../assets/templates",name)),zip=new PizZip(source),doc=new DOMParser().parseFromString(zip.file("word/document.xml")!.asText(),"application/xml");
 for(const [index,key] of [[ownerIndex,"field.ownerNote"],[otherIndex,"field.otherNote"]] as const){const p=doc.getElementsByTagName("w:p").item(index)!,r=doc.createElement("w:r"),t=doc.createElement("w:t");t.textContent=`{${key}}`;r.appendChild(t);p.appendChild(r);}
 zip.file("word/document.xml",new XMLSerializer().serializeToString(doc));
 const mapped=zip.generate({type:"nodebuffer"});
 for(const count of [1,200]){
  const manual="甲方虚构甲公司账号A001".repeat(count),otherManual="乙方虚构乙公司账号B001".repeat(count),prepared=prepareLegacyPartyRoleBindings(source,mapped,{signatureBankAnchor:true});
  const rendered=renderContractDocx(prepared,{values:{...values,"field.ownerNote":manual,"field.otherNote":otherManual}},[]),old=removeMechanicalPartyDetailsFromLegacyDocx(source,rendered,{rolesPrepared:true});
  const result=appendLegacySignatureBankFields(source,old,values),out=new DOMParser().parseFromString(new PizZip(result).file("word/document.xml")!.asText(),"application/xml");
  const body=out.getElementsByTagName("w:body").item(0)!,children=Array.from(body.childNodes).filter(n=>n.nodeType===1),text=(node:typeof body)=>Array.from(node.getElementsByTagName("w:t")).map(n=>n.textContent??"").join("");
  const table=children.find(n=>n.nodeName==="w:tbl"&&text(n as typeof body).includes(values["party.owner.name"])&&text(n as typeof body).includes(values["party.counterparty.name"]))!;
  const idx=children.indexOf(table),before=children.slice(0,idx).map(n=>text(n as typeof body)).join("");
  expect(before).toContain(manual);expect(before).toContain(otherManual);expect(before.indexOf(manual)).toBeLessThan(before.indexOf(otherManual));expect(text(table as typeof body)).not.toContain(manual);expect(text(table as typeof body)).not.toContain(otherManual);
  for(const value of ["虚构甲开户行","A001","虚构乙开户行","B001"])expect(text(table as typeof body)).toContain(value);
 }
});
it("rejects missing or duplicated table anchors instead of guessing",()=>{
 const source=readFileSync(join(__dirname,"../../assets/templates/material-purchase-real-v1.docx"));
 const prepared=prepareLegacyPartyRoleBindings(source,source,{signatureBankAnchor:true});
 const rendered=renderContractDocx(prepared,{values},[]),legacy=removeMechanicalPartyDetailsFromLegacyDocx(source,rendered,{rolesPrepared:true});
 const zip=new PizZip(legacy),xml=zip.file("word/document.xml")!.asText();
 const missing=xml.replace(/<w:bookmarkStart\b(?=[^>]*jg_legacy_signature_bank_anchor)[^>]*\/>/u,"");
 expect(missing).not.toBe(xml);zip.file("word/document.xml",missing);
 expect(()=>appendLegacySignatureBankFields(source,zip.generate({type:"nodebuffer"}),values)).toThrow("签署区位置无法核对");
 const match=xml.match(/<w:bookmarkStart\b(?=[^>]*jg_legacy_signature_bank_anchor)[^>]*\/>/u)!;
 zip.file("word/document.xml",xml.replace(match[0],match[0]+match[0]));
 expect(()=>appendLegacySignatureBankFields(source,zip.generate({type:"nodebuffer"}),values)).toThrow("签署区位置无法核对");
});
it("does not alter an old unmarked legacy snapshot",()=>{
 const source=readFileSync(join(__dirname,"../../assets/templates/material-purchase-real-v1.docx"));
 const old=removeMechanicalPartyDetailsFromLegacyDocx(source,renderContractDocx(prepareLegacyPartyRoleBindings(source,source),{values},[]),{rolesPrepared:true});
 const text=new PizZip(old).file("word/document.xml")!.asText();
 expect(text).not.toContain("虚构甲开户行");expect(text).not.toContain("jg_legacy_signature_bank_anchor");
});
it.each([["material-purchase-real-v1.docx",205],["equipment-rental-real-v1.docx",188]])("retains a supplement mapped beside a party name in %s",(name,index)=>{
 const source=readFileSync(join(__dirname,"../../assets/templates",name)),zip=new PizZip(source),doc=new DOMParser().parseFromString(zip.file("word/document.xml")!.asText(),"application/xml");
 const p=doc.getElementsByTagName("w:p").item(index)!,r=doc.createElement("w:r"),t=doc.createElement("w:t");t.textContent="{field.ownerNote}";r.appendChild(t);p.appendChild(r);zip.file("word/document.xml",new XMLSerializer().serializeToString(doc));
 const mapped=zip.generate({type:"nodebuffer"}),manual="额外虚构姓名账号ABC".repeat(30);
 const prepared=prepareLegacyPartyRoleBindings(source,mapped,{signatureBankAnchor:true});
 const rendered=renderContractDocx(prepared,{values:{...values,"field.ownerNote":manual}},[]),trimmed=removeMechanicalPartyDetailsFromLegacyDocx(source,rendered,{rolesPrepared:true}),output=appendLegacySignatureBankFields(source,trimmed,values);
 const xml=new DOMParser().parseFromString(new PizZip(output).file("word/document.xml")!.asText(),"application/xml"),body=xml.getElementsByTagName("w:body").item(0)!,children=Array.from(body.childNodes).filter(n=>n.nodeType===1),text=(n:typeof body)=>Array.from(n.getElementsByTagName("w:t")).map(t=>t.textContent??"").join("");
 const table=children.find(n=>n.nodeName==="w:tbl"&&text(n as typeof body).includes(values["party.owner.name"])&&text(n as typeof body).includes(values["party.counterparty.name"]))!;
 expect(children.slice(0,children.indexOf(table)).map(n=>text(n as typeof body)).join("")).toContain(manual);
 expect(text(table as typeof body)).not.toContain(manual);expect(text(table as typeof body)).toContain(values["party.owner.name"]);
});

it.each([["material-purchase-real-v1.docx",205,218],["equipment-rental-real-v1.docx",187,198]])("anchors the signature table even if every signature paragraph is mapped in %s",(name,begin,end)=>{
 const source=readFileSync(join(__dirname,"../../assets/templates",name)),zip=new PizZip(source),doc=new DOMParser().parseFromString(zip.file("word/document.xml")!.asText(),"application/xml"),input:Record<string,string>={...values};
 for(let i=begin;i<=end;i++){const p=doc.getElementsByTagName("w:p").item(i)!,r=doc.createElement("w:r"),t=doc.createElement("w:t");t.textContent=`{field.note${i}}`;r.appendChild(t);p.appendChild(r);input[`field.note${i}`]=`虚构补充${i}`;}
 zip.file("word/document.xml",new XMLSerializer().serializeToString(doc));const mapped=zip.generate({type:"nodebuffer"});
 const parsed=readLayoutSourcePositions(source),editIndex=name.startsWith("material")?begin+1:begin,id=parsed.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===editIndex)?.positionId??createHash("sha256").update(JSON.stringify([parsed.sourceSha256,editIndex])).digest("hex");
 for(const edited of [false,true]){
  const editText="用户自由内容".repeat(200),plan=edited?{protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256:parsed.sourceSha256,edits:[{positionId:id,text:editText}]}:undefined;
  const output=renderContractBody(source,mapped,{values:input},[],"layout",plan,{partyDetailsVersion:"built-in-legacy-body-signature-v1"});
  const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=","base64");
  const withAttachment=appendDocxImageAttachments(output.docx,[{name:"虚构.png",type:"png",buffer:png}]);
  const body=new DOMParser().parseFromString(new PizZip(withAttachment).file("word/document.xml")!.asText(),"application/xml").getElementsByTagName("w:body").item(0)!;
  const children=Array.from(body.childNodes).filter(n=>n.nodeType===1),text=(node:typeof body)=>Array.from(node.getElementsByTagName("w:t")).map(t=>t.textContent??"").join("");
  const table=children.find(n=>n.nodeName==="w:tbl"&&text(n as typeof body).includes(values["party.owner.name"])&&text(n as typeof body).includes(values["party.counterparty.name"]))!;
  expect(children.findIndex(n=>(n as typeof body).getElementsByTagName("w:drawing").length>0)).toBeGreaterThan(children.indexOf(table));
  const before=children.slice(0,children.indexOf(table)).map(n=>text(n as typeof body)).join("");for(let i=begin;i<=end;i++)expect(before).toContain(edited&&i===editIndex?editText:input[`field.note${i}`]);
 }

});
it.each(["material-purchase-real-v1.docx","equipment-rental-real-v1.docx"])("keeps image attachments after the source-bound signature in %s",(name)=>{
 const source=readFileSync(join(__dirname,"../../assets/templates",name)),zip=new PizZip(source),doc=new DOMParser().parseFromString(zip.file("word/document.xml")!.asText(),"application/xml");
 const p=doc.getElementsByTagName("w:p").item(name.startsWith("material")?206:188)!,r=doc.createElement("w:r"),t=doc.createElement("w:t");t.textContent="{field.ownerNote}";r.appendChild(t);p.appendChild(r);zip.file("word/document.xml",new XMLSerializer().serializeToString(doc));
 const manual="虚构甲方手工内容".repeat(100),prepared=prepareLegacyPartyRoleBindings(source,zip.generate({type:"nodebuffer"}),{signatureBankAnchor:true});
 const rendered=renderContractDocx(prepared,{values:{...values,"field.ownerNote":manual}},[]),legacy=removeMechanicalPartyDetailsFromLegacyDocx(source,rendered,{rolesPrepared:true}),signed=appendLegacySignatureBankFields(source,legacy,values);
 const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=","base64"),attached=appendDocxImageAttachments(signed,[{name:"虚构附件一.png",type:"png",buffer:png},{name:"虚构附件二.png",type:"png",buffer:png}]);
 const output=new PizZip(attached),xml=new DOMParser().parseFromString(output.file("word/document.xml")!.asText(),"application/xml"),body=xml.getElementsByTagName("w:body").item(0)!,text=Array.from(body.getElementsByTagName("w:t")).map(n=>n.textContent??"").join("");
 expect(text).toContain(manual);for(const value of ["虚构甲开户行","A001","虚构乙开户行","B001"])expect(text).toContain(value);
 expect(output.file("word/media/contract-attachment-1.png")?.asNodeBuffer()).toEqual(png);
 expect(output.file("word/media/contract-attachment-2.png")?.asNodeBuffer()).toEqual(png);
 const raw=output.file("word/document.xml")!.asText();expect(raw.indexOf("虚构附件一.png")).toBeLessThan(raw.indexOf("虚构附件二.png"));
 const rels=output.file("word/_rels/document.xml.rels")!.asText();expect(rels).toContain("media/contract-attachment-1.png");expect(rels).toContain("media/contract-attachment-2.png");
 expect(body.getElementsByTagName("w:drawing").length).toBeGreaterThan(0);
 const children=Array.from(body.childNodes).filter(n=>n.nodeType===1);const drawing=children.findIndex(n=>(n as typeof body).getElementsByTagName("w:drawing").length>0);const signature=children.findIndex(n=>n.nodeName==="w:tbl"&&(n.textContent??"").includes(values["party.owner.name"])&&(n.textContent??"").includes(values["party.counterparty.name"]));expect(drawing).toBeGreaterThan(signature);
});

it.each(["material-purchase-real-v1.docx","equipment-rental-real-v1.docx"])("places images after the digital signature bound to %s",name=>{
 const source=readFileSync(join(__dirname,"../../assets/templates",name));
 const output=renderContractBody(source,source,{values},[],"layout",undefined,{partyDetailsVersion:"built-in-signature-supplement-company-v3"});
 const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=","base64");
 const result=appendDocxImageAttachments(output.docx,[{name:"虚构附件.png",type:"png",buffer:png}]);
 const body=new DOMParser().parseFromString(new PizZip(result).file("word/document.xml")!.asText(),"application/xml").getElementsByTagName("w:body").item(0)!;
 const nodes=Array.from(body.childNodes).filter(n=>n.nodeType===1),image=nodes.findIndex(n=>(n as typeof body).getElementsByTagName("w:drawing").length>0),signature=nodes.findIndex(n=>n.nodeName==="w:tbl"&&(n.textContent??"").includes(values["party.owner.name"])&&(n.textContent??"").includes(values["party.counterparty.name"]));
 expect(image).toBeGreaterThanOrEqual(0);expect(signature).toBeLessThan(image);
});

it.each([["material-purchase-real-v1.docx",207,214],["equipment-rental-real-v1.docx",189,195]])("moves numeric v2 mapped signature content for %s",(name,ownerIndex,otherIndex)=>{
 const source=readFileSync(join(__dirname,"../../assets/templates",name)),positions=readLayoutSourcePositions(source),find=(index:number)=>positions.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===index)!;
 const bindings=positions.positions.flatMap(position=>[["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
 for(const [index,fieldKey] of [[ownerIndex,"field.useLocation"],[otherIndex,"field.deliveryLocation"]] as const){const p=find(index);bindings.push({positionId:p.positionId,start:0,end:p.text.length,fieldKey});}
 const mapped=prepareLayoutSourceMapping(source,"fixture",1,bindings).docx,input={...values,"field.useLocation":"甲方虚构银行账号补充","field.deliveryLocation":"乙方虚构开户内容"},options={partyDetailsVersion:"built-in-signature-supplement-company-v3" as const,mappedSignatureSupplement:true};
 const original=renderContractBody(source,mapped,{values:input},[],"layout",undefined,{partyDetailsVersion:options.partyDetailsVersion}),preview=renderContractBody(source,mapped,{values:input},[],"layout",undefined,options);
 const tableText=(b:Buffer)=>{const d=new DOMParser().parseFromString(new PizZip(b).file("word/document.xml")!.asText(),"application/xml");return Array.from(d.getElementsByTagName("w:tbl")).find(t=>(t.textContent??"").includes(values["party.owner.name"])&&(t.textContent??"").includes(values["party.counterparty.name"]))!.textContent!;};
 expect(tableText(original.docx)).toContain(input["field.useLocation"]);expect(tableText(preview.docx)).not.toContain(input["field.useLocation"]);expect(tableText(preview.docx)).not.toContain(input["field.deliveryLocation"]);
 expect(preview.blocks.find(b=>b.id===find(ownerIndex).positionId)?.text).toContain(input["field.useLocation"]);expect(preview.blocks.find(b=>b.id===find(otherIndex).positionId)?.text).toContain(input["field.deliveryLocation"]);
 const plan={protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256:positions.sourceSha256,edits:[{positionId:find(ownerIndex).positionId,text:"甲方保存后账号自由原文"}]},pending=renderContractBody(source,mapped,{values:input},[],"layout",plan,{...options,partyDetailsConflictPreview:true});
 const saved={...plan,signatureSupplementReviewDigest:pending.signatureSupplementReview!.digest},exported=renderContractBody(source,mapped,{values:input},[],"layout",saved,options);expect(exported.blocks.find(b=>b.id===find(ownerIndex).positionId)?.text).toBe(plan.edits[0].text);expect(exported.blocks.find(b=>b.id===find(otherIndex).positionId)?.text).toContain(input["field.deliveryLocation"]);expect(tableText(exported.docx)).not.toContain(plan.edits[0].text);
});
it.each([["material-purchase-real-v1.docx",207,214],["equipment-rental-real-v1.docx",189,195]])("keeps the other mapped party and signature cells when numeric v2 supplement is deleted for %s",(name,ownerIndex,otherIndex)=>{
 const source=readFileSync(join(__dirname,"../../assets/templates",name)),positions=readLayoutSourcePositions(source),find=(i:number)=>positions.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===i)!;
 const bindings=positions.positions.flatMap(position=>[["{合同名称}","contract.name"],["{甲方名称}","party.owner.name"],["{乙方名称}","party.counterparty.name"],["{草稿编号}","contract.temporaryCode"],["{文档水印}","document.watermark"]].flatMap(([token,fieldKey])=>{const start=position.text.indexOf(token);return start<0?[]:[{positionId:position.positionId,start,end:start+token.length,fieldKey}];}));
 for(const [i,key] of [[ownerIndex,"field.useLocation"],[otherIndex,"field.deliveryLocation"]] as const){const p=find(i);bindings.push({positionId:p.positionId,start:0,end:p.text.length,fieldKey:key});}
 const mapped=prepareLayoutSourceMapping(source,"fixture",1,bindings).docx,input={...values,"field.useLocation":"甲方待删除银行文字","field.deliveryLocation":"乙方保留账户文字"},options={partyDetailsVersion:"built-in-signature-supplement-company-v3" as const,mappedSignatureSupplement:true};
 const before=renderContractBody(source,mapped,{values:input},[],"layout",undefined,options),plan={protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256:positions.sourceSha256,edits:[],deletedPositionIds:[find(ownerIndex).positionId]},after=renderContractBody(source,mapped,{values:input},[],"layout",plan,options);
 const body=(b:Buffer)=>new DOMParser().parseFromString(new PizZip(b).file("word/document.xml")!.asText(),"application/xml").getElementsByTagName("w:body").item(0)!;
 const table=(b:Buffer)=>Array.from(body(b).getElementsByTagName("w:tbl")).find(t=>(t.textContent??"").includes(values["party.owner.name"])&&(t.textContent??"").includes(values["party.counterparty.name"]))!.textContent;
 expect(table(after.docx)).toBe(table(before.docx));expect((body(before.docx).textContent??"").split(input["field.useLocation"]).length-(body(after.docx).textContent??"").split(input["field.useLocation"]).length).toBe(1);expect(after.blocks.some(b=>b.id===find(ownerIndex).positionId)).toBe(false);expect(after.blocks.find(b=>b.id===find(otherIndex).positionId)?.text).toContain(input["field.deliveryLocation"]);
});
it.each([["material-purchase-real-v1.docx",205],["equipment-rental-real-v1.docx",188]])("preserves numeric v2 supplement beside a source party binding for %s",(name,index)=>{
 const source=readFileSync(join(__dirname,"../../assets/templates",name)),zip=new PizZip(source),doc=new DOMParser().parseFromString(zip.file("word/document.xml")!.asText(),"application/xml"),p=doc.getElementsByTagName("w:p").item(index)!,run=doc.createElement("w:r"),t=doc.createElement("w:t");t.textContent="{field.ownerNote}";run.appendChild(t);p.appendChild(run);zip.file("word/document.xml",new XMLSerializer().serializeToString(doc));
 const manual="虚构补充原文含银行账号".repeat(15),output=renderContractBody(source,zip.generate({type:"nodebuffer"}),{values:{...values,"field.ownerNote":manual}},[],"layout",undefined,{partyDetailsVersion:"built-in-signature-supplement-company-v3",mappedSignatureSupplement:true}),body=new DOMParser().parseFromString(new PizZip(output.docx).file("word/document.xml")!.asText(),"application/xml").getElementsByTagName("w:body").item(0)!;
 const table=Array.from(body.getElementsByTagName("w:tbl")).find(x=>(x.textContent??"").includes(values["party.owner.name"])&&(x.textContent??"").includes(values["party.counterparty.name"]))!;expect(table.textContent).not.toContain(manual);expect(table.textContent).toContain(values["party.owner.name"]);expect(body.textContent).toContain(manual);
});

it.each([1, 100])("preserves legacy mechanical mapped supplement containing system labels, length %i",count=>{
 const source=readFileSync(join(__dirname,"../../assets/templates/equipment-rental-real-v1.docx")),zip=new PizZip(source),doc=new DOMParser().parseFromString(zip.file("word/document.xml")!.asText(),"application/xml");
 for(const [index,key] of [[189,"field.ownerNote"],[195,"field.otherNote"]] as const){const p=doc.getElementsByTagName("w:p").item(index)!,r=doc.createElement("w:r"),t=doc.createElement("w:t");t.textContent=`{${key}}`;r.appendChild(t);p.appendChild(r);}
 zip.file("word/document.xml",new XMLSerializer().serializeToString(doc));const mapped=zip.generate({type:"nodebuffer"});
 const a="甲方开票信息 乙方开票信息 甲方开户银行".repeat(count),b="乙方银行账号 甲方单位名称".repeat(count);
 const prepared=prepareLegacyPartyRoleBindings(source,mapped,{signatureBankAnchor:true,sourceBoundSystemFields:true}),rendered=renderContractDocx(prepared,{values:{...values,"field.ownerNote":a,"field.otherNote":b}},[]);
 const cleaned=removeMechanicalPartyDetailsFromLegacyDocx(source,rendered,{rolesPrepared:true,sourceBoundSystemFields:true}),signed=appendLegacySignatureBankFields(source,cleaned,values);
 const xml=new DOMParser().parseFromString(new PizZip(signed).file("word/document.xml")!.asText(),"application/xml"),all=xml.getElementsByTagName("w:body").item(0)!.textContent!;
 expect(all).toContain(a);expect(all).toContain(b);expect(all.indexOf(a)).toBeLessThan(all.indexOf(b));expect(all.indexOf(b)).toBeLessThan(all.lastIndexOf(values["party.owner.name"]));
});

it("refuses a modified source-bound system field or missing marker without discarding a draft",()=>{
 const source=readFileSync(join(__dirname,"../../assets/templates/equipment-rental-real-v1.docx")),zip=new PizZip(source),doc=new DOMParser().parseFromString(zip.file("word/document.xml")!.asText(),"application/xml");
 const paragraphs=Array.from(doc.getElementsByTagName("w:p")),field=paragraphs.find(p=>(p.textContent??"").replace(/\s+/gu,"").includes("甲方开票信息"))!,run=doc.createElement("w:r"),text=doc.createElement("w:t");text.textContent="{field.userNote}";run.appendChild(text);field.appendChild(run);zip.file("word/document.xml",new XMLSerializer().serializeToString(doc));
 expect(()=>prepareLegacyPartyRoleBindings(source,zip.generate({type:"nodebuffer"}),{signatureBankAnchor:true,sourceBoundSystemFields:true})).toThrow();
 const structural=new PizZip(source),structuralDoc=new DOMParser().parseFromString(structural.file("word/document.xml")!.asText(),"application/xml"),structuralField=Array.from(structuralDoc.getElementsByTagName("w:p")).find(p=>(p.textContent??"").replace(/\s+/gu,"").includes("甲方开票信息"))!;
 structuralField.appendChild(structuralDoc.createElement("w:proofErr"));structural.file("word/document.xml",new XMLSerializer().serializeToString(structuralDoc));
 expect(()=>prepareLegacyPartyRoleBindings(source,structural.generate({type:"nodebuffer"}),{signatureBankAnchor:true,sourceBoundSystemFields:true})).toThrow();
 const prepared=prepareLegacyPartyRoleBindings(source,source,{signatureBankAnchor:true,sourceBoundSystemFields:true}),rendered=renderContractDocx(prepared,{values},[]),out=new PizZip(rendered),xml=out.file("word/document.xml")!.asText();
 const damaged=xml.replace(/<w:bookmarkStart[^>]*w:name="jg_mechanical_system_field_0"[^>]*\/>/u,"");expect(damaged).not.toBe(xml);out.file("word/document.xml",damaged);
 expect(()=>removeMechanicalPartyDetailsFromLegacyDocx(source,out.generate({type:"nodebuffer"}),{rolesPrepared:true,sourceBoundSystemFields:true})).toThrow();
});

it("keeps mechanical system-label wording and source IDs through body save and reload",()=>{
 const source=readFileSync(join(__dirname,"../../assets/templates/equipment-rental-real-v1.docx")),positions=readLayoutSourcePositions(source),id=(index:number)=>positions.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===index)!.positionId;
 const edits=[{positionId:id(189),text:"甲方开票信息与开户银行：自由补充"},{positionId:id(195),text:"乙方开票信息与银行账号：自由补充"}],plan={protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256:positions.sourceSha256,edits},options={partyDetailsVersion:"built-in-legacy-body-signature-v1" as const};
 const first=renderContractBody(source,source,{values},[],"layout",plan,options),reloaded=renderContractBody(source,source,{values},[],"layout",JSON.parse(JSON.stringify(plan)),options);
 for(const edit of edits){expect(first.blocks.find(b=>b.id===edit.positionId)?.text).toBe(edit.text);expect(reloaded.blocks.find(b=>b.id===edit.positionId)?.text).toBe(edit.text);}
 const body=new DOMParser().parseFromString(new PizZip(reloaded.docx).file("word/document.xml")!.asText(),"application/xml").getElementsByTagName("w:body").item(0)!.textContent!;
 expect(body).toContain(edits[0].text);expect(body).toContain(edits[1].text);expect(body.indexOf(edits[0].text)).toBeLessThan(body.indexOf(edits[1].text));
});
