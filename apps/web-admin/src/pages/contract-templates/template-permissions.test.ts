import { describe, expect, it } from "vitest";
import {
  canMaintainContractTemplates,
  canPublishContractTemplates
} from "./template-permissions";

describe("template permissions", () => {
  it("allows contract staff and directors to maintain template drafts", () => {
    expect(canMaintainContractTemplates(["contract_staff"])).toBe(true);
    expect(canMaintainContractTemplates(["contract_director"])).toBe(true);
    expect(canMaintainContractTemplates(["super_admin"])).toBe(false);
    expect(canMaintainContractTemplates(["finance_staff"])).toBe(false);
  });

  it("keeps publication with contract directors", () => {
    expect(canPublishContractTemplates(["contract_staff"])).toBe(false);
    expect(canPublishContractTemplates(["contract_director"])).toBe(true);
    expect(canPublishContractTemplates(["super_admin"])).toBe(false);
  });
});
