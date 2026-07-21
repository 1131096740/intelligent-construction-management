import { describe, expect, it } from "vitest";
import {
  prepareSpotPaymentDraft,
  requiredSpotProcurementVatRatePercent
} from "./spot-procurement-write-validation";

describe("spot procurement payment tax-rate validation", () => {
  it.each(["0", "13", "13.125", "100"])(
    "accepts a directly entered tax rate of %s percent",
    (rate) => expect(requiredSpotProcurementVatRatePercent(rate)).toBe(rate)
  );

  it.each(["", "-1", "100.001", "13.1234", "13%"])(
    "rejects invalid directly entered tax rate %s",
    (rate) => expect(() => requiredSpotProcurementVatRatePercent(rate)).toThrow(
      "税率必须是 0 到 100、最多 3 位小数的数字"
    )
  );

  it("keeps a zero-percent tax rate for an invoiced payment material", () => {
    expect(prepareSpotPaymentDraft({
      paymentType: "company_direct",
      merchantName: "建材商行",
      payeeName: "建材商行",
      paymentLines: [{
        procurementLineId: "line-1",
        paymentQuantity: "1",
        unitPrice: "4100",
        expectedInvoiceCondition: "vat_special",
        vatRatePercent: "0"
      }],
      paymentMethods: ["cash"],
      channels: [{ channelType: "cash", isPrimary: true }]
    }).paymentLines[0]).toMatchObject({ vatRatePercent: "0" });
  });
});
