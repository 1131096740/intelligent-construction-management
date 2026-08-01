import { apiFetch } from "./api-fetch";
import { formatApiErrorMessage } from "./error-message";

export type ProjectFinancingQuotaStatus =
  | "approval_pending"
  | "approved"
  | "rejected"
  | "terminated";

export interface ProjectFinancingQuotaActionReadModel {
  key: string;
  label: string;
  kind: string;
  enabled: boolean;
  disabledReason: string | null;
  requiredAction: string;
  requiresPassword?: boolean;
  requiresFile?: boolean;
  requiresSelfReviewConfirmation?: boolean;
}

export interface ProjectFinancingQuotaApprovalReadModel {
  status: string;
  currentNodeIndex: number;
  currentNodeName: string | null;
}

export interface ProjectFinancingQuotaUsageGroupReadModel {
  executionType: string;
  executionId: string;
  businessType: string;
  businessId: string;
  occurredAt: string;
  projectCashNetAmountCents: string;
  financingQuotaNetAmountCents: string;
  currentQuotaDebitAmountCents: string;
  currentQuotaCreditAmountCents: string;
  currentQuotaNetAmountCents: string;
}

export interface ProjectFinancingQuotaRowReadModel {
  id: string;
  amountCents: string;
  reason: string;
  validUntil: string | null;
  status: ProjectFinancingQuotaStatus;
  statusLabel: string;
  requestedByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  terminatedAt: string | null;
  terminatedByName: string | null;
  terminationReason: string | null;
  createdAt: string;
  updatedAt: string;
  isExpired: boolean;
  netUsedAmountCents: string;
  availableAmountCents: string;
  currentApproval: ProjectFinancingQuotaApprovalReadModel | null;
  lifecycleToken: string;
  reviewAction: ProjectFinancingQuotaActionReadModel;
  terminateAction: ProjectFinancingQuotaActionReadModel;
  usageGroups: ProjectFinancingQuotaUsageGroupReadModel[];
}

export interface ProjectFinancingQuotaWorkbenchReadModel {
  project: {
    id: string;
    code: string;
    name: string;
  };
  policy: {
    allocationOrder: Array<"project_cash" | "financing_quota">;
    userSelectable: false;
  };
  summary: {
    quotaAmountCents: string;
    netUsedAmountCents: string;
    currentlyAvailableAmountCents: string;
  };
  requestAction: ProjectFinancingQuotaActionReadModel;
  rows: ProjectFinancingQuotaRowReadModel[];
}

export class ProjectFinancingQuotaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null
  ) {
    super(message);
    this.name = "ProjectFinancingQuotaApiError";
  }
}

export interface ProjectOverviewRequestOwner {
  begin(): number;
  isCurrent(requestId: number): boolean;
  invalidate(): void;
}

