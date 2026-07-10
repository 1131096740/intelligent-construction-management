import {
  calculateBillRow,
  calculateProjectCashPoolBigInt,
  dbMoneyToBigInt,
  formatMoneyCentsAsYuan,
  legacyBigIntToDbInt,
  moneyCentsToLegacyApiNumber,
  parseMoneyCentsText,
  sumDbMoneyToBigInt
} from "./decimal-money";

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

describe("internal bigint money compatibility", () => {
  it("keeps number and bigint database values in bigint without losing precision", () => {
    expect(dbMoneyToBigInt(2_100_000_001, "合同金额")).toBe(2_100_000_001n);
    expect(dbMoneyToBigInt(9_007_199_254_740_993n, "累计金额")).toBe(
      9_007_199_254_740_993n
    );
    expect(sumDbMoneyToBigInt([9_007_199_254_740_993n, 7], "累计金额")).toBe(
      9_007_199_254_741_000n
    );
  });

  it("rejects unsafe number input before it can enter bigint calculations", () => {
    expect(() => dbMoneyToBigInt(Number.MAX_SAFE_INTEGER + 1, "累计金额")).toThrow(
      "累计金额必须为安全整数分"
    );
  });

  it("parses canonical cents text directly to bigint", () => {
    expect(parseMoneyCentsText("2100000001", "合同金额")).toBe(2_100_000_001n);
    expect(parseMoneyCentsText("9007199254740993", "累计金额")).toBe(
      9_007_199_254_740_993n
    );
    expect(() => parseMoneyCentsText(" 1", "金额")).toThrow("金额必须填写非负整数分");
    expect(() => parseMoneyCentsText("1.5", "金额")).toThrow("金额必须填写非负整数分");
  });

  it("formats bigint cents as yuan without converting the amount to number", () => {
    expect(formatMoneyCentsAsYuan(9_007_199_254_740_993n)).toBe(
      "90,071,992,547,409.93"
    );
    expect(formatMoneyCentsAsYuan(-101n)).toBe("-1.01");
  });

  it("keeps legacy database and API conversions guarded at their boundaries", () => {
    expect(legacyBigIntToDbInt(2_147_483_647n, "金额")).toBe(2_147_483_647);
    expect(() => legacyBigIntToDbInt(2_147_483_648n, "金额")).toThrow(
      "金额超过当前数据库 32 位整数范围"
    );
    expect(moneyCentsToLegacyApiNumber(2_100_000_001n, "金额")).toBe(2_100_000_001);
    expect(() =>
      moneyCentsToLegacyApiNumber(9_007_199_254_740_993n, "金额")
    ).toThrow("金额超过当前 API 安全整数范围");
  });

  it("calculates project cash and expense occupancy with bigint totals", () => {
    expect(
      calculateProjectCashPoolBigInt({
        receiptAmountCents: [9_007_199_254_740_993n, 7],
        paymentRequests: [
          {
            status: "approved_pending_payment",
            requestedAmountCents: 20n,
            approvedAmountCents: 18n,
            paidAmountCents: 3n
          }
        ],
        expenseRequests: [
          {
            status: "approval_pending",
            requestedAmountCents: 5,
            approvedAmountCents: null,
            paidAmountCents: 1
          }
        ]
      })
    ).toEqual({
      actualReceiptsCents: 9_007_199_254_741_000n,
      actualPaidCents: 4n,
      occupiedCents: 19n,
      availableCents: 9_007_199_254_740_977n
    });
  });
});
