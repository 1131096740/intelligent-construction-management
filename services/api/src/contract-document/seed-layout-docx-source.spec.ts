import PizZip from "pizzip";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prepareSeedLayoutDocxSource } from "./seed-layout-docx-source";

it.each(["material-purchase-real-v1.docx", "equipment-rental-real-v1.docx", "labor-subcontract-real-v1.docx", "generic-contract-v1.docx"])(
  "%s 新源副本保留全部条款和签章文字，原件字节不变", (name) => {
    const source = readFileSync(join(__dirname, "../../assets/templates", name));
    const original = Buffer.from(source);
    const before = new PizZip(source).file("word/document.xml")!.asText();
    const after = new PizZip(prepareSeedLayoutDocxSource(source)).file("word/document.xml")!.asText();
    const text = (xml: string) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((match) => match[1]);
    expect(text(after)).toEqual(text(before).map((value) => name.startsWith("labor") && value === "R" ? "☑" : value));
    expect(source).toEqual(original);
  }
);

it("尾部真实字段和图形不得当作空段删除，语言属性不作为字体改写", () => {
  const zip = new PizZip();
  zip.file("word/document.xml", '<w:document><w:body><w:p><w:r><w:lang w:eastAsia="仿宋_GB2312"/><w:t>签章</w:t></w:r></w:p><w:p><w:r><w:drawing/></w:r></w:p><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r></w:p><w:sectPr></w:sectPr></w:body></w:document>');
  const before = zip.file("word/document.xml")!.asText();
  const after = new PizZip(prepareSeedLayoutDocxSource(zip.generate({ type: "nodebuffer" }))).file("word/document.xml")!.asText();
  expect(after).toBe(before);
});
