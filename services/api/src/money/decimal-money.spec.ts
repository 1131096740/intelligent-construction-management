import { BadRequestException } from "@nestjs/common";
import {
  calculateBillRow,
  calculateProjectCashPoolBigInt,
  dbMoneyToBigInt,
  formatMoneyCentsAsYuan,
  mapBigIntMoneyFieldsToApi,
  moneyCentsToApi,
  parseMoneyCents,
  parseMoneyCentsInput,
  parseSignedMoneyCents,
  parseSignedMoneyCentsInput,
  spotProcurementPaymentToMoneyRequestValue,
  sumDbMoneyToBigInt,
  yuanTextToCents
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
  const postgresBigIntMax = "9223372036854775807";
  const postgresBigIntMaxPlusOne = "9223372036854775808";
  const postgresBigIntMin = "-9223372036854775808";
  const postgresBigIntMinMinusOne = "-9223372036854775809";

  it("parses and serializes the final decimal-string API contract", () => {
    expect(parseMoneyCents("2100000001", "合同金额")).toBe(2_100_000_001n);
    expect(parseMoneyCents("9007199254740993", "累计金额")).toBe(
      9_007_199_254_740_993n
    );
    expect(moneyCentsToApi(9_007_199_254_740_993n)).toBe("9007199254740993");
    expect(yuanTextToCents("21000000.01", "合同金额")).toBe(2_100_000_001n);
  });

  it("maps only explicit nested money fields and leaves non-money bigint untouched", () => {
    expect(
      mapBigIntMoneyFieldsToApi(
        {
          amountCents: 30_000n,
          sequenceNo: 2n,
          allocations: [{ sourcePayableAmountCents: 50_000n, amountCents: 30_000n }]
        },
        ["amountCents", "sourcePayableAmountCents"]
      )
    ).toEqual({
      amountCents: "30000",
      sequenceNo: 2n,
      allocations: [{ sourcePayableAmountCents: "50000", amountCents: "30000" }]
    });
  });

  it("rejects a non-bigint value in an explicit API money field", () => {
    expect(() =>
      mapBigIntMoneyFieldsToApi(
        { amountCents: 30_000 as unknown as bigint },
        ["amountCents"]
      )
    ).toThrow("amountCents必须为 bigint 分值");
  });

  it.each(["-1", "1.5", "1e3", " 1", "", 1])(
    "keeps invalid cent parsing as an internal error and maps input %p to HTTP 400",
    (value) => {
      const parserError = (() => {
        try {
          parseMoneyCents(value as string, "金额");
        } catch (error) {
          return error;
        }
        return undefined;
      })();
      expect(parserError).toBeInstanceOf(Error);
      expect(parserError).not.toBeInstanceOf(BadRequestException);
      expect(() => parseMoneyCents(value as string, "金额")).toThrow("金额必须填写非负整数分");
      expect(() => parseMoneyCentsInput(value as string, "金额")).toThrow(
        BadRequestException
      );
      expect(() => parseMoneyCentsInput(value as string, "金额")).toThrow(
        "金额必须填写非负整数分"
      );
    }
  );

  it("keeps the signed manual-adjustment exception while rejecting non-canonical values", () => {
    expect(parseSignedMoneyCents("-1", "人工调整金额")).toBe(-1n);
    for (const value of [1, "1.5", "1e3"]) {
      const parserError = (() => {
        try {
          parseSignedMoneyCents(value as string, "人工调整金额");
        } catch (error) {
          return error;
        }
        return undefined;
      })();
      expect(parserError).toBeInstanceOf(Error);
      expect(parserError).not.toBeInstanceOf(BadRequestException);
      expect(() => parseSignedMoneyCents(value as string, "人工调整金额")).toThrow(
        "人工调整金额必须填写整数分"
      );
      expect(() => parseSignedMoneyCentsInput(value as string, "人工调整金额")).toThrow(
        BadRequestException
      );
    }
  });

  it("keeps non-negative money within the PostgreSQL BIGINT storage range", () => {
    expect(parseMoneyCents(postgresBigIntMax, "金额")).toBe(9_223_372_036_854_775_807n);
    expect(() => parseMoneyCents(postgresBigIntMaxPlusOne, "金额")).toThrow(
      "金额超出系统可保存范围"
    );
    expect(() => parseMoneyCentsInput(postgresBigIntMaxPlusOne, "金额")).toThrow(
      BadRequestException
    );
  });

  it("keeps signed money within the PostgreSQL BIGINT storage range", () => {
    expect(parseSignedMoneyCents(postgresBigIntMin, "人工调整金额")).toBe(
      -9_223_372_036_854_775_808n
    );
    expect(parseSignedMoneyCents(postgresBigIntMax, "人工调整金额")).toBe(
      9_223_372_036_854_775_807n
    );
    expect(() => parseSignedMoneyCents(postgresBigIntMinMinusOne, "人工调整金额")).toThrow(
      "人工调整金额超出系统可保存范围"
    );
    expect(() => parseSignedMoneyCents(postgresBigIntMaxPlusOne, "人工调整金额")).toThrow(
      "人工调整金额超出系统可保存范围"
    );
  });

  it("accepts only bigint database money values", () => {
    expect(dbMoneyToBigInt(9_007_199_254_740_993n, "累计金额")).toBe(
      9_007_199_254_740_993n
    );
    expect(sumDbMoneyToBigInt([9_007_199_254_740_993n, 7n], "累计金额")).toBe(
      9_007_199_254_741_000n
    );
    expect(() => dbMoneyToBigInt(1 as unknown as bigint, "合同金额")).toThrow(
      "合同金额必须为 bigint 分值"
    );
  });

  it("rejects every number input before it can enter bigint calculations", () => {
    expect(() => dbMoneyToBigInt(Number.MAX_SAFE_INTEGER + 1, "累计金额")).toThrow(
      "累计金额必须为 bigint 分值"
    );
  });

  it("parses canonical cents text directly to bigint", () => {
    expect(parseMoneyCents("2100000001", "合同金额")).toBe(2_100_000_001n);
    expect(parseMoneyCents("9007199254740993", "累计金额")).toBe(
      9_007_199_254_740_993n
    );
    expect(() => parseMoneyCents(" 1", "金额")).toThrow("金额必须填写非负整数分");
    expect(() => parseMoneyCents("1.5", "金额")).toThrow("金额必须填写非负整数分");
  });

  it("formats bigint cents as yuan without converting the amount to number", () => {
    expect(formatMoneyCentsAsYuan(9_007_199_254_740_993n)).toBe(
      "90,071,992,547,409.93"
    );
    expect(formatMoneyCentsAsYuan(-101n)).toBe("-1.01");
  });

  it("removes the legacy Int and safe-number ceilings from money boundaries", () => {
    expect(dbMoneyToBigInt(2_147_483_648n, "金额")).toBe(2_147_483_648n);
    expect(moneyCentsToApi(9_007_199_254_740_993n)).toBe("9007199254740993");
  });

  it("calculates project cash and expense occupancy with bigint totals", () => {
    expect(
      calculateProjectCashPoolBigInt({
        receiptAmountCents: [9_007_199_254_740_993n, 7n],
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
            requestedAmountCents: 5n,
            approvedAmountCents: null,
            paidAmountCents: 1n
          }
        ]
      })
    ).toEqual({
      actualReceiptsCents: 9_007_199_254_741_000n,
      supplierRefundsCents: 0n,
      actualPaidCents: 4n,
      occupiedCents: 19n,
      availableCents: 9_007_199_254_740_977n
    });
  });

  it("maps only the effective company-funded portion of spot procurement payments", () => {
    expect(
      spotProcurementPaymentToMoneyRequestValue({
        status: "approved_pending_payment",
        companyPaymentAmountCents: 9_007_199_254_740_993n,
        canceledCompanyPaymentAmountCents: 2_000n,
        paidAmountCents: 3_000n,
        supplierBalanceAmountCents: 8_000n
      })
    ).toEqual({
      status: "approved_pending_payment",
      requestedAmountCents: 9_007_199_254_738_993n,
      approvedAmountCents: 9_007_199_254_738_993n,
      paidAmountCents: 3_000n
    });
  });

  it("includes spot procurement actual payments and outstanding company cash without counting supplier balance", () => {
    expect(
      calculateProjectCashPoolBigInt({
        receiptAmountCents: [20_000n],
        paymentRequests: [],
        expenseRequests: [],
        spotProcurementPayments: [
          spotProcurementPaymentToMoneyRequestValue({
            status: "approval_pending",
            companyPaymentAmountCents: 7_000n,
            canceledCompanyPaymentAmountCents: 2_000n,
            paidAmountCents: 0n,
            supplierBalanceAmountCents: 4_000n
          }),
          spotProcurementPaymentToMoneyRequestValue({
            status: "partially_paid",
            companyPaymentAmountCents: 8_000n,
            canceledCompanyPaymentAmountCents: 0n,
            paidAmountCents: 3_000n,
            supplierBalanceAmountCents: 9_000n
          }),
          spotProcurementPaymentToMoneyRequestValue({
            status: "paid",
            companyPaymentAmountCents: 2_000n,
            canceledCompanyPaymentAmountCents: 0n,
            paidAmountCents: 2_000n,
            supplierBalanceAmountCents: 6_000n
          }),
          spotProcurementPaymentToMoneyRequestValue({
            status: "voided",
            companyPaymentAmountCents: 99_000n,
            canceledCompanyPaymentAmountCents: 0n,
            paidAmountCents: 0n,
            supplierBalanceAmountCents: 99_000n
          })
        ]
      })
    ).toEqual({
      actualReceiptsCents: 20_000n,
      supplierRefundsCents: 0n,
      actualPaidCents: 5_000n,
      occupiedCents: 10_000n,
      availableCents: 5_000n
    });
  });

  it("restores available project cash from supplier refunds without relabeling them as project receipts", () => {
    expect(
      calculateProjectCashPoolBigInt({
        receiptAmountCents: [20_000n],
        supplierRefundAmountCents: [1_500n, 500n],
        paymentRequests: [],
        expenseRequests: [],
        spotProcurementPayments: []
      })
    ).toEqual({
      actualReceiptsCents: 20_000n,
      supplierRefundsCents: 2_000n,
      actualPaidCents: 0n,
      occupiedCents: 0n,
      availableCents: 22_000n
    });
  });
});
