import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import ts from "typescript";

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

test("V6.1 旧标签不能改附件且项目切换不会遗留附件", async ({ page, context }) => {
  await prepare(page);
  const second = await context.newPage();
  await prepare(second);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ7sAAAAASUVORK5CYII=", "base64");
  const current = second.locator(".durable-file-picker").nth(1);
  await current.locator('input[type="file"]').setInputFiles({ name: "current.png", mimeType: "image/png", buffer: png });
  await expect(current.getByText("已在本机保留 1 份附件，保存草稿时上传。", { exact: true })).toBeVisible();
  const project = second.locator(".t-dialog:visible").getByPlaceholder("请选择项目");
  await expect(project).toBeDisabled();
  const old = page.locator(".durable-file-picker").nth(1);
  await old.locator('input[type="file"]').setInputFiles({ name: "stale.png", mimeType: "image/png", buffer: png });
  await expect(old.getByText(/另一页面已更新这份草稿/u)).toBeVisible();
  await expect(old.getByText("本批附件尚未添加，请保留原文件并重试。", { exact: true })).toBeVisible();
  await second.reload();
  await second.getByRole("button", { name: "新建采购申请", exact: true }).click();
  await expect(current.locator("li")).toHaveCount(1);
  await expect(current.locator("li")).toContainText("current.png");
  await current.getByRole("button", { name: "移除", exact: true }).click();
  await expect(current.locator("li")).toHaveCount(0);
  await expect(project).toBeEnabled();
  await second.close();
});

test("V6.1 仅移除已确认关联的附件且原生读取失败给出中文下一步", async ({ page }) => {
  // Serve the actual persistence module only inside this isolated browser test.
  const source = readFileSync(new URL("../src/lib/pending-attachment-store.ts", import.meta.url), "utf8");
  await page.route("**/v61-store-test.js", (route) => route.fulfill({ contentType: "text/javascript", body: ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }) }));
  await page.goto("/login");
  const retained = await page.evaluate(async () => {
    const modulePath = "/v61-store-test.js";
    const { pendingAttachmentStore } = await import(/* @vite-ignore */ modulePath);
    const a = pendingAttachmentStore(), b = pendingAttachmentStore();
    await a.stage("isolated", "same-draft", [new File(["a"], "confirmed.png")]);
    const submitted = await a.list("isolated", "same-draft");
    await b.stage("isolated", "same-draft", [new File(["b"], "unsubmitted.png")]);
    await a.removeConfirmed("isolated", "same-draft", submitted.map((file: { id: string }) => file.id));
    return (await b.list("isolated", "same-draft")).map((file: { name: string }) => file.name);
  });
  expect(retained).toEqual(["unsubmitted.png"]);
  await prepare(page);
  await page.evaluate(() => { File.prototype.arrayBuffer = async () => { throw new DOMException("File is not readable", "NotReadableError"); }; });
  const picker = page.locator(".durable-file-picker").nth(1);
  await picker.locator('input[type="file"]').setInputFiles({ name: "unreadable.png", mimeType: "image/png", buffer: Buffer.from("test") });
  await expect(picker.getByText("本批附件尚未添加，请保留原文件并重试。", { exact: true })).toBeVisible();
  await expect(picker).not.toContainText("NotReadableError");
  await expect(picker).not.toContainText("File is not readable");
});

test("V6.1 另一页添加原文件期间重开会等待并完整恢复附件", async ({ page, context }) => {
  await prepare(page);
  await page.evaluate(() => {
    const original = File.prototype.arrayBuffer;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    File.prototype.arrayBuffer = async function () { await gate; return original.call(this); };
    Object.assign(window, { releaseOriginalRead: release });
  });
  const picker = page.locator(".durable-file-picker").nth(1);
  await picker.locator('input[type="file"]').setInputFiles({ name: "in-flight.png", mimeType: "image/png", buffer: Buffer.from("original") });
  await expect(picker.getByText("正在保留原文件，请稍候再关闭页面。", { exact: true })).toBeVisible();
  const second = await context.newPage();
  await prepare(second);
  await expect(second.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  await expect(second.locator(".create-form")).toHaveAttribute("inert", "");
  await page.evaluate(() => { (window as unknown as { releaseOriginalRead: () => void }).releaseOriginalRead(); });
  const recovered = second.locator(".durable-file-picker").nth(1);
  await expect(recovered.locator("li")).toHaveCount(1);
  await expect(recovered.locator("li")).toContainText("in-flight.png");
  await recovered.getByRole("button", { name: "继续添加", exact: true }).click();
  await expect(recovered.getByText("已在本机保留 1 份附件，保存草稿时上传。", { exact: true })).toBeVisible();
  await second.reload();
  await second.getByRole("button", { name: "新建采购申请", exact: true }).click();
  await expect(recovered.locator("li")).toHaveCount(1);
  await expect(recovered.locator("li")).toContainText("in-flight.png");
  await second.close();
});

test("V6.1 已完成申请不会被旧标签关闭重开复活", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await page.getByPlaceholder("如：工程部").fill("本次已完成申请");
  await page.getByPlaceholder("如：杨帅").fill("隔离经办");
  const date = page.locator(".t-dialog:visible .t-date-picker input");
  await date.click();
  await page.locator(".t-date-picker__cell--now:visible").click();
  await expect(date).not.toHaveValue("");
  await page.locator(".t-dialog:visible textarea").first().fill("隔离申请用途");
  const lines = page.locator(".procurement-line-editor__cards");
  await lines.locator("label").filter({ hasText: "材料名称" }).locator("input").fill("隔离材料");
  await lines.locator("label").filter({ hasText: "单位" }).locator("input").fill("件");
  await lines.locator("label").filter({ hasText: "数量" }).locator("input").fill("1");
  const second = await context.newPage();
  await prepare(second);
  await expect(second.getByPlaceholder("如：工程部")).toHaveValue("本次已完成申请");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "新建采购申请", exact: true }).click();
  let creates = 0;
  await page.route("**/api/spot-procurements", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    creates++;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ procurementId: "confirmed-draft", code: "LOCAL-1" }) });
  });
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page).toHaveURL(/confirmed-draft/u);
  await second.getByRole("button", { name: "取消", exact: true }).click();
  await second.getByRole("button", { name: "新建采购申请", exact: true }).click();
  await expect(second.getByPlaceholder("如：工程部")).toHaveValue("");
  await expect(second.getByPlaceholder("如：杨帅")).toHaveValue("");
  await expect(second.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  expect(creates).toBe(1);
  await second.close();
});
