import { readFileSync } from "node:fs";
import { effectScope, nextTick, reactive } from "vue";
import { describe, expect, it, vi } from "vitest";
import LayoutTemplateEditorPage from "./LayoutTemplateEditorPage.vue";

const layoutEditorRuntime = vi.hoisted(() => ({
  route: { params: { layoutTemplateId: "layout-a" } },
  getLayoutTemplate: vi.fn(),
  stopLayoutTemplateVersion: vi.fn()
}));

vi.mock("vue", async (importOriginal) => {
  const original = await importOriginal<typeof import("vue")>();
  return {
    ...original,
    onBeforeUnmount: () => undefined,
    onMounted: () => undefined,
    useSSRContext: () => ({ modules: new Set<string>() })
  };
});

vi.mock("vue-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("vue-router")>();
  return {
    ...original,
    useRoute: () => layoutEditorRuntime.route,
    useRouter: () => ({
      replace: vi.fn()
    })
  };
});

vi.mock("../../auth/auth.store", () => ({
  useAuthStore: () => ({ user: { roleKeys: ["contract_director"] } })
}));

vi.mock("../../lib/use-unsaved-changes-guard", () => ({
  useUnsavedChangesGuard: () => ({
    requestClose: async () => true
  })
}));

vi.mock("../../api/contract-workbench.api", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../api/contract-workbench.api")
  >();
  return {
    ...original,
    getLayoutTemplate: layoutEditorRuntime.getLayoutTemplate,
    stopLayoutTemplateVersion: layoutEditorRuntime.stopLayoutTemplateVersion
  };
});

layoutEditorRuntime.route = reactive(layoutEditorRuntime.route);

const page = readFileSync(new URL("./LayoutTemplateEditorPage.vue", import.meta.url), "utf8");

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

type MutableValue<T> = { value: T };
type LayoutEditorBindings = {
  detail: MutableValue<unknown>;
  layoutTemplateCapability: MutableValue<unknown>;
  message: MutableValue<string>;
  openRiskStopDialog: () => void;
  riskStopDialogVisible: MutableValue<boolean>;
  riskStopError: MutableValue<string>;
  riskStopLoading: MutableValue<boolean>;
  riskStopVersionId: MutableValue<string>;
  selectedVersionId: MutableValue<string>;
  stopCurrentVersion: () => Promise<unknown>;
};

function setupEditor() {
  const scope = effectScope();
  const bindings = scope.run(() =>
    (
      LayoutTemplateEditorPage as unknown as {
        setup: (
          props: Record<string, never>,
          context: { expose: () => void }
        ) => LayoutEditorBindings;
      }
    ).setup({}, { expose: () => undefined })
  );
  if (!bindings) throw new Error("layout template editor setup failed");
  return { bindings, scope };
}

function riskStopVersion(id: string) {
  return {
    id,
    versionNo: 1,
    status: "published",
    draftRevision: 1,
    availableActions: [
      {
        key: "risk_stop",
        label: "风险停用",
        enabled: true,
        disabledReason: null
      }
    ]
  };
}

