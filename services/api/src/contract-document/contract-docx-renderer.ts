import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import type { ContractDocumentRenderInput } from "./contract-document.types";

const REQUIRED_VALUES = [
  "contract.name",
  "contract.temporaryCode",
  "document.watermark"
] as const;
const CHINESE_DIGITS = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
const SECTION_UNITS = ["", "拾", "佰", "仟"];
const GROUP_UNITS = ["", "万", "亿", "兆", "京"];

function moneyCents(value: bigint | number): bigint {
  if (
    (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) ||
    (typeof value === "bigint" && value < 0n) ||
    (typeof value !== "number" && typeof value !== "bigint")
  ) {
    throw new Error("Money cents must be a non-negative bigint or safe integer");
  }
  return BigInt(value);
}

export function formatMoneyCents(value: bigint | number): string {
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
      throw new Error("Money value exceeds the supported Chinese uppercase range");
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

export function formatChineseUppercaseMoney(value: bigint | number): string {
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
    throw new Error(`Missing required contract document values: ${missing.join(", ")}`);
  }
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
        throw new Error("word/document.xml is missing");
      }
      return parsed;
    } catch (cause) {
      throw new Error("Invalid contract DOCX template", { cause });
    }
  })();

  try {
    const document = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => ""
    });
    document.render(renderInput.values);
    return document.getZip().generate({ type: "nodebuffer" });
  } catch (cause) {
    throw new Error("Failed to render contract DOCX template", { cause });
  }
}
