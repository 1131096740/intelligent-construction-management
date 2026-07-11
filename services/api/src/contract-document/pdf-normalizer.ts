import {
  degrees,
  PageSizes,
  PDFDocument,
  type PDFEmbeddedPage,
  type PDFImage,
  type PDFPage
} from "pdf-lib";

export type PdfAttachmentType = "pdf" | "png" | "jpeg";

export interface PdfAttachment {
  name: string;
  buffer: Buffer;
  type?: PdfAttachmentType;
}

export interface NormalizedContractPdf {
  buffer: Buffer;
  pageCount: number;
  warnings: string[];
  pageSizes: Array<"A4_portrait" | "A4_landscape">;
}

const [A4_WIDTH, A4_HEIGHT] = PageSizes.A4;
const A4_TOLERANCE_POINTS = 2;
const IMAGE_ATTACHMENT_MARGIN_POINTS = 36;
export const MAX_TOTAL_INPUT_BYTES = 100 * 1024 * 1024;
export const MAX_TOTAL_PAGES = 500;
export const MAX_IMAGE_PIXELS = 100_000_000;

class PdfNormalizationLimitError extends Error {}

function near(value: number, expected: number): boolean {
  return Math.abs(value - expected) <= A4_TOLERANCE_POINTS;
}

function pageOrientation(
  width: number,
  height: number
): "A4_portrait" | "A4_landscape" {
  if (near(width, A4_WIDTH) && near(height, A4_HEIGHT)) return "A4_portrait";
  if (near(width, A4_HEIGHT) && near(height, A4_WIDTH)) return "A4_landscape";
  return width > height ? "A4_landscape" : "A4_portrait";
}

function drawCenteredPage(
  document: PDFDocument,
  embeddedPage: PDFEmbeddedPage,
  rotation: number,
  pageSizes: NormalizedContractPdf["pageSizes"]
): void {
  const quarterTurn = rotation === 90 || rotation === 270;
  const visibleWidth = quarterTurn ? embeddedPage.height : embeddedPage.width;
  const visibleHeight = quarterTurn ? embeddedPage.width : embeddedPage.height;
  const orientation = pageOrientation(visibleWidth, visibleHeight);
  const [width, height] =
    orientation === "A4_landscape"
      ? [A4_HEIGHT, A4_WIDTH]
      : [A4_WIDTH, A4_HEIGHT];
  const scale = Math.min(width / visibleWidth, height / visibleHeight);
  const centeredX = (width - visibleWidth * scale) / 2;
  const centeredY = (height - visibleHeight * scale) / 2;
  const page = document.addPage([width, height]);
  page.drawPage(embeddedPage, {
    x:
      centeredX +
      (rotation === 180 ? embeddedPage.width * scale : 0) +
      (rotation === 270 ? embeddedPage.height * scale : 0),
    y:
      centeredY +
      (rotation === 90 ? embeddedPage.width * scale : 0) +
      (rotation === 180 ? embeddedPage.height * scale : 0),
    width: embeddedPage.width * scale,
    height: embeddedPage.height * scale,
    rotate: degrees(rotation === 90 ? -90 : rotation === 270 ? 90 : rotation)
  });
  pageSizes.push(orientation);
}

function normalizedRotation(page: PDFPage): number {
  return ((page.getRotation().angle % 360) + 360) % 360;
}

async function appendPdf(
  document: PDFDocument,
  buffer: Buffer,
  pageSizes: NormalizedContractPdf["pageSizes"]
): Promise<void> {
  const source = await PDFDocument.load(buffer);
  const sourcePages = source.getPages();
  if (pageSizes.length + sourcePages.length > MAX_TOTAL_PAGES) {
    throw new PdfNormalizationLimitError("合同 PDF 总页数超过系统限制");
  }

  for (const sourcePage of sourcePages) {
    const cropBox = sourcePage.getCropBox();
    const embeddedPage = await document.embedPage(sourcePage, {
      left: cropBox.x,
      bottom: cropBox.y,
      right: cropBox.x + cropBox.width,
      top: cropBox.y + cropBox.height
    });
    drawCenteredPage(
      document,
      embeddedPage,
      normalizedRotation(sourcePage),
      pageSizes
    );
  }
}

