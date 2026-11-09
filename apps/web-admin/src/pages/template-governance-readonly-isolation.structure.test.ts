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

describe("template governance separates public reading and role-bound maintenance", () => {
  it("keeps the retained reading routes and restricts each editor route", () => {
    for (const page of readonlyPages) {
      expect(routes).toContain(page.replace(/^\.\//, "../pages/"));
    }
    const authorizedEditors = [...routes.matchAll(
      /\{\s*path: "([^"]+)",\s*component: \(\) => import\("\.\.\/pages\/(?:contract-templates|settlement-templates)\/(LayoutTemplateManagementPage|LayoutTemplateEditorPage|SettlementTemplateEditorPage)\.vue"\),\s*meta: \{ requiredGlobalRoleKeys: (\["contract_director"\]|settlementTemplateAdminRoleKeys), title: "[^"]+" \}\s*\}/gu
    )];
    expect(authorizedEditors.map(match => match.slice(1, 4))).toEqual([
      ["合同模板库/主管维护", "LayoutTemplateManagementPage", '["contract_director"]'],
      ["合同模板库/版式/:layoutTemplateId/维护", "LayoutTemplateEditorPage", '["contract_director"]'],
      ["结算模板工作台/新建", "SettlementTemplateEditorPage", "settlementTemplateAdminRoleKeys"],
      ["结算模板工作台/:templateId", "SettlementTemplateEditorPage", "settlementTemplateAdminRoleKeys"]
    ]);
    const legacyRoutes = authorizedEditors.reduce((source, match) => source.replace(match[0], ""), routes);
    expect(legacyRoutes).not.toMatch(
      /ContractScenarioGovernancePage|ContractTemplateEditorPage|LayoutTemplateManagementPage|LayoutTemplateEditorPage|ContractNumberRulePage|ContractTemplateListPage|StandardClauseLibraryPage|SettlementTemplateEditorPage/
    );
  });

  it("keeps mutations out of all seven reading pages and gates the maintenance link", () => {
    const [templateList, ...otherPages] = readonlySources;
    expect(templateList).toContain('v-if="canMaintainTemplates"');
    expect(templateList).toContain("canMaintainContractTemplates(auth.user?.roleKeys)");
    expect(templateList).toContain("'/合同模板库/主管维护'");
    for (const source of otherPages) {
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
