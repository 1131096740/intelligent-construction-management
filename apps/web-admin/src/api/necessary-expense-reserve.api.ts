import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export interface NecessaryExpenseReserveCapabilities {
  read: boolean;
  prepare: boolean;
  submit: boolean;
  attest: boolean;
  confirm: boolean;
  return: boolean;
}

export interface NecessaryExpenseReserveEntryReadModel {
  id: string;
  reserveId: string;
  sequenceNo: number;
  revision: number;
  entryKind: "establish" | "increase" | "release" | "technical_reversal";
  adjustsEntryId: string | null;
  amountCents: string;
  occurredAt: string;
  reason: string;
  evidenceLevel: "A" | "B";
  evidenceFileId: string;
  evidenceSha256: string;
  status: "draft" | "submitted" | "attested" | "confirmed" | "returned";
  fingerprint: string;
  preparedByUserId: string;
  submittedByUserId: string | null;
  attestedByUserId: string | null;
  confirmedByUserId: string | null;
  confirmedAt: string | null;
  returnReason: string | null;
  replacements: Array<{ operatingImpactEntryId: string; amountCents: string }>;
}

export interface NecessaryExpenseReserveReadModel {
  id: string;
  businessCode: string;
  reasonKind: string;
  title: string;
  fundHolderKind: "construction_enterprise" | "participating_company";
  fundHolderId: string;
  basisKind: string;
  basisBusinessIdOrEvidenceSha256: string;
  basisSummary: string;
  entries: NecessaryExpenseReserveEntryReadModel[];
}

export interface NecessaryExpenseReserveWorkbenchReadModel {
  projectId: string;
  capabilities: NecessaryExpenseReserveCapabilities;
  reserves: NecessaryExpenseReserveReadModel[];
}

async function readResponse<T>(response: Response, fallback: string): Promise<T> {
  if (response.ok) return response.json() as Promise<T>;
  let detail = "";
  try {
    const body = (await response.clone().json()) as { message?: unknown };
    detail = Array.isArray(body.message)
      ? body.message.filter((item): item is string => typeof item === "string").join("；")
      : typeof body.message === "string"
        ? body.message
        : "";
  } catch {
    detail = "";
  }
  throw new Error(formatApiErrorMessage(detail, response.status, fallback));
}

async function read<T>(path: string, fallback: string): Promise<T> {
  return readResponse<T>(await apiFetch(path), fallback);
}

export function fetchNecessaryExpenseReserveWorkbench(
  projectId: string,
  reserveId?: string
) {
  const query = new URLSearchParams({ projectId });
  if (reserveId) query.set("reserveId", reserveId);
  return read<NecessaryExpenseReserveWorkbenchReadModel>(
    `/necessary-expense-reserves/workbench?${query.toString()}`,
    "加载必要费用准备工作台失败"
  );
}

export function fetchNecessaryExpenseReserveCapabilities(projectId: string) {
  const query = new URLSearchParams({ projectId });
  return read<NecessaryExpenseReserveCapabilities>(
    `/necessary-expense-reserves/capabilities?${query.toString()}`,
    "加载必要费用准备权限失败"
  );
}

export function saveNecessaryExpenseReserveDraft(body: Record<string, unknown>) {
  return apiFetch("/necessary-expense-reserves/drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then((response) => readResponse<NecessaryExpenseReserveEntryReadModel>(
    response,
    "保存必要费用准备草稿失败"
  ));
}

export function transitionNecessaryExpenseReserve(
  entryId: string,
  body: {
    action: "submit" | "attest" | "confirm" | "return";
    expectedRevision: number;
    expectedFingerprint: string;
    idempotencyKey: string;
    reason?: string;
  }
) {
  return apiFetch(
    `/necessary-expense-reserves/entries/${encodeURIComponent(entryId)}/transition`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  ).then((response) => readResponse<NecessaryExpenseReserveEntryReadModel>(
    response,
    "处理必要费用准备失败"
  ));
}
