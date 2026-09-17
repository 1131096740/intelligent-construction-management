import { expect, test } from "@playwright/test";

test("本人资料使用服务端字段和预检，失败保留输入，保存沿用原账号会话", async ({ page, request }) => {
  const login = await request.post("http://127.0.0.1:4313/auth/login", {
    data: { phone: "13900000113", password: "Local-pol113-browser-only" }
  });
  expect(login.ok()).toBeTruthy();
  const session = await login.json();
  await page.addInitScript((value) => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), {
    user: session.user, accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken
  });
  const definitionRead = page.waitForResponse((response) => response.url().includes("/business-entry-definitions/user_self_profile?") && response.request().method() === "GET");
  await page.goto("/settings");
  expect((await definitionRead).ok()).toBeTruthy();
  const form = page.getByRole("region", { name: "本人资料单条业务表单" });
  await expect(form).toBeVisible();
  const name = form.locator('[data-field="name"] input');
  const phone = form.locator('[data-field="phone"] input');
  await name.fill("浏览器资料经办人");
  await phone.fill("123");
  const account = page.locator("form").filter({ has: form });
  await account.locator('input[type="password"]').fill("Local-pol113-browser-only");
  let writes = 0;
  page.on("request", (req) => { if (req.url().endsWith("/auth/profile") && req.method() === "PATCH") writes += 1; });
  const invalid = page.waitForResponse((response) => response.url().includes("/user_self_profile/validate"));
  await account.getByRole("button", { name: "保存基本资料" }).click();
  expect((await invalid).ok()).toBeTruthy();
  await expect(account).toContainText("请输入正确的中国大陆手机号");
  await expect(name).toHaveValue("浏览器资料经办人");
  await expect(phone).toHaveValue("123");
  expect(writes).toBe(0);
  await phone.fill("13900000113");
  await account.locator('input[type="password"]').fill("Local-pol113-browser-only");
  const saved = page.waitForResponse((response) => response.url().endsWith("/auth/profile") && response.request().method() === "PATCH");
  await account.getByRole("button", { name: "保存基本资料" }).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(account).toContainText("基本资料已更新");
  expect(writes).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
