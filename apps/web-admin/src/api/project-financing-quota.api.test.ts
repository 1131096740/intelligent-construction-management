import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createProjectFinancingQuotaTerminationAttemptState,
  createProjectFinancingQuotaTerminationExecutionState,
  createProjectFinancingQuotaReviewExecutionState,
  createProjectFinancingQuotaReviewAttemptState,
  createProjectFinancingQuotaRequestAttemptState,
  createProjectOverviewRequestOwner,
  executeProjectFinancingQuotaReviewAction,
  executeProjectFinancingQuotaTerminationAction,
  fetchProjectFinancingQuotaTerminationCapability,
  fetchProjectFinancingQuotaReviewCapability,
  fetchProjectFinancingQuotaWorkbench,
  requestProjectFinancingQuotaWithUpload,
  type ProjectFinancingQuotaReviewAttemptState,
  type ProjectFinancingQuotaReviewExecutionState,
  type ProjectFinancingQuotaReviewInput,
  type ProjectFinancingQuotaReviewResult,
  type ProjectFinancingQuotaTerminationAttemptState,
  type ProjectFinancingQuotaTerminationExecutionState,
  type ProjectFinancingQuotaTerminationInput,
  type ProjectFinancingQuotaTerminationResult,
  type ProjectFinancingQuotaWorkbenchReadModel
} from "./project-financing-quota.api";

vi.mock("./api-fetch", () => ({ apiFetch: vi.fn() }));

import { apiFetch } from "./api-fetch";

const mockApiFetch = vi.mocked(apiFetch);
const requestIdempotencyKey = "11111111-1111-4111-8111-111111111111";
const reviewActionId = "22222222-2222-4222-8222-222222222222";
const terminationActionId = "33333333-3333-4333-8333-333333333333";
const reviewLifecycleToken = "a".repeat(64);
const nextReviewLifecycleToken = "b".repeat(64);
const terminationLifecycleToken = "c".repeat(64);
const nextTerminationLifecycleToken = "d".repeat(64);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function requestAction(enabled = true, requiresFile = true) {
  return {
    key: "request_financing_quota",
    label: "申请垫资额度",
    kind: "primary",
    enabled,
    disabledReason: enabled ? null : "当前不可申请",
    requiredAction: "project.financing_quota.request",
    requiresFile
  };
}

function quotaRow(
  id: string,
  status: "approval_pending" | "approved" | "rejected" | "terminated" =
    "approval_pending",
  options: {
    reviewEnabled?: boolean;
    terminationEnabled?: boolean;
    requiresSelfReviewConfirmation?: boolean;
    lifecycleToken?: string;
  } = {}
): ProjectFinancingQuotaWorkbenchReadModel["rows"][number] {
  return {
    id,
    amountCents: "5000000",
    reason: "阶段性垫资保障项目付款",
    validUntil: null,
    status,
    statusLabel: status === "approval_pending" ? "审批中" : "已批准",
    requestedByName: "项目经理甲",
    approvedByName: status === "approved" ? "董事长甲" : null,
    approvedAt: status === "approved" ? "2026-08-02T01:01:00.000Z" : null,
    terminatedAt: null,
    terminatedByName: null,
    terminationReason: null,
    createdAt: "2026-08-02T01:00:00.000Z",
    updatedAt: "2026-08-02T01:00:00.000Z",
    isExpired: false,
    netUsedAmountCents: "0",
    availableAmountCents: "0",
    currentApproval: {
      status,
      currentNodeIndex: status === "approval_pending" ? 0 : 2,
      currentNodeName: status === "approval_pending" ? "财务主管" : null
    },
    lifecycleToken: options.lifecycleToken ?? reviewLifecycleToken,
    reviewAction: {
      key: "review_financing_quota",
      label: "审批垫资额度",
      kind: "primary",
      enabled: options.reviewEnabled ?? false,
      disabledReason: options.reviewEnabled ? null : "当前不可审批",
      requiredAction: "project.financing_quota.approve",
      requiresPassword: true,
      requiresSelfReviewConfirmation:
        options.requiresSelfReviewConfirmation ?? false
    },
    terminateAction: {
      key: "terminate_financing_quota",
      label: "终止垫资额度",
      kind: "danger",
      enabled: options.terminationEnabled ?? false,
      disabledReason: options.terminationEnabled ? null : "当前不可终止",
      requiredAction: "project.financing_quota.terminate",
      requiresPassword: true
    },
    usageGroups: []
  };
}

function reviewCapability(
  projectId: string,
  quotaId: string,
  row = quotaRow(quotaId)
) {
  return {
    projectId,
    quotaId,
    status: row.status,
    lifecycleToken: row.lifecycleToken,
    reviewAction: row.reviewAction
  };
}

function terminationCapability(
  projectId: string,
  quotaId: string,
  row = quotaRow(quotaId, "approved", {
    terminationEnabled: true,
    lifecycleToken: terminationLifecycleToken
  })
) {
  return {
    projectId,
    quotaId,
    status: row.status,
    lifecycleToken: row.lifecycleToken,
    terminateAction: row.terminateAction
  };
}

function workbench(
  projectId: string,
  options: {
    actionEnabled?: boolean;
    requiresFile?: boolean;
    rows?: ReturnType<typeof quotaRow>[];
  } = {}
): ProjectFinancingQuotaWorkbenchReadModel {
  return {
    project: { id: projectId, code: "JGXM-001", name: "项目一" },
    policy: {
      allocationOrder: ["project_cash", "financing_quota"],
      userSelectable: false
    },
    summary: {
      quotaAmountCents: "0",
      netUsedAmountCents: "0",
      currentlyAvailableAmountCents: "0"
    },
    requestAction: requestAction(
      options.actionEnabled ?? true,
      options.requiresFile ?? true
    ),
    rows: options.rows ?? []
  };
}

function usageGroup(overrides: Record<string, string> = {}) {
  return {
    executionType: "payment_execution",
    executionId: "execution-1",
    businessType: "payment_request",
    businessId: "payment-1",
    occurredAt: "2026-08-02T02:00:00.000Z",
    projectCashNetAmountCents: "1000",
    financingQuotaNetAmountCents: "4000",
    currentQuotaDebitAmountCents: "4000",
    currentQuotaCreditAmountCents: "0",
    currentQuotaNetAmountCents: "4000",
    ...overrides
  };
}

function uploadedFile(id = requestIdempotencyKey) {
  return {
    id,
    bucket: "private",
    objectKey: `uploads/${id}`,
    originalName: "financing.pdf",
    mimeType: "application/pdf",
    sizeBytes: 7,
    uploadedByUserId: "user-1",
    createdAt: "2026-08-02T00:00:00.000Z"
  };
}

function requestInput(context: { current: boolean }) {
  return {
    form: {
      amountYuan: "50000",
      reason: " 阶段性垫资保障项目付款 ",
      validUntil: ""
    },
    files: [{
      raw: new File(["voucher"], "financing.pdf", {
        type: "application/pdf"
      })
    }],
    idempotencyKey: requestIdempotencyKey,
    context,
    isCurrent: (candidate: { current: boolean }) => candidate.current
  };
}

