import { expect, test } from "@playwright/test";

test("岗位撤销先展示阻断，放行后原样提交影响版本校验码和密码", async ({ page }) => {
  const snapshotHash = `sha256:${"a".repeat(64)}`;
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
        summary: { departments: 1, activeUsers: 1, inactiveUsers: 0, positions: 2 },
        departments: [
          { id: "department-1", name: "合同部", parentId: null, isActive: true, children: [] }
        ],
        positions: [
          { id: "position-1", key: "contract_director", name: "合同部主管" },
          { id: "position-2", key: "project_manager", name: "项目经理" }
        ],
        projects: [
          { id: "project-1", code: "XM-001", name: "科技园项目", isActive: true }
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
            projectPositions: [
              {
                projectId: "project-1",
                projectCode: "XM-001",
                projectName: "科技园项目",
                keys: ["project_manager"],
                names: ["项目经理"]
              }
            ]
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
          canonicalProjectAssignments: 1,
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
  await page.route("**/api/organization/role-changes/preview", async (route) => {
    const body = route.request().postDataJSON();
    previewBodies.push(body);
    const projectRemoval = body.scope === "project";
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        change: {
          ...body,
          projectId: projectRemoval ? body.projectId : null
        },
        evaluatedAt: "2026-07-12T08:00:00.000Z",
        snapshotHash,
        canApply: projectRemoval,
        summary: { affectedInstances: projectRemoval ? 1 : 0, blockingInstances: projectRemoval ? 0 : 1 },
        blockingIssues: projectRemoval
          ? []
          : [{ code: "last_active_global_super_admin", message: "当前岗位暂不能安全撤销" }],
        impacts: []
      })
    });
  });
  await page.route("**/api/organization/role-changes/apply", async (route) => {
    applyBody = route.request().postDataJSON();
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        change: { operation: "remove", userId: "user-1", scope: "project", projectId: "project-1", roleKey: "project_manager" },
        assignmentId: "member-1",
        source: "project_member",
        affectedInstances: 1,
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

  await page.getByRole("button", { name: "岗位管理" }).click();
  const globalRow = page.getByRole("row").filter({ hasText: "合同部主管" });
  await globalRow.getByRole("button", { name: "预览撤销影响" }).click();
  await expect(page.getByText("服务端判定不可撤销")).toBeVisible();
  await expect(page.locator('input[placeholder="请输入当前登录密码"]:visible')).toHaveCount(0);

  const projectRow = page.getByRole("row").filter({ hasText: "项目经理" });
  await projectRow.getByRole("button", { name: "预览撤销影响" }).click();
  await expect(page.getByText("服务端判定可撤销")).toBeVisible();
  const passwordInput = page.locator('input[placeholder="请输入当前登录密码"]:visible');
  await passwordInput.scrollIntoViewIfNeeded();
  await passwordInput.fill("  current password  ");
  await page.getByRole("button", { name: "确认撤销该岗位" }).click();
  await expect(page.getByText("岗位已撤销，组织目录和岗位数据预检已刷新。")).toBeVisible();

  expect(previewBodies).toEqual([
    { operation: "remove", userId: "user-1", scope: "global", roleKey: "contract_director" },
    {
      operation: "remove",
      userId: "user-1",
      scope: "project",
      projectId: "project-1",
      roleKey: "project_manager"
    }
  ]);
  expect(JSON.stringify(previewBodies)).not.toContain("password");
  expect(JSON.stringify(previewBodies)).not.toContain("snapshotHash");
  expect(applyBody).toEqual({
    operation: "remove",
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
