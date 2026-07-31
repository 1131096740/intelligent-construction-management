import { effectScope, nextTick, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectExpenseApprovalDetailPage from "./ProjectExpenseApprovalDetailPage.vue";

const withdrawalRuntime = vi.hoisted(() => ({
  beforeUnmountCallbacks: [] as Array<() => void>,
  executeWithdrawal: vi.fn(),
  prepareWithdrawal: vi.fn(),
  fetchDetail: vi.fn(),
  postWithdrawal: vi.fn(),
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
      withdrawalRuntime.beforeUnmountCallbacks.push(callback);
    },
    onMounted: () => undefined,
    useSSRContext: () => ({ modules: new Set<string>() })
  };
});

vi.mock("vue-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("vue-router")>();
  return {
    ...original,
    useRoute: () => withdrawalRuntime.route
  };
});

vi.mock("../../api/core-flow-read.api", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../api/core-flow-read.api")
  >();
  return {
    ...original,
    executeProjectExpenseWithdrawalAction:
      withdrawalRuntime.executeWithdrawal,
    prepareProjectExpenseWithdrawalAction:
      withdrawalRuntime.prepareWithdrawal,
    fetchProjectExpenseApprovalDetail: withdrawalRuntime.fetchDetail
  };
});

withdrawalRuntime.route = reactive(withdrawalRuntime.route);

type MutableValue<T> = { value: T };
type WithdrawalContext = {
  action: "withdraw";
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
};
type PreparedWithdrawal =
  | {
      status: "ready";
      context: WithdrawalContext;
      preflight: ReturnType<typeof expenseDetail>;
    }
  | { status: "stale"; context: WithdrawalContext };
type PrepareInput = WithdrawalContext & {
  isCurrent: (context: WithdrawalContext) => boolean;
};
type ExecuteInput = {
  action: "withdraw";
  capture: (action: "withdraw") => WithdrawalContext | null;
  preflight: (context: WithdrawalContext) => Promise<PreparedWithdrawal>;
  current: (
    context: WithdrawalContext,
    prepared: PreparedWithdrawal
  ) => boolean;
  complete: (context: WithdrawalContext, response: unknown) => void | Promise<void>;
  fail: (context: WithdrawalContext, error: unknown) => void | Promise<void>;
  finish: (context: WithdrawalContext) => void;
};
type PageBindings = {
  actionMessage: MutableValue<string>;
  detail: MutableValue<ReturnType<typeof expenseDetail> | null>;
  projectExpenseWithdrawalCapability: MutableValue<
    ReturnType<typeof expenseDetail> | null
  >;
  withdrawalEnabled: MutableValue<boolean>;
  withdrawalConfirmation: {
    visible: boolean;
    error: string;
  };
  openProjectExpenseWithdrawal: () => void;
  confirmProjectExpenseWithdrawal: () => Promise<unknown>;
  loadDetail: () => Promise<boolean>;
};

