import {readFileSync} from "node:fs";
import {join} from "node:path";
import {DOMParser,XMLSerializer} from "@xmldom/xmldom";
import PizZip from "pizzip";
import {prepareLegacyPartyRoleBindings,removeMechanicalPartyDetailsFromLegacyDocx} from "./contract-mechanical-party-placement";
import {renderContractDocx} from "./contract-docx-renderer";
import {addGenericBankBlanksToDocx,assertGenericBankInputs,GENERIC_SIGNATURE_HEADING_VERSION} from "./generic-bank-blanks";
import {appendDocxImageAttachments} from "./docx-attachment-appender";
import {readLayoutSourcePositions} from "../contract-template/layout-field-mapping";
import {assertSignatureSupplementMapping,renderContractBody} from "./contract-body-document";
const source=readFileSync(join(__dirname,"../../assets/templates/generic-contract-v1.docx"));
const values={"contract.name":"虚构合同","contract.temporaryCode":"TEST","document.watermark":"草稿","party.owner.name":"虚构甲方","party.counterparty.name":"虚构乙方"};
it("requires explicit review and moves both original edits before the generic signature table",()=>{
 const parsed=readLayoutSourcePositions(source),id=(i:number)=>parsed.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===i)!.positionId;
 const plan={protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256:parsed.sourceSha256,edits:[{positionId:id(54),text:"甲方补充原文"},{positionId:id(59),text:"乙方补充原文"}]};
 const options={partyDetailsVersion:"built-in-generic-signature-review-v3" as never};
 expect(()=>renderContractBody(source,source,{values},[],"layout",plan,options)).toThrow("核对");
 const preview=renderContractBody(source,source,{values},[],"layout",plan,{...options,partyDetailsConflictPreview:true});
 expect(preview.signatureSupplementReview?.entries).toEqual([{role:"party_a",id:id(54),text:"甲方补充原文"},{role:"party_b",id:id(59),text:"乙方补充原文"}]);
 const reviewed={...plan,signatureSupplementReviewDigest:preview.signatureSupplementReview!.digest};
 const doc=renderContractBody(source,source,{values},[],"layout",reviewed,options).docx;
 const xml=new DOMParser().parseFromString(new PizZip(doc).file("word/document.xml")!.asText(),"application/xml");
 const body=xml.getElementsByTagName("w:body").item(0)!;const table=Array.from(body.getElementsByTagName("w:tbl")).find(t=>t.textContent?.includes("甲方（盖章）"))!;
 expect(table.textContent).not.toContain("甲方补充原文");expect(table.textContent).not.toContain("乙方补充原文");
 const text=body.textContent!;expect(text.indexOf("甲方补充原文")).toBeLessThan(text.indexOf("乙方补充原文"));expect(text.indexOf("乙方补充原文")).toBeLessThan(text.indexOf("甲方（盖章）"));
 expect(()=>renderContractBody(source,source,{values},[],"layout",{...reviewed,edits:[{...plan.edits[0],text:"修改后"},plan.edits[1]]},options)).toThrow("核对");
  const changedZip=new PizZip(source),changedXml=changedZip.file("word/document.xml")!.asText(),changed=changedXml.replace("第一条","第一条测试");
  expect(changed).not.toBe(changedXml);changedZip.file("word/document.xml",changed);
  expect(()=>renderContractBody(source,changedZip.generate({type:"nodebuffer"}),{values},[],"layout",reviewed,options)).toThrow("核对");
});
it("preserves the old version and refuses mapped signature text even without edits",()=>{
 const parsed=readLayoutSourcePositions(source),id=parsed.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===54)!.positionId;
 const plan={protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256:parsed.sourceSha256,edits:[{positionId:id,text:"保留旧签署编辑"}]};
 const old=renderContractBody(source,source,{values},[],"layout",plan,{partyDetailsVersion:"built-in-generic-bank-values-v2"}).docx;
 const oldXml=new DOMParser().parseFromString(new PizZip(old).file("word/document.xml")!.asText(),"application/xml");
 expect(Array.from(oldXml.getElementsByTagName("w:tbl")).some(table=>table.textContent?.includes("保留旧签署编辑"))).toBe(true);
 const zip=new PizZip(source),doc=new DOMParser().parseFromString(zip.file("word/document.xml")!.asText(),"application/xml");
 const paragraph=doc.getElementsByTagName("w:p").item(54)!,text=paragraph.getElementsByTagName("w:t").item(0)!;text.textContent="{field.useLocation}";
 zip.file("word/document.xml",new XMLSerializer().serializeToString(doc));const mapped=zip.generate({type:"nodebuffer"});
 expect(()=>assertSignatureSupplementMapping(source,mapped,"layout",undefined)).toThrow("映射冲突");
 expect(()=>renderContractBody(source,mapped,{values},[],"layout",plan,{partyDetailsVersion:"built-in-generic-signature-review-v3" as never})).toThrow("映射冲突");
 const preview=renderContractBody(source,mapped,{values},[],"layout",plan,{partyDetailsVersion:"built-in-generic-signature-review-v3" as never,partyDetailsConflictPreview:true});
 expect(preview.partyDetailsMappingConflict).toBe(true);expect(plan.edits[0].text).toBe("保留旧签署编辑");
});
it("retains long original texts and party order in the new body snapshot",()=>{
 const parsed=readLayoutSourcePositions(source),id=(i:number)=>parsed.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===i)!.positionId;
 const owner="甲方补充".repeat(1500),other="乙方补充".repeat(1500);
 const plan={protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256:parsed.sourceSha256,edits:[{positionId:id(54),text:owner},{positionId:id(59),text:other}]};
 const options={partyDetailsVersion:"built-in-generic-signature-review-v3" as never};
 const preview=renderContractBody(source,source,{values},[],"layout",plan,{...options,partyDetailsConflictPreview:true});
 const out=renderContractBody(source,source,{values},[],"layout",{...plan,signatureSupplementReviewDigest:preview.signatureSupplementReview!.digest},options);
 const doc=new DOMParser().parseFromString(new PizZip(out.docx).file("word/document.xml")!.asText(),"application/xml"),all=doc.documentElement!.textContent!;
 expect(all).toContain(owner);expect(all).toContain(other);expect(all.indexOf(owner)).toBeLessThan(all.indexOf(other));expect(plan.edits.map(edit=>edit.text)).toEqual([owner,other]);
});
it("places a synthetic image after the source-bound generic signing table",()=>{
 const output=renderContractBody(source,source,{values},[],"layout",undefined,{partyDetailsVersion:"built-in-generic-signature-review-v3"});
 const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=","base64");
 const docx=appendDocxImageAttachments(output.docx,[{name:"虚构图片.png",type:"png",buffer:png}]);
 const body=new DOMParser().parseFromString(new PizZip(docx).file("word/document.xml")!.asText(),"application/xml").getElementsByTagName("w:body").item(0)!;
 const nodes=Array.from(body.childNodes).filter(n=>n.nodeType===1),image=nodes.findIndex(n=>(n as typeof body).getElementsByTagName("w:drawing").length>0),signature=nodes.findIndex(n=>n.nodeName==="w:tbl"&&(n.textContent??"").includes("甲方（盖章）"));
 expect(image).toBeGreaterThanOrEqual(0);expect(image).toBeGreaterThan(signature);
});
it("places an image after the source-bound generic legacy signing table",()=>{
 const prepared=prepareLegacyPartyRoleBindings(source,source,{});
 const rendered=renderContractDocx(prepared,{values},[]),cleaned=removeMechanicalPartyDetailsFromLegacyDocx(source,rendered,{rolesPrepared:true}),signed=addGenericBankBlanksToDocx(cleaned,values);
 const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=","base64");
 const output=appendDocxImageAttachments(signed,[{name:"虚构图片.png",type:"png",buffer:png}]);
 const body=new DOMParser().parseFromString(new PizZip(output).file("word/document.xml")!.asText(),"application/xml").getElementsByTagName("w:body").item(0)!;
 const nodes=Array.from(body.childNodes).filter(n=>n.nodeType===1),image=nodes.findIndex(n=>(n as typeof body).getElementsByTagName("w:drawing").length>0),signature=nodes.findIndex(n=>n.nodeName==="w:tbl"&&(n.textContent??"").includes("甲方（盖章）"));expect(image).toBeGreaterThanOrEqual(0);expect(image).toBeGreaterThan(signature);
});
it("preserves reviewed free text containing bank words without classifying it as template bank data",()=>{
 const parsed=readLayoutSourcePositions(source),id=parsed.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===54)!.positionId;
 const text="虚构甲方补充：银行账号信息应按双方约定复核",plan={protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256:parsed.sourceSha256,edits:[{positionId:id,text}]};
 expect(()=>assertGenericBankInputs(source,source,values,plan,{editsMovedToSupplement:true})).not.toThrow();
 const preview=renderContractBody(source,source,{values},[],"layout",plan,{partyDetailsVersion:"built-in-generic-signature-review-v3",partyDetailsConflictPreview:true});
 const output=renderContractBody(source,source,{values},[],"layout",{...plan,signatureSupplementReviewDigest:preview.signatureSupplementReview!.digest},{partyDetailsVersion:"built-in-generic-signature-review-v3"});
 expect(output.blocks.some(block=>block.text===text)).toBe(true);
 const xml=new DOMParser().parseFromString(new PizZip(output.docx).file("word/document.xml")!.asText(),"application/xml"),body=xml.getElementsByTagName("w:body").item(0)!;
 expect(body.textContent!.indexOf(text)).toBeLessThan(body.textContent!.lastIndexOf("甲方（盖章）"));
});
it("moves mapped generic signature data before the signing table by party while preserving values and IDs",()=>{
 const zip=new PizZip(source),doc=new DOMParser().parseFromString(zip.file("word/document.xml")!.asText(),"application/xml"),paras=doc.getElementsByTagName("w:p");
 for(const [index,key] of [[54,"field.noteA"],[59,"field.noteB"]] as const){const p=paras.item(index)!,r=doc.createElement("w:r"),t=doc.createElement("w:t");t.textContent=`{${key}}`;r.appendChild(t);p.appendChild(r);}
 zip.file("word/document.xml",new XMLSerializer().serializeToString(doc));const mapped=zip.generate({type:"nodebuffer"}),input={...values,"field.noteA":"甲方银行账号自由补充","field.noteB":"乙方开户自由补充"};
 const result=renderContractBody(source,mapped,{values:input},[],"layout",undefined,{partyDetailsVersion:"built-in-generic-signature-review-v3",genericMappedSupplement:true});
 const parsed=readLayoutSourcePositions(source),a=parsed.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===54)!.positionId,b=parsed.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===59)!.positionId;
 expect(result.blocks.find(block=>block.id===a)?.text).toContain(input["field.noteA"]);expect(result.blocks.find(block=>block.id===b)?.text).toContain(input["field.noteB"]);
 const body=new DOMParser().parseFromString(new PizZip(result.docx).file("word/document.xml")!.asText(),"application/xml").getElementsByTagName("w:body").item(0)!,all=body.textContent!;
 expect(all.indexOf(input["field.noteA"])).toBeLessThan(all.indexOf(input["field.noteB"]));expect(all.indexOf(input["field.noteB"])).toBeLessThan(all.lastIndexOf("甲方（盖章）"));
});
it("retains mapped legacy generic free text before the source signing table",()=>{
 const zip=new PizZip(source),doc=new DOMParser().parseFromString(zip.file("word/document.xml")!.asText(),"application/xml"),paras=doc.getElementsByTagName("w:p");
 for(const [index,key] of [[54,"field.noteA"],[59,"field.noteB"]] as const){const p=paras.item(index)!,r=doc.createElement("w:r"),t=doc.createElement("w:t");t.textContent=`{${key}}`;r.appendChild(t);p.appendChild(r);}
 zip.file("word/document.xml",new XMLSerializer().serializeToString(doc));const mapped=zip.generate({type:"nodebuffer"}),input={...values,"field.noteA":"甲方银行账号自由补充","field.noteB":"乙方开户自由补充"};
 const prepared=prepareLegacyPartyRoleBindings(source,mapped,{genericMappedSupplement:true}),rendered=renderContractDocx(prepared,{values:input},[]),cleaned=removeMechanicalPartyDetailsFromLegacyDocx(source,rendered,{rolesPrepared:true}),signed=addGenericBankBlanksToDocx(cleaned,input);
 const body=new DOMParser().parseFromString(new PizZip(signed).file("word/document.xml")!.asText(),"application/xml").getElementsByTagName("w:body").item(0)!,all=body.textContent!;
 expect(all.indexOf(input["field.noteA"])).toBeLessThan(all.indexOf(input["field.noteB"]));expect(all.indexOf(input["field.noteB"])).toBeLessThan(all.lastIndexOf("甲方（盖章）"));
});
it("keeps all mapped generic source IDs and reviewed text through preview and saved rendering",()=>{
 const zip=new PizZip(source),doc=new DOMParser().parseFromString(zip.file("word/document.xml")!.asText(),"application/xml"),paras=doc.getElementsByTagName("w:p"),input:Record<string,string>={...values};
 for(const index of [54,55,56,57,59,60,61,62]){const key=`field.note${index}`,p=paras.item(index)!,r=doc.createElement("w:r"),t=doc.createElement("w:t");t.textContent=`{${key}}`;r.appendChild(t);p.appendChild(r);input[key]=`虚构账号补充${index}`;}
 zip.file("word/document.xml",new XMLSerializer().serializeToString(doc));const mapped=zip.generate({type:"nodebuffer"}),parsed=readLayoutSourcePositions(source),ids=[54,55,56,57,59,60,61,62].map(i=>parsed.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===i)!.positionId),options={partyDetailsVersion:"built-in-generic-signature-review-v3" as const,genericMappedSupplement:true};
 const preview=renderContractBody(source,mapped,{values:input},[],"layout",undefined,options);for(const id of ids)expect(preview.blocks.some(block=>block.id===id)).toBe(true);
 const plan={protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256:parsed.sourceSha256,edits:[{positionId:ids[0],text:"甲方手工银行文字"},{positionId:ids[4],text:"乙方手工账号文字"}]};
 const pending=renderContractBody(source,mapped,{values:input},[],"layout",plan,{...options,partyDetailsConflictPreview:true}),saved={...plan,signatureSupplementReviewDigest:pending.signatureSupplementReview!.digest},after=renderContractBody(source,mapped,{values:input},[],"layout",saved,options);
 expect(after.blocks.find(block=>block.id===ids[0])?.text).toBe(plan.edits[0].text);expect(after.blocks.find(block=>block.id===ids[4])?.text).toBe(plan.edits[1].text);
 const text=new DOMParser().parseFromString(new PizZip(after.docx).file("word/document.xml")!.asText(),"application/xml").getElementsByTagName("w:body").item(0)!.textContent!;expect(text.indexOf(plan.edits[0].text)).toBeLessThan(text.indexOf(plan.edits[1].text));expect(text.indexOf(plan.edits[1].text)).toBeLessThan(text.lastIndexOf("甲方（盖章）"));
});
it.each([[54,59,true],[54,59,false],[59,54,true],[59,54,false]])("removes mapped supplement %i and preserves the other party %i (edited: %s)",(removedIndex,otherIndex,editOther)=>{
 const zip=new PizZip(source),doc=new DOMParser().parseFromString(zip.file("word/document.xml")!.asText(),"application/xml"),paras=doc.getElementsByTagName("w:p"),input:Record<string,string>={...values};
 for(const index of [54,59]){const key=`field.note${index}`,p=paras.item(index)!,r=doc.createElement("w:r"),t=doc.createElement("w:t");t.textContent=`{${key}}`;r.appendChild(t);p.appendChild(r);input[key]=`保留测试映射值${index}`;}
 zip.file("word/document.xml",new XMLSerializer().serializeToString(doc));const mapped=zip.generate({type:"nodebuffer"}),parsed=readLayoutSourcePositions(source),id=(i:number)=>parsed.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===i)!.positionId,options={partyDetailsVersion:"built-in-generic-signature-review-v3" as const,genericMappedSupplement:true};
 const baseline=renderContractBody(source,mapped,{values:input},[],"layout",undefined,options),plan={protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256:parsed.sourceSha256,deletedPositionIds:[id(removedIndex)],edits:editOther?[{positionId:id(otherIndex),text:`另一方原样编辑${otherIndex}`}]:[]};
 const pending=renderContractBody(source,mapped,{values:input},[],"layout",plan,{...options,partyDetailsConflictPreview:true}),saved={...plan,...(pending.signatureSupplementReview?{signatureSupplementReviewDigest:pending.signatureSupplementReview.digest}:{})},result=renderContractBody(source,mapped,{values:input},[],"layout",saved,options);
 const bodyOf=(bytes:Buffer)=>new DOMParser().parseFromString(new PizZip(bytes).file("word/document.xml")!.asText(),"application/xml").getElementsByTagName("w:body").item(0)!;
 const signature=(bytes:Buffer)=>Array.from(bodyOf(bytes).getElementsByTagName("w:tbl")).find(t=>(t.textContent??"").includes("甲方（盖章）"))!.textContent;
 expect(signature(result.docx)).toBe(signature(baseline.docx));
 expect(result.blocks.some(block=>block.id===id(removedIndex))).toBe(false);expect(bodyOf(result.docx).textContent).not.toContain(input[`field.note${removedIndex}`]);
 const expected=editOther?plan.edits[0].text:input[`field.note${otherIndex}`];expect(result.blocks.find(block=>block.id===id(otherIndex))?.text).toContain(expected);expect(bodyOf(result.docx).textContent).toContain(expected);
});
it.each(["party.owner.name","party.counterparty.name","field.counterpartyName"])("rejects mixed automatic subject and free mapping in a generic signature cell: %s",partyKey=>{
 const zip=new PizZip(source),doc=new DOMParser().parseFromString(zip.file("word/document.xml")!.asText(),"application/xml"),p=doc.getElementsByTagName("w:p").item(54)!,r=doc.createElement("w:r"),t=doc.createElement("w:t");t.textContent=`{${partyKey}}{field.freeNote}`;r.appendChild(t);p.appendChild(r);zip.file("word/document.xml",new XMLSerializer().serializeToString(doc));const mapped=zip.generate({type:"nodebuffer"}),input={...values,"field.freeNote":"虚构手工原文账号"};
 expect(()=>assertSignatureSupplementMapping(source,mapped,"layout",undefined,{genericMappedSupplement:true})).toThrow("签署区");
 expect(()=>renderContractBody(source,mapped,{values:input},[],"layout",undefined,{partyDetailsVersion:"built-in-generic-signature-review-v3",genericMappedSupplement:true})).toThrow("签署区");
 expect(()=>prepareLegacyPartyRoleBindings(source,mapped,{genericMappedSupplement:true})).toThrow("签署区");
});

