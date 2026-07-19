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
    expect(source).not.toContain("stopContractTemplateVersion");
    expect(source).not.toContain("revokeContractTemplateVersion");
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
    expect(source).toContain("getContractTemplate(String(route.params.templateId), true)");

    expect(clauseSource).toContain("listStandardClauseHistory");
    expect(clauseSource).toContain("selectedHistoryVersion.availableActions");
    expect(clauseSource).toContain("discardStandardClauseVersion");
    expect(clauseSource).toContain("expectedUpdatedAt: version.updatedAt");
  });
});
