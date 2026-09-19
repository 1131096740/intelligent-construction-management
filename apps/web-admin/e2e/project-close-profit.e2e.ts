import { expect, type Page, test } from "@playwright/test";

const projectId = "seed-project-jgxm-001";
const seedPassword = process.env.SEED_PASSWORD ?? "";

test.skip(
  process.env.POL109_REAL_BROWSER !== "1",
  "仅由 POL-109 本机 PG16 runner 启动真实 API 后执行"
);

async function login(page: Page, phone = "13800001002") {
  expect(seedPassword.length).toBeGreaterThanOrEqual(12);
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill(phone);
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

function centsToYuan(cents: string) {
  const negative = cents.startsWith("-");
  const digits = negative ? cents.slice(1) : cents;
  const padded = digits.padStart(3, "0");
  return `${negative ? "-" : ""}${padded.slice(0, -2)}.${padded.slice(-2)}`;
}

test("真实 API/PG16 项目收口桌面刷新和重进仍回读七阶段与历史", async ({ page }) => {
  await login(page);
  await openCloseProfit(page);
  await expect(page.getByRole("heading", { name: "项目收口与盈亏" })).toBeVisible();
  await expect(page.locator(".stage-card")).toHaveCount(7);
  await expect(page.getByText("暂分利润", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("公司盈亏分配", { exact: true })).toBeVisible();
  await expect(page.getByText("历史影响", { exact: true })).toBeVisible();
  await page.getByText("查看统一经营投影事实", { exact: true }).click();
  await expect(page.getByText("投影截止时间", { exact: true })).toBeVisible();
  await expect(page.getByText("双专业确认", { exact: true })).toBeVisible();
  await expect(page.getByText("收口历史版本", { exact: true })).toBeVisible();
  await expect(page.getByText("阶段确认", { exact: true })).toBeVisible();
  await expect(page.getByText("最终盈亏确认", { exact: true })).toBeVisible();
  await expect(page.getByText("历史公司分配", { exact: true })).toBeVisible();

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
  await expect(page.getByText("收口历史版本", { exact: true })).toBeVisible();
});

test("真实 API/PG16 技术管理员只能回看且不能执行收口命令", async ({ page }) => {
  await login(page, "13800001015");
  await openCloseProfit(page);
  await expect(page.getByRole("heading", { name: "项目收口与盈亏" })).toBeVisible();
  await expect(page.locator(".stage-actions button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "登记暂分利润" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "确认公司分配" })).toHaveCount(0);
  await expect(page.getByText("收口历史版本", { exact: true })).toBeVisible();
});

test("真实 API/PG16 页面完成财务提交到高管确认的重确认链", async ({ page }) => {
  await login(page, "13800001004");
  await openCloseProfit(page);
  await page.getByPlaceholder("请说明核对范围、依据和结论；系统会与本次经营快照一起冻结")
    .fill("浏览器验收：合同专业重新确认成本");
  await page.getByRole("button", { name: "确认合同成本" }).click();
  await expect(page.getByText("操作已完成", { exact: true })).toBeVisible();

  await page.evaluate(() => localStorage.removeItem("jiangkong-web-admin-auth"));
  await login(page, "13800001007");
  await openCloseProfit(page);
  await page.getByPlaceholder("请说明核对范围、依据和结论；系统会与本次经营快照一起冻结")
    .fill("浏览器验收：财务专业重新确认成本");
  await page.getByRole("button", { name: "确认财务成本" }).click();
  await expect(page.getByText("操作已完成", { exact: true })).toBeVisible();
  await page.getByPlaceholder("请说明核对范围、依据和结论；系统会与本次经营快照一起冻结")
    .fill("浏览器验收：财务重新制作最终盈亏");
  await page.getByRole("button", { name: "制作并提交最终盈亏" }).click();
  await expect(page.getByText("操作已完成", { exact: true })).toBeVisible();
  await expect(page.getByText(/待高管确认：最终盈亏第/u)).toBeVisible();

  await page.evaluate(() => localStorage.removeItem("jiangkong-web-admin-auth"));
  await login(page, "13800001001");
  await openCloseProfit(page);
  await page.getByRole("button", { name: "最终确认盈亏" }).click();
  await expect(page.getByText("操作已完成", { exact: true })).toBeVisible();

  await page.evaluate(() => localStorage.removeItem("jiangkong-web-admin-auth"));
  await login(page, "13800001007");
  await openCloseProfit(page);
  const decision = await page.evaluate(async (expectedProjectId) => {
    const rawSession = localStorage.getItem("jiangkong-web-admin-auth");
    const session = rawSession
      ? JSON.parse(rawSession) as { accessToken?: string }
      : null;
    const response = await fetch(`/api/projects/${expectedProjectId}/close-profit`, {
      headers: session?.accessToken
        ? { Authorization: `Bearer ${session.accessToken}` }
        : {}
    });
    if (!response.ok) throw new Error(`项目收口工作台读取失败：${response.status}`);
    const workbench = await response.json() as {
      currentProfitConfirmation: { finalProfitCents: string };
      participatingCompanies: Array<{ id: string }>;
    };
    return workbench;
  }, projectId);
  const distributionGrid = page.getByRole("treegrid", { name: "公司盈亏分配业务台账表格" });
  const distributionCells = distributionGrid.getByRole("gridcell");
  await expect(distributionCells).toHaveCount(decision.participatingCompanies.length * 2);
  for (let index = 0; index < decision.participatingCompanies.length; index += 1) {
    await distributionCells.nth(index * 2 + 1).dblclick();
    await page.keyboard.insertText(index === 0
      ? centsToYuan(decision.currentProfitConfirmation.finalProfitCents)
      : "0.00");
    await page.keyboard.press("Enter");
  }
  await page.getByPlaceholder("请说明核对范围、依据和结论；系统会与本次经营快照一起冻结")
    .fill("浏览器验收：财务重新制作公司分配");
  await page.getByRole("button", { name: "制作并提交公司分配" }).click();
  await expect(page.getByText("操作已完成", { exact: true })).toBeVisible();
  await expect(page.getByText(/待高管确认：公司分配第/u)).toBeVisible();

  await page.evaluate(() => localStorage.removeItem("jiangkong-web-admin-auth"));
  await login(page, "13800001002");
  await openCloseProfit(page);
  await page.getByRole("button", { name: "确认公司分配" }).click();
  await expect(page.getByText("操作已完成", { exact: true })).toBeVisible();
  await page.reload();
  await openCloseProfit(page);
  await expect(page.getByText("历史公司分配", { exact: true })).toBeVisible();
});
