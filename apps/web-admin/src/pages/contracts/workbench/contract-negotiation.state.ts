import type {
  ContractDifferenceCandidate,
  ContractDocumentComparisonReadModel,
  ContractDocumentDifferenceReadModel,
  ContractNegotiationProcessStatus,
  ContractNegotiationRoundReadModel,
  ContractOfflineRevisionReadModel
} from "../../../api/contract-negotiation.api";
import { centsTextToYuanText } from "../../../lib/money";

const processStatuses = new Set<ContractNegotiationProcessStatus>([
  "queued",
  "processing",
  "succeeded",
  "failed",
  "stale"
]);
const forbiddenReadKeys = new Set(["fileId", "previewPdfFileId", "downloadUrl"]);

export interface ContractNegotiationSelection {
  roundId: string;
  revisionId: string;
}

export function normalizeContractNegotiationRounds(
  value: unknown
): ContractNegotiationRoundReadModel[] {
  if (!Array.isArray(value)) throw new Error("合同磋商记录格式不正确，请刷新后重试。");
  const rounds = value.map(normalizeRound);
  assertUnique(rounds.map((round) => round.id), "合同磋商轮次");
  return rounds;
}

export function reconcileContractNegotiationSelection(
  rounds: ContractNegotiationRoundReadModel[],
  current?: ContractNegotiationSelection | null
): ContractNegotiationSelection | null {
  if (current) {
    const round = rounds.find((item) => item.id === current.roundId);
    if (round?.revisions.some((revision) => revision.id === current.revisionId)) return current;
  }
  for (const round of rounds) {
    if (round.revisions[0]) return { roundId: round.id, revisionId: round.revisions[0].id };
  }
  return null;
}

export function selectedContractNegotiationRevision(
  rounds: ContractNegotiationRoundReadModel[],
  selection: ContractNegotiationSelection | null
) {
  if (!selection) return null;
  const round = rounds.find((item) => item.id === selection.roundId);
  const revision = round?.revisions.find((item) => item.id === selection.revisionId);
  return round && revision ? { round, revision } : null;
}

export function latestOpenContractNegotiationRound(rounds: ContractNegotiationRoundReadModel[]) {
  return rounds.find((round) => round.status === "open") ?? null;
}

export function canCloseContractNegotiationRound(round: ContractNegotiationRoundReadModel) {
  return (
    round.status === "open" &&
    round.revisions.length > 0 &&
    round.revisions.every(
      (revision) =>
        revision.status === "succeeded" &&
        revision.comparison?.status === "succeeded" &&
        revision.comparison.differences.every(
          (difference) => difference.disposition !== "pending"
        )
    )
  );
}

export function hasActiveContractNegotiationProcessing(
  rounds: ContractNegotiationRoundReadModel[]
) {
  return rounds.some((round) =>
    round.revisions.some(
      (revision) =>
        revision.status === "queued" ||
        revision.status === "processing" ||
        revision.comparison?.status === "queued" ||
        revision.comparison?.status === "processing"
    )
  );
}

export function contractNegotiationProcessStatusLabel(status: ContractNegotiationProcessStatus) {
  return {
    queued: "等待处理",
    processing: "正在比较",
    succeeded: "比较完成",
    failed: "处理失败",
    stale: "结果已过期"
  }[status];
}

export function contractDifferenceDispositionLabel(
  disposition: ContractDocumentDifferenceReadModel["disposition"]
) {
  return {
    pending: "待处理",
    confirmed: "确认已同步账本",
    rejected: "不采纳",
    no_material_change: "无实质变化"
  }[disposition];
}

export function contractDifferenceCandidatePresentation(candidate: ContractDifferenceCandidate) {
  if (candidate.kind === "amount") {
    return { title: candidate.label, value: `¥${centsTextToYuanText(candidate.cents)}` };
  }
  if (candidate.kind === "date") {
    return { title: candidate.label, value: candidate.isoDate };
  }
  return { title: candidate.title, value: candidate.proposedText };
}

export function contractNegotiationReadinessMessages(readiness: unknown) {
  const record = asRecord(readiness);
  const structured = Array.isArray(record.blocking)
    ? record.blocking.flatMap((item) => {
        const entry = asRecord(item);
        return typeof entry.key === "string" &&
          entry.key.startsWith("negotiation.") &&
          typeof entry.message === "string"
          ? [entry.message]
          : [];
      })
    : [];
  if (structured.length) return structured;
  return Array.isArray(record.blockingMessages)
    ? record.blockingMessages.filter(
        (message): message is string =>
          typeof message === "string" && /磋商|差异|文档比较/u.test(message)
      )
    : [];
}

export function contractDifferenceDispositionDisabledReason(
  disposition: "confirmed" | "rejected" | "no_material_change",
  reason: string
) {
  if (disposition !== "confirmed" && !reason.trim()) return "请填写处置原因。";
  return "";
}

export function canApplyContractNegotiationResponse(
  requestId: number,
  currentRequestId: number,
  requestedVersionId: string,
  currentVersionId: string
) {
  return requestId === currentRequestId && requestedVersionId === currentVersionId;
}

