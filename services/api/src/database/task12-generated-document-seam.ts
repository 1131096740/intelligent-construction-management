import { createHash } from "node:crypto";
import { REVIEWED_MATERIAL_SOURCE_SHA256 } from "../contract-document/contract-body-document";
import { confirmedLayoutSourceMapping } from "../contract-template/layout-field-mapping";
import {
  CONTRACT_DRAFT_LEASE_HEARTBEAT_MS,
  CONTRACT_DRAFT_LEASE_TTL_MS
} from "../contract-workbench/contract-draft-edit-lease.service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA = /^[0-9a-f]{64}$/u;
const POLL_MS = 1000;
const DOCUMENT_TIMEOUT_MS = 130_000;
const templates = new WeakSet<object>();
const publishedLayouts = new WeakSet<object>();
const generatedCoordinates = new WeakMap<object, string>();

function requireStage(value: unknown, stage: string): asserts value {
  const code = "TASK12_GENERATED_DOCUMENT_" + stage;
  if (!value) throw Object.assign(new Error(code), { code });
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function verifyTask12MaterialTemplate(source: Uint8Array) {
  requireStage(source instanceof Uint8Array && source.byteLength > 0, "TEMPLATE");
  const sha256 = createHash("sha256").update(source).digest("hex");
  requireStage(sha256 === REVIEWED_MATERIAL_SOURCE_SHA256, "TEMPLATE");
  const evidence = Object.freeze({ sha256, bytes: source.byteLength });
  templates.add(evidence);
  return evidence;
}

/** Bind the verified physical source, original upload response and published layout observation. */
export function bindTask12PublishedMaterialTemplate(
  source: ReturnType<typeof verifyTask12MaterialTemplate>,
  upload: unknown,
  publication: unknown
) {
  const file = object(upload), layout = object(publication), sourceFileId = file.id, layoutId = layout.id;
  const draftRevision = layout.draftRevision;
  const sourceMapping = object(object(layout.placeholderSchema).sourceMapping);
  const confirmation = object(sourceMapping.confirmation);
  requireStage(templates.has(source) && isId(sourceFileId) && isId(layoutId) && sourceFileId !== layoutId &&
    file.contentSha256 === source.sha256 && file.sizeBytes === source.bytes && layout.docxFileId === sourceFileId &&
    layout.status === "published" && typeof draftRevision === "number" && Number.isSafeInteger(draftRevision) &&
    draftRevision > 0 && Array.isArray(sourceMapping.bindings) && isId(layout.previewPdfFileId) &&
    isId(confirmation.previewJobId) && confirmation.previewPdfFileId === layout.previewPdfFileId, "TEMPLATE");
  let mapping: ReturnType<typeof confirmedLayoutSourceMapping>;
  try {
    mapping = confirmedLayoutSourceMapping({ docxFileId: sourceFileId, draftRevision, placeholderSchema: layout.placeholderSchema });
  } catch {
    requireStage(false, "TEMPLATE");
  }
  requireStage(mapping && mapping.protocolVersion === 1 && mapping.sourceSha256 === source.sha256 &&
    SHA.test(mapping.fingerprint), "TEMPLATE");
  const evidence = Object.freeze({ layoutId, sourceFileId, sourceSha256: source.sha256 });
  publishedLayouts.add(evidence);
  return evidence;
}

/** Keep document save on the actual published material template. */
export function isTask12PublishedMaterialTemplate(value: unknown): value is ReturnType<typeof bindTask12PublishedMaterialTemplate> {
  return typeof value === "object" && value !== null && publishedLayouts.has(value);
}

export interface GeneratedDocumentRequest {
  method: "GET" | "POST";
  path: string;
  json?: Readonly<{ sourceRevision: number }>;
  headers?: Readonly<{ "x-contract-draft-lease": string } | { "x-contract-numeric-protocol": "2" }>;
}

type Response = { status: number; body: unknown };
interface Port {
  now(): number;
  wait(ms: number): Promise<void>;
  send(request: GeneratedDocumentRequest): Promise<Response>;
}

interface Input {
  template: ReturnType<typeof bindTask12PublishedMaterialTemplate>;
  versionId: string;
  sourceRevision: number;
  documentContentRevision: number;
  documentContentFingerprint: string;
  lease: { token: string; leaseRevision: number; expiresAt: string };
}

/** Internal lineage used by the fixed dual-format readback. */
export function task12GeneratedDocumentLayoutId(coordinates: ReturnTypeOfGeneratedDocument) {
  return generatedCoordinates.get(coordinates);
}

type ReturnTypeOfGeneratedDocument = Awaited<ReturnType<typeof runTask12GeneratedDocument>>;

/** Public workbench coordinates only. An owned caller must still verify physical file bytes and scope. */
export async function runTask12GeneratedDocument(input: Input, port: Port) {
  const { template, versionId, sourceRevision, documentContentRevision, documentContentFingerprint, lease } = input;
  requireStage(publishedLayouts.has(template) && isId(versionId) && versionId !== template.layoutId &&
    Number.isSafeInteger(sourceRevision) && sourceRevision > 0 &&
    Number.isSafeInteger(documentContentRevision) && documentContentRevision > 0 &&
    typeof documentContentFingerprint === "string" && SHA.test(documentContentFingerprint), "INPUT");
  const { token, leaseRevision } = lease;
  let expiry = lease.expiresAt, expires = Date.parse(expiry);
  const start = port.now(), deadline = start + DOCUMENT_TIMEOUT_MS;
  requireStage(Number.isSafeInteger(start) && expires > start && expires - start <= CONTRACT_DRAFT_LEASE_TTL_MS &&
    Number.isSafeInteger(leaseRevision) && leaseRevision > 0 && typeof token === "string" && /^[\w-]{43}$/u.test(token), "LEASE");
  const path = "/contract-drafts/" + versionId;
  let previousTime = start;
  const readClock = () => {
    const time = port.now();
    requireStage(Number.isSafeInteger(time) && time >= previousTime && time < deadline, "TIME");
    previousTime = time;
    return time;
  };
  const keepLease = async () => {
    const now = readClock();
    requireStage(expires > now, "LEASE");
    const issuedAt = expires - CONTRACT_DRAFT_LEASE_TTL_MS;
    if (now < issuedAt + CONTRACT_DRAFT_LEASE_HEARTBEAT_MS) return;
    const renewed = await port.send({ method: "POST", path: path + "/edit-lease/heartbeat",
      headers: { "x-contract-draft-lease": token } });
    const value = object(renewed.body);
    const updated = typeof value.expiresAt === "string" ? Date.parse(value.expiresAt) : NaN;
    const confirmedAt = readClock();
    requireStage(renewed.status === 201 && value.leaseRevision === leaseRevision && updated > expires &&
      updated > confirmedAt && updated - confirmedAt <= CONTRACT_DRAFT_LEASE_TTL_MS, "LEASE");
    expiry = value.expiresAt as string;
    expires = updated;
  };
  const hasTrace = (value: Record<string, unknown>) => value.sourceRevision === sourceRevision &&
    value.documentContentRevision === documentContentRevision && value.documentContentFingerprint === documentContentFingerprint;

  await keepLease();
  const queued = await port.send({ method: "POST", path: path + "/preview-generation", json: { sourceRevision } });
  const preview = object(queued.body), generationId = preview.generationId;
  requireStage(queued.status === 201 && preview.status === "queued" && isId(generationId) && hasTrace(preview), "QUEUE");

  for (let attempt = 0; attempt < DOCUMENT_TIMEOUT_MS / POLL_MS; attempt++) {
    await keepLease();
    const response = await port.send({ method: "GET", path: path + "/workbench",
      headers: { "x-contract-numeric-protocol": "2" } });
    const workbench = object(response.body), current = object(workbench.version);
    const currentLease = object(workbench.lease);
    requireStage(response.status === 200 && current.id === versionId && current.status === "draft" &&
      current.layoutTemplateVersionId === template.layoutId && current.draftRevision === sourceRevision &&
      current.documentContentRevision === documentContentRevision &&
      current.documentContentFingerprint === documentContentFingerprint, "WORKBENCH");
    requireStage(currentLease.state === "held_by_me" && currentLease.expiresAt === expiry && readClock() < expires, "LEASE");
    const documents = Array.isArray(workbench.documents) ? workbench.documents.map(object) : [];
    const matching = documents.filter(document => document.id === generationId);
    const currentDocument = matching[0];
    requireStage(matching.length === 1 && currentDocument.purpose === "draft" && hasTrace(currentDocument), "DOCUMENT");
    if (currentDocument.status === "success") {
      const { docxFileId, pdfFileId } = currentDocument;
      requireStage(current.latestDraftPreviewDocumentId === generationId &&
        isId(docxFileId) && isId(pdfFileId) && docxFileId !== pdfFileId, "DOCUMENT");
      const coordinates = Object.freeze({ status: "DRAFT_WORD_PDF_COORDINATES_MATCHED" as const, generationId, versionId, docxFileId, pdfFileId,
        sourceRevision, documentContentRevision, documentContentFingerprint });
      generatedCoordinates.set(coordinates, template.layoutId);
      return coordinates;
    }
    requireStage((currentDocument.status === "queued" || currentDocument.status === "processing") &&
      currentDocument.docxFileId === null && currentDocument.pdfFileId === null, "DOCUMENT");
    await port.wait(POLL_MS);
  }
  requireStage(false, "TIME");
}
