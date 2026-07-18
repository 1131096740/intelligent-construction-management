import {
  BadRequestException,
  Injectable,
  InternalServerErrorException
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import sharpModule = require("sharp");

const sharp = sharpModule as unknown as typeof import("sharp").default;

export const RECEIPT_WATERMARK_FONT_PATH = resolve(
  __dirname,
  "../../assets/fonts/NotoSansSC-Regular.otf"
);
export const RECEIPT_WATERMARK_MAX_INPUT_BYTES = 25 * 1024 * 1024;
export const RECEIPT_WATERMARK_MAX_INPUT_PIXELS = 50_000_000;
export const RECEIPT_WATERMARK_MIN_DIMENSION = 180;
export const RECEIPT_WATERMARK_MAX_DIMENSION = 8_192;
export const RECEIPT_WATERMARK_MAX_CARD_HEIGHT = 3_200;
export const RECEIPT_WATERMARK_MAX_OUTPUT_PIXELS = 80_000_000;

const INVALID_IMAGE_MESSAGE = "收货照片必须是有效的 JPEG 或 PNG 图片";
const MIME_MISMATCH_MESSAGE = "收货照片类型与文件内容不一致";
const INVALID_INPUT_MESSAGE = "收货照片水印参数不合法";
const INVALID_DIMENSIONS_MESSAGE = "收货照片尺寸不符合要求";
const TEXT_TOO_LONG_MESSAGE = "收货照片水印文字过长";
const GENERATION_FAILED_MESSAGE = "收货照片水印生成失败，请重新上传";

const ALLOWED_INPUT_KEYS = new Set([
  "originalBuffer",
  "mimeType",
  "projectLabel",
  "procurementCode",
  "uploaderName",
  "uploadedAt",
  "source",
  "note",
  "category"
]);

export interface ReceiptWatermarkInput {
  originalBuffer: Buffer;
  mimeType: "image/jpeg" | "image/png";
  projectLabel: string;
  procurementCode: string;
  uploaderName: string;
  uploadedAt: Date;
  source: "camera" | "album";
  note?: string;
  category: "material_scene" | "delivery_note";
}

export interface ReceiptWatermarkOutput {
  buffer: Buffer;
  mimeType: "image/jpeg" | "image/png";
  originalSha256: string;
  watermarkedSha256: string;
  width: number;
  height: number;
}

interface OrientedImageDimensions {
  width: number;
  height: number;
}

export interface ReceiptWatermarkLayout {
  padding: number;
  accentWidth: number;
  fontSize: number;
  textWidth: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function normalizeSingleLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function codePointLength(value: string): number {
  return Array.from(normalizeSingleLine(value)).length;
}

function containsUnsafeMarkupCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) return true;
    const invalidXmlControl =
      (codePoint >= 0 && codePoint <= 8) ||
      codePoint === 11 ||
      codePoint === 12 ||
      (codePoint >= 14 && codePoint <= 31) ||
      (codePoint >= 127 && codePoint <= 159);
    const directionalControl =
      codePoint === 0x061c ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069);
    const invalidScalar = codePoint >= 0xd800 && codePoint <= 0xdfff;
    const unicodeNoncharacter =
      (codePoint >= 0xfdd0 && codePoint <= 0xfdef) ||
      (codePoint & 0xffff) === 0xfffe ||
      (codePoint & 0xffff) === 0xffff;
    if (
      invalidXmlControl ||
      directionalControl ||
      invalidScalar ||
      unicodeNoncharacter
    ) {
      return true;
    }
  }
  return false;
}

function escapePangoMarkup(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

function formatShanghaiServerTime(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));

  return `${values.get("year")}-${values.get("month")}-${values.get(
    "day"
  )} ${values.get("hour")}:${values.get("minute")}:${values.get("second")}`;
}

