import { createHash } from "node:crypto";
import { DOMParser } from "@xmldom/xmldom";
import { PDFDocument } from "pdf-lib";
import PizZip from "pizzip";
import { CONTRACT_DOCX_EXTRACTION_LIMITS, extractContractDocx } from "../contract-document/contract-docx-extractor";
import { type runTask12GeneratedDocument, task12GeneratedDocumentLayoutId } from "./task12-generated-document-seam";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const REASON = "隔离验收核对同修订Word与PDF";
const MATERIAL_CLAUSE = "第二条质量技术标准及相关要求";
const HTTP_TIMEOUT_MS = 15_000;
const TICKET_TTL_MS = 5 * 60_000;
const MAX_JSON_BYTES = 16 * 1024;
const MAX_PDF_BYTES = 100_000_000;
const MAX_PDF_PAGES = 100;
const PDF_TEXT_TIMEOUT_MS = 30_000;
const MAX_TEXT_CHARACTERS = 500_000;
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";
const TICKET_ACTION = "create_private_file_download_ticket";

const ownerScopesUsed = new WeakSet<object>();
const ownerProofs = new WeakMap<object, object>();

type Coordinates = Awaited<ReturnType<typeof runTask12GeneratedDocument>>;
interface Input {
  port: number;
  ownerScope?: object;
  actorId: string;
  accessToken: string;
  confirmationPassword: string;
  fields: { contractName: string; ownerName: string; counterpartyName: string };
  /** The owned acceptance runner supplies its independently qualified parser for visible PDF page text. */
  readPdfDrawnText(bytes: Buffer, signal: AbortSignal): Promise<readonly string[]>;
}

function requireStage(value: unknown, stage: string): asserts value {
  if (!value) {
    const code = "TASK12_GENERATED_DOCUMENT_READBACK_" + stage;
    throw Object.assign(new Error(code), { code });
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function compact(text: string) {
  return text.normalize("NFKC").replace(/\s+/gu, "");
}

async function readBounded(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("BODY");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > limit) throw new Error("BODY");
      chunks.push(result.value);
    }
    return Buffer.concat(chunks, length);
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function mime(response: Response) {
  return response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
}

async function sameApp<T>(base: string, path: string, init: RequestInit, status: number, stage: string, read: (response: Response) => Promise<T>) {
  let response: Response | undefined;
  try {
    response = await fetch(base + path, { ...init, redirect: "error", signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
    requireStage(response.status === status && !response.redirected, stage);
    return await read(response);
  } catch {
    if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
    requireStage(false, stage);
  }
}

async function json(response: Response) {
  requireStage(mime(response) === "application/json", "JSON");
  return object(JSON.parse((await readBounded(response, MAX_JSON_BYTES)).toString("utf8")));
}

function matchFields(paragraphs: readonly string[], expected: readonly string[], stage: string) {
  const text = compact(paragraphs.join("\n"));
  requireStage(expected.every(value => text.includes(value)), stage);
}

function wordParagraphs(bytes: Buffer) {
  const { blocks } = extractContractDocx(bytes);
  const zip = new PizZip(bytes);
  const parser = new DOMParser({ onError: () => { throw new Error("XML"); } });
  const types = zip.file("[Content_Types].xml")?.asText();
  const relations = zip.file("_rels/.rels")?.asText();
  requireStage(types && relations && !/<!DOCTYPE|<!ENTITY/iu.test(types + relations), "DOCX");
  const main = Array.from(parser.parseFromString(types, "application/xml")
    .getElementsByTagNameNS("http://schemas.openxmlformats.org/package/2006/content-types", "Override"))
    .filter(entry => entry.getAttribute("PartName") === "/word/document.xml");
  const documentRelation = Array.from(parser.parseFromString(relations, "application/xml")
    .getElementsByTagNameNS("http://schemas.openxmlformats.org/package/2006/relationships", "Relationship"))
    .filter(entry => entry.getAttribute("Type") === "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument");
  requireStage(main.length === 1 && main[0].getAttribute("ContentType") ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml" && documentRelation.length === 1 &&
    ["/word/document.xml", "word/document.xml"].includes(documentRelation[0].getAttribute("Target") ?? "") &&
    !documentRelation[0].hasAttribute("TargetMode"), "DOCX");
  return blocks.map(block => block.text);
}

async function pdfPageCount(bytes: Buffer, readDrawnText: Input["readPdfDrawnText"], expected: readonly string[]) {
  let pages: number;
  let text: readonly string[];
  try {
    requireStage(bytes.subarray(0, 5).toString("ascii") === "%PDF-", "PDF");
    pages = (await PDFDocument.load(bytes, { throwOnInvalidObject: true, updateMetadata: false })).getPageCount();
    requireStage(pages > 0 && pages <= MAX_PDF_PAGES, "PDF");
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const expired = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("TIME"));
        }, PDF_TEXT_TIMEOUT_MS);
      });
      text = await Promise.race([readDrawnText(Buffer.from(bytes), controller.signal), expired]);
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    requireStage(false, "PDF");
  }
  requireStage(Array.isArray(text) && text.length === pages && text.every(value => typeof value === "string") &&
    text.reduce((length, value) => length + value.length, 0) <= MAX_TEXT_CHARACTERS, "PDF");
  matchFields(text, expected, "PDF_FIELDS");
  return pages;
}

