export type ContractDocumentCanvasKind =
  | "ready"
  | "outdated"
  | "processing"
  | "failed"
  | "empty";

export interface ContractDocumentCanvasRecord {
  id: string;
  purpose?: string;
  status?: string;
  sourceRevision?: number;
  documentContentRevision?: number | null;
  documentContentFingerprint?: string | null;
  pdfFileId?: string | null;
  createdAt?: string | Date;
  completedAt?: string | Date | null;
}

export interface ContractDocumentCanvasState {
  kind: ContractDocumentCanvasKind;
  document: ContractDocumentCanvasRecord | null;
}

const ACTIVE_STATUSES = new Set(["queued", "processing"]);
const AVAILABLE_STATUSES = new Set(["success", "stale"]);

function timeValue(value: string | Date | null | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value !== "string" || !value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latest(
  documents: ContractDocumentCanvasRecord[],
  predicate: (document: ContractDocumentCanvasRecord) => boolean
): ContractDocumentCanvasRecord | null {
  return (
    documents
      .filter(predicate)
      .sort(
        (left, right) =>
          timeValue(right.completedAt ?? right.createdAt) -
          timeValue(left.completedAt ?? left.createdAt)
      )[0] ?? null
  );
}

function hasPdf(document: ContractDocumentCanvasRecord): boolean {
  return typeof document.pdfFileId === "string" && document.pdfFileId.trim().length > 0;
}

export function contractDocumentCanvasState(
  documents: ContractDocumentCanvasRecord[],
  documentContentRevision: number,
  documentContentFingerprint: string | null
): ContractDocumentCanvasState {
  const matchesCurrentContent = (document: ContractDocumentCanvasRecord) =>
    document.documentContentRevision === documentContentRevision &&
    document.documentContentFingerprint === documentContentFingerprint;
  const ready = latest(
    documents,
    (document) =>
      document.status === "success" &&
      matchesCurrentContent(document) &&
      hasPdf(document)
  );
  if (ready) return { kind: "ready", document: ready };

  const processing = latest(
    documents,
    (document) =>
      matchesCurrentContent(document) &&
      ACTIVE_STATUSES.has(String(document.status ?? ""))
  );
  if (processing) return { kind: "processing", document: processing };

  const failed = latest(
    documents,
    (document) =>
      matchesCurrentContent(document) && document.status === "failed"
  );
  if (failed) return { kind: "failed", document: failed };

  const outdated = latest(
    documents,
    (document) =>
      AVAILABLE_STATUSES.has(String(document.status ?? "")) && hasPdf(document)
  );
  if (outdated) return { kind: "outdated", document: outdated };

  return { kind: "empty", document: null };
}
