import { BadRequestException } from "@nestjs/common";
import { DOMParser, XMLSerializer, type Document, type Element } from "@xmldom/xmldom";
import PizZip from "pizzip";
import { signatureBankLines } from "./contract-signature-bank-fields";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export function laborFinalPartyNames(values: Record<string, unknown>, required = true): [string, string] {
  const name = (key: string) => {
    const value = values[key];
    if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
      if (required) throw new BadRequestException("请先填写合同甲乙双方名称，再生成合同");
      return "";
    }
    if (typeof value !== "string" || Array.from(value).length > 80 || Array.from(value).some(character => {
      const code = character.codePointAt(0)!;
      return code < 32 || (code >= 127 && code <= 159) || (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff || code === 0x2028 || code === 0x2029;
    })) {
      throw new BadRequestException("合同主体名称过长或含不支持的字符，请核对后重试");
    }
    return value;
  };
  return [name("party.owner.name"), name("party.counterparty.name")];
}

/** Adds information only; the existing contract and attachment signatures stay in place. */
export function appendLaborFinalPartyPage(document: Document, values: Record<string, unknown>, includeBanks = false, includeSigning = false): void {
  const [owner, counterparty] = laborFinalPartyNames(values, false);
  const body = document.getElementsByTagNameNS(W, "body").item(0);
  if (!body) throw new BadRequestException("合同正文缺少主体内容");
  const section = Array.from(body.childNodes).find(node => node.nodeType === 1 && (node as Element).namespaceURI === W && (node as Element).localName === "sectPr") ?? null;
  const lines = ["双方主体及银行信息", `甲方：${owner}`, ...(includeBanks?signatureBankLines(values,"party.owner"):["开户行：________________________", "银行账号：______________________"]), ...(includeSigning?["甲方签署（盖章）：____________ 日期：____________"]:[]), `乙方：${counterparty}`, ...(includeBanks?signatureBankLines(values,"party.counterparty"):["开户行：________________________", "银行账号：______________________"]), ...(includeSigning?["乙方签署（盖章）：____________ 日期：____________"]:[])];
  for (const [index, line] of lines.entries()) {
    const paragraph = document.createElementNS(W, "w:p"), properties = document.createElementNS(W, "w:pPr");
    if (index === 0) properties.appendChild(document.createElementNS(W, "w:pageBreakBefore"));
    const keep = document.createElementNS(W, "w:keepNext"); keep.setAttributeNS(W, "w:val", "0"); properties.appendChild(keep);
    paragraph.appendChild(properties);
    const run = document.createElementNS(W, "w:r"), runProperties = document.createElementNS(W, "w:rPr"), size = document.createElementNS(W, "w:sz");
    size.setAttributeNS(W, "w:val", "24"); runProperties.appendChild(size); run.appendChild(runProperties);
    const text = document.createElementNS(W, "w:t"); text.appendChild(document.createTextNode(line)); run.appendChild(text); paragraph.appendChild(run);
    body.insertBefore(paragraph, section);
  }
}

export function appendLaborFinalPartyPageToDocx(bytes: Buffer, values: Record<string, unknown>, includeBanks = false, includeSigning = false): Buffer {
  const zip = new PizZip(bytes), part = zip.file("word/document.xml");
  if (!part) throw new BadRequestException("合同正文缺少主体内容");
  const document = new DOMParser().parseFromString(part.asText(), "application/xml");
  appendLaborFinalPartyPage(document, values, includeBanks, includeSigning);
  zip.file("word/document.xml", new XMLSerializer().serializeToString(document));
  return zip.generate({ type: "nodebuffer" });
}

export const LABOR_MAIN_SIGNATURE_PAGE_VERSION = "built-in-labor-main-signature-page-v1" as const;

