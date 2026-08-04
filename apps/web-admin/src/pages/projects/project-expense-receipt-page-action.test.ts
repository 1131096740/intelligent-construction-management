import { effectScope, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectExpenseApprovalDetailPage from "./ProjectExpenseApprovalDetailPage.vue";

const receiptRuntime = vi.hoisted(() => ({
  beforeUnmountCallbacks: [] as Array<() => void>,
  completionIsAuthoritative: vi.fn(() => true),
  confirmWithPreflight: vi.fn(),
  createAttemptState: vi.fn(() => ({ attempt: "state" })),
  fetchDetail: vi.fn(),
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
      receiptRuntime.beforeUnmountCallbacks.push(callback);
    },
    onMounted: () => undefined,
    useSSRContext: () => ({ modules: new Set<string>() })
  };
});

vi.mock("vue-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("vue-router")>();
  return {
    ...original,
    useRoute: () => receiptRuntime.route
  };
});

vi.mock("../../api/core-flow-read.api", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../api/core-flow-read.api")
  >();
  return {
    ...original,
    createProjectExpenseReceiptConfirmationAttemptState:
      receiptRuntime.createAttemptState,
    confirmProjectExpenseReceiptWithPreflight:
      receiptRuntime.confirmWithPreflight,
    fetchProjectExpenseApprovalDetail:
      receiptRuntime.fetchDetail,
    projectExpenseReceiptCompletionIsAuthoritative:
      receiptRuntime.completionIsAuthoritative
  };
});

receiptRuntime.route = reactive(receiptRuntime.route);

type MutableValue<T> = { value: T };
type ReceiptInput = {
  confirmationPassword: string;
  note?: string;
  expectedExpenseUpdatedAt: string;
  idempotencyKey: string;
  context: unknown;
  isCurrent: (context: unknown) => boolean;
};
type PageBindings = {
  actionMessage: MutableValue<string>;
  clearProjectExpenseRouteContext: () => void;
  confirmProjectExpenseReceipt: (values: {
    reason: string;
    password: string;
  }) => Promise<unknown>;
  detail: MutableValue<ReturnType<typeof receiptDetail> | null>;
  loadDetail: () => Promise<boolean>;
  projectExpenseWithdrawalCapability: MutableValue<
    ReturnType<typeof receiptDetail> | null
  >;
  receiptConfirmation: {
    visible: boolean;
    error: string;
  };
  receiptForm: { note: string };
  receiptSubmitting: MutableValue<boolean>;
  requestProjectExpenseReceiptConfirmation: () => void;
};

