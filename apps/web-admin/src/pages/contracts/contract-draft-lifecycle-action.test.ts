import {
  effectScope,
  reactive,
  ref,
  type Ref
} from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ContractWorkbenchPage from "./ContractWorkbenchPage.vue";

type ContractDraftLifecycleAction =
  | "delete_pristine_draft"
  | "abandon_application";

type WorkbenchSnapshot = {
  contract: {
    id: string;
    code: string | null;
    temporaryCode: string;
    name: string;
  };
  version: {
    id: string;
    status: "draft";
    draftRevision: number;
  };
  lifecycleKind: "pristine_draft" | "approval_draft";
  availableActions: Array<{
    key: ContractDraftLifecycleAction;
    label: string;
    kind: "danger";
    enabled: boolean;
    disabledReason: string | null;
    requiresComment: boolean;
  }>;
};

type DraftRuntime = {
  workbench: Ref<WorkbenchSnapshot | null>;
  savedRevision: Ref<number>;
  load: ReturnType<typeof vi.fn>;
  discardLocalState: ReturnType<typeof vi.fn>;
  suspendAutosaveForLifecycleAction: ReturnType<typeof vi.fn>;
  resumeAutosaveAfterLifecycleAction: ReturnType<typeof vi.fn>;
};

type PageBindings = {
  contractDraftAvailableActions: Ref<WorkbenchSnapshot["availableActions"] | null>;
  confirmDeletePristineDraft: (request: {
    reason: string;
    password: string;
  }) => Promise<void>;
  confirmAbandonApplication: (request: {
    reason: string;
    password: string;
  }) => Promise<void>;
  loadExpectedWorkbench: (contractId: string) => Promise<void>;
};

const lifecycleRuntime = vi.hoisted(() => ({
  route: {
    params: { contractId: "contract-a" },
    query: { versionId: "version-a" }
  },
  routerPush: vi.fn(),
  routerReplace: vi.fn(),
  fetchWorkbench: vi.fn(),
  executeLifecycle: vi.fn(),
  beforeUnmount: vi.fn(),
  draft: null as DraftRuntime | null
}));

