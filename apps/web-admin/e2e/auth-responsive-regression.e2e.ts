import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  expectNoDocumentHorizontalOverflow,
  expectNoNestedHorizontalScrollers
} from "./helpers/responsive-assertions";

const viewports = [
  { width: 1512, height: 982 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1180, height: 820 },
  { width: 1024, height: 768 },
  { width: 900, height: 768 }
] as const;

async function assertAuthPage(page: Page) {
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
}

test("登录与首次改密页在六档桌面窗口中完整可用", async ({ page }, testInfo) => {
  const screenshotDir = process.env.UI_RESPONSIVE_SCREENSHOT_DIR ?? testInfo.outputDir;
  mkdirSync(screenshotDir, { recursive: true });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "建工智管" })).toBeVisible();
    await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
    await assertAuthPage(page);
    await page.screenshot({
      path: path.join(screenshotDir, `login-${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });
  }

  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: "auth-responsive",
        name: "首次登录用户",
        phone: "13900000000",
        mustChangePassword: true,
        roleKeys: ["employee"],
        globalRoleKeys: ["employee"]
      },
      tokens: { accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 900 }
    })
  }));
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "修改初始密码" })).toBeVisible();

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect(page.getByPlaceholder("请输入你的真实姓名")).toBeVisible();
    await expect(page.getByRole("button", { name: "保存新密码" })).toBeVisible();
    await assertAuthPage(page);
    await page.screenshot({
      path: path.join(screenshotDir, `change-password-${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });
  }

  expect(pageErrors).toEqual([]);
});
