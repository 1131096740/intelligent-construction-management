import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import {
  CONTRACT_BILL_PLACEHOLDER_ALIASES,
  CONTRACT_BILL_ROW_PLACEHOLDER_ALIASES,
  CONTRACT_DOCUMENT_REQUIRED_PLACEHOLDERS,
  CONTRACT_VALUE_PLACEHOLDER_ALIASES
} from "./contract-placeholder-registry";
import type { ContractDocumentRenderInput } from "./contract-document.types";

const REQUIRED_VALUES = CONTRACT_DOCUMENT_REQUIRED_PLACEHOLDERS;
const MERGEABLE_BILL_TABLE_HEADERS = new Set([
  "序号货物名称规格型号计量单位数量含税单价税率(%)价税合计",
  "机械设备名称或费用名称规格型号暂估数量计价单位含税租金单价税率(%)价税合计租金备注",
  "序号项目名称单位工程量含税单价合计备注",
  "名称规格/说明单位数量单价金额备注"
]);
const CHINESE_DIGITS = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
const SECTION_UNITS = ["", "拾", "佰", "仟"];
const GROUP_UNITS = ["", "万", "亿", "兆", "京"];
function moneyCents(value: bigint): bigint {
  if (typeof value !== "bigint" || value < 0n) {
    throw new Error("合同金额格式不正确");
  }
  return value;
}

