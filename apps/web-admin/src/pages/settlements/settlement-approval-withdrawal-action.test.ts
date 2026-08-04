import { effectScope, nextTick, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettlementDetailPage from "./SettlementDetailPage.vue";
import { SettlementApprovalWithdrawalResultUnknownError } from "../../lib/settlement-approval-result";

const withdrawalRuntime = vi.hoisted(() => ({
  beforeUnmountCallbacks: [] as Array<() => void>,
  executeWithdrawal: vi.fn(),
  prepareWithdrawal: vi.fn(),
  fetchDetail: vi.fn(),
  postWithdrawal: vi.fn(),
  route: { params: { settlementId: "settlement-a" } }
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
    useRoute: () => withdrawalRuntime.route,
    useRouter: () => ({ push: vi.fn() })
  };
});

vi.mock("../../auth/auth.store", () => ({
  useAuthStore: () => ({
    user: { roleKeys: [], globalRoleKeys: [] }
  })
}));

vi.mock("../../api/core-flow-read.api", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../api/core-flow-read.api")
  >();
  return {
    ...original,
    executeSettlementApprovalWithdrawalAction:
      withdrawalRuntime.executeWithdrawal,
    prepareSettlementApprovalWithdrawalAction:
      withdrawalRuntime.prepareWithdrawal,
    fetchSettlementDetail: withdrawalRuntime.fetchDetail
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
  routeSettlementId: string;
  settlementCode: string;
  settlementId: string;
  expectedSettlementUpdatedAt: string;
  expectedApprovalInstanceId: string;
  expectedNodeIndex: number;
  expectedApprovalUpdatedAt: string;
};
type WithdrawalInput = WithdrawalContext & {
  isCurrent: (context: WithdrawalContext) => boolean;
};
type PreparedWithdrawal =
  | {
      status: "ready";
      context: WithdrawalContext;
      preflight: ReturnType<typeof withdrawalDetail>;
    }
  | { status: "stale"; context: WithdrawalContext };
type ExecuteWithdrawalInput = {
  action: "withdraw";
  capture: (action: "withdraw") => WithdrawalContext | null;
  preflight: (context: WithdrawalContext) => Promise<PreparedWithdrawal>;
  current: (
    context: WithdrawalContext,
    prepared: PreparedWithdrawal
  ) => boolean;
  stale: (context: WithdrawalContext) => void | Promise<void>;
  complete: (
    context: WithdrawalContext,
    response: unknown
  ) => void | Promise<void>;
  fail: (
    context: WithdrawalContext,
    error: unknown
  ) => void | Promise<void>;
  finish: (context: WithdrawalContext) => void;
};
type SettlementPageBindings = {
  archiveActionBusy: MutableValue<string>;
  archiveActionMessage: MutableValue<string>;
  clearSettlementDetailTransientState: () => void;
  confirmSettlementWithdrawal: () => Promise<boolean>;
  reloadSettlementDetail: () => Promise<boolean>;
  requestSettlementWithdrawal: () => void;
  sensitiveAction: { visible: boolean; kind: string | null; error: string };
  settlementApprovalCapability: MutableValue<unknown>;
  settlementDetail: MutableValue<unknown>;
  settlementWithdrawalActionEnabled: () => boolean;
};

describe("settlement approval withdrawal page ownership", () => {
  beforeEach(() => {
    withdrawalRuntime.route.params.settlementId = "settlement-a";
    withdrawalRuntime.beforeUnmountCallbacks.splice(0);
    withdrawalRuntime.executeWithdrawal.mockReset();
    withdrawalRuntime.prepareWithdrawal.mockReset();
    withdrawalRuntime.fetchDetail.mockReset();
    withdrawalRuntime.postWithdrawal.mockReset();
    withdrawalRuntime.fetchDetail.mockResolvedValue(
      withdrawalDetail({ actionEnabled: false, withdrawApprovalContext: null })
    );
    withdrawalRuntime.prepareWithdrawal.mockImplementation(
      (input: WithdrawalInput) => {
        const context = withdrawalContext(input);
        return Promise.resolve(
          input.isCurrent(context)
            ? { status: "ready", context, preflight: withdrawalDetail() }
            : { status: "stale", context }
        );
      }
    );
    withdrawalRuntime.executeWithdrawal.mockImplementation(
      async (input: ExecuteWithdrawalInput) => {
        const context = input.capture(input.action);
        if (!context) return { status: "not_started" };
        try {
          const prepared = await input.preflight(context);
          if (prepared.status !== "ready" || !input.current(context, prepared)) {
            await input.stale(context);
            return { status: "stale", context };
          }
          const response = await withdrawalRuntime.postWithdrawal(context);
          if (!input.current(context, prepared)) {
            throw new SettlementApprovalWithdrawalResultUnknownError(
              new Error("post-dispatch owner changed")
            );
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

  it("opens only from the raw capability with one enabled action and four coordinates", () => {
    const { bindings, scope } = setupWithdrawalPage();
    try {
      const view = bindings.settlementDetail.value as ReturnType<
        typeof withdrawalDetail
      >;
      view.availableActions[0]!.enabled = false;
      bindings.requestSettlementWithdrawal();
      expect(bindings.sensitiveAction.visible).toBe(true);
      expect(bindings.sensitiveAction.kind).toBe("withdrawal");

      bindings.sensitiveAction.visible = false;
      bindings.settlementApprovalCapability.value = withdrawalDetail({
        actionEnabled: false
      });
      view.availableActions[0]!.enabled = true;
      bindings.requestSettlementWithdrawal();
      expect(bindings.sensitiveAction.visible).toBe(false);

      bindings.settlementApprovalCapability.value = withdrawalDetail({
        duplicateAction: true
      });
      bindings.requestSettlementWithdrawal();
      expect(bindings.sensitiveAction.visible).toBe(false);

      bindings.settlementApprovalCapability.value = withdrawalDetail({
        withdrawApprovalContext: null
      });
      expect(bindings.settlementWithdrawalActionEnabled()).toBe(false);
      bindings.requestSettlementWithdrawal();
      expect(bindings.sensitiveAction.visible).toBe(false);

      bindings.settlementApprovalCapability.value = withdrawalDetail({
        lifecycleUpdatedAt: "2026-08-02T00:01:00.000Z"
      });
      expect(bindings.settlementWithdrawalActionEnabled()).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("shares one promise across double confirmation and emits one POST", async () => {
    const pending = deferred<PreparedWithdrawal>();
    withdrawalRuntime.prepareWithdrawal.mockReturnValueOnce(pending.promise);
    withdrawalRuntime.postWithdrawal.mockResolvedValue({ status: "withdrawn" });
    const { bindings, scope } = setupWithdrawalPage();
    try {
      bindings.requestSettlementWithdrawal();
      const first = bindings.confirmSettlementWithdrawal();
      const second = bindings.confirmSettlementWithdrawal();
      expect(first).toBe(second);
      expect(withdrawalRuntime.executeWithdrawal).toHaveBeenCalledTimes(1);
      expect(bindings.archiveActionBusy.value).toBe("withdrawApproval");

      const input = withdrawalRuntime.prepareWithdrawal.mock
        .calls[0]?.[0] as WithdrawalInput;
      pending.resolve({
        status: "ready",
        context: withdrawalContext(input),
        preflight: withdrawalDetail()
      });
      await Promise.all([first, second]);

      expect(withdrawalRuntime.postWithdrawal).toHaveBeenCalledTimes(1);
      expect(withdrawalRuntime.fetchDetail).toHaveBeenCalledTimes(1);
      expect(bindings.archiveActionBusy.value).toBe("");
      expect(bindings.archiveActionMessage.value).toContain("权威结算详情已刷新");
    } finally {
      scope.stop();
    }
  });

  it("invalidates the owner before POST after a route change", async () => {
    const pending = deferred<PreparedWithdrawal>();
    withdrawalRuntime.prepareWithdrawal.mockReturnValueOnce(pending.promise);
    const { bindings, scope } = setupWithdrawalPage();
    try {
      bindings.requestSettlementWithdrawal();
      const request = bindings.confirmSettlementWithdrawal();
      const input = withdrawalRuntime.prepareWithdrawal.mock
        .calls[0]?.[0] as WithdrawalInput;

      withdrawalRuntime.route.params.settlementId = "settlement-b";
      await nextTick();
      pending.resolve({
        status: "ready",
        context: withdrawalContext(input),
        preflight: withdrawalDetail()
      });
      await request;

      expect(withdrawalRuntime.postWithdrawal).not.toHaveBeenCalled();
      expect(bindings.archiveActionBusy.value).toBe("");
      expect(bindings.sensitiveAction.visible).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it.each(["resolve", "reject"] as const)(
    "does not let a late route-A POST %s overwrite route B",
    async (outcome) => {
      const post = deferred<unknown>();
      withdrawalRuntime.postWithdrawal.mockReturnValueOnce(post.promise);
      withdrawalRuntime.fetchDetail.mockResolvedValueOnce(
        withdrawalDetail({
          settlementCode: "JS-B",
          settlementId: "settlement-record-b",
          expectedApprovalInstanceId: "approval-b"
        })
      );
      const { bindings, scope } = setupWithdrawalPage();
      try {
        bindings.requestSettlementWithdrawal();
        const request = bindings.confirmSettlementWithdrawal();
        await vi.waitFor(() => {
          expect(withdrawalRuntime.postWithdrawal).toHaveBeenCalledTimes(1);
        });

        withdrawalRuntime.route.params.settlementId = "settlement-b";
        await nextTick();
        await vi.waitFor(() => {
          expect(
            (bindings.settlementDetail.value as { id?: string } | null)?.id
          ).toBe("JS-B");
        });
        bindings.archiveActionMessage.value = "结算 B 已加载";
        const routeBDetail = bindings.settlementDetail.value;

        if (outcome === "resolve") {
          post.resolve({ status: "withdrawn" });
        } else {
          post.reject(new Error("route A network failure"));
        }
        await request;

        expect(bindings.settlementDetail.value).toBe(routeBDetail);
        expect(bindings.archiveActionMessage.value).toBe("结算 B 已加载");
        expect(bindings.archiveActionBusy.value).toBe("");
      } finally {
        scope.stop();
      }
    }
  );

  it("authoritatively rereads an unknown result and blocks a repeat POST", async () => {
    withdrawalRuntime.postWithdrawal.mockRejectedValueOnce(
      new SettlementApprovalWithdrawalResultUnknownError(
        new Error("response lost")
      )
    );
    withdrawalRuntime.fetchDetail.mockResolvedValue(withdrawalDetail());
    const { bindings, scope } = setupWithdrawalPage();
    try {
      bindings.requestSettlementWithdrawal();
      await bindings.confirmSettlementWithdrawal();

      expect(withdrawalRuntime.fetchDetail).toHaveBeenCalledTimes(1);
      expect(bindings.archiveActionMessage.value).toContain("不要重复提交");
      expect(bindings.settlementWithdrawalActionEnabled()).toBe(false);

      await bindings.confirmSettlementWithdrawal();
      expect(withdrawalRuntime.postWithdrawal).toHaveBeenCalledTimes(1);

      await bindings.reloadSettlementDetail();
      expect(bindings.settlementWithdrawalActionEnabled()).toBe(true);
    } finally {
      scope.stop();
    }
  });

  it("does not report no submission when a same-route refresh races a dispatched POST", async () => {
    const post = deferred<unknown>();
    withdrawalRuntime.postWithdrawal.mockReturnValueOnce(post.promise);
    withdrawalRuntime.fetchDetail.mockResolvedValue(
      withdrawalDetail({ actionEnabled: false, withdrawApprovalContext: null })
    );
    const { bindings, scope } = setupWithdrawalPage();
    try {
      bindings.requestSettlementWithdrawal();
      const request = bindings.confirmSettlementWithdrawal();
      await vi.waitFor(() => {
        expect(withdrawalRuntime.postWithdrawal).toHaveBeenCalledTimes(1);
      });

      await bindings.reloadSettlementDetail();
      post.resolve({ status: "withdrawn" });
      await request;

      expect(withdrawalRuntime.postWithdrawal).toHaveBeenCalledTimes(1);
      expect(bindings.archiveActionMessage.value).toContain("不要重复提交");
      expect(bindings.archiveActionMessage.value).not.toContain("本次没有提交");
    } finally {
      scope.stop();
    }
  });

  it("treats a failed authoritative reread after POST success as unknown", async () => {
    withdrawalRuntime.postWithdrawal.mockResolvedValueOnce({ status: "withdrawn" });
    withdrawalRuntime.fetchDetail.mockRejectedValueOnce(
      new Error("detail unavailable")
    );
    const { bindings, scope } = setupWithdrawalPage();
    try {
      bindings.requestSettlementWithdrawal();
      await bindings.confirmSettlementWithdrawal();

      expect(withdrawalRuntime.postWithdrawal).toHaveBeenCalledTimes(1);
      expect(withdrawalRuntime.fetchDetail).toHaveBeenCalledTimes(2);
      expect(bindings.archiveActionMessage.value).toContain("结果暂时无法确认");
      expect(bindings.archiveActionMessage.value).toContain("不要重复提交");
      expect(bindings.settlementWithdrawalActionEnabled()).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("does not claim success when the authoritative reread is still withdrawable", async () => {
    withdrawalRuntime.postWithdrawal.mockResolvedValueOnce({ status: "withdrawn" });
    withdrawalRuntime.fetchDetail.mockResolvedValueOnce(withdrawalDetail());
    const { bindings, scope } = setupWithdrawalPage();
    try {
      bindings.requestSettlementWithdrawal();
      await bindings.confirmSettlementWithdrawal();

      expect(withdrawalRuntime.fetchDetail).toHaveBeenCalledTimes(2);
      expect(bindings.archiveActionMessage.value).toContain("结果暂时无法确认");
      expect(bindings.archiveActionMessage.value).toContain("不要重复提交");
      expect(bindings.settlementWithdrawalActionEnabled()).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("invalidates a pending preflight on unmount without POST", async () => {
    const pending = deferred<PreparedWithdrawal>();
    withdrawalRuntime.prepareWithdrawal.mockReturnValueOnce(pending.promise);
    const { bindings, scope } = setupWithdrawalPage();
    try {
      bindings.requestSettlementWithdrawal();
      const request = bindings.confirmSettlementWithdrawal();
      const input = withdrawalRuntime.prepareWithdrawal.mock
        .calls[0]?.[0] as WithdrawalInput;

      withdrawalRuntime.beforeUnmountCallbacks[0]?.();
      pending.resolve({
        status: "ready",
        context: withdrawalContext(input),
        preflight: withdrawalDetail()
      });
      await request;

      expect(withdrawalRuntime.postWithdrawal).not.toHaveBeenCalled();
    } finally {
      scope.stop();
    }
  });

  it("does not let a dispatched POST mutate an unmounted owner", async () => {
    const post = deferred<unknown>();
    withdrawalRuntime.postWithdrawal.mockReturnValueOnce(post.promise);
    const { bindings, scope } = setupWithdrawalPage();
    try {
      bindings.requestSettlementWithdrawal();
      const request = bindings.confirmSettlementWithdrawal();
      await vi.waitFor(() => {
        expect(withdrawalRuntime.postWithdrawal).toHaveBeenCalledTimes(1);
      });

      withdrawalRuntime.beforeUnmountCallbacks[0]?.();
      post.resolve({ status: "withdrawn" });
      await request;

      expect(withdrawalRuntime.fetchDetail).not.toHaveBeenCalled();
      expect(bindings.settlementDetail.value).toBeNull();
      expect(bindings.archiveActionMessage.value).toBe("");
      expect(bindings.archiveActionBusy.value).toBe("");
    } finally {
      scope.stop();
    }
  });
});

function setupWithdrawalPage() {
  const scope = effectScope();
  const bindings = scope.run(() =>
    (
      SettlementDetailPage as unknown as {
        setup: (
          props: Record<string, never>,
          context: { expose: () => void }
        ) => SettlementPageBindings;
      }
    ).setup({}, { expose: () => undefined })
  );
  if (!bindings) throw new Error("settlement detail setup failed");
  const detail = withdrawalDetail();
  bindings.settlementDetail.value = structuredClone(detail);
  bindings.settlementApprovalCapability.value = detail;
  return { bindings, scope };
}

function withdrawalContext(input: WithdrawalInput): WithdrawalContext {
  return Object.freeze({
    action: "withdraw",
    ownerScope: input.ownerScope,
    routeGeneration: input.routeGeneration,
    detailEpoch: input.detailEpoch,
    dialogGeneration: input.dialogGeneration,
    operationId: input.operationId,
    routeSettlementId: input.routeSettlementId,
    settlementCode: input.settlementCode,
    settlementId: input.settlementId,
    expectedSettlementUpdatedAt: input.expectedSettlementUpdatedAt,
    expectedApprovalInstanceId: input.expectedApprovalInstanceId,
    expectedNodeIndex: input.expectedNodeIndex,
    expectedApprovalUpdatedAt: input.expectedApprovalUpdatedAt
  });
}

function withdrawAction() {
  return {
    key: "withdraw_approval",
    label: "撤回审批",
    kind: "normal",
    enabled: true,
    disabledReason: null,
    requiredRoles: []
  };
}

function withdrawalDetail(
  overrides: {
    actionEnabled?: boolean;
    duplicateAction?: boolean;
    settlementCode?: string;
    settlementId?: string;
    lifecycleUpdatedAt?: string;
    expectedApprovalInstanceId?: string;
    withdrawApprovalContext?: null;
  } = {}
) {
  const settlementCode = overrides.settlementCode ?? "settlement-a";
  const settlementId = overrides.settlementId ?? "settlement-record-a";
  const expectedSettlementUpdatedAt = "2026-08-02T00:00:00.000Z";
  const action = {
    ...withdrawAction(),
    enabled: overrides.actionEnabled ?? true
  };
  return {
    id: settlementCode,
    settlementId,
    title: "结算 A",
    lifecycleUpdatedAt:
      overrides.lifecycleUpdatedAt ?? expectedSettlementUpdatedAt,
    withdrawApprovalContext:
      overrides.withdrawApprovalContext === null
        ? null
        : {
            expectedSettlementUpdatedAt,
            expectedApprovalInstanceId:
              overrides.expectedApprovalInstanceId ?? "approval-a",
            expectedNodeIndex: 1,
            expectedApprovalUpdatedAt: "2026-08-02T00:05:00.000Z"
          },
    availableActions: overrides.duplicateAction ? [action, { ...action }] : [action],
    meta: [],
    baseInfo: [],
    taxFactSummary: [],
    effectivenessSteps: [],
    archiveResponsibilities: [],
    paymentRules: [],
    settlementLines: [],
    payableCalculation: { items: [], note: "" },
    paymentBlockMessage: "",
    archiveFiles: [],
    approvalTimeline: [],
    primaryAction: null,
    disabledReasons: [],
    chainLinks: []
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
