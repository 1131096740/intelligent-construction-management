import { describe, expect, it } from "vitest";
import {
  assertNonNegativeMoneyCents,
  assertPositiveMoneyCents
} from "./money";

describe("money helpers", () => {
  it("accepts canonical integer cent text without number conversion", () => {
    expect(assertNonNegativeMoneyCents("2100000001", "合同金额")).toBe(
      "2100000001"
    );
    expect(assertPositiveMoneyCents("9007199254740993", "累计金额")).toBe(
      "9007199254740993"
    );
  });

  it("rejects non-canonical and non-positive cent text", () => {
    expect(() => assertNonNegativeMoneyCents("1.5", "金额")).toThrow();
    expect(() => assertNonNegativeMoneyCents(" 1", "金额")).toThrow();
    expect(() => assertPositiveMoneyCents("0", "金额")).toThrow();
    expect(() => assertPositiveMoneyCents("-1", "金额")).toThrow();
  });

  it("rejects non-string values in the non-negative text helper", () => {
    expect(() =>
      assertNonNegativeMoneyCents(1 as unknown as string, "金额")
    ).toThrow("金额必须填写 0 或更大的金额");
  });

  it("rejects non-string values in the positive text helper", () => {
    expect(() =>
      assertPositiveMoneyCents(1 as unknown as string, "金额")
    ).toThrow("金额必须填写大于 0 的金额");
  });
});
