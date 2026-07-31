import { effectScope, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectExpenseApprovalDetailPage from "./ProjectExpenseApprovalDetailPage.vue";

const reviewRuntime = vi.hoisted(() => ({
  beforeUnmountCallbacks: [] as Array<() => void>,
  executeReview: vi.fn(),
  prepareReview: vi.fn(),
  fetchDetail: vi.fn(),
  postReview: vi.fn(),
  route: {
    params: {
      projectId: "project-a",
      expenseRequestId: "expense-a"
    }
  }
}));

vi.mock("vue", async (importOriginal) => {
  const original = await importOriginal<typeof import("vue")>();
  return {
    ...original,
    onBeforeUnmount: (callback: () => void) => {
      reviewRuntime.beforeUnmountCallbacks.push(callback);
    },
    onMounted: () => undefined,
    useSSRContext: () => ({ modules: new Set<string>() })
  };
});

vi.mock("vue-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("vue-router")>();
  return {
    ...original,
    useRoute: () => reviewRuntime.route
  };
});

vi.mock("../../api/core-flow-read.api", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../api/core-flow-read.api")
  >();
  return {
    ...original,
    executeProjectExpenseApprovalReviewAction: reviewRuntime.executeReview,
    prepareProjectExpenseApprovalReviewAction: reviewRuntime.prepareReview,
    fetchProjectExpenseApprovalDetail: reviewRuntime.fetchDetail
  };
});

reviewRuntime.route = reactive(reviewRuntime.route);

type MutableValue<T> = { value: T };
type ReviewDecision = "approve" | "reject";
type ReviewContext = {
  ownerScope: string;
  routeGeneration: number;
  detailEpoch: number;
  dialogGeneration: number;
  operationId: number;
  projectId: string;
  expenseRequestId: string;
  expectedExpenseUpdatedAt: string;
  expectedApprovalInstanceId: string;
  expectedNodeIndex: number;
  expectedApprovalUpdatedAt: string;
  decision: ReviewDecision;
  requiresSelfReviewConfirmation: boolean;
  approvedAmountCents?: string;
  comment?: string;
  selfReviewReason?: string;
  confirmationPassword?: string;
};
type PreparedReview =
  | {
      status: "ready";
      context: ReviewContext;
      preflight: ReturnType<typeof expenseDetail>;
    }
  | { status: "stale"; context: ReviewContext };
type PrepareInput = ReviewContext & {
  isCurrent: (context: ReviewContext) => boolean;
};
type ExecuteInput = {
  decision: ReviewDecision;
  capture: (decision: ReviewDecision) => ReviewContext | null;
  preflight: (context: ReviewContext) => Promise<PreparedReview>;
  current: (context: ReviewContext, prepared: PreparedReview) => boolean;
  complete: (context: ReviewContext, response: unknown) => void | Promise<void>;
  fail: (context: ReviewContext, error: unknown) => void | Promise<void>;
  finish: (context: ReviewContext) => void;
};
type PageBindings = {
  actionMessage: MutableValue<string>;
  confirmProjectExpenseReviewApprove: (values: {
    reason: string;
    password: string;
  }) => Promise<unknown>;
  confirmProjectExpenseReviewReject: (values: {
    reason: string;
    password: string;
  }) => Promise<unknown>;
  detail: MutableValue<ReturnType<typeof expenseDetail> | null>;
  form: {
    comment: string;
    approvedAmountYuan: string;
    selfReviewReason: string;
  };
  loadDetail: () => Promise<boolean>;
  projectExpenseWithdrawalCapability: MutableValue<
    ReturnType<typeof expenseDetail> | null
  >;
  requestProjectExpenseReview: (decision: ReviewDecision) => void;
  reviewConfirmation: {
    visible: boolean;
    kind: "approve" | "reject" | null;
    error: string;
  };
  reviewSubmitting: MutableValue<boolean>;
};

