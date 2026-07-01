const { readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const PizZip = require("pizzip");

const templatesRoot = path.resolve(__dirname, "../assets/templates");
const templates = [
  "material-purchase-real-v1.docx",
  "equipment-rental-real-v1.docx",
  "labor-subcontract-real-v1.docx",
  "generic-contract-v1.docx"
];

const standardStyles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="0" w:after="0" w:line="500" w:lineRule="exact"/>
      <w:ind w:firstLineChars="200"/>
      <w:jc w:val="both"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="仿宋_GB2312" w:cs="Times New Roman"/>
      <w:sz w:val="28"/>
      <w:szCs w:val="28"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ContractTitle">
    <w:name w:val="Contract Title"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="0" w:after="0" w:line="500" w:lineRule="exact"/>
      <w:jc w:val="center"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="方正小标宋简体" w:cs="Times New Roman"/>
      <w:sz w:val="44"/>
      <w:szCs w:val="44"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ContractMeta">
    <w:name w:val="Contract Meta"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="0" w:after="0" w:line="500" w:lineRule="exact"/>
      <w:ind w:firstLineChars="0"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="仿宋_GB2312" w:cs="Times New Roman"/>
      <w:sz w:val="28"/>
      <w:szCs w:val="28"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ContractCoverTitle">
    <w:name w:val="Contract Cover Title"/>
    <w:basedOn w:val="ContractTitle"/>
    <w:pPr>
      <w:spacing w:before="0" w:after="0" w:line="500" w:lineRule="exact"/>
      <w:jc w:val="center"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="方正小标宋简体" w:cs="Times New Roman"/>
      <w:sz w:val="44"/>
      <w:szCs w:val="44"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="ContractTableText">
    <w:name w:val="Contract Table Text"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr>
      <w:spacing w:before="0" w:after="0" w:line="300" w:lineRule="auto"/>
      <w:ind w:firstLineChars="0"/>
      <w:jc w:val="center"/>
    </w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="仿宋_GB2312" w:cs="Times New Roman"/>
      <w:sz w:val="18"/>
      <w:szCs w:val="18"/>
    </w:rPr>
  </w:style>
</w:styles>`;

const standardFontTable = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:font w:name="Times New Roman"><w:family w:val="roman"/><w:pitch w:val="variable"/></w:font>
  <w:font w:name="仿宋_GB2312"><w:family w:val="modern"/><w:pitch w:val="variable"/></w:font>
  <w:font w:name="方正小标宋简体"><w:family w:val="auto"/><w:pitch w:val="variable"/></w:font>
  <w:font w:name="黑体"><w:family w:val="auto"/><w:pitch w:val="variable"/></w:font>
  <w:font w:name="楷体_GB2312"><w:family w:val="auto"/><w:pitch w:val="variable"/></w:font>
  <w:font w:name="Wingdings"><w:family w:val="auto"/><w:pitch w:val="variable"/></w:font>
</w:fonts>`;

function normalizeXml(xml) {
  return xml
    .replace(/(w:(?:ascii|hAnsi|cs))="(?:Calibri|宋体|仿宋|仿宋_GB2312|方正仿宋简体|方正宋三简体;宋体|楷体|楷体_GB2312|方正小标宋简体)"/g, '$1="Times New Roman"')
    .replace(/(w:eastAsia)="(?:Calibri|宋体|仿宋|方正仿宋简体|方正宋三简体;宋体|zh-CN|zh-Hans)"/g, '$1="仿宋_GB2312"')
    .replace(/typeface="(?:Calibri Light|Calibri)"/g, 'typeface="Times New Roman"')
    .replace(/typeface="(?:宋体|仿宋|方正仿宋简体|方正宋三简体)"/g, 'typeface="仿宋_GB2312"')
    .replace(/<w:sz w:val="(?:22|24|32)"\/>/g, '<w:sz w:val="28"/>')
    .replace(/<w:szCs w:val="(?:22|24|32)"\/>/g, '<w:szCs w:val="28"/>')
    .replace(/<w:sz w:val="(?:72|84)"\/>/g, '<w:sz w:val="44"/>')
    .replace(/<w:szCs w:val="(?:72|84)"\/>/g, '<w:szCs w:val="44"/>')
    .replace(/<w:color w:val="FF0000"\/>/g, '<w:color w:val="auto"/>')
    .replace(/<w:pgSz w:orient="landscape" w:w="11906" w:h="16838"\/>/g, '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>')
    .replace(/<w:spacing\b[^>]*\/>/g, '<w:spacing w:before="0" w:after="0" w:line="500" w:lineRule="exact"/>')
    .replace(/<w:pgMar\b[^>]*\/>/g, '<w:pgMar w:top="1417" w:right="1701" w:bottom="1417" w:left="1701" w:header="720" w:footer="720" w:gutter="0"/>');
}

const tablePr = '<w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:start w:w="80" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:end w:w="80" w:type="dxa"/></w:tblCellMar><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/></w:tblBorders></w:tblPr>';
const portraitTextWidthDxa = 8504;

function tableHeaderText(tableXml) {
  const firstRow = tableXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/)?.[0] ?? "";
  return [...firstRow.matchAll(/<w:t(?: [^>]*)?>(.*?)<\/w:t>/g)].map((match) => match[1]).join("");
}

