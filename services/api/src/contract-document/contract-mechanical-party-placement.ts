import { reviewedBuiltinTemplateKind } from "./builtin-template-parts";
import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import PizZip from "pizzip";
import { assertBuiltInPartyPlacementPlan, prepareBuiltInRoleParagraph, prepareGenericPartyParagraph } from "./contract-body-document";
import { appendSignatureBankFields } from "./contract-signature-bank-fields";
import { legacySignatureMappedParagraphs } from "./contract-legacy-signature-mapping";

const mechanicalSystemFields=["甲方开票信息","乙方开票信息",...(["甲方","乙方"].flatMap(role=>["单位名称","纳税人类型","统一社会信用代码","注册地址","联系电话","开户银行","银行账号"].map(field=>role+field)))];
const systemFieldMarkerPrefix="jg_mechanical_system_field_";

/** Prepare only the two source-qualified body role lines before legacy rendering. */
export function prepareLegacyPartyRoleBindings(source:Buffer,mapped:Buffer,options:{signatureBankAnchor?:boolean;genericMappedSupplement?:boolean;sourceBoundSystemFields?:boolean}={}):Buffer {
  const fail=()=>{throw new Error("合同主体信息位置无法核对，请联系管理员处理");};
  const kind=reviewedBuiltinTemplateKind(source);
  if(!kind) return fail();
  assertBuiltInPartyPlacementPlan(source,mapped,"",undefined);
  const zip=new PizZip(mapped),part=zip.file("word/document.xml");
  const originalPart=new PizZip(source).file("word/document.xml");
  if(!part||!originalPart) return fail();
  const doc=new DOMParser({onError:fail}).parseFromString(part.asText(),"application/xml");
  const paragraphs=Array.from(doc.getElementsByTagName("w:p"));
  const original=new DOMParser({onError:fail}).parseFromString(originalPart.asText(),"application/xml");
  const originals=Array.from(original.getElementsByTagName("w:p"));
  const roles=kind==="generic"?[]:kind==="labor"?[[27,"发包人"],[28,"承包人"]] as const:kind==="mechanical"?[[28,"甲方"],[29,"乙方"]] as const:[[28,"买方"],[29,"卖方"]] as const;
  if(paragraphs.length!==originals.length||!roles.every(([index])=>paragraphs[index]&&originals[index])) return fail();
  if(options.sourceBoundSystemFields){
    if(kind!=="mechanical")return fail();
    const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main",body=doc.getElementsByTagNameNS(W,"body").item(0);
    const text=(p:Element)=>Array.from(p.getElementsByTagNameNS(W,"t")).map(n=>n.textContent??"").join("");
    const starts=Array.from(doc.getElementsByTagNameNS(W,"bookmarkStart"));
    if(starts.some(n=>(n.getAttributeNS(W,"name")??"").startsWith(systemFieldMarkerPrefix)))return fail();
    const used=new Set(starts.map(n=>n.getAttributeNS(W,"id")));let markerId=0;
    for(const [i,field] of mechanicalSystemFields.entries()){
      const indexes=originals.flatMap((p,index)=>text(p).replace(/\s+/gu,"").includes(field)?[index]:[]);
      if(indexes.length!==1)return fail();const index=indexes[0],p=paragraphs[index];
      if(!body||!p||p.parentNode!==body||new XMLSerializer().serializeToString(p)!==new XMLSerializer().serializeToString(originals[index]))return fail();
      while(used.has(String(markerId)))markerId++;const id=String(markerId++);used.add(id);
      const start=doc.createElementNS(W,"w:bookmarkStart"),end=doc.createElementNS(W,"w:bookmarkEnd");start.setAttributeNS(W,"w:id",id);start.setAttributeNS(W,"w:name",systemFieldMarkerPrefix+i);end.setAttributeNS(W,"w:id",id);p.appendChild(start);p.appendChild(end);
    }
  }
  for(const [index,label] of roles) prepareBuiltInRoleParagraph(paragraphs[index],label);
  if(kind==="generic") for(const index of [13,14,53,58]) {
    if(!paragraphs[index]||!originals[index]) return fail();
    const sourceText=Array.from(originals[index].getElementsByTagName("w:t")).map(node=>node.textContent??"").join("");
    prepareGenericPartyParagraph(paragraphs[index],sourceText,index);
  }
  if(kind==="labor") for(const index of [156,159]) {
    const paragraph=paragraphs[index];
    if(!paragraph) return fail();
    for(const node of Array.from(paragraph.getElementsByTagName("w:t"))) node.textContent="";
  }
  if(options.genericMappedSupplement){
    if(kind!=="generic")return fail();
    const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main",body=doc.getElementsByTagNameNS(W,"body").item(0);
    let table=paragraphs[53]?.parentNode;while(table&&table.parentNode!==body)table=table.parentNode;
    if(!body||!table||(table as Element).localName!=="tbl")return fail();
    if(options.genericMappedSupplement){
    const moved=legacySignatureMappedParagraphs("generic",originals,paragraphs);
    for(const index of [54,55,56,57,59,60,61,62]) {
      const text=(element:Element)=>Array.from(element.getElementsByTagNameNS(W,"t")).map(node=>node.textContent??"").join("");
      if(text(paragraphs[index])!==text(originals[index])&&!moved.some(entry=>entry.index===index))return fail();
    }
    for(const role of [0,1]){const selected=moved.filter(entry=>entry.role===role);if(!selected.length)continue;
      const heading=doc.createElementNS(W,"w:p"),run=doc.createElementNS(W,"w:r"),t=doc.createElementNS(W,"w:t");t.appendChild(doc.createTextNode(role===0?"甲方补充信息":"乙方补充信息"));run.appendChild(t);heading.appendChild(run);body.insertBefore(heading,table);
      for(const {index} of selected){const paragraph=paragraphs[index];paragraph.parentNode!.replaceChild(doc.importNode(originals[index],true),paragraph);body.insertBefore(paragraph,table);}
    }
    }

  }
  if(options.signatureBankAnchor){
    if(kind!=="material"&&kind!=="mechanical")return fail();
    const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main",body=doc.getElementsByTagNameNS(W,"body").item(0);
    const ranges=kind==="material"?[[205,211],[212,218]]:[[187,192],[193,198]];
    let table=paragraphs[ranges[0][0]]?.parentNode;while(table&&table.parentNode!==body)table=table.parentNode;
    if(!body||!table||(table as Element).localName!=="tbl")return fail();
    const mappedPositions=legacySignatureMappedParagraphs(kind,originals,paragraphs);
    for(const role of [0,1]){
      const moved:Element[]=[];
      for(const {index,hasParty} of mappedPositions.filter(item=>item.role===role)){
        const p=paragraphs[index],original=originals[index];p.parentNode!.replaceChild(doc.importNode(original,true),p);
        if(hasParty)prepareBuiltInRoleParagraph(p,role===0?"甲方":"乙方");moved.push(p);
      }
      if(moved.length){const heading=doc.createElementNS(W,"w:p"),run=doc.createElementNS(W,"w:r"),t=doc.createElementNS(W,"w:t");t.appendChild(doc.createTextNode(role===0?"甲方补充信息":"乙方补充信息"));run.appendChild(t);heading.appendChild(run);body.insertBefore(heading,table);for(const p of moved)body.insertBefore(p,table);}
    }
    const markerName="jg_legacy_signature_bank_anchor",starts=Array.from(doc.getElementsByTagNameNS(W,"bookmarkStart"));if(starts.some(node=>node.getAttributeNS(W,"name")===markerName))return fail();
    const used=new Set(starts.map(node=>node.getAttributeNS(W,"id")));let id=0;while(used.has(String(id)))id++;
    const first=(table as Element).getElementsByTagNameNS(W,"p").item(0);if(!first)return fail();
    const start=doc.createElementNS(W,"w:bookmarkStart"),end=doc.createElementNS(W,"w:bookmarkEnd");start.setAttributeNS(W,"w:id",String(id));start.setAttributeNS(W,"w:name",markerName);end.setAttributeNS(W,"w:id",String(id));first.appendChild(start);first.appendChild(end);
  }
  zip.file("word/document.xml",new XMLSerializer().serializeToString(doc));
  return zip.generate({type:"nodebuffer"});
}

