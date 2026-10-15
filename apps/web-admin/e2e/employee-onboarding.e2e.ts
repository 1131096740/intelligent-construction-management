import { expect, test } from "@playwright/test";
import { expectNoDocumentHorizontalOverflow } from "./helpers/responsive-assertions";

test("员工从登录页注册、查看待审核并能找到人工密码找回方式", async ({ page }) => {
  const body = { id: "application-1", name: "合成入职员工", phone: "13910000001", status: "pending", revision: 1, reason: "", phoneVerified: false, mustChangePassword: false };
  const registrationBodies: unknown[] = [];
  await page.route("**/api/account-security/options", (route) => route.fulfill({ json: { smsEnabled: false, canRegister: true, canLoginApplication: true, canUseRecoveryCode: true } }));
  await page.route("**/api/employee-onboarding/register", (route) => {
    registrationBodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: { application: body, applicationToken: "application-only" } });
  });
  await page.route("**/api/employee-onboarding/mine", (route) => route.fulfill({ json: body }));
  await page.goto("/login");
  await page.getByRole("link", { name: "新员工注册" }).click();
  await page.getByPlaceholder("请输入本人真实姓名").fill(body.name);
  await page.getByPlaceholder("请输入本人手机号").fill(body.phone);
  await page.getByPlaceholder("请设置至少8位密码").fill("Local-Onboarding-01");
  await page.getByPlaceholder("请再输入一次密码").fill("Local-Onboarding-01");
  await page.getByRole("button", { name: "提交入职申请" }).click();
  await expect(page.getByRole("heading", { name: "我的入职申请" })).toBeVisible();
  await expect(page.getByText("等待综合部或董事长审核", { exact: true })).toBeVisible();
  expect(registrationBodies).toEqual([{ name: body.name, phone: body.phone, password: "Local-Onboarding-01" }]);
  expect(await page.evaluate(() => localStorage.getItem("jiangkong-web-admin-auth"))).toBeNull();
  await expectNoDocumentHorizontalOverflow(page);
  await page.getByRole("link", { name: "返回登录" }).click();
  await page.getByRole("link", { name: "忘记密码" }).click();
  await expect(page.getByText("请联系综合部负责人；管理层和财务人员请联系董事长。", { exact: true })).toBeVisible();
  await expectNoDocumentHorizontalOverflow(page);
});

test("审核中的员工从同一个登录入口进入本人申请", async ({ page }) => {
  await page.route("**/api/account-security/options", (route) => route.fulfill({ json: { smsEnabled: false, canLoginApplication: true } }));
  await page.route("**/api/auth/login", (route) => route.fulfill({ status: 401, json: { message: "手机号或密码不正确" } }));
  await page.route("**/api/employee-onboarding/login", (route) => route.fulfill({ status: 201, json: {
    applicationToken: "application-only", application: { id: "application-2", status: "returned" }
  } }));
  await page.route("**/api/employee-onboarding/mine", (route) => route.fulfill({ json: {
    id: "application-2", name: "合成员工", phone: "13910000002", status: "returned", revision: 2, reason: "请核对真实姓名", mustChangePassword: false
  } }));
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13910000002");
  await page.getByPlaceholder("请输入密码").fill("Local-Onboarding-01");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "我的入职申请" })).toBeVisible();
  await expect(page.getByText("请核对真实姓名", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "修改后重新提交" })).toBeVisible();
});

