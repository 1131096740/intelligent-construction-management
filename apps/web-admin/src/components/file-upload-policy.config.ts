import { formatFileSize } from "./file-upload-summary.config";

export interface FileUploadPolicy {
  acceptAttribute: string;
  acceptText: string;
  limitBytes: number;
  limitText: string;
}

export const PRIVATE_FILE_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
const SPOT_PROCUREMENT_QUOTATION_EXTENSIONS = [
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg"
] as const;
const SPOT_PROCUREMENT_REFERENCE_PHOTO_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg"
] as const;

export const CORE_ARCHIVE_UPLOAD_POLICY: FileUploadPolicy = {
  acceptAttribute: ".pdf,.png,.jpg,.jpeg",
  acceptText: "归档文件、常见图片",
  limitBytes: PRIVATE_FILE_UPLOAD_MAX_BYTES,
  limitText: buildUploadLimitText(PRIVATE_FILE_UPLOAD_MAX_BYTES)
};

export const PDF_ARCHIVE_UPLOAD_POLICY: FileUploadPolicy = {
  acceptAttribute: "application/pdf",
  acceptText: "归档文件",
  limitBytes: PRIVATE_FILE_UPLOAD_MAX_BYTES,
  limitText: buildUploadLimitText(PRIVATE_FILE_UPLOAD_MAX_BYTES)
};

export const SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY: FileUploadPolicy = {
  acceptAttribute: SPOT_PROCUREMENT_QUOTATION_EXTENSIONS.join(","),
  acceptText: "报价单（Word、Excel、PDF 或常见图片）",
  limitBytes: PRIVATE_FILE_UPLOAD_MAX_BYTES,
  limitText: buildUploadLimitText(PRIVATE_FILE_UPLOAD_MAX_BYTES)
};

export const SPOT_PROCUREMENT_REFERENCE_PHOTO_UPLOAD_POLICY: FileUploadPolicy =
  {
    acceptAttribute:
      SPOT_PROCUREMENT_REFERENCE_PHOTO_EXTENSIONS.join(","),
    acceptText: "现场参考照片（PNG、JPG 或 JPEG）",
    limitBytes: PRIVATE_FILE_UPLOAD_MAX_BYTES,
    limitText: buildUploadLimitText(PRIVATE_FILE_UPLOAD_MAX_BYTES)
  };

export function spotProcurementQuotationFileError(file: {
  name: string;
  size: number;
}) {
  const fileName = file.name.toLowerCase();
  if (
    !SPOT_PROCUREMENT_QUOTATION_EXTENSIONS.some((extension) =>
      fileName.endsWith(extension)
    )
  ) {
    return `报价附件“${file.name}”的文件格式不支持`;
  }
  if (file.size > SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.limitBytes) {
    return `报价附件“${file.name}”${SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY.limitText}`;
  }
  return null;
}

export function spotProcurementReferencePhotoFileError(file: {
  name: string;
  size: number;
}) {
  const fileName = file.name.toLowerCase();
  if (
    !SPOT_PROCUREMENT_REFERENCE_PHOTO_EXTENSIONS.some((extension) =>
      fileName.endsWith(extension)
    )
  ) {
    return `现场参考照片“${file.name}”的文件格式不支持`;
  }
  if (
    file.size >
    SPOT_PROCUREMENT_REFERENCE_PHOTO_UPLOAD_POLICY.limitBytes
  ) {
    return `现场参考照片“${file.name}”${SPOT_PROCUREMENT_REFERENCE_PHOTO_UPLOAD_POLICY.limitText}`;
  }
  return null;
}

function buildUploadLimitText(limitBytes: number) {
  return `不超过 ${formatFileSize(limitBytes)}`;
}
