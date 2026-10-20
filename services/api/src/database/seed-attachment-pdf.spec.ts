import { createRequire } from "node:module";
import { PDFDocument } from "pdf-lib";

const { seedAttachmentPdf } = createRequire(__filename)("../../prisma/seed-attachment-pdf.cjs") as {
  seedAttachmentPdf: () => Promise<Buffer>;
};

it("配套示例附件提供可解析的单页 PDF，与四类真实版式生成独立", async () => {
  const bytes = await seedAttachmentPdf();
  const document = await PDFDocument.load(bytes, { throwOnInvalidObject: true });
  expect(document.getPageCount()).toBe(1);
  expect(document.getPage(0).getSize()).toEqual({ width: 595, height: 842 });
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
});
