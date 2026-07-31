import { effectScope, nextTick, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SpotProcurementDetailPage from "./SpotProcurementDetailPage.vue";

const reviewRuntime = vi.hoisted(() => ({
  beforeUnmountCallbacks: [] as Array<() => void>,
  executeReview: vi.fn(),
  prepareReview: vi.fn(),
  fetchDetail: vi.fn(),
  reviewDirect: vi.fn(),
  route: { params: { procurementId: "procurement-a" } }
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

vi.mock("../../api/spot-procurement.api", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../api/spot-procurement.api")
  >();
  return {
    ...original,
    executeSpotProcurementReviewAction: reviewRuntime.executeReview,
    prepareSpotProcurementReviewAction: reviewRuntime.prepareReview,
    fetchSpotProcurementDetail: reviewRuntime.fetchDetail,
    reviewSpotProcurement: reviewRuntime.reviewDirect
  };
});

reviewRuntime.route = reactive(reviewRuntime.route);

type MutableValue<T> = { value: T };
type ReviewDecision = "approve" | "reject" | "return_to_applicant";
type ReviewOperationContext = {
  ownerScope: string;
  routeGeneration: number;
  detailEpoch: number;
  dialogGeneration: number;
  operationId: number;
  procurementId: string;
  expectedVersionId: string;
  expectedApprovalInstanceId: string;
  expectedNodeIndex: number;
  decision: ReviewDecision;
  comment?: string;
};
type ReviewOperationInput = ReviewOperationContext & {
  isCurrent: (context: ReviewOperationContext) => boolean;
};
type PreparedReview =
  | {
      status: "ready";
      context: ReviewOperationContext;
      preflight: ReturnType<typeof reviewDetail>;
    }
  | {
      status: "stale";
      context: ReviewOperationContext;
    };
type ExecuteReviewInput = {
  decision: ReviewDecision;
  capture: (decision: ReviewDecision) => ReviewOperationContext | null;
  preflight: (context: ReviewOperationContext) => Promise<PreparedReview>;
  current: (
    context: ReviewOperationContext,
    prepared: PreparedReview
  ) => boolean;
  complete: (
    context: ReviewOperationContext,
    response: unknown
  ) => void | Promise<void>;
  fail: (
    context: ReviewOperationContext,
    error: unknown
  ) => void | Promise<void>;
  finish: (context: ReviewOperationContext) => void;
};
type ReviewDialog = {
  visible: boolean;
  kind: string;
  error: string;
};
type ProcurementDetailPageBindings = {
  actionBusy: MutableValue<boolean>;
  actionMessage: MutableValue<string>;
  confirmation: ReviewDialog;
  confirmReviewApprove: (values: {
    reason: string;
    password: string;
  }) => Promise<unknown>;
  confirmReviewReject: (values: {
    reason: string;
    password: string;
  }) => Promise<unknown>;
  confirmReviewReturn: (values: {
    reason: string;
    password: string;
  }) => Promise<unknown>;
  confirmAction: (values: {
    reason: string;
    password: string;
  }) => Promise<unknown>;
  detail: MutableValue<unknown>;
  loadDetail: () => Promise<void>;
  openConfirmation: (kind: string) => void;
  spotProcurementCapability: MutableValue<unknown>;
};

describe("spot procurement approve/reject page ownership", () => {
  beforeEach(() => {
    reviewRuntime.route.params.procurementId = "procurement-a";
    reviewRuntime.beforeUnmountCallbacks.splice(0);
    reviewRuntime.executeReview.mockReset();
    reviewRuntime.prepareReview.mockReset();
    reviewRuntime.fetchDetail.mockReset();
    reviewRuntime.reviewDirect.mockReset();
    reviewRuntime.fetchDetail.mockResolvedValue(reviewDetail());
    reviewRuntime.reviewDirect.mockResolvedValue({});
    reviewRuntime.prepareReview.mockImplementation(
      (input: ReviewOperationInput) =>
        Promise.resolve({
          status: input.isCurrent(reviewContext(input))
            ? "ready"
            : "stale",
          context: reviewContext(input),
          preflight: reviewDetail()
        })
    );
    reviewRuntime.executeReview.mockImplementation(
      async (input: ExecuteReviewInput) => {
        const context = input.capture(input.decision);
        if (!context) return { status: "not_started" };
        try {
          const prepared = await input.preflight(context);
          if (!input.current(context, prepared)) {
            return { status: "stale", context };
          }
          const response = await reviewRuntime.reviewDirect(
            context.procurementId,
            {
              decision: input.decision,
              ...(input.decision !== "approve"
                ? { comment: context.comment }
                : {}),
              expectedVersionId: context.expectedVersionId,
              expectedApprovalInstanceId:
                context.expectedApprovalInstanceId,
              expectedNodeIndex: context.expectedNodeIndex
            }
          );
          await input.complete(context, response);
          return { status: "completed", context, response };
        } catch (error) {
          await input.fail(context, error);
          return { status: "failed", context };
        } finally {
          input.finish(context);
        }
      }
    );
  });

  it("opens review only from the raw authoritative capability and complete coordinates", () => {
    const { bindings, scope } = setupPage();
    const authoritative = reviewDetail();
    const view = structuredClone(authoritative);
    view.availableActions[0]!.enabled = false;
    bindings.detail.value = view;
    bindings.spotProcurementCapability.value = authoritative;

    try {
      bindings.openConfirmation("review_approve");
      expect(bindings.confirmation.visible).toBe(true);

      bindings.confirmation.visible = false;
      bindings.spotProcurementCapability.value = reviewDetail({
        actionEnabled: false
      });
      (bindings.detail.value as ReturnType<typeof reviewDetail>)
        .availableActions[0]!.enabled = true;
      bindings.openConfirmation("review_approve");
      expect(bindings.confirmation.visible).toBe(false);

      bindings.spotProcurementCapability.value = reviewDetail({
        reviewApprovalContext: null
      });
      bindings.openConfirmation("review_reject");
      expect(bindings.confirmation.visible).toBe(false);
      expect(reviewRuntime.prepareReview).not.toHaveBeenCalled();
    } finally {
      scope.stop();
    }
  });

  it("freezes reject coordinates and posts a fixed literal DTO after ready preflight", async () => {
    const pending = deferred<unknown>();
    reviewRuntime.prepareReview.mockReturnValueOnce(pending.promise);
    const { bindings, scope } = setupReviewPage();
    const values = { reason: "  报价依据不足  ", password: "" };

    try {
      bindings.openConfirmation("review_reject");
      const request = bindings.confirmReviewReject(values);
      values.reason = "随后篡改";
      const input = reviewRuntime.prepareReview.mock
        .calls[0]?.[0] as ReviewOperationInput;

      expect(input).toEqual(
        expect.objectContaining({
          procurementId: "procurement-a",
          expectedVersionId: "version-a",
          expectedApprovalInstanceId: "approval-a",
          expectedNodeIndex: 1,
          decision: "reject",
          comment: "报价依据不足"
        })
      );
      expect(bindings.actionBusy.value).toBe(true);

      pending.resolve({
        status: "ready",
        context: reviewContext(input),
        preflight: reviewDetail()
      });
      await request;
      expect(reviewRuntime.reviewDirect).toHaveBeenCalledWith(
        "procurement-a",
        {
          decision: "reject",
          comment: "报价依据不足",
          expectedVersionId: "version-a",
          expectedApprovalInstanceId: "approval-a",
          expectedNodeIndex: 1
        }
      );
      expect(bindings.actionBusy.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("posts a fixed approve literal without carrying dialog reason text", async () => {
    const pending = deferred<unknown>();
    reviewRuntime.prepareReview.mockReturnValueOnce(pending.promise);
    const { bindings, scope } = setupReviewPage();

    try {
      bindings.openConfirmation("review_approve");
      const request = bindings.confirmReviewApprove({
        reason: "不得携带",
        password: ""
      });
      const input = reviewRuntime.prepareReview.mock
        .calls[0]?.[0] as ReviewOperationInput;
      expect(input.decision).toBe("approve");
      expect(input.comment).toBeUndefined();
      pending.resolve({
        status: "ready",
        context: reviewContext(input),
        preflight: reviewDetail()
      });
      await request;
      expect(reviewRuntime.reviewDirect).toHaveBeenCalledWith(
        "procurement-a",
        {
          decision: "approve",
          expectedVersionId: "version-a",
          expectedApprovalInstanceId: "approval-a",
          expectedNodeIndex: 1
        }
      );
    } finally {
      scope.stop();
    }
  });

  it("freezes return-to-applicant coordinates and uses the owned fresh-preflight executor", async () => {
    const pending = deferred<unknown>();
    reviewRuntime.prepareReview.mockReturnValueOnce(pending.promise);
    const { bindings, scope } = setupReviewPage();
    const values = { reason: "  请补充报价依据  ", password: "" };

    try {
      bindings.openConfirmation("review_return");
      const request = bindings.confirmReviewReturn(values);
      values.reason = "随后篡改";
      const input = reviewRuntime.prepareReview.mock
        .calls[0]?.[0] as ReviewOperationInput;

      expect(input).toEqual(
        expect.objectContaining({
          procurementId: "procurement-a",
          expectedVersionId: "version-a",
          expectedApprovalInstanceId: "approval-a",
          expectedNodeIndex: 1,
          decision: "return_to_applicant",
          comment: "请补充报价依据"
        })
      );
      expect(bindings.actionBusy.value).toBe(true);

      pending.resolve({
        status: "ready",
        context: reviewContext(input),
        preflight: reviewDetail()
      });
      await request;

      expect(reviewRuntime.reviewDirect).toHaveBeenCalledWith(
        "procurement-a",
        {
          decision: "return_to_applicant",
          comment: "请补充报价依据",
          expectedVersionId: "version-a",
          expectedApprovalInstanceId: "approval-a",
          expectedNodeIndex: 1
        }
      );
      expect(reviewRuntime.fetchDetail).toHaveBeenCalledTimes(1);
      expect(bindings.actionBusy.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("invalidates an in-flight owner on route A to B without old refresh or message", async () => {
    const pending = deferred<unknown>();
    reviewRuntime.prepareReview.mockReturnValueOnce(pending.promise);
    reviewRuntime.fetchDetail.mockReturnValue(new Promise(() => undefined));
    const { bindings, scope } = setupReviewPage();

    try {
      bindings.openConfirmation("review_approve");
      const request = bindings.confirmReviewApprove({
        reason: "",
        password: ""
      });
      const input = reviewRuntime.prepareReview.mock
        .calls[0]?.[0] as ReviewOperationInput;

      reviewRuntime.route.params.procurementId = "procurement-b";
      await nextTick();
      expect(input.isCurrent(reviewContext(input))).toBe(false);
      expect(bindings.actionBusy.value).toBe(false);

      pending.resolve({
        status: "ready",
        context: reviewContext(input),
        preflight: reviewDetail()
      });
      await request;

      expect(reviewRuntime.fetchDetail).toHaveBeenCalledTimes(1);
      expect(bindings.actionMessage.value).toBe("");
      expect(bindings.confirmation.visible).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("does not let an old route operation release the new route busy owner", async () => {
    const oldPending = deferred<unknown>();
    const newPending = deferred<unknown>();
    reviewRuntime.prepareReview
      .mockReturnValueOnce(oldPending.promise)
      .mockReturnValueOnce(newPending.promise);
    const { bindings, scope } = setupReviewPage();

    try {
      bindings.openConfirmation("review_approve");
      const oldRequest = bindings.confirmReviewApprove({
        reason: "",
        password: ""
      });
      const oldInput = reviewRuntime.prepareReview.mock
        .calls[0]?.[0] as ReviewOperationInput;

      reviewRuntime.fetchDetail.mockResolvedValueOnce(
        reviewDetail({
          procurementId: "procurement-b",
          expectedVersionId: "version-b",
          expectedApprovalInstanceId: "approval-b",
          expectedNodeIndex: 0
        })
      );
      reviewRuntime.route.params.procurementId = "procurement-b";
      await nextTick();
      await flushPromises();

      bindings.openConfirmation("review_reject");
      const newRequest = bindings.confirmReviewReject({
        reason: "B 路由驳回",
        password: ""
      });
      const newInput = reviewRuntime.prepareReview.mock
        .calls[1]?.[0] as ReviewOperationInput;
      expect(bindings.actionBusy.value).toBe(true);

      oldPending.resolve({
        status: "ready",
        context: reviewContext(oldInput),
        preflight: reviewDetail()
      });
      await oldRequest;

      expect(bindings.actionBusy.value).toBe(true);
      expect(bindings.confirmation.visible).toBe(true);
      expect(bindings.confirmation.kind).toBe("review_reject");
      expect(reviewRuntime.fetchDetail).toHaveBeenCalledTimes(1);

      newPending.resolve({
        status: "stale",
        context: reviewContext(newInput)
      });
      await newRequest;
      expect(bindings.actionBusy.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("does not let an old same-route result close a dialog reopened after refresh", async () => {
    const pending = deferred<unknown>();
    reviewRuntime.prepareReview.mockReturnValueOnce(pending.promise);
    const { bindings, scope } = setupReviewPage();

    try {
      bindings.openConfirmation("review_approve");
      const request = bindings.confirmReviewApprove({
        reason: "",
        password: ""
      });
      const input = reviewRuntime.prepareReview.mock
        .calls[0]?.[0] as ReviewOperationInput;

      reviewRuntime.fetchDetail.mockResolvedValueOnce(
        reviewDetail({
          expectedVersionId: "version-b",
          expectedApprovalInstanceId: "approval-b",
          expectedNodeIndex: 2
        })
      );
      await bindings.loadDetail();
      bindings.openConfirmation("review_reject");
      expect(bindings.confirmation.visible).toBe(true);
      expect(bindings.confirmation.kind).toBe("review_reject");
      expect(bindings.actionBusy.value).toBe(true);

      pending.resolve({
        status: "ready",
        context: reviewContext(input),
        preflight: reviewDetail()
      });
      await request;

      expect(reviewRuntime.fetchDetail).toHaveBeenCalledTimes(1);
      expect(bindings.confirmation.visible).toBe(true);
      expect(bindings.confirmation.kind).toBe("review_reject");
      expect(bindings.actionMessage.value).toBe("");
      expect(bindings.actionBusy.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("keeps one busy owner for overlapping clicks instead of latest-wins", async () => {
    const pending = deferred<unknown>();
    reviewRuntime.prepareReview.mockReturnValueOnce(pending.promise);
    const { bindings, scope } = setupReviewPage();

    try {
      bindings.openConfirmation("review_approve");
      const first = bindings.confirmReviewApprove({
        reason: "",
        password: ""
      });
      await bindings.confirmReviewApprove({ reason: "", password: "" });

      expect(reviewRuntime.prepareReview).toHaveBeenCalledTimes(1);
      expect(bindings.actionBusy.value).toBe(true);
      expect(bindings.confirmation.error).toContain("正在");

      const input = reviewRuntime.prepareReview.mock
        .calls[0]?.[0] as ReviewOperationInput;
      pending.resolve({
        status: "stale",
        context: reviewContext(input)
      });
      await first;
      expect(bindings.actionBusy.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it.each(["resolve", "reject"] as const)(
    "does not let an old POST %s overwrite a newly opened opposite decision",
    async (settlement) => {
      const pending = deferred<unknown>();
      reviewRuntime.reviewDirect.mockReturnValueOnce(pending.promise);
      const { bindings, scope } = setupReviewPage();

      try {
        bindings.openConfirmation("review_approve");
        const first = bindings.confirmReviewApprove({
          reason: "",
          password: ""
        });
        await flushPromises();
        const input = reviewRuntime.prepareReview.mock
          .calls[0]?.[0] as ReviewOperationInput;
        expect(input.decision).toBe("approve");
        expect(reviewRuntime.reviewDirect).toHaveBeenCalledTimes(1);

        bindings.openConfirmation("review_reject");
        await bindings.confirmReviewReject({
          reason: "新的驳回原因",
          password: ""
        });
        const newDialogError = bindings.confirmation.error;
        expect(newDialogError).toContain("正在");
        expect(reviewRuntime.prepareReview).toHaveBeenCalledTimes(1);
        expect(bindings.actionBusy.value).toBe(true);

        if (settlement === "resolve") {
          pending.resolve({});
        } else {
          pending.reject(new Error("旧审批网络失败"));
        }
        await first;

        expect(bindings.confirmation.visible).toBe(true);
        expect(bindings.confirmation.kind).toBe("review_reject");
        expect(bindings.confirmation.error).toBe(newDialogError);
        expect(bindings.actionMessage.value).toBe("");
        expect(reviewRuntime.fetchDetail).not.toHaveBeenCalled();
        expect(bindings.actionBusy.value).toBe(false);
      } finally {
        scope.stop();
      }
    }
  );

  it("contains a synchronous wrapper throw in the owning dialog", async () => {
    reviewRuntime.prepareReview.mockImplementationOnce(() => {
      throw new Error("同步创建请求失败");
    });
    const { bindings, scope } = setupReviewPage();

    try {
      bindings.openConfirmation("review_approve");
      await bindings.confirmReviewApprove({ reason: "", password: "" });

      expect(bindings.confirmation.visible).toBe(true);
      expect(bindings.confirmation.error).toBe("同步创建请求失败");
      expect(bindings.actionBusy.value).toBe(false);

      bindings.openConfirmation("review_reject");
      expect(bindings.confirmation.error).toBe("");
      expect(bindings.confirmation.kind).toBe("review_reject");
    } finally {
      scope.stop();
    }
  });

  it("prevents an old same-coordinate instance from POSTing after unmount and remount", async () => {
    const freshDetail = deferred<void>();
    reviewRuntime.prepareReview.mockImplementationOnce(
      async (input: ReviewOperationInput) => {
        const context = reviewContext(input);
        await freshDetail.promise;
        if (!input.isCurrent(context)) return { status: "stale", context };
        return { status: "ready", context, preflight: reviewDetail() };
      }
    );
    const oldPage = setupReviewPage();
    oldPage.bindings.openConfirmation("review_approve");
    const oldRequest = oldPage.bindings.confirmReviewApprove({
      reason: "",
      password: ""
    });
    const oldContext = reviewContext(
      reviewRuntime.prepareReview.mock.calls[0]?.[0] as ReviewOperationInput
    );

    reviewRuntime.beforeUnmountCallbacks[0]?.();
    oldPage.scope.stop();

    const newPage = setupReviewPage();
    newPage.bindings.openConfirmation("review_reject");
    try {
      expect(
        (
          reviewRuntime.prepareReview.mock.calls[0]?.[0] as ReviewOperationInput
        ).isCurrent(oldContext)
      ).toBe(false);

      freshDetail.resolve();
      await oldRequest;

      expect(reviewRuntime.reviewDirect).not.toHaveBeenCalled();
      expect(newPage.bindings.confirmation.visible).toBe(true);
      expect(newPage.bindings.confirmation.kind).toBe("review_reject");
      expect(newPage.bindings.actionBusy.value).toBe(false);
    } finally {
      reviewRuntime.beforeUnmountCallbacks.at(-1)?.();
      newPage.scope.stop();
    }
  });
});

function setupReviewPage() {
  const page = setupPage();
  const detail = reviewDetail();
  page.bindings.detail.value = structuredClone(detail);
  page.bindings.spotProcurementCapability.value = detail;
  return page;
}

function setupPage() {
  const scope = effectScope();
  const bindings = scope.run(() =>
    (
      SpotProcurementDetailPage as unknown as {
        setup: (
          props: Record<string, never>,
          context: { expose: () => void }
        ) => ProcurementDetailPageBindings;
      }
    ).setup({}, { expose: () => undefined })
  );
  if (!bindings) throw new Error("spot procurement detail setup failed");
  return { bindings, scope };
}

function reviewContext(input: ReviewOperationInput): ReviewOperationContext {
  return Object.freeze({
    ownerScope: input.ownerScope,
    routeGeneration: input.routeGeneration,
    detailEpoch: input.detailEpoch,
    dialogGeneration: input.dialogGeneration,
    operationId: input.operationId,
    procurementId: input.procurementId,
    expectedVersionId: input.expectedVersionId,
    expectedApprovalInstanceId: input.expectedApprovalInstanceId,
    expectedNodeIndex: input.expectedNodeIndex,
    decision: input.decision,
    ...(input.decision !== "approve" ? { comment: input.comment } : {})
  });
}

function reviewDetail(
  overrides: {
    actionEnabled?: boolean;
    procurementId?: string;
    expectedVersionId?: string;
    expectedApprovalInstanceId?: string;
    expectedNodeIndex?: number;
    reviewApprovalContext?: null;
  } = {}
) {
  const expectedVersionId = overrides.expectedVersionId ?? "version-a";
  const expectedApprovalInstanceId =
    overrides.expectedApprovalInstanceId ?? "approval-a";
  const expectedNodeIndex = overrides.expectedNodeIndex ?? 1;
  return {
    procurement: {
      id: overrides.procurementId ?? "procurement-a",
      code: "LXCG-001",
      updatedAt: "2026-07-31T00:00:00.000Z"
    },
    currentVersion: {
      id: expectedVersionId,
      reason: "现场补料"
    },
    reviewApprovalContext:
      overrides.reviewApprovalContext === null
        ? null
        : {
            expectedVersionId,
            expectedApprovalInstanceId,
            expectedNodeIndex
          },
    availableActions: [
      {
        key: "review_approval",
        label: "审批",
        kind: "primary",
        enabled: overrides.actionEnabled ?? true,
        disabledReason: null,
        requiredRoles: []
      }
    ]
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

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}
