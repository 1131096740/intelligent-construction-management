import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  expectHorizontalScrollOwner,
  expectNoDocumentHorizontalOverflow,
  expectNoNestedHorizontalScrollers
} from "./helpers/responsive-assertions";

const viewports = [
  { width: 1512, height: 982 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1180, height: 820 },
  { width: 1024, height: 768 },
  { width: 900, height: 768 }
] as const;

test.setTimeout(60_000);

async function mockSession(page: Page) {
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: "admin-responsive",
        name: "系统管理员",
        phone: "13900000000",
        mustChangePassword: false,
        roleKeys: ["super_admin"],
        globalRoleKeys: ["super_admin"]
      },
      tokens: { accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 900 }
    })
  }));
  await page.route("**/api/me/work-items", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      generatedAt: "2026-07-14T08:00:00.000Z",
      visibleProjectCount: 1,
      queues: { pending: [], blocked: [], started: [] },
      approvalCenter: {
        pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: []
      }
    })
  }));
  await page.route("**/api/business-parties*", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([{
      id: "party-responsive",
      name: "城建物资公司",
      unifiedSocialCreditCode: "91530000RESPONSIVE",
      createdAt: "2026-07-14 16:00"
    }])
  }));
  await page.route("**/api/projects/roster", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([{
      projectId: "project-responsive",
      projectCode: "XM-001",
      projectName: "科技园项目",
      userId: "contract-responsive",
      name: "合同经办人",
      phone: "13800000001",
      positionNames: ["合同员"],
      globalPositionNames: [],
      projectPositionNames: ["合同员"]
    }])
  }));
  await page.route("**/api/organization/directory", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      summary: { departments: 1, activeUsers: 1, inactiveUsers: 0, positions: 3 },
      departments: [{ id: "department-responsive", name: "合同部", parentId: null, isActive: true, children: [] }],
      positions: [
        { id: "position-admin", key: "super_admin", name: "系统管理员" },
        { id: "position-director", key: "contract_director", name: "合同部主管" },
        { id: "position-staff", key: "contract_staff", name: "合同员" }
      ],
      projects: [{ id: "project-responsive", code: "XM-001", name: "科技园项目", isActive: true }],
      users: [{
        id: "contract-responsive",
        name: "合同经办人",
        phone: "13800000001",
        departmentId: "department-responsive",
        departmentName: "合同部",
        status: "active",
        mustChangePassword: false,
        globalPositions: [{ key: "contract_director", name: "合同部主管" }],
        projectPositions: [{
          projectId: "project-responsive",
          projectCode: "XM-001",
          projectName: "科技园项目",
          keys: ["contract_staff"],
          names: ["合同员"]
        }]
      }]
    })
  }));
  await page.route("**/api/organization/permission-integrity", (route) => route.fulfill({
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
  }));
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
}

async function expectDrawerSettled(page: Page) {
  const drawer = page.locator(".t-drawer__content-wrapper:visible").last();
  await expect(drawer).toBeVisible();
  await expect.poll(async () => drawer.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return Math.abs(rect.right - window.innerWidth) <= 1 && rect.left >= 0;
  })).toBe(true);
}

test("主数据台账和组织权限在六档桌面窗口中保持局部滚动", async ({ page }, testInfo) => {
  await mockSession(page);
  await login(page);
  const screenshotDir = process.env.UI_RESPONSIVE_SCREENSHOT_DIR ?? testInfo.outputDir;
  const pages = [
    { path: "/合作单位档案", heading: "合作单位档案", slug: "business-parties", scrollAt: 1180 },
    { path: "/项目花名册", heading: "项目花名册", slug: "project-roster", scrollAt: 1280 },
    { path: "/组织权限", heading: "组织权限", slug: "organization", scrollAt: 1280 }
  ] as const;

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const target of pages) {
      await page.goto(target.path);
      await expect(page.getByRole("heading", { name: target.heading })).toBeVisible();
      await expectNoDocumentHorizontalOverflow(page);
      await expectNoNestedHorizontalScrollers(page);
      if (viewport.width <= target.scrollAt) {
        await expectHorizontalScrollOwner(page.locator(".jg-table-region .t-table__content").first());
      }
      await page.screenshot({
        path: path.join(screenshotDir, `${target.slug}-${viewport.width}x${viewport.height}.png`),
        fullPage: true
      });
    }
  }

  await page.setViewportSize({ width: 900, height: 768 });
  await page.goto("/组织权限");
  await page.getByRole("button", { name: "新增人员" }).click();
  await expect(page.getByText("一次性临时密码", { exact: true })).toBeVisible();
  await expectDrawerSettled(page);
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
  await page.screenshot({ path: path.join(screenshotDir, "organization-user-drawer-900x768.png"), fullPage: true });
  await page.locator(".t-drawer__close-btn:visible").click();
  await expect(page.getByText("一次性临时密码", { exact: true })).toBeHidden();

  await page.getByRole("button", { name: "岗位管理" }).click();
  await expect(page.getByRole("heading", { name: "已有岗位" })).toBeVisible();
  await expectDrawerSettled(page);
  await expectHorizontalScrollOwner(page.locator(".t-drawer .jg-table-region .t-table__content").first());
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
  await page.screenshot({ path: path.join(screenshotDir, "organization-role-drawer-900x768.png"), fullPage: true });
});
