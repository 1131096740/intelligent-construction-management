import { expect, test, type Page } from "@playwright/test";
import { expectNoDocumentHorizontalOverflow } from "./helpers/responsive-assertions";

async function managerSession(page: Page) {
  await page.addInitScript(() => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify({
    accessToken: "synthetic-manager-access", refreshToken: "synthetic-manager-refresh",
    user: { id: "manager", name: "合成董事长", phone: "13910000000", mustChangePassword: false,
      roleKeys: ["chairman"], globalRoleKeys: ["chairman"] }
  })));
  await page.route((url) => url.pathname.startsWith("/api/"), (route) => route.fulfill({ json: {} }));
  await page.route("**/api/me/work-items**", (route) => route.fulfill({ json: { generatedAt: new Date().toISOString(), visibleProjectCount: 0,
    queues: { pending: [], blocked: [], started: [] }, approvalCenter: { pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: [] } } }));
}

async function rosterFixture(page: Page) {
  await managerSession(page);
  const state = { joined: false, optionsReads: 0, applies: 0, failProjectRefresh: false };
  const project = { id: "project", code: "XM-SYNTHETIC", name: "合成人事项目", isActive: true };
  const person = { id: "staff", name: "合成员工", phone: "13910000001", canManage: true };
  const options = { canManageRoster: true, projects: [project], users: [person] };
  await page.route("**/api/projects", (route) => state.failProjectRefresh
    ? route.fulfill({ status: 503, json: { message: "项目列表暂不可用" } })
    : route.fulfill({ json: [project] }));
  await page.route("**/api/projects/roster", (route) => route.fulfill({ json: state.joined ? [{
    projectId: project.id, projectCode: project.code, projectName: project.name,
    userId: person.id, name: person.name, phone: person.phone, globalPositionNames: [], projectPositionNames: []
  }] : [] }));
  await page.route("**/api/organization/project-roster/options", (route) => {
    state.optionsReads += 1;
    return route.fulfill({ json: options });
  });
  await page.route("**/api/organization/project-roster/preview", (route) => route.fulfill({ json: {
    ...route.request().postDataJSON(), projectName: project.name, personName: person.name,
    snapshotHash: "sha256:synthetic-preview", canApply: true, blockingReasons: [], projectRoleKeys: [], projectRoleNames: [],
    affectedApprovals: 0, retainsGlobalAccess: false
  } }));
  await page.goto("/项目花名册");
  await page.getByPlaceholder("全部可见项目").click();
  await page.locator(".t-select__dropdown:visible .t-select-option").filter({ hasText: project.name }).click();
  await page.getByRole("button", { name: "调入人员", exact: true }).click();
  const drawer = page.locator(".t-drawer__content-wrapper");
  await drawer.locator('[data-field="userId"]').click();
  await page.locator(".t-select__dropdown:visible .t-select-option").filter({ hasText: person.phone }).click();
  await drawer.locator('[data-field="reason"] input').fill("合成人员安排");
  await drawer.getByRole("button", { name: "预览调整", exact: true }).click();
  await drawer.getByPlaceholder("请输入本人当前登录密码").fill("Synthetic-Current-Only-01");
  return { state, drawer, options };
}

