import { expect, test } from "@playwright/test";

test("合同岗从公开入口创建合作单位，错误资料零写且刷新可回读", async ({ page, request }, testInfo) => {
  const api = process.env.POL113_API_URL ?? "";
  expect(Boolean(process.env.POL113_PARTY_SESSION), "必须提供真实合同岗合成会话").toBe(true);
  const session = JSON.parse(process.env.POL113_PARTY_SESSION!);
  await page.addInitScript((value) => {
    if (!localStorage.getItem("jiangkong-web-admin-auth")) localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value));
  }, { user: session.user, accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken });
  const name = `浏览器合作单位验收${testInfo.project.name}`;
  const writes: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST") writes.push(new URL(req.url()).pathname.replace(/^\/api/, ""));
  });
  await page.goto("/business-parties");
  await page.getByRole("button", { name: "新建合作单位", exact: true }).click();
  await expect(page.getByRole("heading", { name: "新建合作单位" })).toBeVisible();
  const submit = page.locator("form").getByRole("button", { name: "确认创建", exact: true });
  await expect(submit).toBeEnabled();
  await page.getByPlaceholder("请填写合作单位名称").fill(name);
  const code = page.getByPlaceholder("可选，填写 18 位统一社会信用代码");
  await code.fill("INVALID");
  await submit.click();
  await expect(page.getByText("统一社会信用代码格式或校验位不正确", { exact: true }).first()).toBeVisible();
  await expect(code).toHaveValue("INVALID");
  expect(writes.filter((path) => path === "/business-parties")).toHaveLength(0);
  const headers = { authorization: `Bearer ${session.tokens.accessToken}` };
  const before = await request.get(`${api}/business-parties?query=${encodeURIComponent(name)}`, { headers });
  expect(await before.json()).toEqual([]);
  await code.fill("");
  await submit.click();
  const confirmation = page.locator("button:visible").filter({ hasText: "确认创建" });
  await expect(confirmation).toHaveCount(2);
  const created = page.waitForResponse((res) => new URL(res.url()).pathname === "/api/business-parties" && res.request().method() === "POST");
  await confirmation.last().click();
  const response = await created;
  expect(response.status()).toBe(201);
  const result = await response.json();
  await page.waitForURL(`**/business-parties/${result.party.id}`);
  await page.reload();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  const list = await request.get(`${api}/business-parties?query=${encodeURIComponent(name)}`, { headers });
  expect(await list.json()).toEqual([expect.objectContaining({ id: result.party.id, name })]);
  expect(writes.filter((path) => path === "/business-parties")).toHaveLength(1);
  for (const path of ["/business-entry-definitions/business-party/create/probe", "/business-entry-definitions/business-party/create/submission-target", "/business-entry-definitions/business-party/create/validate", "/business-entry-definitions/business_party/freeze"]) expect(writes).toContain(path);
});
