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

export interface ProjectFinancingQuotaRequestCapabilityReadModel {
  project: {
    id: string;
  };
  requestAction: ProjectFinancingQuotaActionReadModel;
}

export interface ProjectFinancingQuotaRequestForm {
  amountYuan: string;
  reason: string;
  validUntil: string;
}

export interface ProjectFinancingQuotaRequestReceipt {
  kind: "created" | "replayed";
  idempotencyKey: string;
  projectId: string;
  quotaId: string;
}

export interface ProjectFinancingQuotaRequestResult {
  receipt: ProjectFinancingQuotaRequestReceipt;
  workbench: ProjectFinancingQuotaWorkbenchReadModel;
}

export interface ProjectFinancingQuotaRequestWithUploadInput<TContext> {
  form: ProjectFinancingQuotaRequestForm;
  files: Array<{
    raw?: Blob & { name?: string };
  }>;
  idempotencyKey: string;
  context: TContext;
  isCurrent: (context: TContext) => boolean;
}

export interface ProjectFinancingQuotaRequestSubmission {
  projectId: string;
  amountCents: string;
  reason: string;
  validUntil?: string;
  idempotencyKey: string;
  file: Blob;
  fileName: string;
  isCurrent: () => boolean;
}

export interface ProjectFinancingQuotaRequestAttemptState {
  submission: ProjectFinancingQuotaRequestSubmission | null;
  uploadedFileId: string | null;
  uploadPromise: Promise<ProjectFinancingQuotaAttachmentUploadReceipt> | null;
  requestPromise: Promise<ProjectFinancingQuotaRequestResult> | null;
  businessReceipt: ProjectFinancingQuotaRequestReceipt | null;
}

interface ProjectFinancingQuotaAttachmentUploadReceipt {
  id: string;
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

function invalidRequestResponse(): ProjectFinancingQuotaApiError {
  return new ProjectFinancingQuotaApiError(
    "项目垫资额度申请回执与本次请求不一致，请刷新后核对",
    502,
    "PROJECT_FINANCING_QUOTA_INVALID_REQUEST_RESPONSE"
  );
}

async function responseError(
  response: Response,
  fallback: string
): Promise<ProjectFinancingQuotaApiError> {
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
  return new ProjectFinancingQuotaApiError(message, response.status, code);
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
  throw await responseError(response, "读取项目垫资额度失败");
}

export async function fetchProjectFinancingQuotaRequestCapability(
  projectId: string
): Promise<ProjectFinancingQuotaRequestCapabilityReadModel> {
  const response = await apiFetch(
    `/projects/${encodeURIComponent(projectId)}/financing-quotas`
  );
  if (!response.ok) {
    throw await responseError(response, "读取项目垫资额度申请资格失败");
  }
  return response.json() as Promise<ProjectFinancingQuotaRequestCapabilityReadModel>;
}

export function createProjectFinancingQuotaRequestAttemptState(): ProjectFinancingQuotaRequestAttemptState {
  return {
    submission: null,
    uploadedFileId: null,
    uploadPromise: null,
    requestPromise: null,
    businessReceipt: null
  };
}

export function requestProjectFinancingQuotaWithUpload<TContext>(
  projectId: string,
  input: ProjectFinancingQuotaRequestWithUploadInput<TContext>,
  state: ProjectFinancingQuotaRequestAttemptState
): Promise<ProjectFinancingQuotaRequestResult> {
  if (state.requestPromise) return state.requestPromise;

  let submission: ProjectFinancingQuotaRequestSubmission;
  try {
    submission =
      state.submission ?? normalizeRequestSubmission(projectId, input);
    if (submission.projectId !== projectId) {
      throw new Error("项目垫资额度申请项目已变化，请重新打开申请窗口");
    }
    state.submission = submission;
  } catch (error) {
    return Promise.reject(error);
  }

  const request = executeProjectFinancingQuotaRequest(submission, state);
  state.requestPromise = request;
  void request.catch(() => {
    if (state.requestPromise === request) {
      state.requestPromise = null;
    }
  });
  return request;
}

function normalizeRequestSubmission<TContext>(
  projectId: string,
  input: ProjectFinancingQuotaRequestWithUploadInput<TContext>
): ProjectFinancingQuotaRequestSubmission {
  if (!input.isCurrent(input.context)) {
    throw new Error("项目垫资额度申请上下文已失效，请重新读取当前项目");
  }
  const normalizedProjectId = requiredText(projectId, "当前项目");
  const reason = requiredText(input.form.reason, "申请事由");
  let amountCents: string;
  try {
    amountCents = financingQuotaYuanToCents(input.form.amountYuan.trim());
  } catch {
    throw new Error("申请金额必须是大于 0 的数字，最多保留两位小数");
  }
  if (amountCents === "0") {
    throw new Error("申请金额必须大于 0");
  }
  const validUntil = input.form.validUntil.trim();
  if (validUntil && !/^\d{4}-\d{2}-\d{2}$/u.test(validUntil)) {
    throw new Error("有效期格式异常，请重新选择");
  }
  const idempotencyKey = requiredText(input.idempotencyKey, "申请幂等键");
  if (!isUuidV4(idempotencyKey)) {
    throw new Error("申请幂等键格式异常，请重新打开申请窗口");
  }
  const file = input.files[0]?.raw;
  if (!(file instanceof Blob)) {
    throw new Error("请上传一份垫资额度申请依据");
  }
  const fileName = requiredText(file.name ?? "", "申请依据文件名");

  return {
    projectId: normalizedProjectId,
    amountCents,
    reason,
    ...(validUntil ? { validUntil } : {}),
    idempotencyKey,
    file,
    fileName,
    isCurrent: () => input.isCurrent(input.context)
  };
}

async function executeProjectFinancingQuotaRequest(
  submission: ProjectFinancingQuotaRequestSubmission,
  state: ProjectFinancingQuotaRequestAttemptState
): Promise<ProjectFinancingQuotaRequestResult> {
  if (state.businessReceipt) {
    return refreshRequestedQuota(submission, state.businessReceipt);
  }

  await verifyRequestAction(submission);
  let fileId = state.uploadedFileId;
  if (fileId === null) {
    const upload =
      state.uploadPromise ??
      uploadProjectFinancingQuotaAttachment(
        submission.file,
        submission.fileName,
        submission.idempotencyKey
      );
    state.uploadPromise = upload;
    try {
      const uploaded = await upload;
      if (uploaded.id !== submission.idempotencyKey) {
        throw new Error("文件上传幂等回执不一致，请重新打开申请窗口");
      }
      fileId = uploaded.id;
      state.uploadedFileId = uploaded.id;
    } catch (error) {
      if (state.uploadPromise === upload) {
        state.uploadPromise = null;
      }
      throw error;
    }
  }

  assertRequestCurrent(submission);
  await verifyRequestAction(submission);
  assertRequestCurrent(submission);
  const receipt = await postProjectFinancingQuotaRequest(submission, fileId);
  state.businessReceipt = receipt;
  assertRequestCurrent(submission);
  return refreshRequestedQuota(submission, receipt);
}

async function verifyRequestAction(
  submission: ProjectFinancingQuotaRequestSubmission
) {
  assertRequestCurrent(submission);
  const current = await fetchProjectFinancingQuotaWorkbench(submission.projectId);
  assertRequestCurrent(submission);
  if (!requestActionEnabled(current.requestAction)) {
    throw new Error("项目垫资额度申请资格已变化，请刷新台账后重试");
  }
}

async function postProjectFinancingQuotaRequest(
  submission: ProjectFinancingQuotaRequestSubmission,
  attachmentFileId: string
): Promise<ProjectFinancingQuotaRequestReceipt> {
  const response = await apiFetch(
    `/projects/${encodeURIComponent(submission.projectId)}/financing-quotas`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amountCents: submission.amountCents,
        reason: submission.reason,
        ...(submission.validUntil ? { validUntil: submission.validUntil } : {}),
        attachmentFileId,
        idempotencyKey: submission.idempotencyKey
      })
    }
  );
  if (!response.ok) {
    throw await responseError(response, "提交项目垫资额度申请失败");
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw invalidRequestResponse();
  }
  if (!isRequestReceipt(data, submission)) {
    throw invalidRequestResponse();
  }
  return data;
}