test("停用无部门人员只提交启停变更，保留未分配部门事实", async ({ page }) => {
  await managerSession(page);
  const writes: unknown[] = [];
  const user = { id: "staff", name: "合成未分配员工", phone: "13910000001", departmentId: null,
    departmentName: "未分配部门", status: "active", mustChangePassword: false, globalPositions: [], projectPositions: [] };
  await page.route("**/api/organization/management-capabilities", (route) => route.fulfill({ json: {
    canManageUsers: true, canManageRoles: false, canCreateUser: false, canManageDepartments: false,
    manageableUserIds: [user.id], manageableRoleKeys: [], manageableDepartmentIds: ["department"]
  } }));
  await page.route("**/api/organization/directory", (route) => route.fulfill({ json: {
    summary: { departments: 1, activeUsers: user.status === "active" ? 1 : 0, inactiveUsers: user.status === "inactive" ? 1 : 0, positions: 0 },
    users: [user], departments: [{ id: "department", name: "合成综合部", parentId: null, isActive: true, children: [] }], projects: [], positions: []
  } }));
  await page.route("**/api/organization/users/staff/employment", (route) => route.fulfill({ json: { periods: [], changes: [] } }));
  await page.route("**/api/organization/users/staff", (route) => {
    const body = route.request().postDataJSON();
    writes.push(body);
    user.status = "inactive";
    return route.fulfill({ json: { id: user.id, departmentId: null, isActive: false } });
  });
  await page.goto("/组织权限");
  await page.getByRole("button", { name: "部门 / 停用", exact: true }).click();
  const drawer = page.locator(".t-drawer__content-wrapper");
  await drawer.locator('[data-field="isActive"]').click();
  await page.locator(".t-select__dropdown:visible .t-select-option").getByText("否", { exact: true }).click();
  await drawer.locator('input[type="password"]').fill("Synthetic-Current-Only-01");
  await drawer.getByRole("button", { name: "保存调整", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes).toEqual([{ isActive: false, confirmationPassword: "Synthetic-Current-Only-01" }]);
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重新启用", exact: true })).toBeVisible();
  await expect(page.getByText("未分配部门", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重新启用", exact: true }).click();
  await drawer.locator('[data-field="isActive"]').click();
  await page.locator(".t-select__dropdown:visible .t-select-option").getByText("是", { exact: true }).click();
  await drawer.locator('input[type="password"]').fill("Synthetic-Current-Only-01");
  await drawer.getByRole("button", { name: "保存调整", exact: true }).click();
  await expect(drawer.getByText("请选择可管理的启用部门", { exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
  await drawer.getByRole("button", { name: "取消", exact: true }).click();
  await expectNoDocumentHorizontalOverflow(page);
});

test("确认前的权限读取可取消，迟到响应不得发出人员调整", async ({ page }) => {
  const { state, drawer, options } = await rosterFixture(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let capabilityStarted = false;
  await page.route("**/api/organization/project-roster/options", async (route) => {
    capabilityStarted = true;
    await gate;
    await route.fulfill({ json: options }).catch(() => { /* 页面关闭不覆盖原断言。 */ });
  });
  await page.route("**/api/organization/project-roster/apply", (route) => {
    state.applies += 1;
    return route.fulfill({ json: { projectId: "project", userId: "staff", operation: "join", commandKey: route.request().postDataJSON().commandKey } });
  });
  await drawer.getByRole("button", { name: "确认调入项目", exact: true }).click();
  await expect.poll(() => capabilityStarted).toBe(true);
  await drawer.getByRole("button", { name: "取消", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  release();
  await expect(page.getByRole("button", { name: "调入人员", exact: true })).toBeEnabled();
  expect(state.applies).toBe(0);
});

test("人员调整回包不可读时按原办理编号查询，查到结果前不重发写入", async ({ page }) => {
  const { state, drawer } = await rosterFixture(page);
  let originalKey = ""; const queries: string[] = [];
  await page.route("**/api/organization/project-roster/apply", (route) => {
    state.applies += 1; state.joined = true; originalKey = route.request().postDataJSON().commandKey;
    return route.fulfill({ status: 201, contentType: "application/json", body: "{" });
  });
  await page.route("**/api/organization/personnel-changes/results/*", (route) => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1)!); queries.push(key);
    return route.fulfill({ json: queries.length === 1 ? { found: false, message: "尚未查到办理回执，结果仍待核实" }
      : { commandKey: key, userId: "staff", action: "project_join" } });
  });
  await drawer.getByRole("button", { name: "确认调入项目", exact: true }).click();
  await expect(drawer.getByText(/调整结果尚未确认/)).toBeVisible();
  await expect(drawer.getByRole("button", { name: "确认调入项目", exact: true })).toHaveCount(0);
  await drawer.getByRole("button", { name: "核对办理结果", exact: true }).click();
  await expect(drawer.getByText(/尚未查到办理回执/)).toBeVisible();
  expect(state.applies).toBe(1);
  expect(originalKey).toMatch(/^[a-f0-9-]{36}$/);
  await expect(drawer.locator('[data-field="reason"] input')).toHaveValue("合成人员安排");
  await drawer.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "继续核对人员调整", exact: true }).click();
  await drawer.getByRole("button", { name: "核对办理结果", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  expect(queries).toEqual([originalKey, originalKey]);
  expect(state.applies).toBe(1);
  await expectNoDocumentHorizontalOverflow(page);
});

test("已保存与刷新项目失败分别反馈，并采用成功读回的人员名单", async ({ page }) => {
  const { state, drawer } = await rosterFixture(page);
  await page.route("**/api/organization/project-roster/apply", (route) => {
    state.applies += 1;
    state.joined = true;
    state.failProjectRefresh = true;
    return route.fulfill({ status: 201, json: { projectId: "project", userId: "staff", operation: "join", commandKey: route.request().postDataJSON().commandKey } });
  });
  await drawer.getByRole("button", { name: "确认调入项目", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByText("人员调整已保存", { exact: true })).toBeVisible();
  await expect(page.locator("tr, article.employee-card, article.application-card, article.roster-card").filter({ hasText: "13910000001" })).toHaveCount(1);
  await expect(page.getByText(/读取项目列表失败/)).toBeVisible();
  expect(state.applies).toBe(1);
});

test("确定拒绝保留调整原因并清空密码，仍须重新预览", async ({ page }) => {
  const { state, drawer } = await rosterFixture(page);
  await page.route("**/api/organization/project-roster/apply", (route) => {
    state.applies += 1;
    return route.fulfill({ status: 409, json: { message: "人员、项目或待办已经变化，请重新预览后提交" } });
  });
  await drawer.getByRole("button", { name: "确认调入项目", exact: true }).click();
  await expect(drawer.getByText("人员、项目或待办已经变化，请重新预览后提交", { exact: true })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "核对最新名单", exact: true })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "确认调入项目", exact: true })).toHaveCount(0);
  await expect(drawer.locator('[data-field="reason"] input')).toHaveValue("合成人员安排");
  await drawer.getByRole("button", { name: "预览调整", exact: true }).click();
  await expect(drawer.getByPlaceholder("请输入本人当前登录密码")).toHaveValue("");
  expect(state.applies).toBe(1);
});

test("已发出的写入等待中不能取消，成功后抽屉可再次办理", async ({ page }) => {
  const { state, drawer } = await rosterFixture(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/organization/project-roster/apply", async (route) => {
    state.applies += 1;
    await gate;
    state.joined = true;
    await route.fulfill({ json: { projectId: "project", userId: "staff", operation: "join", commandKey: route.request().postDataJSON().commandKey } });
  });
  await drawer.getByRole("button", { name: "确认调入项目", exact: true }).click();
  try {
    await expect.poll(() => state.applies).toBe(1);
    await expect(drawer.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
    await expect(drawer.getByText(/关闭页面不代表撤销已发出的调整/)).toBeVisible();
  } finally { release(); }
  await expect(drawer).toHaveCount(0);
  await page.locator("tr, article.employee-card, article.application-card, article.roster-card").filter({ hasText: "13910000001" }).getByRole("button", { name: "调出项目", exact: true }).click();
  await drawer.locator('[data-field="reason"] input').fill("合成调出");
  await drawer.getByRole("button", { name: "预览调整", exact: true }).click();
  await expect(drawer.getByPlaceholder("请输入本人当前登录密码")).toHaveValue("");
  expect(state.applies).toBe(1);
});

test("入职审核明确选择项目财务岗位，不提交全公司财务授权", async ({ page }) => {
  await managerSession(page);
  const reviews: Array<Record<string, unknown>> = [];
  await page.route("**/api/organization/management-capabilities", (route) => route.fulfill({ json: {
    canManageUsers: true, canManageRoles: true, canCreateUser: true, canManageDepartments: false,
    canReviewApplications: true, canApproveImportantEmployees: true, importantEmployeeRoleKeys: ["finance_staff"],
    manageableUserIds: [], manageableRoleKeys: ["finance_staff"], manageableDepartmentIds: ["department"]
  } }));
  await page.route("**/api/organization/directory", (route) => route.fulfill({ json: {
    summary: { departments: 1, activeUsers: 0, inactiveUsers: 0, positions: 1 }, users: [],
    departments: [{ id: "department", name: "合成综合部", parentId: null, isActive: true, children: [] }],
    projects: [{ id: "project", code: "XM-SYNTHETIC", name: "合成人事项目", isActive: true }],
    positions: [{ id: "finance", key: "finance_staff", name: "财务经办" }]
  } }));
  await page.route("**/api/employee-onboarding/applications", (route) => route.fulfill({ json: {
    pendingCount: reviews.length ? 0 : 1, applications: reviews.length ? [] : [{
      id: "application", name: "合成待审员工", phone: "13910000003", status: "pending", revision: 1,
      reason: "", phoneVerified: true, mustChangePassword: false, createdAt: "2026-10-23T00:00:00.000Z"
    }]
  } }));
  await page.route("**/api/employee-onboarding/applications/application/review", (route) => {
    reviews.push(route.request().postDataJSON());
    return route.fulfill({ json: { status: "approved", revision: 2 } });
  });
  await page.goto("/组织权限");
  await page.getByRole("button", { name: "审核申请", exact: true }).click();
  const drawer = page.locator(".t-drawer__content-wrapper");
  for (const [field, label] of [["departmentId", "合成综合部"], ["initialRoleKey", "财务经办"],
    ["initialRoleScope", "指定项目岗位"], ["projectId", "合成人事项目"]]) {
    await drawer.locator(`[data-field="${field}"]`).click();
    await page.locator(".t-select__dropdown:visible .t-select-option").filter({ hasText: label }).click();
  }
  await drawer.getByText("我已核对员工本人及手机号", { exact: true }).click();
  await drawer.getByPlaceholder("请输入本人当前登录密码").fill("Synthetic-Current-Only-01");
  await drawer.getByRole("button", { name: "批准开通", exact: true }).click();
  await expect.poll(() => reviews.length).toBe(1);
  expect(reviews[0]?.roles).toEqual([{ roleKey: "finance_staff", scope: "project", projectId: "project" }]);
  await expect(drawer).toHaveCount(0);
});

test("普通员工统一入口只读原有项目范围，不请求全公司人员目录", async ({ page }) => {
  await managerSession(page);
  await page.addInitScript(() => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify({
    accessToken: "synthetic-employee-access", refreshToken: "synthetic-employee-refresh",
    user: { id: "employee", name: "合成普通员工", phone: "13910000004", mustChangePassword: false,
      roleKeys: ["employee"], globalRoleKeys: [] }
  })));
  const directoryRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/organization\/(directory|management-capabilities)/.test(new URL(request.url()).pathname)) directoryRequests.push(request.url());
  });
  await page.route("**/api/projects", (route) => route.fulfill({ json: [{ id: "project", code: "XM-SYNTHETIC", name: "原授权项目" }] }));
  await page.route("**/api/projects/roster", (route) => route.fulfill({ json: [{
    projectId: "project", projectCode: "XM-SYNTHETIC", projectName: "原授权项目", userId: "employee", name: "合成普通员工",
    phone: "13910000004", globalPositionNames: [], projectPositionNames: ["普通员工"]
  }] }));
  await page.goto("/员工管理");
  await expect(page.getByRole("heading", { name: "员工管理", exact: true })).toBeVisible();
  await expect(page.getByText("原授权项目", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "新增人员和账号", exact: true })).toHaveCount(0);
  expect(directoryRequests).toEqual([]);
  await expectNoDocumentHorizontalOverflow(page);
});