function attachmentType(attachment: PdfAttachment): PdfAttachmentType | undefined {
  if (attachment.type) return attachment.type;
  if (attachment.buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  if (
    attachment.buffer.length >= 8 &&
    attachment.buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
  ) {
    return "png";
  }
  if (
    attachment.buffer[0] === 0xff &&
    attachment.buffer[1] === 0xd8 &&
    attachment.buffer[2] === 0xff
  ) {
    return "jpeg";
  }
  return undefined;
}

function drawCenteredImage(
  document: PDFDocument,
  image: PDFImage,
  pageSizes: NormalizedContractPdf["pageSizes"]
): void {
  const maxWidth = A4_WIDTH - IMAGE_ATTACHMENT_MARGIN_POINTS * 2;
  const maxHeight = A4_HEIGHT - IMAGE_ATTACHMENT_MARGIN_POINTS * 2;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  const page = document.addPage(PageSizes.A4);
  page.drawImage(image, {
    x: (A4_WIDTH - width) / 2,
    y: (A4_HEIGHT - height) / 2,
    width,
    height
  });
  pageSizes.push("A4_portrait");
}

function drawIdentityCardImages(
  document: PDFDocument,
  portraitImage: PDFImage,
  emblemImage: PDFImage,
  pageSizes: NormalizedContractPdf["pageSizes"]
): void {
  const page = document.addPage(PageSizes.A4);
  const maxWidth = A4_WIDTH - IMAGE_ATTACHMENT_MARGIN_POINTS * 2;
  const boxHeight = (A4_HEIGHT - IMAGE_ATTACHMENT_MARGIN_POINTS * 3) / 2;
  drawImageInBox(
    page,
    portraitImage,
    IMAGE_ATTACHMENT_MARGIN_POINTS,
    A4_HEIGHT - IMAGE_ATTACHMENT_MARGIN_POINTS - boxHeight,
    maxWidth,
    boxHeight
  );
  drawImageInBox(
    page,
    emblemImage,
    IMAGE_ATTACHMENT_MARGIN_POINTS,
    IMAGE_ATTACHMENT_MARGIN_POINTS,
    maxWidth,
    boxHeight
  );
  pageSizes.push("A4_portrait");
}

function drawImageInBox(
  page: PDFPage,
  image: PDFImage,
  boxX: number,
  boxY: number,
  boxWidth: number,
  boxHeight: number
): void {
  const scale = Math.min(boxWidth / image.width, boxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, {
    x: boxX + (boxWidth - width) / 2,
    y: boxY + (boxHeight - height) / 2,
    width,
    height
  });
}

function identityCardSide(name: string): "portrait" | "emblem" | undefined {
  const normalized = name.replace(/\s+/g, "");
  if (!/(身份证|idcard|id-card|id card)/i.test(name)) return undefined;
  if (/人像面|正面|front/i.test(normalized)) return "portrait";
  if (/国徽面|反面|back/i.test(normalized)) return "emblem";
  return undefined;
}

function findIdentityCardPairIndex(
  attachments: readonly PdfAttachment[],
  currentIndex: number,
  side: "portrait" | "emblem",
  consumedIndexes: ReadonlySet<number>
): number {
  const expectedSide = side === "portrait" ? "emblem" : "portrait";
  return attachments.findIndex((attachment, index) => {
    if (index <= currentIndex || consumedIndexes.has(index)) return false;
    const type = attachmentType(attachment);
    return (
      (type === "png" || type === "jpeg") &&
      identityCardSide(attachment.name) === expectedSide
    );
  });
}

function assertImagePixels(
  attachment: PdfAttachment,
  type: "png" | "jpeg"
): void {
  const { width, height } =
    type === "png"
      ? pngDimensions(attachment.buffer)
      : jpegDimensions(attachment.buffer);
  if (height !== 0 && width > MAX_IMAGE_PIXELS / height) {
    throw new PdfNormalizationLimitError("合同附件图片像素超过系统限制");
  }
}

function pngDimensions(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 24 || buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error("Invalid PNG");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function jpegDimensions(buffer: Buffer): { width: number; height: number } {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new Error("Invalid JPEG");
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) throw new Error("Invalid JPEG");
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) throw new Error("Invalid JPEG");
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5)
      };
    }
    offset += length;
  }
  throw new Error("Invalid JPEG");
}

