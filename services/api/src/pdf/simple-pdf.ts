function pdfHexText(value: string) {
  const buffer = Buffer.from(value, "utf16le");
  for (let index = 0; index < buffer.length; index += 2) {
    const low = buffer[index];
    buffer[index] = buffer[index + 1];
    buffer[index + 1] = low;
  }
  return buffer.toString("hex").toUpperCase();
}

export function renderSimplePdf(lines: string[]) {
  const watermark = "建工智管内部文件";
  const content = [
    "q",
    "0.88 g",
    "BT",
    "/F1 42 Tf",
    `0.707 0.707 -0.707 0.707 120 300 Tm <${pdfHexText(watermark)}> Tj`,
    "ET",
    "Q",
    "BT",
    "0 g",
    "/F1 11 Tf",
    ...lines.map((line, index) => `1 0 0 1 72 ${740 - index * 18} Tm <${pdfHexText(line)}> Tj`),
    "ET"
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [5 0 R] >>",
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> >>",
    `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`
  ];
  const chunks = ["%PDF-1.4\n"];
  const offsets: number[] = [];

  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(chunks.join(""), "ascii"));
    chunks.push(`${index + 1} 0 obj\n${object}\nendobj\n`);
  }

  const xrefOffset = Buffer.byteLength(chunks.join(""), "ascii");
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets) {
    chunks.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  }
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.from(chunks.join(""), "ascii");
}
