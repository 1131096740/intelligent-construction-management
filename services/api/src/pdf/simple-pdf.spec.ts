import { renderSimplePdf } from "./simple-pdf";

describe("renderSimplePdf", () => {
  function pdfHexText(value: string) {
    const buffer = Buffer.from(value, "utf16le");
    for (let index = 0; index < buffer.length; index += 2) {
      const low = buffer[index];
      buffer[index] = buffer[index + 1];
      buffer[index + 1] = low;
    }
    return buffer.toString("hex").toUpperCase();
  }

  it("renders a valid PDF with Chinese business text", () => {
    const pdf = renderSimplePdf(["付款归档"]);
    const text = pdf.toString("ascii");

    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain(pdfHexText("建工智管内部文件"));
    expect(text).toContain(pdfHexText("付款归档"));
    expect(text).not.toContain("JIANGKONG CONFIDENTIAL");
    expect(text).toContain("%%EOF");
  });
});