export function buildReceiptWatermarkMarkup(
  input: ReceiptWatermarkInput,
  fontSize = 22
): string {
  const titleSize = fontSize + 4;
  const sourceLabel = input.source === "camera" ? "系统拍照" : "相册上传";
  const categoryLabel =
    input.category === "material_scene"
      ? "材料/卸货现场照片"
      : "乙方送货单";
  const projectLabel = escapePangoMarkup(
    normalizeSingleLine(input.projectLabel)
  );
  const procurementCode = escapePangoMarkup(
    normalizeSingleLine(input.procurementCode)
  );
  const uploaderName = escapePangoMarkup(
    normalizeSingleLine(input.uploaderName)
  );
  const normalizedNote = normalizeSingleLine(input.note ?? "");
  const note = normalizedNote ? escapePangoMarkup(normalizedNote) : "无";
  const serverTime = formatShanghaiServerTime(input.uploadedAt);
  const lines = [
    `<span foreground="#0f766e" font_desc="Noto Sans SC ${titleSize}">建工智管 · 零星采购收货存档 · ${categoryLabel}</span>`,
    `<span foreground="#111827" font_desc="Noto Sans SC ${fontSize}">项目：${projectLabel}</span>`,
    `<span foreground="#111827" font_desc="Noto Sans SC ${fontSize}">采购编号：${procurementCode}</span>`,
    `<span foreground="#475569" font_desc="Noto Sans SC ${fontSize}">上传人：${uploaderName}    服务器时间：${serverTime}    来源：${sourceLabel}</span>`
  ];

  lines.push(
    `<span foreground="#475569" font_desc="Noto Sans SC ${fontSize}">备注：${note}</span>`
  );

  return lines.join("\n");
}

export function calculateReceiptWatermarkLayout(
  imageWidth: number
): ReceiptWatermarkLayout {
  const padding = clamp(Math.round(imageWidth * 0.035), 14, 287);
  const accentWidth = clamp(Math.round(imageWidth * 0.012), 4, 99);
  const fontSize = clamp(Math.round(imageWidth * 0.03), 15, 246);

  return {
    padding,
    accentWidth,
    fontSize,
    textWidth: Math.max(imageWidth - padding * 2 - accentWidth, 1)
  };
}

