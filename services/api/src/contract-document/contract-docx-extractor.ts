import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import PizZip from "pizzip";

export const CONTRACT_DOCX_EXTRACTION_LIMITS = {
  maxArchiveBytes: 25 * 1024 * 1024,
  maxEntries: 512,
  maxEntryBytes: 4 * 1024 * 1024,
  maxTotalXmlBytes: 8 * 1024 * 1024,
  maxDocumentXmlBytes: 2 * 1024 * 1024,
  maxParagraphs: 3_000,
  maxTables: 200,
  maxTableCells: 5_000,
  maxBlocks: 5_000,
  maxCharacters: 500_000
} as const;

export type ContractDocxBlockKind = "paragraph" | "table_cell";

export interface ContractDocxBlock {
  kind: ContractDocxBlockKind;
  path: string;
  text: string;
}

export interface ContractDocxSnapshot {
  blocks: ContractDocxBlock[];
  normalizedSha256: string;
}

type ZipEntry = {
  dir?: boolean;
  name: string;
  asText(): string;
  _data?: { uncompressedSize?: number };
};

type XmlToken =
  | { kind: "text"; value: string }
  | { kind: "cdata"; value: string }
  | { kind: "open"; name: string; selfClosing: boolean }
  | { kind: "close"; name: string }
  | { kind: "skip" };

export function extractContractDocx(buffer: Buffer): ContractDocxSnapshot {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new BadRequestException("合同 DOCX 文件无法读取");
  }
  if (buffer.length > CONTRACT_DOCX_EXTRACTION_LIMITS.maxArchiveBytes) {
    throw new BadRequestException("合同 DOCX 文件大小超过系统限制");
  }

  let zip: InstanceType<typeof PizZip>;
  try {
    zip = new PizZip(buffer);
  } catch {
    throw new BadRequestException("合同 DOCX 文件无法读取");
  }
  const entries = Object.values(zip.files) as ZipEntry[];
  if (entries.length > CONTRACT_DOCX_EXTRACTION_LIMITS.maxEntries) {
    throw new BadRequestException("合同 DOCX 压缩包文件项过多");
  }

  let totalXmlBytes = 0;
  for (const entry of entries) {
    if (entry.dir) continue;
    const size = entry._data?.uncompressedSize;
    if (!Number.isSafeInteger(size) || (size ?? -1) < 0) {
      throw new BadRequestException("合同 DOCX 压缩包无法安全检查");
    }
    if (size! > CONTRACT_DOCX_EXTRACTION_LIMITS.maxEntryBytes) {
      throw new BadRequestException("合同 DOCX 压缩包单项内容过大");
    }
    if (entry.name.toLowerCase().endsWith(".xml")) {
      totalXmlBytes += size!;
      if (totalXmlBytes > CONTRACT_DOCX_EXTRACTION_LIMITS.maxTotalXmlBytes) {
        throw new BadRequestException("合同 DOCX XML 总内容过大");
      }
    }
  }

  const documentEntry = zip.file("word/document.xml") as ZipEntry | null;
  if (!documentEntry) throw new BadRequestException("合同 DOCX 缺少正文内容");
  const declaredDocumentSize = documentEntry._data?.uncompressedSize ?? 0;
  if (declaredDocumentSize > CONTRACT_DOCX_EXTRACTION_LIMITS.maxDocumentXmlBytes) {
    throw new BadRequestException("合同 DOCX 正文内容过大");
  }

  let xml: string;
  try {
    xml = documentEntry.asText();
  } catch {
    throw new BadRequestException("合同 DOCX 正文内容无法读取");
  }
  if (Buffer.byteLength(xml, "utf8") > CONTRACT_DOCX_EXTRACTION_LIMITS.maxDocumentXmlBytes) {
    throw new BadRequestException("合同 DOCX 正文内容过大");
  }
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    throw new BadRequestException("合同 DOCX XML 结构不正确");
  }

  const blocks = extractBlocks(xml);
  return {
    blocks,
    normalizedSha256: createHash("sha256").update(JSON.stringify(blocks)).digest("hex")
  };
}

