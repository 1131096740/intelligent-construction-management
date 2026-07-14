import { expect, test } from "@playwright/test";

test("separates the payment ledger from the contract-linked creation workbench", async ({
  page
}, testInfo) => {
  let createdBody: Record<string, unknown> | null = null;

  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "finance-e2e-user",
          name: "财务验收用户",
          phone: "13900000000",
          mustChangePassword: false,
          roleKeys: ["finance_staff"],
          globalRoleKeys: ["finance_staff"]
        },
        tokens: {
          accessToken: "payment-e2e-access-token",
          refreshToken: "payment-e2e-refresh-token",
          expiresIn: 900
        }
      })
    })
  );
  await page.route("**/api/me/work-items", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: new Date().toISOString(),
        visibleProjectCount: 1,
        queues: { pending: [], blocked: [], started: [] },
        approvalCenter: {
          pendingApproval: [],
          startedByMe: [],
          handledByMe: [],
          delegatedToMe: [],
          overdueReminder: []
        }
      })
    })
  );
  await page.route("**/api/approval-delegations/user-options", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{ id: "project-1", code: "P001", name: "科技园项目" }])
    })
  );
  await page.route("**/api/contracts/payment-create-options?*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          contractId: "contract-1",
          contractVersionId: "version-1",
          contractNo: "HT-2026-001",
          contractName: "科技园钢材采购合同",
          counterparty: "城建物资公司",
          amountCents: "12500000",
          versionLabel: "v1",
          contractStatus: "effective",
          contractStatusLabel: "已生效",
          source: "system",
          sourceLabel: "系统合同",
          takeoverLevel: null,
          takeoverStatus: null,
          takeoverStatusLabel: null,
          historicalBalanceConfirmedAt: null,
          canCreateSettlement: true,
          settlementUnavailableReason: null,
          canCreatePayment: true,
          paymentUnavailableReason: null,
          settlements: [
            {
              settlementId: "settlement-1",
              settlementNo: "JS-2026-001",
              periodLabel: "2026-06",
              amountCents: "5000000",
              payableAmountCents: "5000000",
              paidAmountCents: "0",
              status: "effective",
              statusLabel: "已生效",
              canCreatePayment: true,
              unavailableReason: null
            }
          ]
        }
      ])
    })
  );
  await page.route("**/api/payments", async (route) => {
    if (route.request().method() === "POST") {
      createdBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ id: "payment-1", code: "FK-E2E-001" })
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        rows: [],
        summary: { total: 0, pendingApproval: 0, orSign: 0, pendingPayment: 0, paid: 0 }
      })
    });
  });
  await page.route("**/api/payments/FK-E2E-001", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ message: "E2E 仅验证创建后路由" })
    })
  );

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Payment@2026");
  await page.getByRole("button", { name: "登录" }).click();

  await page.goto("/付款管理");
  await expect(page.getByRole("heading", { name: "付款管理" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "付款台账", exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("payment-ledger-1440.png"),
    fullPage: true
  });
  await page.getByRole("button", { name: "新建付款申请" }).click();
  await expect(page).toHaveURL(/%E4%BB%98%E6%AC%BE%E5%B7%A5%E4%BD%9C%E5%8F%B0/u);
  await expect(page.getByRole("heading", { name: "付款工作台" })).toBeVisible();

  const selects = page.locator(".create-grid .t-select");
  await expect(selects).toHaveCount(3);
  await selects.nth(1).click();
  await page
    .getByText("HT-2026-001 · 科技园钢材采购合同 · 城建物资公司", { exact: true })
    .last()
    .click();
  await selects.nth(2).click();
  await page.getByText("单张结算付款", { exact: true }).last().click();
  await expect(selects).toHaveCount(4);
  await selects.nth(3).click();
  await page.getByText("JS-2026-001 · 2026-06 · ¥50,000.00", { exact: true }).last().click();

  await page.getByPlaceholder("FK-2026-007").fill("FK-E2E-001");
  await page.getByPlaceholder("请输入申请金额").fill("50000.00");
  await page.screenshot({
    path: testInfo.outputPath("payment-workbench-1440.png"),
    fullPage: true
  });
  await page.getByRole("button", { name: "创建付款申请" }).click();

  await expect
    .poll(() => decodeURIComponent(new URL(page.url()).pathname))
    .toBe("/付款管理/FK-E2E-001");
  expect(createdBody).toEqual({
    sourceType: "settlement",
    code: "FK-E2E-001",
    requestedAmountCents: "5000000",
    settlementId: "settlement-1"
  });
});