export function createProjectOverviewRequestOwner(): ProjectOverviewRequestOwner {
  let currentRequestId = 0;
  return {
    begin() {
      currentRequestId += 1;
      return currentRequestId;
    },
    isCurrent(requestId) {
      return requestId === currentRequestId;
    },
    invalidate() {
      currentRequestId += 1;
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isMoneyText(value: unknown): value is string {
  return typeof value === "string" && /^-?\d+$/.test(value);
}

function isActionReadModel(
  value: unknown
): value is ProjectFinancingQuotaActionReadModel {
  if (!isRecord(value)) return false;
  return (
    typeof value.key === "string" &&
    typeof value.label === "string" &&
    typeof value.kind === "string" &&
    typeof value.enabled === "boolean" &&
    isStringOrNull(value.disabledReason) &&
    typeof value.requiredAction === "string" &&
    (value.requiresPassword === undefined ||
      typeof value.requiresPassword === "boolean") &&
    (value.requiresFile === undefined || typeof value.requiresFile === "boolean") &&
    (value.requiresSelfReviewConfirmation === undefined ||
      typeof value.requiresSelfReviewConfirmation === "boolean")
  );
}

function isApprovalReadModel(
  value: unknown
): value is ProjectFinancingQuotaApprovalReadModel {
  if (!isRecord(value)) return false;
  return (
    typeof value.status === "string" &&
    Number.isInteger(value.currentNodeIndex) &&
    Number(value.currentNodeIndex) >= 0 &&
    isStringOrNull(value.currentNodeName)
  );
}

function isUsageGroupReadModel(
  value: unknown
): value is ProjectFinancingQuotaUsageGroupReadModel {
  if (!isRecord(value)) return false;
  return (
    typeof value.executionType === "string" &&
    typeof value.executionId === "string" &&
    typeof value.businessType === "string" &&
    typeof value.businessId === "string" &&
    typeof value.occurredAt === "string" &&
    isMoneyText(value.projectCashNetAmountCents) &&
    isMoneyText(value.financingQuotaNetAmountCents) &&
    isMoneyText(value.currentQuotaDebitAmountCents) &&
    isMoneyText(value.currentQuotaCreditAmountCents) &&
    isMoneyText(value.currentQuotaNetAmountCents)
  );
}

function isQuotaStatus(value: unknown): value is ProjectFinancingQuotaStatus {
  return (
    value === "approval_pending" ||
    value === "approved" ||
    value === "rejected" ||
    value === "terminated"
  );
}

function isQuotaRowReadModel(
  value: unknown
): value is ProjectFinancingQuotaRowReadModel {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    isMoneyText(value.amountCents) &&
    typeof value.reason === "string" &&
    isStringOrNull(value.validUntil) &&
    isQuotaStatus(value.status) &&
    typeof value.statusLabel === "string" &&
    isStringOrNull(value.requestedByName) &&
    isStringOrNull(value.approvedByName) &&
    isStringOrNull(value.approvedAt) &&
    isStringOrNull(value.terminatedAt) &&
    isStringOrNull(value.terminatedByName) &&
    isStringOrNull(value.terminationReason) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    typeof value.isExpired === "boolean" &&
    isMoneyText(value.netUsedAmountCents) &&
    isMoneyText(value.availableAmountCents) &&
    (value.currentApproval === null || isApprovalReadModel(value.currentApproval)) &&
    typeof value.lifecycleToken === "string" &&
    isActionReadModel(value.reviewAction) &&
    isActionReadModel(value.terminateAction) &&
    Array.isArray(value.usageGroups) &&
    value.usageGroups.every(isUsageGroupReadModel)
  );
}

function isWorkbenchReadModel(
  value: unknown,
  expectedProjectId: string
): value is ProjectFinancingQuotaWorkbenchReadModel {
  if (!isRecord(value)) return false;
  const { project, policy, summary } = value;
  return (
    isRecord(project) &&
    project.id === expectedProjectId &&
    typeof project.code === "string" &&
    typeof project.name === "string" &&
    isRecord(policy) &&
    Array.isArray(policy.allocationOrder) &&
    policy.allocationOrder.length === 2 &&
    policy.allocationOrder[0] === "project_cash" &&
    policy.allocationOrder[1] === "financing_quota" &&
    policy.userSelectable === false &&
    isRecord(summary) &&
    isMoneyText(summary.quotaAmountCents) &&
    isMoneyText(summary.netUsedAmountCents) &&
    isMoneyText(summary.currentlyAvailableAmountCents) &&
    isActionReadModel(value.requestAction) &&
    Array.isArray(value.rows) &&
    value.rows.every(isQuotaRowReadModel)
  );
}

function invalidWorkbenchResponse(): ProjectFinancingQuotaApiError {
  return new ProjectFinancingQuotaApiError(
    "项目垫资额度数据格式异常，请刷新后重试",
    502,
    "PROJECT_FINANCING_QUOTA_INVALID_RESPONSE"
  );
}

export async function fetchProjectFinancingQuotaWorkbench(
  projectId: string
): Promise<ProjectFinancingQuotaWorkbenchReadModel> {
  const response = await apiFetch(
    `/projects/${encodeURIComponent(projectId)}/financing-quotas`
  );
  if (response.ok) {
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw invalidWorkbenchResponse();
    }
    if (!isWorkbenchReadModel(data, projectId)) {
      throw invalidWorkbenchResponse();
    }
    return data;
  }

  const fallback = "读取项目垫资额度失败";
  let message = `${fallback}：${response.status}`;
  let code: string | null = null;
  try {
    const data = (await response.clone().json()) as {
      code?: unknown;
      message?: unknown;
    };
    if (typeof data.code === "string") {
      code = data.code;
    }
    const detail = Array.isArray(data.message)
      ? data.message.filter((item): item is string => typeof item === "string").join("；")
      : typeof data.message === "string"
        ? data.message
        : message;
    message = formatApiErrorMessage(detail, response.status, fallback);
  } catch {
    message = formatApiErrorMessage(message, response.status, fallback);
  }
  throw new ProjectFinancingQuotaApiError(message, response.status, code);
}
