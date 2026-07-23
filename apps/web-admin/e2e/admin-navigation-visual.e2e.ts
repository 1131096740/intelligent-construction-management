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
          roleKeys: ["chairman", "super_admin", "contract_staff", "finance_staff"],
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
        queues: {
          pending: [{
            id: "navigation-pending-1",
            type: "approval",
            title: "合同审批待办",
            projectName: "一号项目",
            projectId: "project-1",
            businessCode: "HT-E2E-001",
            amountText: "¥1.00",
            currentNode: "合同审批",
            stayedText: "1 小时",
            nextAction: "办理审批",
            targetPath: "/合同管理/contract-1",
            tone: "warning"
          }],
          blocked: [],
          started: [],
          drafts: []
        },
        queueMeta: {
          pending: { total: 101, returned: 1, truncated: true },
          blocked: { total: 0, returned: 0, truncated: false },
          started: { total: 0, returned: 0, truncated: false },
          drafts: { total: 0, returned: 0, truncated: false }
        },
        approvalCenter: {
          pendingApproval: [{
            id: "navigation-pending-1",
            type: "approval",
            title: "合同审批待办",
            projectName: "一号项目",
            projectId: "project-1",
            businessCode: "HT-E2E-001",
            amountText: "¥1.00",
            currentNode: "合同审批",
            stayedText: "1 小时",
            nextAction: "办理审批",
            targetPath: "/合同管理/contract-1",
            tone: "warning"
          }],
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
  await expect(activeItem).toHaveCSS("background-color", "rgb(237, 244, 255)");
  await expect(activeItem).toHaveCSS("color", "rgb(0, 82, 217)");
  await expect(activeItem).toHaveCSS("border-left-width", "3px");
  await expect(activeItem).toHaveCSS("box-shadow", "none");
  await expect(groupLabel).toHaveCSS("font-size", "14px");
  await expect(groupLabel).toHaveCSS("font-weight", "700");
  await expect(page.locator(".menu-group-label")).toHaveText([
    "工作入口",
    "项目",
    "合同",
    "结算",
    "付款",
    "零星采购",
    "费用与报销",
    "资料与治理",
    "系统配置"
  ]);
  await expect(page.getByText("项目工作台", { exact: true })).toBeVisible();
  await expect(page.getByText("结算工作台", { exact: true })).toBeVisible();
  await expect(page.getByText("资金办理工作台", { exact: true })).toBeVisible();
  await expect(page.getByText("付款工作台", { exact: true })).toHaveCount(0);
  await expect(page.getByText("付款管理", { exact: true })).toHaveCount(0);
  await expect(page.getByText("合同管理", { exact: true })).toHaveCount(0);
  await expect(page.getByText("结算管理", { exact: true })).toHaveCount(0);
  await expect(page.getByText("委托台账", { exact: true })).toHaveCount(0);
  await expect(page.locator(".navigation-badge")).toHaveCount(2);
  await expect(page.locator(".navigation-badge").first()).toContainText("99+");

  const separator = await groupLabel.evaluate((element) => {
    const style = getComputedStyle(element, "::after");
    return { width: Number.parseFloat(style.width), height: Number.parseFloat(style.height) };
  });
  expect(separator.width).toBeGreaterThan(40);
  expect(separator.height).toBe(1);

  await page.screenshot({ path: testInfo.outputPath("admin-navigation.png"), fullPage: true });
});
