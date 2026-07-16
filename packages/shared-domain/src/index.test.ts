import { describe, expect, it } from "vitest";
import {
  contractInvoiceTypeLabel,
  normalizeTaxRatePercent
} from "./index";

describe("shared-domain public entry", () => {
  it("exports contract tax fact helpers used by production bundles", () => {
    expect(normalizeTaxRatePercent("13.00")).toBe("13");
    expect(contractInvoiceTypeLabel("vat_special")).toBe("增值税专用发票");
  });
});
