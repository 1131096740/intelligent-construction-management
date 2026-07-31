import { effectScope, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectExpenseApprovalDetailPage from "./ProjectExpenseApprovalDetailPage.vue";

const executionRuntime = vi.hoisted(() => ({
  beforeUnmountCallbacks: [] as Array<() => void>,
  createAttemptState: vi.fn(() => ({ attempt: "state" })),
  fetchDetail: vi.fn(),
  recordWithUpload: vi.fn(),
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
      executionRuntime.beforeUnmountCallbacks.push(callback);
    },
    onMounted: () => undefined,
    useSSRContext: () => ({ modules: new Set<string>() })
  };
});

vi.mock("vue-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("vue-router")>();
  return {
    ...original,
    useRoute: () => executionRuntime.route
  };
});

vi.mock("../../api/core-flow-read.api", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../api/core-flow-read.api")
  >();
  return {
    ...original,
    createProjectExpenseExecutionRecordAttemptState:
      executionRuntime.createAttemptState,
    fetchProjectExpenseApprovalDetail:
      executionRuntime.fetchDetail,
    recordProjectExpenseExecutionWithUpload:
      executionRuntime.recordWithUpload
  };
});

executionRuntime.route = reactive(executionRuntime.route);

type MutableValue<T> = { value: T };
type ExecutionInput = {
  amountCents: string;
  paidAt: string;
  confirmationPassword: string;
  expectedExpenseUpdatedAt: string;
  idempotencyKey: string;
  file: File;
  fileName: string;
  context: unknown;
  isCurrent: (context: unknown) => boolean;
};
type PageBindings = {
  actionMessage: MutableValue<string>;
  clearProjectExpenseRouteContext: () => void;
  confirmProjectExpenseExecution: (values: {
    reason: string;
    password: string;
  }) => Promise<unknown>;
  detail: MutableValue<ReturnType<typeof expenseDetail> | null>;
  executionConfirmation: {
    visible: boolean;
    error: string;
  };
  executionForm: {
    amountYuan: string;
    paidAt: string;
  };
  executionSubmitting: MutableValue<boolean>;
  executionVoucherFiles: MutableValue<
    Array<{ raw: File; name: string }>
  >;
  loadDetail: () => Promise<boolean>;
  projectExpenseWithdrawalCapability: MutableValue<
    ReturnType<typeof expenseDetail> | null
  >;
  requestProjectExpenseExecution: () => void;
};

