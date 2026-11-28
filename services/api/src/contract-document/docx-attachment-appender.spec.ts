import PizZip from "pizzip";
import { appendDocxImageAttachments } from "./docx-attachment-appender";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nGQAAAAASUVORK5CYII=",
  "base64"
);
const JPEG = Buffer.from(
  "/9j/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBQMDAwUGBQUFBQYIBgYGBgYICggICAgICAoKCgoKCgoKDAwMDAwMDg4ODg4PDw8PDw8PDw8P/9sAQwECAgIEBAQHBAQHEAsJCxAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ/90ABAAB/9oADAMBAAIRAxEAPwD9/KKKKAP/2Q==",
  "base64"
);

function createDocx(): Buffer {
  const zip = new PizZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>"
  );
  zip.folder("_rels")?.file(
    ".rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>"
  );
  zip.folder("word")?.folder("_rels")?.file(
    "document.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
  );
  zip.folder("word")?.file(
    "document.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:body><w:p><w:r><w:t>合同正文</w:t></w:r></w:p><w:sectPr/></w:body>' +
      "</w:document>"
  );
  return zip.generate({ type: "nodebuffer" });
}

function readDocx(buffer: Buffer) {
  const zip = new PizZip(buffer);
  return {
    documentXml: zip.file("word/document.xml")?.asText() ?? "",
    relationshipsXml: zip.file("word/_rels/document.xml.rels")?.asText() ?? "",
    contentTypesXml: zip.file("[Content_Types].xml")?.asText() ?? "",
    fileNames: Object.keys(zip.files)
  };
}

