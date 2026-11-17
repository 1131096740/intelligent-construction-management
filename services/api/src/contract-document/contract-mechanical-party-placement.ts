import { createHash } from "node:crypto";
import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import PizZip from "pizzip";
import { assertBuiltInPartyPlacementPlan, builtInPartyPlacementKind, prepareBuiltInRoleParagraph, prepareGenericPartyParagraph } from "./contract-body-document";

/** Prepare only the two source-qualified body role lines before legacy rendering. */
export function prepareLegacyPartyRoleBindings(source:Buffer,mapped:Buffer):Buffer {
  const fail=()=>{throw new Error("合同主体信息位置无法核对，请联系管理员处理");};
  const kind=builtInPartyPlacementKind(createHash("sha256").update(source).digest("hex"));
  if(!kind) return fail();
  assertBuiltInPartyPlacementPlan(source,mapped,"",undefined);
  const zip=new PizZip(mapped),part=zip.file("word/document.xml");
  const originalPart=new PizZip(source).file("word/document.xml");
  if(!part||!originalPart) return fail();
  const doc=new DOMParser({onError:fail}).parseFromString(part.asText(),"application/xml");
  const paragraphs=Array.from(doc.getElementsByTagName("w:p"));
  const original=new DOMParser({onError:fail}).parseFromString(originalPart.asText(),"application/xml");
  const originals=Array.from(original.getElementsByTagName("w:p"));
  const roles=kind==="generic"?[]:kind==="mechanical"?[[28,"甲方"],[29,"乙方"]] as const:[[28,"买方"],[29,"卖方"]] as const;
  if(paragraphs.length!==originals.length||!roles.every(([index])=>paragraphs[index]&&originals[index])) return fail();
  for(const [index,label] of roles) prepareBuiltInRoleParagraph(paragraphs[index],label);
  if(kind==="generic") for(const index of [13,14,53,58]) {
    if(!paragraphs[index]||!originals[index]) return fail();
    const sourceText=Array.from(originals[index].getElementsByTagName("w:t")).map(node=>node.textContent??"").join("");
    prepareGenericPartyParagraph(paragraphs[index],sourceText,index);
  }
  zip.file("word/document.xml",new XMLSerializer().serializeToString(doc));
  return zip.generate({type:"nodebuffer"});
}

/** Only the reviewed built-in source may use these fixed mechanical coordinates. */
export function removeMechanicalPartyDetailsFromLegacyDocx(source:Buffer,bytes:Buffer,options:{rolesPrepared?:boolean}={}):Buffer {
  const fail=()=>{throw new Error("合同主体信息位置无法核对，请联系管理员处理");};
  const kind=builtInPartyPlacementKind(createHash("sha256").update(source).digest("hex"));
  if(!kind) return fail();
  const zip=new PizZip(bytes),part=zip.file("word/document.xml");
  if(!part) return fail();
  const doc=new DOMParser({onError:fail}).parseFromString(part.asText(),"application/xml");
  const paragraphs=Array.from(doc.getElementsByTagName("w:p"));
  const text=(p:Element)=>Array.from(p.getElementsByTagName("w:t")).map(n=>n.textContent??"").join("").replace(/\s+/gu,"");
  const fields=kind==="mechanical"?["甲方开票信息","乙方开票信息",...(["甲方","乙方"].flatMap(role=>["单位名称","纳税人类型","统一社会信用代码","注册地址","联系电话","开户银行","银行账号"].map(field=>role+field)))]:[];
  for(const field of fields){
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