describe("project expense execution page ownership", () => {
  beforeEach(() => {
    executionRuntime.route.params.projectId = "project-a";
    executionRuntime.route.params.expenseRequestId = "expense-a";
    executionRuntime.beforeUnmountCallbacks.splice(0);
    executionRuntime.createAttemptState.mockClear();
    executionRuntime.fetchDetail.mockReset();
    executionRuntime.recordWithUpload.mockReset();
    executionRuntime.fetchDetail.mockResolvedValue(expenseDetail());
    executionRuntime.recordWithUpload.mockResolvedValue({
      response: { id: "execution-1" },
      detail: expenseDetail({ actionEnabled: false })
    });
  });

  it("opens only from one raw enabled execution capability with matching CAS", () => {
    const { bindings, scope } = setupPage();
    const authoritative = expenseDetail();
    const view = structuredClone(authoritative);
    view.availableActions[0]!.enabled = false;
    bindings.detail.value = view;
    bindings.projectExpenseWithdrawalCapability.value = authoritative;
    fillExecution(bindings);

    try {
      bindings.requestProjectExpenseExecution();
      expect(bindings.executionConfirmation.visible).toBe(true);

      bindings.executionConfirmation.visible = false;
      bindings.projectExpenseWithdrawalCapability.value = expenseDetail({
        actionEnabled: false
      });
      view.availableActions[0]!.enabled = true;
      bindings.requestProjectExpenseExecution();
      expect(bindings.executionConfirmation.visible).toBe(false);

      bindings.projectExpenseWithdrawalCapability.value = expenseDetail({
        executionContext: null
      });
      bindings.requestProjectExpenseExecution();
      expect(bindings.executionConfirmation.visible).toBe(false);
      expect(executionRuntime.recordWithUpload).not.toHaveBeenCalled();
    } finally {
      scope.stop();
    }
  });

  it("freezes route, CAS, amount, date, file, password and UUID behind one confirm owner", async () => {
    let currentDuringRequest = false;
    executionRuntime.recordWithUpload.mockImplementationOnce(
      (
        _projectId: string,
        _expenseRequestId: string,
        input: ExecutionInput
      ) => {
        currentDuringRequest = input.isCurrent(input.context);
        return Promise.resolve({
          response: { id: "execution-1" },
          detail: expenseDetail({ actionEnabled: false })
        });
      }
    );
    const { bindings, scope } = setupExecutionPage();
    const file = fillExecution(bindings);

    try {
      bindings.requestProjectExpenseExecution();
      const request = bindings.confirmProjectExpenseExecution({
        reason: "",
        password: " current-password "
      });
      bindings.executionForm.amountYuan = "0.01";
      bindings.executionForm.paidAt =
        "2099-01-01T00:00:00.000Z";
      bindings.executionVoucherFiles.value = [
        {
          raw: new File(["changed"], "changed.pdf"),
          name: "changed.pdf"
        }
      ];
      await request;

      const [, , input] = executionRuntime.recordWithUpload
        .mock.calls[0] as [string, string, ExecutionInput, unknown];
      expect(input).toEqual(
        expect.objectContaining({
          amountCents: "5000000",
          paidAt: "2026-07-31T08:30:00.000Z",
          confirmationPassword: " current-password ",
          expectedExpenseUpdatedAt:
            "2026-07-31T08:00:00.000Z",
          file,
          fileName: "项目支出实付凭证.pdf"
        })
      );
      expect(input.idempotencyKey).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      );
      expect(currentDuringRequest).toBe(true);
      expect(executionRuntime.createAttemptState).toHaveBeenCalledTimes(1);
    } finally {
      scope.stop();
    }
  });

  it("coalesces double confirm and keeps the same frozen attempt after an ambiguous failure", async () => {
    const pending = deferred<unknown>();
    executionRuntime.recordWithUpload.mockReturnValueOnce(pending.promise);
    const { bindings, scope } = setupExecutionPage();
    fillExecution(bindings);
    bindings.requestProjectExpenseExecution();

    try {
      const first = bindings.confirmProjectExpenseExecution({
        reason: "",
        password: "password-a"
      });
      const second = bindings.confirmProjectExpenseExecution({
        reason: "",
        password: "password-b"
      });
      expect(executionRuntime.recordWithUpload).toHaveBeenCalledTimes(1);
      expect(bindings.executionSubmitting.value).toBe(true);

      pending.reject(new Error("提交响应超时"));
      await Promise.all([first, second]);
      expect(bindings.executionConfirmation.visible).toBe(true);
      expect(bindings.actionMessage.value).toContain(
        "已保留当前凭证与幂等请求"
      );

      await bindings.confirmProjectExpenseExecution({
        reason: "",
        password: "password-c"
      });
      expect(executionRuntime.createAttemptState).toHaveBeenCalledTimes(1);
      const firstCall = executionRuntime.recordWithUpload.mock.calls[0]!;
      const secondCall = executionRuntime.recordWithUpload.mock.calls[1]!;
      expect(secondCall[3]).toBe(firstCall[3]);
      expect((secondCall[2] as ExecutionInput).idempotencyKey).toBe(
        (firstCall[2] as ExecutionInput).idempotencyKey
      );
      expect((secondCall[2] as ExecutionInput).file).toBe(
        (firstCall[2] as ExecutionInput).file
      );
    } finally {
      scope.stop();
    }
  });

  it("keeps the dialog and attempt until an authoritative GET advances the project expense version", async () => {
    executionRuntime.fetchDetail
      .mockResolvedValueOnce(expenseDetail())
      .mockResolvedValueOnce(
        expenseDetail({
          actionEnabled: false,
          lifecycleUpdatedAt:
            "2026-07-31T08:31:00.000Z"
        })
      );
    executionRuntime.recordWithUpload.mockResolvedValue({
      id: "execution-1"
    });
    const { bindings, scope } = setupExecutionPage();
    fillExecution(bindings);
    bindings.requestProjectExpenseExecution();

    try {
      await bindings.confirmProjectExpenseExecution({
        reason: "",
        password: "password-a"
      });
      expect(bindings.executionConfirmation.visible).toBe(true);
      expect(bindings.actionMessage.value).toContain(
        "权威详情尚未反映本次写入"
      );
      expect(bindings.actionMessage.value).toContain(
        "已保留当前凭证与幂等请求"
      );
      expect(executionRuntime.recordWithUpload).toHaveBeenCalledTimes(1);
      expect(executionRuntime.fetchDetail).toHaveBeenCalledTimes(1);

      await bindings.confirmProjectExpenseExecution({
        reason: "",
        password: "password-b"
      });
      expect(executionRuntime.recordWithUpload).toHaveBeenCalledTimes(2);
      expect(executionRuntime.fetchDetail).toHaveBeenCalledTimes(2);
      expect(executionRuntime.recordWithUpload.mock.calls[1]?.[3]).toBe(
        executionRuntime.recordWithUpload.mock.calls[0]?.[3]
      );
      expect(bindings.executionConfirmation.visible).toBe(false);
      expect(bindings.actionMessage.value).toBe(
        "项目支出实付已登记，权威详情已刷新。"
      );
    } finally {
      scope.stop();
    }
  });

  it("does not let route A completion or finally mutate route B", async () => {
    const pendingA = deferred<unknown>();
    const pendingB = deferred<unknown>();
    executionRuntime.recordWithUpload
      .mockReturnValueOnce(pendingA.promise)
      .mockReturnValueOnce(pendingB.promise);
    const { bindings, scope } = setupExecutionPage();
    fillExecution(bindings);
    bindings.requestProjectExpenseExecution();
    const requestA = bindings.confirmProjectExpenseExecution({
      reason: "",
      password: "password-a"
    });

    try {
      executionRuntime.route.params.projectId = "project-b";
      executionRuntime.route.params.expenseRequestId = "expense-b";
      bindings.clearProjectExpenseRouteContext();
      executionRuntime.fetchDetail.mockResolvedValue(
        expenseDetail({
          projectId: "project-b",
          expenseRequestId: "expense-b"
        })
      );
      await bindings.loadDetail();
      fillExecution(bindings);
      bindings.requestProjectExpenseExecution();
      const requestB = bindings.confirmProjectExpenseExecution({
        reason: "",
        password: "password-b"
      });
      expect(bindings.executionSubmitting.value).toBe(true);

      pendingA.resolve({
        response: { id: "execution-a" },
        detail: expenseDetail({ actionEnabled: false })
      });
      await requestA;
      expect(bindings.executionSubmitting.value).toBe(true);
      expect(bindings.actionMessage.value).toBe("");
      expect(bindings.detail.value?.id).toBe("expense-b");

      pendingB.resolve({
        response: { id: "execution-b" },
        detail: expenseDetail({
          projectId: "project-b",
          expenseRequestId: "expense-b",
          actionEnabled: false
        })
      });
      await requestB;
      expect(bindings.executionSubmitting.value).toBe(false);
      expect(bindings.detail.value?.id).toBe("expense-b");
    } finally {
      scope.stop();
    }
  });

  it("ignores an unmounted execution owner", async () => {
    const pending = deferred<unknown>();
    executionRuntime.recordWithUpload.mockReturnValueOnce(pending.promise);
    const { bindings, scope } = setupExecutionPage();
    fillExecution(bindings);
    bindings.requestProjectExpenseExecution();
    const request = bindings.confirmProjectExpenseExecution({
      reason: "",
      password: "password"
    });

    executionRuntime.beforeUnmountCallbacks[0]?.();
    pending.resolve({
      response: { id: "execution-a" },
      detail: expenseDetail({ actionEnabled: false })
    });
    await request;

    expect(bindings.actionMessage.value).toBe("");
    expect(bindings.executionSubmitting.value).toBe(false);
    scope.stop();
  });
});

