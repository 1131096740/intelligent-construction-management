import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function read(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("business read-only page boundaries", () => {
  it("does not load or expose contract and settlement draft workspaces to ledger-only roles", () => {
    const contracts = read("./contracts/ContractListPage.vue");
    const settlements = read("./settlements/SettlementListPage.vue");

    expect(contracts).toContain('v-if="canManageContracts"');
    expect(contracts).toContain(
      '!["my_drafts", "returned_for_revision"].includes(activeTab.value)'
    );
    expect(contracts).not.toContain("loadMyDrafts");
    expect(settlements).toContain('v-if="canManageSettlements"');
    expect(settlements).toContain(
      '(canManageSettlements.value || !["my_drafts", "returned_for_revision"].includes(value))'
    );
    expect(settlements).not.toContain("loadSettlementDrafts");
  });

  it("keeps historical takeover writes behind their original business permissions", () => {
    const source = read("./contracts/ContractTakeoverPage.vue");

    expect(source).toContain('v-if="canManageTakeovers"');
    expect(source).toContain('v-if="canSubmitTakeovers"');
    expect(source).toContain('v-if="canConfirmTakeovers"');
    expect(source).toContain(
      "canManageTakeovers.value\n        ? listContractTakeoverImportBatches(projectId)"
    );
    expect(source).toContain(
      'setMessage("当前岗位不能上传或导入历史合同接管数据", "danger")'
    );
  });

  it("does not reopen a historical tax draft after the user loses supplement permission", () => {
    const source = read(
      "./contracts/components/ContractTaxFactReviewPanel.vue"
    );

    expect(source).toContain("state.value.canEdit");
    expect(source).toContain(
      'v-if="editing && (state.canEdit || state.canCreate)"'
    );
    expect(source).toContain("当前岗位不能保存税务事实修订");
  });
});
