import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./DelegationListPage.vue", import.meta.url), "utf8");

describe("approval delegation keeps writes bound to an authorized duty", () => {
  it("reads the ledger and requires server approval for create and revoke", () => {
    expect(page).toContain("listApprovalDelegations");
    expect(page).toContain("fetchApprovalDelegationDutyOptions");
    expect(page).toContain(':disabled="!duties.length"');
    expect(page).toContain('v-if="row.fromUserId === auth.user?.id && row.enabled"');
    expect(page).toMatch(
      /fetchApprovalDelegationDutyCapability\(input\.resourceId\)[\s\S]*?capability\.canDelegate[\s\S]*?authorizedResource !== selectedResource[\s\S]*?authorizedAction !== selectedAction[\s\S]*?authorizedType !== selectedType[\s\S]*?return createApprovalDelegation\(input\)/u
    );
    expect(page).toMatch(
      /fetchApprovalDelegationRevokeCapability\(id\)[\s\S]*?capability\.canRevoke[\s\S]*?return revokeApprovalDelegation\(id\)/u
    );
  });
});
