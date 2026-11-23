import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./ConstructionEnterpriseDeductionDrawer.vue", import.meta.url)),
  "utf8"
);

describe("construction enterprise deduction drawer structure", () => {
  it("registers by fee name plus actual amount with optional evidence", () => {
    expect(source).toContain("费用名称");
    expect(source).toContain("实际金额（元）");
    expect(source).toContain("依据文件（选填）");
    expect(source).toContain("recordProjectConstructionEnterpriseDeduction");
    expect(source).toContain("uploadProjectUpstreamFundPrivateFile");
  });

  it("keeps the net deduction separate from construction enterprise paid", () => {
    expect(source).toContain("已确认扣费净额");
    expect(source).toContain("不含扣费");
    expect(source).toContain("不计入施工企业已付，也不自动形成收入或利润");
  });

  it("reuses the two-stage correction chain for deductions", () => {
    expect(source).toContain('sourceType: "affiliate_deduction"');
    expect(source).toContain("requestConstructionPaymentCorrection");
    expect(source).toContain("confirmConstructionPaymentCorrection");
    expect(source).toContain("反转 + 重登");
  });

  it("confirms a pending deduction only through the existing upstream confirmation chain", () => {
    expect(source).toContain("confirmProjectUpstreamFundFact");
    expect(source).toContain("canConfirmWritten");
    expect(source).toContain("canConfirmOral");
  });
});
