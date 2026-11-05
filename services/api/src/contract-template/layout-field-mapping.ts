import { CONTRACT_VALUE_PLACEHOLDER_ALIASES } from "../contract-document/contract-placeholder-registry";
import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { DOMParser, XMLSerializer, type Document, type Element } from "@xmldom/xmldom";
import PizZip from "pizzip";
import { CONTRACT_DOCX_EXTRACTION_LIMITS, extractContractDocx } from "../contract-document/contract-docx-extractor";

const WORD_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const SOURCE_PART = /^word\/(document|header\d*|footer\d*)\.xml$/u;
const INVALID_SOURCE = "Word 模板结构无法安全解析，请检查文件后重新上传";

const REQUIRED_AND_PRIMARY_MAPPING_FIELDS = [
  { key: "contract.name", label: "合同名称" },
  { key: "party.owner.name", label: "甲方名称" },
  { key: "party.counterparty.name", label: "乙方名称" },
  { key: "contract.temporaryCode", label: "草稿编号" },
  { key: "document.watermark", label: "文档水印" },
  { key: "contract.amount", label: "合同金额" },
  { key: "contract.amountUppercase", label: "合同金额大写" },
  { key: "clause.payment.text", label: "付款条款" }
] as const;
export const LAYOUT_MAPPING_FIELDS = [
  ...REQUIRED_AND_PRIMARY_MAPPING_FIELDS,
  ...Object.entries(CONTRACT_VALUE_PLACEHOLDER_ALIASES).map(([label, key]) => ({ key, label }))
].filter((field, index, fields) => fields.findIndex(value => value.key === field.key) === index);


export interface LayoutFieldBinding {
  positionId: string;
  start: number;
  end: number;
  fieldKey: string;
}

export interface LayoutSourceMapping {
  protocolVersion: 1;
  sourceFileId: string;
  sourceSha256: string;
  draftRevision: number;
  bindings: LayoutFieldBinding[];
  fingerprint: string;
}

export interface LayoutSourcePosition {
  positionId: string;
  part: string;
  paragraphIndex: number;
  text: string;
}

function xmlDocument(xml: string): Document {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) throw new BadRequestException(INVALID_SOURCE);
  try {
    return new DOMParser({ onError: () => { throw new Error("invalid XML"); } })
      .parseFromString(xml, "application/xml");
  } catch {
    throw new BadRequestException(INVALID_SOURCE);
  }
}

function paragraphText(paragraph: Element) {
  if (paragraph.getElementsByTagNameNS(WORD_NAMESPACE, "p").length) {
    throw new BadRequestException("模板包含嵌套正文段落，请拆分后重新上传");
  }
  return Array.from(paragraph.getElementsByTagNameNS(WORD_NAMESPACE, "t"))
    .map(node => node.textContent ?? "").join("");
}

/** Actual source bytes and visible positions; no field inference or confirmation. */
export function readLayoutSourcePositions(source: Buffer) {
  // Reuse the existing bounded Word package/正文 validator before DOM parsing.
  extractContractDocx(source);
  const zip = new PizZip(source);
  let totalXmlBytes = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    if (entry.name.startsWith("/") || entry.name.split("/").includes("..") || /vbaProject|activeX|embeddings/iu.test(entry.name)) {
      throw new BadRequestException(INVALID_SOURCE);
    }
    if (!/\.(xml|rels)$/iu.test(entry.name)) continue;
    const declaredSize = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (!Number.isSafeInteger(declaredSize) || declaredSize! < 0) throw new BadRequestException(INVALID_SOURCE);
    totalXmlBytes += declaredSize!;
    if (totalXmlBytes > CONTRACT_DOCX_EXTRACTION_LIMITS.maxTotalXmlBytes) throw new BadRequestException("Word 模板 XML 与关系总内容过大");
    const xml = entry.asText();
    const doc = xmlDocument(xml);
    if (doc.getElementsByTagNameNS(WORD_NAMESPACE, "altChunk").length ||
      doc.getElementsByTagNameNS("urn:schemas-microsoft-com:office:office", "OLEObject").length ||
      /INCLUDETEXT|INCLUDEPICTURE|DDEAUTO/iu.test(xml)) {
      throw new BadRequestException("模板包含外部或可执行内容，请移除后重新上传");
    }
    if (entry.name.endsWith(".rels")) {
      for (const relationship of Array.from(doc.getElementsByTagNameNS("http://schemas.openxmlformats.org/package/2006/relationships", "Relationship"))) {
        const target = relationship.getAttribute("Target") ?? "";
        if (relationship.getAttribute("TargetMode") === "External" || /^[a-z][a-z\d+.-]*:|^\/\//iu.test(target)) {
          throw new BadRequestException("模板包含外部文件引用，请移除后重新上传");
        }
      }
    }
  }
  const sourceSha256 = createHash("sha256").update(source).digest("hex");
  const positions: LayoutSourcePosition[] = [];
  const parts = Object.keys(zip.files).filter(name => SOURCE_PART.test(name)).sort((a, b) => a === "word/document.xml" ? -1 : b === "word/document.xml" ? 1 : a.localeCompare(b));
  for (const part of parts) {
    const doc = xmlDocument(zip.file(part)!.asText());
    Array.from(doc.getElementsByTagNameNS(WORD_NAMESPACE, "p")).forEach((paragraph, paragraphIndex) => {
      const text = paragraphText(paragraph);
      if (!text.trim()) return;
      const positionId = createHash("sha256").update(JSON.stringify([sourceSha256, part, paragraphIndex, text])).digest("hex");
      positions.push({ positionId, part, paragraphIndex, text });
    });
  }
  return { sourceSha256, positions };
}

