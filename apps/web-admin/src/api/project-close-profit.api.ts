import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export type ProjectCloseStageStatus =
  | "pending"
  | "ready"
  | "completed"
  | "needs_reconfirmation";

export type ProjectCloseAction =
  | "complete"
  | "attest_contract_cost"
  | "attest_finance_cost"
  | "create_temporary_distribution"
  | "submit_final_profit"
  | "confirm_final_profit"
  | "submit_distribution"
  | "confirm_distribution";

export interface ProjectCloseStageReadModel {
  key: string;
  label: string;
  status: ProjectCloseStageStatus;
  responsibility: string;
  blockedReason: string | null;
  currentVersion: null | {
    id: string;
    revision: number;
    status: string;
    projectionFingerprint: string;
    confirmedAt: string;
    basisSnapshot: unknown;
  };
  availableActions: ProjectCloseAction[];
}

export interface ProjectCloseDistributionLineReadModel {
  id: string;
  projectParticipatingCompanyId: string;
  companyEntityId: string;
  companyName: string;
  finalShareCents: string;
  temporaryDistributedCents: string;
  existingFundsAppliedCents: string;
  actualTransferCents: string;
  toReceiveCents: string;
  toReturnCents: string;
  additionalBearingCents: string;
  profitAuthorizationId: string | null;
}

export interface ProjectCloseDistributionReadModel {
  id: string;
  revision: number;
  totalProfitCents: string;
  projectionFingerprint: string;
  confirmedByUserId: string;
  confirmedAt: string;
  lines: ProjectCloseDistributionLineReadModel[];
}

export interface ProjectTemporaryDistributionReadModel {
  id: string;
  projectParticipatingCompanyId: string;
  companyEntityId: string;
  companyName: string;
  amountCents: string;
  projectionFingerprint: string;
  createdByUserId: string;
  createdAt: string;
}

export interface ProjectCloseImpactReadModel {
  id: string;
  reason: string;
  affectedStageKeys: string[];
  occurredAt: string;
}

export interface ProjectCloseDecisionSubmissionReadModel {
  id: string;
  decisionKind: "final_profit" | "distribution";
  revision: number;
  projectionFingerprint: string;
  proposalSnapshot: {
    finalProfitCents?: string;
    lines?: Array<{ projectParticipatingCompanyId: string; finalShareCents: string }>;
  };
  basisSnapshot: unknown;
  preparedAt: string;
  submittedAt: string;
}

export interface ProjectCloseProfitWorkbenchReadModel {
  schema: "project_close_profit/V1";
  projectId: string;
  canReconcileImpacts: boolean;
  availableActions: ProjectCloseAction[];
  projection: {
    readAt: string;
    cutoffAt: string;
    fingerprint: string;
    view: {
      integrity: { statusLabel: string; moneyComplete: boolean; notices: string[] };
      operating: Record<string, string>;
      actualFunds: Record<string, string>;
      restrictions: Record<string, string | null>;
      profitAndLoss: Record<string, string | boolean | null>;
      distribution: Record<string, string | null>;
      evidence: Record<string, unknown>;
    };
  };
  stages: ProjectCloseStageReadModel[];
  currentProfitConfirmation: null | {
    id: string;
    revision: number;
    finalProfitCents: string;
    confirmedAt: string;
  };
  currentDistribution: ProjectCloseDistributionReadModel | null;
  currentDecisionSubmissions?: {
    finalProfit: ProjectCloseDecisionSubmissionReadModel | null;
    distribution: ProjectCloseDecisionSubmissionReadModel | null;
  };
  temporaryDistributions?: ProjectTemporaryDistributionReadModel[];
  impacts?: ProjectCloseImpactReadModel[];
  participatingCompanies: Array<{
    id: string;
    companyEntityId: string;
    companyEntityVersionId: string;
    companyName: string;
  }>;
  downstreamCostAttestations: Array<{
    id: string;
    specialty: "contract" | "finance";
    revision: number;
    projectionFingerprint: string;
    attestedAt: string;
    attestedByUserId?: string;
    basisSnapshot?: unknown;
  }>;
  history: {
    stageVersions: Array<NonNullable<ProjectCloseStageReadModel["currentVersion"]> & {
      stageKey: string;
      confirmedByUserId: string;
    }>;
    profitConfirmations: Array<{
      id: string;
      revision: number;
      finalProfitCents: string;
      confirmedByUserId: string;
      confirmedAt: string;
      basisSnapshot: unknown;
    }>;
    distributions: ProjectCloseDistributionReadModel[];
    decisionSubmissions?: ProjectCloseDecisionSubmissionReadModel[];
  };
}

