import { effectScope, nextTick, reactive } from "vue";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SpotProcurementDetailPage from "./SpotProcurementDetailPage.vue";

const withdrawalRuntime = vi.hoisted(() => ({
  beforeUnmountCallbacks: [] as Array<() => void>,
  executeWithdrawal: vi.fn(),
  prepareWithdrawal: vi.fn(),
  postWithdrawal: vi.fn(),
  fetchDetail: vi.fn(),
  route: { params: { procurementId: "procurement-a" } }
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

vi.mock("../../api/spot-procurement.api", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../api/spot-procurement.api")
  >();
  return {
    ...original,
    executeSpotProcurementWithdrawalAction:
      withdrawalRuntime.executeWithdrawal,
    prepareSpotProcurementWithdrawalAction:
      withdrawalRuntime.prepareWithdrawal,
    fetchSpotProcurementDetail: withdrawalRuntime.fetchDetail
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
  procurementId: string;
  expectedVersionId: string;
  expectedApprovalInstanceId: string;
  expectedNodeIndex: number;
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
  preflight: (
    context: WithdrawalContext
  ) => Promise<PreparedWithdrawal>;
  current: (
    context: WithdrawalContext,
    prepared: PreparedWithdrawal
  ) => boolean;
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
type WithdrawalDialog = {
  visible: boolean;
  kind: string;
  error: string;
};
type ProcurementDetailPageBindings = {
  actionBusy: MutableValue<boolean>;
  actionMessage: MutableValue<string>;
  confirmation: WithdrawalDialog;
  confirmWithdrawal: () => Promise<unknown>;
  detail: MutableValue<unknown>;
  openConfirmation: (kind: string) => void;
  primaryAction: MutableValue<unknown>;
  spotProcurementCapability: MutableValue<unknown>;
  withdrawalApprovalEnabled: MutableValue<boolean>;
};

describe("spot procurement withdrawal page ownership", () => {
  beforeEach(() => {
    withdrawalRuntime.route.params.procurementId = "procurement-a";
    withdrawalRuntime.beforeUnmountCallbacks.splice(0);
    withdrawalRuntime.executeWithdrawal.mockReset();
    withdrawalRuntime.prepareWithdrawal.mockReset();
    withdrawalRuntime.postWithdrawal.mockReset();
    withdrawalRuntime.fetchDetail.mockReset();
    withdrawalRuntime.fetchDetail.mockResolvedValue(withdrawalDetail());
    withdrawalRuntime.postWithdrawal.mockResolvedValue({
      status: "draft",
      currentVersionId: "version-b"
    });
    withdrawalRuntime.prepareWithdrawal.mockImplementation(
      (input: WithdrawalInput) =>
        Promise.resolve({
          status: input.isCurrent(withdrawalContext(input))
            ? "ready"
            : "stale",
          context: withdrawalContext(input),
          preflight: withdrawalDetail()
        })
    );
    withdrawalRuntime.executeWithdrawal.mockImplementation(
      async (input: ExecuteWithdrawalInput) => {
        const context = input.capture(input.action);
        if (!context) return { status: "not_started" };
        try {
          const prepared = await input.preflight(context);
          if (!input.current(context, prepared)) {
            return { status: "stale", context };
          }
          const response = await withdrawalRuntime.postWithdrawal(
            context.procurementId,
            {
              expectedVersionId: context.expectedVersionId,
              expectedApprovalInstanceId:
                context.expectedApprovalInstanceId,
              expectedNodeIndex: context.expectedNodeIndex
            }
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

  it("uses one working primary withdrawal entry instead of rendering a duplicate process button", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "src/pages/spot-procurement/SpotProcurementDetailPage.vue"
      ),
      "utf8"
    );

    expect(source).toContain(
      'else if (key === "withdraw_approval") openConfirmation("withdraw");'
    );
    expect(source).toContain(
      "v-if=\"withdrawalApprovalEnabled && primaryAction?.key !== 'withdraw_approval'\""
    );
  });

  it("opens only from the raw authoritative capability and complete coordinates", () => {
    const { bindings, scope } = setupWithdrawalPage();
    try {
      const view = bindings.detail.value as ReturnType<
        typeof withdrawalDetail
      >;
      view.availableActions[0]!.enabled = false;
      bindings.openConfirmation("withdraw");
      expect(bindings.confirmation.visible).toBe(true);

      bindings.confirmation.visible = false;
      bindings.spotProcurementCapability.value = withdrawalDetail({
        actionEnabled: false
      });
      view.availableActions[0]!.enabled = true;
      bindings.openConfirmation("withdraw");
      expect(bindings.confirmation.visible).toBe(false);

      bindings.spotProcurementCapability.value = withdrawalDetail({
        withdrawApprovalContext: null
      });
      bindings.openConfirmation("withdraw");
      expect(bindings.confirmation.visible).toBe(false);
      expect(withdrawalRuntime.prepareWithdrawal).not.toHaveBeenCalled();
    } finally {
      scope.stop();
    }
  });

  it("hides and refuses a stale enabled withdrawal capability for a legacy form", () => {
    const { bindings, scope } = setupWithdrawalPage();
    try {
      const legacy = withdrawalDetail({ form: "legacy" });
      bindings.detail.value = structuredClone(legacy);
      bindings.spotProcurementCapability.value = legacy;

      expect(bindings.primaryAction.value).toBeUndefined();
      expect(bindings.withdrawalApprovalEnabled.value).toBe(false);
      bindings.openConfirmation("withdraw");
      expect(bindings.confirmation.visible).toBe(false);
      expect(withdrawalRuntime.prepareWithdrawal).not.toHaveBeenCalled();
    } finally {
      scope.stop();
    }
  });

  it("invalidates an open withdrawal when its fresh capability becomes legacy", async () => {
    const pending = deferred<PreparedWithdrawal>();
    withdrawalRuntime.prepareWithdrawal.mockReturnValueOnce(
      pending.promise
    );
    const { bindings, scope } = setupWithdrawalPage();
    try {
      bindings.openConfirmation("withdraw");
      const request = bindings.confirmWithdrawal();
      const input = withdrawalRuntime.prepareWithdrawal.mock
        .calls[0]?.[0] as WithdrawalInput;

      bindings.spotProcurementCapability.value = withdrawalDetail({
        form: "legacy"
      });
      expect(input.isCurrent(withdrawalContext(input))).toBe(false);

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

  it("freezes coordinates and keeps one busy owner for overlapping confirmation clicks", async () => {
    const pending = deferred<PreparedWithdrawal>();
    withdrawalRuntime.prepareWithdrawal.mockReturnValueOnce(
      pending.promise
    );
    const { bindings, scope } = setupWithdrawalPage();
    try {
      bindings.openConfirmation("withdraw");
      const first = bindings.confirmWithdrawal();
      await bindings.confirmWithdrawal();
      const input = withdrawalRuntime.prepareWithdrawal.mock
        .calls[0]?.[0] as WithdrawalInput;

      expect(input).toEqual(
        expect.objectContaining({
          action: "withdraw",
          procurementId: "procurement-a",
          expectedVersionId: "version-a",
          expectedApprovalInstanceId: "approval-a",
          expectedNodeIndex: 1
        })
      );
      expect(withdrawalRuntime.prepareWithdrawal).toHaveBeenCalledTimes(1);
      expect(bindings.actionBusy.value).toBe(true);
      expect(bindings.confirmation.error).toContain("正在");

      pending.resolve({
        status: "ready",
        context: withdrawalContext(input),
        preflight: withdrawalDetail()
      });
      await first;

      expect(withdrawalRuntime.postWithdrawal).toHaveBeenCalledTimes(1);
      expect(withdrawalRuntime.postWithdrawal).toHaveBeenCalledWith(
        "procurement-a",
        {
          expectedVersionId: "version-a",
          expectedApprovalInstanceId: "approval-a",
          expectedNodeIndex: 1
        }
      );
      expect(withdrawalRuntime.fetchDetail).toHaveBeenCalledTimes(1);
      expect(bindings.actionBusy.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("does not post or write an old result after the owning route changes", async () => {
    const pending = deferred<PreparedWithdrawal>();
    withdrawalRuntime.prepareWithdrawal.mockReturnValueOnce(
      pending.promise
    );
    withdrawalRuntime.fetchDetail.mockReturnValue(
      new Promise(() => undefined)
    );
    const { bindings, scope } = setupWithdrawalPage();
    try {
      bindings.openConfirmation("withdraw");
      const request = bindings.confirmWithdrawal();
      const input = withdrawalRuntime.prepareWithdrawal.mock
        .calls[0]?.[0] as WithdrawalInput;

      withdrawalRuntime.route.params.procurementId = "procurement-b";
      await nextTick();
      expect(input.isCurrent(withdrawalContext(input))).toBe(false);
      expect(bindings.actionBusy.value).toBe(false);

      pending.resolve({
        status: "ready",
        context: withdrawalContext(input),
        preflight: withdrawalDetail()
      });
      await request;

      expect(withdrawalRuntime.postWithdrawal).not.toHaveBeenCalled();
      expect(bindings.actionMessage.value).toBe("");
      expect(bindings.confirmation.visible).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it.each(["resolve", "reject"] as const)(
    "does not let a late route-A withdrawal POST %s refresh or release route B",
    async (settlement) => {
      const oldPost = deferred<unknown>();
      const newPost = deferred<unknown>();
      withdrawalRuntime.postWithdrawal
        .mockReturnValueOnce(oldPost.promise)
        .mockReturnValueOnce(newPost.promise);
      const routeBDetail = withdrawalDetail({
        procurementId: "procurement-b",
        expectedVersionId: "version-b",
        expectedApprovalInstanceId: "approval-b",
        expectedNodeIndex: 2
      });
      withdrawalRuntime.fetchDetail.mockResolvedValueOnce(routeBDetail);
      const { bindings, scope } = setupWithdrawalPage();
      let newRequest: Promise<unknown> | null = null;

      try {
        bindings.openConfirmation("withdraw");
        const oldRequest = bindings.confirmWithdrawal();
        await vi.waitFor(() => {
          expect(withdrawalRuntime.postWithdrawal).toHaveBeenCalledTimes(1);
        });

        withdrawalRuntime.route.params.procurementId = "procurement-b";
        await nextTick();
        await vi.waitFor(() => {
          expect(
            (
              bindings.spotProcurementCapability.value as ReturnType<
                typeof withdrawalDetail
              > | null
            )?.procurement.id
          ).toBe("procurement-b");
        });

        bindings.openConfirmation("withdraw");
        newRequest = bindings.confirmWithdrawal();
        await vi.waitFor(() => {
          expect(withdrawalRuntime.postWithdrawal).toHaveBeenCalledTimes(2);
        });
        bindings.actionMessage.value = "采购 B 已加载";
        const routeBView = bindings.detail.value;

        if (settlement === "resolve") {
          oldPost.resolve({ status: "draft", currentVersionId: "version-a2" });
        } else {
          oldPost.reject(new Error("旧撤回网络失败"));
        }
        await oldRequest;

        expect(bindings.detail.value).toBe(routeBView);
        expect(
          (
            bindings.spotProcurementCapability.value as ReturnType<
              typeof withdrawalDetail
            >
          ).procurement.id
        ).toBe("procurement-b");
        expect(bindings.actionMessage.value).toBe("采购 B 已加载");
        expect(bindings.confirmation.visible).toBe(true);
        expect(bindings.confirmation.kind).toBe("withdraw");
        expect(bindings.confirmation.error).toBe("");
        expect(withdrawalRuntime.fetchDetail).toHaveBeenCalledTimes(1);
        expect(bindings.actionBusy.value).toBe(true);
      } finally {
        withdrawalRuntime.beforeUnmountCallbacks[0]?.();
        newPost.resolve({
          status: "draft",
          currentVersionId: "version-b2"
        });
        if (newRequest) await newRequest;
        scope.stop();
      }
    }
  );
});

function setupWithdrawalPage() {
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
  const detail = withdrawalDetail();
  bindings.detail.value = structuredClone(detail);
  bindings.spotProcurementCapability.value = detail;
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
    procurementId: input.procurementId,
    expectedVersionId: input.expectedVersionId,
    expectedApprovalInstanceId: input.expectedApprovalInstanceId,
    expectedNodeIndex: input.expectedNodeIndex
  });
}

function withdrawalDetail(
  overrides: {
    actionEnabled?: boolean;
    form?: "real_application" | "legacy";
    procurementId?: string;
    expectedVersionId?: string;
    expectedApprovalInstanceId?: string;
    expectedNodeIndex?: number;
    withdrawApprovalContext?: null;
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
      updatedAt: "2026-08-01T00:00:00.000Z",
      form: overrides.form ?? "real_application"
    },
    currentVersion: {
      id: expectedVersionId,
      reason: "现场补料"
    },
    withdrawApprovalContext:
      overrides.withdrawApprovalContext === null
        ? null
        : {
            expectedVersionId,
            expectedApprovalInstanceId,
            expectedNodeIndex
          },
    reviewApprovalContext: null,
    primaryAction: "withdraw_approval",
    availableActions: [
      {
        key: "withdraw_approval",
        label: "撤回采购审批",
        kind: "normal",
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
