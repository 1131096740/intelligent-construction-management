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
      <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="仿宋" w:cs="Times New Roman"/>
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
      <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="黑体" w:cs="Times New Roman"/>
      <w:b/>
      <w:bCs/>
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
      <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="仿宋" w:cs="Times New Roman"/>
      <w:sz w:val="28"/>
      <w:szCs w:val="28"/>
    </w:rPr>
  </w:style>
</w:styles>`;

const standardFontTable = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:font w:name="Times New Roman"><w:family w:val="roman"/><w:pitch w:val="variable"/></w:font>
  <w:font w:name="仿宋"><w:family w:val="modern"/><w:pitch w:val="variable"/></w:font>
  <w:font w:name="黑体"><w:family w:val="auto"/><w:pitch w:val="variable"/></w:font>
  <w:font w:name="Wingdings"><w:family w:val="auto"/><w:pitch w:val="variable"/></w:font>
</w:fonts>`;

function normalizeXml(xml) {
  return xml
    .replace(/(w:(?:ascii|hAnsi|cs))="(?:Calibri|宋体|仿宋|仿宋_GB2312|方正仿宋简体|方正宋三简体;宋体|楷体)"/g, '$1="Times New Roman"')
    .replace(/(w:eastAsia)="(?:Calibri|宋体|仿宋_GB2312|方正仿宋简体|方正宋三简体;宋体|楷体|zh-CN|zh-Hans)"/g, '$1="仿宋"')
    .replace(/(w:(?:ascii|hAnsi|eastAsia|cs))="方正小标宋简体"/g, '$1="黑体"')
    .replace(/typeface="(?:Calibri Light|Calibri)"/g, 'typeface="Times New Roman"')
    .replace(/typeface="(?:宋体|仿宋_GB2312|方正仿宋简体|方正宋三简体|方正小标宋简体|楷体)"/g, 'typeface="仿宋"')
    .replace(/<w:sz w:val="(?:22|24|32)"\/>/g, '<w:sz w:val="28"/>')
    .replace(/<w:szCs w:val="(?:22|24|32)"\/>/g, '<w:szCs w:val="28"/>')
    .replace(/<w:sz w:val="(?:72|84)"\/>/g, '<w:sz w:val="44"/>')
    .replace(/<w:szCs w:val="(?:72|84)"\/>/g, '<w:szCs w:val="44"/>')
    .replace(/<w:color w:val="FF0000"\/>/g, '<w:color w:val="auto"/>')
    .replace(/<w:pgSz w:orient="landscape" w:w="11906" w:h="16838"\/>/g, '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>')
    .replace(/<w:spacing\b[^>]*\/>/g, '<w:spacing w:before="0" w:after="0" w:line="500" w:lineRule="exact"/>')
    .replace(/<w:pgMar\b[^>]*\/>/g, '<w:pgMar w:top="1417" w:right="1701" w:bottom="1417" w:left="1701" w:header="720" w:footer="720" w:gutter="0"/>');
}

function removeStaticDrawings(xml) {
  return xml.replace(/<w:drawing>[\s\S]*?<\/w:drawing>/g, "");
}

function removeStaticAttachmentParagraphs(xml) {
  return xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraph) =>
    paragraph.includes("附件：") ? "" : paragraph
  );
}

function genericDocumentXml() {
  const titleRunPr = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="黑体" w:cs="Times New Roman"/><w:b/><w:bCs/><w:sz w:val="44"/><w:szCs w:val="44"/></w:rPr>';
  const metaRunPr = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="仿宋" w:cs="Times New Roman"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>';
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
<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/></w:tblBorders></w:tblPr>
<w:tr><w:tc><w:p><w:r><w:t>名称</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>规格/说明</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>单位</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>数量</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>单价</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>金额</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>备注</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>{itemName}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{specification}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{unit}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{quantity}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{unitPrice}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{taxInclusiveAmount}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>{remark}</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
<w:p><w:r><w:t xml:space="preserve">{/bill.genericItems}</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="ContractTitle"/></w:pPr><w:r><w:t xml:space="preserve">签章页</w:t></w:r></w:p>
<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/></w:tblBorders></w:tblPr>
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
      normalized = removeStaticDrawings(normalized);
      if (fileName === "equipment-rental-real-v1.docx") {
        normalized = removeStaticAttachmentParagraphs(normalized);
      }
    }
    zip.file(name, normalized);
  }

  if (fileName === "generic-contract-v1.docx") {
    zip.file("word/document.xml", genericDocumentXml());
    zip.file("word/header1.xml", standardHeader());
    zip.file("word/footer1.xml", standardFooter());
  }

  writeFileSync(filePath, zip.generate({ type: "nodebuffer", compression: "DEFLATE" }));
}