/** This claim is usable only by the fixed owner reader with its original resource scope. */
export function claimTask12GeneratedDocumentOwnerReadback(scope: object, result: Awaited<ReturnType<typeof readTask12GeneratedDocumentOutputs>>) {
  requireStage(ownerProofs.get(result) === scope && scope !== undefined, "OWNER_PROOF");
  ownerProofs.delete(result);
  return result;
}

export async function readTask12GeneratedDocumentOutputs(coordinates: Coordinates, input: Input) {
  const layoutId = task12GeneratedDocumentLayoutId(coordinates);
  const { ownerScope } = input;
  requireStage(layoutId && Number.isSafeInteger(input.port) && input.port > 0 && input.port <= 65535 &&
    UUID.test(input.actorId) && typeof input.accessToken === "string" && input.accessToken.length <= 4096 &&
    /^[\w-]+\.[\w-]+\.[\w-]+$/u.test(input.accessToken) &&
    typeof input.confirmationPassword === "string" && /^[a-f0-9]{64}$/u.test(input.confirmationPassword), "INPUT");
  const { contractName, ownerName, counterpartyName } = input.fields;
  const rawValues = [contractName, ownerName, counterpartyName];
  requireStage(rawValues.every(value => typeof value === "string" && value === value.trim() && value.length <= 120), "INPUT");
  const names = rawValues.map(compact);
  requireStage(names.every(value => value.length >= 3 && !value.includes(MATERIAL_CLAUSE)) &&
    new Set(names).size === names.length, "INPUT");
  const [name, owner, counterparty] = names;
  const expected = [name, "甲方:" + owner, "乙方:" + counterparty, MATERIAL_CLAUSE];
  if (ownerScope !== undefined) {
    requireStage(ownerScope && typeof ownerScope === "object" && !ownerScopesUsed.has(ownerScope), "OWNER_SCOPE");
    ownerScopesUsed.add(ownerScope);
  }
  const base = "http://127.0.0.1:" + input.port;
  const headers = { authorization: "Bearer " + input.accessToken };
  const { actorId } = input;

  async function readFile(fileId: string, expectedMime: string, limit: number, accessMode: "preview" | "download") {
    const path = "/files/" + fileId;
    const capability = await sameApp(base, path + "/download-ticket-capability", { method: "GET", headers }, 200, "CAPABILITY", json);
    const action = object(capability.action);
    requireStage(action.key === TICKET_ACTION && action.enabled === true && Array.isArray(capability.availableActions) &&
      capability.availableActions.includes(TICKET_ACTION), "CAPABILITY");

    const issuedAfter = Date.now();
    const ticket = await sameApp(base, path + "/download-ticket", {
      method: "POST", headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ confirmationPassword: input.confirmationPassword, downloadReason: REASON, accessMode })
    }, 201, "TICKET", json);
    const { sizeBytes, expiresAt, downloadUrl } = ticket;
    const expires = typeof expiresAt === "string" ? Date.parse(expiresAt) : NaN;
    const observedAt = Date.now();
    requireStage(ticket.fileId === fileId && ticket.mimeType === expectedMime &&
      typeof sizeBytes === "number" && Number.isSafeInteger(sizeBytes) && sizeBytes > 0 && sizeBytes <= limit &&
      typeof expiresAt === "string" && Number.isFinite(expires) && new Date(expires).toISOString() === expiresAt &&
      observedAt >= issuedAfter && expires >= issuedAfter + TICKET_TTL_MS - HTTP_TIMEOUT_MS &&
      expires > observedAt && expires <= observedAt + TICKET_TTL_MS && typeof downloadUrl === "string", "TICKET");
    const prefix = path + "/download?actorUserId=" + encodeURIComponent(actorId) + "&expiresAt=" + encodeURIComponent(expiresAt) +
      "&downloadReason=" + encodeURIComponent(REASON) + "&accessMode=" + accessMode + "&token=";
    const token = downloadUrl.slice(prefix.length);
    requireStage(downloadUrl.startsWith(prefix) && /^[A-Za-z0-9_-]{43}$/u.test(token), "TICKET");
    const bytes = await sameApp(base, prefix + token, { method: "GET" }, 200, "DOWNLOAD", async response => {
      requireStage(mime(response) === expectedMime && response.headers.get("content-length") === String(sizeBytes) &&
        response.headers.get("content-encoding") === null && response.headers.get("content-range") === null &&
        response.headers.get("content-disposition")?.startsWith((accessMode === "preview" ? "inline" : "attachment") + "; "), "DOWNLOAD");
      const downloaded = await readBounded(response, sizeBytes);
      requireStage(downloaded.length === sizeBytes, "DOWNLOAD");
      return downloaded;
    });
    return {
      bytes, evidence: Object.freeze({
        fileId, mimeType: expectedMime, sizeBytes, sha256: createHash("sha256").update(bytes).digest("hex"),
        audit: Object.freeze({
          businessType: "file_object" as const, actorId, accessMode, expiresAt, downloadReason: REASON,
          ticketAction: accessMode === "preview" ? "file.preview.ticket" : "file.download.ticket",
          consumeAction: accessMode === "preview" ? "file.preview" : "file.download"
        })
      })
    };
  }

  const docx = await readFile(coordinates.docxFileId, DOCX_MIME, CONTRACT_DOCX_EXTRACTION_LIMITS.maxArchiveBytes, "download");
  let docxParagraphs: string[];
  try {
    docxParagraphs = wordParagraphs(docx.bytes);
  } catch {
    requireStage(false, "DOCX");
  }
  matchFields(docxParagraphs, expected, "DOCX_FIELDS");
  const pdf = await readFile(coordinates.pdfFileId, PDF_MIME, MAX_PDF_BYTES, "preview");
  const pageCount = await pdfPageCount(pdf.bytes, input.readPdfDrawnText, expected);

  const result = Object.freeze({
    status: "DRAFT_WORD_PDF_PUBLIC_READBACK_MATCHED" as const,
    generationId: coordinates.generationId, layoutId, versionId: coordinates.versionId,
    files: Object.freeze({ docx: docx.evidence, pdf: Object.freeze({ ...pdf.evidence, pageCount }) }),
    ownerExpectation: Object.freeze({
      actorId, purpose: "draft" as const, status: "success" as const,
      sourceRevision: coordinates.sourceRevision, documentContentRevision: coordinates.documentContentRevision,
      documentContentFingerprint: coordinates.documentContentFingerprint,
      generationAudit: Object.freeze({ action: "contract.document.success" as const, businessType: "contract_generated_document" as const })
    })
  });
  if (ownerScope) ownerProofs.set(result, ownerScope);
  return result;
}