describe("project expense withdrawal page ownership", () => {
  beforeEach(() => {
    withdrawalRuntime.route.params.projectId = "project-a";
    withdrawalRuntime.route.params.expenseRequestId = "expense-a";
    withdrawalRuntime.beforeUnmountCallbacks.splice(0);
    withdrawalRuntime.executeWithdrawal.mockReset();
    withdrawalRuntime.prepareWithdrawal.mockReset();
    withdrawalRuntime.fetchDetail.mockReset();
    withdrawalRuntime.postWithdrawal.mockReset();
    withdrawalRuntime.fetchDetail.mockResolvedValue(expenseDetail());
    withdrawalRuntime.postWithdrawal.mockResolvedValue({
      id: "expense-a",
      status: "withdrawn"
    });
    withdrawalRuntime.prepareWithdrawal.mockImplementation(
      async (input: PrepareInput) => {
        const context = frozenContext(input);
        return input.isCurrent(context)
          ? { status: "ready", context, preflight: expenseDetail() }
          : { status: "stale", context };
      }
    );
    withdrawalRuntime.executeWithdrawal.mockImplementation(
      async (input: ExecuteInput) => {
        const context = input.capture(input.action);
        if (!context) return { status: "not_started" };
        try {
          const prepared = await input.preflight(context);
          if (!input.current(context, prepared)) {
            return { status: "stale", context };
          }
          const response = await withdrawalRuntime.postWithdrawal(
            context.projectId,
            context.expenseRequestId,
            withdrawalPayload(context)
          );
          if (!input.current(context, prepared)) {
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
      }
    );
  });

  it("derives the button only from the raw enabled withdraw action and complete context", () => {
    const { bindings, scope } = setupPage();
    const authoritative = expenseDetail();
    const display = structuredClone(authoritative);
    display.availableActions[0]!.enabled = false;
    bindings.detail.value = display;
    bindings.projectExpenseWithdrawalCapability.value = authoritative;

    try {
      expect(bindings.withdrawalEnabled.value).toBe(true);

      bindings.projectExpenseWithdrawalCapability.value = expenseDetail({
        actionEnabled: false
      });
      bindings.detail.value.availableActions[0]!.enabled = true;
      expect(bindings.withdrawalEnabled.value).toBe(false);

      bindings.projectExpenseWithdrawalCapability.value = expenseDetail({
        withdrawalContext: null
      });
      expect(bindings.withdrawalEnabled.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("freezes all four coordinates and carries the withdraw semantic field into the composite wrapper", async () => {
    const { bindings, scope } = setupWithdrawalPage();

    try {
      await bindings.confirmProjectExpenseWithdrawal();

      const input = withdrawalRuntime.prepareWithdrawal.mock.calls[0]?.[0] as PrepareInput;
      expect(input).toEqual(
        expect.objectContaining({
          action: "withdraw",
          projectId: "project-a",
          expenseRequestId: "expense-a",
          expectedExpenseUpdatedAt: "2026-07-31T00:00:00.000Z",
          expectedApprovalInstanceId: "approval-expense-a",
          expectedNodeIndex: 1,
          expectedApprovalUpdatedAt: "2026-07-31T00:05:00.000Z"
        })
      );
      expect(withdrawalRuntime.postWithdrawal).toHaveBeenCalledWith(
        "project-a",
        "expense-a",
        withdrawalPayload(frozenContext(input))
      );
    } finally {
      scope.stop();
    }
  });

  it("invalidates route A before POST without letting its late result touch route B", async () => {
    const pending = deferred<PreparedWithdrawal>();
    withdrawalRuntime.prepareWithdrawal.mockReturnValueOnce(pending.promise);
    const { bindings, scope } = setupWithdrawalPage();

    try {
      const request = bindings.confirmProjectExpenseWithdrawal();
      const oldInput = withdrawalRuntime.prepareWithdrawal.mock.calls[0]?.[0] as PrepareInput;

      withdrawalRuntime.fetchDetail.mockResolvedValueOnce(
        expenseDetail({ projectId: "project-b", expenseRequestId: "expense-b" })
      );
      withdrawalRuntime.route.params.projectId = "project-b";
      withdrawalRuntime.route.params.expenseRequestId = "expense-b";
      await nextTick();
      await vi.waitFor(() => {
        expect(bindings.projectExpenseWithdrawalCapability.value?.id).toBe(
          "expense-b"
        );
      });

      pending.resolve({
        status: "ready",
        context: frozenContext(oldInput),
        preflight: expenseDetail()
      });
      await request.catch(() => undefined);

      expect(withdrawalRuntime.postWithdrawal).not.toHaveBeenCalled();
      expect(bindings.projectExpenseWithdrawalCapability.value?.projectId).toBe(
        "project-b"
      );
      expect(bindings.actionMessage.value).toBe("");
    } finally {
      scope.stop();
    }
  });

  it("coalesces rapid confirmation and stops the owner after unmount", async () => {
    const pending = deferred<PreparedWithdrawal>();
    withdrawalRuntime.prepareWithdrawal.mockReturnValueOnce(pending.promise);
    const { bindings, scope } = setupWithdrawalPage();

    const first = bindings.confirmProjectExpenseWithdrawal();
    const second = bindings.confirmProjectExpenseWithdrawal();
    expect(withdrawalRuntime.prepareWithdrawal).toHaveBeenCalledTimes(1);

    const input = withdrawalRuntime.prepareWithdrawal.mock.calls[0]?.[0] as PrepareInput;
    withdrawalRuntime.beforeUnmountCallbacks[0]?.();
    pending.resolve({
      status: "ready",
      context: frozenContext(input),
      preflight: expenseDetail()
    });
    await Promise.allSettled([first, second]);

    expect(withdrawalRuntime.postWithdrawal).not.toHaveBeenCalled();
    scope.stop();
  });

  it("does not let an older detail GET overwrite the current route", async () => {
    const routeA = deferred<ReturnType<typeof expenseDetail>>();
    withdrawalRuntime.fetchDetail.mockReturnValueOnce(routeA.promise);
    const { bindings, scope } = setupPage();

    try {
      const oldLoad = bindings.loadDetail();
      withdrawalRuntime.fetchDetail.mockResolvedValueOnce(
        expenseDetail({ projectId: "project-b", expenseRequestId: "expense-b" })
      );
      withdrawalRuntime.route.params.projectId = "project-b";
      withdrawalRuntime.route.params.expenseRequestId = "expense-b";
      await nextTick();
      await vi.waitFor(() => {
        expect(bindings.detail.value?.id).toBe("expense-b");
      });

      routeA.resolve(expenseDetail());
      await oldLoad;
      expect(bindings.detail.value?.id).toBe("expense-b");
    } finally {
      scope.stop();
    }
  });
});

function setupWithdrawalPage() {
  const page = setupPage();
  const detail = expenseDetail();
  page.bindings.detail.value = structuredClone(detail);
  page.bindings.projectExpenseWithdrawalCapability.value = detail;
  page.bindings.openProjectExpenseWithdrawal();
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
    actionEnabled?: boolean;
    withdrawalContext?: null;
  } = {}
) {
  const projectId = overrides.projectId ?? "project-a";
  const expenseRequestId = overrides.expenseRequestId ?? "expense-a";
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
    canSetApprovedAmount: false,
    reviewAction: {
      key: "review",
      label: "审批项目支出",
      kind: "primary",
      enabled: false,
      disabledReason: "申请人不能审批自己发起的业务"
    },
    approvalTimeline: [],
    lifecycleUpdatedAt: "2026-07-31T00:00:00.000Z",
    hasPersistentDraft: false,
    availableActions: [
      {
        key: "withdraw",
        label: "撤回项目支出申请",
        kind: "danger",
        enabled: overrides.actionEnabled ?? true,
        disabledReason: null
      },
      {
        key: "void",
        label: "作废项目支出申请",
        kind: "danger",
        enabled: true,
        disabledReason: null,
        requiresComment: true
      }
    ],
    blockedReasons: [],
    withdrawalContext:
      overrides.withdrawalContext === null
        ? null
        : {
            expectedExpenseUpdatedAt: "2026-07-31T00:00:00.000Z",
            expectedApprovalInstanceId: "approval-expense-a",
            expectedNodeIndex: 1,
            expectedApprovalUpdatedAt: "2026-07-31T00:05:00.000Z"
          }
  };
}

function frozenContext(input: PrepareInput): WithdrawalContext {
  return Object.freeze({
    action: input.action,
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
    expectedApprovalUpdatedAt: input.expectedApprovalUpdatedAt
  });
}

function withdrawalPayload(context: WithdrawalContext) {
  return {
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
