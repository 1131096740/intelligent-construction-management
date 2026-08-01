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

export type ProjectFinancingQuotaReviewDecision = "approve" | "reject";

export interface ProjectFinancingQuotaReviewReceipt {
  kind: "applied" | "replayed";
  actionId: string;
  projectId: string;
  quotaId: string;
}

export interface ProjectFinancingQuotaReviewCapabilityReadModel {
  projectId: string;
  quotaId: string;
  status: ProjectFinancingQuotaStatus;
  lifecycleToken: string;
  reviewAction: ProjectFinancingQuotaActionReadModel;
}

export interface ProjectFinancingQuotaReviewResult {
  receipt: ProjectFinancingQuotaReviewReceipt;
  workbench: ProjectFinancingQuotaWorkbenchReadModel;
}

export interface ProjectFinancingQuotaReviewInput<TContext> {
  decision: ProjectFinancingQuotaReviewDecision;
  confirmationPassword: string;
  comment?: string;
  selfReviewReason?: string;
  requiresSelfReviewConfirmation: boolean;
  actionId: string;
  lifecycleToken: string;
  context: TContext;
  isCurrent: (context: TContext) => boolean;
}

export interface ProjectFinancingQuotaReviewSubmission {
  projectId: string;
  quotaId: string;
  decision: ProjectFinancingQuotaReviewDecision;
  confirmationPassword: string;
  comment?: string;
  selfReviewReason?: string;
  requiresSelfReviewConfirmation: boolean;
  actionId: string;
  lifecycleToken: string;
  isCurrent: () => boolean;
}

export interface ProjectFinancingQuotaReviewAttemptState {
  submission: ProjectFinancingQuotaReviewSubmission | null;
  reviewPromise: Promise<ProjectFinancingQuotaReviewResult> | null;
  preflightVerified: boolean;
  businessReceipt: ProjectFinancingQuotaReviewReceipt | null;
}

export interface ProjectFinancingQuotaReviewExecutionSubmission<TContext> {
  projectId: string;
  quotaId: string;
  confirmationPassword: string;
  comment?: string;
  selfReviewReason?: string;
  requiresSelfReviewConfirmation: boolean;
  actionId: string;
  lifecycleToken: string;
  context: TContext;
}

export type ProjectFinancingQuotaReviewExecutionResult<TContext> =
  | { status: "not_started" }
  | { status: "stale"; context: TContext }
  | {
      status: "completed";
      context: TContext;
      result: ProjectFinancingQuotaReviewResult;
    }
  | { status: "failed"; context: TContext };

export interface ProjectFinancingQuotaReviewExecutionState<TContext> {
  promise: Promise<ProjectFinancingQuotaReviewExecutionResult<TContext>> | null;
}

