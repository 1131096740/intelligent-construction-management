import { calculateBillRow } from "./decimal-money";

describe("calculateBillRow", () => {
  it("calculates a tax-inclusive row and keeps the cent relationship exact", () => {
    expect(
      calculateBillRow({
        quantity: "3.333",
        unitPrice: "100.1234",
        taxRatePercent: "13",
        pricingMode: "tax_inclusive"
      })
    ).toEqual({
      taxInclusiveAmountCents: 33371n,
      taxExclusiveAmountCents: 29532n,
      taxAmountCents: 3839n
    });
  });

  it("calculates a tax-exclusive row and derives tax from the rounded base", () => {
    expect(
      calculateBillRow({
        quantity: "10",
        unitPrice: "9.999",
        taxRatePercent: "6",
        pricingMode: "tax_exclusive"
      })
    ).toEqual({
      taxInclusiveAmountCents: 10599n,
      taxExclusiveAmountCents: 9999n,
      taxAmountCents: 600n
    });
  });
});
