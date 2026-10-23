import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  expectBusinessContentWithinViewport,
  expectNoDocumentHorizontalOverflow,
  expectNoNestedHorizontalScrollers
} from "./helpers/responsive-assertions";
import { responsiveViewports } from "./helpers/responsive-viewports";

test("keeps navigation, page content, and confirmation controls usable across device sizes", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const screenshotDir = process.env.UI_RESPONSIVE_SCREENSHOT_DIR
    ? resolve(process.env.UI_RESPONSIVE_SCREENSHOT_DIR)
    : testInfo.outputDir;
  mkdirSync(screenshotDir, { recursive: true });

  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "responsive-foundation-user",
          name: "响应式验收用户姓名比较长",
          phone: "13900000000",
          mustChangePassword: false,
          roleKeys: ["chairman", "super_admin", "general_manager", "project_manager", "contract_director", "finance_director", "budget_director", "engineering_department_director"],
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
  await page.route("**/api/approval-delegations/user-options", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify([]) })
  );

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Responsive@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  for (const viewport of responsiveViewports) {
    await page.setViewportSize(viewport);
    await expect(page.locator(".business-page-header")).toBeVisible();
    await expect(page.getByRole("button", { name: "刷新" })).toBeVisible();
    // WebKit computes clip as hidden when the other axis is scrollable.
    await expect(page.locator(".content")).toHaveCSS("overflow-x", /^(clip|hidden)$/);
    const contentScroll = await page.locator(".content").evaluate((element) => {
      const node = element as HTMLElement;
      const start = node.scrollLeft;
      node.scrollLeft = 80;
      const after = node.scrollLeft;
      node.scrollLeft = start;
      return { after, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth };
    });
    expect(contentScroll.after === 0 || contentScroll.scrollWidth <= contentScroll.clientWidth + 1).toBe(true);
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoNestedHorizontalScrollers(page);
    await expectBusinessContentWithinViewport(page);
    const heading = await page.locator(".business-page-header").boundingBox();
    expect(heading!.y).toBeLessThan(viewport.height / 2);
    const userText = await page.locator(".header-user").evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const bounds = range.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right };
    });
    expect(userText.left).toBeGreaterThanOrEqual(0);
    expect(userText.right).toBeLessThanOrEqual(viewport.width);
    if (viewport.width <= 1280) {
      await expect(page.locator(".aside")).toHaveCount(0);
      const toggle = page.getByRole("button", { name: "打开导航" });
      await expect(page.locator(".t-drawer__content-wrapper")).toHaveCount(0);
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      const navigation = page.locator(".navigation-drawer");
      await expect(navigation.getByText("业务导航", { exact: true })).toBeVisible();
      await expect(page.locator(".t-drawer__content-wrapper")).toHaveCount(1);
      const settingsEntry = navigation.getByRole("link", { name: "系统配置", exact: true });
      await settingsEntry.scrollIntoViewIfNeeded();
      await expect(settingsEntry).toBeInViewport();
      await navigation.getByText("首页", { exact: true }).click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(navigation).toHaveCount(0);
      await expect(page.locator(".t-drawer__content-wrapper")).toHaveCount(0);
      await expect(page.locator("#main-content")).toBeFocused();
    } else {
      await expect(page.locator(".aside")).toBeVisible();
      await expect(page.getByRole("button", { name: "打开导航" })).toHaveCount(0);
      await expect(page.locator(".navigation-drawer")).toHaveCount(0);
      await expect(page.locator(".t-drawer__content-wrapper")).toHaveCount(0);
    }
    await page.screenshot({
      path: resolve(screenshotDir, `foundation-home-${viewport.width}x${viewport.height}.png`),
      fullPage: false
    });
  }

  // Crossing the exact compact-navigation boundary must unmount an open drawer.
  await page.setViewportSize({ width: 1280, height: 720 });
  const boundaryToggle = page.getByRole("button", { name: "打开导航" });
  await boundaryToggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "业务导航" }).getByRole("link").first()).toBeFocused();
  await page.setViewportSize({ width: 1281, height: 720 });
  await expect(page.locator(".aside")).toBeVisible();
  await expect(page.locator(".navigation-drawer")).toHaveCount(0);
  await expect(page.locator(".t-drawer__content-wrapper")).toHaveCount(0);
  await expect(boundaryToggle).toHaveCount(0);
  await expect(page.locator(".main-shell")).toHaveJSProperty("inert", false);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(boundaryToggle).toBeVisible();
  await expect(boundaryToggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".t-drawer__content-wrapper")).toHaveCount(0);
  await boundaryToggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "业务导航" }).getByRole("link").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(boundaryToggle).toBeFocused();
  await expect(page.locator(".t-drawer__content-wrapper")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  const toggle = page.getByRole("button", { name: "打开导航" });
  await toggle.focus();
  await page.keyboard.press("Enter");
  const navigationDialog = page.getByRole("dialog", { name: "业务导航" });
  const links = navigationDialog.getByRole("link");
  await expect(links.first()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(links.nth(1)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  const closeNavigation = navigationDialog.getByRole("button", { name: "关闭导航" });
  await expect(closeNavigation).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(links.last()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeNavigation).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(links.first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await expect(page.locator(".navigation-drawer")).toHaveCount(0);
  await expect(page.locator(".t-drawer__content-wrapper")).toHaveCount(0);
  const bottomNavigation = page.getByRole("navigation", { name: "常用工作导航" });
  const bottomToggle = bottomNavigation.getByRole("button", { name: "全部业务", exact: true });
  await bottomToggle.focus();
  await page.keyboard.press("Enter");
  await expect(links.first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(bottomToggle).toBeFocused();
  await expect(page.locator(".navigation-drawer")).toHaveCount(0);
  await expect(page.locator(".t-drawer__content-wrapper")).toHaveCount(0);

  const previousKeyboardState = await page.evaluate(() => document.documentElement.getAttribute("data-keyboard"));
  try {
    // The viewport adapter owns this state on phones; exercise its compact layout without an OS keyboard.
    await page.evaluate(() => document.documentElement.setAttribute("data-keyboard", "open"));
    await expect(bottomNavigation).not.toBeVisible();
    await expect(toggle).toBeInViewport();
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(links.first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(toggle).toBeFocused();
    await expect(page.locator(".navigation-drawer")).toHaveCount(0);
    await expect(page.locator(".t-drawer__content-wrapper")).toHaveCount(0);
  } finally {
    await page.evaluate((state) => {
      if (state === null) document.documentElement.removeAttribute("data-keyboard");
      else document.documentElement.setAttribute("data-keyboard", state);
    }, previousKeyboardState);
  }
  await expect(bottomNavigation).toBeVisible();
  await toggle.focus();
  await page.keyboard.press("Enter");
  const approvalLink = navigationDialog.getByRole("link", { name: "审批中心", exact: true });
  await approvalLink.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "审批中心" })).toBeVisible();
  await expect(page.locator(".navigation-drawer")).toHaveCount(0);
  await expect(page.locator(".t-drawer__content-wrapper")).toHaveCount(0);
  await page.goto("/首页");
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();

  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1024, height: 600 }]) {
    await page.setViewportSize(viewport);
    // Exercise the app's installed TDesign dialog with a long form body.
    await page.evaluate(() => {
      const root = document.getElementById("app") as HTMLElement & {
        __vue_app__: { config: { globalProperties: {
          $dialog: (options: Record<string, unknown>) => unknown;
        } } };
      };
      root.__vue_app__.config.globalProperties.$dialog({
        header: "响应式确认弹窗",
        body: "请核对当前业务事实及相关附件，完成核对后继续办理。".repeat(80),
        width: "920px",
        confirmBtn: "确认验收",
        cancelBtn: "取消验收",
        destroyOnClose: true
      });
    });
    const dialog = page.locator(".t-dialog--default").filter({ hasText: "响应式确认弹窗" });
    await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    const body = dialog.locator(".t-dialog__body");
    const scroll = await body.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      return { scrollTop: element.scrollTop, hasMore: element.scrollHeight > element.clientHeight };
    });
    expect(scroll.hasMore).toBe(true);
    expect(scroll.scrollTop).toBeGreaterThan(0);
    await expect(dialog.getByRole("button", { name: "确认验收" })).toBeInViewport();
    await dialog.getByRole("button", { name: "取消验收" }).click();
    await expect(dialog).not.toBeVisible();
  }

  expect(pageErrors).toEqual([]);
});
