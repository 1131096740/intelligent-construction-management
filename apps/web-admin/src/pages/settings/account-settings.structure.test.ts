import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const settingsPage = readFileSync(new URL("./SettingsPage.vue", import.meta.url), "utf8");
const changePasswordPage = readFileSync(new URL("../login/ChangePasswordPage.vue", import.meta.url), "utf8");

describe("self-service account settings", () => {
  it("collects the employee's real name during the forced first password change", () => {
    expect(changePasswordPage).toContain('label="真实姓名"');
    expect(changePasswordPage).toContain("auth.changePassword(form.oldPassword, form.newPassword, name)");
  });

  it("lets every signed-in user update their own profile and password or sign out", () => {
    expect(settingsPage).toContain('title="我的账号"');
    expect(settingsPage).toContain('label="真实姓名"');
    expect(settingsPage).toContain('label="登录手机号"');
    expect(settingsPage).toContain("auth.updateProfile(");
    expect(settingsPage).toContain("auth.changePassword(");
    expect(settingsPage).toContain("auth.logout()");
    expect(settingsPage).toContain("退出登录");
  });
});