function extractBlocks(xml: string): ContractDocxBlock[] {
  const blocks: ContractDocxBlock[] = [];
  const stack: string[] = [];
  let cursor = 0;
  let sawDocument = false;
  let sawBody = false;
  let paragraphCount = 0;
  let paragraphIndex = 0;
  let tableCount = 0;
  let tableIndex = 0;
  let rowIndex = 0;
  let cellCount = 0;
  let cellIndex = 0;
  let characterCount = 0;
  let inTable = false;
  let inRow = false;
  let activeParagraph: string | null = null;
  let cellParagraphs: string[] | null = null;

  while (cursor < xml.length) {
    const parsed = nextXmlToken(xml, cursor);
    cursor = parsed.next;
    const token = parsed.token;
    if (token.kind === "skip") continue;
    if (token.kind === "text" || token.kind === "cdata") {
      if (activeParagraph !== null && stack.at(-1) === "w:t") {
        activeParagraph += decodeXmlText(token.value);
      }
      continue;
    }
    if (token.kind === "close") {
      if (stack.pop() !== token.name) failXml();
      if (token.name === "w:p") {
        if (activeParagraph === null) failXml();
        if (cellParagraphs) {
          cellParagraphs.push(activeParagraph);
        } else {
          paragraphIndex += 1;
          characterCount = pushBlock(blocks, {
            kind: "paragraph",
            path: `p:${fixedIndex(paragraphIndex)}`,
            text: normalizeVisibleText(activeParagraph)
          }, characterCount);
        }
        activeParagraph = null;
      } else if (token.name === "w:tc") {
        if (!cellParagraphs) failXml();
        characterCount = pushBlock(blocks, {
          kind: "table_cell",
          path: `tbl:${fixedIndex(tableIndex)}/r:${fixedIndex(rowIndex)}/c:${fixedIndex(cellIndex)}`,
          text: normalizeVisibleText(cellParagraphs.join(" "))
        }, characterCount);
        cellParagraphs = null;
      } else if (token.name === "w:tr") {
        inRow = false;
      } else if (token.name === "w:tbl") {
        inTable = false;
        rowIndex = 0;
        cellIndex = 0;
      }
      continue;
    }

    if (!token.selfClosing) stack.push(token.name);
    if (token.name === "w:document") sawDocument = true;
    if (token.name === "w:body") sawBody = true;
    if (token.name === "w:tbl") {
      if (inTable) throw new BadRequestException("合同 DOCX 包含不支持的嵌套表格");
      inTable = true;
      tableCount += 1;
      tableIndex += 1;
      rowIndex = 0;
      if (tableCount > CONTRACT_DOCX_EXTRACTION_LIMITS.maxTables) {
        throw new BadRequestException("合同 DOCX 表格数量超过系统限制");
      }
    } else if (token.name === "w:tr") {
      if (!inTable || inRow) failXml();
      inRow = true;
      rowIndex += 1;
      cellIndex = 0;
    } else if (token.name === "w:tc") {
      if (!inTable || !inRow || cellParagraphs) failXml();
      cellCount += 1;
      cellIndex += 1;
      if (cellCount > CONTRACT_DOCX_EXTRACTION_LIMITS.maxTableCells) {
        throw new BadRequestException("合同 DOCX 表格单元格数量超过系统限制");
      }
      cellParagraphs = [];
    } else if (token.name === "w:p") {
      if (activeParagraph !== null) failXml();
      paragraphCount += 1;
      if (paragraphCount > CONTRACT_DOCX_EXTRACTION_LIMITS.maxParagraphs) {
        throw new BadRequestException("合同 DOCX 段落数量超过系统限制");
      }
      activeParagraph = "";
    } else if ((token.name === "w:tab" || token.name === "w:br") && activeParagraph !== null) {
      activeParagraph += token.name === "w:tab" ? "\t" : "\n";
    }
  }

  if (stack.length || !sawDocument || !sawBody || activeParagraph !== null || inTable || inRow) {
    failXml();
  }
  return blocks;
}

function pushBlock(
  blocks: ContractDocxBlock[],
  block: ContractDocxBlock,
  characterCount: number
) {
  if (!block.text) return characterCount;
  if (blocks.length >= CONTRACT_DOCX_EXTRACTION_LIMITS.maxBlocks) {
    throw new BadRequestException("合同 DOCX 内容块数量超过系统限制");
  }
  const characters = characterCount + block.text.length;
  if (characters > CONTRACT_DOCX_EXTRACTION_LIMITS.maxCharacters) {
    throw new BadRequestException("合同 DOCX 正文字符数量超过系统限制");
  }
  blocks.push(block);
  return characters;
}

function nextXmlToken(xml: string, start: number): { token: XmlToken; next: number } {
  if (xml[start] !== "<") {
    const end = xml.indexOf("<", start);
    return {
      token: { kind: "text", value: xml.slice(start, end === -1 ? xml.length : end) },
      next: end === -1 ? xml.length : end
    };
  }
  if (xml.startsWith("<!--", start)) {
    const end = xml.indexOf("-->", start + 4);
    if (end === -1) failXml();
    return { token: { kind: "skip" }, next: end + 3 };
  }
  if (xml.startsWith("<![CDATA[", start)) {
    const end = xml.indexOf("]]>", start + 9);
    if (end === -1) failXml();
    return {
      token: { kind: "cdata", value: xml.slice(start + 9, end) },
      next: end + 3
    };
  }
  if (xml.startsWith("<?", start)) {
    const end = xml.indexOf("?>", start + 2);
    if (end === -1) failXml();
    return { token: { kind: "skip" }, next: end + 2 };
  }
  if (xml.startsWith("<!", start)) failXml();

  let quote = "";
  let end = start + 1;
  for (; end < xml.length; end += 1) {
    const char = xml[end];
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      break;
    }
  }
  if (end >= xml.length || quote) failXml();
  const body = xml.slice(start + 1, end).trim();
  const closing = body.startsWith("/");
  const selfClosing = !closing && body.endsWith("/");
  const nameSource = body.slice(closing ? 1 : 0, selfClosing ? -1 : undefined).trim();
  const name = nameSource.match(/^([A-Za-z_][\w:.-]*)/u)?.[1];
  if (!name) failXml();
  return {
    token: closing
      ? { kind: "close", name }
      : { kind: "open", name, selfClosing },
    next: end + 1
  };
}

function decodeXmlText(value: string) {
  if (/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-f]+;)/iu.test(value)) failXml();
  return value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/giu, (entity) => {
    const named: Record<string, string> = {
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": '"',
      "&apos;": "'"
    };
    const normalized = entity.toLowerCase();
    if (named[normalized]) return named[normalized];
    const hexadecimal = normalized.startsWith("&#x");
    const codePoint = Number.parseInt(
      normalized.slice(hexadecimal ? 3 : 2, -1),
      hexadecimal ? 16 : 10
    );
    try {
      return Number.isNaN(codePoint) ? entity : String.fromCodePoint(codePoint);
    } catch {
      failXml();
    }
  });
}

function normalizeVisibleText(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function fixedIndex(value: number) {
  return String(value).padStart(4, "0");
}

function failXml(): never {
  throw new BadRequestException("合同 DOCX XML 结构不正确");
}
