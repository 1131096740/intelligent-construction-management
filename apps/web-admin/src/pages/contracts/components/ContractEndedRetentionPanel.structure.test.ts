import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("contract ended retention panel", () => {
  it("keeps hold operations in the director-only ended-ledger surface", () => {
    const panel = readFileSync(
      new URL("./ContractEndedRetentionPanel.vue", import.meta.url),
      "utf8"
    );
    const listPage = readFileSync(new URL("../ContractListPage.vue", import.meta.url), "utf8");

    expect(panel).toContain("fetchContractEndedApplicationRetentionPreview");
    expect(panel).toContain("createContractEndedApplicationRetentionHold");
    expect(panel).toContain("releaseContractEndedApplicationRetentionHold");
    expect(panel).toContain("executionAllowed");
    expect(panel).toContain("不执行物理删除");
    expect(listPage).toContain("ContractEndedRetentionPanel");
    expect(listPage).toContain("activeTab === 'ended' && canManageEndedRetention");
    expect(listPage).toContain('roleKeys.value.includes("contract_director")');
  });
});