describe("project expense approve/reject page ownership", () => {
  beforeEach(() => {
    reviewRuntime.route.params.projectId = "project-a";
    reviewRuntime.route.params.expenseRequestId = "expense-a";
    reviewRuntime.beforeUnmountCallbacks.splice(0);
    reviewRuntime.executeReview.mockReset();
    reviewRuntime.prepareReview.mockReset();
    reviewRuntime.fetchDetail.mockReset();
    reviewRuntime.postReview.mockReset();
    reviewRuntime.fetchDetail.mockResolvedValue(expenseDetail());
    reviewRuntime.postReview.mockResolvedValue({ id: "expense-a" });
    reviewRuntime.prepareReview.mockImplementation((input: PrepareInput) => {
      const context = reviewContext(input);
      return Promise.resolve(
        input.isCurrent(context)
          ? { status: "ready", context, preflight: expenseDetail() }
          : { status: "stale", context }
      );
    });
    reviewRuntime.executeReview.mockImplementation(async (input: ExecuteInput) => {
      const context = input.capture(input.decision);
      if (!context) return { status: "not_started" };
      try {
        const prepared = await input.preflight(context);
        if (!input.current(context, prepared)) {
          return { status: "stale", context };
        }
        const response = await reviewRuntime.postReview(
          context.projectId,
          context.expenseRequestId,
          reviewPayload(context)
        );
        await input.complete(context, response);
        return { status: "completed", context, response };
      } catch (error) {
        await input.fail(context, error);
        return { status: "failed", context, error };
      } finally {
        input.finish(context);
      }
    });
  });

  it("opens only from raw authority with one enabled review action and complete coordinates", () => {
    const { bindings, scope } = setupPage();
    const authoritative = expenseDetail();
    const view = structuredClone(authoritative);
    view.availableActions[0]!.enabled = false;
    bindings.detail.value = view;
    bindings.projectExpenseWithdrawalCapability.value = authoritative;

    try {
      bindings.requestProjectExpenseReview("approve");
      expect(bindings.reviewConfirmation.visible).toBe(true);
      expect(bindings.reviewConfirmation.kind).toBe("approve");

      bindings.reviewConfirmation.visible = false;
      bindings.projectExpenseWithdrawalCapability.value = expenseDetail({
        actionEnabled: false
      });
      bindings.detail.value!.availableActions[0]!.enabled = true;
      bindings.requestProjectExpenseReview("approve");
      expect(bindings.reviewConfirmation.visible).toBe(false);

      bindings.projectExpenseWithdrawalCapability.value = expenseDetail({
        reviewApprovalContext: null
      });
      bindings.requestProjectExpenseReview("reject");
      expect(bindings.reviewConfirmation.visible).toBe(false);
      expect(reviewRuntime.prepareReview).not.toHaveBeenCalled();
    } finally {
      scope.stop();
    }
  });

  it("freezes approve amount, comment and self-review credentials", async () => {
    const { bindings, scope } = setupReviewPage({
      requiresSelfReviewConfirmation: true,
      canSetApprovedAmount: true
    });
    bindings.form.approvedAmountYuan = "800.00";
    bindings.form.comment = "  同意按核定金额支付  ";
    bindings.form.selfReviewReason = "  本人发起，已独立复核  ";

    try {
      bindings.requestProjectExpenseReview("approve");
      const request = bindings.confirmProjectExpenseReviewApprove({
        reason: "",
        password: " current-password "
      });
      bindings.form.approvedAmountYuan = "0.01";
      bindings.form.comment = "随后篡改";
      bindings.form.selfReviewReason = "随后篡改";
      await request;

      expect(reviewRuntime.prepareReview.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({
          projectId: "project-a",
          expenseRequestId: "expense-a",
          expectedExpenseUpdatedAt: "2026-07-31T00:00:00.000Z",
          expectedApprovalInstanceId: "approval-expense-a",
          expectedNodeIndex: 1,
          expectedApprovalUpdatedAt: "2026-07-31T00:05:00.000Z",
          decision: "approve",
          approvedAmountCents: "80000",
          comment: "同意按核定金额支付",
          requiresSelfReviewConfirmation: true,
          selfReviewReason: "本人发起，已独立复核",
          confirmationPassword: " current-password "
        })
      );
    } finally {
      scope.stop();
    }
  });

  it("uses the fixed reject handler and never carries an approved amount", async () => {
    const { bindings, scope } = setupReviewPage({ canSetApprovedAmount: true });
    bindings.form.approvedAmountYuan = "800.00";
    bindings.form.comment = "  支出依据不足  ";

    try {
      bindings.requestProjectExpenseReview("reject");
      await bindings.confirmProjectExpenseReviewReject({ reason: "", password: "" });

      const body = reviewRuntime.postReview.mock.calls[0]?.[2];
      expect(body).toEqual(
        expect.objectContaining({ decision: "reject", comment: "支出依据不足" })
      );
      expect(body).not.toHaveProperty("approvedAmountCents");
    } finally {
      scope.stop();
    }
  });

  it("invalidates route A before POST without refreshing or closing route B", async () => {
    const pending = deferred<PreparedReview>();
    reviewRuntime.prepareReview.mockReturnValueOnce(pending.promise);
    const { bindings, scope } = setupReviewPage();

    try {
      bindings.requestProjectExpenseReview("approve");
      const request = bindings.confirmProjectExpenseReviewApprove({
        reason: "",
        password: ""
      });
      const oldInput = reviewRuntime.prepareReview.mock.calls[0]?.[0] as PrepareInput;

      reviewRuntime.route.params.projectId = "project-b";
      reviewRuntime.route.params.expenseRequestId = "expense-b";
      reviewRuntime.fetchDetail.mockResolvedValue(
        expenseDetail({ projectId: "project-b", expenseRequestId: "expense-b" })
      );
      await bindings.loadDetail();
      bindings.form.comment = "支出依据不足";
      bindings.requestProjectExpenseReview("reject");
      expect(bindings.reviewConfirmation.kind).toBe("reject");

      pending.resolve({
        status: "ready",
        context: reviewContext(oldInput),
        preflight: expenseDetail()
      });
      await request;

      expect(reviewRuntime.postReview).not.toHaveBeenCalled();
      expect(bindings.reviewConfirmation.visible).toBe(true);
      expect(bindings.reviewConfirmation.kind).toBe("reject");
      expect(bindings.reviewSubmitting.value).toBe(false);
      expect(bindings.actionMessage.value).toBe("");
    } finally {
      scope.stop();
    }
  });

  it("keeps one busy owner across rapid confirm and ignores an unmounted owner", async () => {
    const pending = deferred<PreparedReview>();
    reviewRuntime.prepareReview.mockReturnValueOnce(pending.promise);
    const { bindings, scope } = setupReviewPage();

    bindings.requestProjectExpenseReview("approve");
    const first = bindings.confirmProjectExpenseReviewApprove({ reason: "", password: "" });
    const second = bindings.confirmProjectExpenseReviewApprove({ reason: "", password: "" });
    expect(reviewRuntime.prepareReview).toHaveBeenCalledTimes(1);
    expect(bindings.reviewSubmitting.value).toBe(true);

    const oldInput = reviewRuntime.prepareReview.mock.calls[0]?.[0] as PrepareInput;
    reviewRuntime.beforeUnmountCallbacks[0]?.();
    pending.resolve({
      status: "ready",
      context: reviewContext(oldInput),
      preflight: expenseDetail()
    });
    await Promise.all([first, second]);

    expect(reviewRuntime.postReview).not.toHaveBeenCalled();
    expect(bindings.reviewSubmitting.value).toBe(false);
    scope.stop();
  });
});