async function personnelFixture(page: Page, periods: Array<Record<string, unknown>> = [], status: "active" | "inactive" = "active", companyFailure: boolean | "hang" = false) {
  await managerSession(page);
  const person = { id: "staff", name: "合成人事员工", phone: "13910000005", departmentId: "department", departmentName: "合成综合部",
    status, mustChangePassword: false, globalPositions: [], projectPositions: [], rosterProjects: [] };
  const state = { failRefresh: false, previews: [] as Array<Record<string, unknown>>, applies: [] as Array<Record<string, unknown>>, queries: [] as string[], releaseCompany: () => {} };
  await page.route("**/api/organization/directory", (route) => state.failRefresh
    ? route.fulfill({ status: 503, json: { message: "目录读取暂不可用" } })
    : route.fulfill({ json: { summary: { departments: 1, activeUsers: 1, inactiveUsers: 0, positions: 1 }, users: [person],
      departments: [{ id: "department", name: "合成综合部", parentId: null, isActive: true, children: [] },
        { id: "second-department", name: "合成调动部门", parentId: null, isActive: true, children: [] }],
      projects: [{ id: "project", code: "XM-SYNTHETIC", name: "合成人事项目", isActive: true },
        { id: "old-project", code: "XM-OLD-SYNTHETIC", name: "合成原项目", isActive: true }],
      positions: [{ id: "finance", key: "finance_staff", name: "财务经办" }] } }));
  await page.route("**/api/organization/management-capabilities", (route) => route.fulfill({ json: {
    canManageUsers: true, canManageRoles: true, canCreateUser: false, canManageDepartments: false,
    manageableUserIds: [person.id], manageableRoleUserIds: [person.id], manageableRoleKeys: ["finance_staff"], manageableDepartmentIds: ["department", "second-department"]
  } }));
  const companyGate = new Promise<void>((resolve) => { state.releaseCompany = resolve; });
  await page.route("**/api/company-entities", async (route) => {
    if (companyFailure === "hang") await companyGate;
    if (companyFailure === true) return route.fulfill({ status: 503, json: { message: "公司选项暂不可用" } });
    return route.fulfill({ json: [{ id: "known-company", name: "合成用工公司", isActive: true }] }).catch(() => { /* late optional read after close */ });
  });
  await page.route("**/api/organization/users/staff/employment", (route) => route.fulfill({ json: { periods, changes: [] } }));
  await page.route("**/api/organization/personnel-changes/preview", (route) => {
    const body = route.request().postDataJSON(); state.previews.push(body);
    return route.fulfill({ json: { userId: person.id, personName: person.name, action: body.action,
      snapshotHash: `sha256:preview-${state.previews.length}`, canApply: true, blockingReasons: [] } });
  });
  await page.goto("/员工管理");
  await page.locator("tr, article.employee-card, article.application-card, article.roster-card").filter({ hasText: person.phone }).getByRole("button", { name: "员工详情", exact: true }).click();
  return { drawer: page.locator(".t-drawer__content-wrapper"), state };
}

