import { expect, test } from "@playwright/test";

test("批量撤岗只手动预览累计阻断且切换目标清空结果", async ({ page }) => {
  const combinedSnapshotHash = `sha256:${"c".repeat(64)}`;
  const previewBodies: Array<{ targets: Array<Record<string, unknown>> }> = [];
  let applyCalls = 0;

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
  await page.route("**/api/organization/directory", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        summary: { departments: 1, activeUsers: 2, inactiveUsers: 0, positions: 3 },
        departments: [
          { id: "department-1", name: "合同部", parentId: null, isActive: true, children: [] }
        ],
        projects: [
          { id: "project-1", code: "XM-001", name: "科技园项目", isActive: true }
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
            projectPositions: [
              {
                projectId: "project-1",
                projectCode: "XM-001",
                projectName: "科技园项目",
                keys: ["project_manager"],
                names: ["项目经理"]
              }
            ]
          },
          {
            id: "user-2",
            name: "李四",
            phone: "13800000002",
            departmentId: "department-1",
            departmentName: "合同部",
            status: "active",
            mustChangePassword: false,
            globalPositions: [],
            projectPositions: [
              {
                projectId: "project-1",
                projectCode: "XM-001",
                projectName: "科技园项目",
                keys: ["project_manager", "super_admin"],
                names: ["项目经理", "系统管理员"]
              }
            ]
          }
        ]
      })
    })
  );
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
          canonicalProjectAssignments: 3,
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
  await page.route("**/api/organization/role-changes/batch-preview", async (route) => {
    const body = route.request().postDataJSON() as {
      targets: Array<Record<string, unknown>>;
    };
    previewBodies.push(body);
    const [firstTarget, secondTarget] = body.targets;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        evaluatedAt: "2026-07-12T08:00:00.000Z",
        combinedSnapshotHash,
        canApply: false,
        simulatedTargets: 2,
        blockingTarget: { ...secondTarget, projectId: secondTarget.projectId ?? null },
        steps: [
          {
            sequence: 0,
            change: { ...firstTarget, projectId: firstTarget.projectId ?? null },
            evaluatedAt: "2026-07-12T08:00:00.000Z",
            snapshotHash: `sha256:${"1".repeat(64)}`,
            canApply: true,
            summary: { affectedInstances: 1, blockingInstances: 0 },
            blockingIssues: [],
            impacts: [
              {
                approvalInstanceId: "approval-1",
                businessType: "payment_request",
                businessId: "payment-1",
                projectId: "project-1",
                currentNodeIndex: 1,
                currentNodeName: "合同审批",
                mode: "any",
                pendingRoleKeys: ["project_manager"],
                blocking: false,
                reasonCode: null,
                roleCoverage: []
              }
            ]
          },
          {
            sequence: 1,
            change: { ...secondTarget, projectId: secondTarget.projectId ?? null },
            evaluatedAt: "2026-07-12T08:00:00.000Z",
            snapshotHash: `sha256:${"2".repeat(64)}`,
            canApply: false,
            summary: { affectedInstances: 1, blockingInstances: 1 },
            blockingIssues: [],
            impacts: [
              {
                approvalInstanceId: "approval-1",
                businessType: "payment_request",
                businessId: "payment-1",
                projectId: "project-1",
                currentNodeIndex: 2,
                currentNodeName: "项目经理审批",
                mode: "any",
                pendingRoleKeys: ["project_manager"],
                blocking: true,
                reasonCode: "no_executable_current_approver",
                roleCoverage: []
              }
            ]
          }
        ]
      })
    });
  });
  await page.route("**/api/organization/role-changes/apply", (route) => {
    applyCalls += 1;
    return route.abort();
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
  await page.getByText("组织权限", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "组织权限" })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "批量预览撤岗" }).click();
  await expect(page.getByText("这里只累计模拟 2 至 20 个正常岗位的撤销影响，不会执行任何岗位变更。")).toBeVisible();
  await page.waitForTimeout(200);
  expect(previewBodies).toHaveLength(0);
  await page.getByPlaceholder("请选择跨人员、跨范围的 2 至 20 个已有岗位").click();
  const dropdown = page.locator(".t-select__dropdown:visible");
  await expect(dropdown.getByText(/李四.*系统管理员/u)).toHaveCount(0);
  await dropdown.getByText(/张三.*项目经理/u).click();
  await dropdown.getByText(/李四.*项目经理/u).click();
  await page
    .getByText("这里只累计模拟 2 至 20 个正常岗位的撤销影响，不会执行任何岗位变更。", {
      exact: true
    })
    .click();
  await page.waitForTimeout(200);
  expect(previewBodies).toHaveLength(0);

  await page.getByRole("button", { name: "生成累计影响预览" }).click();
  await expect(page.getByText("组合预览存在阻断")).toBeVisible();
  await expect(page.getByText(/首个阻断：.*李四/u)).toBeVisible();
  await expect(page.getByText("合同审批", { exact: true })).toBeVisible();
  await expect(page.getByText("项目经理审批", { exact: true })).toBeVisible();
  await expect(page.getByText(combinedSnapshotHash)).toBeVisible();
  await expect(page.locator('input[placeholder="请输入当前登录密码"]:visible')).toHaveCount(0);
  expect(previewBodies).toEqual([
    {
      targets: [
        {
          operation: "remove",
          userId: "user-1",
          scope: "project",
          projectId: "project-1",
          roleKey: "project_manager"
        },
        {
          operation: "remove",
          userId: "user-2",
          scope: "project",
          projectId: "project-1",
          roleKey: "project_manager"
        }
      ]
    }
  ]);

  await page.locator(".batch-drawer .t-select").click();
  await page.locator(".t-select__dropdown:visible").getByText(/张三.*合同部主管/u).click();
  await page
    .getByText("这里只累计模拟 2 至 20 个正常岗位的撤销影响，不会执行任何岗位变更。", {
      exact: true
    })
    .click();
  await expect(page.getByText("组合预览存在阻断")).toHaveCount(0);
  await page.waitForTimeout(200);
  expect(previewBodies).toHaveLength(1);
  expect(applyCalls).toBe(0);
});