export interface ExecuteProjectFinancingQuotaReviewActionInput<TContext> {
  decision: ProjectFinancingQuotaReviewDecision;
  attemptState: ProjectFinancingQuotaReviewAttemptState;
  capture: (
    decision: ProjectFinancingQuotaReviewDecision
  ) => ProjectFinancingQuotaReviewExecutionSubmission<TContext> | null;
  current: (context: TContext) => boolean;
  complete: (
    context: TContext,
    result: ProjectFinancingQuotaReviewResult
  ) => void | Promise<void>;
  fail: (context: TContext, error: unknown) => void | Promise<void>;
  finish: (context: TContext) => void;
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
    isLifecycleToken(value.lifecycleToken) &&
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

function invalidRequestResponse(): ProjectFinancingQuotaApiError {
  return new ProjectFinancingQuotaApiError(
    "项目垫资额度申请回执与本次请求不一致，请刷新后核对",
    502,
    "PROJECT_FINANCING_QUOTA_INVALID_REQUEST_RESPONSE"
  );
}

function invalidReviewResponse(): ProjectFinancingQuotaApiError {
  return new ProjectFinancingQuotaApiError(
    "项目垫资额度审批回执与本次操作不一致，请刷新后核对",
    502,
    "PROJECT_FINANCING_QUOTA_INVALID_REVIEW_RESPONSE"
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
  return parseProjectFinancingQuotaWorkbenchResponse(
    response,
    projectId,
    "读取项目垫资额度失败"
  );
}

async function parseProjectFinancingQuotaWorkbenchResponse(
  response: Response,
  projectId: string,
  errorFallback: string
): Promise<ProjectFinancingQuotaWorkbenchReadModel> {
  if (!response.ok) {
    throw await responseError(response, errorFallback);
  }
  let data: unknown;
  try {
    data = JSON.parse(await response.clone().text()) as unknown;
  } catch {
    throw new ProjectFinancingQuotaApiError(
      "项目垫资额度数据格式异常，请刷新后重试",
      502,
      "PROJECT_FINANCING_QUOTA_INVALID_RESPONSE"
    );
  }
  if (!isWorkbenchReadModel(data, projectId)) {
    throw new ProjectFinancingQuotaApiError(
      "项目垫资额度数据格式异常，请刷新后重试",
      502,
      "PROJECT_FINANCING_QUOTA_INVALID_RESPONSE"
    );
  }
  return response.json() as Promise<ProjectFinancingQuotaWorkbenchReadModel>;
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

export function createProjectFinancingQuotaReviewAttemptState(): ProjectFinancingQuotaReviewAttemptState {
  return {
    submission: null,
    reviewPromise: null,
    preflightVerified: false,
    businessReceipt: null
  };
}

export function createProjectFinancingQuotaReviewExecutionState<TContext>(): ProjectFinancingQuotaReviewExecutionState<TContext> {
  return { promise: null };
}

export async function fetchProjectFinancingQuotaReviewCapability(
  projectId: string,
  quotaId: string
): Promise<ProjectFinancingQuotaReviewCapabilityReadModel> {
  const normalizedProjectId = requiredText(projectId, "当前项目");
  const normalizedQuotaId = requiredText(quotaId, "垫资额度");
  const response = await apiFetch(
    `/projects/${encodeURIComponent(normalizedProjectId)}/financing-quotas/${encodeURIComponent(normalizedQuotaId)}/review-capability`
  );
  if (!response.ok) {
    throw await responseError(response, "读取项目垫资额度审批资格失败");
  }
  let data: unknown;
  try {
    data = JSON.parse(await response.clone().text()) as unknown;
  } catch {
    throw new ProjectFinancingQuotaApiError(
      "项目垫资额度审批资格数据格式异常，请刷新后重试",
      502,
      "PROJECT_FINANCING_QUOTA_INVALID_REVIEW_CAPABILITY_RESPONSE"
    );
  }
  if (
    !isReviewCapabilityReadModel(
      data,
      normalizedProjectId,
      normalizedQuotaId
    )
  ) {
    throw new ProjectFinancingQuotaApiError(
      "项目垫资额度审批资格数据格式异常，请刷新后重试",
      502,
      "PROJECT_FINANCING_QUOTA_INVALID_REVIEW_CAPABILITY_RESPONSE"
    );
  }
  return response.json() as Promise<ProjectFinancingQuotaReviewCapabilityReadModel>;
}

function isReviewCapabilityReadModel(
  value: unknown,
  expectedProjectId: string,
  expectedQuotaId: string
): value is ProjectFinancingQuotaReviewCapabilityReadModel {
  if (!isRecord(value)) return false;
  const expectedKeys = [
    "lifecycleToken",
    "projectId",
    "quotaId",
    "reviewAction",
    "status"
  ];
  return (
    Object.keys(value).sort().join("|") === expectedKeys.join("|") &&
    value.projectId === expectedProjectId &&
    value.quotaId === expectedQuotaId &&
    isQuotaStatus(value.status) &&
    isLifecycleToken(value.lifecycleToken) &&
    isActionReadModel(value.reviewAction)
  );
}

function projectFinancingQuotaReviewRow(
  workbench: ProjectFinancingQuotaWorkbenchReadModel,
  quotaId: string
): ProjectFinancingQuotaRowReadModel {
  const rows = workbench.rows.filter((row) => row.id === quotaId);
  if (rows.length !== 1) {
    throw new ProjectFinancingQuotaApiError(
      "项目垫资额度审批对象已变化，请刷新台账后重试",
      409,
      "PROJECT_FINANCING_QUOTA_REVIEW_TARGET_CHANGED"
    );
  }
  return rows[0]!;
}

function reviewProjectFinancingQuotaWithPreflight<TContext>(
  projectId: string,
  quotaId: string,
  input: ProjectFinancingQuotaReviewInput<TContext>,
  state: ProjectFinancingQuotaReviewAttemptState
): Promise<ProjectFinancingQuotaReviewResult> {
  if (state.reviewPromise) return state.reviewPromise;

  let submission: ProjectFinancingQuotaReviewSubmission;
  try {
    submission =
      state.submission ?? normalizeReviewSubmission(projectId, quotaId, input);
    if (submission.projectId !== projectId || submission.quotaId !== quotaId) {
      throw new Error("项目垫资额度审批对象已变化，请重新打开确认窗口");
    }
    state.submission = submission;
  } catch (error) {
    return Promise.reject(error);
  }

  const review = executeProjectFinancingQuotaReview(submission, state);
  state.reviewPromise = review;
  void review.catch(() => {
    if (state.reviewPromise === review) {
      state.reviewPromise = null;
    }
  });
  return review;
}

export function executeProjectFinancingQuotaReviewAction<TContext>(
  input: ExecuteProjectFinancingQuotaReviewActionInput<TContext>,
  state: ProjectFinancingQuotaReviewExecutionState<TContext>
): Promise<ProjectFinancingQuotaReviewExecutionResult<TContext>> {
  if (state.promise) return state.promise;
  const submission = input.capture(input.decision);
  if (!submission) {
    return Promise.resolve({ status: "not_started" });
  }

  const execution = executeCapturedProjectFinancingQuotaReview(
    input,
    submission
  ).finally(() => {
    if (state.promise === execution) {
      state.promise = null;
    }
  });
  state.promise = execution;
  return execution;
}

async function executeCapturedProjectFinancingQuotaReview<TContext>(
  input: ExecuteProjectFinancingQuotaReviewActionInput<TContext>,
  submission: ProjectFinancingQuotaReviewExecutionSubmission<TContext>
): Promise<ProjectFinancingQuotaReviewExecutionResult<TContext>> {
  const context = submission.context;
  try {
    const result = await reviewProjectFinancingQuotaWithPreflight(
      submission.projectId,
      submission.quotaId,
      {
        decision: input.decision,
        confirmationPassword: submission.confirmationPassword,
        ...(submission.comment ? { comment: submission.comment } : {}),
        ...(submission.selfReviewReason
          ? { selfReviewReason: submission.selfReviewReason }
          : {}),
        requiresSelfReviewConfirmation:
          submission.requiresSelfReviewConfirmation,
        actionId: submission.actionId,
        lifecycleToken: submission.lifecycleToken,
        context,
        isCurrent: input.current
      },
      input.attemptState
    );
    if (!input.current(context)) {
      return { status: "stale", context };
    }
    await input.complete(context, result);
    return { status: "completed", context, result };
  } catch (error) {
    await input.fail(context, error);
    return { status: "failed", context };
  } finally {
    input.finish(context);
  }
}

function normalizeReviewSubmission<TContext>(
  projectId: string,
  quotaId: string,
  input: ProjectFinancingQuotaReviewInput<TContext>
): ProjectFinancingQuotaReviewSubmission {
  if (!input.isCurrent(input.context)) {
    throw new Error("项目垫资额度审批上下文已失效，请重新读取当前项目");
  }
  const normalizedProjectId = requiredText(projectId, "当前项目");
  const normalizedQuotaId = requiredText(quotaId, "垫资额度");
  const actionId = requiredText(input.actionId, "审批操作键").toLowerCase();
  if (!isUuidV4(actionId)) {
    throw new Error("审批操作键格式异常，请重新打开确认窗口");
  }
  const lifecycleToken = requiredText(input.lifecycleToken, "审批生命周期标识");
  if (!isLifecycleToken(lifecycleToken)) {
    throw new Error("审批生命周期标识格式异常，请刷新台账后重试");
  }
  if (input.decision !== "approve" && input.decision !== "reject") {
    throw new Error("项目垫资额度审批决定无效");
  }
  if (typeof input.requiresSelfReviewConfirmation !== "boolean") {
    throw new Error("项目垫资额度自审确认标识异常");
  }
  const confirmationPassword = input.confirmationPassword;
  if (!confirmationPassword.trim()) {
    throw new Error("请输入当前登录密码");
  }
  const comment = input.comment?.trim() || undefined;
  const selfReviewReason = input.selfReviewReason?.trim() || undefined;
  if (comment && Array.from(comment).length > 500) {
    throw new Error("审批意见不能超过 500 个字符");
  }
  if (selfReviewReason && Array.from(selfReviewReason).length > 500) {
    throw new Error("本人独立复核说明不能超过 500 个字符");
  }
  if (input.requiresSelfReviewConfirmation && !selfReviewReason) {
    throw new Error("请填写财务主管本人独立复核说明");
  }

  return {
    projectId: normalizedProjectId,
    quotaId: normalizedQuotaId,
    decision: input.decision,
    confirmationPassword,
    ...(comment ? { comment } : {}),
    ...(input.requiresSelfReviewConfirmation && selfReviewReason
      ? { selfReviewReason }
      : {}),
    requiresSelfReviewConfirmation: input.requiresSelfReviewConfirmation,
    actionId,
    lifecycleToken,
    isCurrent: () => input.isCurrent(input.context)
  };
}

async function executeProjectFinancingQuotaReview(
  submission: ProjectFinancingQuotaReviewSubmission,
  state: ProjectFinancingQuotaReviewAttemptState
): Promise<ProjectFinancingQuotaReviewResult> {
  if (state.businessReceipt) {
    return refreshReviewedQuota(submission, state.businessReceipt);
  }

  if (!state.preflightVerified) {
    await verifyReviewAction(submission);
    state.preflightVerified = true;
  }
  assertReviewCurrent(submission);
  let receipt: ProjectFinancingQuotaReviewReceipt;
  try {
    receipt = await postProjectFinancingQuotaReview(submission);
  } catch (error) {
    if (error instanceof ProjectFinancingQuotaApiError && error.status < 500) {
      state.submission = null;
      state.preflightVerified = false;
      state.businessReceipt = null;
    }
    throw error;
  }
  state.businessReceipt = receipt;
  assertReviewCurrent(submission);
  return refreshReviewedQuota(submission, receipt);
}

async function verifyReviewAction(
  submission: ProjectFinancingQuotaReviewSubmission
) {
  assertReviewCurrent(submission);
  const capability = await fetchProjectFinancingQuotaReviewCapability(
    submission.projectId,
    submission.quotaId
  );
  assertReviewCurrent(submission);
  if (
    capability.status !== "approval_pending" ||
    capability.lifecycleToken !== submission.lifecycleToken ||
    !reviewActionEnabled(
      capability.reviewAction,
      submission.requiresSelfReviewConfirmation
    )
  ) {
    throw new Error("项目垫资额度审批资格已变化，请刷新台账后重试");
  }
}

async function postProjectFinancingQuotaReview(
  submission: ProjectFinancingQuotaReviewSubmission
): Promise<ProjectFinancingQuotaReviewReceipt> {
  const response = await apiFetch(
    `/projects/${encodeURIComponent(submission.projectId)}/financing-quotas/${encodeURIComponent(submission.quotaId)}/approval`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: submission.decision,
        confirmationPassword: submission.confirmationPassword,
        ...(submission.comment ? { comment: submission.comment } : {}),
        ...(submission.selfReviewReason
          ? { selfReviewReason: submission.selfReviewReason }
          : {}),
        actionId: submission.actionId,
        expectedLifecycleToken: submission.lifecycleToken
      })
    }
  );
  if (!response.ok) {
    throw await responseError(response, "审批项目垫资额度失败");
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw invalidReviewResponse();
  }
  if (!isReviewReceipt(data, submission)) {
    throw invalidReviewResponse();
  }
  return data;
}

