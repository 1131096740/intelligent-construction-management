import { expect, it } from "vitest";
import { businessAmountFromLegacyCents, businessAmountToLegacyCents, businessAmountToPaymentCents, calculateBusinessLineAmount, calculateBusinessLineTaxAmounts, normalizeBusinessAmount, normalizeBusinessQuantity, paymentStatusForBusinessAmount, sumBusinessAmounts } from "./index";

it("清单已知数量乘单价先半入到四位，保留分以下真实业务金额", () => {
  expect(calculateBusinessLineAmount("1.2345", "1.2345")).toBe("1.5240");
});

it("四位存储范围与旧整数分兼容上限分别核对，超限不靠数据库异常", () => {
  expect(businessAmountToLegacyCents("92233720368547758.07")).toBe("9223372036854775807");
  expect(() => businessAmountToLegacyCents("92233720368547758.075")).toThrow("兼容");
  expect(businessAmountToLegacyCents("-92233720368547758.08")).toBe("-9223372036854775808");
});

it("税额按四位业务行计算，税率未知时不冒充零税率", () => {
  expect(calculateBusinessLineTaxAmounts("1.2345", "1.2345", "0")).toEqual({
    taxInclusiveAmountYuan: "1.5240", taxExclusiveAmountYuan: "1.5240", taxAmountYuan: "0.0000", taxExclusiveUnitPrice: "1.2345"
  });
  expect(calculateBusinessLineTaxAmounts("1", "113", "13")).toEqual({
    taxInclusiveAmountYuan: "113.0000", taxExclusiveAmountYuan: "100.0000", taxAmountYuan: "13.0000", taxExclusiveUnitPrice: "100.0000"
  });
  expect(calculateBusinessLineTaxAmounts("1", "100.005", null)).toEqual({
    taxInclusiveAmountYuan: "100.0050", taxExclusiveAmountYuan: null, taxAmountYuan: null, taxExclusiveUnitPrice: null
  });
});

it("精度和有限存储边界明确拒绝，不接受科学计数或替用户截断", () => {
  for (const value of ["1.00000", "1e2", "NaN", "Infinity", "01", " 1", "100000000000000000000", 1 as unknown as string]) {
    expect(() => normalizeBusinessAmount(value)).toThrow();
  }
  expect(normalizeBusinessAmount("99999999999999999999.9999")).toBe("99999999999999999999.9999");
  expect(() => calculateBusinessLineAmount("99999999999999999999", "2")).toThrow("范围");
  expect(normalizeBusinessQuantity("999999999999999999.9999")).toBe("999999999999999999.9999");
  expect(() => normalizeBusinessQuantity("1000000000000000000")).toThrow("18");
  expect(normalizeBusinessAmount("-0.0000")).toBe("0.0000");
  expect(paymentStatusForBusinessAmount(null, "0")).toBeNull();
});

it("未知不当零，负数按绝对值半入，旧整数分无损转换", () => {
  expect(calculateBusinessLineAmount(null, "2")).toBeNull();
  expect(calculateBusinessLineAmount("0", "2")).toBe("0.0000");
  expect(sumBusinessAmounts(["0", null])).toBeNull();
  expect(normalizeBusinessAmount(null)).toBeNull();
  expect(normalizeBusinessAmount("-0.0000", { allowNegative: true })).toBe("0.0000");
  expect(businessAmountToPaymentCents("-0.005")).toBe("-1");
  expect(businessAmountToPaymentCents("-0.0049")).toBe("0");
  expect(businessAmountFromLegacyCents("9007199254740993")).toBe("90071992547409.9300");
  expect(businessAmountFromLegacyCents(null)).toBeNull();
});

it("累计业务金额后才转换支付分，按支付口径付清而不改业务金额", () => {
  expect(sumBusinessAmounts(["0.005", "0.005"])).toBe("0.0100");
  expect(businessAmountToPaymentCents(sumBusinessAmounts(["0.005", "0.005"]))).toBe("1");
  expect(paymentStatusForBusinessAmount("100.005", "10001")).toEqual({ limitCents: "10001", remainingCents: "0", paidInFull: true, overpaid: false });
});