function mappingFingerprint(mapping: Omit<LayoutSourceMapping, "fingerprint">) {
  // PostgreSQL jsonb does not preserve object-key order.
  return createHash("sha256").update(JSON.stringify([
    mapping.protocolVersion, mapping.sourceFileId, mapping.sourceSha256, mapping.draftRevision,
    mapping.bindings.map(binding => [binding.positionId, binding.start, binding.end, binding.fieldKey])
  ])).digest("hex");
}

export function prepareLayoutSourceMapping(source: Buffer, sourceFileId: string, draftRevision: number, input: readonly LayoutFieldBinding[]) {
  const parsed = readLayoutSourcePositions(source);
  const positions = new Map(parsed.positions.map(position => [position.positionId, position]));
  const fields = new Set<string>(LAYOUT_MAPPING_FIELDS.map(field => field.key));
  const bindings = input.map(binding => ({ positionId: binding.positionId, start: binding.start, end: binding.end, fieldKey: binding.fieldKey }))
    .sort((a, b) => a.positionId.localeCompare(b.positionId) || a.start - b.start || a.end - b.end || a.fieldKey.localeCompare(b.fieldKey));
  let previous: LayoutFieldBinding | undefined;
  for (const binding of bindings) {
    const position = positions.get(binding.positionId);
    if (!position || !fields.has(binding.fieldKey) || !Number.isInteger(binding.start) || !Number.isInteger(binding.end) || binding.start < 0 || binding.end <= binding.start || binding.end > position.text.length) {
      throw new BadRequestException("自动填写位置与当前原文不符，请重新选择");
    }
    if ([binding.start, binding.end].some(index => { const code = position.text.charCodeAt(index); return code >= 0xdc00 && code <= 0xdfff; })) {
      throw new BadRequestException("请选择完整文字，不要拆分字符");
    }
    if (previous?.positionId === binding.positionId && binding.start < previous.end) {
      throw new BadRequestException("自动填写位置不能重叠，请分别选择");
    }
    previous = binding;
  }
  const selected = new Set(bindings.map(binding => binding.fieldKey));
  const required = LAYOUT_MAPPING_FIELDS.slice(0, 5).filter(field => !selected.has(field.key));
  if (required.length) throw new BadRequestException(`请明确选择${required.map(field => field.label).join("、")}的自动填写位置`);
  const content = { protocolVersion: 1 as const, sourceFileId, sourceSha256: parsed.sourceSha256, draftRevision, bindings };
  const mapping: LayoutSourceMapping = { ...content, fingerprint: mappingFingerprint(content) };
  return { mapping, docx: applyLayoutSourceMapping(source, mapping) };
}

