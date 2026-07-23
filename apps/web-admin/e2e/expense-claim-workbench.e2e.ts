import { expect, test, type Page } from "@playwright/test";
import {
  expectNoDocumentHorizontalOverflow,
  expectNoNestedHorizontalScrollers
} from "./helpers/responsive-assertions";

test("费用与报销工作台在桌面和手机尺寸读取新域个人事实并切换服务端视图", async ({ page }) => {
  const requestedViews: string[] = [];
  await mockExpenseClaimSession(page, requestedViews);
  await login(page);

  await page.goto("/费用与报销工作台");
  await expect(page.getByRole("heading", { name: "费用与报销工作台" })).toBeVisible();
  await expect(page.getByText("BX-20260723-001", { exact: true })).toBeVisible();
  await expect(page.getByText("由综合部某某代办", { exact: true })).toHaveCount(0);
  await page.getByText("BX-20260723-001", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "费用报销" })).toBeVisible();
  await expect(page.getByText("项目现场交通费", { exact: true })).toBeVisible();
  await page.goto("/费用与报销工作台");
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);

  await page.locator(".expense-claim-workbench__filter-field .t-select").click();
  await page.getByText("审批中", { exact: true }).last().click();
  await expect(page.getByText("BX-20260723-002", { exact: true })).toBeVisible();
  await expect.poll(() => requestedViews).toContain("in_progress");
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
});

async function mockExpenseClaimSession(page: Page, requestedViews: string[]) {
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: "expense-claim-canary",
        name: "费用金丝雀",
        phone: "13900000002",
        mustChangePassword: false,
        roleKeys: ["employee"],
        globalRoleKeys: []
      },
      tokens: { accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 900 }
    })
  }));
  await page.route("**/api/me/work-items", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      generatedAt: "2026-07-23T00:00:00.000Z",
      visibleProjectCount: 0,
      queues: { pending: [], blocked: [], started: [] },
      approvalCenter: {
        pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: []
      }
    })
  }));
  await page.route("**/api/expense-claims*", (route) => {
    const view = new URL(route.request().url()).searchParams.get("view") ?? "all";
    requestedViews.push(view);
    const body = view === "in_progress"
      ? [expenseClaim({ code: "BX-20260723-002", status: "approval_pending" })]
      : [expenseClaim({ code: "BX-20260723-001", status: "approved_pending_payment" })];
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/api/expense-claims/expense-claim-1", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      ...expenseClaim({}), applicantPhoneSnapshot: null, proxyReason: null, factWitnessNameSnapshot: null,
      paymentMethod: null, payeeNameSnapshot: null, payeeAccountNameSnapshot: null, payeeBankNameSnapshot: null,
      payeeBankAccountSnapshot: null, loanExpectedClearanceAt: null, submittedAt: null, approvedAt: null,
      lines: [{ id: "line-1", sortOrder: 1, expenseCategory: "交通", occurredOn: "2026-07-22T00:00:00.000Z", purpose: "项目现场交通费", receiptCount: 1, amountCents: "123456", evidenceType: "receipt_or_other", noEvidenceReason: null, remark: null }]
    })
  }));
}

function expenseClaim(overrides: Partial<Record<string, unknown>>) {
  return {
    id: "expense-claim-1",
    code: "BX-20260723-001",
    claimType: "reimbursement",
    status: "approved_pending_payment",
    projectId: "project-1",
    project: { id: "project-1", code: "JGXM-001", name: "科技园项目" },
    companyEntityNameSnapshot: "建工智管有限公司",
    applicantNameSnapshot: "张三",
    handledByNameSnapshot: "费用金丝雀",
    reason: "项目现场交通费",
    requestedAmountCents: "123456",
    loanOffsetAmountCents: "23456",
    companyPayableAmountCents: "100000",
    fundedAmountCents: "0",
    updatedAt: "2026-07-23T10:30:00.000Z",
    ...overrides
  };
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000002");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
}