function firstRowCellCount(tableXml) {
  const firstRow = tableXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/)?.[0] ?? "";
  return (firstRow.match(/<w:tc\b/g) ?? []).length;
}

function columnWidthsForTable(tableXml) {
  const header = tableHeaderText(tableXml);
  const firstRowCells = firstRowCellCount(tableXml);
  if (header.includes("机械设备名称或费用名称")) return [800, 550, 400, 400, 750, 300, 700, 1100];
  if (header.includes("货物名称") && header.includes("规格型号")) return [300, 750, 650, 400, 450, 850, 300, 1300];
  if (header.includes("项目名称") && header.includes("含税单价")) return [400, 1200, 450, 600, 750, 750, 850];
  if (header.includes("规格/说明")) return [750, 1050, 400, 500, 750, 750, 800];
  if (firstRowCells === 2) return [2500, 2500];
  return undefined;
}

function toDxaWidth(width) {
  return Math.round((width / 5000) * portraitTextWidthDxa);
}

function tableGrid(widths) {
  if (!widths) return "";
  return `<w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${toDxaWidth(width)}"/>`).join("")}</w:tblGrid>`;
}

function withCellWidth(cellProperties, width) {
  const cellWidth = `<w:tcW w:w="${toDxaWidth(width)}" w:type="dxa"/>`;
  if (!cellProperties) return `<w:tcPr>${cellWidth}</w:tcPr>`;
  if (cellProperties.includes("<w:tcW")) {
    return cellProperties.replace(/<w:tcW\b[^>]*\/>/, cellWidth);
  }
  return cellProperties.replace("<w:tcPr>", `<w:tcPr>${cellWidth}`);
}

function normalizeTableCellWidths(tableXml, widths) {
  if (!widths) return tableXml;
  return tableXml.replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (row) => {
    let index = 0;
    return row.replace(/(<w:tc\b[^>]*>)(<w:tcPr>[\s\S]*?<\/w:tcPr>)?/g, (match, openTag, cellProperties) => {
      const width = widths[Math.min(index, widths.length - 1)];
      index += 1;
      return `${openTag}${withCellWidth(cellProperties, width)}`;
    });
  });
}

function normalizeTableParagraphs(tableXml) {
  const widths = columnWidthsForTable(tableXml);
  return normalizeTableCellWidths(tableXml, widths)
    .replace(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/g, "")
    .replace(/<w:tblPr>[\s\S]*?<\/w:tblPr>/, `${tablePr}${tableGrid(widths)}`)
    .replace(/<w:trPr>[\s\S]*?<\/w:trPr>/g, "<w:trPr><w:cantSplit/></w:trPr>")
    .replace(/<w:tr>(?!<w:trPr>)/g, "<w:tr><w:trPr><w:cantSplit/></w:trPr>")
    .replace(/<w:pPr>[\s\S]*?<\/w:pPr>/g, "")
    .replace(/<w:p>/g, '<w:p><w:pPr><w:pStyle w:val="ContractTableText"/></w:pPr>')
    .replace(/<w:sz w:val="\d+"\/>/g, '<w:sz w:val="18"/>')
    .replace(/<w:szCs w:val="\d+"\/>/g, '<w:szCs w:val="18"/>');
}

function normalizeTables(xml) {
  let output = "";
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf("<w:tbl", cursor);
    if (start < 0) {
      output += xml.slice(cursor);
      break;
    }
    output += xml.slice(cursor, start);
    const tagPattern = /<w:tbl\b|<\/w:tbl>/g;
    tagPattern.lastIndex = start;
    let depth = 0;
    let end = -1;
    for (let match = tagPattern.exec(xml); match; match = tagPattern.exec(xml)) {
      depth += match[0].startsWith("</") ? -1 : 1;
      if (depth === 0) {
        end = tagPattern.lastIndex;
        break;
      }
    }
    if (end < 0) {
      output += xml.slice(start);
      break;
    }
    output += normalizeTableParagraphs(xml.slice(start, end));
    cursor = end;
  }
  return output;
}

function forcePortraitSections(xml) {
  return xml.replace(/<w:pgSz\b[^>]*\/>/g, '<w:pgSz w:w="11906" w:h="16838"/>');
}

function normalizeHeaderFooterReferences(xml) {
  return xml
    .replace(/<w:headerReference\b[^>]*\/>/g, (tag) => tag.replace(/\br:id="[^"]+"/, 'r:id="rIdHeader1"'))
    .replace(/<w:footerReference\b[^>]*\/>/g, (tag) => tag.replace(/\br:id="[^"]+"/, 'r:id="rIdFooter1"'));
}

function removeStaticDrawings(xml) {
  return xml.replace(/<w:drawing>[\s\S]*?<\/w:drawing>/g, "");
}

function removeStaticAttachmentParagraphs(xml) {
  return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) =>
    paragraph.includes("附件：") ? "" : paragraph
  );
}

function cleanupUnusedImages(zip) {
  const documentXml = zip.file("word/document.xml")?.asText() ?? "";
  const usedRelationshipIds = new Set(
    [...documentXml.matchAll(/r:(?:embed|link)="([^"]+)"/g)].map((match) => match[1])
  );
  const relsPath = "word/_rels/document.xml.rels";
  const rels = zip.file(relsPath)?.asText();
  if (rels) {
    const nextRels = rels.replace(/<Relationship\b[^>]*Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/image"[^>]*\/>/g, (relationship) => {
      const id = relationship.match(/\bId="([^"]+)"/)?.[1];
      const target = relationship.match(/\bTarget="([^"]+)"/)?.[1];
      if (id && usedRelationshipIds.has(id)) return relationship;
      if (target) zip.remove(`word/${target}`);
      return "";
    });
    zip.file(relsPath, nextRels);
  }

  const hasMedia = Object.keys(zip.files).some((name) => name.startsWith("word/media/") && !zip.files[name].dir);
  if (!hasMedia) {
    const contentTypes = zip.file("[Content_Types].xml")?.asText();
    if (contentTypes) {
      zip.file(
        "[Content_Types].xml",
        contentTypes.replace(/<Default Extension="(?:jpeg|jpg|JPG|png)" ContentType="[^"]+"\/>/g, "")
      );
    }
  }
}

function standardDocumentRelationships(zip) {
  const relationship = (id, type, target) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const entries = [
    relationship("rIdStyles", "styles", "styles.xml"),
    relationship("rIdSettings", "settings", "settings.xml"),
    relationship("rIdFontTable", "fontTable", "fontTable.xml"),
    zip.file("word/theme/theme1.xml") ? relationship("rIdTheme", "theme", "theme/theme1.xml") : "",
    zip.file("word/header1.xml") ? relationship("rIdHeader1", "header", "header1.xml") : "",
    zip.file("word/footer1.xml") ? relationship("rIdFooter1", "footer", "footer1.xml") : "",
    zip.file("word/header-contract-watermark.xml")
      ? relationship("rIdContractWatermarkHeader", "header", "header-contract-watermark.xml")
      : "",
    zip.file("word/footer-contract-template.xml")
      ? relationship("rIdContractTemplateFooter", "footer", "footer-contract-template.xml")
      : ""
  ].filter(Boolean);
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.join("")}</Relationships>`
  );
}

