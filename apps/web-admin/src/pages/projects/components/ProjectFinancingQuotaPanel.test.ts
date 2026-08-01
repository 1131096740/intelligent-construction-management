import { effectScope, nextTick, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectFinancingQuotaPanel from "./ProjectFinancingQuotaPanel.vue";
import type {
  ExecuteProjectFinancingQuotaReviewActionInput,
  ProjectFinancingQuotaReviewDecision,
  ProjectFinancingQuotaReviewExecutionState,
  ProjectFinancingQuotaReviewResult,
  ProjectFinancingQuotaRequestResult,
  ProjectFinancingQuotaWorkbenchReadModel
} from "../../../api/project-financing-quota.api";

const quotaRuntime = vi.hoisted(() => ({
  beforeUnmount: vi.fn(),
  executeReview: vi.fn(),
  fetchWorkbench: vi.fn(),
  fetchReview: vi.fn(),
  review: vi.fn(),
  request: vi.fn()
}));

vi.mock("vue", async (importOriginal) => {
  const original = await importOriginal<typeof import("vue")>();
  return {
    ...original,
    onBeforeUnmount: quotaRuntime.beforeUnmount,
    useSSRContext: () => ({ modules: new Set<string>() })
  };
});

vi.mock("../../../api/project-financing-quota.api", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../../api/project-financing-quota.api")
  >();
  return {
    ...original,
    executeProjectFinancingQuotaReviewAction: quotaRuntime.executeReview,
    fetchProjectFinancingQuotaRequestCapability: quotaRuntime.fetchWorkbench,
    fetchProjectFinancingQuotaReviewCapability: quotaRuntime.fetchReview,
    reviewProjectFinancingQuotaWithPreflight: quotaRuntime.review,
    requestProjectFinancingQuotaWithUpload: quotaRuntime.request
  };
});

type MutableValue<T> = { value: T };
type RequestContext = {
  projectId: string;
  projectGeneration: number;
  idempotencyKey: string;
};
type ReviewContext = {
  projectId: string;
  quotaId: string;
  projectGeneration: number;
  actionId: string;
  lifecycleToken: string;
  decision: ProjectFinancingQuotaReviewDecision;
  requiresSelfReviewConfirmation: boolean;
};
type ReviewOperationContext = ReviewContext & { operationId: number };
type PanelBindings = {
  openRequest: () => Promise<void>;
  requestBusy: MutableValue<boolean>;
  requestContext: MutableValue<RequestContext>;
  requestError: MutableValue<string>;
  requestLaunchError: MutableValue<string>;
  requestFiles: MutableValue<Array<{ raw?: File }>>;
  requestForm: MutableValue<{
    amountYuan: string;
    reason: string;
    validUntil: string;
  }>;
  requestVisible: MutableValue<boolean>;
  openReview: (
    row: ProjectFinancingQuotaWorkbenchReadModel["rows"][number],
    decision: ProjectFinancingQuotaReviewDecision
  ) => Promise<void>;
  reviewContext: MutableValue<ReviewContext>;
  reviewError: MutableValue<string>;
  reviewForm: MutableValue<{
    comment: string;
    confirmationPassword: string;
    selfReviewReason: string;
  }>;
  reviewLaunchError: MutableValue<string>;
  reviewVisible: MutableValue<boolean>;
  submitApproveReview: () => Promise<unknown>;
  submitRejectReview: () => Promise<unknown>;
  submitRequest: () => Promise<unknown>;
};

const reviewLifecycleToken = "a".repeat(64);
const nextReviewLifecycleToken = "b".repeat(64);

function action(enabled = true) {
  return {
    key: "request_financing_quota",
    label: "申请垫资额度",
    kind: "primary",
    enabled,
    disabledReason: enabled ? null : "当前不可申请",
    requiredAction: "project.financing_quota.request",
    requiresFile: true
  };
}

function workbench(
  projectId: string,
  rows: ProjectFinancingQuotaWorkbenchReadModel["rows"] = []
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
    requestAction: action(),
    rows
  };
}

function reviewAction(
  enabled = true,
  requiresSelfReviewConfirmation = false
) {
  return {
    key: "review_financing_quota",
    label: "审批垫资额度",
    kind: "primary",
    enabled,
    disabledReason: enabled ? null : "当前不可审批",
    requiredAction: "project.financing_quota.approve",
    requiresPassword: true,
    requiresSelfReviewConfirmation
  };
}