test("员工详情保留未知任职，编辑预览内容后必须重新预览", async ({ page }) => {
  const { drawer, state } = await personnelFixture(page);
  await expect(drawer.getByText("任职状态待核实", { exact: true })).toBeVisible();
  await expect(drawer.getByText("已离职", { exact: true })).toHaveCount(0);
  await drawer.getByRole("button", { name: "核实入职", exact: true }).click();
  await drawer.getByLabel("核实入职日期").fill("2026-10-01");
  await drawer.getByLabel("办理原因").fill("核对合成档案");
  await drawer.getByRole("button", { name: "预览办理影响", exact: true }).click();
  await drawer.getByPlaceholder("请输入本人当前登录密码").fill("Synthetic-Current-Only-01");
  await drawer.getByLabel("办理原因").fill("核对合成档案及本人");
  await expect(drawer.getByRole("button", { name: "确认办理", exact: true })).toHaveCount(0);
  expect(state.applies).toHaveLength(0);
  await drawer.getByRole("button", { name: "预览办理影响", exact: true }).click();
  await expect(drawer.getByPlaceholder("请输入本人当前登录密码")).toHaveValue("");
  expect(state.previews).toHaveLength(2);
  expect(state.previews[1]?.reason).toBe("核对合成档案及本人");
  expect(state.previews[1]?.commandKey).not.toBe(state.previews[0]?.commandKey);
});

