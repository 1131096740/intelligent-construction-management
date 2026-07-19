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
});