function quotaRow(
  options: {
    enabled?: boolean;
    lifecycleToken?: string;
    requiresSelfReviewConfirmation?: boolean;
  } = {}
): ProjectFinancingQuotaWorkbenchReadModel["rows"][number] {
  return {
    id: "quota-1",
    amountCents: "5000000",
    reason: "阶段性垫资保障项目付款",
    validUntil: null,
    status: "approval_pending",
    statusLabel: "审批中",
    requestedByName: "财务主管甲",
    approvedByName: null,
    approvedAt: null,
    terminatedAt: null,
    terminatedByName: null,
    terminationReason: null,
    createdAt: "2026-08-02T01:00:00.000Z",
    updatedAt: "2026-08-02T01:00:00.000Z",
    isExpired: false,
    netUsedAmountCents: "0",
    availableAmountCents: "0",
    currentApproval: {
      status: "in_progress",
      currentNodeIndex: 0,
      currentNodeName: "财务主管"
    },
    lifecycleToken: options.lifecycleToken ?? reviewLifecycleToken,
    reviewAction: reviewAction(
      options.enabled ?? true,
      options.requiresSelfReviewConfirmation ?? false
    ),
    terminateAction: {
      key: "terminate_financing_quota",
      label: "终止垫资额度",
      kind: "danger",
      enabled: false,
      disabledReason: "审批中不可终止",
      requiredAction: "project.financing_quota.terminate",
      requiresPassword: true
    },
    usageGroups: []
  };
}

function reviewCapability(
  projectId: string,
  row = quotaRow()
) {
  return {
    projectId,
    quotaId: row.id,
    status: row.status,
    lifecycleToken: row.lifecycleToken,
    reviewAction: row.reviewAction
  };
}

function reviewResult(projectId: string): ProjectFinancingQuotaReviewResult {
  return {
    receipt: {
      kind: "applied",
      actionId: "22222222-2222-4222-8222-222222222222",
      projectId,
      quotaId: "quota-1"
    },
    workbench: workbench(projectId, [quotaRow({
      enabled: false,
      lifecycleToken: nextReviewLifecycleToken
    })])
  };
}

