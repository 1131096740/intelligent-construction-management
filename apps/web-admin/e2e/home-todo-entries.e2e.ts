import { expect, test, type Page } from "@playwright/test";
import { responsiveViewports } from "./helpers/responsive-viewports";

const dualRoleUser = {
  id: "home-matrix-user",
  name: "兼岗验收用户",
  phone: "13900000000",
  mustChangePassword: false,
  roleKeys: ["finance_staff", "contract_staff"],
  globalRoleKeys: ["finance_staff", "contract_staff"]
};

const pendingItem = {
  id: "home-matrix-pending-1",
  type: "approval",
  businessType: "payment_request",
  title: "付款审批：材料结算",
  projectName: "一号项目",
  businessCode: "FK-E2E-001",
  amountText: "¥256,000.00",
  currentNode: "财务主管审批",
  stayedText: "5 小时",
  nextAction: "处理付款审批",
  targetPath: "/付款管理/FK-E2E-001",
  tone: "warning",
  actionGroup: "approval"
};

async function installRoutes(page: Page) {
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: dualRoleUser,
        tokens: {
          accessToken: "home-matrix-access-token",
          refreshToken: "home-matrix-refresh-token",
          expiresIn: 900
        }
      })
    })
  );
  await page.route("**/api/me/work-items", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: "2026-11-23T10:00:00.000Z",
        visibleProjectCount: 2,
        queues: {
          pending: [pendingItem],
          blocked: [],
          started: [],
          drafts: []
        },
        queueMeta: {
          pending: { total: 1, returned: 1, truncated: false },
          blocked: { total: 0, returned: 0, truncated: false },
          started: { total: 0, returned: 0, truncated: false },
          drafts: { total: 0, returned: 0, truncated: false }
        },
        approvalCenter: {
          pendingApproval: [pendingItem],
          startedByMe: [],
          handledByMe: []
        },
        groups: [
          {
            key: "approval",
            title: "待审批",
            description: "等待你当前岗位审批或同意的单据。",
            count: 1,
            targetPath: "/审批中心?view=pendingApproval",
            items: [pendingItem]
          },
          {
            key: "payment",
            title: "待付款",
            description: "已批准待实付，等你登记付款与凭证。",
            count: 3,
            targetPath: "/付款管理",
            items: [pendingItem]
          }
        ]
      })
    })
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { id: "home-matrix-project-1", code: "P-E2E-001", name: "一号项目" },
        { id: "home-matrix-project-2", code: "P-E2E-002", name: "二号项目" }
      ])
    })
  );
  await page.route("**/api/approval-delegations/user-options", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify([]) })
  );
}

test("home todo groups, projects and position entries hold from 320 to 1920", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await installRoutes(page);
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("HomeMatrix@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "工作台", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "按办理动作看待办" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "我的项目" })).toBeVisible();

  for (const viewport of responsiveViewports) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.getByRole("heading", { name: "按办理动作看待办" })).toBeVisible();
    const approvalCard = page.locator(".home-action-group[data-action-group='approval']");
    await expect(approvalCard).toContainText("待审批");
    await expect(approvalCard).toContainText("付款审批：材料结算");

    const paymentCard = page.locator(".home-action-group[data-action-group='payment']");
    await expect(paymentCard).toContainText("待付款");

    await page.getByRole("button", { name: "查看全部 3 项" }).click();
    await expect(page.getByRole("heading", { name: "我的项目" })).toBeVisible();
    await page.getByRole("button", { name: "重置筛选" }).click();

    const projectCards = page.locator(".home-projects__card");
    await expect(projectCards).toHaveCount(2);
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);

    if (viewport.width <= 720) {
      await expect(page.locator(".jg-desktop-record-list")).toBeHidden();
      await expect(page.locator(".business-mobile-cards")).toBeVisible();
    } else {
      await expect(page.locator(".jg-desktop-record-list")).toBeVisible();
    }
    await page.screenshot({
      path: testInfo.outputPath(`home-matrix-${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const aside = page.locator(".aside");
  await expect(aside).toBeVisible();
  for (const label of ["合同岗", "财务岗", "独立台账", "资金账户", "资料库", "合同台账", "付款台账"]) {
    await expect(aside.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(aside.getByText("审计日志", { exact: true })).toHaveCount(0);
  await expect(aside.getByText("员工管理", { exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".aside")).toHaveCount(0);
  await page.getByRole("button", { name: "打开导航" }).click();
  const drawer = page.locator(".navigation-drawer");
  await expect(drawer).toBeVisible();
  for (const label of ["合同岗", "财务岗", "独立台账", "资金账户", "资料库"]) {
    await expect(drawer.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(drawer.getByText("审计日志", { exact: true })).toHaveCount(0);
  await expect(drawer.getByText("员工管理", { exact: true })).toHaveCount(0);
});
