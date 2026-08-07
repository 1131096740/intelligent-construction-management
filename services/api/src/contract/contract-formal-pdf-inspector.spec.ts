import { createHash } from "node:crypto";
import PDFKitDocument = require("pdfkit");
import { PDFDocument, degrees } from "pdf-lib";
import {
  inspectSignedPdf,
  mergeCounterpartyImagesToPdf
} from "./contract-formal-pdf-inspector";

// 1x1 合法 PNG（含完整关键块）。
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);
// GIF 魔数，用于验证非 PNG/JPEG 被拒绝。
const GIF_BYTES = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00", "binary");

async function createEncryptedPdf() {
  return await new Promise<Buffer>((resolve, reject) => {
    const document = new PDFKitDocument({ userPassword: "secret" });
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.text("encrypted contract");
    document.end();
  });
}

describe("inspectSignedPdf", () => {
  it("hashes and inspects the original bytes without rewriting them", async () => {
    const document = await PDFDocument.create();
    document.addPage([842, 595]);
    const source = Buffer.from(await document.save({ useObjectStreams: false }));
    const original = Buffer.from(source);

    const result = await inspectSignedPdf(source);

    expect(result.sha256).toBe(createHash("sha256").update(source).digest("hex"));
    expect(result.pageCount).toBe(1);
    expect(result.pages).toEqual([
      expect.objectContaining({ width: 842, height: 595, rotationDegrees: 0 })
    ]);
    expect(source).toEqual(original);
  });

  it("reports every page orientation and rotation", async () => {
    const document = await PDFDocument.create();
    document.addPage([595, 842]);
    const rotated = document.addPage([595, 842]);
    rotated.setRotation(degrees(90));
    const source = Buffer.from(await document.save({ addDefaultPage: false }));

    const result = await inspectSignedPdf(source);

    expect(result.pages).toEqual([
      { width: 595, height: 842, rotationDegrees: 0, orientation: "portrait" },
      { width: 595, height: 842, rotationDegrees: 90, orientation: "landscape" }
    ]);
  });

  it.each([
    ["empty", Buffer.alloc(0)],
    ["damaged", Buffer.from("%PDF-1.7\nnot a real pdf")]
  ])("rejects a %s PDF", async (_name, source) => {
    await expect(inspectSignedPdf(source)).rejects.toThrow("无法读取合同 PDF 原件");
  });

  it("rejects a zero-page PDF", async () => {
    const document = await PDFDocument.create();
    const source = Buffer.from(await document.save({ addDefaultPage: false }));

    await expect(inspectSignedPdf(source)).rejects.toThrow("合同 PDF 原件没有可用页面");
  });

  it("rejects an encrypted PDF", async () => {
    await expect(inspectSignedPdf(await createEncryptedPdf())).rejects.toThrow(
      "无法读取合同 PDF 原件"
    );
  });
});

describe("mergeCounterpartyImagesToPdf", () => {
  it("把多张 PNG 等比居中拼成 A4 PDF，每张一页", async () => {
    const merged = await mergeCounterpartyImagesToPdf([
      { buffer: PNG_1PX, name: "签章1.png" },
      { buffer: PNG_1PX, name: "签章2.png" }
    ]);
    expect(merged.pageCount).toBe(2);
    const document = await PDFDocument.load(merged.buffer);
    expect(document.getPageCount()).toBe(2);
    for (const page of document.getPages()) {
      const { width, height } = page.getSize();
      expect(Math.round(width)).toBe(595);
      expect(Math.round(height)).toBe(842);
    }
  });

  it("拒绝空图片列表", async () => {
    await expect(mergeCounterpartyImagesToPdf([])).rejects.toThrow("乙方签章图片不能为空");
  });

  it("拒绝非 PNG/JPEG 的图片字节", async () => {
    await expect(
      mergeCounterpartyImagesToPdf([{ buffer: GIF_BYTES, name: "动画.gif" }])
    ).rejects.toThrow("仅支持 PNG 或 JPEG");
  });
});