async function uploadProjectFinancingQuotaAttachment(
  file: Blob,
  fileName: string,
  idempotencyKey: string
): Promise<ProjectFinancingQuotaAttachmentUploadReceipt> {
  const form = new FormData();
  form.append("file", file, fileName);
  form.append("idempotencyKey", idempotencyKey);
  const response = await apiFetch("/files", {
    method: "POST",
    body: form
  });
  if (!response.ok) {
    throw await responseError(response, "上传项目垫资额度申请依据失败");
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw invalidUploadResponse();
  }
  if (!isRecord(data) || typeof data.id !== "string" || !data.id.trim()) {
    throw invalidUploadResponse();
  }
  return { id: data.id };
}

function invalidUploadResponse() {
  return new ProjectFinancingQuotaApiError(
    "项目垫资额度申请依据上传回执异常，请重新打开申请窗口",
    502,
    "PROJECT_FINANCING_QUOTA_INVALID_UPLOAD_RESPONSE"
  );
}

async function refreshRequestedQuota(
  submission: ProjectFinancingQuotaRequestSubmission,
  receipt: ProjectFinancingQuotaRequestReceipt
): Promise<ProjectFinancingQuotaRequestResult> {
  assertRequestCurrent(submission);
  const workbench = await fetchProjectFinancingQuotaWorkbench(submission.projectId);
  assertRequestCurrent(submission);
  if (!workbench.rows.some((row) => row.id === receipt.quotaId)) {
    throw new ProjectFinancingQuotaApiError(
      "项目垫资额度权威台账未包含本次申请，请刷新后核对",
      502,
      "PROJECT_FINANCING_QUOTA_REQUEST_NOT_AUTHORITATIVE"
    );
  }
  return { receipt, workbench };
}

function isRequestReceipt(
  value: unknown,
  submission: ProjectFinancingQuotaRequestSubmission
): value is ProjectFinancingQuotaRequestReceipt {
  if (!isRecord(value)) return false;
  return (
    (value.kind === "created" || value.kind === "replayed") &&
    value.idempotencyKey === submission.idempotencyKey &&
    value.projectId === submission.projectId &&
    typeof value.quotaId === "string" &&
    Boolean(value.quotaId.trim())
  );
}

export function requestActionEnabled(
  action: ProjectFinancingQuotaActionReadModel
) {
  return (
    action.key === "request_financing_quota" &&
    action.enabled &&
    action.requiresFile === true &&
    action.requiredAction === "project.financing_quota.request"
  );
}

function assertRequestCurrent(
  submission: ProjectFinancingQuotaRequestSubmission
) {
  if (!submission.isCurrent()) {
    throw new Error("项目垫资额度申请上下文已失效，请重新读取当前项目");
  }
}

function requiredText(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`请填写${label}`);
  return normalized;
}

function isUuidV4(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function financingQuotaYuanToCents(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(value);
  if (!match) throw new Error("申请金额格式异常");
  const yuan = match[1]!.replace(/^0+(?=\d)/u, "");
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return `${yuan}${fraction}`.replace(/^0+(?=\d)/u, "");
}
