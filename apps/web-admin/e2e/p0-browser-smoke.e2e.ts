import { expect, test, type Page } from "@playwright/test";

async function loginWithMockedAuth(page: Page, roleKeys: string[]) {
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "e2e-user",
          name: "E2E 用户",
          phone: "13900000000",
          mustChangePassword: false,
          roleKeys
        },
        tokens: { accessToken: "e2e-access-token", refreshToken: "e2e-refresh-token", expiresIn: 900 }
      })
    })
  );

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
}

test("opens the workbench shell and historical takeover entry", async ({ page }) => {
  await page.route("**/api/me/workbench-summary", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ generatedAt: new Date().toISOString(), visibleProjectCount: 1, cards: [] })
    })
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{ id: "project-1", code: "P-001", name: "E2E 项目" }])
    })
  );
  await page.route("**/api/projects/project-1/contract-takeovers", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify([]) })
  );
  await loginWithMockedAuth(page, ["contract_staff"]);

  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();

  await page.getByText("历史合同接管").click();
  await expect(page.getByRole("heading", { name: "历史合同接管" })).toBeVisible();
  await expect(page.getByRole("button", { name: "新增接管合同" })).toBeVisible();
});

test("settlement and payment detail failures do not show static samples", async ({ page }) => {
  const phone = process.env.E2E_LIMITED_PHONE;
  const password = process.env.E2E_LIMITED_PASSWORD;
  test.skip(!phone || !password, "Set E2E_LIMITED_PHONE/E2E_LIMITED_PASSWORD for detail permission checks");

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill(phone);
  await page.getByPlaceholder("请输入密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();

  await page.goto("/结算管理/not-found");
  await expect(page.getByText("结算详情读取失败").first()).toBeVisible();
  await expect(page.getByText("JS-2026-018 · 5月材料结算单")).toHaveCount(0);

  await page.goto("/付款管理/not-found");
  await expect(page.getByText("付款详情读取失败").first()).toBeVisible();
  await expect(page.getByText("FK-2026-006 · 5月材料结算付款申请")).toHaveCount(0);
});

test("temporary-password account is forced through password change when configured", async ({ page }) => {
  const phone = process.env.E2E_TEMP_PHONE;
  const tempPassword = process.env.E2E_TEMP_PASSWORD;
  const newPassword = process.env.E2E_NEW_PASSWORD;
  test.skip(!phone || !tempPassword || !newPassword, "Set E2E_TEMP_PHONE/E2E_TEMP_PASSWORD/E2E_NEW_PASSWORD");

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill(phone);
  await page.getByPlaceholder("请输入密码").fill(tempPassword);
  await page.getByRole("button", { name: "登录" }).click();

  await expect(page).toHaveURL(/change-password/);
  await page.getByPlaceholder("请输入当前密码").fill(tempPassword);
  await page.getByPlaceholder("至少 8 位").fill(newPassword);
  await page.getByPlaceholder("请再次输入新密码").fill(newPassword);
  await page.getByRole("button", { name: "保存新密码" }).click();

  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
});
