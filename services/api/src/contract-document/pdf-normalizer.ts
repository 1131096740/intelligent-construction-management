import {
  PageSizes,
  PDFDocument,
  type PDFEmbeddedPage,
  type PDFImage
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
  pageSizes: NormalizedContractPdf["pageSizes"]
): void {
  const orientation = pageOrientation(embeddedPage.width, embeddedPage.height);
  const [width, height] =
    orientation === "A4_landscape"
      ? [A4_HEIGHT, A4_WIDTH]
      : [A4_WIDTH, A4_HEIGHT];
  const scale = Math.min(
    width / embeddedPage.width,
    height / embeddedPage.height
  );
  const page = document.addPage([width, height]);
  page.drawPage(embeddedPage, {
    x: (width - embeddedPage.width * scale) / 2,
    y: (height - embeddedPage.height * scale) / 2,
    width: embeddedPage.width * scale,
    height: embeddedPage.height * scale
  });
  pageSizes.push(orientation);
}

async function appendPdf(
  document: PDFDocument,
  buffer: Buffer,
  pageSizes: NormalizedContractPdf["pageSizes"]
): Promise<void> {
  const source = await PDFDocument.load(Uint8Array.from(buffer));
  const embeddedPages = await document.embedPages(source.getPages());
  for (const embeddedPage of embeddedPages) {
    drawCenteredPage(document, embeddedPage, pageSizes);
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
  const scale = Math.min(A4_WIDTH / image.width, A4_HEIGHT / image.height);
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

export async function normalizeContractPdf(
  generatedContractPdf: Buffer,
  attachments: readonly PdfAttachment[]
): Promise<NormalizedContractPdf> {
  const document = await PDFDocument.create();
  const pageSizes: NormalizedContractPdf["pageSizes"] = [];

  try {
    await appendPdf(document, generatedContractPdf, pageSizes);
  } catch (cause) {
    throw new Error("Invalid generated contract PDF", { cause });
  }

  for (const [index, attachment] of attachments.entries()) {
    const context = `attachment ${index + 1} ("${attachment.name}")`;
    const type = attachmentType(attachment);
    if (!type) {
      throw new Error(
        `${context[0].toUpperCase()}${context.slice(1)} has an unsupported file type`
      );
    }

    try {
      if (type === "pdf") {
        await appendPdf(document, attachment.buffer, pageSizes);
      } else {
        const bytes = Uint8Array.from(attachment.buffer);
        const image =
          type === "png"
            ? await document.embedPng(bytes)
            : await document.embedJpg(bytes);
        drawCenteredImage(document, image, pageSizes);
      }
    } catch (cause) {
      throw new Error(
        `Failed to process ${context}`,
        { cause }
      );
    }
  }

  return {
    buffer: Buffer.from(await document.save()),
    pageCount: pageSizes.length,
    warnings: [],
    pageSizes
  };
}