describe("DOCX image attachment appender", () => {
  it("appends normal image attachments as centered A4 image pages", () => {
    const result = appendDocxImageAttachments(createDocx(), [
      { name: "营业执照.png", type: "png", buffer: PNG },
      { name: "开户许可证.jpg", type: "jpeg", buffer: JPEG }
    ]);
    const docx = readDocx(result);

    expect(docx.documentXml.match(/w:type="page"/g)).toHaveLength(2);
    expect(docx.documentXml).toContain('w:vAlign w:val="center"');
    expect(docx.relationshipsXml.match(/relationships\/image/g)).toHaveLength(2);
    expect(docx.contentTypesXml).toContain('Extension="png"');
    expect(docx.contentTypesXml).toContain('Extension="jpg"');
    expect(docx.fileNames).toEqual(
      expect.arrayContaining([
        "word/media/contract-attachment-1.png",
        "word/media/contract-attachment-2.jpg"
      ])
    );
  });

  it("uses automatic line height only for the image paragraphs of a fixed-line contract", () => {
    const source = new PizZip(createDocx());
    const styles = '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:pPr>' +
      '<w:spacing w:line="500" w:lineRule="exact"/></w:pPr></w:style></w:styles>';
    source.file("word/styles.xml", styles);
    const result = new PizZip(appendDocxImageAttachments(source.generate({ type: "nodebuffer" }), [
      { name: "附件.png", type: "png", buffer: PNG }
    ]));
    const document = result.file("word/document.xml")?.asText() ?? "";
    const image = document.match(/<w:p>(?:(?!<w:p>)[\s\S])*?<w:drawing>[\s\S]*?<\/w:p>/u)?.[0];

    expect(image).toContain('<w:spacing w:line="240" w:lineRule="auto"/>');
    expect(document.match(/w:lineRule="auto"/gu)).toHaveLength(1);
    expect(document).toContain('<w:p><w:r><w:t>合同正文</w:t></w:r></w:p>');
    expect(result.file("word/styles.xml")?.asText()).toBe(styles);
    expect(result.file("word/media/contract-attachment-1.png")?.asNodeBuffer()).toEqual(PNG);
  });

  it("fits square and grouped attachments inside a narrow final section", () => {
    const source = new PizZip(createDocx());
    const original = source.file("word/document.xml")?.asText() ?? "";
    const section = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1417" w:right="1701" w:bottom="1417" w:left="1701" w:gutter="0"/>' +
      '<w:docGrid w:type="linesAndChars" w:linePitch="312"/></w:sectPr>';
    source.file("word/document.xml", original.replace("<w:sectPr/>", section));
    const result = appendDocxImageAttachments(source.generate({ type: "nodebuffer" }), [
      { name: "工程现场.png", type: "png", buffer: PNG },
      { name: "法人身份证人像面.png", type: "png", buffer: PNG },
      { name: "法人身份证国徽面.png", type: "png", buffer: PNG }
    ]);
    const { documentXml } = readDocx(result);

    expect(documentXml.match(/<w:trHeight w:val="(\d+)"/gu)).toEqual([
      '<w:trHeight w:val="13004"', '<w:trHeight w:val="6502"', '<w:trHeight w:val="6502"'
    ]);
    expect(documentXml).toContain('<w:tcW w:w="8204" w:type="dxa"/>');
    expect(documentXml.match(/<wp:extent[^>]+>/gu)).toEqual([
      '<wp:extent cx="5209540" cy="5209540"/>',
      '<wp:extent cx="3823970" cy="3823970"/>',
      '<wp:extent cx="3823970" cy="3823970"/>'
    ]);
    expect(documentXml.match(/w:snapToGrid w:val="0"/gu)).toHaveLength(3);
    expect(documentXml.match(/<w:ind w:firstLine="0" w:firstLineChars="0"\/>/gu)).toHaveLength(3);
    expect(documentXml.lastIndexOf("工程现场.png")).toBeLessThan(documentXml.indexOf("身份证人像面"));
    expect(documentXml.indexOf("身份证人像面")).toBeLessThan(documentXml.indexOf("身份证国徽面"));
    expect(documentXml).toContain(section);
  });

  it("groups identity card portrait and emblem images on one labeled page", () => {
    const result = appendDocxImageAttachments(createDocx(), [
      { name: "法人身份证人像面.png", type: "png", buffer: PNG },
      { name: "法人身份证国徽面.jpg", type: "jpeg", buffer: JPEG }
    ]);
    const docx = readDocx(result);

    expect(docx.documentXml.match(/w:type="page"/g)).toHaveLength(1);
    expect(docx.documentXml).toContain("身份证人像面");
    expect(docx.documentXml).toContain("身份证国徽面");
    expect(docx.relationshipsXml.match(/relationships\/image/g)).toHaveLength(2);
  });

  it.each([
    [{ placement: "adjacent", order: ["portrait", "emblem", "pdf"], pages: 1 }],
    [{ placement: "across PDF", order: ["portrait", "pdf", "emblem"], pages: 2 }],
    [{ placement: "across another image", order: ["portrait", "other", "emblem"], pages: 3 }],
    [{ placement: "reverse", order: ["emblem", "portrait", "pdf"], pages: 2 }]
  ])("preserves ordered identity card images for $placement", ({ order, pages }) => {
    const images = {
      portrait: { name: "身份证人像面.png", type: "png", buffer: PNG },
      emblem: { name: "身份证国徽面.jpg", type: "jpeg", buffer: JPEG },
      other: { name: "现场.png", type: "png", buffer: PNG },
      pdf: { name: "附件.pdf", type: "pdf", buffer: Buffer.from("%PDF-1.7") }
    } as const;
    const xml = readDocx(appendDocxImageAttachments(createDocx(),
      order.map(key => images[key as keyof typeof images]), { preserveUploadOrder: true })).documentXml;
    expect(xml.match(/w:type="page"/g)).toHaveLength(pages);
    const names = Array.from(xml.matchAll(/<wp:docPr[^>]+name="([^"]+)"/gu), match => match[1]);
    expect(names).toEqual(order.filter(key => key !== "pdf").map(key => images[key as keyof typeof images].name));
  });

  it("returns the original DOCX when no image attachments are present", () => {
    const source = createDocx();
    expect(
      appendDocxImageAttachments(source, [
        { name: "工程量清单.pdf", type: "pdf", buffer: Buffer.from("%PDF-1.7") }
      ])
    ).toBe(source);
  });

  it("拒绝结构损坏的 DOCX 且不回显解析库错误", () => {
    expect(() =>
      appendDocxImageAttachments(Buffer.from("TOP-SECRET broken docx"), [
        { name: "营业执照.png", type: "png", buffer: PNG }
      ])
    ).toThrow("合同附件合并所用 DOCX 文件结构不正确");
  });

  it.each([
    { name: "broken.png", type: "png" as const },
    { name: "broken.jpg", type: "jpeg" as const }
  ])("拒绝损坏的 $type 附件图片", ({ name, type }) => {
    expect(() =>
      appendDocxImageAttachments(createDocx(), [
        { name, type, buffer: Buffer.from("TOP-SECRET broken image") }
      ])
    ).toThrow("合同附件图片格式不正确");
  });
});
