import { expect, test } from "@playwright/test";

test("资金执行抽屉展示真实冻结历史且窄屏不溢出", async ({ page }, testInfo) => {
  const session = JSON.parse(process.env.POL115_BROWSER_SESSION!);
  await page.addInitScript((value) => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify(value)), {
    user: session.user,
    accessToken: session.tokens.accessToken,
    refreshToken: session.tokens.refreshToken
  });
  const loaded = page.waitForResponse((response) => response.url().includes("/fund-executions/cases") && response.request().method() === "GET");
  await page.goto("/资金执行案件");
  const listResponse = await loaded;
  expect(listResponse.status()).toBe(200);
  const rows = await listResponse.json() as Array<{ caseLabel: string }>;
  expect(rows).toHaveLength(1);
  await page.getByText(rows[0]!.caseLabel, { exact: true }).click();
  const history = page.getByRole("region", { name: "资金执行提交记录" });
  await expect(history.getByRole("heading", { name: "第 1 次提交" })).toBeVisible();
  await expect(history.getByText("公司项目资金到账", { exact: true }).first()).toBeVisible();
  await expect(history.getByText("125.00 元", { exact: true }).first()).toBeVisible();
  expect(await history.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const text = await history.innerText();
  expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu);
  expect(testInfo.project.name === "desktop" || page.viewportSize()?.width === 390).toBe(true);
});
