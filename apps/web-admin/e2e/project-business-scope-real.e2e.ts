import { expect, test, type Page } from "@playwright/test";

const sessions = JSON.parse(process.env.PROJECT_SCOPE_SESSIONS!);
async function login(page: Page, role: string) {
  await page.goto("/login");
  const session = sessions[role];
  await page.evaluate((value) => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), {
    user: session.user, accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken
  });
}

test("董事长的零采台账可筛选各项目，材料岗位的新建项目由本人选择", async ({ page }, testInfo) => {
  await login(page, "chairman");
  await page.goto("/零星采购工作台");
  await page.getByPlaceholder("全部项目", { exact: true }).click();
  for (const name of ["合成甲项目", "合成乙项目", "合成后建项目"]) {
    await expect(page.locator(".t-select-option:visible").filter({ hasText: name })).toBeVisible();
  }
  await page.locator(".t-select-option:visible").filter({ hasText: "合成乙项目" }).click();
  await login(page, "materialDirector");
  await page.goto("/零星采购工作台");
  await page.getByRole("button", { name: "新建采购申请", exact: true }).click();
  const drawer = page.locator(".t-dialog:visible");
  const projectInput = drawer.getByPlaceholder("请选择项目", { exact: true });
  await expect(projectInput).toHaveValue("");
  await projectInput.click();
  await page.locator(".t-select-option:visible").filter({ hasText: "合成乙项目" }).click();
  await expect(projectInput).toHaveValue(/合成乙项目/);
  await expect(drawer.getByText("当前项目暂不能发起", { exact: true })).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("multi-project-spot.png"), fullPage: true });
});

test("普通项目员工的综合采购仅能选择所属项目", async ({ page }, testInfo) => {
  await login(page, "employee");
  await page.goto("/综合采购申请");
  await page.getByRole("button", { name: "新建综合采购申请", exact: true }).click();
  const field = page.locator('[data-field="projectId"]');
  await expect(field.locator("input")).toHaveValue("合成甲项目");
  await field.locator("input").click();
  await expect(page.locator(".t-select-option:visible").filter({ hasText: "合成乙项目" })).toHaveCount(0);
  await expect(page.locator(".t-select-option:visible").filter({ hasText: "合成甲项目" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("employee-project-scope.png"), fullPage: true });
});
