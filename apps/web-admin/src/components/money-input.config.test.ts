import { describe, expect, it } from "vitest";
import { moneyInputError, normalizedMoneyYuanText } from "./money-input.config";

describe("money input configuration", () => {
  it("accepts yuan text and formats through the existing cents helper", () => {
    expect(moneyInputError("256000.50", true)).toBe("");
    expect(normalizedMoneyYuanText("256000.50")).toBe("256,000.50");
  });

  it("keeps required and precision errors next to the field", () => {
    expect(moneyInputError("", true)).toBe("请输入金额");
    expect(moneyInputError("12.345", true)).toBe("金额必须是非负数字，最多保留两位小数");
  });
});
