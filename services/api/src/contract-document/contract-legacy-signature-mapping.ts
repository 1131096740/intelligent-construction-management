import { ConflictException } from "@nestjs/common";
import { canonicalContractPlaceholder } from "./contract-placeholder-registry";
import type { Element } from "@xmldom/xmldom";
const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export function legacySignatureMappedParagraphs(kind:"material"|"mechanical"|"generic",originals:Element[],mapped:Element[]):Array<{index:number;role:number;hasParty:boolean}> {
 const ranges=kind==="material"?[[205,211],[212,218]]:kind==="generic"?[[54,57],[59,62]]:[[187,192],[193,198]],result:Array<{index:number;role:number;hasParty:boolean}>=[];
 const text=(p:Element)=>Array.from(p.getElementsByTagNameNS(W,"t")).map(node=>node.textContent??"").join("");
 const party=/^\{(?:party\.owner\.name|party\.counterparty\.name|甲方名称|乙方名称)\}$/u;
 for(const [role,[begin,end]] of ranges.entries())for(let index=begin;index<=end;index++){
  const p=mapped[index],original=originals[index];if(!p||!original)throw new Error("合同签署区位置无法核对，请联系合同管理员处理");
  const tokens=Array.from(text(p).matchAll(/\{([^{}]+)\}/gu),match=>match[0]);
  const sourceCounts=new Map<string,number>();for(const match of text(original).matchAll(/\{([^{}]+)\}/gu))sourceCounts.set(match[0],(sourceCounts.get(match[0])??0)+1);
  const counts=new Map<string,number>();const extra=tokens.some(token=>{const count=(counts.get(token)??0)+1;counts.set(token,count);return count>(sourceCounts.get(token)??0)&&!party.test(token);});
  const hasParty=tokens.some(token=>["party.owner.name","party.counterparty.name","field.counterpartyName"].includes(canonicalContractPlaceholder(token.slice(1,-1).trim())));
  if(extra&&kind==="generic"&&hasParty)throw new ConflictException("签署区主体与补充内容的映射无法安全拆分，请联系管理员核对；草稿内容已保留。");
  if(extra)result.push({index,role,hasParty});
 }
 return result;
}
