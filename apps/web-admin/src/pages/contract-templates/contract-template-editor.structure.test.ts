import fs from "node:fs";
import path from "node:path";
import { effectScope, nextTick, reactive } from "vue";
import { describe, expect, it, vi } from "vitest";
import ContractTemplateEditorPage from "./ContractTemplateEditorPage.vue";

const contractEditorRuntime = vi.hoisted(() => ({
  route: { params: { templateId: "template-a" } },
  getContractTemplate: vi.fn(),
  stopContractTemplateVersion: vi.fn()
}));

vi.mock("vue", async (importOriginal) => {
  const original = await importOriginal<typeof import("vue")>();
  return {
    ...original,
    onMounted: () => undefined,
    useSSRContext: () => ({ modules: new Set<string>() })
  };
});

vi.mock("vue-router", async (importOriginal) => {
  const original = await importOriginal<typeof import("vue-router")>();
  return {
    ...original,
    useRoute: () => contractEditorRuntime.route
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
    getContractTemplate: contractEditorRuntime.getContractTemplate,
    stopContractTemplateVersion:
      contractEditorRuntime.stopContractTemplateVersion
  };
});

contractEditorRuntime.route = reactive(contractEditorRuntime.route);

const source = fs.readFileSync(
  path.resolve(__dirname, "ContractTemplateEditorPage.vue"),
  "utf8"
);
const clauseSource = fs.readFileSync(
  path.resolve(__dirname, "StandardClauseLibraryPage.vue"),
  "utf8"
);

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
type ContractEditorBindings = {
  contractTemplateCapability: MutableValue<unknown>;
  message: MutableValue<string>;
  openRiskStopDialog: () => void;
  riskStopDialogVisible: MutableValue<boolean>;
  riskStopError: MutableValue<string>;
  riskStopVersionId: MutableValue<string>;
  selectedVersionId: MutableValue<string>;
  stopSelectedVersion: () => Promise<unknown>;
  submitting: MutableValue<boolean>;
  versions: MutableValue<unknown[]>;
};

function setupEditor() {
  const scope = effectScope();
  const bindings = scope.run(() =>
    (
      ContractTemplateEditorPage as unknown as {
        setup: (
          props: Record<string, never>,
          context: { expose: () => void }
        ) => ContractEditorBindings;
      }
    ).setup({}, { expose: () => undefined })
  );
  if (!bindings) throw new Error("contract template editor setup failed");
  return { bindings, scope };
}

