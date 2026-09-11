import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export interface ProjectFundDisputeCapabilities {
  read: boolean;
  prepare: boolean;
  submit: boolean;
  attest: boolean;
  confirm: boolean;
  return: boolean;
}

export interface ProjectFundDisputeEntryReadModel {
  id: string;
  disputeId: string;
  sequenceNo: number;
  revision: number;
  entryKind: "establish" | "increase" | "release" | "technical_reversal";
  adjustsEntryId: string | null;
  amountCents: string;
  occurredAt: string;
  disputeSummary: string;
  resolutionBasisSummary: string | null;
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

export interface ProjectFundDisputeReadModel {
  id: string;
  businessCode: string;
  disputeKind: "upstream" | "downstream" | "inter_subject" | "external_restriction";
  counterpartyKind: string;
  counterpartyId: string;
  counterpartyNameSnapshot: string;
  fundHolderKind: "construction_enterprise" | "participating_company";
  fundHolderId: string;
  basisKind: string;
  basisBusinessIdOrEvidenceSha256: string;
  referenceCode: string;
  entries: ProjectFundDisputeEntryReadModel[];
}

export interface ProjectFundDisputeWorkbenchReadModel {
  projectId: string;
  capabilities: ProjectFundDisputeCapabilities;
  disputes: ProjectFundDisputeReadModel[];
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

export function fetchProjectFundDisputeWorkbench(
  projectId: string,
  disputeId?: string
) {
  const query = new URLSearchParams({ projectId });
  if (disputeId) query.set("disputeId", disputeId);
  return read<ProjectFundDisputeWorkbenchReadModel>(
    `/project-fund-disputes/workbench?${query.toString()}`,
    "加载一般争议资金工作台失败"
  );
}

export async function fetchProjectFundDisputeCapabilities(projectId: string) {
  return (await fetchProjectFundDisputeWorkbench(projectId)).capabilities;
}

export function saveProjectFundDisputeDraft(body: Record<string, unknown>) {
  return apiFetch("/project-fund-disputes/drafts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }).then((response) => readResponse<ProjectFundDisputeEntryReadModel>(
    response,
    "保存一般争议资金草稿失败"
  ));
}

export function transitionProjectFundDispute(
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
    `/project-fund-disputes/entries/${encodeURIComponent(entryId)}/transition`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  ).then((response) => readResponse<ProjectFundDisputeEntryReadModel>(
    response,
    "处理一般争议资金失败"
  ));
}
