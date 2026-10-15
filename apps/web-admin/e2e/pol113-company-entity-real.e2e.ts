import { expect, test } from "@playwright/test";

test("综合部从我方公司台账新增修改启停，桌面手机保留历史", async ({ page, request }, testInfo) => {
  const api = process.env.POL113_API_URL ?? "";
  expect(Boolean(process.env.POL113_MASTER_DATA_SESSION)).toBe(true);
  const session = JSON.parse(process.env.POL113_MASTER_DATA_SESSION!);
  await page.addInitScript((value) => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), {
    user: session.user, accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken
  });
  const name = `浏览器我方公司${testInfo.project.name}`;
  const code = testInfo.project.name === "desktop" ? "91530100MA6K000013" : "91530100MA6K000026";
  await page.goto("/我方公司主体");
  await page.getByRole("button", { name: "新增我方公司", exact: true }).click();
  const drawer = page.locator(".t-drawer:visible");
  await drawer.getByPlaceholder("请填写公司名称", { exact: true }).fill(name);
  await drawer.getByPlaceholder("请填写统一社会信用代码", { exact: true }).fill(code);
  await drawer.getByPlaceholder("请填写注册地址", { exact: true }).fill("本机合成地址");
  const created = page.waitForResponse((res) => new URL(res.url()).pathname === "/api/company-entities" && res.request().method() === "POST");
  await drawer.getByRole("button", { name: "保存", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const id = (await response.json()).entity.id;
  const row = page.getByRole("row").filter({ hasText: code });
  await expect(row).toContainText(name);
  await row.getByRole("button", { name: "修改", exact: true }).click();
  await drawer.getByPlaceholder("请填写公司名称", { exact: true }).fill(`${name}更名`);
  const changed = page.waitForResponse((res) => new URL(res.url()).pathname === `/api/company-entities/${id}` && res.request().method() === "PATCH");
  await drawer.getByRole("button", { name: "保存", exact: true }).click();
  expect((await changed).status()).toBe(200);
  await expect(row).toContainText(`${name}更名`);
  for (const action of ["停用", "重新启用"]) {
    await row.getByRole("button", { name: action, exact: true }).click();
    const saved = page.waitForResponse((res) => new URL(res.url()).pathname === `/api/company-entities/${id}/status` && res.request().method() === "POST");
    await page.locator(".t-dialog:visible").getByRole("button", { name: "确认", exact: true }).click();
    expect((await saved).status()).toBe(201);
    await expect(row.getByRole("button", { name: action === "停用" ? "重新启用" : "停用", exact: true })).toBeVisible();
  }
  await page.reload();
  await expect(row).toContainText(`${name}更名`);
  await row.getByRole("button", { name: "查看历史", exact: true }).click();
  await expect(page.locator(".t-drawer:visible").getByText("主体历史", { exact: true })).toBeVisible();
  const result = await request.get(`${api}/company-entities/${id}/history`, { headers: { authorization: `Bearer ${session.tokens.accessToken}` } });
  expect(result.status()).toBe(200);
  expect((await result.json()).versions).toEqual([
    expect.objectContaining({ versionNo: 4, isActive: true }),
    expect.objectContaining({ versionNo: 3, isActive: false }),
    expect.objectContaining({ versionNo: 2, name: `${name}更名` }),
    expect.objectContaining({ versionNo: 1, name })
  ]);
});
