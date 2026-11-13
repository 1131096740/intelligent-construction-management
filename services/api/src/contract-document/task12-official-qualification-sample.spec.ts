import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import PizZip from "pizzip";
import { canonicalOfficialQualificationDocx, createOfficialQualificationSample } from "./task12-official-qualification-sample";

describe("fixed fictitious source-only material document qualification sample",()=>{
  it("binds the final DOCX to the renderer scope and preserves literal party, money and spacing requirements",async()=>{
    const source=await readFile(join(__dirname,"../../assets/templates/material-purchase-real-v1.docx"));
    const sample=createOfficialQualificationSample(source);
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