/** Rechecks the exact source and mapping on every use; original files stay intact. */
export function applyLayoutSourceMapping(source: Buffer, mapping: LayoutSourceMapping): Buffer {
  const parsed = readLayoutSourcePositions(source);
  const { fingerprint, ...content } = mapping;
  if (mapping.protocolVersion !== 1 || parsed.sourceSha256 !== mapping.sourceSha256 || mappingFingerprint(content) !== fingerprint) {
    throw new BadRequestException("模板原文件或自动填写映射已变化，请重新检查确认");
  }
  const positions = new Map(parsed.positions.map(position => [position.positionId, position]));
  const zip = new PizZip(source);
  const documents = new Map<string, Document>();
  for (const binding of [...mapping.bindings].sort((a, b) => a.positionId.localeCompare(b.positionId) || b.start - a.start)) {
    const position = positions.get(binding.positionId);
    if (!position) throw new BadRequestException("自动填写位置已失效，请重新选择");
    let doc = documents.get(position.part);
    if (!doc) {
      doc = xmlDocument(zip.file(position.part)!.asText());
      documents.set(position.part, doc);
    }
    const paragraph = doc.getElementsByTagNameNS(WORD_NAMESPACE, "p").item(position.paragraphIndex)!;
    const nodes = Array.from(paragraph.getElementsByTagNameNS(WORD_NAMESPACE, "t"));
    let offset = 0;
    let inserted = false;
    for (const node of nodes) {
      const text = node.textContent ?? "";
      const end = offset + text.length;
      if (offset < binding.end && end > binding.start) {
        const startWithin = Math.max(0, binding.start - offset);
        const endWithin = Math.min(text.length, binding.end - offset);
        node.textContent = text.slice(0, startWithin) + (inserted ? "" : `{${binding.fieldKey}}`) + text.slice(endWithin);
        inserted = true;
      }
      offset = end;
    }
    if (!inserted) throw new BadRequestException("自动填写位置无法应用，请重新选择");
  }
  for (const [name, doc] of documents) zip.file(name, new XMLSerializer().serializeToString(doc));
  return zip.generate({ type: "nodebuffer" });
}

export function mappedLayoutSourceForVersion(source: Buffer, version: { docxFileId: string; draftRevision: number; placeholderSchema: unknown }) {
  const schema = version.placeholderSchema;
  const stored = schema && typeof schema === "object" && !Array.isArray(schema)
    ? (schema as Record<string, unknown>).sourceMapping : undefined;
  if (stored === undefined) {
    readLayoutSourcePositions(source);
    return source;
  }
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    throw new BadRequestException("模板自动填写映射记录异常，请重新检查确认");
  }
  const data = stored as Record<string, unknown>;
  if (data.protocolVersion !== 1 || data.sourceFileId !== version.docxFileId || data.draftRevision !== version.draftRevision || typeof data.fingerprint !== "string" || !Array.isArray(data.bindings) || data.bindings.length > 128) {
    throw new BadRequestException("模板原文件或自动填写映射已变化，请重新检查确认");
  }
  const prepared = prepareLayoutSourceMapping(source, version.docxFileId, version.draftRevision, data.bindings as LayoutFieldBinding[]);
  if (prepared.mapping.sourceSha256 !== data.sourceSha256 || prepared.mapping.fingerprint !== data.fingerprint) {
    throw new BadRequestException("模板原文件或自动填写映射已变化，请重新检查确认");
  }
  return prepared.docx;
}

/** Confirmed, immutable mapping coordinates for the existing document input snapshot.
 * Absence is an explicit legacy branch; it never reads or guesses a newer version.
 */
export function confirmedLayoutSourceMapping(version: { docxFileId: string; draftRevision: number; placeholderSchema: unknown }): LayoutSourceMapping | undefined {
  const schema = version.placeholderSchema;
  const stored = schema && typeof schema === "object" && !Array.isArray(schema) ? (schema as Record<string, unknown>).sourceMapping : undefined;
  if (stored === undefined) return undefined;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) throw new BadRequestException("模板填写位置记录异常，请重新确认");
  const mapping = stored as LayoutSourceMapping & { confirmation?: Record<string, unknown> };
  const confirmation = mapping.confirmation;
  if (!confirmation || mapping.sourceFileId !== version.docxFileId || mapping.draftRevision !== version.draftRevision || confirmation.sourceFileId !== mapping.sourceFileId || confirmation.sourceSha256 !== mapping.sourceSha256 || confirmation.draftRevision !== version.draftRevision || confirmation.mappingFingerprint !== mapping.fingerprint || typeof confirmation.previewJobId !== "string" || typeof confirmation.previewPdfFileId !== "string") throw new BadRequestException("请由合同主管预览并确认当前原文的自动填写位置");
  return { protocolVersion: mapping.protocolVersion, sourceFileId: mapping.sourceFileId, sourceSha256: mapping.sourceSha256, draftRevision: mapping.draftRevision, bindings: mapping.bindings.map(binding => ({ ...binding })), fingerprint: mapping.fingerprint };
}
