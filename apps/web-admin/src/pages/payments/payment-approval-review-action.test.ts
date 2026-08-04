import { effectScope, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PaymentDetailPage from "./PaymentDetailPage.vue";

const reviewRuntime = vi.hoisted(() => ({
  beforeUnmountCallbacks: [] as Array<() => void>,
  executeReview: vi.fn(),
  prepareReview: vi.fn(),
  fetchDetail: vi.fn(),
  postReview: vi.fn(),
  directReview: vi.fn(),
  route: { params: { paymentId: "payment-a" } }
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
    useRoute: () => reviewRuntime.route,
    useRouter: () => ({ push: vi.fn() })
  };
});

vi.mock("../../api/core-flow-read.api", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../api/core-flow-read.api")
  >();
  return {
    ...original,
    executePaymentApprovalReviewAction: reviewRuntime.executeReview,
    preparePaymentApprovalReviewAction: reviewRuntime.prepareReview,
    fetchPaymentDetail: reviewRuntime.fetchDetail,
    reviewPaymentApproval: reviewRuntime.directReview
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
  paymentId: string;
  expectedPaymentUpdatedAt: string;
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
  | { status: "ready"; context: ReviewContext; preflight: ReturnType<typeof paymentDetail> }
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
type PaymentPageBindings = {
  actionBusy: MutableValue<string>;
  actionMessage: MutableValue<string>;
  confirmPaymentApprovalApprove: (values: {
    reason: string;
    password: string;
  }) => Promise<unknown>;
  confirmPaymentApprovalReject: (values: {
    reason: string;
    password: string;
  }) => Promise<unknown>;
  clearPaymentDetailTransientState: () => void;
  paymentActionForm: {
    approvedAmountYuan: string;
    approvalComment: string;
    selfReviewReason: string;
  };
  paymentApprovalCapability: MutableValue<unknown>;
  paymentDetail: MutableValue<unknown>;
  reloadPaymentDetail: () => Promise<boolean>;
  requestApproval: (decision: ReviewDecision) => void;
  sensitiveAction: {
    visible: boolean;
    kind: string | null;
    error: string;
  };
};

describe("payment approve/reject page ownership", () => {
  beforeEach(() => {
    reviewRuntime.route.params.paymentId = "payment-a";
    reviewRuntime.beforeUnmountCallbacks.splice(0);
    reviewRuntime.executeReview.mockReset();
    reviewRuntime.prepareReview.mockReset();
    reviewRuntime.fetchDetail.mockReset();
    reviewRuntime.postReview.mockReset();
    reviewRuntime.directReview.mockReset();
    reviewRuntime.fetchDetail.mockResolvedValue(paymentDetail());
    reviewRuntime.postReview.mockResolvedValue({ id: "ok" });
    reviewRuntime.prepareReview.mockImplementation((input: PrepareInput) => {
      const context = reviewContext(input);
      return Promise.resolve(
        input.isCurrent(context)
          ? { status: "ready", context, preflight: paymentDetail() }
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
          context.paymentId,
          reviewPayload(context)
        );
        await input.complete(context, response);
        return { status: "completed", context, response };
      } catch (error) {
        await input.fail(context, error);
        return { status: "failed", context };
      } finally {
        input.finish(context);
      }
    });
  });

  it("opens only from the raw authoritative capability and complete four-coordinate context", () => {
    const { bindings, scope } = setupPage();
    const authoritative = paymentDetail();
    const view = structuredClone(authoritative);
    view.availableActions[0]!.enabled = false;
    bindings.paymentDetail.value = view;
    bindings.paymentApprovalCapability.value = authoritative;

    try {
      bindings.requestApproval("approve");
      expect(bindings.sensitiveAction.visible).toBe(true);
      expect(bindings.sensitiveAction.kind).toBe("approvalApprove");

      bindings.sensitiveAction.visible = false;
      bindings.paymentApprovalCapability.value = paymentDetail({
        actionEnabled: false
      });
      (bindings.paymentDetail.value as ReturnType<typeof paymentDetail>)
        .availableActions[0]!.enabled = true;
      bindings.requestApproval("approve");
      expect(bindings.sensitiveAction.visible).toBe(false);

      bindings.paymentApprovalCapability.value = paymentDetail({
        reviewApprovalContext: null
      });
      bindings.requestApproval("reject");
      expect(bindings.sensitiveAction.visible).toBe(false);
      expect(reviewRuntime.prepareReview).not.toHaveBeenCalled();
    } finally {
      scope.stop();
    }
  });

  it("freezes approve amount, comment and self-review credentials behind the fixed handler", async () => {
    const { bindings, scope } = setupReviewPage({
      requiresSelfReviewConfirmation: true
    });
    bindings.paymentActionForm.approvedAmountYuan = "50000";
    bindings.paymentActionForm.approvalComment = "  同意按核定金额付款  ";
    bindings.paymentActionForm.selfReviewReason = "  本人发起，已独立复核  ";

    try {
      bindings.requestApproval("approve");
      const request = bindings.confirmPaymentApprovalApprove({
        reason: "",
        password: " current-password "
      });
      bindings.paymentActionForm.approvedAmountYuan = "0.01";
      bindings.paymentActionForm.approvalComment = "随后篡改";
      bindings.paymentActionForm.selfReviewReason = "随后篡改";
      await request;

      const input = reviewRuntime.prepareReview.mock.calls[0]?.[0] as PrepareInput;
      expect(input).toEqual(
        expect.objectContaining({
          paymentId: "payment-a",
          expectedPaymentUpdatedAt: "2026-07-31T00:00:00.000Z",
          expectedApprovalInstanceId: "approval-a",
          expectedNodeIndex: 1,
          expectedApprovalUpdatedAt: "2026-07-31T00:05:00.000Z",
          decision: "approve",
          approvedAmountCents: "5000000",
          comment: "同意按核定金额付款",
          requiresSelfReviewConfirmation: true,
          selfReviewReason: "本人发起，已独立复核",
          confirmationPassword: " current-password "
        })
      );
      expect(reviewRuntime.postReview).toHaveBeenCalledWith(
        "payment-a",
        expect.objectContaining({
          decision: "approve",
          approvedAmountCents: "5000000",
          comment: "同意按核定金额付款"
        })
      );
      expect(reviewRuntime.directReview).not.toHaveBeenCalled();
    } finally {
      scope.stop();
    }
  });

  it("uses the fixed reject handler and never carries an approved amount", async () => {
    const { bindings, scope } = setupReviewPage();
    bindings.paymentActionForm.approvedAmountYuan = "50000";
    bindings.paymentActionForm.approvalComment = "  付款依据不足  ";

    try {
      bindings.requestApproval("reject");
      await bindings.confirmPaymentApprovalReject({
        reason: "",
        password: ""
      });

      expect(reviewRuntime.postReview).toHaveBeenCalledWith(
        "payment-a",
        expect.not.objectContaining({ approvedAmountCents: expect.anything() })
      );
      expect(reviewRuntime.postReview.mock.calls[0]?.[1]).toEqual(
        expect.objectContaining({
          decision: "reject",
          comment: "付款依据不足"
        })
      );
      expect(reviewRuntime.directReview).not.toHaveBeenCalled();
    } finally {
      scope.stop();
    }
  });

  it("invalidates route A work before POST without refreshing or closing route B", async () => {
    const pending = deferred<PreparedReview>();
    reviewRuntime.prepareReview.mockReturnValueOnce(pending.promise);
    const { bindings, scope } = setupReviewPage();
    bindings.paymentActionForm.approvalComment = "同意";

    try {
      bindings.requestApproval("approve");
      const request = bindings.confirmPaymentApprovalApprove({
        reason: "",
        password: ""
      });
      const oldInput = reviewRuntime.prepareReview.mock.calls[0]?.[0] as PrepareInput;

      reviewRuntime.route.params.paymentId = "payment-b";
      reviewRuntime.fetchDetail.mockResolvedValueOnce(
        paymentDetail({ paymentId: "payment-b" })
      );
      bindings.clearPaymentDetailTransientState();
      await bindings.reloadPaymentDetail();
      expect(
        (bindings.paymentApprovalCapability.value as ReturnType<
          typeof paymentDetail
        >).id
      ).toBe("payment-b");
      expect(bindings.actionBusy.value).toBe("");
      bindings.paymentActionForm.approvalComment = "付款依据不足";
      bindings.requestApproval("reject");
      expect(bindings.sensitiveAction.visible).toBe(true);

      pending.resolve({
        status: "ready",
        context: reviewContext(oldInput),
        preflight: paymentDetail()
      });
      await request;

      expect(reviewRuntime.postReview).not.toHaveBeenCalled();
      expect(bindings.sensitiveAction.visible).toBe(true);
      expect(bindings.sensitiveAction.kind).toBe("approvalReject");
      expect(bindings.actionBusy.value).toBe("");
      expect(bindings.actionMessage.value).toBe("");
    } finally {
      scope.stop();
    }
  });

  it("keeps one busy owner across rapid re-entry and ignores an unmounted owner", async () => {
    const pending = deferred<PreparedReview>();
    reviewRuntime.prepareReview.mockReturnValueOnce(pending.promise);
    const { bindings, scope } = setupReviewPage();

    bindings.requestApproval("approve");
    const first = bindings.confirmPaymentApprovalApprove({
      reason: "",
      password: ""
    });
    const second = bindings.confirmPaymentApprovalApprove({
      reason: "",
      password: ""
    });
    expect(reviewRuntime.prepareReview).toHaveBeenCalledTimes(1);
    expect(bindings.actionBusy.value).toBe("approval");

    const oldInput = reviewRuntime.prepareReview.mock.calls[0]?.[0] as PrepareInput;
    reviewRuntime.beforeUnmountCallbacks[0]?.();
    pending.resolve({
      status: "ready",
      context: reviewContext(oldInput),
      preflight: paymentDetail()
    });
    await Promise.all([first, second]);

    expect(reviewRuntime.postReview).not.toHaveBeenCalled();
    expect(bindings.actionBusy.value).toBe("");
    scope.stop();
  });
});

function setupReviewPage(
  overrides: Parameters<typeof paymentDetail>[0] = {}
) {
  const page = setupPage();
  const detail = paymentDetail(overrides);
  page.bindings.paymentDetail.value = structuredClone(detail);
  page.bindings.paymentApprovalCapability.value = detail;
  return page;
}

function setupPage() {
  const scope = effectScope();
  const bindings = scope.run(() =>
    (
      PaymentDetailPage as unknown as {
        setup: (
          props: Record<string, never>,
          context: { expose: () => void }
        ) => PaymentPageBindings;
      }
    ).setup({}, { expose: () => undefined })
  );
  if (!bindings) throw new Error("payment detail setup failed");
  return { bindings, scope };
}

function paymentDetail(
  overrides: {
    paymentId?: string;
    expectedPaymentUpdatedAt?: string;
    expectedApprovalInstanceId?: string;
    expectedNodeIndex?: number;
    expectedApprovalUpdatedAt?: string;
    reviewApprovalContext?: null;
    actionEnabled?: boolean;
    requiresSelfReviewConfirmation?: boolean;
  } = {}
) {
  const paymentId = overrides.paymentId ?? "payment-a";
  const expectedPaymentUpdatedAt =
    overrides.expectedPaymentUpdatedAt ?? "2026-07-31T00:00:00.000Z";
  return {
    id: paymentId,
    title: "付款审批",
    lifecycleUpdatedAt: expectedPaymentUpdatedAt,
    reviewApprovalContext:
      overrides.reviewApprovalContext === null
        ? null
        : {
            expectedPaymentUpdatedAt,
            expectedApprovalInstanceId:
              overrides.expectedApprovalInstanceId ?? "approval-a",
            expectedNodeIndex: overrides.expectedNodeIndex ?? 1,
            expectedApprovalUpdatedAt:
              overrides.expectedApprovalUpdatedAt ??
              "2026-07-31T00:05:00.000Z"
          },
    availableActions: [
      {
        key: "review_approval",
        label: "办理付款审批",
        kind: "primary",
        enabled: overrides.actionEnabled ?? true,
        disabledReason: null,
        requiredRoles: [],
        requiresSelfReviewConfirmation:
          overrides.requiresSelfReviewConfirmation ?? false
      }
    ],
    evidenceFiles: [],
    meta: [],
    baseInfo: [],
    approvalSteps: [],
    executionSteps: [],
    executionAllocations: [],
    executionCoverages: [],
    approvalTimeline: [],
    disabledReasons: [],
    traceRules: [],
    executionBlockMessage: "",
    chainLinks: [],
    blockedReasons: [],
    primaryAction: "review_approval",
    lifecycleKind: "formal_record",
    ledgerView: "formal_ledger"
  };
}

function reviewContext(input: PrepareInput): ReviewContext {
  return Object.freeze({
    ownerScope: input.ownerScope,
    routeGeneration: input.routeGeneration,
    detailEpoch: input.detailEpoch,
    dialogGeneration: input.dialogGeneration,
    operationId: input.operationId,
    paymentId: input.paymentId,
    expectedPaymentUpdatedAt: input.expectedPaymentUpdatedAt,
    expectedApprovalInstanceId: input.expectedApprovalInstanceId,
    expectedNodeIndex: input.expectedNodeIndex,
    expectedApprovalUpdatedAt: input.expectedApprovalUpdatedAt,
    decision: input.decision,
    requiresSelfReviewConfirmation: input.requiresSelfReviewConfirmation,
    ...(input.approvedAmountCents
      ? { approvedAmountCents: input.approvedAmountCents }
      : {}),
    ...(input.comment ? { comment: input.comment } : {}),
    ...(input.selfReviewReason
      ? { selfReviewReason: input.selfReviewReason }
      : {}),
    ...(input.confirmationPassword
      ? { confirmationPassword: input.confirmationPassword }
      : {})
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
    expectedPaymentUpdatedAt: context.expectedPaymentUpdatedAt,
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
