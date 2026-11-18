import { reviewedBuiltinTemplateKind } from "./builtin-template-parts";
import { DOMParser, XMLSerializer, type Element } from "@xmldom/xmldom";
import PizZip from "pizzip";

export const MECHANICAL_CONTACT_LAYOUT_V1="mechanical-contact-layout-v1";
export const MECHANICAL_CONTACT_LAYOUT_VERSION="mechanical-contact-layout-v2";
export type MechanicalContactLayoutVersion=typeof MECHANICAL_CONTACT_LAYOUT_V1|typeof MECHANICAL_CONTACT_LAYOUT_VERSION;
const W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const paragraphText=(p:Element)=>Array.from(p.getElementsByTagNameNS(W,"t")).map(t=>t.textContent??"").join("");
const parse=(bytes:Buffer)=>{const zip=new PizZip(bytes),part=zip.file("word/document.xml");if(!part)throw new Error("合同联系人版式无法核对");const document=new DOMParser({onError:()=>{throw new Error("合同联系人版式无法核对");}}).parseFromString(part.asText(),"application/xml");return {zip,document};};
function enableParagraphProperty(p:Element,local:string):void {
 const doc=p.ownerDocument!;let props=Array.from(p.childNodes).find(n=>n.nodeType===1&&(n as Element).namespaceURI===W&&(n as Element).localName==="pPr") as Element|undefined;
 if(!props){props=doc.createElementNS(W,"w:pPr");p.insertBefore(props,p.firstChild);}
 let property=Array.from(props.childNodes).find(n=>n.nodeType===1&&(n as Element).namespaceURI===W&&(n as Element).localName===local) as Element|undefined;
 if(!property){property=doc.createElementNS(W,`w:${local}`);props.insertBefore(property,props.firstChild);}
 property.setAttributeNS(W,"w:val","1");
}

/** Applies only to unchanged, adjacent source-qualified pairs. Any edited,
 * remapped, reordered or structurally different pair stays untouched. */
export function applyMechanicalContactLayout(source:Buffer,bytes:Buffer,version:MechanicalContactLayoutVersion=MECHANICAL_CONTACT_LAYOUT_V1):Buffer {
 if(version!==MECHANICAL_CONTACT_LAYOUT_V1&&version!==MECHANICAL_CONTACT_LAYOUT_VERSION)throw new Error("合同联系人版式无法核对");
 if(reviewedBuiltinTemplateKind(source)!=="mechanical")throw new Error("合同联系人版式无法核对");
 const original=parse(source),sourceParagraphs=Array.from(original.document.getElementsByTagNameNS(W,"p"));
 const expected=[77,79,82,84].map(i=>paragraphText(sourceParagraphs[i]));
 const expectedDetails=[78,80,83,85].map(i=>paragraphText(sourceParagraphs[i]));
 const {zip,document}=parse(bytes),body=document.getElementsByTagNameNS(W,"body").item(0);if(!body)throw new Error("合同联系人版式无法核对");
 const children=Array.from(body.childNodes).filter(n=>n.nodeType===1) as Element[];
 for(let i=0;i<children.length-1;i++){
  const heading=children[i],detail=children[i+1];if(heading.namespaceURI!==W||heading.localName!=="p"||detail.namespaceURI!==W||detail.localName!=="p")continue;
  const index=expected.indexOf(paragraphText(heading));if(index<0||paragraphText(detail)!==expectedDetails[index]||children.filter(p=>p.namespaceURI===W&&p.localName==="p"&&paragraphText(p)===expected[index]).length!==1)continue;
  const candidates=Array.from(detail.getElementsByTagNameNS(W,"t")).filter(t=>(t.textContent??"").startsWith("，移动电话"));
  if(candidates.length!==1)continue;
  const text=candidates[0],value=text.textContent!,parent=text.parentNode;if(!parent||parent.nodeType!==1||(parent as Element).localName!=="r")continue;
  text.textContent=value.slice(0,1);const br=document.createElementNS(W,"w:br"),suffix=document.createElementNS(W,"w:t");suffix.textContent=value.slice(1);
  parent.insertBefore(br,text.nextSibling);parent.insertBefore(suffix,br.nextSibling);
  enableParagraphProperty(heading,"keepNext");enableParagraphProperty(detail,"keepLines");
 }
 if(version===MECHANICAL_CONTACT_LAYOUT_VERSION){
  const sourceBody=original.document.getElementsByTagNameNS(W,"body").item(0);if(!sourceBody)throw new Error("合同联系人版式无法核对");
  const sourceChildren=Array.from(sourceBody.childNodes).filter(n=>n.nodeType===1) as Element[], sourceLast=sourceChildren.at(-2),last=children.at(-2);
  const targetText=paragraphText(sourceParagraphs[162]),clauseText=paragraphText(sourceParagraphs[163]);
  const candidates=children.filter(p=>p.namespaceURI===W&&p.localName==="p"&&paragraphText(p)===targetText);
  const position=children.indexOf(candidates[0]);const next=children[position+1];
  if(candidates.length===1&&next?.namespaceURI===W&&next.localName==="p"&&paragraphText(next)===clauseText&&
     sourceLast?.localName==="p"&&last?.localName==="p"&&paragraphText(last)===""&&
     new XMLSerializer().serializeToString(last)===new XMLSerializer().serializeToString(sourceLast)){
   const props=Array.from(last.childNodes).find(n=>n.nodeType===1&&(n as Element).namespaceURI===W&&(n as Element).localName==="pPr") as Element|undefined;
   if(props){
    let spacing=Array.from(props.childNodes).find(n=>n.nodeType===1&&(n as Element).namespaceURI===W&&(n as Element).localName==="spacing") as Element|undefined;
    if(!spacing){spacing=document.createElementNS(W,"w:spacing");const runProps=Array.from(props.childNodes).find(n=>n.nodeType===1&&(n as Element).namespaceURI===W&&(n as Element).localName==="rPr");props.insertBefore(spacing,runProps??null);}
    for(const [key,value] of [["before","0"],["after","0"],["line","20"],["lineRule","exact"]])spacing.setAttributeNS(W,`w:${key}`,value);
    for(const runProps of Array.from(last.getElementsByTagNameNS(W,"rPr")))for(const name of ["sz","szCs"]){
     let size=Array.from(runProps.childNodes).find(n=>n.nodeType===1&&(n as Element).namespaceURI===W&&(n as Element).localName===name) as Element|undefined;
     if(!size){
      size=document.createElementNS(W,`w:${name}`);
      const following=Array.from(runProps.childNodes).find(n=>n.nodeType===1&&(n as Element).namespaceURI===W&&["highlight","u","effect","bdr","shd","fitText","vertAlign","rtl","cs","em","lang"].includes((n as Element).localName??""));
      runProps.insertBefore(size,following??null);
     }size.setAttributeNS(W,"w:val","2");
    }
    enableParagraphProperty(candidates[0],"keepNext");
   }
  }
 }
 zip.file("word/document.xml",new XMLSerializer().serializeToString(document));return zip.generate({type:"nodebuffer"});
}
