import { errors, expect, test, type Page } from "@playwright/test";
test.beforeEach(({ page }) => { page.on("pageerror", error => { throw error; }); });
async function login(page: Page, phone = "13800000000") {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill(phone);
  await page.getByPlaceholder("请输入密码").fill("synthetic-current-password");
  const signedIn = page.waitForResponse(response => response.url().endsWith("/auth/login") && response.request().method() === "POST");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const response = await signedIn; expect(response.status(), await response.text()).toBe(201);
  await expect(page).not.toHaveURL(/\/login/);
}
async function assertNoPageOverflow(page: Page, surface = ".procurement-detail") {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  for (const region of await page.locator(`${surface}, ${surface} .request-grid`).all()) {
    if (!await region.isVisible()) continue;
    const rect = await region.boundingBox();
    expect(rect && rect.x >= 0 && rect.x + rect.width <= (page.viewportSize()?.width ?? 0) + 1, JSON.stringify({ surface, rect, viewport: page.viewportSize() })).toBe(true);
  }
}
async function fillName(page: Page, name: string, commitKey = "Enter") {
  const cell = page.locator('revo-grid [data-rgrow="0"][data-rgcol="0"]').first();
  await cell.dblclick();
  const editor = page.locator("revogr-edit input");
  await editor.fill(name); await editor.press(commitKey);
  await expect(cell).toContainText(name);
}
for (const scope of ["company_daily", "project"] as const) test(`${scope}真实表格保存、提交与当前岗位审批`, async ({ page, browser }, info) => {
  await login(page); await page.goto("/综合采购申请");
  await page.getByRole("button", { name: "新建综合采购申请", exact: true }).click();
  const drawer = page.locator(".t-drawer").filter({ hasText: "新建综合采购申请" });
  await expect(drawer).toBeVisible();
  if (scope === "project") {
    await drawer.getByText("项目采购", { exact: true }).click();
    await drawer.getByLabel("所属项目", { exact: true }).click();
    await page.getByRole("listitem", { name: "合成办公项目", exact: true }).click();
  }
  const name = `办公软件-${scope}-${info.project.name}`;
  await fillName(page, name); await assertNoPageOverflow(page, ".t-drawer");
  const savedPromise = page.waitForResponse(response => response.url().endsWith("/general-procurements") && response.request().method() === "POST");
  await drawer.getByRole("button", { name: "保存草稿", exact: true }).click();
  const saved = await savedPromise; expect(saved.status(), await saved.text()).toBe(201); const id = (await saved.json()).id;
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(id)));
  await expect(page.getByText("预计金额待明确").first()).toBeVisible();
  await expect(page.locator("revo-grid").first()).toBeVisible(); await assertNoPageOverflow(page);
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  const submit = page.locator(".t-dialog").filter({ hasText: "确认提交" });
  await submit.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(page.getByText("审批中", { exact: true }).first()).toBeVisible();
  const ids = scope === "project" ? ["13800000002", "13800000001"] : ["13800000001"];
  for (const phone of ids) {
    const context = await browser.newContext({ viewport: page.viewportSize()!, isMobile: info.project.name.startsWith("touch"), hasTouch: info.project.name.startsWith("touch") });
    const reviewer = await context.newPage(); await login(reviewer, phone); await reviewer.goto(`/综合采购申请/${encodeURIComponent(id)}`);
    await reviewer.getByRole("button", { name: "审批", exact: true }).click();
    const dialog = reviewer.locator(".t-dialog").filter({ hasText: "审批综合采购申请" });
    await dialog.getByRole("button", { name: "批准", exact: true }).click();
    await expect(dialog).toBeHidden(); await assertNoPageOverflow(reviewer); await context.close();
  }
  await page.reload(); await expect(page.getByText("待综合部采购", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "综合部归档", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "发起付款申请", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`${info.project.name}-${scope}.png`), fullPage: true });
});