test("人事办理结果未知时只核对同一编号，已保存先关闭并独立报告刷新失败", async ({ page }) => {
  const { drawer, state } = await personnelFixture(page, [{ id: "period", startedOn: "2026-10-01", endedOn: null, endedAt: null, verified: true, companyEntityId: null, revision: 1 }]);
  await page.route("**/api/organization/personnel-changes/apply", (route) => {
    state.applies.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, contentType: "application/json", body: "{" });
  });
  await page.route("**/api/organization/personnel-changes/results/*", (route) => {
    const key = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1)!);
    state.queries.push(key);
    if (state.queries.length === 1) return route.fulfill({ json: { found: false, message: "尚未查到办理回执，结果仍待核实" } });
    state.failRefresh = true;
    return route.fulfill({ json: { commandKey: key, userId: "staff", action: "offboard" } });
  });
  await drawer.getByRole("button", { name: "办理离职", exact: true }).click();
  await drawer.getByLabel("办理原因").fill("合成离职交接已核实");
  await drawer.getByRole("button", { name: "预览办理影响", exact: true }).click();
  await drawer.getByPlaceholder("请输入本人当前登录密码").fill("Synthetic-Current-Only-01");
  await drawer.getByRole("button", { name: "确认办理", exact: true }).click();
  await expect(drawer.getByText(/办理结果尚未确认/)).toBeVisible();
  await drawer.getByRole("button", { name: "核对办理结果", exact: true }).click();
  await expect(drawer.getByText(/尚未查到办理回执/)).toBeVisible();
  await drawer.getByRole("button", { name: "关闭并保留待核实办理", exact: true }).click();
  await page.locator("tr, article.employee-card, article.application-card, article.roster-card").filter({ hasText: "13910000005" }).getByRole("button", { name: "员工详情", exact: true }).click();
  await drawer.getByRole("button", { name: "核对办理结果", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByText("人事办理已保存", { exact: true })).toBeVisible();
  await expect(page.getByText("目录读取暂不可用", { exact: true })).toBeVisible();
  expect(state.applies).toHaveLength(1);
  expect(state.queries).toEqual([state.applies[0]?.commandKey, state.applies[0]?.commandKey]);
  await expectNoDocumentHorizontalOverflow(page);
});


test("返聘后的待核实在职段可补日期并保留已有公司，停用在职员工仍可核对离职", async ({ page }) => {
  const periods = [
    { id: "past", startedOn: "2025-01-01", endedOn: "2025-06-01", endedAt: "2025-06-01T00:00:00Z", verified: true, companyEntityId: null, revision: 1 },
    { id: "current", startedOn: null, endedOn: null, endedAt: null, verified: false, companyEntityId: "known-company", revision: 1 }
  ];
  const { drawer, state } = await personnelFixture(page, periods);
  await expect(drawer.getByText("在职 · 入职资料待核实", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "核实入职", exact: true }).click();
  await drawer.getByLabel("核实入职日期").fill("2026-10-01");
  await drawer.getByLabel("办理原因").fill("仅补核实入职日期");
  await drawer.getByRole("button", { name: "预览办理影响", exact: true }).click();
  await expect(drawer.getByRole("button", { name: "确认办理", exact: true })).toBeVisible();
  expect(state.previews[0]?.action).toBe("join");
  expect(state.previews[0]).not.toHaveProperty("companyEntityId");
  await drawer.getByRole("button", { name: "关闭", exact: true }).click();
  await page.reload();
  await personnelFixture(page, periods, "inactive");
  await expect(drawer.getByRole("button", { name: "核实入职", exact: true })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "办理离职", exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "办理离职", exact: true }).click();
  await drawer.getByLabel("办理原因").fill("账号已停用，核实离职交接");
  await drawer.getByRole("button", { name: "预览办理影响", exact: true }).click();
  await expect(drawer.getByRole("button", { name: "确认办理", exact: true })).toBeVisible();
});

test("已离职员工的账号恢复入口转向返聘，不把账号启停当任职状态", async ({ page }) => {
  const { drawer } = await personnelFixture(page, [{ id: "past", startedOn: "2025-01-01", endedOn: "2025-06-01", endedAt: "2025-06-01T00:00:00Z", verified: true, companyEntityId: null, revision: 1 }], "inactive");
  await expect(drawer.getByText("已离职", { exact: true })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "办理离职", exact: true })).toHaveCount(0);
  await drawer.getByRole("button", { name: "关闭", exact: true }).click();
  await page.locator("tr, article.employee-card, article.application-card, article.roster-card").filter({ hasText: "13910000005" }).getByRole("button", { name: "重新启用", exact: true }).click();
  await expect(drawer.getByRole("button", { name: "返聘", exact: true })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "保存调整", exact: true })).toHaveCount(0);
  await drawer.getByRole("button", { name: "返聘", exact: true }).click();
  await expect(drawer.getByText(/返聘的岗位和项目须重新安排/)).toBeVisible();
  await expectNoDocumentHorizontalOverflow(page);
});

