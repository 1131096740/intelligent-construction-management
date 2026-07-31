import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sensitiveActionConfirmationError } from "./sensitive-action-dialog.config";

const dialogSource = readFileSync(
  fileURLToPath(new URL("./SensitiveActionDialog.vue", import.meta.url)),
  "utf8"
);

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

  it("removes every user-controlled close path while a sensitive write is loading", () => {
    expect(dialogSource).toContain(':close-btn="!loading"');
    expect(dialogSource).toContain(':close-on-overlay-click="false"');
    expect(dialogSource).toContain(':close-on-esc-keydown="!loading"');
    expect(dialogSource).toContain("if (props.loading) return;");
  });
});
