import {
  effectScope,
  reactive,
  type Ref
} from "vue";
import type { DetailActionReadModel } from "@jiangkong/shared-domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ExecuteSettlementDraftLifecycleActionInput,
  ExecuteSettlementDraftLifecycleActionResult,
  SettlementDraftReadModel
} from "../../api/settlement-drafts.api";
import SettlementWorkbenchPage from "./SettlementWorkbenchPage.vue";

type PageBindings = {
  activeDraft: Ref<SettlementDraftReadModel | null>;
  projects: Ref<Array<{ id: string; code: string; name: string }>>;
  contracts: Ref<Array<{ contractVersionId?: string; contractId: string }>>;
  finalPreparation: Ref<{ isFinal: boolean; marker?: string } | null>;
  settlementDraftAvailableActions: Ref<DetailActionReadModel[] | null>;
  settlementDraftLifecycleActionBusy: Ref<boolean>;
  loadingContracts: Ref<boolean>;
  localRecoveryState: Ref<"clean" | "dirty" | "local_backed_up" | "failed">;
  deletePristineDraftError: Ref<string>;
  loadRequestedDraftFromRoute: () => Promise<void>;
  refreshSettlementDraftLifecycleCapability: (
    expected: Pick<SettlementDraftReadModel, "projectId" | "id" | "revision">
  ) => Promise<unknown>;
  confirmDeletePristineDraft: (request: {
    reason: string;
    password: string;
  }) => Promise<void>;
};

const lifecycleRuntime = vi.hoisted(() => ({
  route: {
    path: "/结算工作台/新建",
    query: {
      project: "",
      draftId: "draft-a"
    }
  },
  routerPush: vi.fn(),
  routerReplace: vi.fn(),
  executeLifecycle: vi.fn(),
  beforeUnmount: vi.fn(),
  watchCallbacks: [] as Array<(...args: unknown[]) => unknown>,
  fetchDraft: vi.fn(),
  listDrafts: vi.fn(),
  fetchFinalPreparation: vi.fn(),
  fetchContractOptions: vi.fn()
}));

vi.mock("vue", async (importOriginal) => {
  const original = await importOriginal<typeof import("vue")>();
  return {
    ...original,
    onBeforeUnmount: lifecycleRuntime.beforeUnmount,
    onMounted: () => undefined,
    useSSRContext: () => ({ modules: new Set<string>() }),
    watch: (_source: unknown, callback: (...args: unknown[]) => unknown) => {
      lifecycleRuntime.watchCallbacks.push(callback);
      return () => undefined;
    }
  };
});

vi.mock("vue-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("vue-router")>();
  return {
    ...original,
    useRoute: () => lifecycleRuntime.route,
    useRouter: () => ({
      push: lifecycleRuntime.routerPush,
      replace: lifecycleRuntime.routerReplace
    })
  };
});

vi.mock("../../auth/auth.store", () => ({
  useAuthStore: () => ({
    user: { id: "user-a" }
  })
}));

vi.mock("../../lib/use-unsaved-changes-guard", () => ({
  useUnsavedChangesGuard: () => undefined
}));

vi.mock("../../api/settlement-drafts.api", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../api/settlement-drafts.api")
  >();
  return {
    ...original,
    executeSettlementDraftLifecycleAction: lifecycleRuntime.executeLifecycle,
    fetchSettlementDraftRecord: lifecycleRuntime.fetchDraft,
    fetchSettlementFinalPreparation: lifecycleRuntime.fetchFinalPreparation,
    listSettlementDraftRecords: lifecycleRuntime.listDrafts
  };
});

vi.mock("../../api/core-flow-read.api", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../api/core-flow-read.api")
  >();
  return {
    ...original,
    fetchSettlementContractOptions: lifecycleRuntime.fetchContractOptions
  };
});

lifecycleRuntime.route = reactive(lifecycleRuntime.route);