function ensureContentTypeOverride(contentTypes, partName, contentType) {
  if (contentTypes.includes(`PartName="${partName}"`)) return contentTypes;
  return contentTypes.replace(
    "</Types>",
    `<Override PartName="${partName}" ContentType="${contentType}"/></Types>`
  );
}

function standardContentTypes(zip) {
  const contentTypes = zip.file("[Content_Types].xml")?.asText();
  if (!contentTypes) return;
  const headerType = "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml";
  const footerType = "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml";
  let nextContentTypes = contentTypes;
  for (const name of Object.keys(zip.files)) {
    if (/^word\/header.*\.xml$/.test(name)) {
      nextContentTypes = ensureContentTypeOverride(nextContentTypes, `/${name}`, headerType);
    }
    if (/^word\/footer.*\.xml$/.test(name)) {
      nextContentTypes = ensureContentTypeOverride(nextContentTypes, `/${name}`, footerType);
    }
  }
  zip.file("[Content_Types].xml", nextContentTypes);
}

function textOfParagraph(paragraph) {
  return [...paragraph.matchAll(/<w:t(?: [^>]*)?>(.*?)<\/w:t>/g)].map((match) => match[1]).join("");
}

function replaceLeadingParagraphs(xml, shouldStop, replacement) {
  const paragraphs = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)];
  const stopIndex = paragraphs.findIndex((match, index) => shouldStop(match[0], textOfParagraph(match[0]), index));
  if (stopIndex < 0) return xml;
  const start = paragraphs[0].index;
  const end = paragraphs[stopIndex].index + paragraphs[stopIndex][0].length;
  return `${xml.slice(0, start)}${replacement}${xml.slice(end)}`;
}

