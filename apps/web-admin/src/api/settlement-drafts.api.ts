import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";
import type { SettlementLineDraftPayload } from "./settlement-workbench.api";

export interface SaveSettlementDraftPayload {
  contractVersionId: string;
  settlementTemplateVersionId: string;
  code: string;
  periodLabel: string;
  isFinal?: boolean;
  finalCumulativeAmountCents?: string;
  settlementLines: SettlementLineDraftPayload[];
  expectedRevision?: number;
}

export interface SettlementDraftReadModel {
  id: string;
  projectId: string;
  contractId: string;
  contractVersionId: string;
  paymentTermsVersionId: string;
  settlementTemplateVersionId: string | null;
  code: string;
  periodLabel: string;
  isFinal: boolean;
  finalCumulativeAmountCents: string | null;
  lines: SettlementLineDraftPayload[];
  revision: number;
  status: "draft" | "submitted";
  ownerUserId: string;
  submittedSettlementId: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubmittedSettlementReadModel {
  id: string;
  code: string;
}

export function createSettlementDraftRecord(
  projectId: string,
  body: SaveSettlementDraftPayload
) {
  return requestDraft<SettlementDraftReadModel>(draftCollectionPath(projectId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }, "保存结算草稿失败");
}

export function listSettlementDraftRecords(projectId: string) {
  return requestDraft<SettlementDraftReadModel[]>(
    draftCollectionPath(projectId),
    { method: "GET" },
    "读取结算草稿失败"
  );
}

export function fetchSettlementDraftRecord(projectId: string, draftId: string) {
  return requestDraft<SettlementDraftReadModel>(
    draftItemPath(projectId, draftId),
    { method: "GET" },
    "读取结算草稿失败"
  );
}

export function updateSettlementDraftRecord(
  projectId: string,
  draftId: string,
  body: SaveSettlementDraftPayload & { expectedRevision: number }
) {
  return requestDraft<SettlementDraftReadModel>(draftItemPath(projectId, draftId), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }, "更新结算草稿失败");
}

export function submitSettlementDraftRecord(
  projectId: string,
  draftId: string,
  expectedRevision: number
) {
  return requestDraft<SubmittedSettlementReadModel>(
    `${draftItemPath(projectId, draftId)}/approval-submission`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedRevision })
    },
    "提交结算审批失败"
  );
}

async function requestDraft<T>(
  path: string,
  init: RequestInit,
  fallback: string
): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    let message = `${fallback}：${response.status}`;
    try {
      const data = (await response.clone().json()) as { message?: unknown };
      const detail = Array.isArray(data.message)
        ? data.message.filter((item): item is string => typeof item === "string").join("；")
        : typeof data.message === "string"
          ? data.message
          : "";
      message = formatApiErrorMessage(detail, response.status, fallback);
    } catch {
      // 非 JSON 响应保留中文状态码兜底。
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function draftCollectionPath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}/settlement-drafts`;
}

function draftItemPath(projectId: string, draftId: string) {
  return `${draftCollectionPath(projectId)}/${encodeURIComponent(draftId)}`;
}
