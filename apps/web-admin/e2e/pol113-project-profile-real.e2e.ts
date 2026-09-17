import { expect, test } from "@playwright/test";

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
