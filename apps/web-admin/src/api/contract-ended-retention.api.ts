import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export interface ContractEndedApplicationRetentionHoldInput {
  reason: string;
}

export interface ContractEndedApplicationRetentionRecord {
  contractVersionId: string;
  contractId: string;
  projectId: string;
  contractCode: string;
  contractName: string;
  counterparty: string;
  terminalStatus: "abandoned" | "approval_rejected";
  terminalAt: string;
  retentionEndsAt: string;
  releaseBufferUntil: string | null;
  purgeEligibleAt: string;
  remainingDays: number;
  activeHold: {
    id: string;
    reason: string;
    createdAt: string;
    createdByUserId: string;
  } | null;
}

export interface ContractEndedApplicationRetentionPreview {
  generatedAt: string;
  mode: "preview_only";
  executionAllowed: false;
  canManageRetention: true;
  retention: {
    calendarMonths: number;
    previewWindowDays: number;
  };
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  candidates: ContractEndedApplicationRetentionRecord[];
  heldRecords: ContractEndedApplicationRetentionRecord[];
  notice: string;
}

export function fetchContractEndedApplicationRetentionPreview(page = 1, limit = 50) {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) });
  return readJson<ContractEndedApplicationRetentionPreview>(
    `/contract-ended-retention/preview?${query.toString()}`
  );
}

export function createContractEndedApplicationRetentionHold(
  contractVersionId: string,
  body: ContractEndedApplicationRetentionHoldInput
) {
  return postJson(
    `/contract-ended-retention/${encodeURIComponent(contractVersionId)}/holds`,
    body
  );
}

export function releaseContractEndedApplicationRetentionHold(
  contractVersionId: string,
  body: ContractEndedApplicationRetentionHoldInput
) {
  return postJson(
    `/contract-ended-retention/${encodeURIComponent(contractVersionId)}/hold-release`,
    body
  );
}

async function readJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  await ensureOk(response, "读取结束申请保留预览失败");
  return response.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  await ensureOk(response, "保存结束申请保留标记失败");
  return response.json() as Promise<T>;
}

async function ensureOk(response: Response, fallback: string) {
  if (response.ok) return;
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
    // 非 JSON 错误响应保留中文状态码兜底。
  }
  throw new Error(message);
}
