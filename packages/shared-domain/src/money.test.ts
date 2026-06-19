import { describe, expect, it } from "vitest";
import { assertNonNegativeMoneyCents, assertPositiveMoneyCents } from "./money";

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
});
