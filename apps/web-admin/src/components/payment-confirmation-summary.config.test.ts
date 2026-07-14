import { describe, expect, it } from "vitest";
import {
  missingPaymentFact,
  normalizePaymentConfirmationItems
} from "./payment-confirmation-summary.config";

describe("payment confirmation summary configuration", () => {
  it("does not fabricate missing bank facts", () => {
    expect(missingPaymentFact(" ")).toBe("—");
    expect(missingPaymentFact("中国银行昆明分行")).toBe("中国银行昆明分行");
  });

  it("normalizes all requested confirmation labels", () => {
    expect(
      normalizePaymentConfirmationItems([
        { label: " 收款方 ", value: " 城建物资公司 " },
        { label: "银行账号", value: "" }
      ])
    ).toEqual([
      { label: "收款方", value: "城建物资公司", missing: false, blocking: false },
      { label: "银行账号", value: "—", missing: true, blocking: false }
    ]);
  });
});
