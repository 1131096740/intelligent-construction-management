import { describe, expect, it } from "vitest";
import {
  canMaintainContractTemplates,
  canPublishContractTemplates
} from "./template-permissions";

describe("template permissions", () => {
  it("keeps template draft maintenance with contract directors", () => {
    expect(canMaintainContractTemplates(["contract_staff"])).toBe(false);
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
