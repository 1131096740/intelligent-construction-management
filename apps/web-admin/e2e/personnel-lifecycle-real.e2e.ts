import { expect, test } from "@playwright/test";
import { expectNoDocumentHorizontalOverflow } from "./helpers/responsive-assertions";

test("员工详情通过真实页面核实入职、离职及返聘，沿用原员工身份", async ({ page, request }, testInfo) => {
  const password = "Local-Personnel-Only-01";
  const employees = JSON.parse(process.env.PERSONNEL_EMPLOYEES_JSON!) as Record<string, { id: string; name: string; phone: string }>;
  const employee = employees[testInfo.project.name]!;
  const rehireDate = process.env.PERSONNEL_REHIRE_DATE!;
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill(process.env.PERSONNEL_MANAGER_PHONE!);
  await page.getByPlaceholder("请输入密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).not.toHaveURL(/login/u);
  await page.goto("/员工管理");
  await expect(page.getByRole("heading", { name: "员工管理", exact: true })).toBeVisible();
  await page.getByPlaceholder("姓名、电话、部门或岗位关键词").fill(employee.phone);
  const row = (testInfo.project.name === "mobile" ? page.locator("article.employee-card") : page.getByRole("row"))
    .filter({ hasText: employee.phone });
  const drawer = page.locator(".t-drawer__content-wrapper");
  const applies: Array<{ userId: string; action: string; commandKey: string }> = [];

  async function openDetails() {
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: "员工详情", exact: true }).click();
    await expect(drawer.getByRole("heading", { name: `${employee.name} · ${employee.phone}`, exact: true })).toBeVisible();
  }
  async function submit(action: "join" | "offboard" | "rehire", label: string, startedOn?: string) {
    await drawer.getByRole("button", { name: label, exact: true }).click();
    if (startedOn) await drawer.getByPlaceholder("YYYY-MM-DD", { exact: true }).fill(startedOn);
    await drawer.locator("textarea").fill(`真实页面合成人事${action}`);
    await drawer.getByRole("button", { name: "预览办理影响", exact: true }).click();
    await expect(drawer.getByText(`${employee.name} · ${label}：可办理`, { exact: true })).toBeVisible();
    await drawer.getByPlaceholder("请输入本人当前登录密码").fill(password);
    await expectNoDocumentHorizontalOverflow(page);
    const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/organization/personnel-changes/apply"
      && response.request().method() === "POST");
    await drawer.getByRole("button", { name: "确认办理", exact: true }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    const command = response.request().postDataJSON();
    expect(command).toMatchObject({ userId: employee.id, action });
    expect(command.additions).toBeUndefined(); expect(command.removals).toBeUndefined();
    const receipt = await response.json();
    expect(receipt).toMatchObject({ commandKey: command.commandKey, userId: employee.id, action });
    applies.push({ userId: command.userId, action, commandKey: command.commandKey });
    await expect(drawer).toHaveCount(0);
    await expect(page.getByText("人事办理已保存", { exact: true })).toBeVisible();
  }

  await openDetails();
  await expect(drawer.getByText("在职 · 入职资料待核实", { exact: true })).toBeVisible();
  await submit("join", "核实入职", "2026-01-01");
  await openDetails();
  await expect(drawer.getByText("在职", { exact: true })).toBeVisible();
  await expect(drawer.getByText(/入职：2026-01-01；当前任职/u)).toBeVisible();

  const employeeLogin = await request.post("/api/auth/login", { data: { phone: employee.phone, password } });
  expect(employeeLogin.status()).toBe(201);
  const employeeAccess = (await employeeLogin.json()).tokens.accessToken as string;
  const employeeHeaders = { Authorization: `Bearer ${employeeAccess}` };
  expect((await request.get("/api/projects", { headers: employeeHeaders })).status()).toBe(200);
  await submit("offboard", "办理离职");
  expect((await request.get("/api/projects", { headers: employeeHeaders })).status()).toBe(401);
  await openDetails();
  await expect(drawer.getByText("已离职", { exact: true })).toBeVisible();
  await submit("rehire", "返聘", rehireDate);
  expect((await request.get("/api/projects", { headers: employeeHeaders })).status()).toBe(401);
  await openDetails();
  await expect(drawer.getByText("在职", { exact: true })).toBeVisible();
  await expect(drawer.getByText(new RegExp(`入职：${rehireDate}；当前任职`, "u"))).toBeVisible();
  await expect(drawer.getByText(/入职：2026-01-01；离职：/u)).toBeVisible();
  await drawer.getByRole("heading", { name: `${employee.name} · ${employee.phone}`, exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("rehire-complete.png"), fullPage: true });
  await drawer.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  expect(applies.map((command) => command.action)).toEqual(["join", "offboard", "rehire"]);
  expect(new Set(applies.map((command) => command.commandKey)).size).toBe(3);
  await expectNoDocumentHorizontalOverflow(page);
});
