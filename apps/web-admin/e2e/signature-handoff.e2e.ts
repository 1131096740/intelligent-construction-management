import { expect, test } from "@playwright/test";

test("桌面生成同源二维码并在手机端完成后刷新状态", async ({ page }) => {
  let statusReads = 0;
  await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: { id: "employee-1", name: "测试员工", phone: "13800000001", mustChangePassword: false, roleKeys: ["employee"], globalRoleKeys: ["employee"] },
      tokens: { accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 900 }
    })
  }));
  await page.route("**/api/me/signature/ticket", (route) => route.fulfill({ contentType: "application/json", body: "null" }));
  await page.route("**/api/me/signature/canvas-handoffs", (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ token: "opaque-token", expiresAt: "2026-07-23T09:05:00.000Z" })
  }));
  await page.route("**/api/me/signature/canvas-handoffs/opaque-token", (route) => {
    statusReads += 1;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ expiresAt: "2026-07-23T09:05:00.000Z", completedAt: statusReads >= 1 ? "2026-07-23T09:01:00.000Z" : null, signatureVersionId: statusReads >= 1 ? "version-1" : null })
    });
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13800000001");
  await page.getByPlaceholder("请输入密码").fill("Jgzg@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/系统配置");

  await expect(page.getByAltText("手机手写签名二维码")).toBeVisible();
  await expect(page.getByText("手机端已完成手写签名，现在起可用于之后的审批。", { exact: true })).toBeVisible();
});