function setupReviewPage(overrides: Parameters<typeof expenseDetail>[0] = {}) {
  const page = setupPage();
  const detail = expenseDetail(overrides);
  page.bindings.detail.value = structuredClone(detail);
  page.bindings.projectExpenseWithdrawalCapability.value = detail;
  return page;
}

function setupPage() {
  const scope = effectScope();
  const bindings = scope.run(() =>
    (
      ProjectExpenseApprovalDetailPage as unknown as {
        setup: (
          props: Record<string, never>,
          context: { expose: () => void }
        ) => PageBindings;
      }
    ).setup({}, { expose: () => undefined })
  );
  if (!bindings) throw new Error("project expense detail setup failed");
  return { bindings, scope };
}

function expenseDetail(
  overrides: {
    projectId?: string;
    expenseRequestId?: string;
    expectedExpenseUpdatedAt?: string;
    expectedApprovalInstanceId?: string;
    expectedNodeIndex?: number;
    expectedApprovalUpdatedAt?: string;
    reviewApprovalContext?: null;
    actionEnabled?: boolean;
    requiresSelfReviewConfirmation?: boolean;
    canSetApprovedAmount?: boolean;
  } = {}
) {
  const projectId = overrides.projectId ?? "project-a";
  const expenseRequestId = overrides.expenseRequestId ?? "expense-a";
  const expectedExpenseUpdatedAt =
    overrides.expectedExpenseUpdatedAt ?? "2026-07-31T00:00:00.000Z";
  const requiresSelfReviewConfirmation =
    overrides.requiresSelfReviewConfirmation ?? false;
  const reviewAction = {
    key: "review_approval",
    label: "办理项目支出审批",
    kind: "primary",
    enabled: overrides.actionEnabled ?? true,
    disabledReason: null,
    requiresSelfReviewConfirmation
  };
  return {
    id: expenseRequestId,
    projectId,
    code: "ZC-2026-001",
    title: "项目支出审批",
    status: "approval_pending",
    statusLabel: "审批中",
    expenseTypeLabel: "费用报销",
    expenseSubtypeLabel: "差旅费",
    paymentSubject: "差旅费",
    reason: "项目现场协调",
    requestedAmountCents: "80000",
    approvedAmountCents: null,
    currentNodeName: "项目经理",
    canSetApprovedAmount: overrides.canSetApprovedAmount ?? false,
    reviewAction,
    approvalTimeline: [],
    lifecycleUpdatedAt: expectedExpenseUpdatedAt,
    hasPersistentDraft: false,
    availableActions: [reviewAction],
    blockedReasons: [],
    reviewApprovalContext:
      overrides.reviewApprovalContext === null
        ? null
        : {
            expectedExpenseUpdatedAt,
            expectedApprovalInstanceId:
              overrides.expectedApprovalInstanceId ?? "approval-expense-a",
            expectedNodeIndex: overrides.expectedNodeIndex ?? 1,
            expectedApprovalUpdatedAt:
              overrides.expectedApprovalUpdatedAt ??
              "2026-07-31T00:05:00.000Z"
          },
    withdrawalContext: null
  };
}

