import { PDFDocument as PdfFile } from "pdf-lib";
import PDFDocument = require("pdfkit");
import { resolve } from "node:path";

export const FORM_V6_MARKER = "建工智管审批单V6";

/** Overlay a download receipt without re-reading business facts or signature profiles. */
export async function watermarkApprovalPdf(original: Buffer, lines: readonly string[]): Promise<Buffer> {
  const pdf = await PdfFile.load(original);
  const overlay = new PDFDocument({ autoFirstPage: false });
  overlay.registerFont("cn", resolve(__dirname, "../../assets/fonts/NotoSansSC-Regular.otf"));
  const chunks: Buffer[] = [];
  overlay.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    overlay.on("end", () => resolve(Buffer.concat(chunks)));
    overlay.on("error", reject);
  });
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    overlay.addPage({ size: [width, height], margin: 0 });
    overlay.save().opacity(0.12).font("cn").fontSize(12).fillColor("#64748b");
    overlay.rotate(-25, { origin: [width / 2, height / 2] });
    overlay.text(lines.join("  ·  "), 25, height / 2, { width: width - 50, align: "center" });
    overlay.restore();
  }
  overlay.end();
  // embedPdf defaults to the first page; every source page needs its own receipt.
  const overlays = await pdf.embedPdf(await done, pdf.getPageIndices());
  pdf.getPages().forEach((page, index) => page.drawPage(overlays[index], { x: 0, y: 0 }));
  return Buffer.from(await pdf.save());
}

export async function markFormalApprovalPdf(buffer: Buffer): Promise<Buffer> {
  const pdf = await PdfFile.load(buffer);
  pdf.setKeywords([FORM_V6_MARKER]);
  return Buffer.from(await pdf.save());
}

export async function isFormalApprovalV6(buffer: Buffer): Promise<boolean> {
  const pdf = await PdfFile.load(buffer);
  return pdf.getKeywords() === FORM_V6_MARKER;
}
