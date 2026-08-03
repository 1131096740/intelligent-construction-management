import { effectScope, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ContractDetailPage from "./ContractDetailPage.vue";

const reviewRuntime = vi.hoisted(() => ({
  beforeUnmountCallbacks: [] as Array<() => void>,
  executeReview: vi.fn(),
  prepareReview: vi.fn(),
  fetchDetail: vi.fn(),
  postReview: vi.fn(),
  route: { params: { contractId: "contract-a" } }
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

vi.mock("../../auth/auth.store", () => ({
  useAuthStore: () => ({ user: { roleKeys: [] } })
}));

vi.mock("../../api/core-flow-read.api", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../api/core-flow-read.api")
  >();
  return {
    ...original,
    executeContractApprovalReviewAction: reviewRuntime.executeReview,
    prepareContractApprovalReviewAction: reviewRuntime.prepareReview,
    fetchContractDetail: reviewRuntime.fetchDetail
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
  routeContractId: string;
  contractId: string;
  contractVersionId: string;
  expectedContractUpdatedAt: string;
  expectedApprovalInstanceId: string;
  expectedNodeIndex: number;
  expectedApprovalUpdatedAt: string;
  decision: ReviewDecision;
  requiresSelfReviewConfirmation: boolean;
  ownerContractRisk: ReturnType<typeof contractOwnerRisk> | null;
  ownerContractRiskConfirmed: boolean;
  comment?: string;
};
type PreparedReview =
  | { status: "ready"; context: ReviewContext; preflight: ReturnType<typeof contractDetail> }
  | { status: "stale"; context: ReviewContext };
type PrepareInput = ReviewContext & {
  isCurrent: (context: ReviewContext) => boolean;
};
type ExecuteInput = {
  decision: ReviewDecision;
  capture: (decision: ReviewDecision) => ReviewContext | null;
  preflight: (context: ReviewContext) => Promise<PreparedReview>;
  current: (context: ReviewContext, prepared: PreparedReview) => boolean;
  stale: (context: ReviewContext) => void | Promise<void>;
  complete: (context: ReviewContext, response: unknown) => void | Promise<void>;
  fail: (context: ReviewContext, error: unknown) => void | Promise<void>;
  finish: (context: ReviewContext) => void;
};
type ContractPageBindings = {
  archiveActionBusy: MutableValue<string>;
  archiveActionMessage: MutableValue<string>;
  clearContractActionTransientState: () => void;
  confirmContractReviewApprove: (values: { reason: string; password: string }) => Promise<boolean>;
  confirmContractReviewReject: (values: { reason: string; password: string }) => Promise<boolean>;
  contractArchiveForm: {
    approvalComment: string;
    ownerContractRiskConfirmed: boolean;
  };
  contractDetail: MutableValue<unknown>;
  contractLifecycleAvailableActionKeys: MutableValue<string[] | null>;
  contractReviewCapability: MutableValue<unknown>;
  reloadContractDetail: () => Promise<boolean>;
  requestContractReview: (decision: ReviewDecision) => void;
  sensitiveAction: { visible: boolean; kind: string | null; error: string };
};

describe("contract approval review page ownership", () => {
  beforeEach(() => {
    reviewRuntime.route.params.contractId = "contract-a";
    reviewRuntime.beforeUnmountCallbacks.splice(0);
    reviewRuntime.executeReview.mockReset();
    reviewRuntime.prepareReview.mockReset();
    reviewRuntime.fetchDetail.mockReset();
    reviewRuntime.postReview.mockReset();
    reviewRuntime.fetchDetail.mockResolvedValue(contractDetail({ actionEnabled: false }));
    reviewRuntime.prepareReview.mockImplementation((input: PrepareInput) => {
      const context = reviewContext(input);
      return Promise.resolve(
        input.isCurrent(context)
          ? { status: "ready", context, preflight: contractDetail() }
          : { status: "stale", context }
      );
    });
    reviewRuntime.executeReview.mockImplementation(async (input: ExecuteInput) => {
      const context = input.capture(input.decision);
      if (!context) return { status: "not_started" };
      try {
        const prepared = await input.preflight(context);
        if (!input.current(context, prepared)) {
          await input.stale(context);
          return { status: "stale", context };
        }
        const response = await reviewRuntime.postReview(context);
        if (!input.current(context, prepared)) {
          await input.stale(context);
          return { status: "stale", context };
        }
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

  it("opens only from the raw capability and exact four-coordinate context", () => {
    const { bindings, scope } = setupPage();
    const authoritative = contractDetail();
    const view = structuredClone(authoritative);
    view.availableActions[0]!.enabled = false;
    bindings.contractDetail.value = view;
    bindings.contractLifecycleAvailableActionKeys.value = authoritative.availableActionKeys;
    bindings.contractReviewCapability.value = authoritative;

    try {
      bindings.requestContractReview("approve");
      expect(bindings.sensitiveAction.visible).toBe(true);
      expect(bindings.sensitiveAction.kind).toBe("approvalApprove");

      bindings.sensitiveAction.visible = false;
      bindings.contractReviewCapability.value = contractDetail({ actionEnabled: false });
      view.availableActions[0]!.enabled = true;
      bindings.requestContractReview("reject");
      expect(bindings.sensitiveAction.visible).toBe(false);

      bindings.contractReviewCapability.value = contractDetail({ reviewApprovalContext: null });
      bindings.requestContractReview("approve");
      expect(bindings.sensitiveAction.visible).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("shares one promise across double confirm and performs one POST", async () => {
    const pending = deferred<PreparedReview>();
    reviewRuntime.prepareReview.mockReturnValueOnce(pending.promise);
    reviewRuntime.postReview.mockResolvedValue({ id: "approved" });
    const { bindings, scope } = setupReviewPage();

    try {
      bindings.requestContractReview("approve");
      const first = bindings.confirmContractReviewApprove({ reason: "", password: "" });
      const second = bindings.confirmContractReviewApprove({ reason: "", password: "" });
      expect(first).toBe(second);
      expect(reviewRuntime.executeReview).toHaveBeenCalledTimes(1);
      expect(bindings.archiveActionBusy.value).toBe("reviewApproval");

      const prepareInput = reviewRuntime.prepareReview.mock.calls[0]?.[0] as PrepareInput;
      pending.resolve({
        status: "ready",
        context: reviewContext(prepareInput),
        preflight: contractDetail()
      });
      await Promise.all([first, second]);

      expect(reviewRuntime.postReview).toHaveBeenCalledTimes(1);
      expect(reviewRuntime.fetchDetail).toHaveBeenCalledTimes(1);
      expect(bindings.archiveActionBusy.value).toBe("");
      expect(bindings.archiveActionMessage.value).toContain("权威合同详情已刷新");
    } finally {
      scope.stop();
    }
  });

  it("invalidates an in-flight owner before POST after route cleanup", async () => {
    const pending = deferred<PreparedReview>();
    reviewRuntime.prepareReview.mockReturnValueOnce(pending.promise);
    const { bindings, scope } = setupReviewPage();

    try {
      bindings.contractArchiveForm.approvalComment = "合同依据不足";
      bindings.contractArchiveForm.ownerContractRiskConfirmed = true;
      bindings.requestContractReview("reject");
      const submission = bindings.confirmContractReviewReject({ reason: "", password: "" });
      const prepareInput = reviewRuntime.prepareReview.mock.calls[0]?.[0] as PrepareInput;

      reviewRuntime.route.params.contractId = "contract-b";
      bindings.clearContractActionTransientState();
      expect(bindings.contractArchiveForm.ownerContractRiskConfirmed).toBe(false);
      pending.resolve({
        status: "ready",
        context: reviewContext(prepareInput),
        preflight: contractDetail()
      });
      await submission;

      expect(reviewRuntime.postReview).not.toHaveBeenCalled();
      expect(bindings.archiveActionBusy.value).toBe("");
    } finally {
      scope.stop();
    }
  });

  it("allows risk rejection without the approval-only confirmation", async () => {
    reviewRuntime.postReview.mockResolvedValue({ id: "rejected" });
    const { bindings, scope } = setupPage();
    const detail = contractDetail({ ownerContractRisk: contractOwnerRisk() });
    bindings.contractDetail.value = structuredClone(detail);
    bindings.contractLifecycleAvailableActionKeys.value = detail.availableActionKeys;
    bindings.contractReviewCapability.value = detail;

    try {
      bindings.contractArchiveForm.approvalComment = "业主主合同风险尚未解除";
      expect(bindings.contractArchiveForm.ownerContractRiskConfirmed).toBe(false);

      bindings.requestContractReview("reject");
      const completed = await bindings.confirmContractReviewReject({
        reason: "",
        password: ""
      });

      expect(completed).toBe(true);
      expect(reviewRuntime.postReview).toHaveBeenCalledTimes(1);
      expect(reviewRuntime.postReview).toHaveBeenCalledWith(expect.objectContaining({
        decision: "reject",
        ownerContractRiskConfirmed: false
      }));
    } finally {
      scope.stop();
    }
  });

  it("invalidates an approval confirmation when a same-route refresh changes risk", async () => {
    const initial = contractDetail({ ownerContractRisk: contractOwnerRisk() });
    const changed = contractDetail({
      ownerContractRisk: contractOwnerRisk({
        downstreamContractAmountCents: "19000000",
        excessAmountCents: "19000000",
        message: "项目风险已变化"
      })
    });
    reviewRuntime.fetchDetail.mockResolvedValue(changed);
    const { bindings, scope } = setupPage();
    bindings.contractDetail.value = structuredClone(initial);
    bindings.contractReviewCapability.value = initial;

    try {
      bindings.contractArchiveForm.ownerContractRiskConfirmed = true;
      bindings.requestContractReview("approve");

      await expect(bindings.reloadContractDetail()).resolves.toBe(true);
      expect(bindings.contractArchiveForm.ownerContractRiskConfirmed).toBe(false);

      // Even a stale UI or scripted assignment cannot transfer confirmation A to risk B.
      bindings.contractArchiveForm.ownerContractRiskConfirmed = true;
      await expect(bindings.confirmContractReviewApprove({
        reason: "",
        password: ""
      })).resolves.toBe(false);

      expect(reviewRuntime.postReview).not.toHaveBeenCalled();
    } finally {
      scope.stop();
    }
  });
});

function setupReviewPage() {
  const page = setupPage();
  const detail = contractDetail();
  page.bindings.contractDetail.value = structuredClone(detail);
  page.bindings.contractLifecycleAvailableActionKeys.value = detail.availableActionKeys;
  page.bindings.contractReviewCapability.value = detail;
  return page;
}

function setupPage() {
  const scope = effectScope();
  const bindings = scope.run(() =>
    (
      ContractDetailPage as unknown as {
        setup: (
          props: Record<string, never>,
          context: { expose: () => void }
        ) => ContractPageBindings;
      }
    ).setup({}, { expose: () => undefined })
  );
  if (!bindings) throw new Error("contract detail setup failed");
  return { bindings, scope };
}

function contractDetail(
  overrides: {
    actionEnabled?: boolean;
    reviewApprovalContext?: null;
    ownerContractRisk?: ReturnType<typeof contractOwnerRisk>;
  } = {}
) {
  const expectedContractUpdatedAt = "2026-08-02T00:00:00.000Z";
  return {
    id: "contract-a",
    contractVersionId: "version-a",
    title: "合同 A",
    lifecycleUpdatedAt: expectedContractUpdatedAt,
    reviewApprovalContext: overrides.reviewApprovalContext === null
      ? null
      : {
          expectedContractUpdatedAt,
          expectedApprovalInstanceId: "approval-a",
          expectedNodeIndex: 1,
          expectedApprovalUpdatedAt: "2026-08-02T00:05:00.000Z"
        },
    availableActions: [{
      key: "review_approval",
      label: "处理合同审批",
      kind: "primary",
      enabled: overrides.actionEnabled ?? true,
      disabledReason: null,
      requiredRoles: [],
      requiresSelfReviewConfirmation: false
    }],
    availableActionKeys: overrides.actionEnabled === false
      ? []
      : ["review_approval"],
    ownerContractRisk: overrides.ownerContractRisk,
    meta: [],
    baseInfo: [],
    effectivenessSteps: [],
    paymentTermStages: [],
    settlementBlockMessage: "",
    settlementPayment: { summary: [], settlementRows: [], paymentRows: [], calculationNote: "" },
    archiveFiles: [],
    formalFiles: [],
    sealTask: null,
    signingMaterialChangeContext: null,
    approvalTimeline: [],
    lifecycleKind: "formal_record",
    lifecycleBlockers: [],
    draftRevision: 1,
    primaryAction: "review_approval",
    disabledReasons: [],
    chainLinks: [],
    changeVersions: []
  };
}

function contractOwnerRisk(
  overrides: Partial<{
    status: "clear" | "missing_owner_contract" | "exceeds_owner_contract";
    ownerContractAmountCents: string;
    downstreamContractAmountCents: string;
    excessAmountCents: string;
    message: string;
    requiresExplicitConfirmation: boolean;
  }> = {}
) {
  return {
    status: "missing_owner_contract" as const,
    ownerContractAmountCents: "0",
    downstreamContractAmountCents: "18000000",
    excessAmountCents: "18000000",
    message: "项目尚未登记生效业主主合同",
    requiresExplicitConfirmation: true,
    ...overrides
  };
}

function reviewContext(input: PrepareInput): ReviewContext {
  const { isCurrent, ...context } = input;
  void isCurrent;
  return Object.freeze(context);
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
