import { expect, test } from "@playwright/test";

test("项目财务统一填写施工企业版本日期原因，预检失败保留输入且成功绑定可回读", async ({ page, request }) => {
  const session = JSON.parse(process.env.POL113_BROWSER_SESSION!);
  const api = process.env.POL113_API_URL!;
  const projectId = process.env.POL113_PROJECT_ID!;
  const path = `/projects/${projectId}/construction-enterprise`;
  const headers = { authorization: `Bearer ${session.tokens.accessToken}` };
  const optionsResponse = await request.get(`${api}${path}-options`, { headers });
  const enterprise = (await optionsResponse.json()).find((entry: { name: string }) => entry.name === "浏览器施工企业验收");
  expect(enterprise).toBeTruthy();
  await page.addInitScript((value) => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), {
    user: session.user, accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken
  });
  await page.goto("/项目经营");
  await page.getByText("项目设置", { exact: true }).click();
  const form = page.getByRole("region", { name: "项目施工企业单条业务表单" });
  await expect(form).toBeVisible();
  await form.locator('[data-field="businessPartyVersionId"]').click();
  await page.getByText("浏览器施工企业验收 · 第 1 版", { exact: true }).last().click();
  const today = new Intl.DateTimeFormat("en-CA").format(new Date());
  await form.locator('[data-field="effectiveFrom"] input').click();
  await page.locator(".t-date-picker__panel .t-date-picker__cell--now").click();
  await expect(form.locator('[data-field="effectiveFrom"] input')).toHaveValue(today);
  const reason = form.locator('[data-field="changeReason"] textarea');
  await reason.fill(" ");
  let writes = 0;
  page.on("request", (req) => { if (req.url().endsWith(path) && req.method() === "POST") writes += 1; });
  const save = page.getByRole("button", { name: /^(设置|变更)施工企业$/ });
  const invalid = page.waitForResponse((response) => response.url().includes("/project_construction_enterprise/validate"));
  await save.click();
  expect((await invalid).ok()).toBe(true);
  await expect(form).toContainText("请填写设置/变更原因");
  await expect(reason).toHaveValue(" ");
  expect(writes).toBe(0);
  await reason.fill("浏览器首次配置验收");
  const saved = page.waitForResponse((response) => response.url().endsWith(path) && response.request().method() === "POST", { timeout: 10_000 });
  await save.click();
  expect((await saved).ok()).toBe(true);
  await expect(page.getByText("施工企业已保存", { exact: true })).toBeVisible();
  expect(writes).toBe(1);
  const profile = await request.get(`${api}/projects/${projectId}/operating-profile`, { headers });
  expect((await profile.json()).constructionEnterprise).toMatchObject({ businessPartyVersionId: enterprise.id, effectiveFrom: today, isLocked: false });
  expect(await form.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("项目维护通过同一名称定义预检，空白输入保留且有效名称可保存", async ({ page, request }) => {
  const session = JSON.parse(process.env.POL113_RENAME_SESSION!);
  const api = process.env.POL113_API_URL!;
  const projects = await request.get(`${api}/projects`, { headers: { authorization: `Bearer ${session.tokens.accessToken}` } });
  const selected = (await projects.json())[0];
  const projectId = selected.id as string;
  const path = `/projects/${projectId}`;
  await page.addInitScript((value) => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), {
    user: session.user, accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken
  });
  await page.goto("/项目经营");
  await expect(page.locator(".project-picker input")).toHaveValue(`${selected.code} · ${selected.name}`);
  await page.getByText("项目维护", { exact: true }).click();
  const form = page.getByRole("region", { name: "项目名称单条业务表单" });
  await expect(form).toBeVisible();
  const name = form.locator('[data-field="name"] input');
  await name.fill("  ");
  let writes = 0;
  page.on("request", (req) => { if (req.url().endsWith(path) && req.method() === "PATCH") writes += 1; });
  const invalid = page.waitForResponse((response) => response.url().includes("/project_rename/validate"));
  await page.getByRole("button", { name: "保存名称", exact: true }).click();
  const invalidResponse = await invalid;
  expect(invalidResponse.ok()).toBe(true);
  expect(invalidResponse.request().postDataJSON().target.entityId).toBe(projectId);
  await expect(form).toContainText("请填写项目名称");
  await expect(name).toHaveValue("  ");
  expect(writes).toBe(0);
  await name.fill("浏览器重命名验收");
  const saved = page.waitForResponse((response) => /\/projects\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === "PATCH", { timeout: 10_000 });
  await page.getByRole("button", { name: "保存名称", exact: true }).click();
  const savedResponse = await saved;
  expect(new URL(savedResponse.url()).pathname.endsWith(path)).toBe(true);
  expect(savedResponse.ok()).toBe(true);
  await expect(page.getByText("项目名称已保存", { exact: true })).toBeVisible();
  expect(writes).toBe(1);
  const current = await request.get(`${api}/projects`, { headers: { authorization: `Bearer ${session.tokens.accessToken}` } });
  expect((await current.json()).find((entry: { id: string }) => entry.id === projectId).name).toBe("浏览器重命名验收");
  expect(await form.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("项目财务通过统一字段保存档案，预检失败保留输入且不写业务", async ({ page, request }) => {
  const session = JSON.parse(process.env.POL113_BROWSER_SESSION!);
  const api = process.env.POL113_API_URL!;
  const projectId = process.env.POL113_PROJECT_ID!;
  const profilePath = `/projects/${projectId}/operating-profile`;
  const reset = await request.patch(`${api}${profilePath}`, {
    headers: { authorization: `Bearer ${session.tokens.accessToken}` },
    data: { operatingLedgerEffectiveDate: null, takeoverCompletedDate: null, takeoverStatus: "balance_review" }
  });
  expect(reset.ok()).toBe(true);
  await page.addInitScript((value) => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), {
    user: session.user, accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken
  });
  await page.goto("/项目经营");
  await page.getByText("项目设置", { exact: true }).click();
  const form = page.getByRole("region", { name: "项目经营档案单条业务表单" });
  await expect(form).toBeVisible();
  const status = form.locator('[data-field="takeoverStatus"]');
  await status.click();
  await page.getByText("经营接管完成", { exact: true }).last().click();
  let writes = 0;
  page.on("request", (req) => { if (req.url().endsWith(profilePath) && req.method() === "PATCH") writes += 1; });
  const save = page.getByRole("button", { name: "保存经营档案", exact: true });
  const invalid = page.waitForResponse((response) => response.url().includes("/project_operating_profile/validate"));
  await save.click();
  expect((await invalid).ok()).toBe(true);
  await expect(form).toContainText("接管完成时必须填写经营接管完成日");
  await expect(status.locator("input")).toHaveValue("经营接管完成");
  expect(writes).toBe(0);
  await status.click();
  await page.getByText("需要补充复核", { exact: true }).last().click();
  const saved = page.waitForResponse((response) => response.url().endsWith(profilePath) && response.request().method() === "PATCH");
  await save.click();
  expect((await saved).ok()).toBe(true);
  await expect(page.getByText("项目经营档案已保存", { exact: true })).toBeVisible();
  expect(writes).toBe(1);
  const current = await request.get(`${api}${profilePath}`, { headers: { authorization: `Bearer ${session.tokens.accessToken}` } });
  expect((await current.json()).takeoverStatus).toBe("supplemental_review");
  expect(await form.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