@Injectable()
export class ReceiptWatermarkService {
  async generate(input: ReceiptWatermarkInput): Promise<ReceiptWatermarkOutput> {
    this.assertValidInput(input);
    const dimensions = await this.readAndValidateMetadata(input);
    const originalSha256 = sha256(input.originalBuffer);

    try {
      const rendered = await this.renderWatermarkedBuffer(input, dimensions);
      const watermarkedSha256 = sha256(rendered.buffer);
      if (watermarkedSha256 === originalSha256) {
        throw new Error("水印图哈希未发生变化");
      }

      return {
        ...rendered,
        mimeType: input.mimeType,
        originalSha256,
        watermarkedSha256
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(GENERATION_FAILED_MESSAGE);
    }
  }

  protected async renderWatermarkedBuffer(
    input: ReceiptWatermarkInput,
    dimensions: OrientedImageDimensions
  ): Promise<Pick<ReceiptWatermarkOutput, "buffer" | "width" | "height">> {
    const { padding, accentWidth, fontSize, textWidth } =
      calculateReceiptWatermarkLayout(dimensions.width);
    const text = await sharp({
      text: {
        text: buildReceiptWatermarkMarkup(input, fontSize),
        font: "Noto Sans SC",
        fontfile: RECEIPT_WATERMARK_FONT_PATH,
        width: textWidth,
        align: "left",
        rgba: true,
        spacing: Math.round(fontSize * 0.35),
        wrap: "word-char"
      }
    })
      .png()
      .toBuffer({ resolveWithObject: true });
    const cardHeight = Math.max(text.info.height + padding * 2, 80);
    if (cardHeight > RECEIPT_WATERMARK_MAX_CARD_HEIGHT) {
      throw new BadRequestException(TEXT_TOO_LONG_MESSAGE);
    }
    if (
      dimensions.width * (dimensions.height + cardHeight) >
      RECEIPT_WATERMARK_MAX_OUTPUT_PIXELS
    ) {
      throw new BadRequestException(INVALID_DIMENSIONS_MESSAGE);
    }
    const output = sharp(input.originalBuffer, {
      failOn: "warning",
      limitInputPixels: RECEIPT_WATERMARK_MAX_INPUT_PIXELS,
      unlimited: false
    })
      .autoOrient()
      .extend({
        bottom: cardHeight,
        background: "#f8fafc"
      })
      .composite([
        {
          input: {
            create: {
              width: accentWidth,
              height: cardHeight,
              channels: 4,
              background: "#0f766e"
            }
          },
          left: 0,
          top: dimensions.height
        },
        {
          input: text.data,
          left: padding + accentWidth,
          top: dimensions.height + padding
        }
      ])
      .toColorspace("srgb");
    const encoded =
      input.mimeType === "image/jpeg"
        ? output.jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
        : output.png({ compressionLevel: 9 });
    const rendered = await encoded.toBuffer({ resolveWithObject: true });

    return {
      buffer: rendered.data,
      width: rendered.info.width,
      height: rendered.info.height
    };
  }

  private assertValidInput(input: ReceiptWatermarkInput): void {
    if (
      !input ||
      typeof input !== "object" ||
      Object.keys(input).some((key) => !ALLOWED_INPUT_KEYS.has(key))
    ) {
      throw new BadRequestException(INVALID_INPUT_MESSAGE);
    }
    if (
      !Buffer.isBuffer(input.originalBuffer) ||
      input.originalBuffer.length === 0 ||
      input.originalBuffer.length > RECEIPT_WATERMARK_MAX_INPUT_BYTES ||
      (input.mimeType !== "image/jpeg" && input.mimeType !== "image/png")
    ) {
      throw new BadRequestException(INVALID_IMAGE_MESSAGE);
    }
    if (
      typeof input.projectLabel !== "string" ||
      !normalizeSingleLine(input.projectLabel) ||
      typeof input.procurementCode !== "string" ||
      !normalizeSingleLine(input.procurementCode) ||
      typeof input.uploaderName !== "string" ||
      !normalizeSingleLine(input.uploaderName) ||
      !(input.uploadedAt instanceof Date) ||
      !Number.isFinite(input.uploadedAt.getTime()) ||
      (input.source !== "camera" && input.source !== "album") ||
      (input.category !== "material_scene" &&
        input.category !== "delivery_note") ||
      (input.note !== undefined && typeof input.note !== "string")
    ) {
      throw new BadRequestException(INVALID_INPUT_MESSAGE);
    }
    if (
      codePointLength(input.projectLabel) > 200 ||
      codePointLength(input.procurementCode) > 100 ||
      codePointLength(input.uploaderName) > 100 ||
      codePointLength(input.note ?? "") > 500
    ) {
      throw new BadRequestException(TEXT_TOO_LONG_MESSAGE);
    }
    if (
      [
        input.projectLabel,
        input.procurementCode,
        input.uploaderName,
        input.note ?? ""
      ].some(containsUnsafeMarkupCharacter)
    ) {
      throw new BadRequestException(INVALID_INPUT_MESSAGE);
    }
  }

  private async readAndValidateMetadata(
    input: ReceiptWatermarkInput
  ): Promise<OrientedImageDimensions> {
    let image: ReturnType<typeof sharp>;
    let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
    try {
      image = sharp(input.originalBuffer, {
        failOn: "warning",
        limitInputPixels: RECEIPT_WATERMARK_MAX_INPUT_PIXELS,
        unlimited: false
      });
      metadata = await image.metadata();
    } catch {
      throw new BadRequestException(INVALID_IMAGE_MESSAGE);
    }

    const expectedFormat = input.mimeType === "image/jpeg" ? "jpeg" : "png";
    if (metadata.format !== expectedFormat) {
      if (metadata.format === "jpeg" || metadata.format === "png") {
        throw new BadRequestException(MIME_MISMATCH_MESSAGE);
      }
      throw new BadRequestException(INVALID_IMAGE_MESSAGE);
    }
    if (
      !metadata.width ||
      !metadata.height ||
      (metadata.pages !== undefined && metadata.pages !== 1)
    ) {
      throw new BadRequestException(INVALID_IMAGE_MESSAGE);
    }
    if (
      Math.min(metadata.width, metadata.height) <
        RECEIPT_WATERMARK_MIN_DIMENSION ||
      Math.max(metadata.width, metadata.height) >
        RECEIPT_WATERMARK_MAX_DIMENSION ||
      metadata.width * metadata.height >
        RECEIPT_WATERMARK_MAX_INPUT_PIXELS
    ) {
      throw new BadRequestException(INVALID_DIMENSIONS_MESSAGE);
    }
    try {
      const stats = await image.stats();
      const alphaChannel = stats.channels[stats.channels.length - 1];
      if (metadata.hasAlpha && alphaChannel?.max === 0) {
        throw new BadRequestException(INVALID_IMAGE_MESSAGE);
      }
    } catch {
      throw new BadRequestException(INVALID_IMAGE_MESSAGE);
    }

    const swapsAxes =
      metadata.orientation !== undefined &&
      [5, 6, 7, 8].includes(metadata.orientation);
    return swapsAxes
      ? { width: metadata.height, height: metadata.width }
      : { width: metadata.width, height: metadata.height };
  }
}
