import { expect, test } from "@playwright/test";

test("财务主管能查阅工资历史，旧版本的权限标记无法恢复写操作", async ({ page }) => {
  const user = {
    id: "finance-test",
    name: "测试财务主管",
    phone: "13900000000",
    roleKeys: ["finance_director"],
    globalRoleKeys: ["finance_director"],
    mustChangePassword: false
  };
  const staleCapabilities = { canPrepare: true, canSubmit: true, canReturn: true, canConfirm: true };
  const history = {
    statementId: "statement-1",
    wageMonth: "2026-08",
    employmentCompanyName: "历史工资测试公司",
    sourceLabel: "历史工资归档",
    status: "submitted",
    statusLabel: "待确认",
    revision: 2,
    personLineCount: 3,
    positionCategoryCount: 1,
    projectAllocationCount: 2,
    updatedAt: "2026-08-29T10:00:00.000Z",
    latestReviewReturn: null
  };
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/login") {
      await route.fulfill({ json: { user, tokens: { accessToken: "test-access", refreshToken: "test-refresh", expiresIn: 900 } } });
    } else if (path === "/api/me") {
      await route.fulfill({ json: user });
    } else if (path === "/api/wage-statements/workbench") {
      await route.fulfill({ json: { items: [history], capabilities: staleCapabilities, page: 1, pageSize: 20, total: 1, totalPages: 1 } });
    } else if (path === "/api/wage-statements/statement-1/summary") {
      await route.fulfill({ json: { ...history, categories: [{ positionCategoryLabel: "项目管理", personLineCount: 3, projectAllocationCount: 2 }], capabilities: staleCapabilities } });
    } else if (path === "/api/wage-statements/statement-1/import-preview") {
      await route.fulfill({ json: { ...history, sourceStatusLabel: "已归档" } });
    } else {
      await route.fulfill({ json: [] });
    }
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill(user.phone);
  await page.getByPlaceholder("请输入密码").fill("local-test-password");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login/u);
  await page.goto("/工资承担工作台");

  await expect(page.getByText(history.employmentCompanyName)).toBeVisible();
  await page.getByText("查看汇总", { exact: true }).click();
  await expect(page.getByText("月度汇总详情", { exact: true })).toBeVisible();
  await expect(page.getByText("项目管理", { exact: true })).toBeVisible();
  await expect(page.getByText("已归档", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(提交|退回|确认)$/u })).toHaveCount(0);
  await expect(page.getByText("选择外部批准工资资料", { exact: true })).toHaveCount(0);
});
