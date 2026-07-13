import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./ProjectOperatingOverviewPage.vue", import.meta.url)),
  "utf8"
);

describe("project operating overview structure", () => {
  it("keeps the default page on a read-only project overview and separates funds handling", () => {
    expect(source).toContain('label="项目概览"');
    expect(source).toContain('label="资金办理"');
    expect(source).toContain('v-if="canUseFundsOperations && overview"');
    expect(source).toContain('v-model="activeTab"');
  });

  it("loads write-only supporting data only for the original funds operation roles", () => {
    expect(source).toContain("canUseFundsOperations.value ? fetchProjectExpenseRequests(projectId)");
    expect(source).toContain("canUseFundsOperations.value ? fetchPaymentContractOptions(projectId)");
    expect(source).toContain("auth.user?.globalRoleKeys.some");
  });

  it("uses the existing TDesign project selector and maintenance disclosure", () => {
    expect(source).toContain("<t-select");
    expect(source).toContain("<t-collapse");
    expect(source).toContain("项目维护");
  });
});
