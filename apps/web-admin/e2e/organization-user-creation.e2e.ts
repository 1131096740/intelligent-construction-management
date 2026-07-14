import { expect, test } from "@playwright/test";

test("全局管理员安全创建待本人确认人员并在成功后清空临时密码", async ({ page }) => {
  let directoryReads = 0;
  let roleApplyCalls = 0;
  const createBodies: Array<Record<string, unknown>> = [];

  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "admin-1",
          name: "系统管理员",
          phone: "13900000000",
          mustChangePassword: false,
          roleKeys: ["super_admin"],
          globalRoleKeys: ["super_admin"]
        },
        tokens: { accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 900 }
      })
    })
  );
  await page.route("**/api/me/work-items", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: new Date().toISOString(),
        visibleProjectCount: 0,
        queues: { pending: [], blocked: [], started: [] },
        approvalCenter: {
          pendingApproval: [],
          startedByMe: [],
          handledByMe: [],
          delegatedToMe: [],
          overdueReminder: []
        }
      })
    })
  );
  await page.route("**/api/organization/directory", (route) => {
    directoryReads += 1;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        summary: {
          departments: 1,
          activeUsers: directoryReads > 1 ? 2 : 1,
          inactiveUsers: 0,
          positions: 2
        },
        departments: [
          { id: "department-1", name: "合同部", parentId: null, isActive: true, children: [] }
        ],
        projects: [],
        positions: [
          { id: "position-1", key: "super_admin", name: "系统管理员" },
          { id: "position-2", key: "finance_staff", name: "财务员" }
        ],
        users: []
      })
    });
  });
  await page.route("**/api/organization/permission-integrity", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        policy: {
          globalWriteSource: "UserPosition(projectId=null)",
          projectWriteSource: "ProjectMember",
          legacyProjectUserPositionReadCompatibility: true,
          projectSuperAdminAllowed: false
        },
        readiness: { canonicalRoleWritesReady: true, legacyMigrationReady: true },
        summary: {
          globalAssignments: 1,
          canonicalProjectAssignments: 0,
          legacyProjectAssignments: 0,
          duplicateGlobalGroups: 0,
          dualSourceOverlaps: 0,
          invalidRoleAssignments: 0,
          orphanAssignments: 0,
          blockingIssues: 0,
          warningIssues: 0
        },
        issues: []
      })
    })
  );
  await page.route("**/api/organization/users", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    createBodies.push(body);
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "user-new",
        name: "待本人确认",
        phone: "13800000001",
        departmentId: "department-1",
        isActive: true,
        mustChangePassword: true
      })
    });
  });
  await page.route("**/api/organization/role-additions/apply", (route) => {
    roleApplyCalls += 1;
    return route.abort();
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByText("组织权限", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "组织权限" })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "新增人员" }).click();
  await page.getByPlaceholder("请输入 11 位中国大陆手机号").fill("13800000001");
  await page.getByPlaceholder("请选择启用部门").click();
  await page.locator(".t-select__dropdown:visible").getByText("合同部", { exact: true }).click();
  await page.getByPlaceholder("请选择允许授予的初始岗位").click();
  await page.locator(".t-select__dropdown:visible").getByText("财务员", { exact: true }).click();
  await page.getByRole("button", { name: "显示" }).click();
  const temporaryPasswordInput = page.getByPlaceholder("请生成临时密码");
  const temporaryPassword = await temporaryPasswordInput.inputValue();
  expect(temporaryPassword).toHaveLength(24);
  await page.getByText("我已通过线下安全渠道妥善记录临时密码", { exact: true }).click();
  await page.getByPlaceholder("请验证管理员当前密码").fill(" current-password ");
  await page.getByRole("button", { name: "确认创建人员" }).click();

  await expect(page.getByText(/人员已创建但尚未授岗/u)).toBeVisible();
  expect(directoryReads).toBeGreaterThanOrEqual(2);
  expect(roleApplyCalls).toBe(0);
  expect(createBodies).toEqual([
    {
      phone: "13800000001",
      departmentId: "department-1",
      initialRoleKey: "finance_staff",
      temporaryPassword,
      confirmationPassword: " current-password "
    }
  ]);
  expect(createBodies[0]).not.toHaveProperty("name");
  expect(createBodies[0]).not.toHaveProperty("mustChangePassword");
  await expect(temporaryPasswordInput).not.toBeVisible();
  await expect(temporaryPasswordInput).toHaveValue("");
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(
    temporaryPassword
  );
  expect(page.url()).not.toContain(temporaryPassword);
});
