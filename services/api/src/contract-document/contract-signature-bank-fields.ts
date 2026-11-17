import { ConflictException } from "@nestjs/common";
const fields=["openingBank","bankAccount","paymentBank","paymentAccount"] as const;
const fail=()=>{throw new ConflictException("合同主体与银行资料无法对应，请保留当前内容并核对主体信息后重试");};
/** Copies only saved fields whose party identity can be tied to the selected party. */
export function projectSignatureBankValues(values:Record<string,unknown>,parties:ReadonlyArray<{roleKey:string;snapshot:unknown}>):Record<string,unknown>{
 const result={...values};
 for(const [role,alias] of [["party_a","party.owner"],["party_b","party.counterparty"]] as const){
  const candidates=parties.filter(p=>p.roleKey===role&&p.snapshot&&typeof p.snapshot==="object"&&!Array.isArray(p.snapshot))
   .map(p=>p.snapshot as Record<string,unknown>).filter(p=>fields.some(key=>p[key]!==undefined&&p[key]!==null&&p[key]!==""));
  if(candidates.length>1)fail();
  const party=candidates[0];if(!party)continue;
  const selected=result[alias];
  // The rendering authority must have selected this exact snapshot; matching
  // names or tax identifiers do not establish a company relationship.
  if(!Array.isArray(selected)||selected.length!==1||selected[0]!==party)fail();
  for(const field of fields){
   const value=party[field];if(value===undefined||value===null||value==="")continue;
   if(typeof value!=="string")fail();
   const key=`${alias}.${field}`,prior=result[key];
   if(prior!==undefined&&prior!==null&&prior!==""&&prior!==value)fail();
   result[key]=value;
  }
 }
 return result;
}

import type { Document, Element } from "@xmldom/xmldom";
const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
/** Only called for the source-qualified new signature layout. */
export function appendSignatureBankFields(document:Document,table:Element,values:Record<string,unknown>):void {
 const rows=Array.from(table.childNodes).filter(node=>node.nodeType===1&&(node as Element).namespaceURI===W&&(node as Element).localName==="tr") as Element[];
 const cells=rows.length===1?Array.from(rows[0].childNodes).filter(node=>node.nodeType===1&&(node as Element).namespaceURI===W&&(node as Element).localName==="tc") as Element[]:[];
 if(cells.length!==2)throw new ConflictException("合同签署区位置无法核对，请联系合同管理员处理");
 for(const [index,alias] of ["party.owner","party.counterparty"].entries()){
  const read=(key:string)=>{const value=values[`${alias}.${key}`];if(value===undefined||value===null||value==="")return "________________";if(typeof value!=="string")fail();return value;};
  const lines=[`开户行：${read("openingBank")}`,`银行账号：${read("bankAccount")}`];
  if(values[`${alias}.paymentBank`]||values[`${alias}.paymentAccount`])lines.push(`实际收款开户行：${read("paymentBank")}`,`实际收款账号：${read("paymentAccount")}`);
  for(const value of lines){
   const p=document.createElementNS(W,"w:p"),r=document.createElementNS(W,"w:r"),properties=document.createElementNS(W,"w:rPr"),size=document.createElementNS(W,"w:sz"),t=document.createElementNS(W,"w:t");
   size.setAttributeNS(W,"w:val","18");properties.appendChild(size);r.appendChild(properties);t.appendChild(document.createTextNode(value));r.appendChild(t);p.appendChild(r);cells[index].appendChild(p);
  }
 }
}
