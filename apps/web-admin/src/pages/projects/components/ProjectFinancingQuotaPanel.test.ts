import { effectScope, nextTick, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectFinancingQuotaPanel from "./ProjectFinancingQuotaPanel.vue";
import type {
  ProjectFinancingQuotaRequestResult,
  ProjectFinancingQuotaWorkbenchReadModel
} from "../../../api/project-financing-quota.api";

const quotaRuntime = vi.hoisted(() => ({
  beforeUnmount: vi.fn(),
  fetchWorkbench: vi.fn(),
  request: vi.fn()
}));

vi.mock("vue", async (importOriginal) => {
  const original = await importOriginal<typeof import("vue")>();
  return {
    ...original,
    onBeforeUnmount: quotaRuntime.beforeUnmount,
    useSSRContext: () => ({ modules: new Set<string>() })
  };
});

vi.mock("../../../api/project-financing-quota.api", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../../api/project-financing-quota.api")
  >();
  return {
    ...original,
    fetchProjectFinancingQuotaRequestCapability: quotaRuntime.fetchWorkbench,
    requestProjectFinancingQuotaWithUpload: quotaRuntime.request
  };
});

type MutableValue<T> = { value: T };
type RequestContext = {
  projectId: string;
  projectGeneration: number;
  idempotencyKey: string;
};
type PanelBindings = {
  openRequest: () => Promise<void>;
  requestBusy: MutableValue<boolean>;
  requestContext: MutableValue<RequestContext>;
  requestError: MutableValue<string>;
  requestLaunchError: MutableValue<string>;
  requestFiles: MutableValue<Array<{ raw?: File }>>;
  requestForm: MutableValue<{
    amountYuan: string;
    reason: string;
    validUntil: string;
  }>;
  requestVisible: MutableValue<boolean>;
  submitRequest: () => Promise<unknown>;
};

function action(enabled = true) {
  return {
    key: "request_financing_quota",
    label: "申请垫资额度",
    kind: "primary",
    enabled,
    disabledReason: enabled ? null : "当前不可申请",
    requiredAction: "project.financing_quota.request",
    requiresFile: true
  };
}

function workbench(
  projectId: string,
  rows: ProjectFinancingQuotaWorkbenchReadModel["rows"] = []
): ProjectFinancingQuotaWorkbenchReadModel {
  return {
    project: { id: projectId, code: "JGXM-001", name: "项目一" },
    policy: {
      allocationOrder: ["project_cash", "financing_quota"],
      userSelectable: false
    },
    summary: {
      quotaAmountCents: "0",
      netUsedAmountCents: "0",
      currentlyAvailableAmountCents: "0"
    },
    requestAction: action(),
    rows
  };
}

function result(projectId: string): ProjectFinancingQuotaRequestResult {
  return {
    receipt: {
      kind: "created",
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      projectId,
      quotaId: "quota-1"
    },
    workbench: workbench(projectId)
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

function setupPanel(projectId = "project-a") {
  const props = reactive({
    projectId,
    workbench: workbench(projectId)
  });
  const emit = vi.fn();
  const scope = effectScope();
  const bindings = scope.run(() =>
    (
      ProjectFinancingQuotaPanel as unknown as {
        setup: (
          panelProps: typeof props,
          context: { emit: typeof emit; expose: () => void }
        ) => PanelBindings;
      }
    ).setup(props, { emit, expose: () => undefined })
  );
  if (!bindings) throw new Error("financing quota panel setup failed");
  const invokeBeforeUnmount = () => {
    const callback = quotaRuntime.beforeUnmount.mock.calls.at(-1)?.[0];
    if (typeof callback !== "function") {
      throw new Error("financing quota unmount hook missing");
    }
    callback();
  };
  return { bindings, emit, invokeBeforeUnmount, props, scope };
}

describe("project financing quota F1 panel", () => {
  beforeEach(() => {
    quotaRuntime.beforeUnmount.mockReset();
    quotaRuntime.fetchWorkbench.mockReset();
    quotaRuntime.request.mockReset();
  });

  it("freezes one dialog attempt and emits only the authoritative refreshed workbench", async () => {
    quotaRuntime.fetchWorkbench.mockResolvedValueOnce(workbench("project-a"));
    quotaRuntime.request.mockResolvedValueOnce(result("project-a"));
    const { bindings, emit, scope } = setupPanel();

    await bindings.openRequest();
    expect(bindings.requestVisible.value).toBe(true);
    expect(bindings.requestContext.value).toMatchObject({
      projectId: "project-a",
      projectGeneration: 0
    });
    expect(bindings.requestContext.value.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    );
    bindings.requestForm.value = {
      amountYuan: "50000",
      reason: "保障现场付款",
      validUntil: ""
    };
    bindings.requestFiles.value = [{
      raw: new File(["voucher"], "financing.pdf", {
        type: "application/pdf"
      })
    }];

    await bindings.submitRequest();

    expect(emit).toHaveBeenCalledWith("updated", expect.objectContaining({
      project: expect.objectContaining({ id: "project-a" })
    }));
    expect(bindings.requestVisible.value).toBe(false);
    scope.stop();
  });

  it("does not publish a late result after the project switches", async () => {
    const pending = deferred<ProjectFinancingQuotaRequestResult>();
    quotaRuntime.fetchWorkbench.mockResolvedValueOnce(workbench("project-a"));
    quotaRuntime.request.mockReturnValueOnce(pending.promise);
    const { bindings, emit, props, scope } = setupPanel();

    await bindings.openRequest();
    const submission = bindings.submitRequest();
    const requestInput = quotaRuntime.request.mock.calls[0]?.[1];
    props.projectId = "project-b";
    props.workbench = workbench("project-b");
    await nextTick();

    expect(requestInput.isCurrent(requestInput.context)).toBe(false);
    pending.resolve(result("project-a"));
    await submission;
    await flushPromises();

    expect(emit).not.toHaveBeenCalledWith("updated", expect.anything());
    expect(bindings.requestVisible.value).toBe(false);
    scope.stop();
  });

  it("does not publish a late result after unmount", async () => {
    const pending = deferred<ProjectFinancingQuotaRequestResult>();
    quotaRuntime.fetchWorkbench.mockResolvedValueOnce(workbench("project-a"));
    quotaRuntime.request.mockReturnValueOnce(pending.promise);
    const { bindings, emit, invokeBeforeUnmount, scope } = setupPanel();

    await bindings.openRequest();
    const submission = bindings.submitRequest();
    const requestInput = quotaRuntime.request.mock.calls[0]?.[1];
    invokeBeforeUnmount();

    expect(requestInput.isCurrent(requestInput.context)).toBe(false);
    pending.resolve(result("project-a"));
    await submission;
    await flushPromises();

    expect(emit).not.toHaveBeenCalledWith("updated", expect.anything());
    scope.stop();
  });

  it("normalizes a malformed fresh capability response before opening the dialog", async () => {
    quotaRuntime.fetchWorkbench.mockRejectedValueOnce(
      new SyntaxError("Unexpected end of JSON input")
    );
    const { bindings, scope } = setupPanel();

    await bindings.openRequest();

    expect(bindings.requestVisible.value).toBe(false);
    expect(bindings.requestLaunchError.value).toBe(
      "项目垫资额度申请资格数据异常，请刷新后重试"
    );
    scope.stop();
  });
});
