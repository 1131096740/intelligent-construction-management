import { describe, expect, it } from "vitest";

import {
  calculateSpotProcurementLineAmountCents,
  centsTextToYuanText,
  yuanTextToCentsText
} from "./money";

describe("yuanTextToCentsText", () => {
  it("converts values above 21 million yuan without number coercion", () => {
    expect(yuanTextToCentsText("21000000.01")).toBe("2100000001");
  });

  it("keeps values above the JavaScript safe integer range exact", () => {
    expect(yuanTextToCentsText("90071992547409.93")).toBe("9007199254740993");
  });

  it.each(["", " ", "-1", "1.234", "1e3", "abc"])(
    "rejects invalid yuan input %p",
    (value) => {
      expect(() => yuanTextToCentsText(value)).toThrow("金额必须是非负数字，最多保留两位小数");
    }
  );
});

describe("centsTextToYuanText", () => {
  it("formats cents with thousands separators", () => {
    expect(centsTextToYuanText("2100000001")).toBe("21,000,000.01");
  });

  it("formats values above the JavaScript safe integer range exactly", () => {
    expect(centsTextToYuanText("9007199254740993")).toBe("90,071,992,547,409.93");
  });

  it("formats signed cents without losing the sign", () => {
    expect(centsTextToYuanText("-1")).toBe("-0.01");
  });

  it.each(["", " ", "1.2", "1e3", "abc"])("rejects invalid cents input %p", (value) => {
    expect(() => centsTextToYuanText(value)).toThrow("金额分值必须是十进制整数字符串");
  });
});

describe("calculateSpotProcurementLineAmountCents", () => {
  it("multiplies decimal strings exactly without floating-point coercion", () => {
    expect(calculateSpotProcurementLineAmountCents("12.50", "3.28")).toBe(
      "4100"
    );
    expect(calculateSpotProcurementLineAmountCents("1.23", "8.76")).toBe(
      "1077"
    );
  });

  it("rounds a half cent away from zero for the non-negative procurement domain", () => {
    expect(calculateSpotProcurementLineAmountCents("0.01", "0.50")).toBe(
      "1"
    );
    expect(
      calculateSpotProcurementLineAmountCents("0.01", "0.49")
    ).toBe("0");
  });

  it("keeps the PostgreSQL bigint boundary exact", () => {
    expect(
      calculateSpotProcurementLineAmountCents("92233720368547758.07", "1")
    ).toBe(
      "9223372036854775807"
    );
    expect(() =>
      calculateSpotProcurementLineAmountCents("92233720368547758.08", "1")
    ).toThrow("采购明细金额超出系统可保存范围");
  });

  it.each(["0", "01", "1.001", "-1", "1e3", ""])(
    "rejects invalid quantity %p",
    (quantity) => {
      expect(() => calculateSpotProcurementLineAmountCents(quantity, "1")).toThrow(
        "采购数量必须是大于 0、最多 2 位小数且可保存的普通十进制字符串"
      );
    }
  );

  it.each(["01", "1.001", "-1", "1e3", ""])(
    "rejects invalid unit price %p",
    (unitPrice) => {
      expect(() => calculateSpotProcurementLineAmountCents("1", unitPrice)).toThrow(
        "采购单价必须是大于等于 0、最多 2 位小数且可保存的普通十进制字符串"
      );
    }
  );
});
