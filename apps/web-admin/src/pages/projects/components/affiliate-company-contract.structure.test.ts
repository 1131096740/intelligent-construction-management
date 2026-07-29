import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(__dirname, "AffiliateCompanyContractPanel.vue"),
  "utf8"
);

describe("affiliate-company offline contract panel", () => {
  it("uses the governed API surface and never calls fetch directly", () => {
    expect(source).toContain("fetchProjectAffiliateCompanyContracts");
    expect(source).toContain("recordProjectAffiliateCompanyContract");
    expect(source).toContain("confirmProjectAffiliateCompanyContract");
    expect(source).toContain("uploadPrivateFile");
    expect(source).not.toMatch(/\bfetch\s*\(/u);
  });

  it("keeps the owner, remittance and company-workflow boundaries explicit", () => {
    expect(source).toContain("不替代业主主合同");
    expect(source).toContain("不会生成业主回款");
    expect(source).toContain("可以先到账、后核对");
    expect(source).toContain("不以该合同结算完成为前提");
    expect(source).toContain("不是我方合同审批");
  });

  it("uses TDesign controls and the shared sensitive action confirmation", () => {
    expect(source).toContain("<t-table");
    expect(source).toContain("<t-upload");
    expect(source).toContain("<SensitiveActionDialog");
    expect(source).not.toMatch(/<button\b/u);
  });
});
