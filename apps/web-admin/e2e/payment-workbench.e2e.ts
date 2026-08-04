import path from "node:path";
import {
  devices,
  expect,
  test,
  webkit,
  type Locator,
  type Page,
  type TestInfo
} from "@playwright/test";
import { expectNoDocumentHorizontalOverflow } from "./helpers/responsive-assertions";

interface PaymentReviewRequest {
  paymentId: string;
  method: string;
  body?: Record<string, unknown>;
}

interface PaymentExecutionRequestCapture {
  order: string[];
  uploadIdempotencyKeys: string[];
  executionBodies: Array<Record<string, unknown>>;
}

function paymentApprovalDetail(
  paymentId: string,
  decision: "approve" | "reject"
) {
  const expectedPaymentUpdatedAt = "2026-07-31T07:00:00.000Z";
  const expectedApprovalUpdatedAt = "2026-07-31T07:05:00.000Z";
  const code =
    decision === "approve" ? "FK-P0-APPROVE" : "FK-P0-REJECT";
  return {
    id: paymentId,
    title:
      decision === "approve"
        ? "桌面付款审批验收"
        : "移动付款驳回验收",
    lifecycleKind: "formal_record",
    ledgerView: "formal_ledger",
    lifecycleUpdatedAt: expectedPaymentUpdatedAt,
    reviewApprovalContext: {
      expectedPaymentUpdatedAt,
      expectedApprovalInstanceId: `approval-${paymentId}`,
      expectedNodeIndex: 1,
      expectedApprovalUpdatedAt
    },
    blockedReasons: [],
    meta: [
      { label: "审批状态", value: "审批中", tone: "warning" },
      { label: "实付状态", value: "未付款", tone: "default" },
      { label: "责任部门", value: "财务部" },
      {
        label: "下一步动作",
        value: "董事长/总经理或签",
        tone: "primary"
      }
    ],
    baseInfo: [
      { label: "付款编号", value: code },
      { label: "申请金额", value: "¥12,345.67" },
      { label: "项目", value: "P0 浏览器验收项目" }
    ],
    approvalSteps: [],
    executionSteps: [],
    executionAllocations: [],
    executionCoverages: [],
    evidenceFiles: [],
    approvalTimeline: [],
    availableActions: [
      {
        key: "review_approval",
        label: "办理付款审批",
        kind: "primary",
        enabled: true,
        disabledReason: null,
        requiredRoles: ["chairman", "general_manager"],
        requiresSelfReviewConfirmation: false
      }
    ],
    primaryAction: "review_approval",
    disabledReasons: [],
    traceRules: [
      "审批通过仅进入已批待付，实际付款仍由财务或出纳另行登记。"
    ],
    executionBlockMessage:
      "本次浏览器验证不登记实际付款。",
    chainLinks: []
  };
}

async function mockPaymentApprovalShell(page: Page) {
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "payment-approval-e2e-user",
          name: "付款审批验收用户",
          phone: "13900000000",
          mustChangePassword: false,
          roleKeys: ["general_manager"],
          globalRoleKeys: ["general_manager"]
        },
        tokens: {
          accessToken: "payment-approval-e2e-access-token",
          refreshToken: "payment-approval-e2e-refresh-token",
          expiresIn: 900
        }
      })
    })
  );
  await page.route("**/api/me/work-items", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: "2026-07-31T07:00:00.000Z",
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
  await page.route(
    "**/api/approval-delegations/user-options",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: "[]"
      })
  );
}