function result(projectId: string): ProjectFinancingQuotaRequestResult {
  return {
    receipt: {
      kind: "created",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      projectId,
      quotaId: "quota-1"
    },
    workbench: workbench(projectId)
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

function installReviewExecutorMock() {
  quotaRuntime.executeReview.mockImplementation((
    input: ExecuteProjectFinancingQuotaReviewActionInput<ReviewOperationContext>,
    state: ProjectFinancingQuotaReviewExecutionState<ReviewOperationContext>
  ) => {
    if (state.promise) return state.promise;
    const submission = input.capture(input.decision);
    if (!submission) {
      return Promise.resolve({ status: "not_started" as const });
    }
    const context = submission.context;
    const execution = Promise.resolve(quotaRuntime.review(
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
    )).then(async (result: ProjectFinancingQuotaReviewResult) => {
      if (!input.current(context)) {
        return { status: "stale" as const, context };
      }
      await input.complete(context, result);
      return { status: "completed" as const, context, result };
    }).catch(async (error: unknown) => {
      await input.fail(context, error);
      return { status: "failed" as const, context };
    }).finally(() => {
      input.finish(context);
      if (state.promise === execution) state.promise = null;
    });
    state.promise = execution;
    return execution;
  });
}

function setupPanel(projectId = "project-a") {
  const props = reactive({
    projectId,
    workbench: workbench(projectId)
  });
  const emit = vi.fn();
  const scope = effectScope();
  const bindings = scope.run(() =>
    (
      ProjectFinancingQuotaPanel as unknown as {
        setup: (
          panelProps: typeof props,
          context: { emit: typeof emit; expose: () => void }
        ) => PanelBindings;
      }
    ).setup(props, { emit, expose: () => undefined })
  );
  if (!bindings) throw new Error("financing quota panel setup failed");
  const invokeBeforeUnmount = () => {
    const callback = quotaRuntime.beforeUnmount.mock.calls.at(-1)?.[0];
    if (typeof callback !== "function") {
      throw new Error("financing quota unmount hook missing");
    }
    callback();
  };
  return { bindings, emit, invokeBeforeUnmount, props, scope };
}

describe("project financing quota F1 panel", () => {
  beforeEach(() => {
    quotaRuntime.beforeUnmount.mockReset();
    quotaRuntime.executeReview.mockReset();
    quotaRuntime.fetchWorkbench.mockReset();
    quotaRuntime.fetchReview.mockReset();
    quotaRuntime.review.mockReset();
    quotaRuntime.request.mockReset();
    installReviewExecutorMock();
  });

  it("freezes one dialog attempt and emits only the authoritative refreshed workbench", async () => {
    quotaRuntime.fetchWorkbench.mockResolvedValueOnce(workbench("project-a"));
    quotaRuntime.request.mockResolvedValueOnce(result("project-a"));
    const { bindings, emit, scope } = setupPanel();

    await bindings.openRequest();
    expect(bindings.requestVisible.value).toBe(true);
    expect(bindings.requestContext.value).toMatchObject({
      projectId: "project-a",
      projectGeneration: 0
    });
    expect(bindings.requestContext.value.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    );
    bindings.requestForm.value = {
      amountYuan: "50000",
      reason: "保障现场付款",
      validUntil: ""
    };
    bindings.requestFiles.value = [{
      raw: new File(["voucher"], "financing.pdf", {
        type: "application/pdf"
      })
    }];

    await bindings.submitRequest();

    expect(emit).toHaveBeenCalledWith("updated", expect.objectContaining({
      project: expect.objectContaining({ id: "project-a" })
    }));
    expect(bindings.requestVisible.value).toBe(false);
    scope.stop();
  });

  it("does not publish a late result after the project switches", async () => {
    const pending = deferred<ProjectFinancingQuotaRequestResult>();
    quotaRuntime.fetchWorkbench.mockResolvedValueOnce(workbench("project-a"));
    quotaRuntime.request.mockReturnValueOnce(pending.promise);
    const { bindings, emit, props, scope } = setupPanel();

    await bindings.openRequest();
    const submission = bindings.submitRequest();
    const requestInput = quotaRuntime.request.mock.calls[0]?.[1];
    props.projectId = "project-b";
    props.workbench = workbench("project-b");
    await nextTick();

    expect(requestInput.isCurrent(requestInput.context)).toBe(false);
    pending.resolve(result("project-a"));
    await submission;
    await flushPromises();

    expect(emit).not.toHaveBeenCalledWith("updated", expect.anything());
    expect(bindings.requestVisible.value).toBe(false);
    scope.stop();
  });

  it("does not publish a late result after unmount", async () => {
    const pending = deferred<ProjectFinancingQuotaRequestResult>();
    quotaRuntime.fetchWorkbench.mockResolvedValueOnce(workbench("project-a"));
    quotaRuntime.request.mockReturnValueOnce(pending.promise);
    const { bindings, emit, invokeBeforeUnmount, scope } = setupPanel();

    await bindings.openRequest();
    const submission = bindings.submitRequest();
    const requestInput = quotaRuntime.request.mock.calls[0]?.[1];
    invokeBeforeUnmount();

    expect(requestInput.isCurrent(requestInput.context)).toBe(false);
    pending.resolve(result("project-a"));
    await submission;
    await flushPromises();

    expect(emit).not.toHaveBeenCalledWith("updated", expect.anything());
    scope.stop();
  });

  it("normalizes a malformed fresh capability response before opening the dialog", async () => {
    quotaRuntime.fetchWorkbench.mockRejectedValueOnce(
      new SyntaxError("Unexpected end of JSON input")
    );
    const { bindings, scope } = setupPanel();

    await bindings.openRequest();

    expect(bindings.requestVisible.value).toBe(false);
    expect(bindings.requestLaunchError.value).toBe(
      "项目垫资额度申请资格数据异常，请刷新后重试"
    );
    scope.stop();
  });
});

describe("project financing quota F2 review panel", () => {
  beforeEach(() => {
    quotaRuntime.beforeUnmount.mockReset();
    quotaRuntime.executeReview.mockReset();
    quotaRuntime.fetchWorkbench.mockReset();
    quotaRuntime.fetchReview.mockReset();
    quotaRuntime.review.mockReset();
    quotaRuntime.request.mockReset();
    installReviewExecutorMock();
  });

  it("opens from the exact fresh server action and emits only the authoritative review refresh", async () => {
    const row = quotaRow();
    quotaRuntime.fetchReview.mockResolvedValueOnce(
      reviewCapability("project-a", row)
    );
    quotaRuntime.review.mockResolvedValueOnce(reviewResult("project-a"));
    const { bindings, emit, scope } = setupPanel();

    await bindings.openReview(row, "approve");

    expect(bindings.reviewVisible.value).toBe(true);
    expect(bindings.reviewContext.value).toMatchObject({
      projectId: "project-a",
      quotaId: "quota-1",
      lifecycleToken: reviewLifecycleToken,
      decision: "approve",
      requiresSelfReviewConfirmation: false
    });
    expect(bindings.reviewContext.value.actionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    );
    const actionId = bindings.reviewContext.value.actionId;
    bindings.reviewForm.value = {
      comment: "同意",
      confirmationPassword: "current-password",
      selfReviewReason: ""
    };

    await bindings.submitApproveReview();

    expect(quotaRuntime.review).toHaveBeenCalledWith(
      "project-a",
      "quota-1",
      expect.objectContaining({
        decision: "approve",
        actionId,
        lifecycleToken: reviewLifecycleToken,
        requiresSelfReviewConfirmation: false,
        confirmationPassword: "current-password"
      }),
      expect.any(Object)
    );
    expect(emit).toHaveBeenCalledWith("updated", expect.objectContaining({
      project: expect.objectContaining({ id: "project-a" })
    }));
    expect(bindings.reviewVisible.value).toBe(false);
    scope.stop();
  });

  it("requires the independent self-review explanation before calling the API", async () => {
    const row = quotaRow({ requiresSelfReviewConfirmation: true });
    quotaRuntime.fetchReview.mockResolvedValueOnce(
      reviewCapability("project-a", row)
    );
    const { bindings, scope } = setupPanel();

    await bindings.openReview(row, "approve");
    bindings.reviewForm.value = {
      comment: "同意",
      confirmationPassword: "current-password",
      selfReviewReason: ""
    };
    await bindings.submitApproveReview();

    expect(quotaRuntime.review).not.toHaveBeenCalled();
    expect(bindings.reviewError.value).toContain("本人独立复核说明");
    scope.stop();
  });

  it("does not submit when the literal review handler disagrees with the frozen dialog decision", async () => {
    const row = quotaRow();
    quotaRuntime.fetchReview.mockResolvedValueOnce(
      reviewCapability("project-a", row)
    );
    const { bindings, scope } = setupPanel();

    await bindings.openReview(row, "approve");
    bindings.reviewForm.value.confirmationPassword = "current-password";
    await bindings.submitRejectReview();

    expect(quotaRuntime.review).not.toHaveBeenCalled();
    expect(bindings.reviewError.value).toContain("审批上下文已失效");
    scope.stop();
  });

  it("delegates a double confirmation to one review execution", async () => {
    const row = quotaRow();
    const pending = deferred<ProjectFinancingQuotaReviewResult>();
    quotaRuntime.fetchReview.mockResolvedValueOnce(
      reviewCapability("project-a", row)
    );
    quotaRuntime.review.mockReturnValueOnce(pending.promise);
    const { bindings, scope } = setupPanel();

    await bindings.openReview(row, "approve");
    bindings.reviewForm.value.confirmationPassword = "current-password";
    const first = bindings.submitApproveReview();
    const second = bindings.submitApproveReview();

    expect(quotaRuntime.executeReview).toHaveBeenCalledTimes(2);
    expect(quotaRuntime.executeReview.mock.calls[1]?.[1]).toBe(
      quotaRuntime.executeReview.mock.calls[0]?.[1]
    );
    expect(quotaRuntime.executeReview.mock.results[1]?.value).toBe(
      quotaRuntime.executeReview.mock.results[0]?.value
    );
    expect(quotaRuntime.review).toHaveBeenCalledTimes(1);
    pending.resolve(reviewResult("project-a"));
    await Promise.all([first, second]);
    scope.stop();
  });

  it("reuses the same action id and lifecycle token after an unknown result", async () => {
    const row = quotaRow();
    quotaRuntime.fetchReview.mockResolvedValueOnce(
      reviewCapability("project-a", row)
    );
    quotaRuntime.review
      .mockRejectedValueOnce(new TypeError("network result unknown"))
      .mockResolvedValueOnce(reviewResult("project-a"));
    const { bindings, scope } = setupPanel();

    await bindings.openReview(row, "approve");
    bindings.reviewForm.value.confirmationPassword = "current-password";
    await bindings.submitApproveReview();
    await bindings.submitApproveReview();

    const firstInput = quotaRuntime.review.mock.calls[0]?.[2];
    const secondInput = quotaRuntime.review.mock.calls[1]?.[2];
    expect(secondInput.actionId).toBe(firstInput.actionId);
    expect(secondInput.lifecycleToken).toBe(firstInput.lifecycleToken);
    scope.stop();
  });

  it("does not publish a late review result after the project switches", async () => {
    const row = quotaRow();
    const pending = deferred<ProjectFinancingQuotaReviewResult>();
    quotaRuntime.fetchReview.mockResolvedValueOnce(
      reviewCapability("project-a", row)
    );
    quotaRuntime.review.mockReturnValueOnce(pending.promise);
    const { bindings, emit, props, scope } = setupPanel();

    await bindings.openReview(row, "approve");
    bindings.reviewForm.value.confirmationPassword = "current-password";
    const submission = bindings.submitApproveReview();
    const reviewInput = quotaRuntime.review.mock.calls[0]?.[2];
    props.projectId = "project-b";
    props.workbench = workbench("project-b");
    await nextTick();

    expect(reviewInput.isCurrent(reviewInput.context)).toBe(false);
    pending.resolve(reviewResult("project-a"));
    await submission;
    await flushPromises();

    expect(emit).not.toHaveBeenCalledWith("updated", expect.anything());
    expect(bindings.reviewVisible.value).toBe(false);
    scope.stop();
  });

  it("does not arm a review dialog from a late fresh read after the project switches", async () => {
    const row = quotaRow();
    const pending = deferred<ReturnType<typeof reviewCapability>>();
    quotaRuntime.fetchReview.mockReturnValueOnce(pending.promise);
    const { bindings, props, scope } = setupPanel();

    const opening = bindings.openReview(row, "approve");
    props.projectId = "project-b";
    props.workbench = workbench("project-b");
    await nextTick();
    pending.resolve(reviewCapability("project-a", row));
    await opening;
    await flushPromises();

    expect(bindings.reviewVisible.value).toBe(false);
    expect(bindings.reviewLaunchError.value).toBe("");
    scope.stop();
  });

  it("does not publish a late review result after unmount", async () => {
    const row = quotaRow();
    const pending = deferred<ProjectFinancingQuotaReviewResult>();
    quotaRuntime.fetchReview.mockResolvedValueOnce(
      reviewCapability("project-a", row)
    );
    quotaRuntime.review.mockReturnValueOnce(pending.promise);
    const { bindings, emit, invokeBeforeUnmount, scope } = setupPanel();

    await bindings.openReview(row, "reject");
    bindings.reviewForm.value.confirmationPassword = "current-password";
    const submission = bindings.submitRejectReview();
    const reviewInput = quotaRuntime.review.mock.calls[0]?.[2];
    invokeBeforeUnmount();

    expect(reviewInput.isCurrent(reviewInput.context)).toBe(false);
    pending.resolve(reviewResult("project-a"));
    await submission;
    await flushPromises();

    expect(emit).not.toHaveBeenCalledWith("updated", expect.anything());
    scope.stop();
  });

  it("fails closed when the fresh review action is no longer enabled", async () => {
    const localRow = quotaRow();
    quotaRuntime.fetchReview.mockResolvedValueOnce(
      reviewCapability("project-a", quotaRow({ enabled: false }))
    );
    const { bindings, scope } = setupPanel();

    await bindings.openReview(localRow, "approve");

    expect(bindings.reviewVisible.value).toBe(false);
    expect(bindings.reviewLaunchError.value).toContain("审批资格已变化");
    scope.stop();
  });
});
