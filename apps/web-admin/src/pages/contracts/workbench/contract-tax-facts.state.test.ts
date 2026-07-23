import { describe, expect, it } from "vitest";
import {
  contractProfessionalFields,
  contractInvoiceTypeOptions,
  contractTaxModeOptions,
  resolveTaxRatePercent,
  taxFactsDisabledReason,
  taxRateQuickOptions,
  taxRateQuickValueFor,
  type ContractTaxFactsDraft
} from "./contract-tax-facts.state";

describe("contract tax facts state", () => {
  it("uses the two approved invoice types and the two approved tax modes", () => {
    expect(contractInvoiceTypeOptions).toEqual([
      { label: "增值税普通发票", value: "vat_general" },
      { label: "增值税专用发票", value: "vat_special" }
    ]);
    expect(contractTaxModeOptions).toEqual([
      { label: "单一税率", value: "single_rate" },
      { label: "特殊多税率", value: "multiple_rate" }
    ]);
  });

  it("offers only the approved tax-rate shortcuts and the other-rate entry", () => {
    expect(taxRateQuickOptions.map((item) => item.value)).toEqual([
      "1",
      "3",
      "6",
      "9",
      "13",
      "other"
    ]);
  });

  it("keeps legacy template tax fields out of the professional field editor", () => {
    const fields = contractProfessionalFields([
      { key: "invoiceType", label: "发票类型", type: "single_select" },
      { key: "taxRatePercent", label: "税率", type: "number" },
      { key: "deliveryAddress", label: "交货地点", type: "text" }
    ]);

    expect(fields.map((field) => field.key)).toEqual(["deliveryAddress"]);
  });

  it("switches between shortcuts and normalized other tax rates", () => {
    expect(resolveTaxRatePercent("13", "")).toBe("13");
    expect(resolveTaxRatePercent("other", " 6.50 ")).toBe("6.5");
    expect(taxRateQuickValueFor("13.00")).toBe("13");
    expect(taxRateQuickValueFor("6.5")).toBe("other");
    expect(taxRateQuickValueFor("")).toBe("other");
  });

  it("explains missing invoice type and invalid tax rates in business Chinese", () => {
    expect(
      taxFactsDisabledReason({
        invoiceType: null,
        taxMode: "single_rate",
        rate: "13"
      })
    ).toBe("请选择发票类型");
    expect(
      taxFactsDisabledReason({
        invoiceType: "vat_special",
        taxMode: "single_rate",
        rate: "0"
      })
    ).toBe("税率必须大于 0");
    expect(
      taxFactsDisabledReason({
        invoiceType: "vat_special",
        taxMode: "single_rate",
        rate: "13.001"
      })
    ).toBe("税率最多保留 2 位小数");
  });

  it.each<ContractTaxFactsDraft>([
    {
      invoiceType: "vat_general",
      taxMode: "single_rate",
      rate: "9"
    },
    {
      invoiceType: "vat_special",
      taxMode: "multiple_rate",
      rate: "13"
    }
  ])("accepts complete single-rate and multiple-rate version facts", (draft) => {
    expect(taxFactsDisabledReason(draft)).toBe("");
  });

  it("requires a valid default rate in both single-rate and multiple-rate modes", () => {
    expect(
      taxFactsDisabledReason({
        invoiceType: "vat_general",
        taxMode: "single_rate",
        rate: ""
      })
    ).toBe("请填写税率");
    expect(
      taxFactsDisabledReason({
        invoiceType: "vat_general",
        taxMode: "multiple_rate",
        rate: ""
      })
    ).toBe("请填写默认税率");
  });
});