export interface ProjectCloseCommandBody {
  expectedProjectionFingerprint: string;
  idempotencyKey: string;
  basis: { summary: string; evidenceFileIds: string[] };
}

export interface ProjectCloseConfirmationBody {
  expectedProjectionFingerprint: string;
  idempotencyKey: string;
  submissionId: string;
}

export class ProjectCloseProfitApiError extends Error {
  readonly name = "ProjectCloseProfitApiError";

  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function fetchProjectCloseProfitWorkbench(projectId: string) {
  return read<ProjectCloseProfitWorkbenchReadModel>(path(projectId), "读取项目收口与盈亏失败");
}

export function reconcileProjectCloseImpacts(
  projectId: string,
  body: ProjectCloseCommandBody
) {
  return post(`${path(projectId)}/impacts/reconcile`, body, "同步项目收口影响失败");
}

export function completeProjectCloseStage(
  projectId: string,
  stageKey: string,
  body: ProjectCloseCommandBody
) {
  return post(
    `${path(projectId)}/stages/${encodeURIComponent(stageKey)}/complete`,
    body,
    "完成项目收口阶段失败"
  );
}

export function attestProjectDownstreamContractCost(
  projectId: string,
  body: ProjectCloseCommandBody
) {
  return post(
    `/projects/${encodeURIComponent(projectId)}/close-profit/downstream-cost/attestations/contract`,
    body,
    "确认下游成本失败"
  );
}

export function attestProjectDownstreamFinanceCost(
  projectId: string,
  body: ProjectCloseCommandBody
) {
  return post(
    `${path(projectId)}/downstream-cost/attestations/finance`,
    body,
    "确认下游成本失败"
  );
}

export function confirmProjectFinalProfit(
  projectId: string,
  body: ProjectCloseConfirmationBody
) {
  return post(`${path(projectId)}/final-profit/confirm`, body, "确认项目最终盈亏失败");
}

export function submitProjectFinalProfit(
  projectId: string,
  body: ProjectCloseCommandBody
) {
  return post(`${path(projectId)}/final-profit/submissions`, body, "提交项目最终盈亏失败");
}

export function postTemporaryProfitDistribution(
  projectId: string,
  body: ProjectCloseCommandBody & {
    projectParticipatingCompanyId: string;
    amountCents: string;
  }
) {
  return post(`${path(projectId)}/temporary-distributions`, body, "登记暂分利润失败");
}

export function confirmProjectProfitDistribution(
  projectId: string,
  body: ProjectCloseConfirmationBody
) {
  return post(`${path(projectId)}/distributions/confirm`, body, "确认项目盈亏分配失败");
}

export function submitProjectProfitDistribution(
  projectId: string,
  body: ProjectCloseCommandBody & {
    lines: Array<{ projectParticipatingCompanyId: string; finalShareCents: string }>;
  }
) {
  return post(`${path(projectId)}/distributions/submissions`, body, "提交项目盈亏分配失败");
}

function path(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}/close-profit`;
}

async function read<T>(requestPath: string, fallback: string): Promise<T> {
  const response = await apiFetch(requestPath);
  if (response.ok) return response.json() as Promise<T>;
  throw await responseError(response, fallback);
}

async function post<T = Record<string, unknown>>(
  requestPath: string,
  body: unknown,
  fallback: string
): Promise<T> {
  const response = await apiFetch(requestPath, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (response.ok) return response.json() as Promise<T>;
  throw await responseError(response, fallback);
}

async function responseError(response: Response, fallback: string) {
  let message = `${fallback}：${response.status}`;
  try {
    const payload = await response.clone().json() as { message?: unknown };
    const detail = typeof payload.message === "string"
      ? payload.message
      : Array.isArray(payload.message)
        ? payload.message.join("；")
        : message;
    message = formatApiErrorMessage(detail, response.status, fallback);
  } catch {
    message = formatApiErrorMessage(message, response.status, fallback);
  }
  return new ProjectCloseProfitApiError(message, response.status);
}