export function formatMoneyCents(value: bigint): string {
  const cents = moneyCents(value);
  const yuan = (cents / 100n).toString();
  const groupedYuan = yuan.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${groupedYuan}.${(cents % 100n).toString().padStart(2, "0")}`;
}

function formatChineseSection(value: number): string {
  let section = value;
  let unitIndex = 0;
  let result = "";
  let pendingZero = false;

  while (section > 0) {
    const digit = section % 10;
    if (digit === 0) {
      if (result) pendingZero = true;
    } else {
      result =
        `${CHINESE_DIGITS[digit]}${SECTION_UNITS[unitIndex]}${pendingZero ? CHINESE_DIGITS[0] : ""}` +
        result;
      pendingZero = false;
    }
    section = Math.floor(section / 10);
    unitIndex += 1;
  }

  return result;
}

function formatChineseYuan(value: bigint): string {
  if (value === 0n) return CHINESE_DIGITS[0];

  let yuan = value;
  let groupIndex = 0;
  let result = "";
  let lowerGroupHasValue = false;
  let lowerGroupNeedsLeadingZero = false;
  let skippedEmptyGroup = false;

  while (yuan > 0n) {
    if (groupIndex >= GROUP_UNITS.length) {
      throw new Error("合同金额超出中文大写金额可转换范围");
    }
    const section = Number(yuan % 10_000n);
    if (section === 0) {
      if (lowerGroupHasValue) skippedEmptyGroup = true;
    } else {
      const needsZero =
        lowerGroupHasValue && (skippedEmptyGroup || lowerGroupNeedsLeadingZero);
      result =
        `${formatChineseSection(section)}${GROUP_UNITS[groupIndex]}` +
        `${needsZero ? CHINESE_DIGITS[0] : ""}${result}`;
      lowerGroupHasValue = true;
      lowerGroupNeedsLeadingZero = section < 1_000;
      skippedEmptyGroup = false;
    }
    yuan /= 10_000n;
    groupIndex += 1;
  }

  return result;
}

export function formatChineseUppercaseMoney(value: bigint): string {
  const cents = moneyCents(value);
  if (cents === 0n) return "人民币零元整";

  const yuan = cents / 100n;
  const jiao = Number((cents / 10n) % 10n);
  const fen = Number(cents % 10n);
  let result = `人民币${formatChineseYuan(yuan)}元`;

  if (jiao > 0) result += `${CHINESE_DIGITS[jiao]}角`;
  if (fen > 0) {
    if (yuan > 0n && jiao === 0) result += CHINESE_DIGITS[0];
    result += `${CHINESE_DIGITS[fen]}分`;
  }
  return jiao === 0 && fen === 0 ? `${result}整` : result;
}

function assertRequiredValues(
  values: Record<string, unknown>,
  requiredKeys: readonly string[]
): void {
  const missing = [...new Set([...REQUIRED_VALUES, ...requiredKeys])].filter(
    (key) =>
      !Object.prototype.hasOwnProperty.call(values, key) ||
      values[key] === null ||
      values[key] === undefined ||
      (typeof values[key] === "string" && values[key].trim() === "")
  );
  if (missing.length) {
    throw new Error("合同文档缺少必填内容，请补充后重试");
  }
}

function withChinesePlaceholderAliases(values: Record<string, unknown>): Record<string, unknown> {
  const aliased = { ...values };
  for (const [alias, source] of Object.entries(CONTRACT_VALUE_PLACEHOLDER_ALIASES)) {
    if (aliased[alias] === undefined && values[source] !== undefined) {
      aliased[alias] = values[source];
    }
  }
  for (const [alias, source] of Object.entries(CONTRACT_BILL_PLACEHOLDER_ALIASES)) {
    const rows = values[source];
    if (aliased[alias] !== undefined || !Array.isArray(rows)) continue;
    aliased[alias] = rows.map((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return row;
      const aliasedRow = { ...(row as Record<string, unknown>) };
      for (const [rowAlias, rowSource] of Object.entries(CONTRACT_BILL_ROW_PLACEHOLDER_ALIASES)) {
        if (aliasedRow[rowAlias] === undefined && aliasedRow[rowSource] !== undefined) {
          aliasedRow[rowAlias] = aliasedRow[rowSource];
        }
      }
      return aliasedRow;
    });
  }
  return aliased;
}

function tableRows(tableXml: string): string[] {
  return tableXml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? [];
}

function rowText(rowXml: string): string {
  return [...rowXml.matchAll(/<w:t(?: [^>]*)?>(.*?)<\/w:t>/g)]
    .map((match) => match[1])
    .join("");
}

function tableHeaderText(tableXml: string): string {
  return rowText(tableRows(tableXml)[0] ?? "");
}

function mergeTableRows(targetTableXml: string, sourceTableXml: string): string {
  const sourceDataRows = tableRows(sourceTableXml).slice(1).join("");
  if (!sourceDataRows) return targetTableXml;
  return targetTableXml.replace("</w:tbl>", `${sourceDataRows}</w:tbl>`);
}

function mergeRepeatedBillTables(documentXml: string): string {
  const tablePattern = /<w:tbl\b[\s\S]*?<\/w:tbl>/g;
  let result = "";
  let cursor = 0;
  let pendingTable: { header: string; xml: string } | undefined;

  for (const match of documentXml.matchAll(tablePattern)) {
    const tableXml = match[0];
    const tableStart = match.index ?? 0;
    const tableEnd = tableStart + tableXml.length;
    const between = documentXml.slice(cursor, tableStart);
    const header = tableHeaderText(tableXml);

    if (
      pendingTable &&
      between.trim() === "" &&
      pendingTable.header === header &&
      MERGEABLE_BILL_TABLE_HEADERS.has(header)
    ) {
      pendingTable = {
        header,
        xml: mergeTableRows(pendingTable.xml, tableXml)
      };
      cursor = tableEnd;
      continue;
    }

    if (pendingTable) {
      result += pendingTable.xml + between;
    } else {
      result += between;
    }
    pendingTable = { header, xml: tableXml };
    cursor = tableEnd;
  }

  if (pendingTable) return result + pendingTable.xml + documentXml.slice(cursor);
  return documentXml;
}

export function renderContractDocx(
  templateBuffer: Buffer,
  renderInput: ContractDocumentRenderInput,
  requiredKeys: readonly string[] = []
): Buffer {
  assertRequiredValues(renderInput.values, requiredKeys);

  const zip = (() => {
    try {
      const parsed = new PizZip(templateBuffer);
      if (!parsed.file("word/document.xml")) {
        throw new Error("合同 DOCX 模板缺少正文结构");
      }
      return parsed;
    } catch {
      throw new Error("合同 DOCX 模板格式不正确");
    }
  })();

  try {
    const document = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => ""
    });
    document.render(withChinesePlaceholderAliases(renderInput.values));
    const renderedZip = document.getZip();
    const documentXml = renderedZip.file("word/document.xml")?.asText();
    if (documentXml) {
      renderedZip.file("word/document.xml", mergeRepeatedBillTables(documentXml));
    }
    return renderedZip.generate({ type: "nodebuffer" });
  } catch {
    throw new Error("合同 DOCX 模板渲染失败，请检查模板内容");
  }
}
