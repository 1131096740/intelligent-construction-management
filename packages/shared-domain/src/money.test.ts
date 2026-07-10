import { describe, expect, it } from "vitest";
import {
  assertNonNegativeMoneyCents,
  assertNonNegativeMoneyCentsText,
  assertPositiveMoneyCents,
  assertPositiveMoneyCentsText
} from "./money";

describe("money helpers", () => {
  it("accepts integer cent amounts", () => {
    expect(assertNonNegativeMoneyCents(0, "amount")).toBe(0);
    expect(assertNonNegativeMoneyCents(12345, "amount")).toBe(12345);
    expect(assertPositiveMoneyCents(1, "amount")).toBe(1);
  });

  it("rejects negative, zero, and decimal amounts where required", () => {
    expect(() => assertNonNegativeMoneyCents(-1, "amount")).toThrow(
      "amount must be a non-negative integer amount in cents"
    );
    expect(() => assertNonNegativeMoneyCents(1.5, "amount")).toThrow(
      "amount must be a non-negative integer amount in cents"
    );
    expect(() => assertPositiveMoneyCents(0, "amount")).toThrow(
      "amount must be a positive integer amount in cents"
    );
    expect(() => assertPositiveMoneyCents(1.5, "amount")).toThrow(
      "amount must be a positive integer amount in cents"
    );
  });

  it("accepts canonical integer cent text without number conversion", () => {
    expect(assertNonNegativeMoneyCentsText("2100000001", "合同金额")).toBe(
      "2100000001"
    );
    expect(assertPositiveMoneyCentsText("9007199254740993", "累计金额")).toBe(
      "9007199254740993"
    );
  });

  it("rejects non-canonical and non-positive cent text", () => {
    expect(() => assertNonNegativeMoneyCentsText("1.5", "金额")).toThrow();
    expect(() => assertNonNegativeMoneyCentsText(" 1", "金额")).toThrow();
    expect(() => assertPositiveMoneyCentsText("0", "金额")).toThrow();
    expect(() => assertPositiveMoneyCentsText("-1", "金额")).toThrow();
  });

  it("rejects non-string values in the non-negative text helper", () => {
    expect(() =>
      assertNonNegativeMoneyCentsText(1 as unknown as string, "金额")
    ).toThrow("金额必须填写 0 或更大的金额");
  });

  it("rejects non-string values in the positive text helper", () => {
    expect(() =>
      assertPositiveMoneyCentsText(1 as unknown as string, "金额")
    ).toThrow("金额必须填写大于 0 的金额");
  });
});