async function refreshReviewedQuota(
  submission: ProjectFinancingQuotaReviewSubmission,
  receipt: ProjectFinancingQuotaReviewReceipt
): Promise<ProjectFinancingQuotaReviewResult> {
  assertReviewCurrent(submission);
  const workbench = await fetchProjectFinancingQuotaWorkbench(
    submission.projectId
  );
  const row = projectFinancingQuotaReviewRow(workbench, submission.quotaId);
  assertReviewCurrent(submission);
  if (row.lifecycleToken === submission.lifecycleToken) {
    throw new ProjectFinancingQuotaApiError(
      "项目垫资额度权威台账尚未显示本次审批，请手动刷新后核对",
      502,
      "PROJECT_FINANCING_QUOTA_REVIEW_NOT_AUTHORITATIVE"
    );
  }
  return { receipt, workbench };
}

function isReviewReceipt(
  value: unknown,
  submission: ProjectFinancingQuotaReviewSubmission
): value is ProjectFinancingQuotaReviewReceipt {
  if (!isRecord(value)) return false;
  const expectedKeys = ["actionId", "kind", "projectId", "quotaId"];
  return (
    Object.keys(value).sort().join("|") === expectedKeys.join("|") &&
    (value.kind === "applied" || value.kind === "replayed") &&
    value.actionId === submission.actionId &&
    value.projectId === submission.projectId &&
    value.quotaId === submission.quotaId
  );
}

export function reviewActionEnabled(
  action: ProjectFinancingQuotaActionReadModel,
  requiresSelfReviewConfirmation =
    action.requiresSelfReviewConfirmation === true
) {
  return (
    action.key === "review_financing_quota" &&
    action.enabled &&
    action.requiresPassword === true &&
    action.requiredAction === "project.financing_quota.approve" &&
    (action.requiresSelfReviewConfirmation === true) ===
      requiresSelfReviewConfirmation
  );
}

function assertReviewCurrent(
  submission: ProjectFinancingQuotaReviewSubmission
) {
  if (!submission.isCurrent()) {
    throw new Error("项目垫资额度审批上下文已失效，请重新读取当前项目");
  }
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

function isLifecycleToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function financingQuotaYuanToCents(value: string) {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(value);
  if (!match) throw new Error("申请金额格式异常");
  const yuan = match[1]!.replace(/^0+(?=\d)/u, "");
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return `${yuan}${fraction}`.replace(/^0+(?=\d)/u, "");
}