test("董事长在组织管理核对入职资料并一次批准财务账号", async ({ page }) => {
  await page.route("**/api/me/work-items**", (route) => route.fulfill({ json: [] }));
  await page.addInitScript(() => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify({ accessToken: "chairman-access", refreshToken: "chairman-refresh", user: {
    id: "chairman-1", name: "合成董事长", phone: "13910000000", mustChangePassword: false, roleKeys: ["chairman"], globalRoleKeys: ["chairman"]
  } })));
  let approved = false; const decisions: unknown[] = [];
  await page.route("**/api/organization/management-capabilities", (route) => route.fulfill({ json: {
    canCreateUser: true, canManageUsers: true, canManageRoles: true, canManageDepartments: true, canReviewApplications: true, canApproveImportantEmployees: true,
    manageableDepartmentIds: ["department-1"], manageableUserIds: [], manageableRoleKeys: ["finance_staff"], importantEmployeeRoleKeys: ["finance_staff"]
  } }));
  await page.route("**/api/organization/directory", (route) => route.fulfill({ json: { summary: { departments: 1, activeUsers: 1, inactiveUsers: 0, positions: 1 },
    departments: [{ id: "department-1", name: "财务部", parentId: null, isActive: true, children: [] }], users: [], projects: [], positions: [{ id: "finance", key: "finance_staff", name: "财务经办" }]
  } }));
  await page.route("**/api/employee-onboarding/applications", (route) => route.fulfill({ json: { pendingCount: approved ? 0 : 1, applications: approved ? [] : [
    { id: "finance-application", name: "合成财务员工", phone: "13910000009", status: "chairman_review", revision: 2, reason: "", departmentId: "department-1", proposedRoles: [{ roleKey: "finance_staff" }], phoneVerified: true, mustChangePassword: false }
  ] } }));
  await page.route("**/api/employee-onboarding/applications/finance-application/review", (route) => {
    decisions.push(route.request().postDataJSON()); approved = true;
    return route.fulfill({ status: 201, json: { status: "approved", revision: 3 } });
  });
  await page.goto("/组织权限");
  await page.getByRole("button", { name: "审核申请", exact: true }).click();
  await expect(page.getByText("合成财务员工 · 13910000009", { exact: true })).toBeVisible();
  await page.getByText("我已核对员工本人及手机号", { exact: true }).click();
  await page.getByPlaceholder("请输入本人当前登录密码").fill("Local-Onboarding-01");
  await page.getByRole("button", { name: "批准开通", exact: true }).click();
  await expect(page.getByRole("button", { name: "审核申请", exact: true })).toHaveCount(0);
  expect(decisions).toEqual([{ revision: 2, decision: "approve", departmentId: "department-1", roles: [{ roleKey: "finance_staff" }], identityVerified: true, reason: "", confirmationPassword: "Local-Onboarding-01" }]);
  await expectNoDocumentHorizontalOverflow(page);
});

test("短信可用时员工可用验证码找回密码，重复发送按钮保持倒计时", async ({ page }) => {
  const sends: unknown[] = []; const resets: unknown[] = [];
  await page.route("**/api/account-security/options", (route) => route.fulfill({ json: { smsEnabled: true, canRegister: true, canLoginApplication: true, canUseRecoveryCode: true } }));
  await page.route("**/api/account-security/sms", (route) => { sends.push(route.request().postDataJSON()); return route.fulfill({ status: 201, json: { ok: true, retryAfterSeconds: 60 } }); });
  await page.route("**/api/account-security/reset-with-sms", (route) => { resets.push(route.request().postDataJSON()); return route.fulfill({ status: 201, json: { ok: true } }); });
  await page.goto("/forgot-password");
  await page.getByPlaceholder("请输入本人手机号").fill("13910000008");
  await page.getByRole("button", { name: "获取验证码", exact: true }).click();
  await expect(page.getByRole("button", { name: /秒后重发/ })).toBeDisabled();
  await page.getByPlaceholder("请输入6位验证码").fill("123456");
  await page.getByPlaceholder("请设置至少8位密码").fill("Local-New-Password-02");
  await page.getByPlaceholder("请再输入一次密码").fill("Local-New-Password-02");
  await page.getByRole("button", { name: "保存新密码", exact: true }).click();
  await expect(page.getByText("新密码已保存，请返回登录。", { exact: true })).toBeVisible();
  expect(sends).toEqual([{ phone: "13910000008", purpose: "reset" }]);
  expect(resets).toEqual([{ phone: "13910000008", code: "123456", newPassword: "Local-New-Password-02" }]);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expectNoDocumentHorizontalOverflow(page);
});
