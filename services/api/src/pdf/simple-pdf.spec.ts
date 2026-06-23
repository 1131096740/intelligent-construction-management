import { renderSimplePdf } from "./simple-pdf";

describe("renderSimplePdf", () => {
  it("renders a valid PDF with the default watermark", () => {
    const pdf = renderSimplePdf(["Payment Archive"]);
    const text = pdf.toString("ascii");

    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("JIANGKONG CONFIDENTIAL");
    expect(text).toContain("(Payment Archive) Tj");
    expect(text).toContain("%%EOF");
  });
});