export function contractNegotiationSelectionKey(
  value: { round: { id: string }; revision: { id: string } } | null | undefined
) {
  return value ? `${value.round.id}:${value.revision.id}` : "";
}

export function canApplyContractNegotiationSelectionResponse(
  requestId: number,
  currentRequestId: number,
  requestedSelectionKey: string,
  currentSelectionKey: string
) {
  return requestId === currentRequestId && requestedSelectionKey === currentSelectionKey;
}

function normalizeRound(value: unknown): ContractNegotiationRoundReadModel {
  const record = safeRecord(value);
  const id = requiredId(record.id, "合同磋商轮次");
  const revisions = requiredArray(record.revisions).map(normalizeRevision);
  assertUnique(revisions.map((revision) => revision.id), "合同磋商修订稿");
  if (record.status !== "open" && record.status !== "closed") malformed();
  if (!Number.isInteger(record.roundNo) || Number(record.roundNo) <= 0) malformed();
  if (!Number.isInteger(record.sourceRevision) || Number(record.sourceRevision) <= 0) malformed();
  return {
    id,
    roundNo: Number(record.roundNo),
    status: record.status,
    sourceRevision: Number(record.sourceRevision),
    note: optionalText(record.note),
    openedAt: requiredText(record.openedAt),
    closedAt: optionalText(record.closedAt),
    revisions
  };
}

function normalizeRevision(value: unknown): ContractOfflineRevisionReadModel {
  const record = safeRecord(value);
  const status = processStatus(record.status);
  if (typeof record.hasPreviewPdf !== "boolean") malformed();
  if (record.hasPreviewPdf && status !== "succeeded") malformed();
  return {
    id: requiredId(record.id, "合同磋商修订稿"),
    label: requiredText(record.label),
    note: optionalText(record.note),
    status,
    hasPreviewPdf: record.hasPreviewPdf === true,
    errorMessage: optionalText(record.errorMessage),
    createdAt: requiredText(record.createdAt),
    completedAt: optionalText(record.completedAt),
    comparison: record.comparison === null ? null : normalizeComparison(record.comparison)
  };
}

function normalizeComparison(value: unknown): ContractDocumentComparisonReadModel {
  const record = safeRecord(value);
  const differences = requiredArray(record.differences).map(normalizeDifference);
  assertUnique(differences.map((difference) => difference.id), "合同文档差异");
  return {
    id: requiredId(record.id, "合同文档比较"),
    status: processStatus(record.status),
    errorMessage: optionalText(record.errorMessage),
    completedAt: optionalText(record.completedAt),
    differences
  };
}

function normalizeDifference(value: unknown): ContractDocumentDifferenceReadModel {
  const record = safeRecord(value);
  if (!["insert", "delete", "replace"].includes(String(record.changeType))) malformed();
  if (!["pending", "confirmed", "rejected", "no_material_change"].includes(String(record.disposition))) {
    malformed();
  }
  if (!Number.isInteger(record.sortOrder) || Number(record.sortOrder) <= 0) malformed();
  return {
    id: requiredId(record.id, "合同文档差异"),
    sortOrder: Number(record.sortOrder),
    changeType: record.changeType as ContractDocumentDifferenceReadModel["changeType"],
    kind: requiredText(record.kind),
    locationPath: requiredText(record.locationPath),
    beforeText: optionalText(record.beforeText),
    afterText: optionalText(record.afterText),
    candidate: record.candidate === null ? null : normalizeCandidate(record.candidate),
    disposition: record.disposition as ContractDocumentDifferenceReadModel["disposition"],
    dispositionReason: optionalText(record.dispositionReason),
    disposedAt: optionalText(record.disposedAt)
  };
}

function normalizeCandidate(value: unknown): ContractDifferenceCandidate {
  const record = safeRecord(value);
  if (record.kind === "amount") {
    return { kind: "amount", label: requiredText(record.label), cents: requiredText(record.cents) };
  }
  if (record.kind === "date") {
    return { kind: "date", label: requiredText(record.label), isoDate: requiredText(record.isoDate) };
  }
  if (record.kind === "key_clause") {
    return {
      kind: "key_clause",
      title: requiredText(record.title),
      proposedText: requiredText(record.proposedText)
    };
  }
  return malformed();
}

function processStatus(value: unknown): ContractNegotiationProcessStatus {
  if (typeof value !== "string" || !processStatuses.has(value as ContractNegotiationProcessStatus)) {
    return malformed();
  }
  return value as ContractNegotiationProcessStatus;
}

function safeRecord(value: unknown) {
  const record = asRecord(value);
  if (!Object.keys(record).length || Object.keys(record).some((key) => forbiddenReadKeys.has(key))) {
    return malformed();
  }
  return record;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) return malformed();
  return value;
}

function requiredText(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return malformed();
  return value;
}

function optionalText(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return malformed();
  return value.trim() ? value : null;
}

function requiredId(value: unknown, label: string) {
  const id = requiredText(value);
  if (id !== id.trim()) throw new Error(`${label}编号格式不正确，请刷新后重试。`);
  return id;
}

function assertUnique(values: string[], label: string) {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label}存在重复记录，请刷新后重试。`);
  }
}

function malformed(): never {
  throw new Error("合同磋商记录格式不正确，请刷新后重试。");
}
