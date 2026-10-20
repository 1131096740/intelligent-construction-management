import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { watermarkApprovalPdf } from "./approval-pdf-watermark";

describe("approval PDF download watermark", () => {
  it.each([1, 4])("preserves all %i pages and overlays a receipt on every page", async (count) => {
    const source = await PDFDocument.create();
    const sizes = Array.from({ length: count }, (_, index) =>
      index % 2 ? [595, 842] : [842, 595]
    );
    sizes.forEach(([width, height]) => {
      const page = source.addPage([width, height]);
      page.drawText("Original settlement content", { x: 30, y: 200 });
    });

    const result = await watermarkApprovalPdf(Buffer.from(await source.save()), [
      "验收下载人", "2026-10-20", "本地验收"
    ]);
    const output = await PDFDocument.load(result);
    expect(output.getPageCount()).toBe(count);
    output.getPages().forEach((page, index) => {
      expect([page.getWidth(), page.getHeight()]).toEqual(sizes[index]);
      const objects = page.node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
      expect(objects.keys()).toHaveLength(1);
    });
  });
});
