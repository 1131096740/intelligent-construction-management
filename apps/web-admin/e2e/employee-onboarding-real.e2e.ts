import { expect, test } from "@playwright/test";
import { expectNoDocumentHorizontalOverflow } from "./helpers/responsive-assertions";

test("真实注册、董事长批准、本人登录与管理员重置密码", async ({ page, browser }, testInfo) => {
  const phone = testInfo.project.name === "mobile" ? "13911000002" : "13911000001";
  const name = `验收员工${testInfo.project.name === "mobile" ? "手机" : "电脑"}`;
  const password = "Local-Onboarding-01";
  await page.goto("/register");
  await page.getByPlaceholder("请输入本人真实姓名").fill(name);
  await page.getByPlaceholder("请输入本人手机号").fill(phone);
  await page.getByPlaceholder("请设置至少8位密码").fill(password);
  await page.getByPlaceholder("请再输入一次密码").fill(password);
  await page.getByRole("button", { name: "提交入职申请" }).click();
  await expect(page.getByText("等待综合部或董事长审核", { exact: true })).toBeVisible();
  await expectNoDocumentHorizontalOverflow(page);

  const managerContext = await browser.newContext({ ...testInfo.project.use });
  try {
    const manager = await managerContext.newPage();
    await manager.goto("http://127.0.0.1:5199/login");
    await manager.getByPlaceholder("请输入手机号").fill(process.env.ONBOARDING_MANAGER_PHONE!);
    await manager.getByPlaceholder("请输入密码").fill(password);
    await manager.getByRole("button", { name: "登录", exact: true }).click();
    await expect(manager).not.toHaveURL(/login/);
    await manager.goto("http://127.0.0.1:5199/组织权限");
    const row = manager.getByRole("row").filter({ hasText: phone });
    await row.getByRole("button", { name: "审核申请", exact: true }).click();
    const drawer = manager.locator(".t-drawer__content-wrapper");
    await drawer.locator('[data-field="departmentId"]').click();
    const departmentOption = manager.locator(".t-select__dropdown:visible .t-select-option").filter({ hasText: "入职浏览器验收部门" });
    await expect(departmentOption).toHaveCount(1);
    await departmentOption.click();
    await drawer.locator('[data-field="initialRoleKey"]').click();
    const financeOption = manager.locator(".t-select__dropdown:visible .t-select-option").filter({ hasText: "财务经办" });
    await expect(financeOption).toHaveCount(1);
    await financeOption.click();
    await drawer.getByText("我已核对员工本人及手机号", { exact: true }).click();
    await drawer.getByPlaceholder("请输入本人当前登录密码").fill(password);
    await drawer.getByRole("button", { name: "批准开通", exact: true }).click();
    await expect(drawer).toHaveCount(0);
    await page.getByRole("button", { name: "刷新审核结果" }).click();
    await expect(page.getByText("审核通过，账号已开通", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "返回登录" }).click();
    await page.getByPlaceholder("请输入手机号").fill(phone);
    await page.getByPlaceholder("请输入密码").fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page).not.toHaveURL(/login|registration-status/);
    await expectNoDocumentHorizontalOverflow(page);

    const employeeRow = manager.getByRole("row").filter({ hasText: phone }).filter({ has: manager.getByRole("button", { name: "重置密码", exact: true }) });
    await employeeRow.getByRole("button", { name: "重置密码", exact: true }).click();
    const dialog = manager.locator(".t-dialog");
    await dialog.getByText("我已核对员工本人及手机号", { exact: true }).click();
    await dialog.getByPlaceholder("请输入本人当前登录密码").fill(password);
    await dialog.getByRole("button", { name: "确认重置密码", exact: true }).click();
    const temporaryPassword = await dialog.getByLabel("临时密码", { exact: true }).inputValue();
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(12);
    await expect(dialog.getByPlaceholder("请输入本人当前登录密码")).toHaveCount(0);
    await dialog.getByRole("button", { name: "我已记录并将转交本人" }).click();
    await expect(manager.getByLabel("临时密码", { exact: true })).toHaveCount(0);
    await expectNoDocumentHorizontalOverflow(manager);
  } finally {
    await managerContext.close().catch(() => { /* 超时清理不覆盖原始失败位置。 */ });
  }
});
