import { BadRequestException } from "@nestjs/common";
import { inflateRawSync } from "node:zlib";
import type { MemoryUploadedFile } from "./uploaded-file";

export type BoundedXlsxUpload = Pick<MemoryUploadedFile, "originalname" | "mimetype" | "size" | "buffer">;

export const BUSINESS_ENTRY_XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 500;
const MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const MAX_ZIP_END_RECORD_BYTES = 65_557;

function worksheetColumnNumber(letters: string) {
  return [...letters.toUpperCase()].reduce(
    (result, letter) => result * 26 + letter.charCodeAt(0) - 64,
    0
  );
}

export function assertExcelUpload(file: BoundedXlsxUpload) {
  if (
    !file.originalname.toLowerCase().endsWith(".xlsx") ||
    file.mimetype !== BUSINESS_ENTRY_XLSX_MIME
  ) {
    throw new BadRequestException("业务 Excel 只支持 XLSX 文件");
  }
  if (file.size !== file.buffer.length || file.buffer.length > MAX_FILE_BYTES) {
    throw new BadRequestException("业务 Excel 文件大小不正确或超过 10 MB");
  }
  if (
    file.buffer.length < 4 ||
    file.buffer[0] !== 0x50 ||
    file.buffer[1] !== 0x4b ||
    file.buffer[2] !== 0x03 ||
    file.buffer[3] !== 0x04
  ) {
    throw new BadRequestException("业务 Excel 文件签名不正确");
  }
}

export function assertSafeXlsxArchive(buffer: Buffer, maximumRows: number, maximumColumns: number) {
  const invalidArchive = () => new BadRequestException(
    "业务 Excel 压缩包结构异常或解压后内容过大"
  );
  try {
    const eocdOffset = findZipEndRecord(buffer);
    if (eocdOffset < 0 || eocdOffset + 22 > buffer.length) throw invalidArchive();
    const diskNumber = buffer.readUInt16LE(eocdOffset + 4);
    const centralDirectoryDisk = buffer.readUInt16LE(eocdOffset + 6);
    const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8);
    const entryCount = buffer.readUInt16LE(eocdOffset + 10);
    const centralDirectoryBytes = buffer.readUInt32LE(eocdOffset + 12);
    const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
    const commentBytes = buffer.readUInt16LE(eocdOffset + 20);
    if (
      diskNumber !== 0 ||
      centralDirectoryDisk !== 0 ||
      entriesOnDisk !== entryCount ||
      entryCount === 0 ||
      entryCount > MAX_ZIP_ENTRIES ||
      eocdOffset + 22 + commentBytes !== buffer.length ||
      centralDirectoryOffset + centralDirectoryBytes > eocdOffset
    ) {
      throw invalidArchive();
    }

    const seenNames = new Set<string>();
    let cursor = centralDirectoryOffset;
    let totalUncompressedBytes = 0;
    let worksheetCount = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (
        cursor + 46 > eocdOffset ||
        buffer.readUInt32LE(cursor) !== ZIP_CENTRAL_DIRECTORY_HEADER
      ) {
        throw invalidArchive();
      }
      const flags = buffer.readUInt16LE(cursor + 8);
      const compressionMethod = buffer.readUInt16LE(cursor + 10);
      const compressedBytes = buffer.readUInt32LE(cursor + 20);
      const declaredUncompressedBytes = buffer.readUInt32LE(cursor + 24);
      const nameBytes = buffer.readUInt16LE(cursor + 28);
      const extraBytes = buffer.readUInt16LE(cursor + 30);
      const entryCommentBytes = buffer.readUInt16LE(cursor + 32);
      const entryDisk = buffer.readUInt16LE(cursor + 34);
      const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
      const nextCursor = cursor + 46 + nameBytes + extraBytes + entryCommentBytes;
      if (
        nextCursor > centralDirectoryOffset + centralDirectoryBytes ||
        entryDisk !== 0 ||
        (flags & 0x0001) !== 0 ||
        ![0, 8].includes(compressionMethod) ||
        declaredUncompressedBytes > MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES
      ) {
        throw invalidArchive();
      }
      const nameBuffer = buffer.subarray(cursor + 46, cursor + 46 + nameBytes);
      const name = nameBuffer.toString("utf8");
      if (!name || seenNames.has(name)) throw invalidArchive();
      seenNames.add(name);

      if (
        localHeaderOffset + 30 > centralDirectoryOffset ||
        buffer.readUInt32LE(localHeaderOffset) !== ZIP_LOCAL_FILE_HEADER ||
        buffer.readUInt16LE(localHeaderOffset + 8) !== compressionMethod
      ) {
        throw invalidArchive();
      }
      const localNameBytes = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraBytes = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localNameBytes + localExtraBytes;
      const dataEnd = dataOffset + compressedBytes;
      if (
        dataEnd > centralDirectoryOffset ||
        !buffer.subarray(localHeaderOffset + 30, localHeaderOffset + 30 + localNameBytes)
          .equals(nameBuffer)
      ) {
        throw invalidArchive();
      }
      const compressed = buffer.subarray(dataOffset, dataEnd);
      const uncompressed = compressionMethod === 0
        ? compressed
        : inflateRawSync(compressed, {
            maxOutputLength: MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES + 1
          });
      if (uncompressed.length !== declaredUncompressedBytes) throw invalidArchive();
      totalUncompressedBytes += uncompressed.length;
      if (totalUncompressedBytes > MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES) {
        throw invalidArchive();
      }

      if (/^xl\/worksheets\/sheet\d+\.xml$/iu.test(name)) {
        worksheetCount += 1;
        assertWorksheetBounds(uncompressed.toString("utf8"), maximumRows, maximumColumns);
      }
      cursor = nextCursor;
    }
    if (
      cursor !== centralDirectoryOffset + centralDirectoryBytes ||
      worksheetCount === 0
    ) {
      throw invalidArchive();
    }
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw invalidArchive();
  }
}