function paymentExecutionDetail(paymentId: string) {
  const expectedPaymentUpdatedAt =
    "2026-07-31T08:00:00.000Z";
  return {
    id: paymentId,
    title: "实际付款登记浏览器验收",
    lifecycleKind: "formal_record",
    ledgerView: "formal_ledger",
    lifecycleUpdatedAt: expectedPaymentUpdatedAt,
    reviewApprovalContext: null,
    executionContext: { expectedPaymentUpdatedAt },
    blockedReasons: [],
    meta: [
      { label: "审批状态", value: "已批待付", tone: "success" },
      { label: "实付状态", value: "未付款", tone: "warning" },
      { label: "责任部门", value: "财务部" },
      { label: "下一步动作", value: "登记实际付款", tone: "primary" }
    ],
    baseInfo: [
      { label: "付款编号", value: paymentId },
      { label: "申请金额", value: "¥50,000.00" },
      { label: "项目", value: "实际付款 P0 项目" }
    ],
    approvalSteps: [],
    executionSteps: [],
    executionAllocations: [],
    executionCoverages: [],
    evidenceFiles: [],
    approvalTimeline: [],
    availableActions: [
      {
        key: "record_execution",
        label: "登记实际付款",
        kind: "primary",
        enabled: true,
        disabledReason: null,
        requiredRoles: ["finance_staff"]
      }
    ],
    primaryAction: "record_execution",
    disabledReasons: [],
    traceRules: [
      "只有实际付款与唯一付款凭证会占用项目资金。"
    ],
    executionBlockMessage:
      "登记实际付款后才会更新已付金额。",
    chainLinks: []
  };
}

async function mockPaymentExecutionShell(page: Page) {
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "payment-execution-e2e-user",
          name: "实际付款验收用户",
          phone: "13900000000",
          mustChangePassword: false,
          roleKeys: ["finance_staff"],
          globalRoleKeys: ["finance_staff"]
        },
        tokens: {
          accessToken: "payment-execution-e2e-access-token",
          refreshToken: "payment-execution-e2e-refresh-token",
          expiresIn: 900
        }
      })
    })
  );
  await page.route("**/api/me/work-items", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: "2026-07-31T08:00:00.000Z",
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
  await page.route(
    "**/api/approval-delegations/user-options",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: "[]"
      })
  );
}

async function mockPaymentExecutionRequests(
  page: Page,
  capture: PaymentExecutionRequestCapture
) {
  await page.route(
    "**/api/payments/payment-execution-*/execution-voucher-file-uploads",
    async (route) => {
      const requestBody =
        route.request().postDataBuffer()?.toString("utf8") ?? "";
      const idempotencyKey =
        /name="idempotencyKey"\r\n\r\n([^\r\n]+)/u.exec(
          requestBody
        )?.[1] ?? "";
      capture.order.push("POST /files");
      capture.uploadIdempotencyKeys.push(idempotencyKey);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ id: idempotencyKey })
      });
    }
  );
  await page.route(
    "**/api/payments/payment-execution-**",
    async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname.endsWith("/execution-voucher-file-uploads")) {
        await route.fallback();
        return;
      }
      const segments = pathname.split("/").filter(Boolean);
      const paymentId =
        segments.at(-1) === "executions"
          ? segments.at(-2) ?? ""
          : segments.at(-1) ?? "";
      if (
        request.method() === "POST" &&
        pathname.endsWith("/executions")
      ) {
        capture.order.push("POST /executions");
        capture.executionBodies.push(
          request.postDataJSON() as Record<string, unknown>
        );
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ id: "execution-p0" })
        });
        return;
      }
      capture.order.push("GET /payment");
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(paymentExecutionDetail(paymentId))
      });
    }
  );
}

async function mockPaymentApprovalRequests(
  page: Page,
  requests: PaymentReviewRequest[]
) {
  await page.route("**/api/payments/payment-review-**", async (route) => {
    const request = route.request();
    const segments = new URL(request.url()).pathname
      .split("/")
      .filter(Boolean);
    const paymentId =
      segments.at(-1) === "approval"
        ? segments.at(-2) ?? ""
        : segments.at(-1) ?? "";
    const decision = paymentId.endsWith("reject")
      ? "reject"
      : "approve";
    requests.push({
      paymentId,
      method: request.method(),
      ...(request.method() === "POST"
        ? {
            body:
              request.postDataJSON() as Record<string, unknown>
          }
        : {})
    });

    if (request.method() === "POST") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: paymentId,
          status:
            decision === "approve"
              ? "approved_pending_payment"
              : "rejected"
        })
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        paymentApprovalDetail(paymentId, decision)
      )
    });
  });
}

