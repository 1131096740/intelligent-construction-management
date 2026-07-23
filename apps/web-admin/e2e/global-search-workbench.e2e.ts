import { expect, test, type Page } from "@playwright/test";
import {
  expectHorizontalScrollOwner,
  expectNoDocumentHorizontalOverflow,
  expectNoNestedHorizontalScrollers
} from "./helpers/responsive-assertions";

const viewports = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 430, height: 932 },
  { width: 390, height: 844 },
  { width: 360, height: 800 },
  { width: 320, height: 568 }
] as const;

test("全局搜索工作台在九档视口、缩放和键盘路径保持只读可用", async ({ page }) => {
  await mockSearchSession(page);
  await login(page);

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/全局搜索");
    await expect(page.getByRole("heading", { name: "全局搜索" })).toBeVisible();
    await expect(page.getByPlaceholder("输入项目、编号、相对方、状态、文件名，可用空格组合")).toBeVisible();
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoNestedHorizontalScrollers(page);
    if (viewport.width <= 1280) {
      await expectHorizontalScrollOwner(page.locator(".jg-table-region .t-table__content"));
    }
  }

  const searchInput = page.getByPlaceholder("输入项目、编号、相对方、状态、文件名，可用空格组合");
  await searchInput.fill("HT-2026-018");
  await searchInput.press("Enter");
  await expect(page.getByText("已筛选出 1 条结果。", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await expectNoDocumentHorizontalOverflow(page);
  await page.evaluate(() => {
    document.documentElement.style.zoom = "";
  });
});

test("全局搜索读取失败时可重试且不改变已有读取路径", async ({ page }) => {
  let failContracts = true;
  await mockSearchSession(page, () => failContracts);
  await login(page);
  await page.goto("/全局搜索");

  await expect(page.getByText("读取结果失败", { exact: true })).toBeVisible();
  failContracts = false;
  await page.getByRole("button", { name: "重新加载" }).click();
  await expect(page.getByText("HT-2026-018", { exact: true })).toBeVisible();
});

async function mockSearchSession(page: Page, shouldFailContracts: () => boolean = () => false) {
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: "global-search-canary",
        name: "搜索金丝雀",
        phone: "13900000000",
        mustChangePassword: false,
        roleKeys: ["super_admin"],
        globalRoleKeys: ["super_admin"]
      },
      tokens: { accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 900 }
    })
  }));
  await page.route("**/api/me/work-items", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      generatedAt: "2026-07-23T00:00:00.000Z",
      visibleProjectCount: 1,
      queues: { pending: [], blocked: [], started: [] },
      approvalCenter: {
        pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: []
      }
    })
  }));
  await page.route("**/api/contracts", (route) => {
    if (shouldFailContracts()) return route.fulfill({ status: 500, body: JSON.stringify({ message: "读取合同失败" }) });
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ rows: [{
        id: "contract-canary",
        contractNo: "HT-2026-018",
        name: "科技园材料采购合同",
        project: "科技园项目",
        counterparty: "城建物资公司",
        amount: "¥1,200,000.00",
        version: "V1",
        currentNode: "履约中",
        nodeTone: "success",
        ownerDepartment: "合同部",
        pendingOwner: "合同主管",
        stalledFor: "1 天",
        returnReason: "—",
        nextAction: "查看详情",
        updatedAt: "2026-07-23 12:00"
      }], summary: { total: 1, inApproval: 0, pendingSeal: 0, pendingArchive: 0, effective: 1 } })
    });
  });
  await page.route("**/api/settlements", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ rows: [], summary: { total: 0, inApproval: 0, pendingArchive: 0, effective: 0, payable: 0 } })
  }));
  await page.route("**/api/payments", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ rows: [], summary: { total: 0, pendingApproval: 0, orSign: 0, pendingPayment: 0, paid: 0 } })
  }));
  await page.route("**/api/archives", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ rows: [], summary: { total: 0, contractArchives: 0, settlementArchives: 0, paymentFiles: 0, pending: 0 } })
  }));
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
}
