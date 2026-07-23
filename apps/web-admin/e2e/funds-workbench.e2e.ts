import { expect, test, type Page } from "@playwright/test";
import {
  expectNoDocumentHorizontalOverflow,
  expectNoNestedHorizontalScrollers
} from "./helpers/responsive-assertions";

test("统一资金办理工作台只读取服务端聚合并按视图和来源筛选", async ({ page }) => {
  const requests: string[] = [];
  await mockFundsSession(page, requests);
  await login(page);

  await page.goto("/统一资金办理工作台");
  await expect(page.getByRole("heading", { name: "统一资金办理工作台" })).toBeVisible();
  await expect(page.getByText("BX-20260723-001", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "费用报销补付", exact: true }).first()).toBeVisible();
  await expect(page.getByText("实际付款仍在各来源的受控流程中办理", { exact: false })).toBeVisible();
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByRole("textbox", { name: "视图" }).click();
  await page.getByRole("listitem", { name: "已批待付", exact: true }).click();
  await page.getByRole("textbox", { name: "来源" }).click();
  await page.getByRole("listitem", { name: "费用报销补付", exact: true }).click();
  await expect.poll(() => requests).toContain("/api/funds-workbench?view=pending_funds&source=expense_reimbursement");
});

async function mockFundsSession(page: Page, requests: string[]) {
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: "funds-canary",
        name: "资金金丝雀",
        phone: "13900000003",
        mustChangePassword: false,
        roleKeys: ["finance_staff"],
        globalRoleKeys: ["finance_staff"]
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
      approvalCenter: { pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: [] }
    })
  }));
  await page.route("**/api/funds-workbench*", (route) => {
    const url = new URL(route.request().url());
    requests.push(`${url.pathname}${url.search}`);
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({
      view: url.searchParams.get("view") ?? "all",
      source: url.searchParams.get("source") ?? "all",
      viewCounts: { all: 2, in_progress: 0, pending_funds: 2, completed: 0 },
      sourceCounts: { contract_payment: 1, spot_procurement_payment: 0, expense_reimbursement: 1, loan_disbursement: 0 },
      items: [
        {
          id: "expense-1", code: "BX-20260723-001", source: "expense_reimbursement",
          project: null, sourceDocument: "费用报销补付", reason: "现场交通", payeeName: "张三", payerName: "建工智管有限公司",
          requestedAmountCents: "100000", paidAmountCents: "0", remainingAmountCents: "100000",
          status: "approved_pending_payment", statusLabel: "已批待付", updatedAt: "2026-07-23T10:00:00.000Z"
        },
        {
          id: "payment-1", code: "FK-20260723-001", source: "contract_payment",
          project: { id: "project-1", code: "JG-001", name: "科技园" }, sourceDocument: "合同结算付款", reason: "合同付款申请", payeeName: null, payerName: null,
          requestedAmountCents: "200000", paidAmountCents: "0", remainingAmountCents: "200000",
          status: "approved_pending_payment", statusLabel: "已批待付", updatedAt: "2026-07-23T09:00:00.000Z"
        }
      ]
    }) });
  });
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000003");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
}
