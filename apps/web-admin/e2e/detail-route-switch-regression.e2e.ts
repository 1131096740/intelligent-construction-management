import { expect, test, type Page } from "@playwright/test";

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function paymentDetail(id: string, marker: string) {
  return {
    id,
    title: `${marker}付款申请`,
    meta: [
      { label: "审批状态", value: "已通过", tone: "success" },
      { label: "实付状态", value: "已批待付", tone: "warning" },
      { label: "责任部门", value: "财务部" },
      { label: "下一步动作", value: "下载审批单", tone: "primary" }
    ],
    baseInfo: [
      { label: "付款编号", value: id },
      { label: "申请金额", value: marker === "B" ? "¥222.00" : "¥111.00" },
      { label: "项目", value: `${marker}项目` }
    ],
    approvalSteps: [],
    executionSteps: [],
    executionAllocations: [],
    executionCoverages: [],
    evidenceFiles: [],
    approvalTimeline: [],
    availableActions: [{
      key: "download_approval_form",
      label: "下载审批单",
      kind: "secondary",
      enabled: true,
      requiresPassword: true
    }],
    primaryAction: "download_approval_form",
    disabledReasons: [],
    traceRules: [`${marker}付款追溯规则`],
    executionBlockMessage: `${marker}付款办理边界`,
    chainLinks: []
  };
}

function settlementDetail(id: string, marker: string) {
  return {
    id,
    settlementId: id,
    title: `${marker}结算单`,
    meta: [
      { label: "当前状态", value: "审批完成", tone: "success" },
      { label: "关联合同版本", value: `${marker}合同 v1` },
      { label: "责任部门", value: "合同部" },
      { label: "下一步动作", value: "下载审批单", tone: "primary" }
    ],
    baseInfo: [
      { label: "结算编号", value: id },
      { label: "结算金额", value: marker === "B" ? "¥222.00" : "¥111.00" },
      { label: "关联合同", value: `${marker}合同` }
    ],
    effectivenessSteps: [],
    archiveResponsibilities: [],
    paymentRules: [],
    payableCalculation: { items: [], note: `${marker}结算可付说明` },
    paymentBlockMessage: `${marker}结算付款边界`,
    settlementLines: [],
    archiveFiles: [],
    approvalTimeline: [],
    availableActions: [{
      key: "download_approval_form",
      label: "下载审批单",
      kind: "secondary",
      enabled: true,
      requiresPassword: true
    }],
    primaryAction: "download_approval_form",
    disabledReasons: [],
    chainLinks: []
  };
}

async function mockLoginAndShell(page: Page, userId: string) {
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: userId,
        name: "路由回归用户",
        phone: "13900000000",
        mustChangePassword: false,
        roleKeys: ["finance_staff", "contract_staff"],
        globalRoleKeys: ["finance_staff", "contract_staff"]
      },
      tokens: { accessToken: "route-access", refreshToken: "route-refresh", expiresIn: 900 }
    })
  }));
  await page.route("**/api/me/work-items", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      generatedAt: "2026-07-15T08:00:00.000Z",
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
  await page.route("**/api/approval-delegations/user-options", (route) => route.fulfill({
    contentType: "application/json",
    body: "[]"
  }));
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
}

async function navigateWithinApp(page: Page, path: string) {
  await page.evaluate((nextPath) => {
    window.history.pushState({}, "", nextPath);
    window.dispatchEvent(new PopStateEvent("popstate", {
      state: window.history.state
    }));
  }, path);
}

async function submitDownloadConfirmation(page: Page, expectedUrl: string) {
  const dialog = page.locator(".t-dialog").filter({ hasText: "确认下载" });
  await dialog.getByPlaceholder("说明本次操作原因").fill("验证 B 单据上下文");
  await dialog.getByPlaceholder("用于确认当前操作者身份").fill("E2e@2026");
  const requestPromise = page.waitForRequest(expectedUrl);
  await dialog.getByRole("button", { name: "确认下载", exact: true }).click();
  await requestPromise;
}