describe("project expense receipt page ownership", () => {
  beforeEach(() => {
    receiptRuntime.route.params.projectId = "project-a";
    receiptRuntime.route.params.expenseRequestId = "expense-a";
    receiptRuntime.beforeUnmountCallbacks.splice(0);
    receiptRuntime.completionIsAuthoritative.mockReset();
    receiptRuntime.completionIsAuthoritative.mockReturnValue(true);
    receiptRuntime.confirmWithPreflight.mockReset();
    receiptRuntime.confirmWithPreflight.mockResolvedValue(
      receiptResponse()
    );
    receiptRuntime.createAttemptState.mockClear();
    receiptRuntime.fetchDetail.mockReset();
    receiptRuntime.fetchDetail.mockResolvedValue(
      receiptDetail({ actionEnabled: false })
    );
  });

  it("freezes the raw capability, route, dialog, operation, note, CAS and UUID behind one POST", async () => {
    const pending = deferred<ReturnType<typeof receiptResponse>>();
    let currentDuringRequest = false;
    receiptRuntime.confirmWithPreflight.mockImplementationOnce(
      (
        _projectId: string,
        _expenseRequestId: string,
        input: ReceiptInput
      ) => {
        currentDuringRequest = input.isCurrent(input.context);
        return pending.promise;
      }
    );
    const { bindings, scope } = setupReceiptPage();
    const view = bindings.detail.value;
    if (!view) throw new Error("receipt detail missing");
    view.availableActions[0]!.enabled = false;
    bindings.receiptForm.note = " 数量与质量无误 ";
    bindings.requestProjectExpenseReceiptConfirmation();

    try {
      expect(bindings.receiptConfirmation.visible).toBe(true);
      const first = bindings.confirmProjectExpenseReceipt({
        reason: "",
        password: " current-password "
      });
      const duplicate = bindings.confirmProjectExpenseReceipt({
        reason: "",
        password: "replacement-password"
      });
      expect(duplicate).toBe(first);
      expect(receiptRuntime.confirmWithPreflight).toHaveBeenCalledTimes(1);
      expect(bindings.receiptSubmitting.value).toBe(true);
      bindings.receiptForm.note = "不得替换的备注";

      const [, , input, attemptState] =
        receiptRuntime.confirmWithPreflight.mock.calls[0] as [
          string,
          string,
          ReceiptInput,
          unknown
        ];
      expect(input).toEqual(
        expect.objectContaining({
          confirmationPassword: " current-password ",
          note: "数量与质量无误",
          expectedExpenseUpdatedAt:
            "2026-08-01T04:00:00.000Z"
        })
      );
      expect(input.idempotencyKey).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      );
      expect(currentDuringRequest).toBe(true);
      expect(attemptState).toBe(
        receiptRuntime.createAttemptState.mock.results[0]?.value
      );

      pending.resolve(receiptResponse(input.idempotencyKey));
      await Promise.all([first, duplicate]);
      expect(bindings.receiptSubmitting.value).toBe(false);
      expect(bindings.receiptConfirmation.visible).toBe(false);
      expect(bindings.actionMessage.value).toBe(
        "项目支出收货已确认，权威详情已刷新。"
      );
    } finally {
      scope.stop();
    }
  });

  it("does not let a late route-A failure reopen or mutate route B", async () => {
    const pending = deferred<ReturnType<typeof receiptResponse>>();
    receiptRuntime.confirmWithPreflight.mockReturnValueOnce(
      pending.promise
    );
    const { bindings, scope } = setupReceiptPage();
    bindings.requestProjectExpenseReceiptConfirmation();
    const requestA = bindings.confirmProjectExpenseReceipt({
      reason: "",
      password: "password-a"
    });

    try {
      receiptRuntime.route.params.projectId = "project-b";
      receiptRuntime.route.params.expenseRequestId = "expense-b";
      bindings.clearProjectExpenseRouteContext();
      receiptRuntime.fetchDetail.mockResolvedValue(
        receiptDetail({
          projectId: "project-b",
          expenseRequestId: "expense-b"
        })
      );
      await bindings.loadDetail();
      pending.reject(new Error("网络连接失败"));
      await requestA;

      expect(bindings.detail.value?.id).toBe("expense-b");
      expect(bindings.actionMessage.value).toBe("");
      expect(bindings.receiptConfirmation.visible).toBe(false);
      expect(bindings.receiptSubmitting.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("ignores a late failure after the receipt owner is unmounted", async () => {
    const pending = deferred<ReturnType<typeof receiptResponse>>();
    receiptRuntime.confirmWithPreflight.mockReturnValueOnce(
      pending.promise
    );
    const { bindings, scope } = setupReceiptPage();
    bindings.requestProjectExpenseReceiptConfirmation();
    const request = bindings.confirmProjectExpenseReceipt({
      reason: "",
      password: "password"
    });

    receiptRuntime.beforeUnmountCallbacks[0]?.();
    pending.reject(new Error("网络连接失败"));
    await request;

    expect(bindings.actionMessage.value).toBe("");
    expect(bindings.receiptConfirmation.visible).toBe(false);
    expect(bindings.receiptSubmitting.value).toBe(false);
    scope.stop();
  });
});

function setupReceiptPage() {
  const page = setupPage();
  const detail = receiptDetail();
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

function receiptDetail(
  overrides: {
    projectId?: string;
    expenseRequestId?: string;
    actionEnabled?: boolean;
  } = {}
) {
  const projectId = overrides.projectId ?? "project-a";
  const expenseRequestId =
    overrides.expenseRequestId ?? "expense-a";
  const actionEnabled = overrides.actionEnabled ?? true;
  const expectedExpenseUpdatedAt = actionEnabled
    ? "2026-08-01T04:00:00.000Z"
    : "2026-08-01T04:00:02.000Z";
  return {
    id: expenseRequestId,
    projectId,
    code: "CG-2026-001",
    title: "项目零星采购收货",
    status: "paid",
    statusLabel: "已付清",
    expenseTypeLabel: "零星采购",
    expenseSubtypeLabel: "零星材料采购",
    paymentSubject: "现场零星材料",
    reason: "现场急用",
    requestedAmountCents: "50000",
    approvedAmountCents: "50000",
    paidAmountCents: "50000",
    remainingAmountCents: "0",
    financeRecordedAmountCents: "50000",
    financeRemainingAmountCents: "0",
    receiptConfirmedAt: actionEnabled
      ? null
      : "2026-08-01T04:00:01.000Z",
    receiptConfirmedByUserId: actionEnabled
      ? null
      : "material-user-1",
    receiptConfirmationIdempotencyKey: actionEnabled
      ? null
      : "6e8fab4b-9e90-4fba-a59d-320cd24cc427",
    receiptConfirmationNote: actionEnabled
      ? null
      : "数量与质量无误",
    currentNodeName: null,
    canSetApprovedAmount: false,
    reviewAction: {
      key: "review",
      label: "审批",
      kind: "primary",
      enabled: false,
      disabledReason: "当前项目支出状态不可审批"
    },
    approvalTimeline: [],
    lifecycleUpdatedAt: expectedExpenseUpdatedAt,
    hasPersistentDraft: false as const,
    availableActions: actionEnabled
      ? [{
          key: "confirm_receipt",
          label: "确认收货",
          kind: "primary",
          enabled: true,
          disabledReason: null
        }]
      : [],
    blockedReasons: [],
    reviewApprovalContext: null,
    withdrawalContext: null,
    executionContext: null,
    financeContext: null,
    receiptContext: actionEnabled
      ? { expectedExpenseUpdatedAt }
      : null
  };
}

function receiptResponse(
  idempotencyKey = "6e8fab4b-9e90-4fba-a59d-320cd24cc427"
) {
  return {
    projectId: "project-a",
    expenseRequestId: "expense-a",
    idempotencyKey,
    confirmedByUserId: "material-user-1",
    confirmedAt: "2026-08-01T04:00:01.000Z",
    note: "数量与质量无误",
    updatedAt: "2026-08-01T04:00:02.000Z"
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}
