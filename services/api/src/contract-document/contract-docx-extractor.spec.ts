import PizZip from "pizzip";
import {
  CONTRACT_DOCX_EXTRACTION_LIMITS,
  extractContractDocx
} from "./contract-docx-extractor";

function docx(documentXml: string, extra: Record<string, string> = {}) {
  const zip = new PizZip();
  zip.file("word/document.xml", documentXml);
  for (const [path, content] of Object.entries(extra)) zip.file(path, content);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}

describe("extractContractDocx", () => {
  it("extracts split runs, tabs, breaks and table cells in stable order", () => {
    const buffer = docx([
      "<w:document><w:body>",
      "<w:p><w:r><w:t>合同　Ａ</w:t></w:r><w:r><w:t>ＢＣ</w:t></w:r><w:tab/><w:t>1</w:t><w:br/><w:t>下一行</w:t></w:p>",
      "<w:tbl><w:tr>",
      "<w:tc><w:p><w:r><w:t>名称</w:t></w:r></w:p><w:p><w:r><w:t>钢材</w:t></w:r></w:p></w:tc>",
      "<w:tc><w:p><w:r><w:t>数量</w:t></w:r><w:r><w:t>10</w:t></w:r></w:p></w:tc>",
      "</w:tr></w:tbl>",
      "<w:p><w:r><w:t>尾段</w:t></w:r></w:p>",
      "</w:body></w:document>"
    ].join(""));

    const first = extractContractDocx(buffer);
    const second = extractContractDocx(buffer);

    expect(first.blocks).toEqual([
      { kind: "paragraph", path: "p:0001", text: "合同 ABC 1 下一行" },
      { kind: "table_cell", path: "tbl:0001/r:0001/c:0001", text: "名称 钢材" },
      { kind: "table_cell", path: "tbl:0001/r:0001/c:0002", text: "数量10" },
      { kind: "paragraph", path: "p:0002", text: "尾段" }
    ]);
    expect(first.normalizedSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(second).toEqual(first);
  });

  it.each([
    [Buffer.from("not-a-zip"), "合同 DOCX 文件无法读取"],
    [docx("<w:document><w:body><w:p><w:t>未闭合</w:p></w:body></w:document>"), "合同 DOCX XML 结构不正确"],
    [docx("<w:document><w:body><w:p><w:t>非法&amp</w:t></w:p></w:body></w:document>"), "合同 DOCX XML 结构不正确"],
    [new PizZip().file("word/styles.xml", "<styles/>").generate({ type: "nodebuffer" }), "合同 DOCX 缺少正文内容"]
  ])("fails closed for an invalid DOCX", (buffer, message) => {
    expect(() => extractContractDocx(buffer)).toThrow(message);
  });

  it("rejects oversized uncompressed XML before parsing", () => {
    const oversized = "x".repeat(CONTRACT_DOCX_EXTRACTION_LIMITS.maxDocumentXmlBytes + 1);
    const buffer = docx(`<w:document><w:body><w:p><w:t>${oversized}</w:t></w:p></w:body></w:document>`);

    expect(() => extractContractDocx(buffer)).toThrow("合同 DOCX 正文内容过大");
  });

  it("enforces archive entry, single-entry and total-XML limits", () => {
    const manyEntries: Record<string, string> = {};
    for (let index = 0; index < CONTRACT_DOCX_EXTRACTION_LIMITS.maxEntries; index += 1) {
      manyEntries[`custom/item-${index}.bin`] = "x";
    }
    expect(() => extractContractDocx(docx("<w:document><w:body/></w:document>", manyEntries))).toThrow(
      "合同 DOCX 压缩包文件项过多"
    );

    expect(() => extractContractDocx(docx(
      "<w:document><w:body/></w:document>",
      { "word/media/large.bin": "x".repeat(CONTRACT_DOCX_EXTRACTION_LIMITS.maxEntryBytes + 1) }
    ))).toThrow("合同 DOCX 压缩包单项内容过大");

    const xmlPart = "x".repeat(3_260_000);
    const documentText = "x".repeat(1_950_000);
    expect(() => extractContractDocx(docx(
      `<w:document><w:body><w:p><w:t>${documentText}</w:t></w:p></w:body></w:document>`,
      { "word/styles.xml": xmlPart, "word/numbering.xml": xmlPart }
    ))).toThrow("合同 DOCX XML 总内容过大");
  });

  it("rejects paragraph and table count overflow", () => {
    const paragraphs = Array.from(
      { length: CONTRACT_DOCX_EXTRACTION_LIMITS.maxParagraphs + 1 },
      (_, index) => `<w:p><w:t>${index}</w:t></w:p>`
    ).join("");
    expect(() => extractContractDocx(docx(`<w:document><w:body>${paragraphs}</w:body></w:document>`))).toThrow(
      "合同 DOCX 段落数量超过系统限制"
    );

    const tables = Array.from(
      { length: CONTRACT_DOCX_EXTRACTION_LIMITS.maxTables + 1 },
      () => "<w:tbl><w:tr><w:tc><w:p><w:t>x</w:t></w:p></w:tc></w:tr></w:tbl>"
    ).join("");
    expect(() => extractContractDocx(docx(`<w:document><w:body>${tables}</w:body></w:document>`))).toThrow(
      "合同 DOCX 表格数量超过系统限制"
    );
  });

  it("rejects normalized character overflow", () => {
    const text = "字".repeat(CONTRACT_DOCX_EXTRACTION_LIMITS.maxCharacters + 1);
    expect(() => extractContractDocx(docx(
      `<w:document><w:body><w:p><w:t>${text}</w:t></w:p></w:body></w:document>`
    ))).toThrow("合同 DOCX 正文字符数量超过系统限制");
  });
});