async function loginForPaymentApproval(page: Page) {
  await page.goto("/login");
  await page
    .getByPlaceholder("请输入手机号")
    .fill("13900000000");
  await page
    .getByPlaceholder("请输入密码")
    .fill("Payment@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(
    page.getByRole("heading", { name: "工作台" })
  ).toBeVisible();
}

async function loginForPaymentExecution(page: Page) {
  await page.goto("/login");
  await page
    .getByPlaceholder("请输入手机号")
    .fill("13900000000");
  await page
    .getByPlaceholder("请输入密码")
    .fill("Payment@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(
    page.getByRole("heading", { name: "工作台" })
  ).toBeVisible();
}

function captureBrowserErrors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  return { consoleErrors, pageErrors };
}

async function expectPaymentPageHealthy(page: Page) {
  await expect(page.locator("#main-content")).not.toBeEmpty();
  await expect(
    page.locator(
      "vite-error-overlay, #webpack-dev-server-client-overlay"
    )
  ).toHaveCount(0);
  await expectNoDocumentHorizontalOverflow(page);
}

async function expectControlNotObscured(control: Locator) {
  const state = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const topElement = document.elementFromPoint(centerX, centerY);
    return {
      rect: {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width
      },
      viewport: {
        height: window.innerHeight,
        width: window.innerWidth
      },
      inViewport:
        rect.width > 0 &&
        rect.height > 0 &&
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.right <= window.innerWidth &&
        rect.bottom <= window.innerHeight,
      unobscured:
        topElement === element ||
        (topElement !== null && element.contains(topElement))
    };
  });
  expect(
    {
      inViewport: state.inViewport,
      unobscured: state.unobscured
    },
    JSON.stringify(state)
  ).toEqual({
    inViewport: true,
    unobscured: true
  });
}

async function doubleActivate(control: Locator) {
  await control.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
}

