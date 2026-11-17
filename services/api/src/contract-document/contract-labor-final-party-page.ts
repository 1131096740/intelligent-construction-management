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
