import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  expectNoDocumentHorizontalOverflow,
  expectNoNestedHorizontalScrollers
} from "./helpers/responsive-assertions";

const screenshotDir = process.env.UI_RESPONSIVE_SCREENSHOT_DIR
  ? resolve(process.env.UI_RESPONSIVE_SCREENSHOT_DIR)
  : resolve("test-results/ui-responsive-foundation");

const viewports = [
  { width: 1512, height: 982 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1180, height: 820 },
  { width: 1024, height: 768 },
  { width: 900, height: 768 }
];

test("keeps the application shell and shared page header inside six desktop viewports", async ({ page }) => {
  mkdirSync(screenshotDir, { recursive: true });

  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "responsive-foundation-user",
          name: "响应式验收用户",
          phone: "13900000000",
          mustChangePassword: false,
          roleKeys: ["chairman", "super_admin"],
          globalRoleKeys: ["chairman", "super_admin"]
        },
        tokens: {
          accessToken: "responsive-foundation-access-token",
          refreshToken: "responsive-foundation-refresh-token",
          expiresIn: 900
        }
      })
    })
  );
  await page.route("**/api/me/work-items", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: "2026-07-14T08:00:00.000Z",
        visibleProjectCount: 1,
        queues: {
          pending: [{
            id: "responsive-item-1",
            type: "approval",
            businessType: "payment",
            title: "付款审批：材料结算",
            projectName: "响应式验收项目",
            businessCode: "FK-RWD-001",
            amountText: "¥256,000.00",
            currentNode: "财务主管审批",
            stayedText: "已停留 5 小时",
            nextAction: "处理付款审批",
            targetPath: "/付款管理/FK-RWD-001",
            tone: "warning"
          }],
          blocked: [],
          started: []
        },
        approvalCenter: {
          pendingApproval: [],
          startedByMe: [],
          handledByMe: [],
          delegatedToMe: [],
          overdueReminder: []
        }
      })
    })
  );

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Responsive@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect(page.locator(".business-page-header")).toBeVisible();
    await expect(page.getByRole("button", { name: "刷新" })).toBeVisible();
    await expect(page.locator(".content")).toHaveCSS("overflow-x", "clip");
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoNestedHorizontalScrollers(page);
    await page.screenshot({
      path: resolve(screenshotDir, `foundation-home-${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });
  }

  expect(pageErrors).toEqual([]);
});
