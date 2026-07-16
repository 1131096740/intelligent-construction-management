import { Decimal } from "@prisma/client/runtime/library";
import {
  isSettlementQuantityInput,
  parseSettlementQuantity
} from "./settlement-quantity";

describe("settlement quantity input boundary", () => {
  it.each([
    [undefined, null],
    ["", null],
    ["999999999999999999.99", "999999999999999999.99"],
    ["-999999999999999999.99", "-999999999999999999.99"],
    ["1e3", "1000"],
    [1e3, "1000"],
    ["1.2300", "1.23"]
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
    "0.001",
    "999999999999999999.999",
    "1000000000000000000",
    "-1000000000000000000",
    {}
  ])("rejects an invalid new quantity input: %p", (value) => {
    expect(() => parseSettlementQuantity(value)).toThrow(
      "本期结算数量最多保留 2 位小数，请修改后重试。"
    );
    expect(isSettlementQuantityInput(value)).toBe(false);
  });
});
