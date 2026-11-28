import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import PizZip from "pizzip";
import { completeContractDocxFontTableType } from "./contract-docx-package-metadata";

const source=readFileSync(join(__dirname,"../../assets/templates/generic-contract-v1.docx"));
const sourceSha="ef9b75b39a487903d33bfc239f7c9754b8172ff1a1f6c6b6b3ba20178e098e5d";
const version="built-in-generic-font-v1";
function overrideCount(bytes:Buffer){const xml=new PizZip(bytes).file("[Content_Types].xml")!.asText();const doc=new DOMParser().parseFromString(xml,"application/xml");return Array.from(doc.getElementsByTagName("Override")).filter(x=>x.getAttribute("PartName")==="/word/fontTable.xml").length;}
it("only normalizes new source-bound generic documents while leaving old bytes unchanged",()=>{
 expect(overrideCount(source)).toBe(0);
 expect(completeContractDocxFontTableType(source,sourceSha).docx).toEqual(source);
 const result=completeContractDocxFontTableType(source,sourceSha,version);
 expect(overrideCount(result.docx)).toBe(1);
 expect(result.normalization?.originalMasterSha256).toBe(sourceSha);
 const original=new PizZip(source),output=new PizZip(result.docx);
 expect(Object.keys(output.files).sort()).toEqual(Object.keys(original.files).sort());
 for(const name of Object.keys(original.files).filter(name=>!original.files[name].dir&&name!=="[Content_Types].xml"))expect(output.file(name)!.asNodeBuffer()).toEqual(original.file(name)!.asNodeBuffer());
 expect(()=>completeContractDocxFontTableType(source,"0".repeat(64),version)).toThrow();
});
