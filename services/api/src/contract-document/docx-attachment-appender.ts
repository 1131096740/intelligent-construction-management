import PizZip from "pizzip";
import type { PdfAttachment } from "./pdf-normalizer";

type ImageAttachmentType = "png" | "jpeg";
type IdentityCardSide = "portrait" | "emblem";

interface ImageAttachment {
  attachment: PdfAttachment;
  type: ImageAttachmentType;
  width: number;
  height: number;
  mediaPath: string;
  relationshipId: string;
}

interface SingleImagePage {
  kind: "single";
  image: ImageAttachment;
  label?: string;
}

interface IdentityCardPage {
  kind: "identity_card";
  portrait: ImageAttachment;
  emblem: ImageAttachment;
}

type ImagePage = SingleImagePage | IdentityCardPage;
type DocxZip = InstanceType<typeof PizZip>;

const RELATIONSHIP_NS =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const IMAGE_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const CONTENT_WIDTH_TWIPS = 10_470;
const CONTENT_HEIGHT_TWIPS = 15_390;
const EMU_PER_TWIP = 635;

export function appendDocxImageAttachments(
  docx: Buffer,
  attachments: readonly PdfAttachment[]
): Buffer {
  const imageCandidates = attachments
    .map((attachment, index) => ({ attachment, index, type: imageType(attachment) }))
    .filter(
      (item): item is { attachment: PdfAttachment; index: number; type: ImageAttachmentType } =>
        item.type === "png" || item.type === "jpeg"
    );
  if (imageCandidates.length === 0) {
    return docx;
  }

  const zip = new PizZip(docx);
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) {
    throw new Error("Invalid DOCX: missing word/document.xml");
  }
  const relationshipIds = nextRelationshipIds(zip, imageCandidates.length);
  const images = imageCandidates.map((item, imageIndex) => {
    const extension = item.type === "png" ? "png" : "jpg";
    const mediaPath = `word/media/contract-attachment-${item.index + 1}.${extension}`;
    const dimensions =
      item.type === "png"
        ? pngDimensions(item.attachment.buffer)
        : jpegDimensions(item.attachment.buffer);
    zip.file(mediaPath, item.attachment.buffer);
    return {
      attachment: item.attachment,
      type: item.type,
      width: dimensions.width,
      height: dimensions.height,
      mediaPath,
      relationshipId: relationshipIds[imageIndex]
    };
  });

  const pages = groupImagePages(images);
  zip.file(
    "word/document.xml",
    appendBeforeSection(documentFile.asText(), pages.map(pageXml).join(""))
  );
  writeRelationships(zip, images);
  writeContentTypes(zip, images);
  return zip.generate({ type: "nodebuffer" });
}