function draft(
  overrides: {
    id?: string;
    projectId?: string;
    revision?: number;
    code?: string;
    action?: "delete_pristine_draft" | "abandon_application";
    blocked?: boolean;
  } = {}
): SettlementDraftReadModel {
  const id = overrides.id ?? "draft-a";
  const projectId = overrides.projectId ?? "project-a";
  const action = overrides.action ?? "delete_pristine_draft";
  return {
    id,
    projectId,
    contractVersionId: `contract-version-${projectId}`,
    code: overrides.code ?? `JS-${id}`,
    periodLabel: "2026-07",
    revision: overrides.revision ?? 12,
    status: "draft",
    isFinal: true,
    finalDeclarationSnapshot: null,
    submissionBlockingReason: overrides.blocked
      ? "该草稿当前只读"
      : null,
    updatedAt: "2026-07-31T00:00:00.000Z",
    availableActions: [{
      key: action,
      label: action === "delete_pristine_draft" ? "删除草稿" : "放弃申请",
      kind: "danger",
      enabled: true,
      disabledReason: null,
      requiresComment: action === "abandon_application"
    }]
  } as SettlementDraftReadModel;
}

function completedResult(
  input?: Pick<
    ExecuteSettlementDraftLifecycleActionInput,
    | "ownerScope"
    | "generation"
    | "projectId"
    | "draftId"
    | "expectedRevision"
    | "action"
    | "reason"
    | "expectedRequiresComment"
  >
): ExecuteSettlementDraftLifecycleActionResult {
  const current = draft();
  return {
    status: "completed",
    context: {
      ownerScope: input?.ownerScope ?? "workbench-instance-test",
      generation: input?.generation ?? 0,
      projectId: input?.projectId ?? current.projectId,
      draftId: input?.draftId ?? current.id,
      expectedRevision: input?.expectedRevision ?? current.revision,
      action: input?.action === "abandon_application"
        ? "abandon_application"
        : "delete_pristine_draft",
      reason: input?.reason ?? "用户确认删除",
      expectedRequiresComment: input?.expectedRequiresComment ?? false
    },
    preflight: current,
    response: {
      draftId: current.id,
      status: "abandoned",
      action: "delete_pristine_draft",
      idempotent: false
    }
  };
}

function setupPage(seedDraft = true) {
  const scope = effectScope();
  const bindings = scope.run(() =>
    (
      SettlementWorkbenchPage as unknown as {
        setup: (
          props: Record<string, never>,
          context: { expose: () => void }
        ) => PageBindings;
      }
    ).setup({}, { expose: () => undefined })
  );
  if (!bindings) throw new Error("settlement workbench page setup failed");
  if (seedDraft) {
    const current = draft();
    bindings.activeDraft.value = current;
    bindings.settlementDraftAvailableActions.value =
      current.availableActions ?? [];
  }
  bindings.localRecoveryState.value = "dirty";
  return { bindings, scope };
}

function confirmRequest() {
  return {
    reason: "  用户确认删除  ",
    password: ""
  };
}

function deferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise
  };
}