test("调入POST挂起转为未知，刷新后保留原编号并且只查询回执", async ({ page }) => {
  const { drawer, state } = await rosterFixture(page);
  await page.clock.install();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let key = ""; const queries: string[] = [];
  await page.route("**/api/organization/project-roster/apply", async (route) => {
    state.applies += 1; key = route.request().postDataJSON().commandKey;
    await gate;
    await route.fulfill({ json: { projectId: "project", userId: "staff", operation: "join", commandKey: key } }).catch(() => { /* reload does not revoke the submitted command. */ });
  });
  await page.route("**/api/organization/personnel-changes/results/*", (route) => {
    const resultKey = new URL(route.request().url()).pathname.split("/").at(-1)!; queries.push(resultKey);
    return route.fulfill({ json: { commandKey: resultKey, userId: "staff", action: "project_join" } });
  });
  try {
    await drawer.getByRole("button", { name: "确认调入项目", exact: true }).click();
    await expect.poll(() => state.applies).toBe(1);
    await page.clock.fastForward(15_001);
    await expect(drawer.getByText(/调整结果尚未确认/)).toBeVisible();
    expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage }))).not.toContain("Synthetic-Current-Only-01");
    await page.reload();
    await page.getByRole("button", { name: "继续核对人员调整", exact: true }).click();
    await drawer.getByRole("button", { name: "核对办理结果", exact: true }).click();
    await expect(drawer).toHaveCount(0);
    expect(queries).toEqual([key]);
    expect(state.applies).toBe(1);
  } finally { release(); }
});

test("人事POST挂起后刷新只核对原办理，并提交已选的合法用工公司", async ({ page }) => {
  const { drawer, state } = await personnelFixture(page);
  await page.clock.install();
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/organization/personnel-changes/apply", async (route) => {
    state.applies.push(route.request().postDataJSON());
    await gate;
    await route.fulfill({ json: { commandKey: state.applies[0]?.commandKey, userId: "staff", action: "join" } }).catch(() => { /* preserve original assertion through reload. */ });
  });
  await page.route("**/api/organization/personnel-changes/results/*", (route) => {
    const key = new URL(route.request().url()).pathname.split("/").at(-1)!; state.queries.push(key);
    return route.fulfill({ json: { commandKey: key, userId: "staff", action: "join" } });
  });
  try {
    await drawer.getByRole("button", { name: "核实入职", exact: true }).click();
    await drawer.getByLabel("核实入职日期").fill("2026-10-01");
    await drawer.locator('[data-field="companyEntityId"]').click();
    await page.locator(".t-select__dropdown:visible .t-select-option").getByText("合成用工公司", { exact: true }).click();
    await drawer.getByLabel("办理原因").fill("本人及公司资料已核实");
    await drawer.getByRole("button", { name: "预览办理影响", exact: true }).click();
    await drawer.getByPlaceholder("请输入本人当前登录密码").fill("Synthetic-Current-Only-01");
    await drawer.getByRole("button", { name: "确认办理", exact: true }).click();
    await expect.poll(() => state.applies.length).toBe(1);
    await page.clock.fastForward(15_001);
    await expect(drawer.getByText(/办理结果尚未确认/)).toBeVisible();
    expect(state.applies[0]?.companyEntityId).toBe("known-company");
    expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage }))).not.toContain("Synthetic-Current-Only-01");
    await page.reload();
    await drawer.getByRole("button", { name: "核对办理结果", exact: true }).click();
    await expect(drawer).toHaveCount(0);
    expect(state.queries).toEqual([state.applies[0]?.commandKey]);
    expect(state.applies).toHaveLength(1);
  } finally { release(); }
});


test("公司读取失败保留未知，仍可核实日期且不提交虚构公司", async ({ page }) => {
  const { drawer, state } = await personnelFixture(page, [], "active", true);
  await drawer.getByRole("button", { name: "核实入职", exact: true }).click();
  await expect(drawer.getByText(/用工公司选项读取失败/)).toBeVisible();
  await drawer.getByLabel("核实入职日期").fill("2026-10-01");
  await drawer.getByLabel("办理原因").fill("日期已核实，公司待核实");
  await drawer.getByRole("button", { name: "预览办理影响", exact: true }).click();
  await expect(drawer.getByRole("button", { name: "确认办理", exact: true })).toBeVisible();
  expect(state.previews[0]?.startedOn).toBe("2026-10-01");
  expect(state.previews[0]).not.toHaveProperty("companyEntityId");
});

