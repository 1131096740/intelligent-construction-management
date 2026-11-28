import { DOMParser, XMLSerializer, type Document, type Element } from "@xmldom/xmldom";
import PizZip from "pizzip";
import { ConflictException } from "@nestjs/common";
import { readLayoutSourcePositions } from "../contract-template/layout-field-mapping";
import { canonicalContractPlaceholder } from "./contract-placeholder-registry";
import { signatureBankLines } from "./contract-signature-bank-fields";

const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const message="签章区已有银行资料，请先核对并保留原内容后再生成合同";
const text=(node:Element)=>Array.from(node.getElementsByTagNameNS(W,"t")).map(item=>item.textContent??"").join("");
const containsBankDetails=(value:string)=>/开户|银行|账户|账号/u.test(value.replace(/\s+/gu,""));

/** Check the existing signature positions without rendering or modifying user data. */
export function assertGenericBankInputs(source:Buffer,mapped:Buffer,values:Record<string,unknown>,plan?:{edits:readonly {positionId:string;text:string}[];deletedPositionIds?:readonly string[]},options:{editsMovedToSupplement?:boolean;genericMappedSupplement?:boolean}={}):void {
  const sourcePositions=readLayoutSourcePositions(source).positions;
  const part=new PizZip(mapped).file("word/document.xml");
  if(!part) throw new ConflictException("通用合同签章位置无法核对，请联系合同管理员处理");
  const document=new DOMParser().parseFromString(part.asText(),"application/xml"),paragraphs=Array.from(document.getElementsByTagNameNS(W,"p"));
  const originals=options.genericMappedSupplement?Array.from(new DOMParser().parseFromString(new PizZip(source).file("word/document.xml")!.asText(),"application/xml").getElementsByTagNameNS(W,"p")):[];
  for(const index of [54,55,56,57,59,60,61,62]) {
    const position=sourcePositions.find(item=>item.part==="word/document.xml"&&item.paragraphIndex===index),paragraph=paragraphs[index];
    if(!position||!paragraph) throw new ConflictException("通用合同签章位置无法核对，请联系合同管理员处理");
    if(plan?.deletedPositionIds?.includes(position.positionId)) continue;
    const current=(options.editsMovedToSupplement ? undefined : plan?.edits.find(edit=>edit.positionId===position.positionId)?.text) ?? text(options.genericMappedSupplement ? originals[index] : paragraph);
    const resolved=current.replace(/\{([^{}]+)\}/gu,(_whole,tag:string)=>{
      const value=values[canonicalContractPlaceholder(tag.trim())]??values[tag.trim()];
      return typeof value==="string"?value:"";
    });
    if(containsBankDetails(resolved)) throw new ConflictException(message);
  }
}

/** Adds empty lines only; existing bank details are never replaced or inferred. */
export function addGenericBankBlanks(document:Document,values?:Record<string,unknown>):void {
  const tables=Array.from(document.getElementsByTagNameNS(W,"tbl")).filter(table=>text(table).includes("甲方（盖章）")&&text(table).includes("乙方（盖章）"));
  if(tables.length!==1) throw new ConflictException("通用合同签章位置无法核对，请联系合同管理员处理");
  const cells=Array.from(tables[0].getElementsByTagNameNS(W,"tc"));
  if(cells.length!==2) throw new ConflictException("通用合同签章位置无法核对，请联系合同管理员处理");
  if(cells.some(cell=>Array.from(cell.getElementsByTagNameNS(W,"p")).slice(1).some(paragraph=>containsBankDetails(text(paragraph))))) throw new ConflictException(message);
  for(const [index,cell] of cells.entries()) for(const value of values?signatureBankLines(values,index===0?"party.owner":"party.counterparty"):["开户行：________________", "银行账号：________________"]) {
    const paragraph=document.createElementNS(W,"w:p"),properties=document.createElementNS(W,"w:pPr"),alignment=document.createElementNS(W,"w:jc");
    alignment.setAttributeNS(W,"w:val","left");properties.appendChild(alignment);paragraph.appendChild(properties);
    const run=document.createElementNS(W,"w:r"),runProperties=document.createElementNS(W,"w:rPr"),size=document.createElementNS(W,"w:sz"),node=document.createElementNS(W,"w:t");
    size.setAttributeNS(W,"w:val","18");runProperties.appendChild(size);run.appendChild(runProperties);
    node.appendChild(document.createTextNode(value));run.appendChild(node);paragraph.appendChild(run);cell.appendChild(paragraph);
  }
}

export function addGenericBankBlanksToDocx(bytes:Buffer,values?:Record<string,unknown>):Buffer {
  const zip=new PizZip(bytes),part=zip.file("word/document.xml");
  if(!part) throw new ConflictException("通用合同签章位置无法核对，请联系合同管理员处理");
  const document=new DOMParser().parseFromString(part.asText(),"application/xml");
  addGenericBankBlanks(document,values);
  zip.file("word/document.xml",new XMLSerializer().serializeToString(document));
  return zip.generate({type:"nodebuffer"});
}


export const GENERIC_SIGNATURE_HEADING_VERSION = "built-in-generic-signature-heading-v1" as const;

/** Move the source heading and its authored additions together onto the signing page. */
export function moveGenericSignatureHeading(table: Element, heading: Element, additions: readonly Element[]): void {
  const body = table.parentNode;
  if (!body || body !== heading.parentNode ||
      additions.some((paragraph, index) => paragraph.parentNode !== body ||
        paragraph.previousSibling !== (index === 0 ? heading : additions[index - 1]))) {
    throw new ConflictException("通用合同签章标题位置无法核对，请保留当前内容后重试");
  }
  for (const paragraph of [heading, ...additions]) body.insertBefore(paragraph, table);
}
