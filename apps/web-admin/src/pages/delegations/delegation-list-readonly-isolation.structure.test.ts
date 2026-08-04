import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./DelegationListPage.vue", import.meta.url), "utf8");

describe("stage D approval-delegation readonly isolation", () => {
  it("keeps the delegation ledger readable while removing create and revoke triggers", () => {
    expect(page).toContain("listApprovalDelegations");
    expect(page).toContain("上线准备期间暂为只读");
    expect(page).not.toMatch(
      /createApprovalDelegation|revokeApprovalDelegation|fetchApprovalDelegationUserOptions|submitCreate|submitRevoke|创建委托|新增委托|>撤销</
    );
  });
});
