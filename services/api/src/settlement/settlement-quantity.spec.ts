import { Decimal } from "@prisma/client/runtime/library";
import {
  isSettlementQuantityInput,
  parseSettlementQuantity
} from "./settlement-quantity";

describe("settlement quantity Decimal(24,6) boundary", () => {
  it.each([
    [undefined, null],
    ["", null],
    ["999999999999999999.999999", "999999999999999999.999999"],
    ["-999999999999999999.999999", "-999999999999999999.999999"],
    ["1e3", "1000"],
    [1e3, "1000"],
    ["1.2300000", "1.23"]
  ])("parses compatible quantity %p", (value, expected) => {
    const result = parseSettlementQuantity(value);

    if (expected === null) {
      expect(result).toBeNull();
    } else {
      expect(result).toBeInstanceOf(Decimal);
      expect(result?.toString()).toBe(expected);
    }
    expect(isSettlementQuantityInput(value)).toBe(true);
  });

  it.each([
    null,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    "NaN",
    "Infinity",
    "-Infinity",
    "1e100",
    "0.0000001",
    "999999999999999999.9999999",
    "1000000000000000000",
    "-1000000000000000000",
    {}
  ])("rejects quantity outside Decimal(24,6): %p", (value) => {
    expect(() => parseSettlementQuantity(value)).toThrow(
      "结算明细工程量超出系统可保存范围"
    );
    expect(isSettlementQuantityInput(value)).toBe(false);
  });
});
