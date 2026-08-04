import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relativePath: string) => {
  const url = new URL(relativePath, import.meta.url);
  return existsSync(url) ? readFileSync(url, "utf8") : "";
};

const routes = read("../routes/route-records.ts");
const readonlyPages = [
  "./contract-templates/ContractTemplateReadonlyListPage.vue",
  "./contract-templates/ContractTemplateReadonlyDetailPage.vue",
  "./contract-templates/LayoutTemplateReadonlyPage.vue",
  "./contract-templates/StandardClauseReadonlyPage.vue",
  "./contract-templates/ContractNumberRuleReadonlyPage.vue",
  "./contract-templates/ContractScenarioReadonlyPage.vue",
  "./settlement-templates/SettlementTemplateReadonlyPage.vue"
];
const readonlySources = readonlyPages.map(read);
const combined = readonlySources.join("\n");

const mutationWrappers = [
  "createContractBusinessScenario",
  "createContractScenarioMapping",
  "updateContractBusinessScenario",
  "updateContractScenarioMapping",
  "cloneContractTemplateVersion",
  "cloneLayoutTemplateVersion",
  "createContractNumberRule",
  "createContractTemplate",
  "createLayoutTemplate",
  "createStandardClause",
  "discardContractTemplateVersion",
  "discardLayoutTemplateVersion",
  "discardStandardClauseVersion",
  "inspectLayoutTemplateVersion",
  "publishContractTemplateVersion",
  "publishLayoutTemplateVersion",
  "publishStandardClauseVersion",
  "queueLayoutTemplatePreview",
  "stopContractNumberRule",
  "submitContractTemplateVersion",
  "submitLayoutTemplateVersion",
  "submitStandardClauseVersion",
  "updateContractNumberRule",
  "updateContractTemplateVersion",
  "updateLayoutTemplateVersion",
  "uploadPrivateFile",
  "cloneSettlementTemplateVersion",
  "createSettlementTemplate",
  "discardSettlementTemplateVersion",
  "downloadSettlementTemplatePreview",
  "generateSettlementTemplatePreview",
  "inspectSettlementTemplateVersion",
  "publishSettlementTemplateVersion",
  "stopSettlementTemplateVersion",
  "submitSettlementTemplateVersion",
  "updateSettlementTemplateVersion"
];

describe("stage D template-governance readonly isolation", () => {
  it("routes every template-governance surface through a readonly page", () => {
    for (const page of readonlyPages) {
      expect(routes).toContain(page.replace(/^\.\//, "../pages/"));
    }
    expect(routes).not.toMatch(
      /ContractScenarioGovernancePage|ContractTemplateEditorPage|LayoutTemplateEditorPage|ContractNumberRulePage|ContractTemplateListPage|StandardClauseLibraryPage|SettlementTemplateEditorPage/
    );
  });

  it("keeps the seven reachable pages visibly readonly and mutation-free", () => {
    for (const source of readonlySources) {
      expect(source).toContain("上线准备期间暂为只读");
    }
    for (const wrapper of mutationWrappers) {
      expect(combined).not.toContain(wrapper);
    }
  });

  it("preserves published selection and the six governance read models", () => {
    for (const wrapper of [
      "listPublishedContractTemplates",
      "getContractTemplate",
      "getLayoutTemplate",
      "listPublishedStandardClauses",
      "listContractNumberRules",
      "listContractScenarioGovernance",
      "getSettlementTemplate"
    ]) {
      expect(combined).toContain(wrapper);
    }
    expect(combined).toContain("ContractTemplateUsagePreviewDrawer");
    expect(combined).toContain("templateVersionId");
  });
});
