import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("模板工作台真实创建、检查预览、取消发布、重试与冻结历史回读", async ({ page }, testInfo) => {
  const session = JSON.parse(process.env.TEMPLATE_WORKBENCH_SESSION!);
  await page.addInitScript(value => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), {
    user: session.user, accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken
  });
  const writes: string[] = [];
  page.on("request", request => {
    if (["POST", "PATCH"].includes(request.method())) writes.push(new URL(request.url()).pathname);
  });
  const name = `真实模板浏览器${testInfo.project.name}`;
  const code = `TB-${randomUUID()}`;
  await page.goto("/结算模板工作台/新建");
  await page.getByPlaceholder("请填写模板名称", { exact: true }).fill(name);
  await page.getByPlaceholder("请填写模板编码", { exact: true }).fill(code);
  await page.getByRole("button", { name: "返回模板库", exact: true }).click();
  await expect(page.getByText("放弃未保存的结算模板修改？", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByPlaceholder("请填写模板名称", { exact: true })).toHaveValue(name);
  await page.locator('input[type="file"]').setInputFiles(process.env.TEMPLATE_WORKBENCH_SOURCE!);
  await page.route("**/api/settlement-template-workbench/templates", async route => {
    if (route.request().method() === "POST") {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("failed");
    }
    else await route.continue();
  }, { times: 1 });
  await page.getByRole("button", { name: "创建草稿", exact: true }).click();
  await expect(page.getByText("网络连接失败，请检查网络后重试。", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("请填写模板名称", { exact: true })).toHaveValue(name);
  const creation = page.waitForResponse(response => new URL(response.url()).pathname === "/api/settlement-template-workbench/templates" && response.request().method() === "POST");
  await page.getByRole("button", { name: "创建草稿", exact: true }).dblclick();
  const response = await creation;
  expect(response.status()).toBe(201);
  const created = await response.json();
  await page.waitForURL(url => decodeURIComponent(url.pathname) === `/结算模板工作台/${created.template.id}`);
  await page.route("**/api/settlement-template-workbench/versions/*/inspection", route => route.fulfill({ status: 409, contentType: "text/plain", body: "Conflict" }), { times: 1 });
  await page.getByRole("button", { name: "执行检查", exact: true }).click();
  await expect(page.getByText("提交结算模板操作失败", { exact: true })).toBeVisible();
  await expect(page.getByText(/409|Conflict/)).toHaveCount(0);
  await page.getByRole("button", { name: "执行检查", exact: true }).click();
  await expect(page.getByText("未发现阻断项", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "生成 XLSX/PDF", exact: true }).click();
  await expect(page.getByText("当前修订样张已生成。", { exact: true })).toBeVisible();
  await page.getByPlaceholder("请填写明细必填列", { exact: true }).click();
  await page.getByText("调整原因", { exact: true }).last().click();
  await expect(page.getByRole("button", { name: "执行检查", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "生成 XLSX/PDF", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "提交发布", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "保存新修订", exact: true }).click();
  await page.getByRole("button", { name: "执行检查", exact: true }).click();
  await page.getByRole("button", { name: "生成 XLSX/PDF", exact: true }).click();
  await expect(page.getByText("当前修订样张已生成。", { exact: true })).toBeVisible();
  await page.route("**/api/settlement-template-workbench/versions/*/submission", async route => {
    expect((await route.fetch()).status()).toBe(201);
    await route.abort("failed");
  }, { times: 1 });
  await page.getByRole("button", { name: "提交发布", exact: true }).click();
  await expect(page.getByText("网络连接失败，请检查网络后重试。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "提交发布", exact: true }).click();
  await expect(page.getByText("版本已提交发布。", { exact: true })).toBeVisible();
  await page.getByPlaceholder("发布时必须说明本版本变化").fill("桌面手机真实发布验收");
  await page.getByRole("button", { name: "发布版本", exact: true }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  expect(writes.filter(path => path.endsWith("/publication"))).toHaveLength(0);
  await page.route("**/api/settlement-template-workbench/versions/*/publication", async route => {
    expect((await route.fetch()).status()).toBe(201);
    await route.abort("failed");
  }, { times: 1 });
  await page.getByRole("button", { name: "发布版本", exact: true }).click();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByText("网络连接失败，请检查网络后重试。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "发布版本", exact: true }).click();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByText("版本已发布。", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("提交时的模板内容", { exact: true })).toBeVisible();
  await expect(page.getByText("发布时的模板内容", { exact: true })).toBeVisible();
  await expect(page.getByText("以下内容来自发布时冻结的业务快照", { exact: true })).toBeVisible();
  expect(writes.filter(path => path === "/api/files")).toHaveLength(1);
  expect(writes.filter(path => path.endsWith("/submission"))).toHaveLength(2);
  expect(writes.filter(path => path.endsWith("/publication"))).toHaveLength(2);
  expect(writes.some(path => /^\/api\/settlement-template(?:s|-versions)(?:\/|$)/.test(path))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("published-template.png"), fullPage: true });
  await page.getByText("发布时的模板内容", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("published-template-viewport.png"), fullPage: false });
});
