import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { extname } from "node:path";

export const signedSettlementUploadRoot = "uploads/signed-contract-settlement/";

export function isSignedSettlementObjectKey(key: string | undefined) {
  return key?.startsWith(signedSettlementUploadRoot) === true;
}

export function signedSettlementUploadPrefix(projectId: string) {
  return `${signedSettlementUploadRoot}${createHash("sha256").update(projectId).digest("hex")}/`;
}

export function signedSettlementFileMime(name: string, buffer: Buffer) {
  const extension = extname(name).toLowerCase();
  if (extension === ".pdf" && buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (extension === ".png" && buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if ([".jpg", ".jpeg"].includes(extension) && buffer.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))) return "image/jpeg";
  throw new BadRequestException("请选择内容与扩展名一致的 PDF、JPG 或 PNG 已签原件");
}

export function isSignedSettlementFileMime(mime: string) {
  return ["application/pdf", "image/png", "image/jpeg"].includes(mime);
}
