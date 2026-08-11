import {
  computed,
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
  authoritySnapshot: Ref<{
    workbench: WorkbenchSnapshot;
    contractId: string;
    contractVersionId: string;
    draftRevision: number;
    capabilityReceipt: {
      contractId: string;
      contractVersionId: string;
      draftRevision: number;
    };
    availableActions: WorkbenchSnapshot["availableActions"];
    draftOperationAvailableActions: string[];
    lease: { kind: string };
    refreshRequired: boolean;
    canWrite: boolean;
    readonly: boolean;
    lifecycleKind: WorkbenchSnapshot["lifecycleKind"];
  } | null>;
  savedRevision: Ref<number>;
  lifecycle: {
    state: Ref<{
      busy: boolean;
      deleteRetryPending: boolean;
      deleteError: string;
      abandonError: string;
    }>;
    commands: {
      deletePristineDraft: ReturnType<typeof vi.fn>;
      abandonApplication: ReturnType<typeof vi.fn>;
    };
  };
  load: ReturnType<typeof vi.fn>;
  clearAuthoritySnapshot: ReturnType<typeof vi.fn>;
  requireAuthorityRefresh: ReturnType<typeof vi.fn>;
};

type PageBindings = {
  contractDraftAvailableActions: Ref<WorkbenchSnapshot["availableActions"] | null>;
  deletePristineDraftError: Ref<string>;
  confirmDeletePristineDraft: (request: {
    reason: string;
    password: string;
  }) => Promise<void>;
  confirmAbandonApplication: (request: {
    reason: string;
    password: string;
  }) => Promise<void>;
};

const lifecycleRuntime = vi.hoisted(() => ({
  route: {
    params: { contractId: "contract-a" },
    query: { versionId: "version-a" }
  },
  routerPush: vi.fn(),
  routerReplace: vi.fn(),
  fetchWorkbench: vi.fn(),
  executeDeletePristineDraft: vi.fn(),
  executeAbandonApplication: vi.fn(),
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
    executeDeletePristineContractDraftAction:
      lifecycleRuntime.executeDeletePristineDraft,
    executeAbandonContractDraftAction:
      lifecycleRuntime.executeAbandonApplication,
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
  const lease = ref({ kind: "active" });
  const authoritySnapshot = computed(() => {
    const snapshot = workbench.value;
    if (!snapshot) return null;
    return {
      workbench: snapshot,
      contractId: snapshot.contract.id,
      contractVersionId: snapshot.version.id,
      draftRevision: snapshot.version.draftRevision,
      capabilityReceipt: {
        contractId: snapshot.contract.id,
        contractVersionId: snapshot.version.id,
        draftRevision: snapshot.version.draftRevision
      },
      availableActions: snapshot.availableActions,
      draftOperationAvailableActions: ["save_contract_draft"],
      lease: lease.value,
      refreshRequired: false,
      canWrite: true,
      readonly: false,
      lifecycleKind: snapshot.lifecycleKind
    };
  });
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
  const clearAuthoritySnapshot = vi.fn(() => {
    workbench.value = null;
  });
  const requireAuthorityRefresh = vi.fn();
  const lifecycle = {
    state: ref({
      busy: false,
      deleteRetryPending: false,
      deleteError: "",
      abandonError: ""
    }),
    commands: {
      deletePristineDraft: vi.fn(),
      abandonApplication: vi.fn()
    }
  };

  lifecycleRuntime.draft = {
    aggregateModel,
    model,
    authoritySnapshot,
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
    clearAuthoritySnapshot,
    requireAuthorityRefresh,
    markDirty: vi.fn(),
    lifecycle,
    savedRevision,
    formalSaveCompleted: ref(false),
    lastSavedAt: ref(null),
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
  const page = setupPage(initial);
  await page.draft.load(initial.version.id);
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
    lifecycleRuntime.executeDeletePristineDraft.mockReset();
    lifecycleRuntime.executeAbandonApplication.mockReset();
    lifecycleRuntime.beforeUnmount.mockReset();
    lifecycleRuntime.draft = null;
  });

  it("renders lifecycle actions from the draft authority snapshot without a second GET", async () => {
    const capability = workbenchSnapshot();
    const { bindings, draft, scope } = await preparePage(capability);

    try {
      expect(lifecycleRuntime.fetchWorkbench).not.toHaveBeenCalled();
      expect(bindings.contractDraftAvailableActions.value).toBe(
        draft.authoritySnapshot.value?.availableActions
      );
      expect(draft.authoritySnapshot.value?.workbench).not.toBe(capability);
    } finally {
      scope.stop();
    }
  });

  it("executes the visible delete action through the existing draft session command", async () => {
    const { bindings, draft, scope } = await preparePage();
    draft.lifecycle.commands.deletePristineDraft.mockResolvedValue({
      status: "retryable"
    });

    try {
      await bindings.confirmDeletePristineDraft(actionRequest());
      expect(draft.lifecycle.commands.deletePristineDraft).toHaveBeenCalledWith(
        actionRequest()
      );
      expect(lifecycleRuntime.executeDeletePristineDraft).not.toHaveBeenCalled();
    } finally {
      scope.stop();
    }
  });

  it("keeps retryable deletion visible and redirects only after the command completes", async () => {
    const { bindings, draft, scope } = await preparePage();
    draft.lifecycle.commands.deletePristineDraft
      .mockImplementationOnce(async () => {
        draft.lifecycle.state.value = {
          ...draft.lifecycle.state.value,
          deleteRetryPending: true,
          deleteError: "草稿清理未完成，请重试"
        };
        return { status: "retryable" };
      })
      .mockResolvedValueOnce({ status: "completed" });

    try {
      await bindings.confirmDeletePristineDraft(actionRequest());
      expect(bindings.deletePristineDraftError.value).toContain("清理未完成");
      expect(lifecycleRuntime.routerPush).not.toHaveBeenCalled();

      await bindings.confirmDeletePristineDraft(actionRequest());
      expect(draft.lifecycle.commands.deletePristineDraft).toHaveBeenCalledTimes(2);
      expect(lifecycleRuntime.routerPush).toHaveBeenCalledWith({
        path: "/contracts",
        query: { view: "ended" }
      });
    } finally {
      scope.stop();
    }
  });

  it("executes the visible approval-draft action through the same session and redirects on completion", async () => {
    const { bindings, draft, scope } = await preparePage(
      workbenchSnapshot("abandon_application")
    );
    draft.lifecycle.commands.abandonApplication.mockResolvedValue({
      status: "completed"
    });

    try {
      await bindings.confirmAbandonApplication(actionRequest());
      expect(draft.lifecycle.commands.abandonApplication).toHaveBeenCalledWith(
        actionRequest()
      );
      expect(lifecycleRuntime.routerPush).toHaveBeenCalledWith({
        path: "/contracts",
        query: { view: "ended" }
      });
    } finally {
      scope.stop();
    }
  });

  it("keeps stale outcomes in place and hides a capability-invalid result", async () => {
    const { bindings, draft, scope } = await preparePage();
    draft.lifecycle.commands.deletePristineDraft
      .mockResolvedValueOnce({ status: "stale" })
      .mockResolvedValueOnce({ status: "capability_invalid" });

    try {
      await bindings.confirmDeletePristineDraft(actionRequest());
      expect(lifecycleRuntime.routerPush).not.toHaveBeenCalled();
      expect(bindings.contractDraftAvailableActions.value).not.toBeNull();

      await bindings.confirmDeletePristineDraft(actionRequest());
      expect(bindings.contractDraftAvailableActions.value).toBeNull();
    } finally {
      scope.stop();
    }
  });
});
