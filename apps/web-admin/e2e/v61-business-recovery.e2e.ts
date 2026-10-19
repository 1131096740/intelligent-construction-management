import { expect, test, type Page } from "@playwright/test";

async function prepare(page: Page) {
  const project = { id: "local-project", code: "LOCAL", name: "隔离项目" };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/u, "");
    let body: unknown;
    if (path === "/auth/login") body = { user: { id: "isolated-user", name: "隔离经办", phone: "13900000000", mustChangePassword: false, roleKeys: ["material_staff"], globalRoleKeys: [] }, tokens: { accessToken: "test", refreshToken: "test-refresh", expiresIn: 900 } };
    else if (path === "/me/work-items") body = { generatedAt: new Date().toISOString(), visibleProjectCount: 1, queues: { pending: [], blocked: [], started: [], drafts: [] }, approvalCenter: { pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: [] } };
    else if (path === "/projects" || path.endsWith("/create-project-options")) body = [project];
    else if (path.endsWith("/capabilities")) body = { projectId: project.id, enabled: true, canCreate: true, canExecutePayment: false, availableActions: ["create_spot_procurement"], handlerOptions: [] };
    else if (path.endsWith("/application-definitions")) body = { application: { version: 1 }, line: { version: 1 } };
    else if (path === "/spot-procurements") body = { items: [], view: "active", surface: "procurement", pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 }, statistics: { total: 0, byStatus: {} } };
    else if (path.includes("application-text-suggestions") || path === "/approval-delegations/user-options") body = [];
    else return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ message: "本轮页面测试不办理正式写入" }) });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Local-only-test");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "我要办业务", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "零星材料采购 申请材料、数量和到位日期", exact: true }).click();
  await expect(page.getByRole("heading", { name: "零星采购工作台", exact: true })).toBeVisible();
  for (const label of ["采购申请", "材料付款", "收货确认"]) await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "新建采购申请", exact: true }).click();
  await expect(page.getByText("新建零星/小额材料采购申请表", { exact: true })).toBeVisible();
}

test("V6.1 正式表单批量附件刷新恢复且不自动上传或重复添加", async ({ page }, info) => {
  await prepare(page);
  const mutationRequests: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("/api/")) mutationRequests.push(request.url()); });
  await page.getByPlaceholder("如：工程部").fill("刷新保留");
  await page.getByPlaceholder("如：杨帅").fill("隔离经办");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ7sAAAAASUVORK5CYII=", "base64");
  const large = Buffer.alloc(20 * 1024 * 1024 - 1024);
  png.copy(large);
  const picture = { name: "local-photo.png", mimeType: "image/png", buffer: png };
  const picker = page.locator(".durable-file-picker").nth(1);
  await picker.locator('input[type="file"]').setInputFiles([picture, { name: "local-large.png", mimeType: "image/png", buffer: large }]);
  await expect(picker.getByText("已在本机保留 2 份附件，保存草稿时上传。", { exact: true })).toBeVisible();
  await picker.locator('input[type="file"]').setInputFiles({ ...picture, name: "renamed-same-photo.png" });
  await expect(picker.getByText(/已跳过 1 份重复文件/u)).toBeVisible();
  await expect(picker.locator("li")).toHaveCount(2);
  await page.reload();
  await page.getByRole("button", { name: "新建采购申请", exact: true }).click();
  await expect(page.getByPlaceholder("如：工程部")).toHaveValue("刷新保留");
  await expect(picker.getByText("已恢复 2 份本机附件，保存前请核对。", { exact: true })).toBeVisible();
  await expect(picker.locator("li")).toHaveCount(2);
  await picker.getByRole("button", { name: "预览", exact: true }).first().click();
  await expect(page.getByRole("img", { name: "local-photo.png", exact: true })).toBeVisible();
  expect(mutationRequests).toEqual([]);
  await page.screenshot({ path: info.outputPath("attachment-recovery.png"), fullPage: true });
});

test("V6.1 手机短视口保留底部操作且帮助可点击和关闭", async ({ page }, info) => {
  await prepare(page);
  await page.setViewportSize({ width: 390, height: 500 });
  const footer = page.locator(".t-dialog:visible .t-dialog__footer").first();
  await expect(footer.getByRole("button", { name: "取消", exact: true })).toBeInViewport();
  await expect(footer.getByRole("button", { name: "保存草稿", exact: true })).toBeInViewport();
  const rect = await footer.boundingBox();
  expect(rect).not.toBeNull();
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(500);
  const help = page.getByRole("button", { name: "采购申请填写说明", exact: true });
  if (info.project.name.includes("webkit")) await help.tap();
  else await help.hover();
  const popup = page.locator(".jg-business-help-content:visible");
  await expect(popup).toContainText("采购申请单号会在保存草稿时由系统自动生成");
  await help.press("Escape");
  await expect(popup).toHaveCount(0);
  const body = page.locator(".t-dialog:visible .t-dialog__body").first();
  // The mobile WebKit runner has no native mouse wheel. Scroll the real
  // below-fold attachment control into view and verify its scroll owner.
  await page.getByRole("heading", { name: "现场参考照片（可选）", exact: true }).scrollIntoViewIfNeeded();
  await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect(footer.getByRole("button", { name: "取消", exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath("short-mobile-dialog.png"), fullPage: true });
});
