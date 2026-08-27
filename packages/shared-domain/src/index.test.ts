import { describe, expect, it } from "vitest";
import {
  contractInvoiceTypeLabel,
  isContractBillCustomColumn,
  normalizeTaxRatePercent,
  OPERATING_FACT_KINDS,
  OPERATING_SUBJECT_KINDS,
  PRIMARY_COST_CATEGORY_CODES,
  WAGE_CREDITOR_SUBJECT_TYPES
} from "./index";

describe("shared-domain public entry", () => {
  it("exports contract tax fact helpers used by production bundles", () => {
    expect(normalizeTaxRatePercent("13.00")).toBe("13");
    expect(contractInvoiceTypeLabel("vat_special")).toBe("增值税专用发票");
    expect(isContractBillCustomColumn("brand")).toBe(true);
  });

  it("exports project operating contracts from the public package entry", () => {
    expect(OPERATING_FACT_KINDS).toContain("owner_payment");
    expect(OPERATING_SUBJECT_KINDS).toContain("wage_external_creditor");
    expect(PRIMARY_COST_CATEGORY_CODES).toHaveLength(8);
  });

  it("exports wage creditor identity contracts from the public package entry", () => {
    expect(WAGE_CREDITOR_SUBJECT_TYPES).toContain("business_party");
  });
});