test("同次调动把部门项目和项目财务岗位作为一个预览及提交载荷", async ({ page }) => {
  const { drawer, state } = await personnelFixture(page, [{ id: "current", startedOn: "2026-10-01", endedOn: null, endedAt: null, verified: true, companyEntityId: "known-company", revision: 1 }]);
  await page.route("**/api/organization/personnel-changes/apply", (route) => {
    const input = route.request().postDataJSON(); state.applies.push(input);
    return route.fulfill({ json: { commandKey: input.commandKey, userId: "staff", action: "adjust" } });
  });
  await drawer.getByRole("button", { name: "调动", exact: true }).click();
  await drawer.locator("label").filter({ hasText: "本次安排部门" }).locator(".t-select__wrap").click();
  await page.locator(".t-select__dropdown:visible .t-select-option").getByText("合成综合部", { exact: true }).click();
  await drawer.getByRole("button", { name: "安排岗位调整", exact: true }).click();
  const role = drawer.locator(".arrangement").first();
  await role.locator('[data-field="projectId"]').click();
  await page.locator(".t-select__dropdown:visible .t-select-option").filter({ hasText: "合成人事项目" }).click();
  await role.locator('[data-field="roleKey"]').click();
  await page.locator(".t-select__dropdown:visible .t-select-option").getByText("财务经办", { exact: true }).click();
  await drawer.getByRole("button", { name: "安排项目调整", exact: true }).click();
  await drawer.locator(".arrangement").last().locator(".t-select__wrap").nth(1).click();
  await page.locator(".t-select__dropdown:not(.t-popup--animation-leave-active):visible .t-select-option:visible").filter({ hasText: "合成人事项目" }).click();
  await drawer.getByLabel("办理原因").fill("合成部门及项目岗位组合调动");
  await drawer.getByRole("button", { name: "预览办理影响", exact: true }).click();
  await drawer.getByPlaceholder("请输入本人当前登录密码").fill("Synthetic-Current-Only-01");
  await drawer.getByRole("button", { name: "确认办理", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  expect(state.applies).toHaveLength(1);
  expect(state.applies[0]).toMatchObject({ ...state.previews[0], action: "adjust", departmentId: "department",
    additions: [{ userId: "staff", scope: "project", projectId: "project", roleKey: "finance_staff", operation: "add" }],
    rosterChanges: [{ operation: "join", projectId: "project" }] });
});

test("首调入请求未送达时可按原内容预览后显式确认同编号，只形成一个结果", async ({ page }) => {
  const { drawer, state } = await rosterFixture(page);
  const attempts: Array<Record<string, unknown>> = []; const facts = new Set<string>();
  await page.route("**/api/organization/project-roster/apply", (route) => {
    const input = route.request().postDataJSON(); attempts.push(input);
    if (attempts.length === 1) return route.abort("failed");
    facts.add(input.commandKey); state.joined = true;
    return route.fulfill({ json: { commandKey: input.commandKey, projectId: "project", userId: "staff", operation: "join" } });
  });
  await page.route("**/api/organization/personnel-changes/results/*", (route) => route.fulfill({ json: { found: false, message: "尚未查到办理回执，结果仍待核实" } }));
  await drawer.getByRole("button", { name: "确认调入项目", exact: true }).click();
  await expect(drawer.getByText(/调整结果尚未确认/)).toBeVisible();
  await drawer.getByRole("button", { name: "按原内容重新预览", exact: true }).click();
  await expect(drawer.getByRole("button", { name: "确认调入项目", exact: true })).toBeVisible();
  await expect(drawer.locator('[data-field="reason"] input')).toBeDisabled();
  expect(attempts).toHaveLength(1);
  await drawer.getByPlaceholder("请输入本人当前登录密码").fill("Synthetic-Current-Only-01");
  await drawer.getByRole("button", { name: "确认调入项目", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toMatchObject({ commandKey: attempts[0]?.commandKey, reason: attempts[0]?.reason, userId: "staff", operation: "join", projectId: "project" });
  expect(facts.size).toBe(1);
});

test("原人事未知请求可同编号手动恢复，恢复被拒后仍保留原未知记录", async ({ page }) => {
  const { drawer, state } = await personnelFixture(page);
  const facts = new Set<string>();
  await page.route("**/api/organization/personnel-changes/apply", (route) => {
    const input = route.request().postDataJSON(); state.applies.push(input);
    if (state.applies.length === 1) return route.abort("failed");
    if (state.applies.length === 2) return route.fulfill({ status: 409, json: { message: "合成人事状态变化，请重新预览" } });
    facts.add(input.commandKey);
    return route.fulfill({ json: { commandKey: input.commandKey, userId: "staff", action: "join" } });
  });
  await page.route("**/api/organization/personnel-changes/results/*", (route) => route.fulfill({ json: { found: false, message: "尚未查到办理回执，结果仍待核实" } }));
  await drawer.getByRole("button", { name: "核实入职", exact: true }).click();
  await drawer.getByLabel("核实入职日期").fill("2026-10-01");
  await drawer.getByLabel("办理原因").fill("合成人员日期核实");
  await drawer.getByRole("button", { name: "预览办理影响", exact: true }).click();
  await drawer.getByPlaceholder("请输入本人当前登录密码").fill("Synthetic-Current-Only-01");
  await drawer.getByRole("button", { name: "确认办理", exact: true }).click();
  await expect(drawer.getByText(/办理结果尚未确认/)).toBeVisible();
  for (let attempt = 0; attempt < 2; attempt++) {
    await drawer.getByRole("button", { name: "按原内容重新预览", exact: true }).click();
    await expect(drawer.getByRole("button", { name: "确认办理", exact: true })).toBeVisible();
    expect(state.applies).toHaveLength(attempt + 1);
    await drawer.getByPlaceholder("请输入本人当前登录密码").fill("Synthetic-Current-Only-01");
    await drawer.getByRole("button", { name: "确认办理", exact: true }).click();
    if (attempt === 0) {
      await expect(drawer.getByText(/办理结果尚未确认/)).toBeVisible();
      expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage }))).toContain(String(state.applies[0]?.commandKey));
    }
  }
  await expect(drawer).toHaveCount(0);
  expect(state.applies.map((row) => row.commandKey)).toEqual([state.applies[0]?.commandKey, state.applies[0]?.commandKey, state.applies[0]?.commandKey]);
  expect(facts.size).toBe(1);
});


