import { effectScope, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PaymentDetailPage from "./PaymentDetailPage.vue";

const executionRuntime = vi.hoisted(() => ({
  beforeUnmountCallbacks: [] as Array<() => void>,
  createAttemptState: vi.fn(() => ({ attempt: "state" })),
  fetchDetail: vi.fn(),
  recordWithUpload: vi.fn(),
  route: { params: { paymentId: "payment-a" } }
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
    useRoute: () => executionRuntime.route,
    useRouter: () => ({ push: vi.fn() })
  };
});

vi.mock("../../api/core-flow-read.api", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../api/core-flow-read.api")
  >();
  return {
    ...original,
    createPaymentExecutionRecordAttemptState:
      executionRuntime.createAttemptState,
    fetchPaymentDetail: executionRuntime.fetchDetail,
    recordPaymentExecutionWithUpload:
      executionRuntime.recordWithUpload
  };
});

executionRuntime.route = reactive(executionRuntime.route);

type MutableValue<T> = { value: T };
type ExecutionInput = {
  amountCents: string;
  paidAt: string;
  confirmationPassword: string;
  expectedPaymentUpdatedAt: string;
  idempotencyKey: string;
  file: File;
  fileName: string;
  context: unknown;
  isCurrent: (context: unknown) => boolean;
};
type PaymentPageBindings = {
  actionBusy: MutableValue<string>;
  actionMessage: MutableValue<string>;
  clearPaymentDetailTransientState: () => void;
  confirmPaymentExecution: (values: {
    reason: string;
    password: string;
  }) => Promise<unknown>;
  paymentActionForm: {
    executionAmountYuan: string;
    paidAt: string;
  };
  paymentDetail: MutableValue<unknown>;
  paymentApprovalCapability: MutableValue<unknown>;
  paymentVoucherFiles: MutableValue<
    Array<{ raw: File; name: string }>
  >;
  reloadPaymentDetail: () => Promise<boolean>;
  requestExecution: () => void;
  sensitiveAction: {
    visible: boolean;
    kind: string | null;
    error: string;
  };
};