async function exercisePaymentExecution(
  page: Page,
  paymentId: string,
  testInfo: TestInfo,
  screenshotName: string
) {
  await page.goto(`/付款管理/${paymentId}`);
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(
    `/付款管理/${paymentId}`
  );
  await expect(
    page.getByRole("heading", {
      name: "实际付款登记浏览器验收",
      exact: true
    })
  ).toBeVisible();
  await expectPaymentPageHealthy(page);
  await page
    .locator(".detail-navigation")
    .getByText("流程", { exact: true })
    .click();
  const executionGroup = page
    .locator(".action-group")
    .filter({ hasText: "出纳实付" });
  await executionGroup
    .locator(".money-input input")
    .fill("50000");
  const paidAt = executionGroup.locator(
    ".t-date-picker input"
  );
  const paidAtInput = await paidAt.inputValue();
  expect(paidAtInput).not.toBe("");
  await executionGroup.locator('input[type="file"]').setInputFiles({
    name: "付款凭证.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("payment-voucher-p0")
  });
  const openExecutionDialog = executionGroup.getByRole(
    "button",
    {
      name: "确认登记实付",
      exact: true
    }
  );
  await openExecutionDialog.scrollIntoViewIfNeeded();
  await openExecutionDialog.evaluate((element) => {
    element.scrollIntoView({
      block: "center",
      inline: "center"
    });
    const rect = element.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      window.scrollBy(
        0,
        rect.top - window.innerHeight / 2 + rect.height / 2
      );
    }
  });
  await expectControlNotObscured(openExecutionDialog);
  await openExecutionDialog.evaluate((element) => {
    (element as HTMLButtonElement).click();
  });

  const dialog = page
    .locator(".t-dialog")
    .filter({ hasText: "确认登记实际付款？" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByPlaceholder("用于确认当前操作者身份")
    .fill("Payment@2026");
  const confirm = dialog.getByRole("button", {
    name: "确认登记实付",
    exact: true
  });
  await expectControlNotObscured(confirm);
  await page.screenshot({
    path: path.join(testInfo.outputDir, screenshotName),
    fullPage: false
  });
  await doubleActivate(confirm);
  await expect(
    page.getByText(
      "实际付款已登记，付款详情已刷新。",
      { exact: true }
    )
  ).toBeVisible();
  await expectPaymentPageHealthy(page);
  return page.evaluate((value) => {
    return new Date(value.replace(" ", "T")).toISOString();
  }, paidAtInput);
}

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
          contractTypeKey: "material_purchase",
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
  await page.route("**/api/payments/create-capability?projectId=*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ projectId: "project-1", availableActions: ["create_payment"] })
    })
  );
  await page.route(/\/api\/payments(?:\?.*)?$/u, async (route) => {
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
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();

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
  await expect(selects).toHaveCount(4);
  await selects.nth(1).click();
  await page
    .getByText("HT-2026-001 · 科技园钢材采购合同 · 城建物资公司", { exact: true })
    .last()
    .click();
  await selects.nth(2).click();
  await page.getByText("单张结算付款", { exact: true }).last().click();
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

test("P0 desktop Chromium approves payment with a fresh four-coordinate preflight and one POST", async ({
  browserName,
  page
}, testInfo) => {
  expect(browserName).toBe("chromium");
  const requests: PaymentReviewRequest[] = [];
  const browserErrors = captureBrowserErrors(page);
  await mockPaymentApprovalShell(page);
  await mockPaymentApprovalRequests(page, requests);
  await page.setViewportSize({ width: 1366, height: 768 });
  await loginForPaymentApproval(page);

  await page.goto("/付款管理/payment-review-approve");
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(
    "/付款管理/payment-review-approve"
  );
  await expect(
    page.getByRole("heading", {
      name: "桌面付款审批验收",
      exact: true
    })
  ).toBeVisible();
  await expectPaymentPageHealthy(page);
  await page
    .locator(".detail-navigation")
    .getByText("流程", { exact: true })
    .click();
  await page
    .locator(".money-input")
    .filter({ hasText: "审批金额（可选）" })
    .locator("input")
    .fill("12345.67");
  await page
    .getByPlaceholder("驳回时必须填写原因")
    .fill("  同意按核定金额付款  ");
  await page
    .locator(".action-grid")
    .getByRole("button", { name: "通过", exact: true })
    .click();

  const approveDialog = page
    .locator(".t-dialog")
    .filter({ hasText: "确认通过付款审批？" });
  await expect(approveDialog).toBeVisible();
  const confirmApprove = approveDialog.getByRole("button", {
    name: "确认通过",
    exact: true
  });
  await expectControlNotObscured(confirmApprove);
  await page.screenshot({
    path: path.join(
      testInfo.outputDir,
      "payment-review-approve-chromium-1366x768.png"
    ),
    fullPage: false
  });

  await doubleActivate(confirmApprove);
  await expect(
    page.getByText(
      "付款审批已通过，当前仅进入已批待付。",
      { exact: true }
    )
  ).toBeVisible();
  await expect
    .poll(() =>
      requests
        .filter(
          (request) =>
            request.paymentId === "payment-review-approve"
        )
        .map((request) => request.method)
    )
    .toEqual(["GET", "GET", "POST", "GET"]);

  const approvePosts = requests.filter(
    (request) =>
      request.paymentId === "payment-review-approve" &&
      request.method === "POST"
  );
  expect(approvePosts).toHaveLength(1);
  expect(approvePosts[0]?.body).toEqual({
    decision: "approve",
    approvedAmountCents: "1234567",
    comment: "同意按核定金额付款",
    expectedPaymentUpdatedAt:
      "2026-07-31T07:00:00.000Z",
    expectedApprovalInstanceId:
      "approval-payment-review-approve",
    expectedNodeIndex: 1,
    expectedApprovalUpdatedAt:
      "2026-07-31T07:05:00.000Z"
  });
  await expectPaymentPageHealthy(page);
  expect(browserErrors.consoleErrors).toEqual([]);
  expect(browserErrors.pageErrors).toEqual([]);
});

test("P0 mobile WebKit rejects payment without approved amount and one POST", async ({ browserName }, testInfo) => {
  expect(browserName).toBe("chromium");
  const baseURL = testInfo.project.use.baseURL;
  if (typeof baseURL !== "string") {
    throw new Error("Playwright baseURL 未配置");
  }
  const browser = await webkit.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: devices["iPhone 13"].deviceScaleFactor,
    hasTouch: true,
    isMobile: true,
    userAgent: devices["iPhone 13"].userAgent,
    baseURL
  });
  const page = await context.newPage();
  const requests: PaymentReviewRequest[] = [];
  const browserErrors = captureBrowserErrors(page);

  try {
    await mockPaymentApprovalShell(page);
    await mockPaymentApprovalRequests(page, requests);
    await loginForPaymentApproval(page);

    await page.goto("/付款管理/payment-review-reject");
    expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(
      "/付款管理/payment-review-reject"
    );
    expect(
      await page.evaluate(() => ({
        height: window.innerHeight,
        userAgent: navigator.userAgent,
        width: window.innerWidth
      }))
    ).toEqual(
      expect.objectContaining({
        height: 844,
        width: 390,
        userAgent: expect.not.stringContaining("Chrome/")
      })
    );
    await expect(
      page.getByRole("heading", {
        name: "移动付款驳回验收",
        exact: true
      })
    ).toBeVisible();
    await expectPaymentPageHealthy(page);
    await page
      .locator(".detail-navigation")
      .getByText("流程", { exact: true })
      .click();
    await page
      .locator(".money-input")
      .filter({ hasText: "审批金额（可选）" })
      .locator("input")
      .fill("999.99");
    await page
      .getByPlaceholder("驳回时必须填写原因")
      .fill("  付款依据不足  ");
    await page
      .locator(".action-grid")
      .getByRole("button", { name: "驳回", exact: true })
      .click();

    const rejectDialog = page
      .locator(".t-dialog")
      .filter({ hasText: "确认驳回付款审批？" });
    await expect(rejectDialog).toBeVisible();
    const confirmReject = rejectDialog.getByRole("button", {
      name: "确认驳回",
      exact: true
    });
    await expectControlNotObscured(confirmReject);
    await page.screenshot({
      path: path.join(
        testInfo.outputDir,
        "payment-review-reject-webkit-390x844.png"
      ),
      fullPage: false
    });

    await doubleActivate(confirmReject);
    await expect(
      page.getByText("付款审批已驳回。", { exact: true })
    ).toBeVisible();
    await expect
      .poll(() =>
        requests
          .filter(
            (request) =>
              request.paymentId === "payment-review-reject"
          )
          .map((request) => request.method)
      )
      .toEqual(["GET", "GET", "POST", "GET"]);

    const rejectPosts = requests.filter(
      (request) =>
        request.paymentId === "payment-review-reject" &&
        request.method === "POST"
    );
    expect(rejectPosts).toHaveLength(1);
    expect(rejectPosts[0]?.body).toEqual({
      decision: "reject",
      comment: "付款依据不足",
      expectedPaymentUpdatedAt:
        "2026-07-31T07:00:00.000Z",
      expectedApprovalInstanceId:
        "approval-payment-review-reject",
      expectedNodeIndex: 1,
      expectedApprovalUpdatedAt:
        "2026-07-31T07:05:00.000Z"
    });
    expect(rejectPosts[0]?.body).not.toHaveProperty(
      "approvedAmountCents"
    );
    await expectPaymentPageHealthy(page);
    expect(browserErrors.consoleErrors).toEqual([]);
    expect(browserErrors.pageErrors).toEqual([]);
  } finally {
    await browser.close();
  }
});

