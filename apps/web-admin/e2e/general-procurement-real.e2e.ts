import { expect, test, type Page, type Request } from "@playwright/test";
const sessions = JSON.parse(process.env.GP_SESSIONS!);
const historicalDrafts: Record<string, string> = JSON.parse(process.env.GP_HISTORICAL_DRAFTS!);
async function login(page: Page, role: string) {
  const session = sessions[role];
  await page.evaluate((value) => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), { user: session.user, accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken });
  await page.reload();
}
test("新申请保留元估价和重复保存身份，历史申请按顺序审批归档并请款", async ({ page, request }, testInfo) => {
  await page.goto("/login");
  await login(page, "employee");
  await page.goto("/综合采购申请");
  await page.getByRole("button", { name: "新建综合采购申请", exact: true }).click();
  const form = page.locator(".t-drawer").filter({ hasText: "新建综合采购申请" });
  const amount = form.getByPlaceholder("整单独立预计金额（元，最多四位小数），未定可留空");
  await amount.fill("123.45");
  await form.getByPlaceholder("用途或补充说明，未定可留空").fill(`浏览器${testInfo.project.name}采购办公用品`);
  const lineName = `办公用品-${testInfo.project.name}`;
  const nameCell = form.locator('revo-grid [data-rgrow="0"][data-rgcol="0"]').first();
  await nameCell.dblclick();
  const editor = form.locator("revogr-edit input");
  await editor.fill(lineName);
  await editor.press("Enter");
  await expect(nameCell).toContainText(lineName);
  let originalRequest: unknown;
  let originalId = "";
  await page.route("**/general-procurements", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    originalRequest = route.request().postDataJSON();
    originalId = (await response.json()).id;
    await route.abort("failed");
    await page.unroute("**/general-procurements");
  });
  await form.getByRole("button", { name: "保存草稿", exact: true }).click();
  const reconcile = form.getByRole("button", { name: "核对并保存同一次草稿", exact: true });
  await expect(reconcile).toBeEnabled();
  await expect(amount).toHaveValue("123.45");
  await expect(amount).not.toBeEditable();
  const created = page.waitForResponse((response) => response.url().endsWith("/general-procurements") && response.request().method() === "POST");
  await reconcile.click();
  const createdResponse = await created;
  expect(createdResponse.status(), await createdResponse.text()).toBe(201);
  expect(createdResponse.request().postDataJSON()).toMatchObject({
    requestProtocolVersion: 2, estimatedAmount: "123.45", requestedAmountCents: null,
    lines: [expect.objectContaining({ name: lineName })]
  });
  const { id: currentId } = await createdResponse.json();
  expect(currentId).toBe(originalId);
  expect(createdResponse.request().postDataJSON()).toEqual(originalRequest);
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(currentId)));
  await page.reload();
  await expect(page.getByText("123.4500 元", { exact: true }).first()).toBeVisible();

  const id = historicalDrafts[testInfo.project.name];
  expect(id).toMatch(/^[a-f0-9-]{36}$/u);
  await page.goto(`/综合采购申请/${id}`);
  const historical = await request.get(`${process.env.GP_API_URL}/general-procurements/${id}`, {
    headers: { authorization: `Bearer ${sessions.employee.tokens.accessToken}` }
  });
  expect(historical.status()).toBe(200);
  expect(await historical.json()).toMatchObject({ status: "draft", requestedAmountCents: "12345" });
  await expect(page.getByText("123.45 元", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  const submitDialog = page.locator(".t-dialog").filter({ hasText: "提交采购申请" });
  await submitDialog.evaluate(async (element) => { await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)); });
  const submitted = page.waitForResponse((response) => response.url().endsWith(`/general-procurements/${id}/submission`) && response.request().method() === "POST");
  await submitDialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const submittedResponse = await submitted;
  expect(submittedResponse.status(), await submittedResponse.text()).toBe(201);
  await expect(page.getByText("当前办理：综合部主管", { exact: true })).toBeVisible();
  for (const role of ["director", "manager", "chairman"]) {
    await test.step(`审批 ${role}`, async () => {
      await login(page, role);
      await page.getByRole("button", { name: "审批", exact: true }).click();
      const review = page.locator(".t-dialog").filter({ hasText: "审批综合采购申请" });
      await expect(review).toBeVisible();
      // TDesign marks the opening transition on the dialog context, outside the panel.
      const reviewContext = review.locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' t-dialog__ctx ')][1]");
      await expect(reviewContext).toHaveCount(1);
      await expect(reviewContext).not.toHaveClass(/t-dialog-zoom__vue-enter-(?:from|active|to)/);
      const approve = review.getByRole("button", { name: "批准", exact: true });
      const isReview = (request: Request) => request.method() === "POST" && new URL(request.url()).pathname === `/api/general-procurements/${id}/review`;
      let reviewPosts = 0;
      const countReview = (request: Request) => { if (isReview(request)) reviewPosts += 1; };
      page.on("request", countReview);
      try {
        const [reviewedResponse] = await Promise.all([
          page.waitForResponse(response => isReview(response.request()), { timeout: 5000 }),
          approve.click(),
        ]);
        expect(reviewedResponse.status(), await reviewedResponse.text()).toBe(201);
        await expect(review).toBeHidden();
        expect(reviewPosts).toBe(1);
      } finally {
        page.off("request", countReview);
      }
    });
  }
  await login(page, "director");
  await page.getByRole("button", { name: "综合部归档", exact: true }).click();
  const archive = page.locator(".t-dialog").filter({ hasText: "归档采购资料" });
  await archive.locator('input[type="file"]').setInputFiles({ name: "浏览器采购依据.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=", "base64") });
  await archive.getByPlaceholder("说明已核实的采购内容和凭证").fill("已核实办公用品和供应商依据");
  await archive.getByRole("button", { name: "确认归档", exact: true }).click();
  await expect(page.getByText("已归档", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "发起付款申请", exact: true }).click();
  const payment = page.locator(".t-dialog").filter({ hasText: "综合采购付款申请" });
  const fullAmount = testInfo.project.name === "mobile";
  await payment.getByPlaceholder("填写本次付款金额（元）").fill(fullAmount ? "123.45" : "100.01");
  await payment.getByPlaceholder("填写供应商或收款人名称").fill("浏览器合成办公用品商");
  let persistedClaimId = "";
  await page.route("**/expense-claims", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    persistedClaimId = (await response.json()).id;
    await route.abort("failed");
    await page.unroute("**/expense-claims");
  });
  await payment.getByRole("button", { name: "保存付款草稿", exact: true }).click();
  await expect.poll(() => persistedClaimId).not.toBe("");
  await expect(payment.getByRole("button", { name: "保存付款草稿", exact: true })).toBeEnabled();
  const saved = page.waitForResponse((response) => response.url().endsWith("/expense-claims") && response.request().method() === "POST");
  await payment.getByRole("button", { name: "保存付款草稿", exact: true }).click();
  const savedResponse = await saved;
  expect(savedResponse.status(), await savedResponse.text()).toBe(201);
  const claim = await savedResponse.json();
  expect(claim.id).toBe(persistedClaimId);
  await expect(page.getByRole("heading", { name: "综合采购付款", exact: true })).toBeVisible();
  const source = await request.get(`${process.env.GP_API_URL}/general-procurements/${id}`, { headers: { authorization: `Bearer ${sessions.director.tokens.accessToken}` } });
  expect(await source.json()).toMatchObject({ status: "archived", paymentSummary: { reservedAmountCents: fullAmount ? "12345" : "10001", availableAmountCents: fullAmount ? "0" : "2344" }, payments: [expect.objectContaining({ id: claim.id, status: "draft" })] });
  await expect(page.getByRole("link", { name: /查看采购申请/ })).toBeVisible();
  await page.getByRole("link", { name: /查看采购申请/ }).click();
  await page.getByRole("button", { name: "撤销付款草稿", exact: true }).click();
  const cancellation = page.locator(".t-dialog").filter({ hasText: "撤销付款草稿" });
  // WebKit may finish the input click while TDesign's opening transform is still
  // moving the confirm button. Preserve the real click and wait for that opening.
  await expect(cancellation).toBeVisible();
  await expect(cancellation).toHaveCSS("opacity", "1");
  await expect(cancellation).toHaveCSS("transform", "none");
  await cancellation.evaluate(async (element) => { await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)); });
  await cancellation.getByPlaceholder("填写撤销原因").fill("收款方录错，重新办理");
  const [cancelledResponse] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith(`/general-procurements/${id}/payments/${claim.id}/cancellation`) && response.request().method() === "POST", { timeout: 5000 }),
    cancellation.getByRole("button", { name: "确认撤销", exact: true }).click(),
  ]);
  expect(cancelledResponse.status(), await cancelledResponse.text()).toBe(201);
  await expect(page.getByText(/已驳回或撤销/)).toBeVisible();
  await expect(page.getByRole("button", { name: "发起付款申请", exact: true })).toBeVisible();
  const cancelled = await request.get(`${process.env.GP_API_URL}/general-procurements/${id}`, { headers: { authorization: `Bearer ${sessions.director.tokens.accessToken}` } });
  expect(await cancelled.json()).toMatchObject({ paymentSummary: { reservedAmountCents: "0", availableAmountCents: "12345" } });
  await expect(page.getByRole("button", { name: "确认撤销", exact: true })).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("procurement-complete.png"), fullPage: true });
  expect(await page.locator("body").evaluate((element) => element.scrollWidth <= window.innerWidth)).toBe(true);
});
