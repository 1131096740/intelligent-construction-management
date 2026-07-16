import { describe, expect, it } from "vitest";
import {
  CORE_ARCHIVE_UPLOAD_POLICY,
  PDF_ARCHIVE_UPLOAD_POLICY,
  PRIVATE_FILE_UPLOAD_MAX_BYTES,
  SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY,
  SPOT_PROCUREMENT_REFERENCE_PHOTO_UPLOAD_POLICY,
  spotProcurementQuotationFileError,
  spotProcurementReferencePhotoFileError
} from "./file-upload-policy.config";

describe("file upload policy config", () => {
  it("keeps core archive upload accept text, accept attribute, and size limit together", () => {
    expect(CORE_ARCHIVE_UPLOAD_POLICY).toEqual({
      acceptAttribute: ".pdf,.png,.jpg,.jpeg",
      acceptText: "归档文件、常见图片",
      limitBytes: PRIVATE_FILE_UPLOAD_MAX_BYTES,
      limitText: "不超过 100 MB"
    });
  });

  it("keeps PDF archive upload restricted to PDF with the shared private-file limit", () => {
    expect(PDF_ARCHIVE_UPLOAD_POLICY).toEqual({
      acceptAttribute: "application/pdf",
      acceptText: "归档文件",
      limitBytes: PRIVATE_FILE_UPLOAD_MAX_BYTES,
      limitText: "不超过 100 MB"
    });
  });

  it("allows office documents, PDF, and common images only for spot procurement quotations", () => {
    expect(SPOT_PROCUREMENT_QUOTATION_UPLOAD_POLICY).toEqual({
      acceptAttribute: ".doc,.docx,.xls,.xlsx,.pdf,.png,.jpg,.jpeg",
      acceptText: "报价单（Word、Excel、PDF 或常见图片）",
      limitBytes: PRIVATE_FILE_UPLOAD_MAX_BYTES,
      limitText: "不超过 100 MB"
    });
    expect(CORE_ARCHIVE_UPLOAD_POLICY.acceptAttribute).toBe(".pdf,.png,.jpg,.jpeg");
  });

  it("keeps quotation validation aligned with the private file service", () => {
    expect(
      spotProcurementQuotationFileError({
        name: "报价单.docx",
        size: 1024
      })
    ).toBeNull();
    expect(
      spotProcurementQuotationFileError({
        name: "旧版报价单.doc",
        size: 1024
      })
    ).toBeNull();
    expect(
      spotProcurementQuotationFileError({
        name: "旧版清单.xls",
        size: 1024
      })
    ).toBeNull();
    expect(
      spotProcurementQuotationFileError({
        name: "报价单.xlsx",
        size: PRIVATE_FILE_UPLOAD_MAX_BYTES + 1
      })
    ).toContain("不超过 100 MB");
  });

  it("keeps optional reference photos in their own image-only category", () => {
    expect(SPOT_PROCUREMENT_REFERENCE_PHOTO_UPLOAD_POLICY).toEqual({
      acceptAttribute: ".png,.jpg,.jpeg",
      acceptText: "现场参考照片（PNG、JPG 或 JPEG）",
      limitBytes: PRIVATE_FILE_UPLOAD_MAX_BYTES,
      limitText: "不超过 100 MB"
    });
    expect(
      spotProcurementReferencePhotoFileError({
        name: "材料现场.jpg",
        size: 1024
      })
    ).toBeNull();
    expect(
      spotProcurementReferencePhotoFileError({
        name: "报价单.pdf",
        size: 1024
      })
    ).toContain("文件格式不支持");
  });
});
