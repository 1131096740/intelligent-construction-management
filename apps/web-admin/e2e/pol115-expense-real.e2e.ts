import { expect, test } from "@playwright/test";

test("报销表格或移动卡片保存一分钱明细并经真实接口回读", async ({ page, request }) => {
  const session = JSON.parse(process.env.POL115_BROWSER_SESSION!);
  await page.addInitScript((value) => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), {
    user: session.user, accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken
  });
  await page.goto("/费用与报销工作台");
  await page.getByRole("button", { name: "新建费用报销 / 借款", exact: true }).click();
  const drawer = page.locator(".t-drawer");
  await drawer.getByText("借款申请", { exact: true }).click();
  await drawer.getByText("费用报销", { exact: true }).click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  const form = page.getByRole("region", { name: "费用申请单条业务表单" });
  await form.locator('[data-field="reason"] textarea').fill("真实浏览器报销明细");
  await form.locator('[data-field="requestedAmountYuan"] input').fill("0.01");
  if (page.viewportSize()!.width < 768) {
    const cards = page.locator(".business-entry-mobile-cards");
    await expect(cards).toBeVisible();
    await cards.locator('[data-field="expenseCategory"] input').fill("办公费");
    await cards.locator('[data-field="purpose"] input, [data-field="purpose"] textarea').fill("购买文具");
    await cards.locator('[data-field="amountYuan"] input').fill("0.01");
    expect(await cards.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  } else {
    const grid = page.locator("revo-grid");
    for (const [column, value] of [[0, "办公费"], [2, "购买文具"], [4, "0.01"]] as const) {
      const cell = grid.locator(`[data-rgrow="0"][data-rgcol="${column}"]`);
      await cell.dblclick();
      const editor = grid.locator("revogr-edit input");
      await editor.fill(value);
      await editor.press("Enter");
      await expect(editor).toBeHidden();
      await expect(cell).toHaveText(value);
    }
  }
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  const saved = page.waitForResponse((response) => response.url().endsWith("/expense-claims") && response.request().method() === "POST");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const claim = await response.json();
  const detail = await request.get(`${process.env.POL115_API_URL}/expense-claims/${claim.id}`, { headers: { authorization: `Bearer ${session.tokens.accessToken}` } });
  expect(detail.ok()).toBe(true);
  expect(await detail.json()).toMatchObject({ status: "draft", requestedAmountCents: "1", reason: "真实浏览器报销明细", lines: [{ expenseCategory: "办公费", purpose: "购买文具", amountCents: "1" }], entrySnapshots: [] });
});

test("统一费用字段保存一分钱项目借款草稿，不自动提交审批", async ({ page, request }) => {
  const session = JSON.parse(process.env.POL115_BROWSER_SESSION!);
  const api = process.env.POL115_API_URL!;
  await page.addInitScript((value) => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), {
    user: session.user, accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken
  });
  await page.goto("/费用与报销工作台");
  await page.getByRole("button", { name: "新建费用报销 / 借款", exact: true }).click();
  await page.locator(".t-drawer").getByText("借款申请", { exact: true }).click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  const form = page.getByRole("region", { name: "费用申请单条业务表单" });
  await expect(form).toBeVisible();
  await form.locator('[data-field="reason"] textarea').fill("真实浏览器项目借款");
  await form.locator('[data-field="requestedAmountYuan"] input').fill("0.01");
  expect(await form.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  const payeeForm = page.getByRole("region", { name: "费用收款单条业务表单" });
  await expect(payeeForm).toBeVisible();
  await payeeForm.locator('[data-field="payeeName"] input').fill("合成收款人");
  await payeeForm.locator('[data-field="payeeBankAccount"] input').fill("000012340001");
  await payeeForm.locator('[data-field="loanExpectedClearanceOn"] input').click();
  await page.locator(".t-date-picker__cell--now").click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  const saved = page.waitForResponse((response) => response.url().endsWith("/expense-claims") && response.request().method() === "POST");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const claim = await response.json();
  const detail = await request.get(`${api}/expense-claims/${claim.id}`, { headers: { authorization: `Bearer ${session.tokens.accessToken}` } });
  expect(detail.ok()).toBe(true);
  expect(await detail.json()).toMatchObject({ status: "draft", requestedAmountCents: "1", reason: "真实浏览器项目借款", payeeNameSnapshot: "合成收款人", payeeBankAccountSnapshot: "000012340001", entrySnapshots: [] });
});
