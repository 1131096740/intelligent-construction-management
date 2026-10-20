"use strict";
const { PDFDocument, StandardFonts } = require("pdf-lib");

// Supporting synthetic seed attachments only; layout samples use DOCX conversion.
async function seedAttachmentPdf() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([595, 842]).drawText("Seed attachment fixture", {
    x: 50, y: 780, size: 12, font
  });
  return Buffer.from(await document.save());
}
module.exports = { seedAttachmentPdf };