test("P0 desktop Chromium records actual payment with one fresh GET, upload and POST", async ({
  browserName,
  page
}, testInfo) => {
  expect(browserName).toBe("chromium");
  const capture: PaymentExecutionRequestCapture = {
    order: [],
    uploadIdempotencyKeys: [],
    executionBodies: []
  };
  const browserErrors = captureBrowserErrors(page);
  await mockPaymentExecutionShell(page);
  await mockPaymentExecutionRequests(page, capture);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.clock.setFixedTime(
    new Date("2026-07-31T08:30:00.000Z")
  );
  await loginForPaymentExecution(page);

  const expectedPaidAt = await exercisePaymentExecution(
    page,
    "payment-execution-desktop",
    testInfo,
    "payment-execution-chromium-1366x768.png"
  );

  await expect
    .poll(() => capture.order)
    .toEqual([
      "GET /payment",
      "GET /payment",
      "POST /files",
      "POST /executions",
      "GET /payment"
    ]);
  expect(capture.uploadIdempotencyKeys).toHaveLength(1);
  expect(capture.uploadIdempotencyKeys[0]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
  );
  expect(capture.executionBodies).toEqual([
    {
      amountCents: "5000000",
      paidAt: expectedPaidAt,
      voucherFileId: capture.uploadIdempotencyKeys[0],
      confirmationPassword: "Payment@2026",
      expectedPaymentUpdatedAt:
        "2026-07-31T08:00:00.000Z",
      idempotencyKey: capture.uploadIdempotencyKeys[0]
    }
  ]);
  expect(browserErrors.consoleErrors).toEqual([]);
  expect(browserErrors.pageErrors).toEqual([]);
});

