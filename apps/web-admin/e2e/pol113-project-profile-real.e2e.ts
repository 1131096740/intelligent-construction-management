import { expect, test } from "@playwright/test";

test("切换项目丢弃旧名称草稿，旧目标不能在新项目预检且只保存新项目", async ({ page, request }, testInfo) => {
  const api = process.env.POL113_API_URL!;
  const session = JSON.parse(process.env.POL113_RENAME_SESSION!);
  const headers = { authorization: `Bearer ${session.tokens.accessToken}` };
  const projects: Array<{ id: string; code: string; name: string }> = [];
  for (const suffix of ["甲", "乙"]) {
    const created = await request.post(`${api}/projects`, { headers, data: {
      code: `SW-${testInfo.project.name}-${suffix}`, name: `切换验收${testInfo.project.name}${suffix}`
    } });
    expect(created.status()).toBe(201);
    projects.push(await created.json());
  }
  const [first, second] = projects;
  await page.addInitScript((value) => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), {
    user: session.user, accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken
  });
  await page.goto("/项目经营");
  async function select(project: typeof first) {
    await page.locator(".project-picker input").click();
    await page.locator(".t-select__dropdown:visible")
      .getByText(`${project.code} · ${project.name}`, { exact: true })
      .click();
    await expect(page.locator(".project-picker input")).toHaveValue(`${project.code} · ${project.name}`);
  }
  await select(first);
  await page.getByText("项目维护", { exact: true }).click();
  const form = page.getByRole("region", { name: "项目名称单条业务表单" });
  const name = form.locator('[data-field="name"] input');
  await expect(name).toHaveValue(first.name);
  await name.fill("甲项目未提交的草稿");
  const writes: string[] = [];
  page.on("request", (req) => { if (req.method() === "PATCH") writes.push(new URL(req.url()).pathname); });
  await select(second);
  await expect(name).toHaveValue(second.name);
  expect(writes).toEqual([]);
  const definition = await request.get(`${api}/business-entry-definitions/project_rename?${new URLSearchParams({ projectId: second.id, operation: "edit", targetEntityType: "project", targetEntityId: second.id })}`, { headers });
  expect(definition.ok()).toBe(true);
  const mismatched = await request.post(`${api}/business-entry-definitions/project_rename/validate?projectId=${second.id}`, { headers, data: {
    definitionVersion: (await definition.json()).version, target: { entityType: "project", entityId: first.id },
    values: { name: "甲项目未提交的草稿" }, operation: "edit"
  } });
  expect(mismatched.status()).toBe(400);
  await name.fill("乙项目切换后保存");
  const validated = page.waitForResponse((res) => res.url().includes("/project_rename/validate"));
  const saved = page.waitForResponse((res) => new URL(res.url()).pathname === `/api/projects/${second.id}` && res.request().method() === "PATCH");
  await page.getByRole("button", { name: "保存名称", exact: true }).click();
  expect((await validated).request().postDataJSON().target.entityId).toBe(second.id);
  expect((await saved).ok()).toBe(true);
  expect(writes).toEqual([`/api/projects/${second.id}`]);
  const readback = await request.get(`${api}/projects`, { headers });
  const current = await readback.json();
  expect(current.find((project: { id: string }) => project.id === first.id).name).toBe(first.name);
  expect(current.find((project: { id: string }) => project.id === second.id).name).toBe("乙项目切换后保存");
});

test("项目财务通过统一字段新增参与公司，空白原因保留且不新增", async ({ page, request }) => {
  const session = JSON.parse(process.env.POL113_BROWSER_SESSION!);
  const api = process.env.POL113_API_URL!;
  const projectId = process.env.POL113_PROJECT_ID!;
  const path = `/projects/${projectId}/participating-companies`;
  const headers = { authorization: `Bearer ${session.tokens.accessToken}` };
  await page.addInitScript((value) => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), {
    user: session.user, accessToken: session.tokens.accessToken, refreshToken: session.tokens.refreshToken
  });
  await page.goto("/项目经营");
  await page.getByText("项目设置", { exact: true }).click();
  const form = page.getByRole("region", { name: "新增参与公司单条业务表单" });
  await expect(form).toBeVisible();
  await form.locator('[data-field="companyEntityId"]').click();
  await page.getByText("参与主体合成验收公司", { exact: true }).last().click();
  const today = new Intl.DateTimeFormat("en-CA").format(new Date());
  await form.locator('[data-field="effectiveFrom"] input').click();
  await page.locator(".t-date-picker__panel .t-date-picker__cell--now").click();
  const reason = form.locator('[data-field="changeReason"] textarea');
  await reason.fill(" ");
  let writes = 0;
  page.on("request", (req) => { if (req.url().endsWith(path) && req.method() === "POST") writes += 1; });
  const save = page.getByRole("button", { name: "新增参与公司", exact: true });
  const invalid = page.waitForResponse((response) => response.url().includes("/project_participating_company_add/validate"));
  await save.click();
  expect((await invalid).ok()).toBe(true);
  await expect(form).toContainText("请填写加入原因");
  await expect(reason).toHaveValue(" ");
  expect(writes).toBe(0);
  await reason.fill("浏览器新增参与验收");
  const saved = page.waitForResponse((response) => response.url().endsWith(path) && response.request().method() === "POST", { timeout: 10_000 });
  await save.click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  const participant = await response.json();
  await expect(page.getByText("参与公司已加入", { exact: true })).toBeVisible();
  expect(writes).toBe(1);
  const profile = await request.get(`${api}/projects/${projectId}/operating-profile`, { headers });
  expect((await profile.json()).participatingCompanies).toContainEqual(expect.objectContaining({ id: participant.id, companyName: "参与主体合成验收公司", effectiveFrom: today, changeReason: "浏览器新增参与验收" }));
  expect(await form.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  // Only this test's synthetic, fact-free relation is removed through the original domain guard.
  expect((await request.delete(`${api}${path}/${participant.id}`, { headers })).ok()).toBe(true);
});

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
