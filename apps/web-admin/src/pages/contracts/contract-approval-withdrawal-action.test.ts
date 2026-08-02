import { effectScope, nextTick, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ContractDetailPage from "./ContractDetailPage.vue";
import { ContractApprovalWithdrawalResultUnknownError } from "../../lib/contract-approval-result";

const withdrawalRuntime = vi.hoisted(() => ({
  beforeUnmountCallbacks: [] as Array<() => void>,
  executeWithdrawal: vi.fn(),
  prepareWithdrawal: vi.fn(),
  fetchDetail: vi.fn(),
  postWithdrawal: vi.fn(),
  route: { params: { contractId: "contract-a" } }
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
  useAuthStore: () => ({ user: { roleKeys: [] } })
}));

vi.mock("../../api/core-flow-read.api", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../api/core-flow-read.api")
  >();
  return {
    ...original,
    executeContractApprovalWithdrawalAction:
      withdrawalRuntime.executeWithdrawal,
    prepareContractApprovalWithdrawalAction:
      withdrawalRuntime.prepareWithdrawal,
    fetchContractDetail: withdrawalRuntime.fetchDetail
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
  routeContractId: string;
  contractId: string;
  contractVersionId: string;
  expectedContractUpdatedAt: string;
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
type ContractPageBindings = {
  archiveActionBusy: MutableValue<string>;
  archiveActionMessage: MutableValue<string>;
  clearContractActionTransientState: () => void;
  confirmContractWithdrawal: () => Promise<boolean>;
  contractDetail: MutableValue<unknown>;
  contractWithdrawalActionEnabled: () => boolean;
  contractReviewCapability: MutableValue<unknown>;
  reloadContractDetail: () => Promise<boolean>;
  requestContractWithdrawal: () => void;
  sensitiveAction: { visible: boolean; kind: string | null; error: string };
};

describe("contract approval withdrawal page ownership", () => {
  beforeEach(() => {
    withdrawalRuntime.route.params.contractId = "contract-a";
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
            throw new ContractApprovalWithdrawalResultUnknownError(
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
      const view = bindings.contractDetail.value as ReturnType<
        typeof withdrawalDetail
      >;
      view.availableActions[0]!.enabled = false;
      bindings.requestContractWithdrawal();
      expect(bindings.sensitiveAction.visible).toBe(true);
      expect(bindings.sensitiveAction.kind).toBe("withdrawal");

      bindings.sensitiveAction.visible = false;
      bindings.contractReviewCapability.value = withdrawalDetail({
        actionEnabled: false
      });
      view.availableActions[0]!.enabled = true;
      bindings.requestContractWithdrawal();
      expect(bindings.sensitiveAction.visible).toBe(false);

      bindings.contractReviewCapability.value = withdrawalDetail({
        duplicateAction: true
      });
      bindings.requestContractWithdrawal();
      expect(bindings.sensitiveAction.visible).toBe(false);

      bindings.contractReviewCapability.value = withdrawalDetail({
        withdrawApprovalContext: null
      });
      expect(bindings.contractWithdrawalActionEnabled()).toBe(false);
      bindings.requestContractWithdrawal();
      expect(bindings.sensitiveAction.visible).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("shares one promise across double confirmation and emits one POST", async () => {
    const pending = deferred<PreparedWithdrawal>();
    withdrawalRuntime.prepareWithdrawal.mockReturnValueOnce(pending.promise);
    withdrawalRuntime.postWithdrawal.mockResolvedValue({ status: "draft" });
    const { bindings, scope } = setupWithdrawalPage();
    try {
      bindings.requestContractWithdrawal();
      const first = bindings.confirmContractWithdrawal();
      const second = bindings.confirmContractWithdrawal();
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
      expect(bindings.archiveActionMessage.value).toContain("权威合同详情已刷新");
    } finally {
      scope.stop();
    }
  });

  it("invalidates the owner before POST after a route change", async () => {
    const pending = deferred<PreparedWithdrawal>();
    withdrawalRuntime.prepareWithdrawal.mockReturnValueOnce(pending.promise);
    const { bindings, scope } = setupWithdrawalPage();
    try {
      bindings.requestContractWithdrawal();
      const request = bindings.confirmContractWithdrawal();
      const input = withdrawalRuntime.prepareWithdrawal.mock
        .calls[0]?.[0] as WithdrawalInput;

      withdrawalRuntime.route.params.contractId = "contract-b";
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
    async (settlement) => {
      const post = deferred<unknown>();
      withdrawalRuntime.postWithdrawal.mockReturnValueOnce(post.promise);
      withdrawalRuntime.fetchDetail.mockResolvedValueOnce(
        withdrawalDetail({
          contractId: "contract-b",
          contractVersionId: "version-b",
          expectedApprovalInstanceId: "approval-b"
        })
      );
      const { bindings, scope } = setupWithdrawalPage();
      try {
        bindings.requestContractWithdrawal();
        const request = bindings.confirmContractWithdrawal();
        await vi.waitFor(() => {
          expect(withdrawalRuntime.postWithdrawal).toHaveBeenCalledTimes(1);
        });

        withdrawalRuntime.route.params.contractId = "contract-b";
        await nextTick();
        await vi.waitFor(() => {
          expect(
            (bindings.contractDetail.value as { id?: string } | null)?.id
          ).toBe("contract-b");
        });
        bindings.archiveActionMessage.value = "合同 B 已加载";
        const routeBDetail = bindings.contractDetail.value;

        if (settlement === "resolve") {
          post.resolve({ status: "draft" });
        } else {
          post.reject(new Error("route A network failure"));
        }
        await request;

        expect(bindings.contractDetail.value).toBe(routeBDetail);
        expect(bindings.archiveActionMessage.value).toBe("合同 B 已加载");
        expect(bindings.archiveActionBusy.value).toBe("");
      } finally {
        scope.stop();
      }
    }
  );

  it("authoritatively rereads an unknown result and blocks a repeat POST", async () => {
    withdrawalRuntime.postWithdrawal.mockRejectedValueOnce(
      new ContractApprovalWithdrawalResultUnknownError(
        new Error("response lost")
      )
    );
    withdrawalRuntime.fetchDetail.mockResolvedValue(withdrawalDetail());
    const { bindings, scope } = setupWithdrawalPage();
    try {
      bindings.requestContractWithdrawal();
      await bindings.confirmContractWithdrawal();

      expect(withdrawalRuntime.fetchDetail).toHaveBeenCalledTimes(1);
      expect(bindings.archiveActionMessage.value).toContain("不要重复提交");
      expect(bindings.contractWithdrawalActionEnabled()).toBe(false);

      await bindings.confirmContractWithdrawal();
      expect(withdrawalRuntime.postWithdrawal).toHaveBeenCalledTimes(1);
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
      bindings.requestContractWithdrawal();
      const request = bindings.confirmContractWithdrawal();
      await vi.waitFor(() => {
        expect(withdrawalRuntime.postWithdrawal).toHaveBeenCalledTimes(1);
      });

      await bindings.reloadContractDetail();
      post.resolve({ status: "draft" });
      await request;

      expect(withdrawalRuntime.postWithdrawal).toHaveBeenCalledTimes(1);
      expect(bindings.archiveActionMessage.value).toContain("不要重复提交");
      expect(bindings.archiveActionMessage.value).not.toContain("本次没有提交");
    } finally {
      scope.stop();
    }
  });

  it("does not claim an authoritative refresh when the post succeeded but reread failed", async () => {
    withdrawalRuntime.postWithdrawal.mockResolvedValueOnce({ status: "draft" });
    withdrawalRuntime.fetchDetail.mockRejectedValueOnce(
      new Error("detail unavailable")
    );
    const { bindings, scope } = setupWithdrawalPage();
    try {
      bindings.requestContractWithdrawal();
      await bindings.confirmContractWithdrawal();

      expect(withdrawalRuntime.postWithdrawal).toHaveBeenCalledTimes(1);
      expect(bindings.archiveActionMessage.value).toContain(
        "已撤回，但详情刷新失败"
      );
      expect(bindings.archiveActionMessage.value).toContain("不要重复提交");
    } finally {
      scope.stop();
    }
  });

  it("invalidates a pending preflight on unmount without POST", async () => {
    const pending = deferred<PreparedWithdrawal>();
    withdrawalRuntime.prepareWithdrawal.mockReturnValueOnce(pending.promise);
    const { bindings, scope } = setupWithdrawalPage();
    try {
      bindings.requestContractWithdrawal();
      const request = bindings.confirmContractWithdrawal();
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
});

function setupWithdrawalPage() {
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
  const detail = withdrawalDetail();
  bindings.contractDetail.value = structuredClone(detail);
  bindings.contractReviewCapability.value = detail;
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
    routeContractId: input.routeContractId,
    contractId: input.contractId,
    contractVersionId: input.contractVersionId,
    expectedContractUpdatedAt: input.expectedContractUpdatedAt,
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
    contractId?: string;
    contractVersionId?: string;
    expectedApprovalInstanceId?: string;
    withdrawApprovalContext?: null;
  } = {}
) {
  const contractId = overrides.contractId ?? "contract-a";
  const contractVersionId = overrides.contractVersionId ?? "version-a";
  const expectedContractUpdatedAt = "2026-08-02T00:00:00.000Z";
  const action = {
    ...withdrawAction(),
    enabled: overrides.actionEnabled ?? true
  };
  return {
    id: contractId,
    contractVersionId,
    title: "合同 A",
    lifecycleUpdatedAt: expectedContractUpdatedAt,
    withdrawApprovalContext:
      overrides.withdrawApprovalContext === null
        ? null
        : {
            expectedContractUpdatedAt,
            expectedApprovalInstanceId:
              overrides.expectedApprovalInstanceId ?? "approval-a",
            expectedNodeIndex: 1,
            expectedApprovalUpdatedAt: "2026-08-02T00:05:00.000Z"
          },
    reviewApprovalContext: null,
    availableActions: overrides.duplicateAction ? [action, { ...action }] : [action],
    meta: [],
    baseInfo: [],
    effectivenessSteps: [],
    paymentTermStages: [],
    settlementBlockMessage: "",
    settlementPayment: {
      summary: [],
      settlementRows: [],
      paymentRows: [],
      calculationNote: ""
    },
    archiveFiles: [],
    approvalTimeline: [],
    primaryAction: null,
    disabledReasons: [],
    chainLinks: [],
    changeVersions: []
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
