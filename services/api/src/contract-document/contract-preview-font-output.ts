import { inflateSync } from "node:zlib";
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";

const FONT_OUTPUT_ERROR = "合同 PDF 字体输出异常，请联系管理员核对转换服务字体后重试";

/** Reject the observed LO missing-font output: an embedded TrueType program
 * containing only .notdef. This is an output sanity check, not a complete
 * glyph/outline or font-substitution certification. */
export async function assertContractPreviewFontOutput(pdf: Buffer): Promise<void> {
  try {
    const document = await PDFDocument.load(pdf);
    for (const [, object] of document.context.enumerateIndirectObjects()) {
      if (!(object instanceof PDFDict) || object.get(PDFName.of("Type")) !== PDFName.of("FontDescriptor")) continue;
      const program = object.lookup(PDFName.of("FontFile2"));
      if (!program) continue;
      if (!(program instanceof PDFRawStream)) throw new Error(FONT_OUTPUT_ERROR);
      const filter = program.dict.lookup(PDFName.of("Filter"));
      if (filter !== undefined && filter !== PDFName.of("FlateDecode")) throw new Error(FONT_OUTPUT_ERROR);
      if (program.dict.has(PDFName.of("DecodeParms"))) throw new Error(FONT_OUTPUT_ERROR);
      const maximumFontBytes = 64 * 1024 * 1024;
      if (program.contents.length > maximumFontBytes) throw new Error(FONT_OUTPUT_ERROR);
      const bytes = filter === undefined ? Buffer.from(program.contents)
        : inflateSync(program.contents, { maxOutputLength: maximumFontBytes });
      if (bytes.length < 12 || bytes.readUInt32BE(0) !== 0x00010000) throw new Error(FONT_OUTPUT_ERROR);
      const tables = bytes.readUInt16BE(4);
      if (12 + tables * 16 > bytes.length) throw new Error(FONT_OUTPUT_ERROR);
      let glyphCount: number | undefined;
      for (let index = 0; index < tables; index++) {
        const entry = 12 + index * 16;
        if (bytes.toString("ascii", entry, entry + 4) !== "maxp") continue;
        const offset = bytes.readUInt32BE(entry + 8), length = bytes.readUInt32BE(entry + 12);
        if (glyphCount !== undefined || length < 32 || offset < 12 + tables * 16 || offset + length > bytes.length
          || bytes.readUInt32BE(offset) !== 0x00010000) throw new Error(FONT_OUTPUT_ERROR);
        glyphCount = bytes.readUInt16BE(offset + 4);
      }
      if (glyphCount === undefined || glyphCount <= 1) throw new Error(FONT_OUTPUT_ERROR);
    }
  } catch {
    throw new Error(FONT_OUTPUT_ERROR);
  }
}