describe("layout template revision governance structure", () => {
  it("selects server versions and saves drafts with expected-revision CAS", () => {
    expect(page).toContain("getLayoutTemplate");
    expect(page).toContain("selectedVersionId");
    expect(page).toContain("expectedRevision: version.draftRevision");
    expect(page).not.toContain("粘贴已有版本编号");
  });

  it("keeps published layouts immutable and clones them into a new draft", () => {
    expect(page).toContain('canSave: currentVersion.value?.status === "draft"');
    expect(page).toContain('canClone: currentVersion.value?.status === "published"');
    expect(page).toContain("cloneLayoutTemplateVersion");
    expect(page).toContain("复制为新草稿");
  });

  it("shows revision freshness without exposing internal file identifiers", () => {
    expect(page).toContain("inspectionRevision === currentVersion.value.draftRevision");
    expect(page).toContain("latestPreview.value.sourceRevision");
    expect(page).toContain("旧检查和旧预览自动失效");
    expect(page).not.toContain("预览文件编号");
    expect(page).not.toContain("latestPreview.previewPdfFileId");
  });

  it("uses server lifecycle actions and revision CAS to discard only a pristine draft", () => {
    expect(page).toContain("<BusinessDraftAction");
    expect(page).toContain("currentVersion.availableActions ?? []");
    expect(page).toContain("discardLayoutTemplateVersion");
    expect(page).toContain("expectedRevision: version.draftRevision");
    expect(page).toContain("getLayoutTemplate(templateId, true)");
  });

  it("renders risk stop only from the server action key and confirms it before calling the wrapper", () => {
    expect(page).toContain("stopLayoutTemplateVersion");
    expect(page).toContain('action.key === "risk_stop"');
    expect(page).toContain('v-if="riskStopCandidateAction"');
    expect(page).toContain(':disabled="!riskStopCandidateAction.enabled || riskStopLoading"');
    expect(page).toContain("riskStopCandidateAction.disabledReason");
    expect(page).toContain("riskStopDialogVisible");
    expect(page).toContain(
      "const request = stopLayoutTemplateVersion(\n    requireCurrentRiskStopVersionId(context)\n  );"
    );
    expect(page).toContain(
      "function requireCurrentRiskStopVersionId(context: RiskStopContext)"
    );
    expect(page).toContain('v-if="riskStopAction?.enabled"');
    expect(page).toContain(".then(() => completeRiskStop(context))");
    expect(page).not.toMatch(/canRiskStop:\s*.*roleKeys/u);
    expect(page).not.toMatch(/canRiskStop:\s*.*status/u);
  });

  it("derives the locked risk-stop capability only from the server GET result", () => {
    expect(page).toContain(
      "const layoutTemplateCapability = ref<LayoutTemplateDetailReadModel | null>(null);"
    );
    expect(page).toContain(
      "const serverDetail = await getLayoutTemplate(templateId, true);"
    );
    expect(page).toContain("layoutTemplateCapability.value = serverDetail;");
    expect(
      [...page.matchAll(/layoutTemplateCapability\.value\s*=\s*([^;\n]+)/gu)]
        .map((match) => match[1]?.trim())
        .filter(Boolean)
    ).toEqual(["serverDetail", "null"]);
    expect(page).toMatch(
      /const riskStopAction = computed\(\(\) =>[\s\S]*?layoutTemplateCapability\.value\?\.versions[\s\S]*?version\.id === riskStopVersionId\.value[\s\S]*?action\.key === "risk_stop"/u
    );
  });

  it("invalidates stale layout reads and confirmation state when the route id changes", () => {
    expect(page).toContain("let layoutLoadGeneration = 0");
    expect(page).toContain("let layoutRouteGeneration = 0");
    expect(page).toContain("generation !== layoutLoadGeneration");
    expect(page).toContain("layoutTemplateRouteId.value !== templateId");
    expect(page).toContain("watch(layoutTemplateRouteId");
    expect(page).toContain("riskStopDialogVisible.value = false");
    expect(page).toContain('riskStopVersionId.value = ""');
    expect(page).toContain("context.routeGeneration === layoutRouteGeneration");
  });

  it("does not let a completed risk stop refresh, clear or message a later route", async () => {
    const pending = deferred();
    vi.stubGlobal("window", {
      clearInterval: vi.fn(),
      setInterval: vi.fn()
    });
    layoutEditorRuntime.route.params.layoutTemplateId = "layout-a";
    layoutEditorRuntime.getLayoutTemplate.mockReset();
    layoutEditorRuntime.getLayoutTemplate
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockRejectedValue(new Error("stale refresh must not run"));
    layoutEditorRuntime.stopLayoutTemplateVersion.mockReset();
    layoutEditorRuntime.stopLayoutTemplateVersion.mockReturnValueOnce(
      pending.promise
    );
    const { bindings, scope } = setupEditor();
    const version = riskStopVersion("layout-version-a");
    bindings.layoutTemplateCapability.value = {
      versions: [version]
    };
    bindings.detail.value = {
      template: { id: "layout-a", name: "版式 A" },
      versions: [version]
    };
    bindings.selectedVersionId.value = version.id;
    bindings.openRiskStopDialog();

    const action = bindings.stopCurrentVersion();
    layoutEditorRuntime.route.params.layoutTemplateId = "layout-b";
    await nextTick();
    expect(layoutEditorRuntime.getLayoutTemplate).toHaveBeenCalledTimes(1);
    bindings.message.value = "版式 B 已加载";
    bindings.riskStopLoading.value = true;

    try {
      pending.resolve();
      await action;

      expect(layoutEditorRuntime.stopLayoutTemplateVersion).toHaveBeenCalledWith(
        "layout-version-a"
      );
      expect(layoutEditorRuntime.getLayoutTemplate).toHaveBeenCalledTimes(1);
      expect(bindings.message.value).toBe("版式 B 已加载");
      expect(bindings.riskStopLoading.value).toBe(true);
    } finally {
      scope.stop();
      vi.unstubAllGlobals();
    }
  });

  it("releases the owned busy state without refreshing after a same-route version switch", async () => {
    const pending = deferred();
    vi.stubGlobal("window", {
      clearInterval: vi.fn(),
      setInterval: vi.fn()
    });
    layoutEditorRuntime.route.params.layoutTemplateId = "layout-a";
    layoutEditorRuntime.getLayoutTemplate.mockReset();
    layoutEditorRuntime.stopLayoutTemplateVersion.mockReset();
    layoutEditorRuntime.stopLayoutTemplateVersion.mockReturnValueOnce(
      pending.promise
    );
    const { bindings, scope } = setupEditor();
    const versionA = riskStopVersion("layout-version-a");
    const versionB = riskStopVersion("layout-version-b");
    bindings.layoutTemplateCapability.value = {
      versions: [versionA, versionB]
    };
    bindings.detail.value = {
      template: { id: "layout-a", name: "版式 A" },
      versions: [versionA, versionB]
    };
    bindings.selectedVersionId.value = versionA.id;
    bindings.openRiskStopDialog();

    const action = bindings.stopCurrentVersion();
    bindings.selectedVersionId.value = versionB.id;

    try {
      pending.resolve();
      await action;

      expect(layoutEditorRuntime.stopLayoutTemplateVersion).toHaveBeenCalledWith(
        "layout-version-a"
      );
      expect(layoutEditorRuntime.getLayoutTemplate).not.toHaveBeenCalled();
      expect(bindings.message.value).toBe("");
      expect(bindings.riskStopLoading.value).toBe(false);
    } finally {
      scope.stop();
      vi.unstubAllGlobals();
    }
  });

  it("rejects a stale risk-stop preflight before calling the wrapper or setting busy", () => {
    layoutEditorRuntime.route.params.layoutTemplateId = "layout-a";
    layoutEditorRuntime.stopLayoutTemplateVersion.mockReset();
    const { bindings, scope } = setupEditor();
    bindings.riskStopVersionId.value = "layout-version-a";
    bindings.selectedVersionId.value = "layout-version-b";
    bindings.riskStopLoading.value = false;

    try {
      expect(() => bindings.stopCurrentVersion()).toThrow(
        "版式版本操作上下文已失效"
      );
      expect(
        layoutEditorRuntime.stopLayoutTemplateVersion
      ).not.toHaveBeenCalled();
      expect(bindings.riskStopLoading.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("keeps busy false when the risk-stop wrapper throws before returning a promise", () => {
    vi.stubGlobal("window", {
      clearInterval: vi.fn(),
      setInterval: vi.fn()
    });
    layoutEditorRuntime.route.params.layoutTemplateId = "layout-a";
    layoutEditorRuntime.stopLayoutTemplateVersion.mockReset();
    layoutEditorRuntime.stopLayoutTemplateVersion.mockImplementationOnce(
      () => {
        throw new Error("同步创建请求失败");
      }
    );
    const { bindings, scope } = setupEditor();
    const version = riskStopVersion("layout-version-a");
    bindings.layoutTemplateCapability.value = { versions: [version] };
    bindings.detail.value = {
      template: { id: "layout-a", name: "版式 A" },
      versions: [version]
    };
    bindings.selectedVersionId.value = version.id;
    bindings.openRiskStopDialog();

    try {
      expect(() => bindings.stopCurrentVersion()).toThrow("同步创建请求失败");
      expect(bindings.riskStopLoading.value).toBe(false);
    } finally {
      scope.stop();
      vi.unstubAllGlobals();
    }
  });

  it("does not let an older same-version operation overwrite the latest result", async () => {
    const older = deferred();
    const latest = deferred();
    vi.stubGlobal("window", {
      clearInterval: vi.fn(),
      setInterval: vi.fn()
    });
    layoutEditorRuntime.route.params.layoutTemplateId = "layout-a";
    layoutEditorRuntime.getLayoutTemplate.mockReset();
    layoutEditorRuntime.getLayoutTemplate.mockRejectedValue(
      new Error("旧请求不应刷新")
    );
    layoutEditorRuntime.stopLayoutTemplateVersion.mockReset();
    layoutEditorRuntime.stopLayoutTemplateVersion
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(latest.promise);
    const { bindings, scope } = setupEditor();
    const version = riskStopVersion("layout-version-a");
    bindings.layoutTemplateCapability.value = { versions: [version] };
    bindings.detail.value = {
      template: { id: "layout-a", name: "版式 A" },
      versions: [version]
    };
    bindings.selectedVersionId.value = version.id;
    bindings.openRiskStopDialog();

    const olderAction = bindings.stopCurrentVersion();
    const latestAction = bindings.stopCurrentVersion();

    try {
      latest.reject(new Error("最新请求失败"));
      await latestAction;
      expect(bindings.riskStopError.value).toBe("最新请求失败");

      older.resolve();
      await olderAction;

      expect(layoutEditorRuntime.getLayoutTemplate).not.toHaveBeenCalled();
      expect(bindings.riskStopDialogVisible.value).toBe(true);
      expect(bindings.riskStopError.value).toBe("最新请求失败");
      expect(bindings.message.value).toBe("");
      expect(bindings.riskStopLoading.value).toBe(false);
    } finally {
      scope.stop();
      vi.unstubAllGlobals();
    }
  });

  it("protects unsaved files and version switching", () => {
    expect(page).toContain("useUnsavedChangesGuard");
    expect(page).toContain("leaveGuard.requestClose()");
    expect(page).toContain("<SensitiveActionDialog");
    expect(page).toContain('@change="selectVersion"');
  });
});
