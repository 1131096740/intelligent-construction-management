import { describe, expect, it } from "vitest";
import { createYuanMoneyInput } from "./yuan-money-input";

describe("元金额输入与分值接口", () => {
  it("更正允许负元金额，普通金额仍拒绝负数", () => {
    const field = createYuanMoneyInput("-12345", true);
    expect(field.text).toBe("-123.45");
    expect(field.input("-0.01")).toBe("-1");
    expect(field.input("92233720368547758.08")).toBe("");
  });
  it("显示元并以精确分值提交，保留大额的小数精度", () => {
    const field = createYuanMoneyInput("123456");
    expect(field.text).toBe("1234.56");
    expect(field.input("90071992547409.93")).toBe("9007199254740993");
    field.receive("9007199254740993");
    expect(field.text).toBe("90071992547409.93");
    expect(field.input("0.01")).toBe("1");
    expect(field.input("0")).toBe("0");
  });

  it("保留未完成或无效输入，并清空待提交金额，防止保存旧值或误换算", () => {
    const field = createYuanMoneyInput("10000");
    for (const text of ["100.", "", "1.234", "-2", "1e3", "abc"]) {
      expect(field.input(text)).toBe("");
      field.receive("");
      expect(field.text).toBe(text);
      expect(field.error).not.toBe("");
    }
    expect(field.input("100.05")).toBe("10005");
    expect(field.error).toBe("");
    field.receive("120000");
    expect(field.text).toBe("1200.00");
  });
});
