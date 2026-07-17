import { createHash } from "node:crypto";
import PDFKitDocument = require("pdfkit");
import { PDFDocument, degrees } from "pdf-lib";
import { inspectSignedPdf } from "./contract-formal-pdf-inspector";

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
