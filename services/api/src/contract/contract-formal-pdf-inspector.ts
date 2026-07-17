import { createHash } from "node:crypto";
import { PDFDocument, PDFPage } from "pdf-lib";

export type SignedPdfPageInspection = {
  width: number;
  height: number;
  rotationDegrees: number;
  orientation: "portrait" | "landscape";
};

export type SignedPdfInspection = {
  sha256: string;
  pageCount: number;
  pages: SignedPdfPageInspection[];
};

export async function inspectSignedPdf(source: Uint8Array): Promise<SignedPdfInspection> {
  const sha256 = createHash("sha256").update(source).digest("hex");
  let document: PDFDocument;
  let pages: PDFPage[];

  try {
    document = await PDFDocument.load(source, {
      ignoreEncryption: false,
      updateMetadata: false
    });
    pages = document.getPages();
  } catch {
    throw new Error("无法读取合同 PDF 原件，请确认文件未损坏、未加密后重新上传");
  }

  if (pages.length === 0) {
    throw new Error("合同 PDF 原件没有可用页面，请上传包含完整合同内容的 PDF");
  }

  return {
    sha256,
    pageCount: pages.length,
    pages: pages.map((page) => {
      const { width, height } = page.getSize();
      const rotationDegrees = page.getRotation().angle;
      const quarterTurn = Math.abs(rotationDegrees) % 180 === 90;
      const displayedWidth = quarterTurn ? height : width;
      const displayedHeight = quarterTurn ? width : height;

      return {
        width,
        height,
        rotationDegrees,
        orientation: displayedWidth >= displayedHeight ? "landscape" : "portrait"
      };
    })
  };
}