function exactImageBytes(buffer: Buffer): Uint8Array | ArrayBuffer {
  if (buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength) {
    return buffer;
  }
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return bytes;
}

async function embedImageAttachment(
  document: PDFDocument,
  attachment: PdfAttachment,
  type: "png" | "jpeg"
): Promise<PDFImage> {
  const bytes = exactImageBytes(attachment.buffer);
  return type === "png" ? document.embedPng(bytes) : document.embedJpg(bytes);
}

export async function normalizeContractPdf(
  generatedContractPdf: Buffer,
  attachments: readonly PdfAttachment[]
): Promise<NormalizedContractPdf> {
  if (generatedContractPdf.length > MAX_TOTAL_INPUT_BYTES) {
    throw new PdfNormalizationLimitError("合同 PDF 及附件总大小超过系统限制");
  }
  let totalBytes = generatedContractPdf.length;
  for (const attachment of attachments) {
    if (attachment.buffer.length > MAX_TOTAL_INPUT_BYTES - totalBytes) {
      throw new PdfNormalizationLimitError("合同 PDF 及附件总大小超过系统限制");
    }
    totalBytes += attachment.buffer.length;
  }

  const document = await PDFDocument.create();
  const pageSizes: NormalizedContractPdf["pageSizes"] = [];

  try {
    await appendPdf(document, generatedContractPdf, pageSizes);
  } catch (cause) {
    if (cause instanceof PdfNormalizationLimitError) throw cause;
    throw new Error("合同正文 PDF 格式不正确");
  }

  const consumedAttachmentIndexes = new Set<number>();
  for (const [index, attachment] of attachments.entries()) {
    if (consumedAttachmentIndexes.has(index)) {
      continue;
    }
    const type = attachmentType(attachment);
    if (!type) {
      throw new Error("合同附件文件类型不受支持");
    }

    try {
      if (type === "pdf") {
        await appendPdf(
          document,
          attachment.buffer,
          pageSizes
        );
      } else {
        if (pageSizes.length >= MAX_TOTAL_PAGES) {
          throw new PdfNormalizationLimitError("合同 PDF 总页数超过系统限制");
        }
        assertImagePixels(attachment, type);
        const identitySide = identityCardSide(attachment.name);
        const pairIndex = identitySide
          ? findIdentityCardPairIndex(
              attachments,
              index,
              identitySide,
              consumedAttachmentIndexes
            )
          : -1;
        if (pairIndex > -1) {
          const pair = attachments[pairIndex];
          const pairType = attachmentType(pair);
          if (pairType !== "png" && pairType !== "jpeg") {
            throw new Error("合同附件文件类型不受支持");
          }
          assertImagePixels(pair, pairType);
          const currentImage = await embedImageAttachment(document, attachment, type);
          const pairImage = await embedImageAttachment(document, pair, pairType);
          drawIdentityCardImages(
            document,
            identitySide === "portrait" ? currentImage : pairImage,
            identitySide === "emblem" ? currentImage : pairImage,
            pageSizes
          );
          consumedAttachmentIndexes.add(pairIndex);
        } else {
          drawCenteredImage(
            document,
            await embedImageAttachment(document, attachment, type),
            pageSizes
          );
        }
      }
    } catch (cause) {
      if (cause instanceof PdfNormalizationLimitError) throw cause;
      throw new Error("合同附件处理失败，请检查文件是否完整且格式正确");
    }
  }

  return {
    buffer: Buffer.from(await document.save()),
    pageCount: pageSizes.length,
    warnings: [],
    pageSizes
  };
}