function hasLeadingSectionParagraph(xml) {
  return [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
    .slice(0, 30)
    .some((match) => match[0].includes("<w:sectPr>"));
}

function coverXml({ title, owner, counterparty, project }) {
  const titleRunPr = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="方正小标宋简体" w:cs="Times New Roman"/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr>';
  const metaRunPr = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="仿宋_GB2312" w:cs="Times New Roman"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>';
  const blank = '<w:p><w:pPr><w:pStyle w:val="ContractMeta"/></w:pPr><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>';
  const line = (text) => `<w:p><w:pPr><w:pStyle w:val="ContractMeta"/></w:pPr><w:r>${metaRunPr}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  return `${blank}${blank}${blank}${blank}${blank}
<w:p><w:pPr><w:pStyle w:val="ContractCoverTitle"/><w:jc w:val="center"/></w:pPr><w:r>${titleRunPr}<w:t xml:space="preserve">${title}</w:t></w:r></w:p>
${blank}${blank}${blank}${blank}${blank}${blank}
${line("合同编号：{contract.temporaryCode}")}
${line(`甲方：${owner}`)}
${line(`乙方：${counterparty}`)}
${line(`工程名称：${project}`)}
${line("签订地点：")}
${line("签订日期：")}
${blank}${blank}${blank}${blank}${blank}${blank}${blank}
<w:p><w:pPr><w:sectPr><w:type w:val="nextPage"/><w:headerReference w:type="default" r:id="rIdHeader1"/><w:footerReference w:type="default" r:id="rIdFooter1"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1701" w:bottom="1417" w:left="1701" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:pPr></w:p>`;
}

function normalizeCover(xml, fileName) {
  const covers = {
    "material-purchase-real-v1.docx": coverXml({
      title: "{contract.name}",
      owner: "{party.owner.name}",
      counterparty: "{party.counterparty.name}",
      project: "{field.projectName}"
    }),
    "equipment-rental-real-v1.docx": coverXml({
      title: "{contract.name}",
      owner: "{party.owner.name}",
      counterparty: "{party.counterparty.name}",
      project: "{field.useLocation}"
    }),
    "labor-subcontract-real-v1.docx": `${coverXml({
      title: "{contract.name}",
      owner: "{party.owner.name}",
      counterparty: "{party.counterparty.name}",
      project: "{field.projectName}"
    })}<w:p><w:pPr><w:pStyle w:val="ContractTitle"/><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">{contract.name}</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t xml:space="preserve">发包人：{party.owner.name}（以下简称“甲方”）</w:t></w:r></w:p>`,
    "generic-contract-v1.docx": coverXml({
      title: "{contract.name}",
      owner: "建工智管建设有限公司",
      counterparty: "{field.counterpartyName}",
      project: "{field.projectName}"
    })
  };

  if (fileName === "material-purchase-real-v1.docx" || fileName === "generic-contract-v1.docx") {
    return replaceLeadingParagraphs(xml, (paragraph) => paragraph.includes("<w:sectPr>"), covers[fileName]);
  }
  if (fileName === "equipment-rental-real-v1.docx") {
    let seenSection = false;
    const hasCoverSection = hasLeadingSectionParagraph(xml);
    return replaceLeadingParagraphs(xml, (paragraph, text) => {
      seenSection ||= paragraph.includes("<w:sectPr>");
      return hasCoverSection ? seenSection && text.trim() === "{contract.name}" : text.trim() === "{contract.name}";
    }, `${covers[fileName]}<w:p><w:pPr><w:pStyle w:val="ContractTitle"/><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">{contract.name}</w:t></w:r></w:p>`);
  }
  if (fileName === "labor-subcontract-real-v1.docx") {
    let seenSection = false;
    const hasCoverSection = hasLeadingSectionParagraph(xml);
    return replaceLeadingParagraphs(xml, (paragraph, text) => {
      seenSection ||= paragraph.includes("<w:sectPr>");
      return hasCoverSection ? seenSection && text.trim().startsWith("发包人：") : text.trim().startsWith("发包人：");
    }, covers[fileName]);
  }
  return xml;
}

function genericDocumentXml() {
  const titleRunPr = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="方正小标宋简体" w:cs="Times New Roman"/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr>';
  const metaRunPr = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="仿宋_GB2312" w:cs="Times New Roman"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>';
  const blank = '<w:p><w:pPr><w:pStyle w:val="ContractMeta"/></w:pPr><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<w:body>
<w:p><w:pPr><w:pStyle w:val="ContractMeta"/><w:jc w:val="right"/></w:pPr><w:r>${metaRunPr}<w:t xml:space="preserve">合同编号：{contract.temporaryCode}</w:t></w:r></w:p>
${blank}${blank}${blank}${blank}${blank}${blank}
<w:p><w:pPr><w:pStyle w:val="ContractTitle"/><w:jc w:val="center"/></w:pPr><w:r>${titleRunPr}<w:t xml:space="preserve">{contract.name}</w:t></w:r></w:p>
${blank}${blank}${blank}${blank}
<w:p><w:pPr><w:pStyle w:val="ContractMeta"/></w:pPr><w:r>${metaRunPr}<w:t xml:space="preserve">项目名称：{field.projectName}</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="ContractMeta"/></w:pPr><w:r>${metaRunPr}<w:t xml:space="preserve">甲方：建工智管建设有限公司</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="ContractMeta"/></w:pPr><w:r>${metaRunPr}<w:t xml:space="preserve">乙方：{field.counterpartyName}</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="ContractMeta"/></w:pPr><w:r>${metaRunPr}<w:t xml:space="preserve">合同金额：{contract.amountUppercase}</w:t></w:r></w:p>
${blank}${blank}${blank}${blank}${blank}${blank}${blank}${blank}
<w:p><w:pPr><w:sectPr><w:type w:val="nextPage"/><w:headerReference w:type="default" r:id="rIdHeader1"/><w:footerReference w:type="default" r:id="rIdFooter1"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1701" w:bottom="1417" w:left="1701" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:pPr></w:p>
<w:p><w:pPr><w:pStyle w:val="ContractTitle"/><w:jc w:val="center"/></w:pPr><w:r>${titleRunPr}<w:t xml:space="preserve">通用合同</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t xml:space="preserve">第一条 业务内容</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t xml:space="preserve">{field.businessSummary}</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t xml:space="preserve">第二条 价款及结算</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t xml:space="preserve">合同金额为{contract.amountUppercase}，结算周期为{field.settlementCycle}，付款比例为{field.paymentRatioPercent}%。</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t xml:space="preserve">第三条 付款条款</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t xml:space="preserve">{clause.payment.text}</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t xml:space="preserve">第四条 特别约定</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t xml:space="preserve">{clause.specialAgreement.text}</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t xml:space="preserve">第五条 合同清单</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">{#bill.genericItems}</w:t></w:r></w:p>
<w:tbl>${tablePr}
<w:tr><w:tc><w:p><w:r><w:t>名称</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>规格/说明</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>单位</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>数量</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>单价</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>金额</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>备注</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>{itemName}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{specification}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{unit}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{quantity}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{unitPrice}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{taxInclusiveAmount}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{remark}</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
<w:p><w:r><w:t xml:space="preserve">{/bill.genericItems}</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="ContractTitle"/></w:pPr><w:r><w:t xml:space="preserve">签章页</w:t></w:r></w:p>
<w:tbl>${tablePr}
<w:tr><w:tc><w:p><w:r><w:t>甲方（盖章）：建工智管建设有限公司</w:t></w:r></w:p><w:p><w:r><w:t>法定代表人或授权代表：</w:t></w:r></w:p><w:p><w:r><w:t>联系电话：</w:t></w:r></w:p><w:p><w:r><w:t>地址：</w:t></w:r></w:p><w:p><w:r><w:t>签署日期：</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>乙方（盖章）：{field.counterpartyName}</w:t></w:r></w:p><w:p><w:r><w:t>法定代表人或授权代表：</w:t></w:r></w:p><w:p><w:r><w:t>联系电话：</w:t></w:r></w:p><w:p><w:r><w:t>地址：</w:t></w:r></w:p><w:p><w:r><w:t>签署日期：</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader1"/><w:footerReference w:type="default" r:id="rIdFooter1"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1701" w:bottom="1417" w:left="1701" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
}

function standardHeader() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pStyle w:val="ContractMeta"/><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">{document.watermark}</w:t></w:r></w:p></w:hdr>`;
}

