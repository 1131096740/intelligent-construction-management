import type { CompanyBankBinding } from "../contract-workbench/company-bank-binding";
import { ConflictException } from "@nestjs/common";
const fields=["openingBank","bankAccount","paymentBank","paymentAccount"] as const;
const fail=()=>{throw new ConflictException("合同主体与银行资料无法对应，请保留当前内容并核对主体信息后重试");};
/** The new generic and labor layouts reserve space for single-line field inputs. */
export function assertBankFieldCapacity(values:Record<string,unknown>):void {
 const labels={openingBank:"开户行",bankAccount:"开户账号",paymentBank:"实际收款开户行",paymentAccount:"实际收款账号"} as const;
 for(const [alias,role] of [["party.owner","甲方"],["party.counterparty","乙方"]] as const) for(const field of fields) {
  const value=values[`${alias}.${field}`];
  if(value===undefined||value===null||value==="")continue;
  if(typeof value!=="string"){fail();continue;}
  const characters=Array.from(value);
  if(characters.length>40||characters.some(character=>{const code=character.codePointAt(0)!;return code<32||(code>=127&&code<=159)||(code>=0xd800&&code<=0xdfff)||code===0xfffe||code===0xffff||code===0x2028||code===0x2029;})) throw new ConflictException(`${role}${labels[field]}请改为单行且不超过40个字，并删除不支持的字符；原资料已保留`);
 }
}
/** Copies only saved fields whose party identity can be tied to the selected party. */
export function projectSignatureBankValues(values:Record<string,unknown>,parties:ReadonlyArray<{roleKey:string;snapshot:unknown}>,binding?:CompanyBankBinding):Record<string,unknown>{
 const result={...values};
 if(binding){
  const selected=result["party.owner"];
  if(!Array.isArray(selected)||selected.length!==1||!selected[0]||typeof selected[0]!=="object"||selected[0].id!==binding.companyEntityId||selected[0].versionId!==binding.companyEntityVersionId)fail();
  for(const field of fields){const value=binding.values[field];if(value)result[`party.owner.${field}`]=value;}
 }
 for(const [role,alias] of [["party_a","party.owner"],["party_b","party.counterparty"]] as const){
  if(role==="party_a"&&binding){
   for(const party of parties.filter(p=>p.roleKey===role&&p.snapshot&&typeof p.snapshot==="object"&&!Array.isArray(p.snapshot))) {
    const snapshot=party.snapshot as Record<string,unknown>;
    for(const field of fields) {
     const oldValue=snapshot[field];
     if(oldValue!==undefined&&oldValue!==null&&oldValue!==""&&oldValue!==binding.values[field]) throw new ConflictException("原甲方银行资料与我方公司银行资料尚未一致，请核对或明确复制后重试，原资料均已保留");
    }
   }
   continue;
  }
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
export function signatureBankLines(values:Record<string,unknown>,alias:string):string[] {
 const read=(key:string)=>{const value=values[`${alias}.${key}`];if(value===undefined||value===null||value==="")return "________________";if(typeof value!=="string")fail();return value;};
 const lines=[`开户行：${read("openingBank")}`,`银行账号：${read("bankAccount")}`];
 if(values[`${alias}.paymentBank`]||values[`${alias}.paymentAccount`])lines.push(`实际收款开户行：${read("paymentBank")}`,`实际收款账号：${read("paymentAccount")}`);
 return lines;
}
/** Only called for the source-qualified new signature layout. */
export function appendSignatureBankFields(document:Document,table:Element,values:Record<string,unknown>,options:{compact?:boolean}={}):void {
 const rows=Array.from(table.childNodes).filter(node=>node.nodeType===1&&(node as Element).namespaceURI===W&&(node as Element).localName==="tr") as Element[];
 const cells=rows.length===1?Array.from(rows[0].childNodes).filter(node=>node.nodeType===1&&(node as Element).namespaceURI===W&&(node as Element).localName==="tc") as Element[]:[];
 if(cells.length!==2)throw new ConflictException("合同签署区位置无法核对，请联系合同管理员处理");
 for(const [index,alias] of ["party.owner","party.counterparty"].entries()){
  const lines=signatureBankLines(values,alias);
  for(const value of lines){
   const p=document.createElementNS(W,"w:p"),r=document.createElementNS(W,"w:r"),properties=document.createElementNS(W,"w:rPr"),size=document.createElementNS(W,"w:sz"),t=document.createElementNS(W,"w:t");
   if(options.compact){const pPr=document.createElementNS(W,"w:pPr"),spacing=document.createElementNS(W,"w:spacing");for(const [key,value] of [["before","0"],["after","0"],["line","200"],["lineRule","auto"]])spacing.setAttributeNS(W,`w:${key}`,value);pPr.appendChild(spacing);p.appendChild(pPr);}
   size.setAttributeNS(W,"w:val","18");properties.appendChild(size);r.appendChild(properties);t.appendChild(document.createTextNode(value));r.appendChild(t);p.appendChild(r);cells[index].appendChild(p);
  }
 }
}