function reviewInput(
  context: { current: boolean },
  options: {
    lifecycleToken?: string;
    requiresSelfReviewConfirmation?: boolean;
  } = {}
) {
  const requiresSelfReviewConfirmation =
    options.requiresSelfReviewConfirmation ?? false;
  return {
    decision: "approve" as const,
    confirmationPassword: "current-password",
    comment: " 同意按审批节点推进 ",
    ...(requiresSelfReviewConfirmation
      ? { selfReviewReason: " 财务主管对本人发起额度独立复核 " }
      : {}),
    requiresSelfReviewConfirmation,
    actionId: reviewActionId,
    lifecycleToken: options.lifecycleToken ?? reviewLifecycleToken,
    context,
    isCurrent: (candidate: { current: boolean }) => candidate.current
  };
}

function terminationInput(
  context: { current: boolean },
  options: { lifecycleToken?: string; reason?: string; password?: string } = {}
) {
  return {
    reason: options.reason ?? " 项目已具备自有资金，不再允许新占用 ",
    confirmationPassword: options.password ?? " current-password ",
    actionId: terminationActionId,
    lifecycleToken: options.lifecycleToken ?? terminationLifecycleToken,
    context,
    isCurrent: (candidate: { current: boolean }) => candidate.current
  };
}

type ReviewTestContext = { current: boolean };

const reviewExecutions = new WeakMap<
  ProjectFinancingQuotaReviewAttemptState,
  {
    state: ProjectFinancingQuotaReviewExecutionState<ReviewTestContext>;
    promise: Promise<ProjectFinancingQuotaReviewResult> | null;
  }
>();

type TerminationTestContext = { current: boolean };

const terminationExecutions = new WeakMap<
  ProjectFinancingQuotaTerminationAttemptState,
  {
    state: ProjectFinancingQuotaTerminationExecutionState<TerminationTestContext>;
    promise: Promise<ProjectFinancingQuotaTerminationResult> | null;
  }
>();

function terminateProjectFinancingQuotaWithPreflight(
  projectId: string,
  quotaId: string,
  input: ProjectFinancingQuotaTerminationInput<TerminationTestContext>,
  attemptState: ProjectFinancingQuotaTerminationAttemptState
): Promise<ProjectFinancingQuotaTerminationResult> {
  let execution = terminationExecutions.get(attemptState);
  if (!execution) {
    execution = {
      state:
        createProjectFinancingQuotaTerminationExecutionState<TerminationTestContext>(),
      promise: null
    };
    terminationExecutions.set(attemptState, execution);
  }
  if (execution.promise) return execution.promise;

  let failure: unknown = new Error("项目垫资额度终止执行失败");
  const action = executeProjectFinancingQuotaTerminationAction(
    {
      attemptState,
      capture: () => ({
        projectId,
        quotaId,
        reason: input.reason,
        confirmationPassword: input.confirmationPassword,
        actionId: input.actionId,
        lifecycleToken: input.lifecycleToken,
        context: input.context
      }),
      current: input.isCurrent,
      complete: () => undefined,
      fail: (_context, error) => {
        failure = error;
      },
      finish: () => undefined
    },
    execution.state
  );
  const promise = action.then((result) => {
    if (result.status === "completed") return result.result;
    if (result.status === "failed") throw failure;
    throw new Error("项目垫资额度终止执行未完成");
  }).finally(() => {
    if (execution?.promise === promise) execution.promise = null;
  });
  execution.promise = promise;
  return promise;
}

function reviewProjectFinancingQuotaWithPreflight(
  projectId: string,
  quotaId: string,
  input: ProjectFinancingQuotaReviewInput<ReviewTestContext>,
  attemptState: ProjectFinancingQuotaReviewAttemptState
): Promise<ProjectFinancingQuotaReviewResult> {
  let execution = reviewExecutions.get(attemptState);
  if (!execution) {
    execution = {
      state: createProjectFinancingQuotaReviewExecutionState<ReviewTestContext>(),
      promise: null
    };
    reviewExecutions.set(attemptState, execution);
  }
  if (execution.promise) return execution.promise;

  let failure: unknown = new Error("项目垫资额度审批执行失败");
  const action = executeProjectFinancingQuotaReviewAction(
    {
      decision: input.decision,
      attemptState,
      capture: () => ({
        projectId,
        quotaId,
        confirmationPassword: input.confirmationPassword,
        ...(input.comment !== undefined ? { comment: input.comment } : {}),
        ...(input.selfReviewReason !== undefined
          ? { selfReviewReason: input.selfReviewReason }
          : {}),
        requiresSelfReviewConfirmation:
          input.requiresSelfReviewConfirmation,
        actionId: input.actionId,
        lifecycleToken: input.lifecycleToken,
        context: input.context
      }),
      current: input.isCurrent,
      complete: () => undefined,
      fail: (_context, error) => {
        failure = error;
      },
      finish: () => undefined
    },
    execution.state
  );
  const promise = action.then((result) => {
    if (result.status === "completed") return result.result;
    if (result.status === "failed") throw failure;
    throw new Error("项目垫资额度审批执行未完成");
  }).finally(() => {
    if (execution?.promise === promise) execution.promise = null;
  });
  execution.promise = promise;
  return promise;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
}

