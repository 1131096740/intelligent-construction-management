import { expect, test } from "@playwright/test";

test("董事长新增部门、调整人员部门、停用并重新启用原账号", async ({ page }) => {
  const departmentWrites: unknown[] = [];
  const userWrites: unknown[] = [];
  const departments = [
    { id: "d1", name: "合同部", parentId: null, isActive: true, children: [] },
    { id: "d2", name: "财务部", parentId: null, isActive: true, children: [] }
  ];
  const user = { id: "staff", name: "张三", phone: "13800000001", departmentId: "d1", departmentName: "合同部", status: "active", mustChangePassword: false, globalPositions: [], projectPositions: [] };
  await page.route((url) => url.pathname.startsWith("/api/"), (route) => route.fulfill({ json: {} }));
  await page.route("**/api/auth/login", (route) => route.fulfill({ json: {
    user: { id: "chairman", name: "董事长", phone: "13900000000", mustChangePassword: false, roleKeys: ["chairman"], globalRoleKeys: ["chairman"] },
    tokens: { accessToken: "test-access", refreshToken: "test-refresh", expiresIn: 900 }
  } }));
  await page.route("**/api/me/work-items", (route) => route.fulfill({ json: { generatedAt: new Date().toISOString(), visibleProjectCount: 0, queues: { pending: [], blocked: [], started: [] }, approvalCenter: { pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: [] } } }));
  await page.route("**/api/organization/management-capabilities", (route) => route.fulfill({ json: {
    canCreateUser: true, canManageDepartments: true, canManageUsers: true, canManageRoles: true,
    manageableDepartmentIds: ["d1", "d2", "d3"], manageableUserIds: ["staff"], manageableRoleKeys: ["finance_staff"]
  } }));
  await page.route("**/api/organization/directory", (route) => route.fulfill({ json: {
    summary: { departments: departments.length, activeUsers: user.status === "active" ? 1 : 0, inactiveUsers: user.status === "inactive" ? 1 : 0, positions: 0 },
    departments, users: [user], positions: [], projects: []
  } }));
  await page.route("**/api/organization/departments", (route) => {
    const body = route.request().postDataJSON();
    departmentWrites.push(body);
    departments.push({ id: "d3", name: body.name, parentId: null, isActive: true, children: [] });
    return route.fulfill({ json: { id: "d3" } });
  });
  await page.route("**/api/organization/users/staff", (route) => {
    const body = route.request().postDataJSON();
    userWrites.push(body);
    if (body.departmentId) { user.departmentId = body.departmentId; user.departmentName = departments.find((item) => item.id === body.departmentId)?.name ?? ""; }
    if (typeof body.isActive === "boolean") user.status = body.isActive ? "active" : "inactive";
    return route.fulfill({ json: { id: user.id } });
  });
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Test@2026");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByText("员工管理", { exact: true }).click();
  await page.getByRole("button", { name: "新增部门", exact: true }).click();
  let drawer = page.locator(".t-drawer:visible");
  await drawer.getByPlaceholder("请选择或填写部门名称").fill("项目服务部");
  await drawer.locator('input[type="password"]').fill("current-password");
  await drawer.getByRole("button", { name: "保存调整" }).click();
  await expect.poll(() => departmentWrites.length).toBe(1);
  expect(departmentWrites[0]).toEqual({ name: "项目服务部", parentId: null, confirmationPassword: "current-password" });
  await expect(page.getByText("项目服务部", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "部门 / 停用" }).click();
  drawer = page.locator(".t-drawer:visible");
  await drawer.getByPlaceholder("请选择或填写所属部门").click();
  await page.locator(".t-select__dropdown:visible").getByText("财务部", { exact: true }).click();
  await drawer.getByPlaceholder("请选择是或否").click();
  await page.locator(".t-select__dropdown:visible").getByText("否", { exact: true }).click();
  await drawer.locator('input[type="password"]').fill("current-password");
  await drawer.getByRole("button", { name: "保存调整" }).click();
  await expect(page.getByRole("button", { name: "重新启用" })).toBeVisible();
  expect(userWrites[0]).toEqual({ departmentId: "d2", isActive: false, confirmationPassword: "current-password" });
  await page.getByRole("button", { name: "重新启用" }).click();
  drawer = page.locator(".t-drawer:visible");
  await expect(drawer.locator('input[type="password"]')).toHaveValue("");
  await drawer.getByPlaceholder("请选择是或否").click();
  await page.locator(".t-select__dropdown:visible").getByText("是", { exact: true }).click();
  await drawer.locator('input[type="password"]').fill("current-password");
  await drawer.getByRole("button", { name: "保存调整" }).click();
  await expect(page.getByRole("button", { name: "部门 / 停用" })).toBeVisible();
  expect(userWrites[1]).toEqual({ isActive: true, confirmationPassword: "current-password" });
});
