import { parseExpenseQuantity } from "./expense-claim-quantity";

/**
 * #404 EXP-02：明细数量可空；有值时按 D02 新精度协议最多 4 位小数，禁止
 * 科学计数、负数和隐式截断。空值不是 0。
 */
describe("expense claim quantity parsing", () => {
  it("keeps an omitted quantity as null", () => {
    expect(parseExpenseQuantity(undefined)).toBeNull();
    expect(parseExpenseQuantity("")).toBeNull();
    expect(parseExpenseQuantity("   ")).toBeNull();
  });

  it("accepts up to four decimals and normalizes the text", () => {
    expect(parseExpenseQuantity("2")).toBe("2");
    expect(parseExpenseQuantity(" 2.5000 ")).toBe("2.5");
    expect(parseExpenseQuantity("0.0001")).toBe("0.0001");
    expect(parseExpenseQuantity("12345678901234567890.1234")).toBe("12345678901234567890.1234");
  });

  it("rejects zero, negative, over-precision and non-decimal text", () => {
    expect(() => parseExpenseQuantity("0")).toThrow("数量必须大于 0");
    expect(() => parseExpenseQuantity("0.0000")).toThrow("数量必须大于 0");
    expect(() => parseExpenseQuantity("00.0000")).toThrow("数量必须大于 0");
    expect(() => parseExpenseQuantity("-1")).toThrow("数量格式不正确");
    expect(() => parseExpenseQuantity("1.23456")).toThrow("最多 4 位小数");
    expect(() => parseExpenseQuantity("1e3")).toThrow("数量格式不正确");
    expect(() => parseExpenseQuantity("abc")).toThrow("数量格式不正确");
    expect(() => parseExpenseQuantity("123456789012345678901")).toThrow("数量超出可登记范围");
  });
});