describe("payment execution page ownership", () => {
  beforeEach(() => {
    executionRuntime.route.params.paymentId = "payment-a";
    executionRuntime.beforeUnmountCallbacks.splice(0);
    executionRuntime.createAttemptState.mockClear();
    executionRuntime.fetchDetail.mockReset();
    executionRuntime.recordWithUpload.mockReset();
    executionRuntime.fetchDetail.mockResolvedValue(
      paymentExecutionDetail()
    );
    executionRuntime.recordWithUpload.mockResolvedValue({
      id: "execution-1"
    });
  });

  it("opens only from the raw authoritative execution capability and context", () => {
    const { bindings, scope } = setupPage();
    const authoritative = paymentExecutionDetail();
    const view = structuredClone(authoritative);
    view.availableActions[0]!.enabled = true;
    bindings.paymentDetail.value = view;
    bindings.paymentApprovalCapability.value =
      paymentExecutionDetail({ actionEnabled: false });
    fillExecution(bindings);

    try {
      bindings.requestExecution();
      expect(bindings.sensitiveAction.visible).toBe(false);

      bindings.paymentApprovalCapability.value =
        authoritative;
      view.availableActions[0]!.enabled = false;
      bindings.requestExecution();
      expect(bindings.sensitiveAction.visible).toBe(true);
      expect(bindings.sensitiveAction.kind).toBe("execution");

      bindings.sensitiveAction.visible = false;
      bindings.paymentApprovalCapability.value =
        paymentExecutionDetail({ executionContext: null });
      bindings.requestExecution();
      expect(bindings.sensitiveAction.visible).toBe(false);
      expect(
        executionRuntime.recordWithUpload
      ).not.toHaveBeenCalled();
    } finally {
      scope.stop();
    }
  });

  it("freezes payment, CAS, file, password and UUID behind the fixed confirm handler", async () => {
    let wasCurrentDuringRequest = false;
    executionRuntime.recordWithUpload.mockImplementationOnce(
      (_paymentId: string, input: ExecutionInput) => {
        wasCurrentDuringRequest = input.isCurrent(input.context);
        return Promise.resolve({ id: "execution-1" });
      }
    );
    const { bindings, scope } = setupExecutionPage();
    const file = fillExecution(bindings);

    try {
      bindings.requestExecution();
      const request = bindings.confirmPaymentExecution({
        reason: "",
        password: " current-password "
      });
      bindings.paymentActionForm.executionAmountYuan =
        "0.01";
      bindings.paymentActionForm.paidAt =
        "2099-01-01T00:00:00.000Z";
      bindings.paymentVoucherFiles.value = [
        {
          raw: new File(["changed"], "changed.pdf"),
          name: "changed.pdf"
        }
      ];
      await request;

      const [, input] = executionRuntime.recordWithUpload
        .mock.calls[0] as [string, ExecutionInput, unknown];
      expect(input).toEqual(
        expect.objectContaining({
          amountCents: "5000000",
          paidAt: "2026-07-31T08:30:00.000Z",
          confirmationPassword: " current-password ",
          expectedPaymentUpdatedAt:
            "2026-07-31T08:00:00.000Z",
          file,
          fileName: "付款凭证.pdf"
        })
      );
      expect(input.idempotencyKey).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      );
      expect(wasCurrentDuringRequest).toBe(true);
      expect(
        executionRuntime.createAttemptState
      ).toHaveBeenCalledTimes(1);
    } finally {
      scope.stop();
    }
  });

  it("coalesces double confirm under one page owner", async () => {
    const pending = deferred<unknown>();
    executionRuntime.recordWithUpload.mockReturnValueOnce(
      pending.promise
    );
    const { bindings, scope } = setupExecutionPage();
    fillExecution(bindings);
    bindings.requestExecution();

    try {
      const first = bindings.confirmPaymentExecution({
        reason: "",
        password: "password"
      });
      const second = bindings.confirmPaymentExecution({
        reason: "",
        password: "changed-password"
      });
      expect(
        executionRuntime.recordWithUpload
      ).toHaveBeenCalledTimes(1);
      expect(bindings.actionBusy.value).toBe("execution");

      pending.resolve({ id: "execution-1" });
      await Promise.all([first, second]);
      expect(bindings.actionBusy.value).toBe("");
    } finally {
      scope.stop();
    }
  });

  it("keeps one frozen attempt across an ambiguous failure retry", async () => {
    executionRuntime.recordWithUpload
      .mockRejectedValueOnce(new Error("提交响应超时"))
      .mockResolvedValueOnce({ id: "execution-1" });
    const { bindings, scope } = setupExecutionPage();
    fillExecution(bindings);
    bindings.requestExecution();

    try {
      await bindings.confirmPaymentExecution({
        reason: "",
        password: "first-password"
      });
      expect(bindings.sensitiveAction.visible).toBe(true);
      expect(bindings.actionMessage.value).toContain(
        "已保留当前凭证与幂等请求"
      );

      await bindings.confirmPaymentExecution({
        reason: "",
        password: "changed-password"
      });

      expect(
        executionRuntime.createAttemptState
      ).toHaveBeenCalledTimes(1);
      const firstCall =
        executionRuntime.recordWithUpload.mock.calls[0]!;
      const secondCall =
        executionRuntime.recordWithUpload.mock.calls[1]!;
      expect(secondCall[2]).toBe(firstCall[2]);
      expect(
        (secondCall[1] as ExecutionInput).idempotencyKey
      ).toBe(
        (firstCall[1] as ExecutionInput).idempotencyKey
      );
      expect(
        (secondCall[1] as ExecutionInput).file
      ).toBe((firstCall[1] as ExecutionInput).file);
    } finally {
      scope.stop();
    }
  });

  it("does not let route A finally release route B's newer busy owner", async () => {
    const pendingA = deferred<unknown>();
    const pendingB = deferred<unknown>();
    executionRuntime.recordWithUpload
      .mockReturnValueOnce(pendingA.promise)
      .mockReturnValueOnce(pendingB.promise);
    const { bindings, scope } = setupExecutionPage();
    fillExecution(bindings);
    bindings.requestExecution();
    const requestA = bindings.confirmPaymentExecution({
      reason: "",
      password: "password-a"
    });

    try {
      executionRuntime.fetchDetail.mockResolvedValue(
        paymentExecutionDetail({ paymentId: "payment-b" })
      );
      executionRuntime.route.params.paymentId = "payment-b";
      bindings.clearPaymentDetailTransientState();
      await bindings.reloadPaymentDetail();
      fillExecution(bindings);
      bindings.requestExecution();
      const requestB = bindings.confirmPaymentExecution({
        reason: "",
        password: "password-b"
      });
      expect(bindings.actionBusy.value).toBe("execution");

      pendingA.resolve({ id: "execution-a" });
      await requestA;
      expect(bindings.actionBusy.value).toBe("execution");

      pendingB.resolve({ id: "execution-b" });
      await requestB;
      expect(bindings.actionBusy.value).toBe("");
    } finally {
      scope.stop();
    }
  });

  it("does not let route A completion clear, refresh or message route B", async () => {
    const pending = deferred<unknown>();
    executionRuntime.recordWithUpload.mockReturnValueOnce(
      pending.promise
    );
    const { bindings, scope } = setupExecutionPage();
    fillExecution(bindings);
    bindings.requestExecution();

    try {
      const request = bindings.confirmPaymentExecution({
        reason: "",
        password: "password"
      });
      executionRuntime.route.params.paymentId = "payment-b";
      bindings.clearPaymentDetailTransientState();
      executionRuntime.fetchDetail.mockResolvedValueOnce(
        paymentExecutionDetail({ paymentId: "payment-b" })
      );
      await bindings.reloadPaymentDetail();

      pending.resolve({ id: "execution-a" });
      await request;

      expect(
        (bindings.paymentDetail.value as { id: string }).id
      ).toBe("payment-b");
      expect(bindings.actionMessage.value).toBe("");
      expect(bindings.actionBusy.value).toBe("");
    } finally {
      scope.stop();
    }
  });

  it("ignores an unmounted execution owner", async () => {
    const pending = deferred<unknown>();
    executionRuntime.recordWithUpload.mockReturnValueOnce(
      pending.promise
    );
    const { bindings, scope } = setupExecutionPage();
    fillExecution(bindings);
    bindings.requestExecution();
    const request = bindings.confirmPaymentExecution({
      reason: "",
      password: "password"
    });

    executionRuntime.beforeUnmountCallbacks[0]?.();
    pending.resolve({ id: "execution-a" });
    await request;

    expect(bindings.actionMessage.value).toBe("");
    expect(bindings.actionBusy.value).toBe("");
    scope.stop();
  });
});

