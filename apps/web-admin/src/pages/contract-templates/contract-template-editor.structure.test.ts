import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.resolve(__dirname, "ContractTemplateEditorPage.vue"),
  "utf8"
);
const clauseSource = fs.readFileSync(
  path.resolve(__dirname, "StandardClauseLibraryPage.vue"),
  "utf8"
);

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
    expect(source).toContain("stopContractTemplateVersion(riskStopVersionId.value)");
    expect(source).toContain('v-if="riskStopAction?.enabled"');
    expect(source).toContain(".then(completeRiskStop)");
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
    expect(source).toContain("generation !== templateLoadGeneration");
    expect(source).toContain("templateRouteId.value !== templateId");
    expect(source).toContain("watch(templateRouteId");
    expect(source).toContain("riskStopDialogVisible.value = false");
    expect(source).toContain('riskStopVersionId.value = ""');
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
