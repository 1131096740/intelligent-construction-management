import { describe, expect, it } from "vitest";
import {
  CONTRACT_INVOICE_TYPES,
  CONTRACT_TAX_FACT_SOURCES,
  CONTRACT_TAX_FACT_STATUSES,
  CONTRACT_TAX_MODES,
  contractInvoiceTypeLabel,
  contractTaxFactSourceLabel,
  contractTaxFactStatusLabel,
  contractTaxModeLabel,
  normalizeTaxRatePercent
} from "./contract-tax-facts";

describe("contract tax fact labels", () => {
  it("uses stable codes with business-facing Chinese labels", () => {
    expect(CONTRACT_INVOICE_TYPES).toEqual(["vat_general", "vat_special"]);
    expect(contractInvoiceTypeLabel("vat_general")).toBe("增值税普通发票");
    expect(contractInvoiceTypeLabel("vat_special")).toBe("增值税专用发票");

    expect(CONTRACT_TAX_MODES).toEqual(["single_rate", "multiple_rate"]);
    expect(contractTaxModeLabel("single_rate")).toBe("单一税率");
    expect(contractTaxModeLabel("multiple_rate")).toBe("特殊多税率");

    expect(CONTRACT_TAX_FACT_STATUSES).toEqual([
      "unconfirmed",
      "draft",
      "frozen",
      "pending_finance_review",
      "pending_contract_confirmation",
      "confirmed"
    ]);
    expect(contractTaxFactStatusLabel("pending_finance_review")).toBe("待财务复核");
    expect(contractTaxFactStatusLabel("pending_contract_confirmation")).toBe("待合同部确认");

    expect(CONTRACT_TAX_FACT_SOURCES).toEqual([
      "contract_document",
      "supplement_evidence",
      "business_finance_confirmation"
    ]);
    expect(contractTaxFactSourceLabel("contract_document")).toBe("合同文件明确");
    expect(contractTaxFactSourceLabel("supplement_evidence")).toBe("依据补充资料确认");
    expect(contractTaxFactSourceLabel("business_finance_confirmation")).toBe(
      "经业务与财务复核确认"
    );
  });
});

describe("normalizeTaxRatePercent", () => {
  it.each([
    ["13", "13"],
    ["6.5", "6.5"],
    ["6.500", "6.5"],
    ["0.001", "0.001"],
    ["100.000", "100"],
    [" 9.00 ", "9"]
  ])("normalizes valid tax rate %p to %p", (input, expected) => {
    expect(normalizeTaxRatePercent(input)).toBe(expected);
  });

  it.each(["0", "0.0", "0.000", "-1"])("rejects non-positive tax rate %p", (input) => {
    expect(() => normalizeTaxRatePercent(input)).toThrow("税率必须大于 0");
  });

  it.each(["100.001", "101", "999"])("rejects tax rate above 100: %p", (input) => {
    expect(() => normalizeTaxRatePercent(input)).toThrow("税率不能超过 100");
  });

  it.each(["13.0001", "0.0001"])("rejects tax rate over three decimal places: %p", (input) => {
    expect(() => normalizeTaxRatePercent(input)).toThrow("税率最多保留 3 位小数");
  });

  it.each(["", "abc", "01", ".5", "1.", "1e1", "+13"])(
    "rejects non-canonical tax rate text %p",
    (input) => {
      expect(() => normalizeTaxRatePercent(input)).toThrow(
        "税率必须是 0 到 100 之间且最多 3 位小数的数字"
      );
    }
  );
});
