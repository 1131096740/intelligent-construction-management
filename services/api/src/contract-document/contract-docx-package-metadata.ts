import { createHash } from "node:crypto";
import { DOMParser, XMLSerializer, type Document, type Element } from "@xmldom/xmldom";
import PizZip from "pizzip";
import { extractContractDocx } from "./contract-docx-extractor";

const PROFESSIONAL_SOURCE = "6ae812af212498638036a24fbc7ce793497a82894a76b28b087b51a1cef366f4";
const GENERIC_SOURCE = "3a3d0fb5e9b5e49798f3773f213296b9cfa224874d14bda6aa89006b63bd366a";
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const FONT_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable";
const FONT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml";
const ERROR = "合同 Word 模板的字体资料无法安全核对，请检查模板后重试";

function parse(text: string): Document {
  if (/<!DOCTYPE|<!ENTITY/iu.test(text)) throw new Error(ERROR);
  return new DOMParser({ onError: () => { throw new Error(ERROR); } }).parseFromString(text, "application/xml");
}

/** Exact preserved A07 source has a font-table relationship but lacks its OPC
 * override. Complete only that missing declaration on the generated package;
 * original source bytes, all other ZIP member payloads and existing outputs stay intact. */
export interface ContractDocxPackageNormalization {
  normalizationId: "professional-font-table-content-type-v1" | "generic-font-table-content-type-v1";
  originalMasterSha256: string;
  renderedDocxBeforeSha256: string;
  renderedDocxAfterSha256: string;
  changedParts: ["[Content_Types].xml"];
}

export function completeContractDocxFontTableType(docx: Buffer, originalSourceSha256: string): { docx: Buffer; normalization?: ContractDocxPackageNormalization } {
  const normalizationId = originalSourceSha256 === PROFESSIONAL_SOURCE ? "professional-font-table-content-type-v1"
    : originalSourceSha256 === GENERIC_SOURCE ? "generic-font-table-content-type-v1" : undefined;
  if (!normalizationId) return { docx };
  try {
    extractContractDocx(docx); // Existing bounded package/XML validation.
    const zip = new PizZip(docx);
    const relationships = parse(zip.file("word/_rels/document.xml.rels")!.asText());
    if (!relationships.documentElement || relationships.documentElement.namespaceURI !== REL || relationships.documentElement.localName !== "Relationships") throw new Error(ERROR);
    const relations = Array.from(relationships.getElementsByTagNameNS(REL, "Relationship")).filter(node => node.getAttribute("Type") === FONT_REL);
    if (relations.length !== 1 || relations[0].getAttribute("Target") !== "fontTable.xml" ||
      !["", "Internal"].includes(relations[0].getAttribute("TargetMode") ?? "")) throw new Error(ERROR);
    const fonts = parse(zip.file("word/fontTable.xml")!.asText());
    if (!fonts.documentElement || fonts.documentElement.namespaceURI !== W || fonts.documentElement.localName !== "fonts") throw new Error(ERROR);
    const types = parse(zip.file("[Content_Types].xml")!.asText());
    if (!types.documentElement || types.documentElement.namespaceURI !== CT || types.documentElement.localName !== "Types") throw new Error(ERROR);
    const declarations = Array.from(types.documentElement.childNodes).filter(node => node.nodeType === 1)
      .filter(node => (node as Element).getAttribute("PartName") === "/word/fontTable.xml");
    if (declarations.length > 1) throw new Error(ERROR);
    if (declarations.length === 1) {
      const declaration = declarations[0] as Element;
      if (declaration.namespaceURI !== CT || declaration.localName !== "Override" || declaration.getAttribute("ContentType") !== FONT_TYPE) throw new Error(ERROR);
      return { docx };
    }
    const declaration = types.createElementNS(CT, "Override");
    declaration.setAttribute("PartName", "/word/fontTable.xml");
    declaration.setAttribute("ContentType", FONT_TYPE);
    types.documentElement.appendChild(declaration);
    zip.file("[Content_Types].xml", new XMLSerializer().serializeToString(types));
    const output = zip.generate({ type: "nodebuffer" });
    const original = new PizZip(docx), completed = new PizZip(output);
    const members = Object.keys(original.files).sort();
    if (JSON.stringify(members) !== JSON.stringify(Object.keys(completed.files).sort()) || members.some(name =>
      name !== "[Content_Types].xml" && !original.files[name].dir &&
      !original.files[name].asNodeBuffer().equals(completed.files[name].asNodeBuffer()))) throw new Error(ERROR);
    const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
    return { docx: output, normalization: {
      normalizationId, originalMasterSha256: originalSourceSha256,
      renderedDocxBeforeSha256: sha(docx), renderedDocxAfterSha256: sha(output), changedParts: ["[Content_Types].xml"]
    } };
  } catch {
    throw new Error(ERROR);
  }
}
