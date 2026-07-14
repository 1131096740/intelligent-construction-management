import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(name: string) {
  return readFileSync(new URL(`./${name}.vue`, import.meta.url), "utf8");
}

describe("UI P0 business components", () => {
  it("keeps page and detail headers business-focused", () => {
    expect(source("BusinessPageHeader")).toContain("<header");
    expect(source("BusinessDetailHeader")).toContain("当前节点");
    expect(source("BusinessDetailHeader")).toContain("下一步");
    expect(source("BusinessDetailHeader")).toContain("申请金额");
  });

  it("uses TDesign for feedback, money input and sensitive confirmation", () => {
    expect(source("BusinessFeedback")).toContain("<t-alert");
    expect(source("MoneyInput")).toContain("<t-input");
    expect(source("SensitiveActionDialog")).toContain("<t-dialog");
    expect(source("SensitiveActionDialog")).not.toContain("window.confirm");
    expect(source("SensitiveActionDialog")).not.toContain("window.prompt");
  });

  it("renders payment confirmation as read-only business facts", () => {
    const paymentSummary = source("PaymentConfirmationSummary");
    expect(paymentSummary).toContain("付款确认摘要");
    expect(paymentSummary).toContain("待补充");
    expect(paymentSummary).toContain("item.missing && item.blocking");
    expect(paymentSummary).not.toContain("<t-input");
  });
});
