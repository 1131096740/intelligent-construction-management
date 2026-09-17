import { expect, test } from "@playwright/test";

test("本人资料使用服务端字段和预检，失败保留输入，保存沿用原账号会话", async ({ page, request }, testInfo) => {
  const api = process.env.POL113_API_URL ?? "";
  const accounts = JSON.parse(process.env.POL113_SETTINGS_ACCOUNTS ?? "{}");
  const accountFixture = accounts[testInfo.project.name];
  expect(accountFixture, "每个浏览器须有独立合成账号").toBeTruthy();
  const { phone: oldPhone, newPhone, password } = accountFixture;
  const login = await request.post(`${api}/auth/login`, {
    data: { phone: oldPhone, password }
  });
  expect(login.ok()).toBeTruthy();
  const session = await login.json();
  await page.addInitScript((value) => {
    if (!localStorage.getItem("jiangkong-web-admin-auth")) localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value));
  }, {
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
  await account.locator('input[type="password"]').fill(password);
  let writes = 0;
  page.on("request", (req) => { if (req.url().endsWith("/auth/profile") && req.method() === "PATCH") writes += 1; });
  const invalid = page.waitForResponse((response) => response.url().includes("/user_self_profile/validate"));
  await account.getByRole("button", { name: "保存基本资料" }).click();
  expect((await invalid).ok()).toBeTruthy();
  await expect(account).toContainText("请输入正确的中国大陆手机号");
  await expect(name).toHaveValue("浏览器资料经办人");
  await expect(phone).toHaveValue("123");
  expect(writes).toBe(0);
  await phone.fill(newPhone);
  await account.locator('input[type="password"]').fill("incorrect-synthetic-password");
  const denied = page.waitForResponse((response) => response.url().endsWith("/auth/profile") && response.request().method() === "PATCH");
  await account.getByRole("button", { name: "保存基本资料" }).click();
  expect((await denied).status()).toBe(400);
  const unchanged = await request.post(`${api}/auth/login`, { data: { phone: oldPhone, password } });
  expect(unchanged.ok()).toBeTruthy();
  expect((await unchanged.json()).user.name).toBe("本人资料浏览器合成账号");
  await expect(phone).toHaveValue(newPhone);
  await account.locator('input[type="password"]').fill(password);
  const saved = page.waitForResponse((response) => response.url().endsWith("/auth/profile") && response.request().method() === "PATCH");
  await account.getByRole("button", { name: "保存基本资料" }).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(account).toContainText("基本资料已更新");
  expect(writes).toBe(2);
  expect(await page.evaluate((previous) => {
    const stored = JSON.parse(localStorage.getItem("jiangkong-web-admin-auth") ?? "{}");
    return Boolean(stored.accessToken && stored.refreshToken && stored.accessToken !== previous.accessToken && stored.refreshToken !== previous.refreshToken);
  }, session.tokens)).toBe(true);
  const reloadedDefinition = page.waitForResponse((response) => response.url().includes("/business-entry-definitions/user_self_profile?") && response.request().method() === "GET");
  await page.reload();
  expect((await reloadedDefinition).ok()).toBeTruthy();
  await expect(name).toHaveValue("浏览器资料经办人");
  await expect(phone).toHaveValue(newPhone);
  const current = await request.post(`${api}/auth/login`, { data: { phone: newPhone, password } });
  expect(current.ok()).toBeTruthy();
  expect((await current.json()).user).toMatchObject({ id: session.user.id, name: "浏览器资料经办人", phone: newPhone });
  expect((await request.post(`${api}/auth/login`, { data: { phone: oldPhone, password } })).status()).toBe(401);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
