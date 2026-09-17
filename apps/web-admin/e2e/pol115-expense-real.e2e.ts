import { expect, test } from "@playwright/test";

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
  await page.locator(".t-date-picker input").click();
  await page.locator(".t-date-picker__cell--now").click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  const saved = page.waitForResponse((response) => response.url().endsWith("/expense-claims") && response.request().method() === "POST");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const claim = await response.json();
  const detail = await request.get(`${api}/expense-claims/${claim.id}`, { headers: { authorization: `Bearer ${session.tokens.accessToken}` } });
  expect(detail.ok()).toBe(true);
  expect(await detail.json()).toMatchObject({ status: "draft", requestedAmountCents: "1", reason: "真实浏览器项目借款", entrySnapshots: [] });
});