describe("project financing quota API", () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it("reads the project-scoped authoritative workbench", async () => {
    const workbench: ProjectFinancingQuotaWorkbenchReadModel = {
      project: { id: "project/1", code: "JGXM-001", name: "项目一" },
      policy: {
        allocationOrder: ["project_cash", "financing_quota"],
        userSelectable: false
      },
      summary: {
        quotaAmountCents: "0",
        netUsedAmountCents: "0",
        currentlyAvailableAmountCents: "0"
      },
      requestAction: {
        key: "request_financing_quota",
        label: "申请垫资额度",
        kind: "primary",
        enabled: false,
        disabledReason: "当前账号无项目垫资额度申请权限",
        requiredAction: "project.financing_quota.request"
      },
      rows: [{
        id: "quota-1",
        amountCents: "5000",
        reason: "保障现场付款",
        validUntil: null,
        status: "approved",
        statusLabel: "已批准",
        requestedByName: "财务员甲",
        approvedByName: "董事长甲",
        approvedAt: "2026-08-01T02:00:00.000Z",
        terminatedAt: null,
        terminatedByName: null,
        terminationReason: null,
        createdAt: "2026-08-01T01:00:00.000Z",
        updatedAt: "2026-08-01T02:00:00.000Z",
        isExpired: false,
        netUsedAmountCents: "1000",
        availableAmountCents: "4000",
        currentApproval: {
          status: "approved",
          currentNodeIndex: 2,
          currentNodeName: null
        },
        lifecycleToken: reviewLifecycleToken,
        reviewAction: {
          key: "review_financing_quota",
          label: "审批垫资额度",
          kind: "primary",
          enabled: false,
          disabledReason: "当前状态不可审批",
          requiredAction: "project.financing_quota.approve",
          requiresPassword: true
        },
        terminateAction: {
          key: "terminate_financing_quota",
          label: "终止垫资额度",
          kind: "danger",
          enabled: true,
          disabledReason: null,
          requiredAction: "project.financing_quota.terminate",
          requiresPassword: true,
          requiresSelfReviewConfirmation: false
        },
        usageGroups: [{
          executionType: "payment_execution",
          executionId: "execution-1",
          businessType: "payment_request",
          businessId: "payment-1",
          occurredAt: "2026-08-01T03:00:00.000Z",
          projectCashNetAmountCents: "6000",
          financingQuotaNetAmountCents: "1000",
          currentQuotaDebitAmountCents: "1000",
          currentQuotaCreditAmountCents: "0",
          currentQuotaNetAmountCents: "1000"
        }]
      }]
    };
    mockApiFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({
        ...workbench,
        readAt: "2026-08-01T03:00:00.000Z",
        summary: {
          ...workbench.summary,
          projectCashNetUsedAmountCents: "6000"
        },
        rows: workbench.rows.map((row) => ({
          ...row,
          currentApproval: row.currentApproval
            ? {
                ...row.currentApproval,
                updatedAt: "2026-08-01T02:00:00.000Z"
              }
            : null
        }))
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(fetchProjectFinancingQuotaWorkbench("project/1"))
      .resolves.toMatchObject({ rows: [{ id: "quota-1" }] });

    expect(mockApiFetch).toHaveBeenCalledWith(
      "/projects/project%2F1/financing-quotas"
    );
  });

  it("keeps a forbidden project read fail-closed with structured status and code", async () => {
    mockApiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "PROJECT_SCOPE_FORBIDDEN",
          message: "无权读取该项目"
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    await expect(fetchProjectFinancingQuotaWorkbench("project-1")).rejects.toMatchObject({
      status: 403,
      code: "PROJECT_SCOPE_FORBIDDEN"
    });
  });

  it("rejects a malformed successful payload before the page can render it", async () => {
    mockApiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          project: { id: "project-1", code: "JGXM-001", name: "项目一" },
          policy: {
            allocationOrder: ["project_cash", "financing_quota"],
            userSelectable: false
          },
          summary: {
            quotaAmountCents: 0,
            netUsedAmountCents: "0",
            currentlyAvailableAmountCents: "0"
          },
          requestAction: null,
          rows: "not-an-array"
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    await expect(fetchProjectFinancingQuotaWorkbench("project-1"))
      .rejects.toMatchObject({
        status: 502,
        code: "PROJECT_FINANCING_QUOTA_INVALID_RESPONSE"
      });
  });

  it("strictly parses the direct single-target review capability response", async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResponse(reviewCapability(
      "project/1",
      "quota/1",
      quotaRow("quota/1", "approval_pending", {
        reviewEnabled: true,
        lifecycleToken: "A".repeat(64)
      })
    )));

    await expect(fetchProjectFinancingQuotaReviewCapability(
      "project/1",
      "quota/1"
    )).rejects.toMatchObject({
      status: 502,
      code: "PROJECT_FINANCING_QUOTA_INVALID_REVIEW_CAPABILITY_RESPONSE"
    });
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/projects/project%2F1/financing-quotas/quota%2F1/review-capability"
    );
  });

  it("rejects a valid-shaped payload belonging to another project", async () => {
    mockApiFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          project: { id: "project-2", code: "JGXM-002", name: "项目二" },
          policy: {
            allocationOrder: ["project_cash", "financing_quota"],
            userSelectable: false
          },
          summary: {
            quotaAmountCents: "0",
            netUsedAmountCents: "0",
            currentlyAvailableAmountCents: "0"
          },
          requestAction: {
            key: "request_financing_quota",
            label: "申请垫资额度",
            kind: "primary",
            enabled: false,
            disabledReason: "无权申请",
            requiredAction: "project.financing_quota.request"
          },
          rows: []
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    await expect(fetchProjectFinancingQuotaWorkbench("project-1"))
      .rejects.toMatchObject({
        status: 502,
        code: "PROJECT_FINANCING_QUOTA_INVALID_RESPONSE"
      });
  });

  it("normalizes invalid JSON from a successful response to the controlled 502", async () => {
    mockApiFetch.mockResolvedValueOnce(
      new Response("{", {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(fetchProjectFinancingQuotaWorkbench("project-1"))
      .rejects.toMatchObject({
        status: 502,
        code: "PROJECT_FINANCING_QUOTA_INVALID_RESPONSE"
      });
  });

  it("lets only the latest overview request commit after project switches or refreshes", () => {
    const owner = createProjectOverviewRequestOwner();
    const firstProjectA = owner.begin();
    const projectB = owner.begin();
    const secondProjectA = owner.begin();

    expect(owner.isCurrent(firstProjectA)).toBe(false);
    expect(owner.isCurrent(projectB)).toBe(false);
    expect(owner.isCurrent(secondProjectA)).toBe(true);

    owner.invalidate();
    expect(owner.isCurrent(secondProjectA)).toBe(false);
  });

  it("preflights before upload and POST, then accepts the authoritative created row", async () => {
    const context = { current: true };
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(workbench("project/1")))
      .mockResolvedValueOnce(jsonResponse(uploadedFile(), 201))
      .mockResolvedValueOnce(jsonResponse(workbench("project/1")))
      .mockResolvedValueOnce(jsonResponse({
        kind: "created",
        idempotencyKey: requestIdempotencyKey,
        projectId: "project/1",
        quotaId: "quota-1"
      }, 201))
      .mockResolvedValueOnce(jsonResponse(workbench("project/1", {
        rows: [quotaRow("quota-1")]
      })));

    const result = await requestProjectFinancingQuotaWithUpload(
      "project/1",
      requestInput(context),
      createProjectFinancingQuotaRequestAttemptState()
    );

    expect(result.receipt.kind).toBe("created");
    expect(result.workbench.rows.map((row) => row.id)).toEqual(["quota-1"]);
    expect(mockApiFetch.mock.calls.map((call) => call[0])).toEqual([
      "/projects/project%2F1/financing-quotas",
      "/projects/project%2F1/financing-quotas/file-uploads",
      "/projects/project%2F1/financing-quotas",
      "/projects/project%2F1/financing-quotas",
      "/projects/project%2F1/financing-quotas"
    ]);
    const uploadBody = mockApiFetch.mock.calls[1]?.[1]?.body;
    expect(uploadBody).toBeInstanceOf(FormData);
    expect((uploadBody as FormData).get("idempotencyKey")).toBe(
      requestIdempotencyKey
    );
    expect((uploadBody as FormData).get("file")).toBeInstanceOf(File);
    expect(mockApiFetch.mock.calls[3]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        amountCents: "5000000",
        reason: "阶段性垫资保障项目付款",
        attachmentFileId: requestIdempotencyKey,
        idempotencyKey: requestIdempotencyKey
      })
    });
  });

  it("shares one in-flight promise across double submit", async () => {
    const context = { current: true };
    const upload = deferred<Response>();
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockReturnValueOnce(upload.promise)
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockResolvedValueOnce(jsonResponse({
        kind: "created",
        idempotencyKey: requestIdempotencyKey,
        projectId: "project-1",
        quotaId: "quota-1"
      }, 201))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1", {
        rows: [quotaRow("quota-1")]
      })));
    const state = createProjectFinancingQuotaRequestAttemptState();
    const input = requestInput(context);

    const first = requestProjectFinancingQuotaWithUpload("project-1", input, state);
    const second = requestProjectFinancingQuotaWithUpload("project-1", input, state);

    expect(second).toBe(first);
    await vi.waitFor(() => {
      expect(mockApiFetch.mock.calls.filter((call) => call[0] === "/projects/project-1/financing-quotas/file-uploads"))
        .toHaveLength(1);
    });
    upload.resolve(jsonResponse(uploadedFile(), 201));
    await expect(first).resolves.toMatchObject({ receipt: { quotaId: "quota-1" } });
    expect(mockApiFetch.mock.calls.filter(
      (call) => call[0] === "/projects/project-1/financing-quotas" &&
        call[1]?.method === "POST"
    ))
      .toHaveLength(1);
  });

  it("retries an unknown POST with the same key and uploaded file", async () => {
    const context = { current: true };
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockResolvedValueOnce(jsonResponse(uploadedFile(), 201))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockRejectedValueOnce(new TypeError("network result unknown"))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockResolvedValueOnce(jsonResponse({
        kind: "replayed",
        idempotencyKey: requestIdempotencyKey,
        projectId: "project-1",
        quotaId: "quota-1"
      }))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1", {
        rows: [quotaRow("quota-1")]
      })));
    const state = createProjectFinancingQuotaRequestAttemptState();
    const input = requestInput(context);

    await expect(
      requestProjectFinancingQuotaWithUpload("project-1", input, state)
    ).rejects.toThrow("network result unknown");
    await expect(
      requestProjectFinancingQuotaWithUpload("project-1", input, state)
    ).resolves.toMatchObject({ receipt: { kind: "replayed" } });

    expect(mockApiFetch.mock.calls.filter((call) => call[0] === "/projects/project-1/financing-quotas/file-uploads"))
      .toHaveLength(1);
    const postBodies = mockApiFetch.mock.calls
      .filter(
        (call) => call[0] === "/projects/project-1/financing-quotas" &&
          call[1]?.method === "POST"
      )
      .map((call) => call[1]?.body);
    expect(postBodies).toEqual([
      expect.stringContaining(requestIdempotencyKey),
      expect.stringContaining(requestIdempotencyKey)
    ]);
  });

  it("accepts the authoritative row when approval advances before replay refresh", async () => {
    const context = { current: true };
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockResolvedValueOnce(jsonResponse(uploadedFile(), 201))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockResolvedValueOnce(jsonResponse({
        kind: "replayed",
        idempotencyKey: requestIdempotencyKey,
        projectId: "project-1",
        quotaId: "quota-1"
      }))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1", {
        rows: [quotaRow("quota-1", "approved")]
      })));

    await expect(requestProjectFinancingQuotaWithUpload(
      "project-1",
      requestInput(context),
      createProjectFinancingQuotaRequestAttemptState()
    )).resolves.toMatchObject({
      receipt: { kind: "replayed", quotaId: "quota-1" },
      workbench: { rows: [{ id: "quota-1", status: "approved" }] }
    });
  });

  it("does not POST after the frozen project context is invalidated during upload", async () => {
    const context = { current: true };
    const upload = deferred<Response>();
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockReturnValueOnce(upload.promise);

    const request = requestProjectFinancingQuotaWithUpload(
      "project-1",
      requestInput(context),
      createProjectFinancingQuotaRequestAttemptState()
    );
    await vi.waitFor(() => {
      expect(mockApiFetch.mock.calls.filter((call) => call[0] === "/projects/project-1/financing-quotas/file-uploads"))
        .toHaveLength(1);
    });
    context.current = false;
    upload.resolve(jsonResponse(uploadedFile(), 201));

    await expect(request).rejects.toThrow("上下文已失效");
    expect(mockApiFetch.mock.calls.filter(
      (call) => call[0] === "/projects/project-1/financing-quotas" &&
        call[1]?.method === "POST"
    ))
      .toHaveLength(0);
  });

  it("stops before POST when the fresh server action drifts after upload", async () => {
    const context = { current: true };
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockResolvedValueOnce(jsonResponse(uploadedFile(), 201))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1", {
        actionEnabled: false
      })));

    await expect(requestProjectFinancingQuotaWithUpload(
      "project-1",
      requestInput(context),
      createProjectFinancingQuotaRequestAttemptState()
    )).rejects.toThrow("申请资格已变化");

    expect(mockApiFetch.mock.calls.filter(
      (call) => call[0] === "/projects/project-1/financing-quotas" &&
        call[1]?.method === "POST"
    ))
      .toHaveLength(0);
  });

  it("stops before POST when the fresh server action namespace drifts after upload", async () => {
    const context = { current: true };
    const drifted = workbench("project-1");
    drifted.requestAction.requiredAction = "project.financing_quota.approve";
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockResolvedValueOnce(jsonResponse(uploadedFile(), 201))
      .mockResolvedValueOnce(jsonResponse(drifted));

    await expect(requestProjectFinancingQuotaWithUpload(
      "project-1",
      requestInput(context),
      createProjectFinancingQuotaRequestAttemptState()
    )).rejects.toThrow("申请资格已变化");

    expect(mockApiFetch.mock.calls.filter(
      (call) => call[0] === "/projects/project-1/financing-quotas" &&
        call[1]?.method === "POST"
    ))
      .toHaveLength(0);
  });

  it("fails closed on a mismatched receipt or an authoritative refresh without the quota", async () => {
    const context = { current: true };
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockResolvedValueOnce(jsonResponse(uploadedFile(), 201))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockResolvedValueOnce(jsonResponse({
        kind: "created",
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
        projectId: "project-1",
        quotaId: "quota-1"
      }, 201));

    await expect(requestProjectFinancingQuotaWithUpload(
      "project-1",
      requestInput(context),
      createProjectFinancingQuotaRequestAttemptState()
    )).rejects.toMatchObject({
      status: 502,
      code: "PROJECT_FINANCING_QUOTA_INVALID_REQUEST_RESPONSE"
    });

    mockApiFetch.mockReset();
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockResolvedValueOnce(jsonResponse(uploadedFile(), 201))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")))
      .mockResolvedValueOnce(jsonResponse({
        kind: "created",
        idempotencyKey: requestIdempotencyKey,
        projectId: "project-1",
        quotaId: "quota-missing"
      }, 201))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1")));

    await expect(requestProjectFinancingQuotaWithUpload(
      "project-1",
      requestInput(context),
      createProjectFinancingQuotaRequestAttemptState()
    )).rejects.toThrow("权威台账未包含本次申请");
  });

  it("reviews only after an exact fresh action and token check, then accepts the authoritative refresh", async () => {
    const context = { current: true };
    const reviewable = quotaRow("quota/1", "approval_pending", {
      reviewEnabled: true,
      lifecycleToken: reviewLifecycleToken
    });
    const advanced = quotaRow("quota/1", "approval_pending", {
      reviewEnabled: false,
      lifecycleToken: nextReviewLifecycleToken
    });
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(reviewCapability(
        "project/1",
        "quota/1",
        reviewable
      )))
      .mockResolvedValueOnce(jsonResponse({
        kind: "applied",
        actionId: reviewActionId,
        projectId: "project/1",
        quotaId: "quota/1"
      }))
      .mockResolvedValueOnce(jsonResponse(workbench("project/1", {
        rows: [advanced]
      })));

    await expect(reviewProjectFinancingQuotaWithPreflight(
      "project/1",
      "quota/1",
      reviewInput(context),
      createProjectFinancingQuotaReviewAttemptState()
    )).resolves.toMatchObject({
      receipt: { kind: "applied", actionId: reviewActionId },
      workbench: { rows: [{ lifecycleToken: nextReviewLifecycleToken }] }
    });

    expect(mockApiFetch.mock.calls.map((call) => call[0])).toEqual([
      "/projects/project%2F1/financing-quotas/quota%2F1/review-capability",
      "/projects/project%2F1/financing-quotas/quota%2F1/approval",
      "/projects/project%2F1/financing-quotas"
    ]);
    expect(mockApiFetch.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        decision: "approve",
        confirmationPassword: "current-password",
        comment: "同意按审批节点推进",
        actionId: reviewActionId,
        expectedLifecycleToken: reviewLifecycleToken
      })
    });
  });

  it("accepts exactly 500 supplementary-plane characters in a review comment", async () => {
    const context = { current: true };
    const comment = "😀".repeat(500);
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(reviewCapability(
        "project-1",
        "quota-1",
        quotaRow("quota-1", "approval_pending", { reviewEnabled: true })
      )))
      .mockResolvedValueOnce(jsonResponse({
        kind: "applied",
        actionId: reviewActionId,
        projectId: "project-1",
        quotaId: "quota-1"
      }))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1", {
        rows: [quotaRow("quota-1", "approval_pending", {
          lifecycleToken: nextReviewLifecycleToken
        })]
      })));

    await expect(reviewProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      { ...reviewInput(context), comment },
      createProjectFinancingQuotaReviewAttemptState()
    )).resolves.toMatchObject({ receipt: { kind: "applied" } });

    expect(JSON.parse(String(mockApiFetch.mock.calls[1]?.[1]?.body)))
      .toMatchObject({ comment });
  });

  it("rejects review text over 500 Unicode code points before any request", async () => {
    const context = { current: true };

    await expect(reviewProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      { ...reviewInput(context), comment: "😀".repeat(501) },
      createProjectFinancingQuotaReviewAttemptState()
    )).rejects.toThrow("审批意见不能超过 500 个字符");
    await expect(reviewProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      {
        ...reviewInput(context, { requiresSelfReviewConfirmation: true }),
        selfReviewReason: "😀".repeat(501)
      },
      createProjectFinancingQuotaReviewAttemptState()
    )).rejects.toThrow("本人独立复核说明不能超过 500 个字符");

    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("rejects a review receipt with undeclared fields", async () => {
    const context = { current: true };
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(reviewCapability(
        "project-1",
        "quota-1",
        quotaRow("quota-1", "approval_pending", { reviewEnabled: true })
      )))
      .mockResolvedValueOnce(jsonResponse({
        kind: "applied",
        actionId: reviewActionId,
        projectId: "project-1",
        quotaId: "quota-1",
        status: "approved"
      }));

    await expect(reviewProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      reviewInput(context),
      createProjectFinancingQuotaReviewAttemptState()
    )).rejects.toMatchObject({
      status: 502,
      code: "PROJECT_FINANCING_QUOTA_INVALID_REVIEW_RESPONSE"
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
  });

  it("shares one review promise across a double submit", async () => {
    const context = { current: true };
    const post = deferred<Response>();
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(reviewCapability(
        "project-1",
        "quota-1",
        quotaRow("quota-1", "approval_pending", {
          reviewEnabled: true
        })
      )))
      .mockReturnValueOnce(post.promise)
      .mockResolvedValueOnce(jsonResponse(workbench("project-1", {
        rows: [quotaRow("quota-1", "approval_pending", {
          lifecycleToken: nextReviewLifecycleToken
        })]
      })));
    const state = createProjectFinancingQuotaReviewAttemptState();
    const input = reviewInput(context);

    const first = reviewProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      input,
      state
    );
    const second = reviewProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      input,
      state
    );

    expect(second).toBe(first);
    await vi.waitFor(() => {
      expect(mockApiFetch.mock.calls.filter((call) =>
        call[0] === "/projects/project-1/financing-quotas/quota-1/approval"
      )).toHaveLength(1);
    });
    post.resolve(jsonResponse({
      kind: "applied",
      actionId: reviewActionId,
      projectId: "project-1",
      quotaId: "quota-1"
    }));
    await expect(first).resolves.toMatchObject({
      receipt: { actionId: reviewActionId }
    });
  });

  it("shares one canonical review execution across a double UI confirmation", async () => {
    const context = { current: true };
    const post = deferred<Response>();
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(reviewCapability(
        "project-1",
        "quota-1",
        quotaRow("quota-1", "approval_pending", {
          reviewEnabled: true
        })
      )))
      .mockReturnValueOnce(post.promise)
      .mockResolvedValueOnce(jsonResponse(workbench("project-1", {
        rows: [quotaRow("quota-1", "approval_pending", {
          lifecycleToken: nextReviewLifecycleToken
        })]
      })));
    const complete = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);
    const finish = vi.fn();
    const capture = vi.fn(() => ({
      projectId: "project-1",
      quotaId: "quota-1",
      confirmationPassword: "current-password",
      requiresSelfReviewConfirmation: false,
      actionId: reviewActionId,
      lifecycleToken: reviewLifecycleToken,
      context
    }));
    const input = {
      decision: "approve" as const,
      attemptState: createProjectFinancingQuotaReviewAttemptState(),
      capture,
      current: (candidate: typeof context) => candidate.current,
      complete,
      fail,
      finish
    };
    const state = createProjectFinancingQuotaReviewExecutionState<typeof context>();

    const first = executeProjectFinancingQuotaReviewAction(input, state);
    const second = executeProjectFinancingQuotaReviewAction(input, state);

    expect(second).toBe(first);
    expect(capture).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => {
      expect(mockApiFetch.mock.calls.filter((call) =>
        call[0] === "/projects/project-1/financing-quotas/quota-1/approval"
      )).toHaveLength(1);
    });
    post.resolve(jsonResponse({
      kind: "applied",
      actionId: reviewActionId,
      projectId: "project-1",
      quotaId: "quota-1"
    }));

    await expect(first).resolves.toMatchObject({ status: "completed", context });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(fail).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledTimes(1);
    expect(state.promise).toBeNull();
  });

  it("retries an unknown review POST with the same action id and frozen token", async () => {
    const context = { current: true };
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(reviewCapability(
        "project-1",
        "quota-1",
        quotaRow("quota-1", "approval_pending", {
          reviewEnabled: true
        })
      )))
      .mockRejectedValueOnce(new TypeError("network result unknown"))
      .mockResolvedValueOnce(jsonResponse({
        kind: "replayed",
        actionId: reviewActionId,
        projectId: "project-1",
        quotaId: "quota-1"
      }))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1", {
        rows: [quotaRow("quota-1", "approved", {
          lifecycleToken: nextReviewLifecycleToken
        })]
      })));
    const state = createProjectFinancingQuotaReviewAttemptState();
    const input = reviewInput(context);

    await expect(reviewProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      input,
      state
    )).rejects.toThrow("network result unknown");
    await expect(reviewProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      input,
      state
    )).resolves.toMatchObject({ receipt: { kind: "replayed" } });

    const postBodies = mockApiFetch.mock.calls
      .filter((call) =>
        call[0] === "/projects/project-1/financing-quotas/quota-1/approval"
      )
      .map((call) => call[1]?.body);
    expect(postBodies).toEqual([
      expect.stringContaining(reviewActionId),
      expect.stringContaining(reviewActionId)
    ]);
    expect(new Set(postBodies)).toHaveProperty("size", 1);
    expect(mockApiFetch.mock.calls.filter((call) =>
      call[0] === "/projects/project-1/financing-quotas" && !call[1]
    )).toHaveLength(1);
    expect(mockApiFetch.mock.calls.filter((call) =>
      call[0] ===
        "/projects/project-1/financing-quotas/quota-1/review-capability"
    )).toHaveLength(1);
  });

  it("retries only the authoritative GET after a durable receipt", async () => {
    const context = { current: true };
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(reviewCapability(
        "project-1",
        "quota-1",
        quotaRow("quota-1", "approval_pending", {
          reviewEnabled: true
        })
      )))
      .mockResolvedValueOnce(jsonResponse({
        kind: "applied",
        actionId: reviewActionId,
        projectId: "project-1",
        quotaId: "quota-1"
      }))
      .mockRejectedValueOnce(new TypeError("refresh failed"))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1", {
        rows: [quotaRow("quota-1", "approval_pending", {
          lifecycleToken: nextReviewLifecycleToken
        })]
      })));
    const state = createProjectFinancingQuotaReviewAttemptState();
    const input = reviewInput(context);

    await expect(reviewProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      input,
      state
    )).rejects.toThrow("refresh failed");
    await expect(reviewProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      input,
      state
    )).resolves.toMatchObject({ receipt: { kind: "applied" } });

    expect(mockApiFetch.mock.calls.filter((call) =>
      call[0] === "/projects/project-1/financing-quotas/quota-1/approval"
    )).toHaveLength(1);
  });

  it.each([
    {
      name: "lifecycle token drift",
      row: quotaRow("quota-1", "approval_pending", {
        reviewEnabled: true,
        lifecycleToken: nextReviewLifecycleToken
      })
    },
    {
      name: "disabled server action",
      row: quotaRow("quota-1", "approval_pending")
    },
    {
      name: "self-review requirement drift",
      row: quotaRow("quota-1", "approval_pending", {
        reviewEnabled: true,
        requiresSelfReviewConfirmation: true
      })
    }
  ])("fails closed before review POST on $name", async ({ row }) => {
    const context = { current: true };
    mockApiFetch.mockResolvedValueOnce(jsonResponse(reviewCapability(
      "project-1",
      "quota-1",
      row
    )));

    await expect(reviewProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      reviewInput(context),
      createProjectFinancingQuotaReviewAttemptState()
    )).rejects.toThrow("审批资格已变化");

    expect(mockApiFetch.mock.calls.some((call) =>
      call[0] === "/projects/project-1/financing-quotas/quota-1/approval"
    )).toBe(false);
  });

  it("does not review after the frozen context is invalidated during fresh preflight", async () => {
    const context = { current: true };
    const preflight = deferred<Response>();
    mockApiFetch.mockReturnValueOnce(preflight.promise);
    const review = reviewProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      reviewInput(context),
      createProjectFinancingQuotaReviewAttemptState()
    );

    context.current = false;
    preflight.resolve(jsonResponse(reviewCapability(
      "project-1",
      "quota-1",
      quotaRow("quota-1", "approval_pending", {
        reviewEnabled: true
      })
    )));

    await expect(review).rejects.toThrow("审批上下文已失效");
    expect(mockApiFetch.mock.calls.some((call) =>
      call[0] === "/projects/project-1/financing-quotas/quota-1/approval"
    )).toBe(false);
  });

  it("includes the frozen self-review reason only when the fresh action requires it", async () => {
    const context = { current: true };
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(reviewCapability(
        "project-1",
        "quota-1",
        quotaRow("quota-1", "approval_pending", {
          reviewEnabled: true,
          requiresSelfReviewConfirmation: true
        })
      )))
      .mockResolvedValueOnce(jsonResponse({
        kind: "applied",
        actionId: reviewActionId,
        projectId: "project-1",
        quotaId: "quota-1"
      }))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1", {
        rows: [quotaRow("quota-1", "approval_pending", {
          lifecycleToken: nextReviewLifecycleToken
        })]
      })));

    await reviewProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      reviewInput(context, { requiresSelfReviewConfirmation: true }),
      createProjectFinancingQuotaReviewAttemptState()
    );

    expect(mockApiFetch.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({
      decision: "approve",
      confirmationPassword: "current-password",
      comment: "同意按审批节点推进",
      selfReviewReason: "财务主管对本人发起额度独立复核",
      actionId: reviewActionId,
      expectedLifecycleToken: reviewLifecycleToken
    }));
  });

  it("re-preflights and accepts a corrected password after a deterministic 400", async () => {
    const context = { current: true };
    const initialInput = reviewInput(context);
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(reviewCapability(
        "project-1",
        "quota-1",
        quotaRow("quota-1", "approval_pending", {
          reviewEnabled: true
        })
      )))
      .mockResolvedValueOnce(jsonResponse({
        code: "PASSWORD_CONFIRMATION_FAILED",
        message: "当前密码不正确"
      }, 400))
      .mockResolvedValueOnce(jsonResponse(reviewCapability(
        "project-1",
        "quota-1",
        quotaRow("quota-1", "approval_pending", {
          reviewEnabled: true
        })
      )))
      .mockResolvedValueOnce(jsonResponse({
        kind: "applied",
        actionId: reviewActionId,
        projectId: "project-1",
        quotaId: "quota-1"
      }))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1", {
        rows: [quotaRow("quota-1", "approval_pending", {
          lifecycleToken: nextReviewLifecycleToken
        })]
      })));
    const state = createProjectFinancingQuotaReviewAttemptState();

    await expect(reviewProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      initialInput,
      state
    )).rejects.toMatchObject({ status: 400 });
    await expect(reviewProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      { ...initialInput, confirmationPassword: "corrected-password" },
      state
    )).resolves.toMatchObject({ receipt: { kind: "applied" } });

    const bodies = mockApiFetch.mock.calls
      .filter((call) =>
        call[0] === "/projects/project-1/financing-quotas/quota-1/approval"
      )
      .map((call) => JSON.parse(String(call[1]?.body)) as Record<string, unknown>);
    expect(bodies).toMatchObject([
      { confirmationPassword: "current-password", actionId: reviewActionId },
      { confirmationPassword: "corrected-password", actionId: reviewActionId }
    ]);
  });

  it("re-preflights a deterministic 409 and performs no second POST after token drift", async () => {
    const context = { current: true };
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(reviewCapability(
        "project-1",
        "quota-1",
        quotaRow("quota-1", "approval_pending", {
          reviewEnabled: true
        })
      )))
      .mockResolvedValueOnce(jsonResponse({
        code: "PROJECT_FINANCING_QUOTA_REVIEW_CONFLICT",
        message: "额度状态已变化"
      }, 409))
      .mockResolvedValueOnce(jsonResponse(reviewCapability(
        "project-1",
        "quota-1",
        quotaRow("quota-1", "approval_pending", {
          reviewEnabled: true,
          lifecycleToken: nextReviewLifecycleToken
        })
      )));
    const state = createProjectFinancingQuotaReviewAttemptState();
    const input = reviewInput(context);

    await expect(reviewProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      input,
      state
    )).rejects.toMatchObject({ status: 409 });
    await expect(reviewProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      input,
      state
    )).rejects.toThrow("审批资格已变化");

    expect(mockApiFetch.mock.calls.filter((call) =>
      call[0] === "/projects/project-1/financing-quotas/quota-1/approval"
    )).toHaveLength(1);
  });

  it("reads only the exact five-field single-target termination capability", async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResponse(terminationCapability(
      "project/1",
      "quota/1"
    )));

    await expect(fetchProjectFinancingQuotaTerminationCapability(
      "project/1",
      "quota/1"
    )).resolves.toMatchObject({
      projectId: "project/1",
      quotaId: "quota/1",
      status: "approved",
      lifecycleToken: terminationLifecycleToken
    });
    expect(mockApiFetch).toHaveBeenCalledWith(
      "/projects/project%2F1/financing-quotas/quota%2F1/termination-capability"
    );

    mockApiFetch.mockResolvedValueOnce(jsonResponse({
      ...terminationCapability("project-1", "quota-1"),
      roleKeys: ["finance_director"]
    }));
    await expect(fetchProjectFinancingQuotaTerminationCapability(
      "project-1",
      "quota-1"
    )).rejects.toMatchObject({
      status: 502,
      code: "PROJECT_FINANCING_QUOTA_INVALID_TERMINATION_CAPABILITY_RESPONSE"
    });

    const validCapability = terminationCapability("project-1", "quota-1");
    for (const terminateAction of [
      { ...validCapability.terminateAction, kind: "primary" },
      { ...validCapability.terminateAction, requiresFile: true },
      {
        ...validCapability.terminateAction,
        disabledReason: "服务端动作状态漂移"
      }
    ]) {
      mockApiFetch.mockResolvedValueOnce(jsonResponse({
        ...validCapability,
        terminateAction
      }));
      await expect(fetchProjectFinancingQuotaTerminationCapability(
        "project-1",
        "quota-1"
      )).rejects.toMatchObject({
        status: 502,
        code: "PROJECT_FINANCING_QUOTA_INVALID_TERMINATION_CAPABILITY_RESPONSE"
      });
    }
  });

  it("terminates only after the fresh exact action and accepts authoritative usage history including a new credit", async () => {
    const context = { current: true };
    const terminated = quotaRow("quota/1", "terminated", {
      lifecycleToken: nextTerminationLifecycleToken
    });
    terminated.usageGroups = [usageGroup({
      executionType: "payment_reversal",
      executionId: "reversal-1",
      currentQuotaDebitAmountCents: "0",
      currentQuotaCreditAmountCents: "1000",
      currentQuotaNetAmountCents: "-1000"
    })];
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(terminationCapability(
        "project/1",
        "quota/1"
      )))
      .mockResolvedValueOnce(jsonResponse({
        kind: "applied",
        actionId: terminationActionId,
        projectId: "project/1",
        quotaId: "quota/1"
      }))
      .mockResolvedValueOnce(jsonResponse(workbench("project/1", {
        rows: [terminated]
      })));

    await expect(terminateProjectFinancingQuotaWithPreflight(
      "project/1",
      "quota/1",
      terminationInput(context),
      createProjectFinancingQuotaTerminationAttemptState()
    )).resolves.toMatchObject({
      receipt: { kind: "applied", actionId: terminationActionId },
      workbench: {
        rows: [{
          status: "terminated",
          lifecycleToken: nextTerminationLifecycleToken,
          usageGroups: [{ executionType: "payment_reversal" }]
        }]
      }
    });

    expect(mockApiFetch.mock.calls.map((call) => call[0])).toEqual([
      "/projects/project%2F1/financing-quotas/quota%2F1/termination-capability",
      "/projects/project%2F1/financing-quotas/quota%2F1/termination",
      "/projects/project%2F1/financing-quotas"
    ]);
    expect(mockApiFetch.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        reason: "项目已具备自有资金，不再允许新占用",
        confirmationPassword: " current-password ",
        actionId: terminationActionId,
        expectedLifecycleToken: terminationLifecycleToken
      })
    });
  });

  it("uses Unicode code-point length for the termination reason", async () => {
    const context = { current: true };
    const terminated = quotaRow("quota-1", "terminated", {
      lifecycleToken: nextTerminationLifecycleToken
    });
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(terminationCapability(
        "project-1",
        "quota-1"
      )))
      .mockResolvedValueOnce(jsonResponse({
        kind: "applied",
        actionId: terminationActionId,
        projectId: "project-1",
        quotaId: "quota-1"
      }))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1", {
        rows: [terminated]
      })));

    await expect(terminateProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      terminationInput(context, { reason: "😀".repeat(500) }),
      createProjectFinancingQuotaTerminationAttemptState()
    )).resolves.toMatchObject({ receipt: { kind: "applied" } });
    expect(JSON.parse(String(mockApiFetch.mock.calls[1]?.[1]?.body)))
      .toMatchObject({ reason: "😀".repeat(500) });

    mockApiFetch.mockReset();
    await expect(terminateProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      terminationInput(context, { reason: "😀".repeat(501) }),
      createProjectFinancingQuotaTerminationAttemptState()
    )).rejects.toThrow("终止原因不能超过 500 个字符");
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it("rejects a termination receipt with undeclared fields", async () => {
    const context = { current: true };
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(terminationCapability(
        "project-1",
        "quota-1"
      )))
      .mockResolvedValueOnce(jsonResponse({
        kind: "applied",
        actionId: terminationActionId,
        projectId: "project-1",
        quotaId: "quota-1",
        status: "terminated"
      }));

    await expect(terminateProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      terminationInput(context),
      createProjectFinancingQuotaTerminationAttemptState()
    )).rejects.toMatchObject({
      status: 502,
      code: "PROJECT_FINANCING_QUOTA_INVALID_TERMINATION_RESPONSE"
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
  });

  it("shares one termination promise across a double confirmation", async () => {
    const context = { current: true };
    const post = deferred<Response>();
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(terminationCapability(
        "project-1",
        "quota-1"
      )))
      .mockReturnValueOnce(post.promise)
      .mockResolvedValueOnce(jsonResponse(workbench("project-1", {
        rows: [quotaRow("quota-1", "terminated", {
          lifecycleToken: nextTerminationLifecycleToken
        })]
      })));
    const state = createProjectFinancingQuotaTerminationAttemptState();
    const input = terminationInput(context);

    const first = terminateProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      input,
      state
    );
    const second = terminateProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      input,
      state
    );

    expect(second).toBe(first);
    await vi.waitFor(() => {
      expect(mockApiFetch.mock.calls.filter((call) =>
        call[0] === "/projects/project-1/financing-quotas/quota-1/termination"
      )).toHaveLength(1);
    });
    post.resolve(jsonResponse({
      kind: "applied",
      actionId: terminationActionId,
      projectId: "project-1",
      quotaId: "quota-1"
    }));
    await expect(first).resolves.toMatchObject({
      receipt: { actionId: terminationActionId }
    });
  });

  it("retries an unknown termination POST with the same action id, token and body", async () => {
    const context = { current: true };
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(terminationCapability(
        "project-1",
        "quota-1"
      )))
      .mockRejectedValueOnce(new TypeError("network result unknown"))
      .mockResolvedValueOnce(jsonResponse({
        kind: "replayed",
        actionId: terminationActionId,
        projectId: "project-1",
        quotaId: "quota-1"
      }))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1", {
        rows: [quotaRow("quota-1", "terminated", {
          lifecycleToken: nextTerminationLifecycleToken
        })]
      })));
    const state = createProjectFinancingQuotaTerminationAttemptState();
    const input = terminationInput(context);

    await expect(terminateProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      input,
      state
    )).rejects.toThrow("network result unknown");
    await expect(terminateProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      { ...input, reason: "不应替换冻结数据" },
      state
    )).resolves.toMatchObject({ receipt: { kind: "replayed" } });

    const postBodies = mockApiFetch.mock.calls
      .filter((call) =>
        call[0] === "/projects/project-1/financing-quotas/quota-1/termination"
      )
      .map((call) => call[1]?.body);
    expect(postBodies).toHaveLength(2);
    expect(new Set(postBodies)).toHaveProperty("size", 1);
    expect(mockApiFetch.mock.calls.filter((call) =>
      call[0] ===
        "/projects/project-1/financing-quotas/quota-1/termination-capability"
    )).toHaveLength(1);
  });

  it("retries only the authoritative GET after a durable termination receipt", async () => {
    const context = { current: true };
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(terminationCapability(
        "project-1",
        "quota-1"
      )))
      .mockResolvedValueOnce(jsonResponse({
        kind: "applied",
        actionId: terminationActionId,
        projectId: "project-1",
        quotaId: "quota-1"
      }))
      .mockRejectedValueOnce(new TypeError("refresh failed"))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1", {
        rows: [quotaRow("quota-1", "terminated", {
          lifecycleToken: nextTerminationLifecycleToken
        })]
      })));
    const state = createProjectFinancingQuotaTerminationAttemptState();
    const input = terminationInput(context);

    await expect(terminateProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      input,
      state
    )).rejects.toThrow("refresh failed");
    await expect(terminateProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      input,
      state
    )).resolves.toMatchObject({ receipt: { kind: "applied" } });

    expect(mockApiFetch.mock.calls.filter((call) =>
      call[0] === "/projects/project-1/financing-quotas/quota-1/termination"
    )).toHaveLength(1);
  });

  it("resets deterministic failures, re-preflights, and accepts corrected raw password", async () => {
    const context = { current: true };
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(terminationCapability(
        "project-1",
        "quota-1"
      )))
      .mockResolvedValueOnce(jsonResponse({
        code: "PASSWORD_CONFIRMATION_FAILED",
        message: "当前密码不正确"
      }, 400))
      .mockResolvedValueOnce(jsonResponse(terminationCapability(
        "project-1",
        "quota-1"
      )))
      .mockResolvedValueOnce(jsonResponse({
        kind: "applied",
        actionId: terminationActionId,
        projectId: "project-1",
        quotaId: "quota-1"
      }))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1", {
        rows: [quotaRow("quota-1", "terminated", {
          lifecycleToken: nextTerminationLifecycleToken
        })]
      })));
    const state = createProjectFinancingQuotaTerminationAttemptState();
    const input = terminationInput(context, { password: " wrong " });

    await expect(terminateProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      input,
      state
    )).rejects.toMatchObject({ status: 400 });
    await expect(terminateProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      { ...input, confirmationPassword: " corrected " },
      state
    )).resolves.toMatchObject({ receipt: { kind: "applied" } });

    const bodies = mockApiFetch.mock.calls
      .filter((call) =>
        call[0] === "/projects/project-1/financing-quotas/quota-1/termination"
      )
      .map((call) => JSON.parse(String(call[1]?.body)) as Record<string, unknown>);
    expect(bodies).toMatchObject([
      { confirmationPassword: " wrong ", actionId: terminationActionId },
      { confirmationPassword: " corrected ", actionId: terminationActionId }
    ]);
  });

  it("fails closed before termination POST on capability drift or invalidated context", async () => {
    const context = { current: true };
    mockApiFetch.mockResolvedValueOnce(jsonResponse(terminationCapability(
      "project-1",
      "quota-1",
      quotaRow("quota-1", "approved", {
        terminationEnabled: true,
        lifecycleToken: nextTerminationLifecycleToken
      })
    )));

    await expect(terminateProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      terminationInput(context),
      createProjectFinancingQuotaTerminationAttemptState()
    )).rejects.toThrow("终止资格已变化");

    const pending = deferred<Response>();
    mockApiFetch.mockReset();
    mockApiFetch.mockReturnValueOnce(pending.promise);
    const invalidated = terminateProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      terminationInput(context),
      createProjectFinancingQuotaTerminationAttemptState()
    );
    context.current = false;
    pending.resolve(jsonResponse(terminationCapability("project-1", "quota-1")));

    await expect(invalidated).rejects.toThrow("终止上下文已失效");
    expect(mockApiFetch.mock.calls.some((call) =>
      call[0] === "/projects/project-1/financing-quotas/quota-1/termination"
    )).toBe(false);
  });

  it("requires a unique terminated row with a changed lifecycle token after the receipt", async () => {
    const context = { current: true };
    const state = createProjectFinancingQuotaTerminationAttemptState();
    const input = terminationInput(context);
    mockApiFetch
      .mockResolvedValueOnce(jsonResponse(terminationCapability(
        "project-1",
        "quota-1"
      )))
      .mockResolvedValueOnce(jsonResponse({
        kind: "applied",
        actionId: terminationActionId,
        projectId: "project-1",
        quotaId: "quota-1"
      }))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1", {
        rows: [quotaRow("quota-1", "approved", {
          lifecycleToken: nextTerminationLifecycleToken
        })]
      })))
      .mockResolvedValueOnce(jsonResponse(workbench("project-1", {
        rows: [
          quotaRow("quota-1", "terminated", {
            lifecycleToken: nextTerminationLifecycleToken
          }),
          quotaRow("quota-1", "terminated", {
            lifecycleToken: nextTerminationLifecycleToken
          })
        ]
      })));

    await expect(terminateProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      input,
      state
    )).rejects.toMatchObject({
      code: "PROJECT_FINANCING_QUOTA_TERMINATION_NOT_AUTHORITATIVE"
    });
    await expect(terminateProjectFinancingQuotaWithPreflight(
      "project-1",
      "quota-1",
      input,
      state
    )).rejects.toMatchObject({
      code: "PROJECT_FINANCING_QUOTA_TERMINATION_TARGET_CHANGED"
    });
    expect(mockApiFetch.mock.calls.filter((call) =>
      call[0] === "/projects/project-1/financing-quotas/quota-1/termination"
    )).toHaveLength(1);
  });
});
