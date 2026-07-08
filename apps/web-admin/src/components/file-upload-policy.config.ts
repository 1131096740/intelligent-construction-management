import { formatFileSize } from "./file-upload-summary.config";

export interface FileUploadPolicy {
  acceptAttribute: string;
  acceptText: string;
  limitBytes: number;
  limitText: string;
}

export const PRIVATE_FILE_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

export const CORE_ARCHIVE_UPLOAD_POLICY: FileUploadPolicy = {
  acceptAttribute: ".pdf,.png,.jpg,.jpeg",
  acceptText: "PDF、PNG、JPG、JPEG",
  limitBytes: PRIVATE_FILE_UPLOAD_MAX_BYTES,
  limitText: buildUploadLimitText(PRIVATE_FILE_UPLOAD_MAX_BYTES)
};

export const PDF_ARCHIVE_UPLOAD_POLICY: FileUploadPolicy = {
  acceptAttribute: "application/pdf",
  acceptText: "PDF",
  limitBytes: PRIVATE_FILE_UPLOAD_MAX_BYTES,
  limitText: buildUploadLimitText(PRIVATE_FILE_UPLOAD_MAX_BYTES)
};

function buildUploadLimitText(limitBytes: number) {
  return `不超过 ${formatFileSize(limitBytes)}`;
}
