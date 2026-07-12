import { expect, test } from "@playwright/test";

test("keeps the active navigation inside the sidebar and strengthens group headings", async ({
  page
}, testInfo) => {
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "navigation-e2e-user",
          name: "导航验收用户",
          phone: "13900000000",
          mustChangePassword: false,
          roleKeys: ["chairman", "super_admin"],
          globalRoleKeys: ["chairman", "super_admin"]
        },
        tokens: {
          accessToken: "navigation-e2e-access-token",
          refreshToken: "navigation-e2e-refresh-token",
          expiresIn: 900
        }
      })
    })
  );
  await page.route("**/api/me/work-items", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: new Date().toISOString(),
        visibleProjectCount: 1,
        queues: { pending: [], blocked: [], started: [] },
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
  await page.getByPlaceholder("请输入密码").fill("Navigation@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();

  const aside = page.locator(".aside");
  const activeItem = page.locator(".t-menu__item.t-is-active");
  const groupLabel = page.locator(".menu-group-label").first();
  const [asideBox, activeBox] = await Promise.all([aside.boundingBox(), activeItem.boundingBox()]);

  expect(asideBox).not.toBeNull();
  expect(activeBox).not.toBeNull();
  expect(activeBox!.x).toBeGreaterThan(asideBox!.x);
  expect(activeBox!.x + activeBox!.width).toBeLessThan(asideBox!.x + asideBox!.width);
  await expect(activeItem).toHaveCSS("background-color", "rgb(232, 240, 255)");
  await expect(activeItem).toHaveCSS("color", "rgb(0, 82, 204)");
  await expect(groupLabel).toHaveCSS("font-size", "13px");
  await expect(groupLabel).toHaveCSS("font-weight", "700");

  const separator = await groupLabel.evaluate((element) => {
    const style = getComputedStyle(element, "::after");
    return { width: Number.parseFloat(style.width), height: Number.parseFloat(style.height) };
  });
  expect(separator.width).toBeGreaterThan(40);
  expect(separator.height).toBe(1);

  await page.screenshot({ path: testInfo.outputPath("admin-navigation.png"), fullPage: true });
});
