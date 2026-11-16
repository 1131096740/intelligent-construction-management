import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import PizZip from "pizzip";
import { renderContractBody, REVIEWED_MATERIAL_TYPOGRAPHY_VERSION, REVIEWED_MATERIAL_TYPOGRAPHY_V2_VERSION, REVIEWED_MATERIAL_TYPOGRAPHY_V3_VERSION } from "./contract-body-document";
import { canonicalOfficialQualificationDocx, createOfficialQualificationSample } from "./task12-official-qualification-sample";

describe("fixed fictitious source-only material document qualification sample",()=>{
  it("binds the final DOCX to the renderer scope and preserves literal party, money and spacing requirements",async()=>{
    const source=await readFile(join(__dirname,"../../assets/templates/material-purchase-real-v1.docx"));
    const sample=createOfficialQualificationSample(source);
    if (!sample.scope) throw new Error("material scope required");
    expect(sample.scope.docxSha256).toBe(createHash("sha256").update(sample.docx).digest("hex"));
    expect(sample.scope.sourceSha256).toBe("44be99630d27578e9828bd7c6fa4925cdc26f552b84637e125c8acb0632b17bd");
    expect(sample.scope.paragraphs).toHaveLength(154);
    const xml=new PizZip(sample.docx).file("word/document.xml")!.asText();
    for(const text of ["隔离工具资格材料合同","虚构甲方公司","虚构乙方公司","壹佰壹拾叁元整","资格样张材料","买方","卖方"]) expect(xml).toContain(text);
    expect(xml).toContain('w:line="500"');expect(xml).toContain('w:lineRule="exact"');
    const footer=new PizZip(sample.docx).file("word/footer1.xml")!.asText();
    expect(footer).toContain('w:instr="PAGE"');
    expect(footer).toContain('w:instr="NUMPAGES"');
    expect(footer).not.toMatch(/第\s+页 \/ 共\s+页/u);
    expect(sample.expectations.actualPdfQualification).toBe("NOT_EXECUTED");
    expect(sample.expectations.minimumPages).toBe(1);
  });
  it("ignores ZIP transport dates but rejects changed package parts",()=>{
    const a=new PizZip();a.file("word/document.xml","literal",{date:new Date("2001-01-01")});
    const b=new PizZip();b.file("word/document.xml","literal",{date:new Date("2020-01-01")});
    expect(canonicalOfficialQualificationDocx(a.generate({type:"nodebuffer"}))).toBe(canonicalOfficialQualificationDocx(b.generate({type:"nodebuffer"})));
    b.file("word/document.xml","changed");
    expect(canonicalOfficialQualificationDocx(a.generate({type:"nodebuffer"}))).not.toBe(canonicalOfficialQualificationDocx(b.generate({type:"nodebuffer"})));
    b.file("../escape","bad");expect(()=>canonicalOfficialQualificationDocx(b.generate({type:"nodebuffer"}))).toThrow();
  });
  it("rejects a changed original template instead of inventing a new body25 scope",()=>{
    expect(()=>createOfficialQualificationSample(Buffer.from("not the reviewed template"))).toThrow();
  });
});

// Same public source renderer; no tools, services or database.
describe("fixed mechanical official qualification sample",()=>{
  it("keeps reviewed mechanical roles without inventing material 25pt scope",async()=>{
    const source=await readFile(join(__dirname,"../../assets/templates/equipment-rental-real-v1.docx"));
    const sample=createOfficialQualificationSample(source);
    expect(sample.scope).toBeNull();
    const xml=new PizZip(sample.docx).file("word/document.xml")!.asText();
    for(const text of ["隔离工具资格机械合同","虚构甲方公司","虚构乙方公司","资格样张设备","壹佰壹拾叁元整"]) expect(xml).toContain(text);
    expect(sample.expectations).not.toHaveProperty("mainBodyLinePoints");
    expect(sample.expectations.actualPdfQualification).toBe("NOT_EXECUTED");
  });
});

it("restores real mechanical PAGE/NUMPAGES fields while preserving the reviewed non-footer package",async()=>{
  const source=await readFile(join(__dirname,"../../assets/templates/equipment-rental-real-v1.docx"));
  const sample=createOfficialQualificationSample(source),zip=new PizZip(sample.docx);
  // Independent baseline: original CB80 real qualification Java input DOCX,
  // a8f9ef...e6830. Only fixed fictional words; no private runtime input is read.
  const rows=Object.values(zip.files).filter(entry=>!entry.dir&&!entry.name.startsWith("word/footer")).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)
    .map(entry=>[entry.name,createHash("sha256").update(entry.asNodeBuffer()).digest("hex")]);
  expect(rows).toHaveLength(12);
  expect(createHash("sha256").update(JSON.stringify(rows)).digest("hex")).toBe("455f9116fa9f74994988eb95ad6cf0de81714cdff72be221e5004ebec8067186");
  const footer=zip.file("word/footer1.xml")!.asText();
  expect(footer.match(/w:instr="PAGE"/gu)).toHaveLength(1);
  expect(footer.match(/w:instr="NUMPAGES"/gu)).toHaveLength(1);
  for(const name of ["word/footer-contract-template.xml","word/footer-contract-page.xml"]){
    expect(zip.file(name)!.asNodeBuffer()).toEqual(new PizZip(source).file(name)!.asNodeBuffer());
  }
});

// These branches deliberately retain their original footer behavior.
it.each([undefined,REVIEWED_MATERIAL_TYPOGRAPHY_VERSION,REVIEWED_MATERIAL_TYPOGRAPHY_V2_VERSION,REVIEWED_MATERIAL_TYPOGRAPHY_V3_VERSION] as const)("does not extend the pagination projection to legacy material %s",async(version)=>{
  const source=await readFile(join(__dirname,"../../assets/templates/material-purchase-real-v1.docx"));
  const values={"contract.name":"原路径回归","contract.temporaryCode":"LEGACY-REGRESSION","document.watermark":"草稿",...(version?{"contract.typographyVersion":version}:{})};
  const rendered=renderContractBody(source,source,{values},[],
    "22222222-2222-4222-8222-222222222222",undefined,version?{typographyVersion:version}:{});
  const original=new PizZip(source),actual=new PizZip(rendered.docx);
  for(const name of Object.keys(original.files).filter(name=>name.startsWith("word/footer")&&!original.files[name].dir)) expect(actual.file(name)!.asNodeBuffer()).toEqual(original.file(name)!.asNodeBuffer());
});
it("retains the original unprofiled mechanical footer unchanged",async()=>{
  const source=await readFile(join(__dirname,"../../assets/templates/equipment-rental-real-v1.docx"));
  const rendered=renderContractBody(source,source,{values:{"contract.name":"原路径回归","contract.temporaryCode":"LEGACY-REGRESSION","document.watermark":"草稿"}},[],"22222222-2222-4222-8222-222222222222");
  expect(new PizZip(rendered.docx).file("word/footer1.xml")!.asNodeBuffer()).toEqual(new PizZip(source).file("word/footer1.xml")!.asNodeBuffer());
});