function setupExecutionPage() {
  const page = setupPage();
  const detail = paymentExecutionDetail();
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

function fillExecution(bindings: PaymentPageBindings) {
  const file = new File(["voucher"], "付款凭证.pdf", {
    type: "application/pdf"
  });
  bindings.paymentActionForm.executionAmountYuan = "50000";
  bindings.paymentActionForm.paidAt =
    "2026-07-31T08:30:00.000Z";
  bindings.paymentVoucherFiles.value = [
    { raw: file, name: file.name }
  ];
  return file;
}

function paymentExecutionDetail(
  overrides: {
    paymentId?: string;
    actionEnabled?: boolean;
    executionContext?: null;
  } = {}
) {
  const expectedPaymentUpdatedAt =
    "2026-07-31T08:00:00.000Z";
  return {
    id: overrides.paymentId ?? "payment-a",
    title: "实际付款登记",
    lifecycleUpdatedAt: expectedPaymentUpdatedAt,
    executionContext:
      overrides.executionContext === null
        ? null
        : { expectedPaymentUpdatedAt },
    reviewApprovalContext: null,
    availableActions: [
      {
        key: "record_execution",
        label: "登记实际付款",
        kind: "primary",
        enabled: overrides.actionEnabled ?? true,
        disabledReason: null,
        requiredRoles: ["finance_staff"]
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
    primaryAction: "record_execution",
    lifecycleKind: "formal_record",
    ledgerView: "formal_ledger"
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
