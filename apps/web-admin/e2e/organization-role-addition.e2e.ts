import { expect, test } from "@playwright/test";

test("岗位新增手动预览后原样提交快照与密码并双刷新", async ({ page }) => {
  const snapshotHash = `sha256:${"c".repeat(64)}`;
  const previewBodies: unknown[] = [];
  let applyBody: unknown = null;
  let directoryReads = 0;
  let integrityReads = 0;

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
        summary: { departments: 1, activeUsers: 1, inactiveUsers: 0, positions: 3 },
        departments: [
          { id: "department-1", name: "合同部", parentId: null, isActive: true, children: [] }
        ],
        projects: [
          { id: "project-1", code: "XM-001", name: "科技园项目", isActive: true },
          { id: "project-2", code: "XM-002", name: "停用项目", isActive: false }
        ],
        positions: [
          { id: "position-1", key: "contract_director", name: "合同部主管" },
          { id: "position-2", key: "project_manager", name: "项目经理" },
          { id: "position-3", key: "super_admin", name: "系统管理员" }
        ],
        users: [
          {
            id: "user-1",
            name: "张三",
            phone: "13800000001",
            departmentId: "department-1",
            departmentName: "合同部",
            status: "active",
            mustChangePassword: false,
            globalPositions: [{ key: "contract_director", name: "合同部主管" }],
            projectPositions: []
          }
        ]
      })
    });
  });
  await page.route("**/api/organization/permission-integrity", (route) => {
    integrityReads += 1;
    return route.fulfill({
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
    });
  });
  await page.route("**/api/organization/role-additions/preview", async (route) => {
    const body = route.request().postDataJSON();
    previewBodies.push(body);
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        change: { ...body, projectId: body.projectId ?? null },
        evaluatedAt: "2026-07-12T08:00:00.000Z",
        snapshotHash,
        canApply: true,
        summary: { affectedNodes: 0, blockingNodes: 0 },
        blockingIssues: [],
        impacts: []
      })
    });
  });
  await page.route("**/api/organization/role-additions/apply", async (route) => {
    applyBody = route.request().postDataJSON();
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        change: {
          operation: "add",
          userId: "user-1",
          scope: "project",
          projectId: "project-1",
          roleKey: "project_manager"
        },
        assignmentId: "member-1",
        source: "project_member",
        affectedNodes: 0,
        revokedRefreshTokens: 1
      })
    });
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
  await page.getByText("组织权限", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "组织权限" })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "新增岗位" }).click();
  const scopeSelect = page.getByPlaceholder("请选择岗位范围").last();
  await expect(scopeSelect).toBeVisible();
  await scopeSelect.click();
  await page.locator(".t-select__dropdown:visible").getByText("项目岗位", { exact: true }).click();
  await page.getByPlaceholder("请选择启用项目").last().click();
  const projectDropdown = page.locator(".t-select__dropdown:visible");
  await expect(projectDropdown.getByText("停用项目", { exact: false })).toHaveCount(0);
  await projectDropdown.getByText("科技园项目（XM-001）", { exact: true }).click();
  await page.getByPlaceholder("请选择待新增岗位").last().click();
  const roleDropdown = page.locator(".t-select__dropdown:visible");
  await expect(roleDropdown.getByText("系统管理员", { exact: true })).toHaveCount(0);
  await roleDropdown.getByText("项目经理", { exact: true }).click();

  await page.waitForTimeout(300);
  expect(previewBodies).toHaveLength(0);
  await page.getByRole("button", { name: "预览新增影响" }).click();
  await expect(page.getByText("服务端判定可新增")).toBeVisible();
  const passwordInput = page.getByPlaceholder("请输入当前登录密码");
  await passwordInput.fill("  current password  ");
  await page.getByRole("button", { name: "确认新增该岗位" }).click();
  await expect(page.getByText("岗位已新增，组织目录和岗位数据预检已刷新。")).toBeVisible();

  expect(previewBodies).toEqual([
    {
      operation: "add",
      userId: "user-1",
      scope: "project",
      projectId: "project-1",
      roleKey: "project_manager"
    }
  ]);
  expect(JSON.stringify(previewBodies)).not.toContain("password");
  expect(JSON.stringify(previewBodies)).not.toContain("snapshotHash");
  expect(applyBody).toEqual({
    operation: "add",
    userId: "user-1",
    scope: "project",
    projectId: "project-1",
    roleKey: "project_manager",
    snapshotHash,
    confirmationPassword: "  current password  "
  });
  expect(directoryReads).toBeGreaterThanOrEqual(2);
  expect(integrityReads).toBeGreaterThanOrEqual(2);
});
