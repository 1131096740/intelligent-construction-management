import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export type ClearingEventKind =
  | "estimated"
  | "withheld"
  | "pending_reconciliation"
  | "final_confirmed"
  | "supplemental"
  | "returned";

export interface ClearingCapabilities {
  availableActions: string[];
  read: boolean;
  prepare: boolean;
  submit: boolean;
  attest: boolean;
  confirm: boolean;
  return: boolean;
  reopen: boolean;
}

export interface ClearingVersionReadModel {
  id: string;
  versionNo: number;
  workflowStatus: string;
  amountCents: string;
  evidenceLevel: "A" | "B";
  payableRef: string | null;
  payloadSnapshot: Record<string, unknown>;
  createdAt: string;
  confirmation?: { confirmedAt: string; confirmedByUserId: string } | null;
  attestation?: { attestedAt: string; attestedByUserId: string } | null;
  allocations?: Array<{
    id: string;
    sourceEventVersionId: string | null;
    sourceKind: string;
    amountCents: string;
    sourceRemainingAfterCents: string;
  }>;
}

export interface ClearingEventReadModel {
  id: string;
  kind: ClearingEventKind;
  workflowStatus: string;
  revision: number;
  currentVersionNo: number;
  createdAt: string;
  versions: ClearingVersionReadModel[];
}

export interface ClearingCaseReadModel {
  id: string;
  projectId: string;
  constructionEnterpriseAssignmentId: string;
  category: string;
  governedSubjectKey: string;
  status: string;
  revision: number;
  authoritativeGrossCapCents: string;
  currencyCode: "CNY";
  updatedAt: string;
  events: ClearingEventReadModel[];
  authoritySnapshotRef?: string | null;
  sourceDiscriminator?: string | null;
  coverageKind?: string | null;
  periodStart?: string | null;
}

export interface AffiliateClearingAuthorityOption {
  selectionRef: string;
  optionKind: "contract" | "person" | "role" | "assigned_wage" | "guarantee" | "historical_takeover";
  label?: string;
  affiliateName?: string;
  constructionEnterpriseName?: string;
  coverageKind?: string;
  period?: string;
  grossCapCents?: string;
  evidenceLevel?: "A" | "B";
}

export interface ClearingAllocationOption {
  selectionRef: string;
  sourceKind: "withheld" | "final_confirmed" | "supplemental";
  amountCents: string;
  remainingCents: string;
  evidenceLevel: "A" | "B";
}

export interface ClearingCommandResult {
  id: string;
  versionId?: string;
  revision: number;
  workflowStatus?: string;
}

async function readResponse<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.clone().json()) as { message?: unknown };
      detail = Array.isArray(body.message)
        ? body.message.join("；")
        : typeof body.message === "string"
          ? body.message
          : "";
    } catch {
      detail = "";
    }
    throw new Error(formatApiErrorMessage(detail, response.status, fallback));
  }
  return response.json() as Promise<T>;
}

async function readJson<T>(path: string, fallback: string): Promise<T> {
  return readResponse<T>(await apiFetch(path), fallback);
}

async function postJson<T>(path: string, body: unknown, fallback: string): Promise<T> {
  return readResponse<T>(await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }), fallback);
}

async function patchJson<T>(path: string, body: unknown, fallback: string): Promise<T> {
  return readResponse<T>(await apiFetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  }), fallback);
}

export function fetchClearingCapabilities() {
  return readJson<ClearingCapabilities>("/clearing-cases/capabilities", "加载清分权限失败");
}

export function fetchAffiliateClearingAuthorityOptions(projectId?: string) {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return readJson<{ options: AffiliateClearingAuthorityOption[] }>(
    `/affiliate-clearing-authorities/options${query}`,
    "加载挂靠清算权威选项失败"
  );
}

export function fetchClearingAllocationOptions(caseId: string) {
  return readJson<{ options: ClearingAllocationOption[] }>(
    `/affiliate-clearing-authorities/allocation-options/${encodeURIComponent(caseId)}`,
    "加载清分分配选项失败"
  );
}

export function fetchClearingCases(projectId?: string) {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
  return readJson<ClearingCaseReadModel[]>(`/clearing-cases${query}`, "加载清分事项失败");
}

export function fetchClearingCase(caseId: string) {
  return readJson<ClearingCaseReadModel>(`/clearing-cases/${encodeURIComponent(caseId)}`, "加载清分详情失败");
}

export function createClearingCase(body: Record<string, unknown>) {
  return postJson<ClearingCaseReadModel>("/clearing-cases", body, "创建清分事项失败");
}

export function createClearingEvent(caseId: string, body: Record<string, unknown>) {
  return postJson<ClearingCommandResult>(
    `/clearing-cases/${encodeURIComponent(caseId)}/events`,
    body,
    "创建清分草稿失败"
  );
}

export function reviseClearingEvent(eventId: string, body: Record<string, unknown>) {
  return patchJson<ClearingCommandResult>(
    `/clearing-cases/events/${encodeURIComponent(eventId)}/draft`,
    body,
    "保存清分草稿失败"
  );
}

export function submitClearingEvent(eventId: string, body: Record<string, unknown>) {
  return command(eventId, "submit", body, "提交清分事件失败");
}

export function attestClearingEvent(eventId: string, body: Record<string, unknown>) {
  return command(eventId, "attest", body, "实名确认 B 级证据失败");
}

export function confirmClearingEvent(eventId: string, body: Record<string, unknown>) {
  return command(eventId, "confirm", body, "确认清分事件失败");
}

export function returnClearingEvent(eventId: string, body: Record<string, unknown>) {
  return command(eventId, "return", body, "退回清分事件失败");
}

export function reopenClearingEvent(eventId: string, body: Record<string, unknown>) {
  return command(eventId, "reopen", body, "重开清分事件失败");
}

function command(eventId: string, action: string, body: Record<string, unknown>, fallback: string) {
  return postJson<ClearingCommandResult>(
    `/clearing-cases/events/${encodeURIComponent(eventId)}/${action}`,
    body,
    fallback
  );
}
