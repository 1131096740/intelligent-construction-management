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
        },
        groups: [{
          key: "approval",
          title: "待审批",
          description: "等待你当前岗位审批或同意的单据。",
          count: 1,
          targetPath: "/审批中心?view=pendingApproval",
          items: [{
            id: "navigation-pending-1",
            type: "approval",
            title: "合同审批待办",
            projectName: "一号项目",
            businessCode: "HT-E2E-001",
            amountText: "¥1.00",
            currentNode: "合同审批",
            stayedText: "1 小时",
            nextAction: "办理审批",
            targetPath: "/合同管理/contract-1",
            tone: "warning",
            actionGroup: "approval"
          }]
        }]
      })
    })
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{ id: "project-1", code: "P-E2E-001", name: "一号项目" }])
    })
  );

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Navigation@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();

  const aside = page.locator(".aside");
  const activeItem = page.locator(".aside .business-navigation__item.is-active");
  const groupLabel = page.locator(".aside .business-navigation h2").first();
  const [asideBox, activeBox] = await Promise.all([aside.boundingBox(), activeItem.boundingBox()]);

  expect(asideBox).not.toBeNull();
  expect(activeBox).not.toBeNull();
  expect(activeBox!.x).toBeGreaterThan(asideBox!.x);
  expect(activeBox!.x + activeBox!.width).toBeLessThan(asideBox!.x + asideBox!.width);
  await expect(activeItem).toHaveCSS("background-color", "rgb(234, 240, 245)");
  await expect(activeItem).toHaveCSS("color", "rgb(49, 93, 133)");
  await expect(activeItem).toHaveCSS("font-weight", "600");
  await expect(groupLabel).toHaveCSS("font-size", "13px");
  await expect(groupLabel).toHaveCSS("font-weight", "500");
  await expect(page.locator(".aside .business-navigation h2")).toHaveText([
    "工作入口",
    "项目",
    "合同岗",
    "物资岗",
    "综合岗",
    "财务岗",
    "独立台账",
    "资料与治理",
    "系统管理"
  ]);
  await expect(page.getByText("项目工作台", { exact: true })).toBeVisible();
  await expect(page.getByText("结算工作台", { exact: true })).toBeVisible();
  await expect(page.getByText("资金办理工作台", { exact: true })).toBeVisible();
  await expect(page.getByText("付款工作台", { exact: true })).toBeVisible();
  await expect(page.getByText("付款管理", { exact: true })).toHaveCount(0);
  await expect(page.getByText("付款台账", { exact: true })).toBeVisible();
  await expect(page.getByText("合同管理", { exact: true })).toHaveCount(0);
  await expect(page.getByText("结算管理", { exact: true })).toHaveCount(0);
  await expect(page.getByText("委托台账", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "按办理动作看待办" })).toBeVisible();
  await expect(page.locator(".home-action-group").first()).toContainText("待审批");
  await expect(page.getByRole("heading", { name: "我的项目" })).toBeVisible();
  await expect(page.locator(".aside .t-badge")).toHaveCount(2);
  await expect(page.locator(".aside .t-badge").first()).toContainText("99+");

  await expect(page.locator(".aside .business-navigation__item.is-active")).toHaveAttribute(
    "aria-current",
    "page"
  );

  await page.screenshot({ path: testInfo.outputPath("admin-navigation.png"), fullPage: true });
});