function standardFooter() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pStyle w:val="ContractMeta"/><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">第    页 / 共    页</w:t></w:r></w:p></w:ftr>`;
}

for (const fileName of templates) {
  const filePath = path.join(templatesRoot, fileName);
  const zip = new PizZip(readFileSync(filePath));
  zip.file("word/styles.xml", standardStyles);
  zip.file("word/fontTable.xml", standardFontTable);
  zip.file("word/header1.xml", standardHeader());
  zip.file("word/footer1.xml", standardFooter());
  zip.file("word/header-contract-watermark.xml", standardHeader());
  zip.file("word/footer-contract-page.xml", standardFooter());

  for (const name of Object.keys(zip.files)) {
    if (!name.startsWith("word/") || !name.endsWith(".xml")) continue;
    if (name === "word/styles.xml") continue;
    if (name === "word/fontTable.xml") continue;
    const entry = zip.file(name);
    if (!entry) continue;
    if (/^word\/header.*\.xml$/.test(name)) {
      zip.file(name, standardHeader());
      continue;
    }
    if (/^word\/footer.*\.xml$/.test(name)) {
      zip.file(name, standardFooter());
      continue;
    }
    let normalized = normalizeXml(entry.asText());
    if (name === "word/document.xml") {
      normalized = normalizeCover(normalized, fileName);
      if (fileName === "labor-subcontract-real-v1.docx") {
        normalized = forcePortraitSections(normalized);
      }
      normalized = normalizeHeaderFooterReferences(normalized);
      normalized = normalizeTables(normalized);
      normalized = removeStaticDrawings(normalized);
      if (fileName === "equipment-rental-real-v1.docx") {
        normalized = removeStaticAttachmentParagraphs(normalized);
      }
    }
    zip.file(name, normalized);
  }

  if (fileName === "generic-contract-v1.docx") {
    zip.file("word/document.xml", normalizeTables(normalizeCover(genericDocumentXml(), fileName)));
    zip.file("word/header1.xml", standardHeader());
    zip.file("word/footer1.xml", standardFooter());
  }

  cleanupUnusedImages(zip);
  standardContentTypes(zip);
  standardDocumentRelationships(zip);
  writeFileSync(filePath, zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
}
