import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./LayoutTemplateEditorPage.vue", import.meta.url), "utf8");

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
    expect(page).toContain("stopLayoutTemplateVersion(riskStopVersionId.value)");
    expect(page).toContain('v-if="riskStopAction?.enabled"');
    expect(page).toContain(".then(completeRiskStop)");
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
    expect(page).toContain("generation !== layoutLoadGeneration");
    expect(page).toContain("layoutTemplateRouteId.value !== templateId");
    expect(page).toContain("watch(layoutTemplateRouteId");
    expect(page).toContain("riskStopDialogVisible.value = false");
    expect(page).toContain('riskStopVersionId.value = ""');
  });

  it("protects unsaved files and version switching", () => {
    expect(page).toContain("useUnsavedChangesGuard");
    expect(page).toContain("leaveGuard.requestClose()");
    expect(page).toContain("<SensitiveActionDialog");
    expect(page).toContain('@change="selectVersion"');
  });
});
