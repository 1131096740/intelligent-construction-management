import PizZip from "pizzip";

const LEGACY_SEED_FONTS = new Set(["Times New Roman", "仿宋_GB2312", "方正小标宋简体", "黑体", "宋体", "仿宋"]);
export const SEED_LAYOUT_FONT = "Noto Sans CJK SC";

/** Only for the four bundled initialization sources. Never updates stored V1 files. */
export function prepareSeedLayoutDocxSource(source: Buffer): Buffer {
  const zip = new PizZip(source);
  for (const name of Object.keys(zip.files)) {
    if (!/^word\/.*\.xml$/.test(name)) continue;
    let xml = zip.file(name)?.asText();
    if (!xml) continue;
    // The legacy labor source uses Wingdings 2 'R' for its selected invoice checkbox.
    xml = xml.replace(/<w:r>[\s\S]*?<\/w:r>/g, (run) => {
      if (!run.includes('"Wingdings 2"') || !/<w:t>R<\/w:t>/.test(run)) return run;
      return run.replaceAll('"Wingdings 2"', `"${SEED_LAYOUT_FONT}"`).replace("<w:t>R</w:t>", "<w:t>☑</w:t>");
    });
    xml = xml.replace(/<w:rFonts\b[^>]*>/g, (fonts) => fonts.replace(
      /w:(ascii|hAnsi|eastAsia|cs)="([^"]+)"/g, (attribute, key: string, font: string) =>
        LEGACY_SEED_FONTS.has(font) ? `w:${key}="${SEED_LAYOUT_FONT}"` : attribute));
    if (name === "word/document.xml") xml = trimEmptyEndingParagraphs(xml);
    zip.file(name, xml);
  }
  return zip.generate({ type: "nodebuffer" });
}

function trimEmptyEndingParagraphs(xml: string) {
  const section = xml.lastIndexOf("<w:sectPr");
  if (section < 0) return xml;
  let body = xml.slice(0, section);
  let removed = false;
  for (;;) {
    const paragraph = /<w:p(?:\s[^>]*)?>((?:(?!<w:p(?:\s|>))[\s\S])*)<\/w:p>\s*$/.exec(body);
    if (!paragraph || /<w:(?:t|drawing|pict|object|br|tab|fldChar|fldSimple|sectPr)\b/.test(paragraph[0])) break;
    body = body.slice(0, paragraph.index);
    removed = true;
  }
  // A minimal final paragraph keeps table-ending documents valid without adding a blank page.
  if (removed) body += '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>';
  return body + xml.slice(section);
}