/** Only the reviewed built-in source may use these fixed mechanical coordinates. */
export function removeMechanicalPartyDetailsFromLegacyDocx(source:Buffer,bytes:Buffer,options:{rolesPrepared?:boolean;sourceBoundSystemFields?:boolean}={}):Buffer {
  const fail=()=>{throw new Error("合同主体信息位置无法核对，请联系管理员处理");};
  const kind=reviewedBuiltinTemplateKind(source);
  if(!kind) return fail();
  const zip=new PizZip(bytes),part=zip.file("word/document.xml");
  if(!part) return fail();
  const doc=new DOMParser({onError:fail}).parseFromString(part.asText(),"application/xml");
  const paragraphs=Array.from(doc.getElementsByTagName("w:p"));
  const text=(p:Element)=>Array.from(p.getElementsByTagName("w:t")).map(n=>n.textContent??"").join("").replace(/\s+/gu,"");
  const fields=kind==="mechanical"?mechanicalSystemFields:[];
  if(options.sourceBoundSystemFields){
    if(kind!=="mechanical")return fail();const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main",body=doc.getElementsByTagNameNS(W,"body").item(0);
    const starts=Array.from(doc.getElementsByTagNameNS(W,"bookmarkStart")),ends=Array.from(doc.getElementsByTagNameNS(W,"bookmarkEnd"));
    const remove:Element[]=[];
    for(const [i] of fields.entries()){
      const found=starts.filter(n=>n.getAttributeNS(W,"name")===systemFieldMarkerPrefix+i);if(found.length!==1)return fail();
      const marker=found[0],id=marker.getAttributeNS(W,"id"),end=ends.filter(n=>n.getAttributeNS(W,"id")===id),p=marker.parentNode;
      if(!body||!p||(p as Element).localName!=="p"||p.parentNode!==body||end.length!==1||end[0].parentNode!==p||remove.includes(p as Element))return fail();remove.push(p as Element);
    }
    for(const p of remove)body!.removeChild(p);
  }
  for(const field of options.sourceBoundSystemFields?[]:fields){
    const matches=paragraphs.filter(p=>text(p).includes(field));
    if(matches.length!==1||!matches[0].parentNode) return fail();
    matches[0].parentNode.removeChild(matches[0]);
  }
  for(const role of options.rolesPrepared?[]:kind==="mechanical"?["甲方（承租方）","乙方（出租方）"]:["买方：","卖方："]){
    const matches=paragraphs.filter(p=>text(p).includes(role));
    if(matches.length!==1) return fail();
    const nodes=Array.from(matches[0].getElementsByTagName("w:t"));
    if(nodes.length===0) return fail();
    nodes[0].textContent=role.endsWith("：")?role:role+"：";
    for(const node of nodes.slice(1))node.textContent="";
  }
  zip.file("word/document.xml",new XMLSerializer().serializeToString(doc));
  return zip.generate({type:"nodebuffer"});
}