function setupExecutionPage() {
  const page = setupPage();
  const detail = expenseDetail();
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

function fillExecution(bindings: PageBindings) {
  const file = new File(["voucher"], "项目支出实付凭证.pdf", {
    type: "application/pdf"
  });
  bindings.executionForm.amountYuan = "50000";
  bindings.executionForm.paidAt =
    "2026-07-31T08:30:00.000Z";
  bindings.executionVoucherFiles.value = [
    { raw: file, name: file.name }
  ];
  return file;
}

function expenseDetail(
  overrides: {
    projectId?: string;
    expenseRequestId?: string;
    actionEnabled?: boolean;
    executionContext?: null;
    lifecycleUpdatedAt?: string;
  } = {}
) {
  const projectId = overrides.projectId ?? "project-a";
  const expenseRequestId =
    overrides.expenseRequestId ?? "expense-a";
  const expectedExpenseUpdatedAt =
    overrides.lifecycleUpdatedAt ??
    "2026-07-31T08:00:00.000Z";
  const actionEnabled = overrides.actionEnabled ?? true;
  return {
    id: expenseRequestId,
    projectId,
    code: "ZC-2026-001",
    title: "项目支出审批",
    status: actionEnabled ? "approved_pending_payment" : "paid",
    statusLabel: actionEnabled ? "已批待付款" : "已付款",
    expenseTypeLabel: "费用报销",
    expenseSubtypeLabel: "差旅费",
    paymentSubject: "差旅费",
    reason: "项目现场协调",
    requestedAmountCents: "5000000",
    approvedAmountCents: "5000000",
    currentNodeName: null,
    canSetApprovedAmount: false,
    reviewAction: null,
    approvalTimeline: [],
    lifecycleUpdatedAt: expectedExpenseUpdatedAt,
    hasPersistentDraft: false as const,
    availableActions: actionEnabled
      ? [
          {
            key: "record_execution",
            label: "登记实付",
            kind: "primary",
            enabled: true,
            disabledReason: null
          }
        ]
      : [],
    blockedReasons: [],
    reviewApprovalContext: null,
    withdrawalContext: null,
    executionContext:
      overrides.executionContext === null || !actionEnabled
        ? null
        : { expectedExpenseUpdatedAt }
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
