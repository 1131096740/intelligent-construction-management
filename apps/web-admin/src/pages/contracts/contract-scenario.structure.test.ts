import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workbench = readFileSync(new URL("./ContractWorkbenchPage.vue", import.meta.url), "utf8");
const governance = readFileSync(
  new URL("../contract-templates/ContractScenarioGovernancePage.vue", import.meta.url),
  "utf8"
);

describe("contract scenario web structure", () => {
  it("uses scenario recommendations as the primary create path with explicit direct fallback", () => {
    expect(workbench).toContain("listAvailableContractBusinessScenarios");
    expect(workbench).toContain("recommendContractScenarioTemplates");
    expect(workbench).toContain('selectionMode === "automatic"');
    expect(workbench).toContain("selectionMode === 'choice_required'");
    expect(workbench).toContain("从模板库直接选择");
    expect(workbench).toContain("setBusinessScenarioSelection");
    expect(workbench).toContain("canApplyContractScenarioResponse");
    expect(workbench).toContain("preserveDirectPreset");
    expect(workbench).toContain("directQueryPreset.value?.templateVersionId");
  });

  it("keeps governance calls behind global-role checks and uses TDesign controls", () => {
    expect(governance).toContain("auth.user?.globalRoleKeys");
    expect(governance).toMatch(/if \(!canGovern\.value\)[\s\S]*return;[\s\S]*loadGovernance/u);
    expect(governance).toContain("listContractScenarioGovernance");
    expect(governance).toContain("<t-table");
    expect(governance).toContain("<t-dialog");
    expect(governance).toContain("<t-popconfirm");
    expect(governance.match(/:disabled="!canGovern/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(governance).toContain("assertCanGovern()");
    expect(governance).not.toContain("createdByUserId");
    expect(governance).toContain("if (!(await loadGovernance())) return false;");
  });
});
