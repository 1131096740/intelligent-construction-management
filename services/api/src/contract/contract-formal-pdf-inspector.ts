import { createHash } from "node:crypto";
import { PDFDocument, PDFPage, PageSizes } from "pdf-lib";

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

export type CounterpartyImageInput = {
  buffer: Uint8Array;
  name: string;
};

export type MergedCounterpartyPdf = {
  buffer: Uint8Array;
  pageCount: number;
};

// 将多张乙方签章图片等比缩放居中拼接到 A4 PDF，作为灵活格式文件的规范化预览。
export async function mergeCounterpartyImagesToPdf(
  images: CounterpartyImageInput[]
): Promise<MergedCounterpartyPdf> {
  if (images.length === 0) {
    throw new Error("乙方签章图片不能为空");
  }
  const document = await PDFDocument.create();
  const [pageWidth, pageHeight] = PageSizes.A4;
  const margin = 36;
  const maxContentWidth = pageWidth - margin * 2;
  const maxContentHeight = pageHeight - margin * 2;
  for (const image of images) {
    const kind = detectRasterKind(image.buffer);
    if (!kind) {
      throw new Error(`乙方签章图片${image.name ? ` ${image.name}` : ""}格式不受支持，仅支持 PNG 或 JPEG`);
    }
    const bytes = Uint8Array.from(image.buffer);
    const embedded = kind === "png"
      ? await document.embedPng(bytes)
      : await document.embedJpg(bytes);
    const scale = Math.min(maxContentWidth / embedded.width, maxContentHeight / embedded.height);
    const width = embedded.width * scale;
    const height = embedded.height * scale;
    const page = document.addPage(PageSizes.A4);
    page.drawImage(embedded, {
      x: (pageWidth - width) / 2,
      y: (pageHeight - height) / 2,
      width,
      height
    });
  }
  return { buffer: new Uint8Array(await document.save()), pageCount: images.length };
}

function detectRasterKind(buffer: Uint8Array): "png" | "jpeg" | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return "png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }
  return null;
}

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