/** Reuse the original main signing table, ahead of all of the template's annexes. */
export function applyLaborMainSignaturePage(document: Document, values: Record<string, unknown>): void {
  const direct = (element: Element, name: string): Element[] =>
    Array.from(element.childNodes).filter((node): node is Element =>
      node.nodeType === 1 && (node as Element).namespaceURI === W && (node as Element).localName === name);
  const text = (element: Element) =>
    Array.from(element.getElementsByTagNameNS(W, "t")).map(node => node.textContent ?? "").join("").replace(/\s+/gu, "");
  const reject = () => { throw new BadRequestException("劳务合同正文签署表位置无法核对，请保留当前内容后重试"); };
  const body = document.getElementsByTagNameNS(W, "body").item(0);
  if (!body) return reject();
  const tables = direct(body, "tbl").flatMap(table => {
    const rows = direct(table, "tr").map(row => direct(row, "tc"));
    if (rows.length !== 9 || rows.some((cells, i) => cells.length !== (i === 8 ? 2 : 3))) return [];
    if (text(rows[0][1]) !== "甲方" || text(rows[0][2]) !== "乙方" ||
        text(rows[1][0]) !== "公司名称：（盖章）" || text(rows[2][0]) !== "法定代表人：（签章）" ||
        text(rows[3][0]) !== "授权委托人：（签章）" || text(rows[8][0]) !== "日期：") return [];
    return [{ table, rows }];
  });
  if (tables.length !== 1) return reject();
  const { table, rows } = tables[0];
  const afterTable = Array.from(body.childNodes).slice(Array.from(body.childNodes).indexOf(table) + 1);
  const annex = afterTable.some(node => node.nodeType === 1 && (node as Element).namespaceURI === W &&
    (node as Element).localName === "tbl" &&
    text(node as Element).includes("发包人：(盖章)承包人：(盖章)"));
  if (!annex || [1, 6, 7].some(row => [1, 2].some(cell => text(rows[row][cell])))) return reject();

  const paragraph = (line: string, keepWithTable = false) => {
    const p = document.createElementNS(W, "w:p");
    const pPr = document.createElementNS(W, "w:pPr");
    if (keepWithTable) pPr.appendChild(document.createElementNS(W, "w:keepNext"));
    const spacing = document.createElementNS(W, "w:spacing");
    spacing.setAttributeNS(W, "w:before", "0");
    spacing.setAttributeNS(W, "w:after", "0");
    pPr.appendChild(spacing);
    p.appendChild(pPr);
    const r = document.createElementNS(W, "w:r");
    const t = document.createElementNS(W, "w:t");
    t.appendChild(document.createTextNode(line));
    r.appendChild(t);
    p.appendChild(r);
    return p;
  };
  body.insertBefore(paragraph("双方主体及银行信息", true), table);
  const names = laborFinalPartyNames(values, false);
  for (const [index, alias] of ["party.owner", "party.counterparty"].entries()) {
    const [bank, account, ...payment] = signatureBankLines(values, alias);
    rows[1][index + 1].appendChild(paragraph(names[index]));
    rows[6][index + 1].appendChild(paragraph(bank));
    rows[7][index + 1].appendChild(paragraph(account));
    for (const line of payment) rows[7][index + 1].appendChild(paragraph(line));
  }
  // Word joins each row to the next with the last paragraph of every cell.
  for (const cells of rows.slice(0, -1)) for (const cell of cells) {
    const last = direct(cell, "p").at(-1);
    if (!last) return reject();
    let pPr = direct(last, "pPr")[0];
    if (!pPr) {
      pPr = document.createElementNS(W, "w:pPr");
      last.insertBefore(pPr, last.firstChild);
    }
    let keep = direct(pPr, "keepNext")[0];
    if (!keep) {
      keep = document.createElementNS(W, "w:keepNext");
      const style = direct(pPr, "pStyle")[0];
      pPr.insertBefore(keep, style ? style.nextSibling : pPr.firstChild);
    }
    keep.setAttributeNS(W, "w:val", "1");
  }

}

export function applyLaborMainSignaturePageToDocx(bytes: Buffer, values: Record<string, unknown>): Buffer {
  const zip = new PizZip(bytes);
  const part = zip.file("word/document.xml");
  if (!part) throw new BadRequestException("合同正文缺少主体内容");
  const document = new DOMParser().parseFromString(part.asText(), "application/xml");
  applyLaborMainSignaturePage(document, values);
  zip.file("word/document.xml", new XMLSerializer().serializeToString(document));
  return zip.generate({ type: "nodebuffer" });
}