function reviewContext(input: PrepareInput): ReviewContext {
  return Object.freeze({
    ownerScope: input.ownerScope,
    routeGeneration: input.routeGeneration,
    detailEpoch: input.detailEpoch,
    dialogGeneration: input.dialogGeneration,
    operationId: input.operationId,
    projectId: input.projectId,
    expenseRequestId: input.expenseRequestId,
    expectedExpenseUpdatedAt: input.expectedExpenseUpdatedAt,
    expectedApprovalInstanceId: input.expectedApprovalInstanceId,
    expectedNodeIndex: input.expectedNodeIndex,
    expectedApprovalUpdatedAt: input.expectedApprovalUpdatedAt,
    decision: input.decision,
    requiresSelfReviewConfirmation: input.requiresSelfReviewConfirmation,
    ...(input.approvedAmountCents ? { approvedAmountCents: input.approvedAmountCents } : {}),
    ...(input.comment ? { comment: input.comment } : {}),
    ...(input.selfReviewReason ? { selfReviewReason: input.selfReviewReason } : {}),
    ...(input.confirmationPassword ? { confirmationPassword: input.confirmationPassword } : {})
  });
}

function reviewPayload(context: ReviewContext) {
  return {
    decision: context.decision,
    ...(context.decision === "approve" && context.approvedAmountCents
      ? { approvedAmountCents: context.approvedAmountCents }
      : {}),
    ...(context.comment ? { comment: context.comment } : {}),
    ...(context.requiresSelfReviewConfirmation
      ? {
          selfReviewReason: context.selfReviewReason,
          confirmationPassword: context.confirmationPassword
        }
      : {}),
    expectedExpenseUpdatedAt: context.expectedExpenseUpdatedAt,
    expectedApprovalInstanceId: context.expectedApprovalInstanceId,
    expectedNodeIndex: context.expectedNodeIndex,
    expectedApprovalUpdatedAt: context.expectedApprovalUpdatedAt
  };
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