it("moves the original signing heading and its user anchor after the page break as a frozen generic variant", () => {
 const parsed=readLayoutSourcePositions(source);
 const id=(i:number)=>parsed.positions.find(p=>p.part==="word/document.xml"&&p.paragraphIndex===i)!.positionId;
 const plan={protocolVersion:1,layoutTemplateVersionId:"layout",sourceSha256:parsed.sourceSha256,
  edits:[{positionId:id(52),text:"用户保留原签署标题"},{positionId:id(54),text:"甲方授权签署原文"}],
  additions:[{id:"title-note",afterPositionId:id(52),text:"用户标题锚点增补"}]};
 const options={partyDetailsVersion:"built-in-generic-signature-review-v3" as const,genericMappedSupplement:true};
 const preview=renderContractBody(source,source,{values},[],"layout",plan,{...options,partyDetailsConflictPreview:true});
 const reviewed={...plan,signatureSupplementReviewDigest:preview.signatureSupplementReview!.digest};
 const roles=(docx:Buffer)=>{
  const doc=new DOMParser().parseFromString(new PizZip(docx).file("word/document.xml")!.asText(),"application/xml");
  return Array.from(doc.getElementsByTagName("w:body").item(0)!.childNodes)
   .filter(node=>node.nodeType===1).map(node=>node.toString().includes('w:br w:type="page"')?"分页":node.textContent?.trim());
 };
 const before=roles(renderContractBody(source,source,{values},[],"layout",reviewed,options).docx);
 const after=roles(renderContractBody(source,source,{values},[],"layout",reviewed,
  {...options,genericSignatureHeadingVersion:GENERIC_SIGNATURE_HEADING_VERSION}).docx);
 const main=after.findIndex(text=>text?.startsWith("甲方（盖章）"));
 expect(before.indexOf("用户保留原签署标题")).toBeLessThan(before.lastIndexOf("分页"));
 expect(after.slice(main-4,main)).toEqual(["甲方授权签署原文","分页","用户保留原签署标题","补充条款1：用户标题锚点增补"]);
});
