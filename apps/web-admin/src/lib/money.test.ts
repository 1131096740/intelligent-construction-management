import { describe, expect, it } from "vitest";

import { centsTextToYuanText, yuanTextToCentsText } from "./money";

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