test("P0 mobile WebKit records actual payment without duplicate upload or POST", async ({
  browserName
}, testInfo) => {
  expect(browserName).toBe("chromium");
  const baseURL = testInfo.project.use.baseURL;
  if (typeof baseURL !== "string") {
    throw new Error("Playwright baseURL 未配置");
  }
  const browser = await webkit.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor:
      devices["iPhone 13"].deviceScaleFactor,
    hasTouch: true,
    isMobile: true,
    userAgent: devices["iPhone 13"].userAgent,
    baseURL,
    timezoneId: "Asia/Shanghai"
  });
  const page = await context.newPage();
  const capture: PaymentExecutionRequestCapture = {
    order: [],
    uploadIdempotencyKeys: [],
    executionBodies: []
  };
  const browserErrors = captureBrowserErrors(page);

  try {
    await mockPaymentExecutionShell(page);
    await mockPaymentExecutionRequests(page, capture);
    await page.clock.setFixedTime(
      new Date("2026-07-31T08:30:00.000Z")
    );
    await loginForPaymentExecution(page);
    expect(
      await page.evaluate(() => ({
        height: window.innerHeight,
        userAgent: navigator.userAgent,
        width: window.innerWidth
      }))
    ).toEqual(
      expect.objectContaining({
        height: 844,
        width: 390,
        userAgent: expect.not.stringContaining("Chrome/")
      })
    );

    const expectedPaidAt = await exercisePaymentExecution(
      page,
      "payment-execution-mobile",
      testInfo,
      "payment-execution-webkit-390x844.png"
    );
    await expect
      .poll(() => capture.order)
      .toEqual([
        "GET /payment",
        "GET /payment",
        "POST /files",
        "POST /executions",
        "GET /payment"
      ]);
    expect(capture.uploadIdempotencyKeys).toHaveLength(1);
    expect(capture.executionBodies).toEqual([
      {
        amountCents: "5000000",
        paidAt: expectedPaidAt,
        voucherFileId:
          capture.uploadIdempotencyKeys[0],
        confirmationPassword: "Payment@2026",
        expectedPaymentUpdatedAt:
          "2026-07-31T08:00:00.000Z",
        idempotencyKey:
          capture.uploadIdempotencyKeys[0]
      }
    ]);
    await expectPaymentPageHealthy(page);
    expect(browserErrors.consoleErrors).toEqual([]);
    expect(browserErrors.pageErrors).toEqual([]);
  } finally {
    await browser.close();
  }
});
