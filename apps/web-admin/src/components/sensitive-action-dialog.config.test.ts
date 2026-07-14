import { describe, expect, it } from "vitest";
import { sensitiveActionConfirmationError } from "./sensitive-action-dialog.config";

describe("sensitive action dialog configuration", () => {
  it("requires the configured reason and current password", () => {
    expect(
      sensitiveActionConfirmationError({
        requireReason: true,
        reason: "",
        requirePassword: true,
        password: ""
      })
    ).toBe("请填写操作原因");
    expect(
      sensitiveActionConfirmationError({
        requireReason: true,
        reason: "业务复核",
        requirePassword: true,
        password: ""
      })
    ).toBe("请输入当前登录密码");
  });

  it("allows confirmation only when all required evidence is present", () => {
    expect(
      sensitiveActionConfirmationError({
        requireReason: true,
        reason: "业务复核",
        requirePassword: true,
        password: "Current@2026"
      })
    ).toBe("");
  });
});