test("清单复制生成独立行，撤销后仍保留原填写并真实保存", async ({ page }) => {
  await login(page); await page.goto("/综合采购申请");
  await page.getByRole("button", { name: "新建综合采购申请", exact: true }).click();
  const drawer = page.locator(".t-drawer--open"); await expect(drawer).toBeVisible();
  await fillName(page, "中文办公软件");
  const copy = drawer.getByRole("button", { name: "复制末行", exact: true }); await expect(copy).toBeVisible();
  await copy.click(); await expect(drawer.getByRole("gridcell", { name: "中文办公软件", exact: true })).toHaveCount(2);
  await drawer.getByRole("button", { name: "撤销上一步", exact: true }).click();
  await expect(drawer.getByRole("gridcell", { name: "中文办公软件", exact: true })).toHaveCount(1);
  await copy.click();
  const savedPromise = page.waitForResponse(response => response.url().endsWith("/general-procurements") && response.request().method() === "POST");
  await drawer.getByRole("button", { name: "保存草稿", exact: true }).click();
  const response = await savedPromise; expect(response.status(), await response.text()).toBe(201);
  const body = response.request().postDataJSON(); expect(body.lines).toHaveLength(2);
  expect(body.lines[0].id).not.toBe(body.lines[1].id);
  expect(body.lines.map((line: { name: string }) => line.name)).toEqual(["中文办公软件", "中文办公软件"]);
  await expect(page).toHaveURL(new RegExp((await response.json()).id)); await assertNoPageOverflow(page);
});

test("断网未发送保存仍可编辑，五位预计金额拒绝后保留输入并可改成四位重试", async ({ page, context }) => {
  await login(page); await page.goto("/综合采购申请");
  await page.getByRole("button", { name: "新建综合采购申请", exact: true }).click();
  const drawer = page.locator(".t-drawer--open"); await expect(drawer).toBeVisible(); await fillName(page, "可重试软件需求");
  const posts: string[] = []; page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/general-procurements")) posts.push(request.postData() ?? ""); });
  await context.setOffline(true); await drawer.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(drawer.getByText(/尚未发送保存请求/)).toBeVisible(); expect(posts).toHaveLength(0);
  await context.setOffline(false); await fillName(page, "断网保留后修改的需求", "Tab");
  // Tab commits the name and opens the next native specification editor.
  const nextEditor = page.locator("revogr-edit input"); await expect(nextEditor).toHaveValue("");
  await nextEditor.fill("保留的规格说明");
  await expect(drawer.getByRole("button", { name: "保存草稿", exact: true })).toBeDisabled();
  await nextEditor.press("Enter");
  await expect(drawer.getByRole("button", { name: "保存草稿", exact: true })).toBeEnabled();
  const amount = drawer.getByPlaceholder("整单独立预计金额（元，最多四位小数），未定可留空"); await amount.fill("1.53401");
  const rejected = page.waitForResponse(response => response.url().endsWith("/general-procurements") && response.request().method() === "POST");
  await drawer.getByRole("button", { name: "保存草稿", exact: true }).click(); expect((await rejected).status()).toBe(400);
  await expect(amount).toHaveValue("1.53401"); await expect(amount).toBeEnabled(); await amount.fill("1.5340");
  const saved = page.waitForResponse(response => response.url().endsWith("/general-procurements") && response.request().method() === "POST");
  await drawer.getByRole("button", { name: "保存草稿", exact: true }).click(); const response = await saved; expect(response.status(), await response.text()).toBe(201);
  expect(response.request().postDataJSON()).toMatchObject({ estimatedAmount: "1.5340", requestedAmountCents: null, lines: [{ name: "断网保留后修改的需求", specification: "保留的规格说明" }] });
  await expect(page).toHaveURL(new RegExp((await response.json()).id)); await expect(page.getByText("1.5340 元", { exact: true }).first()).toBeVisible();
  await assertNoPageOverflow(page);
});


