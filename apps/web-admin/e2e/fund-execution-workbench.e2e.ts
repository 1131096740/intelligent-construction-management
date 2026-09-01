import { expect, test, type Page } from "@playwright/test";

interface RecordedCreateRequest {
  idempotencyKey?: string;
  observationSelectionRef?: string;
  reason?: string;
}

const observationSelectionRef = "selection-ref-must-stay-opaque";
const internalCaseRef = "case-ref-must-stay-opaque";

test("资金执行案件响应丢失重试复用幂等键", async ({ page }) => {
  const createRequests: RecordedCreateRequest[] = [];
  await installFundExecutionHarness(page, createRequests);
  await login(page);

  await page.goto("/资金执行案件");
  await expect(page.getByRole("heading", { name: "资金执行案件" })).toBeVisible();
  await page.getByPlaceholder("选择已核验且尚未认领的银行流水").click();
  await page.getByText("9月1日项目工程款入账 10,000.00 元", { exact: true }).click();
  await page.getByPlaceholder("说明暂存待分类或反向执行的真实业务原因")
    .fill("工程款到账，暂待财务完成逐轴分类");

  await page.getByRole("button", { name: "创建待分类案件" }).click();
  await expect.poll(() => createRequests).toHaveLength(1);
  await expect(page.getByText("暂时无法办理", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "创建待分类案件" }).click();
  await expect.poll(() => createRequests).toHaveLength(2);
  await expect(page.getByText("资金案件 2026-09-01-001", { exact: true })).toBeVisible();

  expect(createRequests[0]?.idempotencyKey).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
  );
  expect(createRequests[1]?.idempotencyKey).toBe(createRequests[0]?.idempotencyKey);
  expect(createRequests.map(({ observationSelectionRef: selectionRef, reason }) => ({
    selectionRef,
    reason
  }))).toEqual([
    {
      selectionRef: observationSelectionRef,
      reason: "工程款到账，暂待财务完成逐轴分类"
    },
    {
      selectionRef: observationSelectionRef,
      reason: "工程款到账，暂待财务完成逐轴分类"
    }
  ]);

  const visibleBusinessText = await page.locator("body").innerText();
  expect(visibleBusinessText).not.toContain(observationSelectionRef);
  expect(visibleBusinessText).not.toContain(internalCaseRef);
});

async function installFundExecutionHarness(
  page: Page,
  createRequests: RecordedCreateRequest[]
) {
  let createSucceeded = false;

  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: "fund-execution-browser-user",
        name: "资金执行经办人",
        phone: "13900000003",
        mustChangePassword: false,
        roleKeys: ["finance_staff"],
        globalRoleKeys: ["finance_staff"]
      },
      tokens: {
        accessToken: "fund-execution-access-token",
        refreshToken: "fund-execution-refresh-token",
        expiresIn: 900
      }
    })
  }));
  await page.route("**/api/me/work-items", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      generatedAt: "2026-09-01T06:00:00.000Z",
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
  }));
  await page.route("**/api/fund-executions/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());

    if (pathname === "/api/fund-executions/cases" && request.method() === "POST") {
      createRequests.push(request.postDataJSON() as RecordedCreateRequest);
      if (createRequests.length === 1) {
        return route.abort("connectionreset");
      }
      createSucceeded = true;
      return route.fulfill({ contentType: "application/json", body: "{}" });
    }
    if (pathname === "/api/fund-executions/cases") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(createSucceeded ? [createdCase()] : [])
      });
    }
    if (pathname === "/api/fund-executions/observation-options") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([{
          selectionRef: observationSelectionRef,
          expiresAt: "2099-09-01T07:00:00.000Z",
          summary: "9月1日项目工程款入账 10,000.00 元"
        }])
      });
    }
    if (pathname === "/api/fund-executions/reversal-options") {
      return route.fulfill({ contentType: "application/json", body: "[]" });
    }
    if (pathname === "/api/fund-executions/capabilities") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ createCase: true, createReversal: false })
      });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}

function createdCase() {
  return {
    caseRef: internalCaseRef,
    caseLabel: "资金案件 2026-09-01-001",
    executionKind: "quarantine",
    direction: "inflow",
    directionLabel: "流入",
    observationSummary: "9月1日项目工程款入账 10,000.00 元",
    amountCents: "1000000",
    occurredAt: "2026-09-01T01:00:00.000Z",
    reason: "工程款到账，暂待财务完成逐轴分类",
    classificationSummary: null,
    status: "draft",
    statusLabel: "未提交",
    approvalStatusLabel: null,
    revision: 1,
    updatedAt: "2026-09-01T06:00:00.000Z",
    actions: [{
      key: "update_case",
      label: "修改分类",
      enabled: true,
      disabledReason: null
    }]
  };
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000003");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
}