test("公司GET挂起不阻止履历就绪及离职办理，超时仅提示公司未知", async ({ page }) => {
  await page.clock.install();
  const { drawer, state } = await personnelFixture(page, [{ id: "current", startedOn: "2026-10-01", endedOn: null, endedAt: null, verified: true, companyEntityId: null, revision: 1 }], "active", "hang");
  try {
    await expect(drawer.getByText("在职", { exact: true })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "办理离职", exact: true })).toBeEnabled();
    await drawer.getByRole("button", { name: "办理离职", exact: true }).click();
    await drawer.getByLabel("办理原因").fill("合成交接已核实，公司选项不影响离职");
    await page.clock.fastForward(15_001);
    await expect(drawer.getByText(/用工公司选项读取失败/)).toBeVisible();
    await expect(drawer.getByText("在职", { exact: true })).toBeVisible();
    await drawer.getByRole("button", { name: "预览办理影响", exact: true }).click();
    await expect(drawer.getByRole("button", { name: "确认办理", exact: true })).toBeVisible();
    expect(state.previews[0]?.action).toBe("offboard");
  } finally { state.releaseCompany(); }
});


test("刷新恢复的原办理完整安排可审阅，同键重新预览和提交保持全部原载荷", async ({ page }) => {
  const { drawer, state } = await personnelFixture(page);
  const original = { commandKey: "00000000-0000-4000-8000-000000000039", userId: "staff", action: "join", reason: "原入职安排已与本人核对",
    departmentId: "second-department", startedOn: "2026-10-01", companyEntityId: "known-company",
    additions: [{ operation: "add", userId: "staff", scope: "project", projectId: "project", roleKey: "finance_staff" }],
    removals: [{ operation: "remove", userId: "staff", scope: "global", roleKey: "finance_staff" }],
    rosterChanges: [{ operation: "join", projectId: "project" }, { operation: "leave", projectId: "old-project" }] };
  await page.route("**/api/organization/personnel-changes/results/*", (route) => {
    state.queries.push(new URL(route.request().url()).pathname.split("/").at(-1)!);
    return route.fulfill({ json: { found: false, message: "尚未查到办理回执，结果仍待核实" } });
  });
  await page.route("**/api/organization/personnel-changes/apply", (route) => {
    const input = route.request().postDataJSON(); state.applies.push(input);
    return route.fulfill({ json: { commandKey: input.commandKey, userId: "staff", action: "join" } });
  });
  await page.evaluate((command) => sessionStorage.setItem("jiangkong-pending-personnel:manager", JSON.stringify({ actorId: "manager", command })), original);
  await page.reload();
  const summary = drawer.getByRole("region", { name: "原办理安排（已锁定）", exact: true });
  await expect(summary).toBeVisible();
  for (const text of ["办理事项：核实入职", "办理原因：原入职安排已与本人核对", "安排部门：合成调动部门", "核实入职日期：2026-10-01", "用工公司：合成用工公司",
    "新增岗位：合成人事项目 · 财务经办（项目岗位）", "撤销岗位：财务经办（公司岗位，适用全部项目）", "调入项目：合成人事项目", "调出项目：合成原项目"]) {
    await expect(summary.getByText(text, { exact: true })).toBeVisible();
  }
  await expect(summary.getByRole("textbox")).toHaveCount(0);
  await expect(drawer.getByPlaceholder("请输入本人当前登录密码")).toHaveCount(0);
  expect(state.applies).toHaveLength(0);
  await drawer.getByRole("button", { name: "按原内容重新预览", exact: true }).click();
  await expect(drawer.getByRole("button", { name: "确认办理", exact: true })).toBeVisible();
  await expect(summary).toBeVisible();
  await expect(summary.getByText("安排部门：合成调动部门", { exact: true })).toBeVisible();
  expect(state.queries).toEqual([original.commandKey]);
  expect(state.previews).toEqual([original]);
  expect(state.applies).toHaveLength(0);
  await drawer.getByPlaceholder("请输入本人当前登录密码").fill("Synthetic-Recovery-Only-02");
  await drawer.getByRole("button", { name: "确认办理", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  expect(state.applies).toHaveLength(1);
  const { snapshotHash, confirmationPassword, ...submitted } = state.applies[0]!;
  expect(submitted).toEqual(original);
  expect(snapshotHash).toBe("sha256:preview-1");
  expect(confirmationPassword).toBe("Synthetic-Recovery-Only-02");
  expect(await page.evaluate(() => JSON.stringify({ ...sessionStorage }))).not.toContain("Synthetic-Recovery-Only-02");
  await expectNoDocumentHorizontalOverflow(page);
});