function findZipEndRecord(buffer: Buffer) {
  const firstCandidate = Math.max(0, buffer.length - MAX_ZIP_END_RECORD_BYTES);
  for (let offset = buffer.length - 22; offset >= firstCandidate; offset -= 1) {
    if (buffer.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY) return offset;
  }
  return -1;
}

function assertWorksheetBounds(xml: string, maximumRows: number, maximumColumns: number) {
  const invalidWorksheet = () => new BadRequestException(
    "业务 Excel 工作表范围超过当前字段定义允许的上限"
  );
  if (/<mergeCell\b/iu.test(xml)) throw invalidWorksheet();
  const dimension = /<dimension\b[^>]*\bref=["']([^"']+)["']/iu.exec(xml)?.[1];
  const lastCell = dimension?.split(":").at(-1)?.replace(/\$/gu, "");
  const dimensionMatch = /^([A-Z]+)(\d+)$/iu.exec(lastCell ?? "");
  if (
    !dimensionMatch ||
    Number(dimensionMatch[2]) > maximumRows ||
    worksheetColumnNumber(dimensionMatch[1]!) > maximumColumns
  ) {
    throw invalidWorksheet();
  }

  let columnDefinitionCount = 0;
  for (const match of xml.matchAll(/<col\b([^>]*)\/?\s*>/giu)) {
    columnDefinitionCount += 1;
    const minimum = Number(/\bmin=["'](\d+)["']/iu.exec(match[1] ?? "")?.[1]);
    const maximum = Number(/\bmax=["'](\d+)["']/iu.exec(match[1] ?? "")?.[1]);
    if (
      !Number.isSafeInteger(minimum) ||
      !Number.isSafeInteger(maximum) ||
      minimum < 1 ||
      minimum > maximum ||
      maximum > maximumColumns ||
      columnDefinitionCount > maximumColumns
    ) {
      throw invalidWorksheet();
    }
  }

  let rowCount = 0;
  for (const match of xml.matchAll(/<row\b([^>]*)>/giu)) {
    rowCount += 1;
    const rowNumber = /\br=["'](\d+)["']/iu.exec(match[1] ?? "")?.[1];
    if (!rowNumber || rowCount > maximumRows || Number(rowNumber) > maximumRows) {
      throw invalidWorksheet();
    }
  }
  for (const match of xml.matchAll(/<c\b([^>]*)>/giu)) {
    const reference = /\br=["']\$?([A-Z]+)\$?(\d+)["']/iu.exec(match[1] ?? "");
    if (
      !reference ||
      Number(reference[2]) > maximumRows ||
      worksheetColumnNumber(reference[1]!) > maximumColumns
    ) {
      throw invalidWorksheet();
    }
  }
}