vi.mock("vue", async (importOriginal) => {
  const original = await importOriginal<typeof import("vue")>();
  return {
    ...original,
    onBeforeUnmount: lifecycleRuntime.beforeUnmount,
    onMounted: () => undefined,
    useSSRContext: () => ({ modules: new Set<string>() }),
    watch: () => () => undefined
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

vi.mock("../../api/contract-workbench.api", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../api/contract-workbench.api")
  >();
  return {
    ...original,
    executeContractDraftLifecycleAction: lifecycleRuntime.executeLifecycle,
    fetchContractDraftWorkbench: lifecycleRuntime.fetchWorkbench
  };
});

vi.mock("./workbench/use-contract-draft", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("./workbench/use-contract-draft")
  >();
  return {
    ...original,
    useContractDraft: () => {
      if (!lifecycleRuntime.draft) {
        throw new Error("contract draft test runtime is not prepared");
      }
      return lifecycleRuntime.draft;
    }
  };
});

lifecycleRuntime.route = reactive(lifecycleRuntime.route);

function workbenchSnapshot(
  action: ContractDraftLifecycleAction = "delete_pristine_draft",
  overrides: {
    contractId?: string;
    versionId?: string;
    revision?: number;
  } = {}
): WorkbenchSnapshot {
  return {
    contract: {
      id: overrides.contractId ?? "contract-a",
      code: null,
      temporaryCode: "HT-TEMP-A",
      name: "测试合同草稿"
    },
    version: {
      id: overrides.versionId ?? "version-a",
      status: "draft",
      draftRevision: overrides.revision ?? 12
    },
    lifecycleKind:
      action === "delete_pristine_draft"
        ? "pristine_draft"
        : "approval_draft",
    availableActions: [{
      key: action,
      label:
        action === "delete_pristine_draft" ? "删除纯净草稿" : "结束申请",
      kind: "danger",
      enabled: true,
      disabledReason: null,
      requiresComment: action === "abandon_application"
    }]
  };
}

function createDraftRuntime(initial: WorkbenchSnapshot): DraftRuntime {
  const workbench = ref<WorkbenchSnapshot | null>(null);
  const savedRevision = ref(initial.version.draftRevision);
  const model = reactive({
    taxMode: "tax_exclusive",
    defaultTaxRatePercent: "9"
  });
  const aggregateModel = reactive({
    draft: model,
    parties: [],
    bills: [],
    paymentTerms: null,
    attachments: [],
    negotiationDocuments: {}
  });
  const load = vi.fn(async () => {
    workbench.value = structuredClone(initial);
    savedRevision.value = initial.version.draftRevision;
    return initial;
  });
  const discardLocalState = vi.fn();
  const suspendAutosaveForLifecycleAction = vi.fn(() => true);
  const resumeAutosaveAfterLifecycleAction = vi.fn();

  lifecycleRuntime.draft = {
    aggregateModel,
    model,
    workbench,
    saveState: ref("saved"),
    saveError: ref(null),
    conflict: ref(null),
    dirty: ref(false),
    isDirty: ref(false),
    initializeDraft: {
      projectId: ref("project-a"),
      businessScenarioId: ref(""),
      contractTypeKey: ref(""),
      businessTemplateVersionId: ref(""),
      amountLimitType: ref("capped"),
      canCreate: ref(false),
      commit: vi.fn(),
      setProjectId: vi.fn(),
      setBusinessScenarioSelection: vi.fn(),
      setContractTypeKey: vi.fn(),
      setBusinessTemplateVersionId: vi.fn(),
      setAmountLimitType: vi.fn()
    },
    load,
    markDirty: vi.fn(),
    discardLocalState,
    suspendAutosaveForLifecycleAction,
    resumeAutosaveAfterLifecycleAction,
    savedRevision,
    formalSaveCompleted: ref(false),
    lastSavedAt: ref(null),
    lease: ref({ kind: "active" }),
    canEdit: ref(true),
    pendingLocalRecovery: ref(null),
    saveNow: vi.fn(),
    queuePreviewForCurrentRevision: vi.fn(),
    submitNow: vi.fn(),
    takeOverLease: vi.fn(),
    restoreLocalRecovery: vi.fn(),
    discardLocalRecovery: vi.fn(),
    retryConflictServerLoad: vi.fn(),
    keepLocalAfterConflict: vi.fn(),
    loadServerAfterConflict: vi.fn()
  } as unknown as DraftRuntime;

  return lifecycleRuntime.draft;
}

function setupPage(initial = workbenchSnapshot()) {
  const draft = createDraftRuntime(initial);
  const scope = effectScope();
  const bindings = scope.run(() =>
    (
      ContractWorkbenchPage as unknown as {
        setup: (
          props: Record<string, never>,
          context: { expose: () => void }
        ) => PageBindings;
      }
    ).setup({}, { expose: () => undefined })
  );
  if (!bindings) throw new Error("contract workbench page setup failed");
  return { bindings, draft, scope };
}

async function preparePage(initial = workbenchSnapshot()) {
  lifecycleRuntime.fetchWorkbench.mockResolvedValueOnce(initial);
  const page = setupPage(initial);
  await page.bindings.loadExpectedWorkbench(initial.contract.id);
  return page;
}

function actionRequest(password = "") {
  return { reason: "  用户确认结束  ", password };
}

describe("contract draft lifecycle page delegation", () => {
  beforeEach(() => {
    lifecycleRuntime.route.params.contractId = "contract-a";
    lifecycleRuntime.route.query.versionId = "version-a";
    lifecycleRuntime.routerPush.mockReset();
    lifecycleRuntime.routerPush.mockResolvedValue(undefined);
    lifecycleRuntime.routerReplace.mockReset();
    lifecycleRuntime.fetchWorkbench.mockReset();
    lifecycleRuntime.executeLifecycle.mockReset();
    lifecycleRuntime.beforeUnmount.mockReset();
    lifecycleRuntime.draft = null;
  });

  it("keeps the action collection on the direct authoritative GET response", async () => {
    const capability = workbenchSnapshot();
    const { bindings, draft, scope } = await preparePage(capability);

    try {
      expect(lifecycleRuntime.fetchWorkbench).toHaveBeenCalledWith("version-a");
      expect(bindings.contractDraftAvailableActions.value).toBe(
        capability.availableActions
      );
      expect(draft.workbench.value).not.toBe(capability);
    } finally {
      scope.stop();
    }
  });

  it("passes raw action input and exact page coordinates to the governed API composite", async () => {
    const completed = {
      status: "completed",
      context: {
        generation: 1,
        contractId: "contract-a",
        versionId: "version-a",
        expectedRevision: 12,
        action: "delete_pristine_draft",
        reason: "用户确认结束"
      },
      preflight: workbenchSnapshot(),
      response: {
        contractVersionId: "version-a",
        status: "abandoned",
        lifecycleKind: "pristine_draft",
        action: "delete_pristine_draft"
      }
    };
    lifecycleRuntime.executeLifecycle.mockImplementation(
      async (input) => input.onResult(completed)
    );
    const { bindings, draft, scope } = await preparePage();

    try {
      await bindings.confirmDeletePristineDraft(
        actionRequest("current-password")
      );

      expect(lifecycleRuntime.executeLifecycle).toHaveBeenCalledWith(
        expect.objectContaining({
          generation: 1,
          contractId: "contract-a",
          versionId: "version-a",
          expectedRevision: 12,
          action: "delete_pristine_draft",
          reason: "  用户确认结束  ",
          currentPassword: "current-password",
          isCurrent: expect.any(Function),
          beforeWrite: draft.suspendAutosaveForLifecycleAction,
          onWriteFailure: draft.resumeAutosaveAfterLifecycleAction
        })
      );
      expect(draft.discardLocalState).toHaveBeenCalledTimes(1);
      expect(lifecycleRuntime.routerPush).toHaveBeenCalledWith({
        path: "/contracts",
        query: { view: "ended" }
      });
    } finally {
      scope.stop();
    }
  });

  it("delegates repeated confirmation to the global coalescer without duplicate result effects", async () => {
    const completed = {
      status: "completed",
      context: {
        generation: 1,
        contractId: "contract-a",
        versionId: "version-a",
        expectedRevision: 12,
        action: "delete_pristine_draft",
        reason: "用户确认结束"
      },
      preflight: workbenchSnapshot(),
      response: {
        contractVersionId: "version-a",
        status: "abandoned",
        lifecycleKind: "pristine_draft",
        action: "delete_pristine_draft"
      }
    };
    let releaseOperation!: () => void;
    const operation = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });
    let ownerOperation: Promise<void> | null = null;
    lifecycleRuntime.executeLifecycle.mockImplementation((input) => {
      if (ownerOperation) return ownerOperation;
      ownerOperation = operation.then(async () => {
        await input.onResult(completed);
        input.onOperationSettled();
      });
      return ownerOperation;
    });
    const { bindings, draft, scope } = await preparePage();

    try {
      const first = bindings.confirmDeletePristineDraft(actionRequest());
      const repeated = bindings.confirmDeletePristineDraft(actionRequest());

      expect(lifecycleRuntime.executeLifecycle).toHaveBeenCalledTimes(2);
      releaseOperation();
      await Promise.all([first, repeated]);
      expect(draft.discardLocalState).toHaveBeenCalledTimes(1);
      expect(lifecycleRuntime.routerPush).toHaveBeenCalledTimes(1);
    } finally {
      scope.stop();
    }
  });

  it("binds the approval-draft confirmation to the literal abandon action", async () => {
    lifecycleRuntime.executeLifecycle.mockResolvedValue({
      status: "stale",
      context: {
        generation: 1,
        contractId: "contract-a",
        versionId: "version-a",
        expectedRevision: 12,
        action: "abandon_application",
        reason: "用户确认结束"
      }
    });
    const { bindings, scope } = await preparePage(
      workbenchSnapshot("abandon_application")
    );

    try {
      await bindings.confirmAbandonApplication(actionRequest());
      expect(lifecycleRuntime.executeLifecycle).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "abandon_application",
          reason: "  用户确认结束  "
        })
      );
    } finally {
      scope.stop();
    }
  });

  it("does not discard or redirect when the governed composite reports stale", async () => {
    const stale = {
      status: "stale",
      context: {
        generation: 1,
        contractId: "contract-a",
        versionId: "version-a",
        expectedRevision: 12,
        action: "delete_pristine_draft",
        reason: "用户确认结束"
      }
    };
    lifecycleRuntime.executeLifecycle.mockImplementation(
      async (input) => input.onResult(stale)
    );
    const { bindings, draft, scope } = await preparePage();

    try {
      await bindings.confirmDeletePristineDraft(actionRequest());
      expect(draft.discardLocalState).not.toHaveBeenCalled();
      expect(lifecycleRuntime.routerPush).not.toHaveBeenCalled();
    } finally {
      scope.stop();
    }
  });

  it("hides stale capabilities when the composite rejects a coordinate mismatch", async () => {
    const mismatch = Object.assign(new Error("读取坐标已变化"), {
        code: "CONTRACT_DRAFT_LIFECYCLE_PREFLIGHT_MISMATCH"
      });
    lifecycleRuntime.executeLifecycle.mockImplementation(
      async (input) => {
        input.onCapabilityFailure(mismatch);
        input.onOperationFailure(mismatch);
        input.onOperationSettled();
      }
    );
    const { bindings, scope } = await preparePage();

    try {
      await bindings.confirmDeletePristineDraft(actionRequest());
      expect(bindings.contractDraftAvailableActions.value).toBeNull();
    } finally {
      scope.stop();
    }
  });

  it("rejects a mismatched capability GET before advertising an action", async () => {
    const initial = workbenchSnapshot();
    lifecycleRuntime.fetchWorkbench.mockResolvedValueOnce(
      workbenchSnapshot("delete_pristine_draft", {
        versionId: "version-other"
      })
    );
    const { bindings, scope } = setupPage(initial);

    try {
      await expect(
        bindings.loadExpectedWorkbench("contract-a")
      ).rejects.toThrow("工作台返回的合同版本");
      expect(bindings.contractDraftAvailableActions.value).toBeNull();
    } finally {
      scope.stop();
    }
  });

  it("rejects a newer capability revision before advertising it on stale workbench data", async () => {
    const initial = workbenchSnapshot();
    lifecycleRuntime.fetchWorkbench.mockResolvedValueOnce(
      workbenchSnapshot("delete_pristine_draft", {
        revision: 13
      })
    );
    const { bindings, scope } = setupPage(initial);

    try {
      await expect(
        bindings.loadExpectedWorkbench("contract-a")
      ).rejects.toThrow("工作台返回的合同版本");
      expect(bindings.contractDraftAvailableActions.value).toBeNull();
    } finally {
      scope.stop();
    }
  });

  it("invalidates the API composite context when the workbench unmounts", async () => {
    lifecycleRuntime.executeLifecycle.mockResolvedValue({
      status: "stale",
      context: {
        generation: 1,
        contractId: "contract-a",
        versionId: "version-a",
        expectedRevision: 12,
        action: "delete_pristine_draft",
        reason: "用户确认结束"
      }
    });
    const { bindings, scope } = await preparePage();

    try {
      await bindings.confirmDeletePristineDraft(actionRequest());
      const input = lifecycleRuntime.executeLifecycle.mock.calls[0]?.[0];
      expect(input.isCurrent({
        generation: 1,
        contractId: "contract-a",
        versionId: "version-a",
        expectedRevision: 12,
        action: "delete_pristine_draft",
        reason: "用户确认结束"
      })).toBe(true);

      const beforeUnmount =
        lifecycleRuntime.beforeUnmount.mock.calls.at(-1)?.[0];
      if (typeof beforeUnmount !== "function") {
        throw new Error("contract workbench beforeUnmount hook missing");
      }
      beforeUnmount();
      expect(input.isCurrent({
        generation: 1,
        contractId: "contract-a",
        versionId: "version-a",
        expectedRevision: 12,
        action: "delete_pristine_draft",
        reason: "用户确认结束"
      })).toBe(false);
    } finally {
      scope.stop();
    }
  });
});