/** Source-qualified new legacy output, leaving existing snapshots unchanged. */
export function appendLegacySignatureBankFields(source:Buffer,bytes:Buffer,values:Record<string,unknown>):Buffer {
 const kind=reviewedBuiltinTemplateKind(source),owner=values["party.owner.name"],other=values["party.counterparty.name"];
 const fail=()=>{throw new Error("合同签署区位置无法核对，请联系合同管理员处理");};
 if((kind!=="material"&&kind!=="mechanical")||typeof owner!=="string"||!owner.trim()||typeof other!=="string"||!other.trim())return fail();
 const zip=new PizZip(bytes),part=zip.file("word/document.xml");if(!part)return fail();const doc=new DOMParser({onError:fail}).parseFromString(part.asText(),"application/xml"),W="http://schemas.openxmlformats.org/wordprocessingml/2006/main",body=doc.getElementsByTagNameNS(W,"body").item(0);
 if(!body)return fail();
 const text=(v:Element)=>Array.from(v.getElementsByTagNameNS(W,"t")).map(node=>node.textContent??"").join("");
 const starts=Array.from(doc.getElementsByTagNameNS(W,"bookmarkStart")).filter(node=>node.getAttributeNS(W,"name")==="jg_legacy_signature_bank_anchor");if(starts.length!==1)return fail();
 const start=starts[0],markerId=start.getAttributeNS(W,"id"),ends=Array.from(doc.getElementsByTagNameNS(W,"bookmarkEnd")).filter(node=>node.getAttributeNS(W,"id")===markerId);if(ends.length!==1)return fail();
 let outer=start.parentNode;while(outer&&outer.parentNode!==body)outer=outer.parentNode;if(!outer||(outer as Element).namespaceURI!==W||(outer as Element).localName!=="tbl")return fail();
 const table=outer as Element,rows=Array.from(table.childNodes).filter(n=>n.nodeType===1&&(n as Element).namespaceURI===W&&(n as Element).localName==="tr");if(rows.length!==1)return fail();
 const cells=Array.from(rows[0].childNodes).filter(n=>n.nodeType===1&&(n as Element).namespaceURI===W&&(n as Element).localName==="tc") as Element[];if(cells.length!==2||!text(cells[0]).includes(owner)||!text(cells[1]).includes(other))return fail();
 const first=table.getElementsByTagNameNS(W,"p").item(0);if(!first)return fail();
 let props=Array.from(first.childNodes).find(node=>node.nodeType===1&&(node as Element).namespaceURI===W&&(node as Element).localName==="pPr") as Element|undefined;if(!props){props=doc.createElementNS(W,"w:pPr");first.insertBefore(props,first.firstChild);}if(!Array.from(props.childNodes).some(node=>node.nodeType===1&&(node as Element).namespaceURI===W&&(node as Element).localName==="pageBreakBefore"))props.insertBefore(doc.createElementNS(W,"w:pageBreakBefore"),props.firstChild);
 appendSignatureBankFields(doc,table,values,{compact:true});
 start.parentNode!.removeChild(start);ends[0].parentNode!.removeChild(ends[0]);zip.file("word/document.xml",new XMLSerializer().serializeToString(doc));return zip.generate({type:"nodebuffer"});
}
