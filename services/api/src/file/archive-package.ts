import { BadRequestException } from "@nestjs/common";
import PizZip from "pizzip";

export const ARCHIVE_PACKAGE_MAX_FILES = 50;
export const ARCHIVE_PACKAGE_MAX_BYTES = 200 * 1024 * 1024;

export interface ArchivePackageSelectionFile {
  id: string;
  sizeBytes: number;
}

export interface ArchivePackageEntry {
  fileName: string;
  buffer: Buffer;
}

export function assertArchivePackageSelection(
  files: readonly ArchivePackageSelectionFile[]
): void {
  if (files.length === 0) {
    throw new BadRequestException("请选择要打包下载的资料");
  }
  if (files.length > ARCHIVE_PACKAGE_MAX_FILES) {
    throw new BadRequestException(
      `单次最多打包 ${ARCHIVE_PACKAGE_MAX_FILES} 份资料，请减少选择后重试`
    );
  }
  const totalBytes = files.reduce((total, file) => total + Math.max(0, file.sizeBytes), 0);
  if (totalBytes > ARCHIVE_PACKAGE_MAX_BYTES) {
    throw new BadRequestException("打包资料总量超过 200MB，请分批下载");
  }
}

export function buildArchivePackageBuffer(
  entries: readonly ArchivePackageEntry[]
): Buffer {
  if (entries.length === 0) {
    throw new BadRequestException("请选择要打包下载的资料");
  }
  const zip = new PizZip();
  const usedNames = new Map<string, number>();
  for (const entry of entries) {
    const baseName = safeArchiveEntryName(entry.fileName);
    const occurrence = (usedNames.get(baseName) ?? 0) + 1;
    usedNames.set(baseName, occurrence);
    zip.file(occurrence === 1 ? baseName : numberedFileName(baseName, occurrence), entry.buffer);
  }
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

export function archivePackageFileName(now: Date = new Date()): string {
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const date = [
    beijing.getUTCFullYear(),
    String(beijing.getUTCMonth() + 1).padStart(2, "0"),
    String(beijing.getUTCDate()).padStart(2, "0")
  ].join("");
  const time = [
    String(beijing.getUTCHours()).padStart(2, "0"),
    String(beijing.getUTCMinutes()).padStart(2, "0")
  ].join("");
  return `资料库打包-${date}-${time}.zip`;
}

function safeArchiveEntryName(fileName: string): string {
  const normalized = fileName
    .replace(/[\\/]+/gu, "_")
    .replace(/^\.+/u, "")
    // eslint-disable-next-line no-control-regex -- Strip literal control characters from archive entry names.
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim();
  return normalized || "资料文件";
}

function numberedFileName(fileName: string, occurrence: number): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex <= 0) return `${fileName} (${occurrence})`;
  return `${fileName.slice(0, dotIndex)} (${occurrence})${fileName.slice(dotIndex)}`;
}
