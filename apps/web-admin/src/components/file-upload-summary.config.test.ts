import { describe, expect, it } from "vitest";
import { buildFileUploadSummary, formatFileSize } from "./file-upload-summary.config";

describe("file upload summary helpers", () => {
  it("formats file sizes in B, KB, and MB", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(1024)).toBe("1 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(1024 * 1024)).toBe("1 MB");
    expect(formatFileSize(1024 * 1024 + 512 * 1024)).toBe("1.5 MB");
  });

  it("describes an empty selection with supported types and size limits", () => {
    expect(buildFileUploadSummary(null, false, "PDF、JPG", "不超过 10 MB")).toBe(
      "未选择文件。支持类型：PDF、JPG；大小限制：不超过 10 MB"
    );
    expect(buildFileUploadSummary(null, true, "PDF、JPG", "不超过 10 MB")).toBe(
      "上传中。支持类型：PDF、JPG；大小限制：不超过 10 MB"
    );
  });

  it("keeps the selected file name and size visible while idle or busy", () => {
    const file = new File([new Uint8Array(1536)], "contract-archive.pdf", {
      type: "application/pdf"
    });

    expect(buildFileUploadSummary(file, false, "PDF", "不超过 10 MB")).toBe(
      "已选择：contract-archive.pdf（1.5 KB）。支持类型：PDF；大小限制：不超过 10 MB"
    );
    expect(buildFileUploadSummary(file, true, "PDF", "不超过 10 MB")).toBe(
      "上传中：contract-archive.pdf（1.5 KB）。支持类型：PDF；大小限制：不超过 10 MB"
    );
  });
});