describe("settlement draft lifecycle page delegation", () => {
  beforeEach(() => {
    lifecycleRuntime.route.path = "/结算工作台/新建";
    lifecycleRuntime.route.query.project = "";
    lifecycleRuntime.route.query.draftId = "draft-a";
    lifecycleRuntime.routerPush.mockReset();
    lifecycleRuntime.routerPush.mockResolvedValue(undefined);
    lifecycleRuntime.routerReplace.mockReset();
    lifecycleRuntime.executeLifecycle.mockReset();
    lifecycleRuntime.beforeUnmount.mockReset();
    lifecycleRuntime.watchCallbacks.length = 0;
    lifecycleRuntime.fetchDraft.mockReset();
    lifecycleRuntime.fetchDraft.mockImplementation(
      async (projectId: string, draftId: string) =>
        draft({ id: draftId, projectId, blocked: true })
    );
    lifecycleRuntime.listDrafts.mockReset();
    lifecycleRuntime.listDrafts.mockImplementation(
      async (projectId: string) => [
        draft({
          id: projectId === "project-a" ? "draft-a" : "draft-b",
          projectId,
          blocked: true
        })
      ]
    );
    lifecycleRuntime.fetchFinalPreparation.mockReset();
    lifecycleRuntime.fetchFinalPreparation.mockImplementation(
      async (projectId: string) => ({
        isFinal: true,
        marker: projectId
      })
    );
    lifecycleRuntime.fetchContractOptions.mockReset();
    lifecycleRuntime.fetchContractOptions.mockImplementation(
      async (projectId: string) => [{
        contractId: `contract-${projectId}`,
        contractVersionId: `contract-version-${projectId}`
      }]
    );
  });

  it("ignores a completed result after route A changes to route B", async () => {
    lifecycleRuntime.executeLifecycle.mockImplementation(
      async (input: ExecuteSettlementDraftLifecycleActionInput) => {
        lifecycleRuntime.route.query.draftId = "draft-b";
        await input.onResult(completedResult(input));
        input.onOperationSettled?.();
      }
    );
    const { bindings, scope } = setupPage();

    try {
      await bindings.confirmDeletePristineDraft(confirmRequest());

      expect(bindings.localRecoveryState.value).toBe("dirty");
      expect(lifecycleRuntime.routerPush).not.toHaveBeenCalled();
      expect(bindings.settlementDraftLifecycleActionBusy.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("applies successful duplicate-confirmation side effects once", async () => {
    let releaseOperation!: () => void;
    const operation = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });
    let ownerOperation: Promise<void> | null = null;
    lifecycleRuntime.executeLifecycle.mockImplementation(
      (input: ExecuteSettlementDraftLifecycleActionInput) => {
        if (ownerOperation) {
          return ownerOperation.finally(() => {
            input.onOperationSettled?.();
          });
        }
        ownerOperation = operation.then(async () => {
          await input.onResult(completedResult(input));
          input.onOperationSettled?.();
        });
        return ownerOperation;
      }
    );
    const { bindings, scope } = setupPage();

    try {
      const first = bindings.confirmDeletePristineDraft(confirmRequest());
      const repeated = bindings.confirmDeletePristineDraft(confirmRequest());

      expect(lifecycleRuntime.executeLifecycle).toHaveBeenCalledTimes(2);
      releaseOperation();
      await Promise.all([first, repeated]);
      expect(bindings.localRecoveryState.value).toBe("clean");
      expect(lifecycleRuntime.routerPush).toHaveBeenCalledTimes(1);
      expect(bindings.settlementDraftLifecycleActionBusy.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("keeps the active owner busy when a competing caller settles", async () => {
    let releaseOwner!: () => void;
    const ownerPending = new Promise<void>((resolve) => {
      releaseOwner = resolve;
    });
    lifecycleRuntime.executeLifecycle
      .mockImplementationOnce(
        (input: ExecuteSettlementDraftLifecycleActionInput) =>
          ownerPending.finally(() => {
            input.onOperationSettled?.();
          })
      )
      .mockImplementationOnce(
        async (input: ExecuteSettlementDraftLifecycleActionInput) => {
          input.onOperationFailure?.(new Error("另一项操作正在进行"));
          input.onOperationSettled?.();
        }
      );
    const { bindings, scope } = setupPage();

    try {
      const owner = bindings.confirmDeletePristineDraft(confirmRequest());
      await bindings.confirmDeletePristineDraft({
        ...confirmRequest(),
        reason: "另一项删除原因"
      });

      expect(bindings.settlementDraftLifecycleActionBusy.value).toBe(true);
      releaseOwner();
      await owner;
      expect(bindings.settlementDraftLifecycleActionBusy.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("uses a new owner scope after the workbench remounts", async () => {
    const ownerPending = deferred<void>();
    const inputs: ExecuteSettlementDraftLifecycleActionInput[] = [];
    lifecycleRuntime.executeLifecycle.mockImplementation(
      (input: ExecuteSettlementDraftLifecycleActionInput) => {
        inputs.push(input);
        if (inputs.length === 1) {
          return ownerPending.promise.finally(() => {
            input.onOperationSettled?.();
          });
        }
        input.onOperationFailure?.(new Error("旧页面操作仍在进行"));
        input.onOperationSettled?.();
        return Promise.resolve();
      }
    );
    const oldPage = setupPage();

    try {
      const oldOwner =
        oldPage.bindings.confirmDeletePristineDraft(confirmRequest());
      const beforeUnmount =
        lifecycleRuntime.beforeUnmount.mock.calls[0]?.[0];
      if (typeof beforeUnmount !== "function") {
        throw new Error("settlement workbench beforeUnmount hook missing");
      }
      beforeUnmount();

      const newPage = setupPage();
      try {
        await newPage.bindings.confirmDeletePristineDraft(confirmRequest());
        expect(inputs).toHaveLength(2);
        expect(inputs[0]?.ownerScope).toBeTruthy();
        expect(inputs[1]?.ownerScope).toBeTruthy();
        expect(inputs[1]?.ownerScope).not.toBe(inputs[0]?.ownerScope);
        expect(
          newPage.bindings.settlementDraftLifecycleActionBusy.value
        ).toBe(false);
      } finally {
        newPage.scope.stop();
      }

      ownerPending.resolve();
      await oldOwner;
    } finally {
      oldPage.scope.stop();
    }
  });

  it("keeps local state and releases busy after an ordinary failure", async () => {
    lifecycleRuntime.executeLifecycle.mockImplementation(
      async (input: ExecuteSettlementDraftLifecycleActionInput) => {
        input.onOperationFailure?.(new Error("服务暂时不可用"));
        input.onOperationSettled?.();
      }
    );
    const { bindings, scope } = setupPage();

    try {
      await bindings.confirmDeletePristineDraft(confirmRequest());

      expect(bindings.localRecoveryState.value).toBe("dirty");
      expect(lifecycleRuntime.routerPush).not.toHaveBeenCalled();
      expect(bindings.deletePristineDraftError.value).toBe("服务暂时不可用");
      expect(bindings.settlementDraftLifecycleActionBusy.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("keeps route B contract state and loading ownership when route A resolves late", async () => {
    const contractsA = deferred<Array<{
      contractId: string;
      contractVersionId: string;
    }>>();
    const contractsB = deferred<Array<{
      contractId: string;
      contractVersionId: string;
    }>>();
    lifecycleRuntime.fetchContractOptions.mockImplementation(
      (projectId: string) =>
        projectId === "project-a" ? contractsA.promise : contractsB.promise
    );
    const { bindings, scope } = setupPage(false);
    bindings.projects.value = [
      { id: "project-a", code: "PA", name: "项目 A" },
      { id: "project-b", code: "PB", name: "项目 B" }
    ];
    lifecycleRuntime.route.query.project = "project-a";
    lifecycleRuntime.route.query.draftId = "draft-a";

    try {
      const loadA = bindings.loadRequestedDraftFromRoute();
      await vi.waitFor(() => {
        expect(lifecycleRuntime.fetchContractOptions).toHaveBeenCalledWith(
          "project-a"
        );
      });

      lifecycleRuntime.route.query.project = "project-b";
      lifecycleRuntime.route.query.draftId = "draft-b";
      const loadB = bindings.loadRequestedDraftFromRoute();
      await vi.waitFor(() => {
        expect(lifecycleRuntime.fetchContractOptions).toHaveBeenCalledWith(
          "project-b"
        );
      });

      contractsA.resolve([{
        contractId: "contract-project-a",
        contractVersionId: "contract-version-project-a"
      }]);
      await loadA;
      expect(bindings.loadingContracts.value).toBe(true);
      expect(bindings.contracts.value).toEqual([]);

      contractsB.resolve([{
        contractId: "contract-project-b",
        contractVersionId: "contract-version-project-b"
      }]);
      await loadB;
      expect(bindings.loadingContracts.value).toBe(false);
      expect(bindings.contracts.value).toEqual([{
        contractId: "contract-project-b",
        contractVersionId: "contract-version-project-b"
      }]);
      expect(bindings.activeDraft.value?.id).toBe("draft-b");
    } finally {
      scope.stop();
    }
  });

  it("does not let route A final preparation overwrite route B", async () => {
    const finalA = deferred<{ isFinal: boolean; marker: string }>();
    lifecycleRuntime.fetchFinalPreparation.mockImplementation(
      (projectId: string) =>
        projectId === "project-a"
          ? finalA.promise
          : Promise.resolve({ isFinal: true, marker: "project-b" })
    );
    const { bindings, scope } = setupPage(false);
    bindings.projects.value = [
      { id: "project-a", code: "PA", name: "项目 A" },
      { id: "project-b", code: "PB", name: "项目 B" }
    ];
    lifecycleRuntime.route.query.project = "project-a";
    lifecycleRuntime.route.query.draftId = "draft-a";

    try {
      const loadA = bindings.loadRequestedDraftFromRoute();
      await vi.waitFor(() => {
        expect(
          lifecycleRuntime.fetchFinalPreparation
        ).toHaveBeenCalledWith("project-a", "draft-a");
      });

      lifecycleRuntime.route.query.project = "project-b";
      lifecycleRuntime.route.query.draftId = "draft-b";
      await bindings.loadRequestedDraftFromRoute();
      expect(bindings.finalPreparation.value?.marker).toBe("project-b");

      finalA.resolve({ isFinal: true, marker: "project-a" });
      await loadA;
      expect(bindings.finalPreparation.value?.marker).toBe("project-b");
      expect(bindings.activeDraft.value?.id).toBe("draft-b");
    } finally {
      scope.stop();
    }
  });

  it("does not let a stale route A capability failure clear route B actions", async () => {
    const capabilityA = deferred<SettlementDraftReadModel>();
    const freshB = draft({
      id: "draft-b",
      projectId: "project-b",
      action: "abandon_application"
    });
    lifecycleRuntime.fetchDraft.mockImplementation(
      (projectId: string) =>
        projectId === "project-a"
          ? capabilityA.promise
          : Promise.resolve(freshB)
    );
    const { bindings, scope } = setupPage();
    bindings.projects.value = [
      { id: "project-a", code: "PA", name: "项目 A" },
      { id: "project-b", code: "PB", name: "项目 B" }
    ];
    lifecycleRuntime.route.query.project = "project-a";
    lifecycleRuntime.route.query.draftId = "draft-a";

    try {
      const staleA =
        bindings.refreshSettlementDraftLifecycleCapability(draft()).catch(() => {
          bindings.settlementDraftAvailableActions.value = null;
        });
      await vi.waitFor(() => {
        expect(lifecycleRuntime.fetchDraft).toHaveBeenCalledWith(
          "project-a",
          "draft-a"
        );
      });

      lifecycleRuntime.route.query.project = "project-b";
      lifecycleRuntime.route.query.draftId = "draft-b";
      bindings.activeDraft.value = freshB;
      bindings.settlementDraftAvailableActions.value =
        freshB.availableActions ?? [];
      await bindings.refreshSettlementDraftLifecycleCapability(freshB);
      expect(bindings.settlementDraftAvailableActions.value).toBe(
        freshB.availableActions
      );

      capabilityA.reject(new Error("route A capability failed"));
      await staleA;
      expect(bindings.settlementDraftAvailableActions.value).toBe(
        freshB.availableActions
      );
    } finally {
      scope.stop();
    }
  });
});