function imageType(attachment: PdfAttachment): ImageAttachmentType | undefined {
  if (attachment.type === "png" || attachment.type === "jpeg") return attachment.type;
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

function groupImagePages(images: readonly ImageAttachment[]): ImagePage[] {
  const consumed = new Set<number>();
  const pages: ImagePage[] = [];
  for (const [index, image] of images.entries()) {
    if (consumed.has(index)) continue;
    const side = identityCardSide(image.attachment.name);
    if (side) {
      const pairIndex = images.findIndex(
        (candidate, candidateIndex) =>
          candidateIndex > index &&
          !consumed.has(candidateIndex) &&
          identityCardSide(candidate.attachment.name) === oppositeSide(side)
      );
      if (pairIndex > -1) {
        const pair = images[pairIndex];
        pages.push({
          kind: "identity_card",
          portrait: side === "portrait" ? image : pair,
          emblem: side === "emblem" ? image : pair
        });
        consumed.add(pairIndex);
        continue;
      }
      pages.push({ kind: "single", image, label: sideLabel(side) });
      continue;
    }
    pages.push({ kind: "single", image });
  }
  return pages;
}

function pageXml(page: ImagePage): string {
  if (page.kind === "identity_card") {
    const rowHeight = Math.floor(CONTENT_HEIGHT_TWIPS / 2);
    return `${pageBreak()}<w:tbl>${tableProperties()}${tableRowXml(
      rowHeight,
      `${labelParagraph("身份证人像面")}${imageParagraph(
        page.portrait,
        CONTENT_WIDTH_TWIPS,
        rowHeight - 480
      )}`
    )}${tableRowXml(
      CONTENT_HEIGHT_TWIPS - rowHeight,
      `${labelParagraph("身份证国徽面")}${imageParagraph(
        page.emblem,
        CONTENT_WIDTH_TWIPS,
        rowHeight - 480
      )}`
    )}</w:tbl>`;
  }
  return `${pageBreak()}<w:tbl>${tableProperties()}${tableRowXml(
    CONTENT_HEIGHT_TWIPS,
    `${page.label ? labelParagraph(page.label) : ""}${imageParagraph(
      page.image,
      CONTENT_WIDTH_TWIPS,
      page.label ? CONTENT_HEIGHT_TWIPS - 480 : CONTENT_HEIGHT_TWIPS
    )}`
  )}</w:tbl>`;
}

function pageBreak(): string {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

function tableProperties(): string {
  return (
    '<w:tblPr><w:tblW w:w="0" w:type="auto"/>' +
    '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/>' +
    '<w:bottom w:val="nil"/><w:right w:val="nil"/>' +
    '<w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>' +
    "</w:tblPr>"
  );
}

function tableRowXml(heightTwips: number, content: string): string {
  return (
    `<w:tr><w:trPr><w:trHeight w:val="${heightTwips}" w:hRule="exact"/>` +
    `</w:trPr><w:tc><w:tcPr><w:tcW w:w="${CONTENT_WIDTH_TWIPS}" w:type="dxa"/>` +
    '<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/>' +
    '<w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders>' +
    '<w:vAlign w:val="center"/></w:tcPr>' +
    `${content}</w:tc></w:tr>`
  );
}

function labelParagraph(label: string): string {
  return (
    '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="120"/></w:pPr>' +
    `<w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t>${escapeXml(
      label
    )}</w:t></w:r></w:p>`
  );
}

function imageParagraph(
  image: ImageAttachment,
  maxWidthTwips: number,
  maxHeightTwips: number
): string {
  const { cx, cy } = fitImage(
    image.width,
    image.height,
    maxWidthTwips * EMU_PER_TWIP,
    maxHeightTwips * EMU_PER_TWIP
  );
  const docPrId = image.relationshipId.replace(/\D/g, "") || "1";
  return (
    '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing>' +
    '<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">' +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${docPrId}" name="${escapeXml(image.attachment.name)}"/>` +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:nvPicPr><pic:cNvPr id="0" name="attachment"/><pic:cNvPicPr/></pic:nvPicPr>' +
    `<pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${image.relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    "</pic:pic></a:graphicData></a:graphic></wp:inline>" +
    "</w:drawing></w:r></w:p>"
  );
}

function fitImage(
  width: number,
  height: number,
  maxCx: number,
  maxCy: number
): { cx: number; cy: number } {
  const scale = Math.min(maxCx / width, maxCy / height);
  return {
    cx: Math.round(width * scale),
    cy: Math.round(height * scale)
  };
}

function nextRelationshipIds(zip: DocxZip, count: number): string[] {
  const existing = zip.file("word/_rels/document.xml.rels")?.asText() ?? "";
  const maxId = [...existing.matchAll(/Id="rId(\d+)"/g)].reduce(
    (max, match) => Math.max(max, Number(match[1])),
    0
  );
  return Array.from({ length: count }, (_, index) => `rId${maxId + index + 1}`);
}

function writeRelationships(zip: DocxZip, images: readonly ImageAttachment[]): void {
  const path = "word/_rels/document.xml.rels";
  const existing =
    zip.file(path)?.asText() ??
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${RELATIONSHIP_NS}"></Relationships>`;
  const relationships = images
    .map((image) => {
      const target = image.mediaPath.replace(/^word\//, "");
      return `<Relationship Id="${image.relationshipId}" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="${target}"/>`;
    })
    .join("");
  zip.file(path, existing.replace("</Relationships>", `${relationships}</Relationships>`));
}

function writeContentTypes(zip: DocxZip, images: readonly ImageAttachment[]): void {
  const file = zip.file("[Content_Types].xml");
  if (!file) throw new Error("Invalid DOCX: missing [Content_Types].xml");
  let xml = file.asText();
  if (images.some((image) => image.type === "png") && !xml.includes('Extension="png"')) {
    xml = xml.replace(
      "</Types>",
      '<Default Extension="png" ContentType="image/png"/></Types>'
    );
  }
  if (images.some((image) => image.type === "jpeg") && !xml.includes('Extension="jpg"')) {
    xml = xml.replace(
      "</Types>",
      '<Default Extension="jpg" ContentType="image/jpeg"/></Types>'
    );
  }
  zip.file("[Content_Types].xml", xml);
}

function appendBeforeSection(documentXml: string, addition: string): string {
  const sectionIndex = documentXml.lastIndexOf("<w:sectPr");
  if (sectionIndex >= 0) {
    return `${documentXml.slice(0, sectionIndex)}${addition}${documentXml.slice(sectionIndex)}`;
  }
  const bodyEndIndex = documentXml.lastIndexOf("</w:body>");
  if (bodyEndIndex < 0) throw new Error("Invalid DOCX: missing w:body");
  return `${documentXml.slice(0, bodyEndIndex)}${addition}${documentXml.slice(bodyEndIndex)}`;
}

function identityCardSide(name: string): IdentityCardSide | undefined {
  const normalized = name.replace(/\s+/g, "");
  if (!/(身份证|idcard|id-card|id card)/i.test(name)) return undefined;
  if (/人像面|正面|front/i.test(normalized)) return "portrait";
  if (/国徽面|反面|back/i.test(normalized)) return "emblem";
  return undefined;
}

function oppositeSide(side: IdentityCardSide): IdentityCardSide {
  return side === "portrait" ? "emblem" : "portrait";
}

function sideLabel(side: IdentityCardSide): string {
  return side === "portrait" ? "身份证人像面" : "身份证国徽面";
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

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
