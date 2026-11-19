/** Reproducible new technical template version. Never edits/adopts the preserved master. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(resolve(root, "services/api/package.json"));
const PizZip = require("pizzip");
const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const WPS = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const originalPath = "scripts/probes/task08-documents/samples/material-purchase-real-v1.docx";
const outputPath = "services/api/assets/templates/material-purchase-unified-v2.docx";
const source = await readFile(resolve(root, originalPath));
if (hash(source) !== "8d707f8ecd65e2ca69c6920991dcb542cbc23ada42cf39a62299ab25e5820334") throw new Error("原材料母版身份不符");
const zip = new PizZip(source);
const xml = name => new DOMParser().parseFromString(zip.file(name).asText(), "application/xml");
const setPart = (name, contents) => { const date = zip.file(name).date; zip.file(name, contents, { date }); };
const serialize = node => new XMLSerializer().serializeToString(node);
const text = node => Array.from(node.getElementsByTagNameNS(W, "t")).map(t => t.textContent ?? "").join("");
const document = xml("word/document.xml");
const paragraphs = Array.from(document.getElementsByTagNameNS(W, "p"));
const replacements = [
  ["第一条  货物名称、规格型号、数量、价格等", "第一条  材料及运输项目名称、规格型号、数量、价格等"],
  ["货物", "项目"], ["{#材料清单}{序号}", "{#材料清单}{rowNumber}"], ["{税额单价}", "{taxUnitPrice}"],
  ["材料合计", "清单合计（含运输）"], ["{生产厂家}", "{manufacturer}"],
  ["4.本合同单价为综合单价，包含货物的出厂价、运输费、包装费、运杂费、装卸费、服务费、损耗、保险、利润等到达买方指定地点交付前的所有费用。", "4.材料与运输费用按本条统一清单分别列示，均已包含在本合同总价中；同一运输费用不得重复计入材料行单价或另行收取。其他未单独列示的包装费、装卸费、服务费、损耗、保险、利润等费用，已包含在相应材料行单价中。"],
  ["2.运输方式及费用：由卖方负责运输，运至买方指定交货地点，卖方应自行选择适宜的运输工具及线路安排货物的运输，运输费由卖方承担，有关费用已包含在合同单价中。", "2.运输方式及费用：由卖方负责运输至买方指定交货地点，运输费用在统一清单中单独列示并已计入本合同总价，不再另行收取。卖方应自行选择适宜的运输工具及线路。"]
];
const changedParagraphs = [];
for (const [before, after] of replacements) {
  const matches = paragraphs.filter(p => text(p) === before);
  if (matches.length !== 1) throw new Error("新版本原文资格不唯一：" + before);
  const p = matches[0], nodes = Array.from(p.getElementsByTagNameNS(W, "t"));
  if (!nodes.length) throw new Error("原文字缺少文字run");
  nodes[0].textContent = after;
  for (const node of nodes.slice(1)) node.parentNode.removeChild(node);
  changedParagraphs.push({ before, after });
}
const body = document.getElementsByTagNameNS(W, "body")[0];
const sourceChildren = Array.from(body.childNodes).filter(n => n.nodeType === 1);
const opening = sourceChildren.findIndex(n => n.localName === "p" && text(n) === "{#运输清单}");
if (opening < 0 || sourceChildren[opening + 1]?.localName !== "tbl" || text(sourceChildren[opening + 2]) !== "{/运输清单}") throw new Error("原独立运输表资格不符");
const removed = sourceChildren.slice(opening, opening + 3);
if (!text(removed[1]).includes("{运输路线}") || removed[1].getElementsByTagNameNS(W, "gridCol").length !== 7) throw new Error("原运输表不是准确7列表");
for (const node of removed) body.removeChild(node);
// Only the new version's totals row borrows its empty unit-price cells.
// The 13-column grid, both header rows, all detail cells and their fonts stay intact.
const table = Array.from(body.childNodes).find(node => node.nodeType === 1 && node.localName === "tbl");
const rows = Array.from(table.childNodes).filter(node => node.nodeType === 1 && node.localName === "tr");
const totalRow = rows.at(-1), cells = Array.from(totalRow.childNodes).filter(node => node.nodeType === 1 && node.localName === "tc");
if (cells.length !== 9 || text(cells[0]) !== "清单合计（含运输）") throw new Error("新版本合计行资格不符");
for (const [unitIndex, amountIndex, token] of [[2, 3, "{材料不含税合计}"], [5, 6, "{材料税额合计}"], [7, 8, "{材料含税合计}"]]) {
  const unit = cells[unitIndex], amount = cells[amountIndex];
  if (text(unit) !== "" || text(amount) !== token) throw new Error("合计行不能合并非空单位价或不同金额格");
  const unitWidth = unit.getElementsByTagNameNS(W, "tcW")[0], properties = amount.getElementsByTagNameNS(W, "tcPr")[0];
  const amountWidth = properties.getElementsByTagNameNS(W, "tcW")[0];
  if (!unitWidth || !amountWidth || properties.getElementsByTagNameNS(W, "gridSpan").length) throw new Error("合计原单格宽度不确定");
  amountWidth.setAttributeNS(W, "w:w", String(Number(unitWidth.getAttributeNS(W, "w")) + Number(amountWidth.getAttributeNS(W, "w"))));
  const span = document.createElementNS(W, "w:gridSpan"); span.setAttributeNS(W, "w:val", "2");
  properties.insertBefore(span, amountWidth.nextSibling);
  totalRow.removeChild(unit);
}
setPart("word/document.xml", serialize(document));
const footerQualifications = [
  { part: "word/footer1.xml", sha256: "873a36bc9d0f2473c7c8ee5c91afed33525f7506dbb325eeb889d8625273b631", frame: { w: "2880", h: "2880", hAnchor: "margin", vAnchor: "text", xAlign: "center", y: "0", wrap: "none", hRule: "atLeast" } },
  { part: "word/footer2.xml", sha256: "9b99cd0e68f87b9567592511786361e6b738cf612e505ae0bd4830975e8b5cdb", frame: { w: "1159", h: "359", hAnchor: "page", vAnchor: "page", x: "1888", y: "15090", wrap: "none", hRule: "atLeast" } }
];
for (const qualification of footerQualifications) {
  if (hash(zip.file(qualification.part).asNodeBuffer()) !== qualification.sha256) throw new Error("原页脚资格不符");
  const footer = xml(qualification.part), textboxes = footer.getElementsByTagNameNS(WPS, "txbx");
  if (textboxes.length !== 1) throw new Error("原PAGE文本盒不唯一");
  const inner = textboxes[0].getElementsByTagNameNS(W, "p");
  if (inner.length !== 1 || Array.from(inner[0].getElementsByTagNameNS(W, "instrText")).length !== 1 || !/^\s*PAGE(?:\s+\\\*\s+MERGEFORMAT)?\s*$/u.test(inner[0].getElementsByTagNameNS(W, "instrText")[0].textContent ?? "")) throw new Error("原页脚包含非PAGE结构");
  if (!/^[— 16]*$/u.test(text(inner[0]))) throw new Error("原PAGE文本盒含业务文字");
  const ordinary = inner[0].cloneNode(true);
  const pPr = ordinary.getElementsByTagNameNS(W, "pPr")[0];
  if (!pPr || pPr.parentNode !== ordinary) throw new Error("原PAGE段落样式不确定");
  const frame = footer.createElementNS(W, "w:framePr");
  for (const [name, value] of Object.entries(qualification.frame)) frame.setAttributeNS(W, "w:" + name, value);
  const framePredecessors = new Set(["pStyle", "keepNext", "keepLines", "pageBreakBefore"]);
  const following = Array.from(pPr.childNodes).find(node => node.nodeType === 1 && !framePredecessors.has(node.localName));
  if (following) pPr.insertBefore(frame, following); else pPr.appendChild(frame);
  const originalParagraphs = Array.from(footer.documentElement.childNodes).filter(n => n.nodeType === 1);
  if (originalParagraphs.length !== 1 || originalParagraphs[0].localName !== "p") throw new Error("原页脚非唯一外层段落");
  footer.documentElement.replaceChild(ordinary, originalParagraphs[0]);
  if (footer.getElementsByTagNameNS(W, "p").length !== 1) throw new Error("新页脚仍含嵌套段落");
  setPart(qualification.part, serialize(footer));
}
const changedParts = Object.values(zip.files).filter(f => !f.dir && !f.asNodeBuffer().equals(new PizZip(source).file(f.name).asNodeBuffer())).map(f => f.name).sort();
if (JSON.stringify(changedParts) !== JSON.stringify(["word/document.xml", "word/footer1.xml", "word/footer2.xml"])) throw new Error("新版本修改了范围外成员");
const result = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
await writeFile(resolve(root, outputPath), result);
await writeFile(resolve(root, "scripts/probes/task10-documents/material-unified-provenance.json"), JSON.stringify({ purpose: "Confirmed unified main material and transport technical template version; not production adoption or seed publication", originalPath, originalSha256: hash(source), outputPath, sourceSha256: hash(result), changedParts, changedParagraphs, removedSeparateTransportNodes: 3, totalRowGridSpans: [5, 1, 2, 1, 2, 2], totalRowMergeOnlyEmptyUnitPriceCells: true, footerQualifications, nominalGeometryOnlyNotOriginalPaintEquivalence: true, sourceStylesSectionsRelationshipsAndOtherMembersUnchanged: true }, null, 2) + "\n");
process.stdout.write(JSON.stringify({ outputPath, sha256: hash(result), changedParts }) + "\n");