test("付款详情 A 的慢响应不会覆盖同路由切换后的 B", async ({ page }) => {
  const userId = "payment-route-user";
  const releaseSlowA = deferred();
  const slowAStarted = deferred();
  let paymentARequests = 0;
  let slowAFulfilled = false;

  await mockLoginAndShell(page, userId);
  await page.route("**/api/payments/payment-A", async (route) => {
    paymentARequests += 1;
    if (paymentARequests > 1) {
      slowAStarted.resolve();
      await releaseSlowA.promise;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(paymentDetail("payment-A", "A")) });
    if (paymentARequests > 1) slowAFulfilled = true;
  });
  await page.route("**/api/payments/payment-B", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(paymentDetail("payment-B", "B"))
  }));
  await page.route("**/api/approval-forms/payment_request/payment-B/download", (route) => route.fulfill({
    status: 200,
    contentType: "application/pdf",
    body: "payment-B-pdf"
  }));

  await login(page);
  await page.goto("/付款管理/payment-A");
  await expect(page.getByRole("heading", { name: "A付款申请" })).toBeVisible();

  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await slowAStarted.promise;
  await page.locator(".detail-navigation").getByText("流程", { exact: true }).click();
  await page.locator(".action-grid").getByRole("button", { name: "下载审批单" }).click();
  await expect(page.getByText("确认下载付款审批单？")).toBeVisible();

  await navigateWithinApp(page, "/付款管理/payment-B");
  await expect(page.getByRole("heading", { name: "B付款申请" })).toBeVisible();
  await expect(page.getByText("确认下载付款审批单？")).toBeHidden();

  releaseSlowA.resolve();
  await expect.poll(() => slowAFulfilled).toBe(true);
  await expect(page.getByRole("heading", { name: "B付款申请" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "A付款申请" })).toHaveCount(0);
  await expect(page.getByText("B付款追溯规则")).toBeVisible();

  await page.locator(".detail-navigation").getByText("流程", { exact: true }).click();
  await page.locator(".action-grid").getByRole("button", { name: "下载审批单" }).click();
  await submitDownloadConfirmation(page, "**/api/approval-forms/payment_request/payment-B/download");
});

test("结算详情 A 的慢响应不会覆盖同路由切换后的 B", async ({ page }) => {
  const userId = "settlement-route-user";
  const releaseSlowA = deferred();
  const slowAStarted = deferred();
  let settlementARequests = 0;
  let slowAFulfilled = false;

  await mockLoginAndShell(page, userId);
  await page.route("**/api/settlements/settlement-A", async (route) => {
    settlementARequests += 1;
    if (settlementARequests > 1) {
      slowAStarted.resolve();
      await releaseSlowA.promise;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(settlementDetail("settlement-A", "A")) });
    if (settlementARequests > 1) slowAFulfilled = true;
  });
  await page.route("**/api/settlements/settlement-B", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(settlementDetail("settlement-B", "B"))
  }));
  await page.route("**/api/settlements/settlement-B/approval-pdf/latest", (route) => route.fulfill({
    status: 200,
    contentType: "application/pdf",
    body: "settlement-B-pdf"
  }));

  await login(page);
  await page.goto("/结算管理/settlement-A");
  await expect(page.getByRole("heading", { name: "A结算单" })).toBeVisible();

  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await slowAStarted.promise;
  await page.locator(".detail-navigation").getByText("流程办理", { exact: true }).click();
  await page.locator(".action-grid").getByRole("button", { name: "下载审批单" }).click();
  await expect(page.getByText("确认下载结算审批单？")).toBeVisible();

  await navigateWithinApp(page, "/结算管理/settlement-B");
  await expect(page.getByRole("heading", { name: "B结算单" })).toBeVisible();
  await expect(page.getByText("确认下载结算审批单？")).toBeHidden();

  releaseSlowA.resolve();
  await expect.poll(() => slowAFulfilled).toBe(true);
  await expect(page.getByRole("heading", { name: "B结算单" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "A结算单" })).toHaveCount(0);
  await expect(page.getByText("B结算付款边界")).toBeVisible();

  await page.locator(".detail-navigation").getByText("流程办理", { exact: true }).click();
  await page.locator(".action-grid").getByRole("button", { name: "下载审批单" }).click();
  await submitDownloadConfirmation(page, "**/api/settlements/settlement-B/approval-pdf/latest");
});
