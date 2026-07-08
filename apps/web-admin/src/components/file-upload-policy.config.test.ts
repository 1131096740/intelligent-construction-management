import { describe, expect, it } from "vitest";
import {
  CORE_ARCHIVE_UPLOAD_POLICY,
  PDF_ARCHIVE_UPLOAD_POLICY,
  PRIVATE_FILE_UPLOAD_MAX_BYTES
} from "./file-upload-policy.config";

describe("file upload policy config", () => {
  it("keeps core archive upload accept text, accept attribute, and size limit together", () => {
    expect(CORE_ARCHIVE_UPLOAD_POLICY).toEqual({
      acceptAttribute: ".pdf,.png,.jpg,.jpeg",
      acceptText: "PDF、PNG、JPG、JPEG",
      limitBytes: PRIVATE_FILE_UPLOAD_MAX_BYTES,
      limitText: "不超过 100 MB"
    });
  });

  it("keeps PDF archive upload restricted to PDF with the shared private-file limit", () => {
    expect(PDF_ARCHIVE_UPLOAD_POLICY).toEqual({
      acceptAttribute: "application/pdf",
      acceptText: "PDF",
      limitBytes: PRIVATE_FILE_UPLOAD_MAX_BYTES,
      limitText: "不超过 100 MB"
    });
  });
});
