import { describe, expect, it } from "vitest";
import { buildApprovalSelfReviewPayload } from "./approval-self-review.config";

describe("buildApprovalSelfReviewPayload", () => {
  it("非自审时不发送原因或密码", () => {
    expect(
      buildApprovalSelfReviewPayload(false, {
        selfReviewReason: "不应发送",
        confirmationPassword: "secret"
      })
    ).toEqual({});
  });

  it("自审缺少原因时拒绝", () => {
    expect(() =>
      buildApprovalSelfReviewPayload(true, {
        selfReviewReason: "   ",
        confirmationPassword: "secret"
      })
    ).toThrow("请填写自审原因");
  });

  it("自审缺少当前密码时拒绝", () => {
    expect(() =>
      buildApprovalSelfReviewPayload(true, {
        selfReviewReason: "业务紧急",
        confirmationPassword: "   "
      })
    ).toThrow("请输入当前密码");
  });

  it("自审原因 trim 后发送，密码保留原值", () => {
    expect(
      buildApprovalSelfReviewPayload(true, {
        selfReviewReason: "  由本人发起且业务紧急  ",
        confirmationPassword: " current-password "
      })
    ).toEqual({
      selfReviewReason: "由本人发起且业务紧急",
      confirmationPassword: " current-password "
    });
  });

  it.each([
    {
      name: "自审原因",
      form: { selfReviewReason: "原".repeat(501), confirmationPassword: "secret" },
      message: "自审原因不能超过 500 字"
    },
    {
      name: "当前密码",
      form: { selfReviewReason: "业务紧急", confirmationPassword: "p".repeat(257) },
      message: "当前密码不能超过 256 字"
    }
  ])("$name 超长时拒绝", ({ form, message }) => {
    expect(() => buildApprovalSelfReviewPayload(true, form)).toThrow(message);
  });

  it("按 Unicode code point 计算自审原因长度", () => {
    expect(
      buildApprovalSelfReviewPayload(true, {
        selfReviewReason: "🚀".repeat(500),
        confirmationPassword: "secret"
      }).selfReviewReason
    ).toBe("🚀".repeat(500));
    expect(() =>
      buildApprovalSelfReviewPayload(true, {
        selfReviewReason: "🚀".repeat(501),
        confirmationPassword: "secret"
      })
    ).toThrow("自审原因不能超过 500 字");
  });

  it("按 Unicode code point 计算当前密码长度", () => {
    expect(
      buildApprovalSelfReviewPayload(true, {
        selfReviewReason: "业务紧急",
        confirmationPassword: "🚀".repeat(256)
      }).confirmationPassword
    ).toBe("🚀".repeat(256));
    expect(() =>
      buildApprovalSelfReviewPayload(true, {
        selfReviewReason: "业务紧急",
        confirmationPassword: "🚀".repeat(257)
      })
    ).toThrow("当前密码不能超过 256 字");
  });
});
