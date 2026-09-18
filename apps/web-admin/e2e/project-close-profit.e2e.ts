import { expect, type Page, test } from "@playwright/test";

const projectId = "seed-project-jgxm-001";
const seedPassword = process.env.SEED_PASSWORD ?? "";

test.skip(
  process.env.POL109_REAL_BROWSER !== "1",
  "仅由 POL-109 本机 PG16 runner 启动真实 API 后执行"
);

async function login(page: Page) {
  expect(seedPassword.length).toBeGreaterThanOrEqual(12);
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13800001002");
  await page.getByPlaceholder("请输入密码").fill(seedPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login/u);
}

async function openCloseProfit(page: Page) {
  await page.goto("/项目经营");
  const selectedProject = await page.evaluate(async (expectedId) => {
    const rawSession = localStorage.getItem("jiangkong-web-admin-auth");
    const session = rawSession
      ? JSON.parse(rawSession) as { accessToken?: string }
      : null;
    const response = await fetch("/api/projects", {
      headers: session?.accessToken
        ? { Authorization: `Bearer ${session.accessToken}` }
        : {}
    });
    if (!response.ok) throw new Error(`项目选项读取失败：${response.status}`);
    const projects = await response.json() as unknown;
    if (!Array.isArray(projects)) throw new Error("项目选项响应不是数组");
    return projects.find((project) => project.id === expectedId) ?? null;
  }, projectId);
  expect(selectedProject, "真实 seed 项目必须可见").not.toBeNull();
  await page.locator(".project-picker input").click();
  await page.locator(".t-select__dropdown:visible")
    .getByText(`${selectedProject!.code} · ${selectedProject!.name}`, { exact: true })
    .click();
  await page.getByText("项目收口与盈亏", { exact: true }).click();
  await expect(page.locator(".close-profit-panel")).toBeVisible();
}

test("真实 API/PG16 项目收口桌面刷新和重进仍回读七阶段与历史", async ({ page }) => {
  await login(page);
  await openCloseProfit(page);
  await expect(page.getByRole("heading", { name: "项目收口与盈亏" })).toBeVisible();
  await expect(page.locator(".stage-card")).toHaveCount(7);
  await expect(page.getByText("暂分利润", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("公司盈亏分配", { exact: true })).toBeVisible();
  await expect(page.getByText("历史影响", { exact: true })).toBeVisible();

  await page.reload();
  await openCloseProfit(page);
  await expect(page.locator(".stage-card")).toHaveCount(7);
  await expect(page.getByText("公司盈亏分配", { exact: true })).toBeVisible();
});

test("RC-06 真实 API/PG16 项目收口移动刷新重进仍可见且无面板横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await openCloseProfit(page);
  await expect(page.getByText("最终公司差额", { exact: true })).toBeVisible();
  const panel = page.locator(".close-profit-panel");
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  await page.reload();
  await openCloseProfit(page);
  await expect(page.locator(".stage-card")).toHaveCount(7);
});