test("历史申请仅编辑既有草稿，保留原协议与已知金额", async ({ page }, info) => {
  await login(page); await page.goto("/综合采购申请/11111111-1111-4111-8111-111111111111");
  await page.getByRole("button", { name: "修改申请", exact: true }).click();
  const drawer = page.locator(".t-drawer--open");
  await expect(drawer.getByText("修改历史综合采购申请", { exact: true })).toBeVisible();
  await drawer.getByPlaceholder("请填写采购内容及用途").fill(`历史用途已核对-${info.project.name}`);
  const saved = page.waitForResponse(response => response.url().endsWith("/11111111-1111-4111-8111-111111111111/draft") && response.request().method() === "POST");
  await drawer.getByRole("button", { name: "保存草稿", exact: true }).click();
  const response = await saved; expect(response.status(), await response.text()).toBe(201);
  expect(response.request().postDataJSON()).toMatchObject({ requestedAmountCents: "12345", reason: `历史用途已核对-${info.project.name}` });
  expect(response.request().postDataJSON().requestProtocolVersion).toBeUndefined();
  await expect(drawer).toBeHidden(); await expect(page.getByText(`用途：历史用途已核对-${info.project.name}`, { exact: true }).first()).toBeVisible();
});

test("未确认中文缓冲受真实刷新关闭与放弃保护，空编辑器不算改动", async ({ page }, info) => {
  await login(page); await page.goto("/综合采购申请");
  await page.getByRole("button", { name: "新建综合采购申请", exact: true }).click();
  const drawer = page.locator(".t-drawer--open"); const text = "尚未确认的中文软件需求";
  const cell = drawer.locator('revo-grid [data-rgrow="0"][data-rgcol="0"]').first();
  await cell.dblclick(); const editor = drawer.locator("revogr-edit input"); await editor.fill(text);
  await expect(editor).toHaveValue(text); await expect(cell).not.toContainText(text);
  const posts: string[] = []; page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/general-procurements")) posts.push(request.postData() ?? ""); });
  if (info.project.name === "desktop-chromium") {
    const originalUrl = page.url(); const committedNavigations: string[] = [];
    page.on("framenavigated", frame => { if (frame === page.mainFrame()) committedNavigations.push(frame.url()); });
    const refreshDialog = page.waitForEvent("dialog", { timeout: 5000 });
    const reload = page.reload({ waitUntil: "commit", timeout: 5000 }).then(
      () => ({ completed: true as const }), (error: unknown) => ({ completed: false as const, error }));
    const dialog = await refreshDialog; expect(dialog.type()).toBe("beforeunload"); await dialog.dismiss();
    const outcome = await reload; expect(outcome.completed).toBe(false);
    if (!outcome.completed) {
      // A dismissed native beforeunload can abort immediately or leave navigation waiting for its commit deadline.
      // Only those two cancellation outcomes are allowed, after the actual native dialog was dismissed.
      expect(outcome.error instanceof errors.TimeoutError || (outcome.error instanceof Error && outcome.error.message.includes("net::ERR_ABORTED"))).toBe(true);
    }
    expect(page.url()).toBe(originalUrl); expect(committedNavigations).toEqual([]);
    await expect(editor).toHaveValue(text); expect(posts).toHaveLength(0);
    const closeDialog = page.waitForEvent("dialog", { timeout: 5000 });
    await page.close({ runBeforeUnload: true }); const closing = await closeDialog;
    expect(closing.type()).toBe("beforeunload"); await closing.dismiss(); expect(page.isClosed()).toBe(false);
    await expect(editor).toHaveValue(text);
  }
  // Mobile browsers do not guarantee OS/tab beforeunload. Exercise the actual app close path on every device.
  await drawer.getByRole("button", { name: "取消", exact: true }).click();
  const confirm = page.locator(".t-dialog").filter({ hasText: "保留当前填写" });
  await expect(confirm).toBeVisible(); await confirm.getByRole("button", { name: "继续填写", exact: true }).click();
  expect(posts).toHaveLength(0); await expect(cell).toContainText(text);
  await drawer.getByRole("button", { name: "取消", exact: true }).click();
  await confirm.getByRole("button", { name: "放弃当前填写", exact: true }).click(); await expect(drawer).toBeHidden();
  await page.getByRole("button", { name: "新建综合采购申请", exact: true }).click();
  await drawer.locator('revo-grid [data-rgrow="0"][data-rgcol="0"]').first().dblclick();
  await expect(drawer.locator("revogr-edit input")).toHaveValue("");
  await drawer.getByRole("button", { name: "取消", exact: true }).click();
  await expect(drawer).toBeHidden(); await expect(confirm).toBeHidden(); expect(posts).toHaveLength(0);
});