function riskStopVersion(id: string) {
  return {
    id,
    versionNo: 1,
    status: "published",
    schema: {
      fields: [],
      bills: [],
      clauses: [],
      attachments: [],
      validations: []
    },
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

describe("contract template editor version governance structure", () => {
  it("selects real versions and never accepts a hand-entered version id", () => {
    expect(source).toContain("contractTemplateVersionOptions");
    expect(source).toContain("selectedVersionId");
    expect(source).not.toContain("当前版本编号");
    expect(source).not.toContain('v-model="versionId"');
    expect(source).not.toContain("route.query.versionId");
  });

  it("gates mutation controls by server-backed version status", () => {
    expect(source).toContain('v-if="governance.canSave"');
    expect(source).toContain('v-if="governance.canSubmit"');
    expect(source).toContain('v-if="governance.canPublish"');
    expect(source).toContain('v-if="governance.canClone"');
    expect(source).toContain(':inert="governance.readOnly"');
    expect(source).toContain("stopContractTemplateVersion");
    expect(source).not.toContain("revokeContractTemplateVersion");
  });

  it("renders risk stop only from the server action key and confirms it before calling the wrapper", () => {
    expect(source).toContain('action.key === "risk_stop"');
    expect(source).toContain('v-if="riskStopCandidateAction"');
    expect(source).toContain(':disabled="!riskStopCandidateAction.enabled || submitting"');
    expect(source).toContain("riskStopCandidateAction.disabledReason");
    expect(source).toContain("riskStopDialogVisible");
    expect(source).toContain(
      "const request = stopContractTemplateVersion(\n    requireCurrentRiskStopVersionId(context)\n  );"
    );
    expect(source).toContain(
      "function requireCurrentRiskStopVersionId(context: RiskStopContext)"
    );
    expect(source).toContain('v-if="riskStopAction?.enabled"');
    expect(source).toContain(".then(() => completeRiskStop(context))");
    expect(source).not.toMatch(/canRiskStop:\s*.*roleKeys/u);
    expect(source).not.toMatch(/canRiskStop:\s*.*status/u);
  });

  it("derives the locked risk-stop capability only from the server GET result", () => {
    expect(source).toContain(
      "const contractTemplateCapability = ref<ContractTemplateDetailReadModel | null>(null);"
    );
    expect(source).toContain(
      "const serverDetail = await getContractTemplate(templateId, true);"
    );
    expect(source).toContain("contractTemplateCapability.value = serverDetail;");
    expect(
      [...source.matchAll(/contractTemplateCapability\.value\s*=\s*([^;\n]+)/gu)]
        .map((match) => match[1]?.trim())
        .filter(Boolean)
    ).toEqual(["serverDetail", "null"]);
    expect(source).toMatch(
      /const riskStopAction = computed\(\(\) =>[\s\S]*?contractTemplateCapability\.value\?\.versions[\s\S]*?version\.id === riskStopVersionId\.value[\s\S]*?action\.key === "risk_stop"/u
    );
    expect(source).not.toContain("normalizeContractTemplateDetail(contractTemplateCapability.value)");
  });

  it("invalidates stale template reads and confirmation state when the route id changes", () => {
    expect(source).toContain("let templateLoadGeneration = 0");
    expect(source).toContain("let templateRouteGeneration = 0");
    expect(source).toContain("generation !== templateLoadGeneration");
    expect(source).toContain("templateRouteId.value !== templateId");
    expect(source).toContain("watch(templateRouteId");
    expect(source).toContain("riskStopDialogVisible.value = false");
    expect(source).toContain('riskStopVersionId.value = ""');
    expect(source).toContain("context.routeGeneration === templateRouteGeneration");
  });

  it("does not let a completed risk stop refresh, clear or message a later route", async () => {
    const pending = deferred();
    contractEditorRuntime.route.params.templateId = "template-a";
    contractEditorRuntime.getContractTemplate.mockReset();
    contractEditorRuntime.getContractTemplate
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockRejectedValue(new Error("stale refresh must not run"));
    contractEditorRuntime.stopContractTemplateVersion.mockReset();
    contractEditorRuntime.stopContractTemplateVersion.mockReturnValueOnce(
      pending.promise
    );
    const { bindings, scope } = setupEditor();
    const version = riskStopVersion("version-a");
    bindings.contractTemplateCapability.value = {
      versions: [version]
    };
    bindings.versions.value = [version];
    bindings.selectedVersionId.value = version.id;
    bindings.openRiskStopDialog();

    const action = bindings.stopSelectedVersion();
    contractEditorRuntime.route.params.templateId = "template-b";
    await nextTick();
    expect(contractEditorRuntime.getContractTemplate).toHaveBeenCalledTimes(1);
    bindings.message.value = "模板 B 已加载";
    bindings.submitting.value = true;

    try {
      pending.resolve();
      await action;

      expect(
        contractEditorRuntime.stopContractTemplateVersion
      ).toHaveBeenCalledWith("version-a");
      expect(contractEditorRuntime.getContractTemplate).toHaveBeenCalledTimes(1);
      expect(bindings.message.value).toBe("模板 B 已加载");
      expect(bindings.submitting.value).toBe(true);
    } finally {
      scope.stop();
    }
  });

  it("releases the owned busy state without refreshing after a same-route version switch", async () => {
    const pending = deferred();
    contractEditorRuntime.route.params.templateId = "template-a";
    contractEditorRuntime.getContractTemplate.mockReset();
    contractEditorRuntime.stopContractTemplateVersion.mockReset();
    contractEditorRuntime.stopContractTemplateVersion.mockReturnValueOnce(
      pending.promise
    );
    const { bindings, scope } = setupEditor();
    const versionA = riskStopVersion("version-a");
    const versionB = riskStopVersion("version-b");
    bindings.contractTemplateCapability.value = {
      versions: [versionA, versionB]
    };
    bindings.versions.value = [versionA, versionB];
    bindings.selectedVersionId.value = versionA.id;
    bindings.openRiskStopDialog();

    const action = bindings.stopSelectedVersion();
    bindings.selectedVersionId.value = versionB.id;

    try {
      pending.resolve();
      await action;

      expect(
        contractEditorRuntime.stopContractTemplateVersion
      ).toHaveBeenCalledWith("version-a");
      expect(contractEditorRuntime.getContractTemplate).not.toHaveBeenCalled();
      expect(bindings.message.value).toBe("");
      expect(bindings.submitting.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("rejects a stale risk-stop preflight before calling the wrapper or setting busy", () => {
    contractEditorRuntime.route.params.templateId = "template-a";
    contractEditorRuntime.stopContractTemplateVersion.mockReset();
    const { bindings, scope } = setupEditor();
    bindings.riskStopVersionId.value = "version-a";
    bindings.selectedVersionId.value = "version-b";
    bindings.submitting.value = false;

    try {
      expect(() => bindings.stopSelectedVersion()).toThrow(
        "模板版本操作上下文已失效"
      );
      expect(
        contractEditorRuntime.stopContractTemplateVersion
      ).not.toHaveBeenCalled();
      expect(bindings.submitting.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("keeps busy false when the risk-stop wrapper throws before returning a promise", () => {
    contractEditorRuntime.route.params.templateId = "template-a";
    contractEditorRuntime.stopContractTemplateVersion.mockReset();
    contractEditorRuntime.stopContractTemplateVersion.mockImplementationOnce(
      () => {
        throw new Error("同步创建请求失败");
      }
    );
    const { bindings, scope } = setupEditor();
    const version = riskStopVersion("version-a");
    bindings.contractTemplateCapability.value = { versions: [version] };
    bindings.versions.value = [version];
    bindings.selectedVersionId.value = version.id;
    bindings.openRiskStopDialog();

    try {
      expect(() => bindings.stopSelectedVersion()).toThrow("同步创建请求失败");
      expect(bindings.submitting.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("does not let an older same-version operation overwrite the latest result", async () => {
    const older = deferred();
    const latest = deferred();
    contractEditorRuntime.route.params.templateId = "template-a";
    contractEditorRuntime.getContractTemplate.mockReset();
    contractEditorRuntime.getContractTemplate.mockRejectedValue(
      new Error("旧请求不应刷新")
    );
    contractEditorRuntime.stopContractTemplateVersion.mockReset();
    contractEditorRuntime.stopContractTemplateVersion
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(latest.promise);
    const { bindings, scope } = setupEditor();
    const version = riskStopVersion("version-a");
    bindings.contractTemplateCapability.value = { versions: [version] };
    bindings.versions.value = [version];
    bindings.selectedVersionId.value = version.id;
    bindings.openRiskStopDialog();

    const olderAction = bindings.stopSelectedVersion();
    const latestAction = bindings.stopSelectedVersion();

    try {
      latest.reject(new Error("最新请求失败"));
      await latestAction;
      expect(bindings.riskStopError.value).toBe("最新请求失败");

      older.resolve();
      await olderAction;

      expect(contractEditorRuntime.getContractTemplate).not.toHaveBeenCalled();
      expect(bindings.riskStopDialogVisible.value).toBe(true);
      expect(bindings.riskStopError.value).toBe("最新请求失败");
      expect(bindings.message.value).toBe("");
      expect(bindings.submitting.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("保存草稿时把可编辑投影按稳定 key 合并回原版 schema", () => {
    expect(source).toContain("mergeContractTemplateSchemaForSave");
    expect(source).toMatch(
      /schema:\s*mergeContractTemplateSchemaForSave\(version\.schema,\s*buildSchema\(\)\)/u
    );
  });

  it("consumes server lifecycle actions for business templates and clause versions", () => {
    expect(source).toContain("<BusinessDraftAction");
    expect(source).toContain("selectedVersion.availableActions ?? []");
    expect(source).toContain("discardContractTemplateVersion");
    expect(source).toContain("expectedUpdatedAt: version.updatedAt");
    expect(source).toContain("getContractTemplate(templateId, true)");

    expect(clauseSource).toContain("listStandardClauseHistory");
    expect(clauseSource).toContain("selectedHistoryVersion.availableActions");
    expect(clauseSource).toContain("discardStandardClauseVersion");
    expect(clauseSource).toContain("expectedUpdatedAt: version.updatedAt");
  });

  it("protects unsaved business-template and clause edits before leaving", () => {
    for (const page of [source, clauseSource]) {
      expect(page).toContain("useUnsavedChangesGuard");
      expect(page).toContain("<SensitiveActionDialog");
    }
    expect(source).toContain("editorBaseline");
    expect(source).toContain("leaveGuard.requestClose()");
    expect(clauseSource).toContain("createBaseline");
  });
});
