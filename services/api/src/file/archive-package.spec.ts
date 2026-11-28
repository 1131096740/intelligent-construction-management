import PizZip from "pizzip";
import {
  ARCHIVE_PACKAGE_MAX_BYTES,
  ARCHIVE_PACKAGE_MAX_FILES,
  archivePackageFileName,
  assertArchivePackageSelection,
  buildArchivePackageBuffer
} from "./archive-package";

describe("archive package", () => {
  it("rejects an empty selection", () => {
    expect(() => assertArchivePackageSelection([])).toThrow("请选择要打包下载的资料");
  });

  it("rejects more files than the single-package limit", () => {
    const files = Array.from({ length: ARCHIVE_PACKAGE_MAX_FILES + 1 }, (_, index) => ({
      id: `file-${index}`,
      sizeBytes: 1
    }));

    expect(() => assertArchivePackageSelection(files)).toThrow(
      `单次最多打包 ${ARCHIVE_PACKAGE_MAX_FILES} 份资料，请减少选择后重试`
    );
  });

  it("rejects a package whose total bytes exceed the limit", () => {
    expect(() =>
      assertArchivePackageSelection([
        { id: "file-1", sizeBytes: ARCHIVE_PACKAGE_MAX_BYTES },
        { id: "file-2", sizeBytes: 1 }
      ])
    ).toThrow("打包资料总量超过 200MB，请分批下载");
  });

  it("accepts a selection exactly at both limits", () => {
    const files = Array.from({ length: ARCHIVE_PACKAGE_MAX_FILES }, (_, index) => ({
      id: `file-${index}`,
      sizeBytes: 1
    }));

    expect(() => assertArchivePackageSelection(files)).not.toThrow();
  });

  it("builds a readable zip and keeps duplicate file names distinct", () => {
    const buffer = buildArchivePackageBuffer([
      { fileName: "合同.pdf", buffer: Buffer.from("first") },
      { fileName: "合同.pdf", buffer: Buffer.from("second") },
      { fileName: "../越权/付款凭证.pdf", buffer: Buffer.from("third") }
    ]);

    expect(buffer.subarray(0, 2).toString()).toBe("PK");
    const zip = new PizZip(buffer);
    expect(Object.keys(zip.files).sort()).toEqual([
      "_越权_付款凭证.pdf",
      "合同 (2).pdf",
      "合同.pdf"
    ].sort());
    expect(zip.file("合同.pdf")?.asText()).toBe("first");
    expect(zip.file("合同 (2).pdf")?.asText()).toBe("second");
  });

  it("names the package with the Beijing business date", () => {
    expect(archivePackageFileName(new Date("2026-11-23T10:05:00Z"))).toBe(
      "资料库打包-20261123-1805.zip"
    );
  });
});
