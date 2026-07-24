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
    const existingState =
      window.history.state && typeof window.history.state === "object"
        ? window.history.state
        : {};
    const currentPath =
      `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const currentPosition =
      typeof existingState.position === "number" ? existingState.position : 0;
    const currentState = {
      ...existingState,
      current: currentPath,
      forward: nextPath,
      scroll: existingState.scroll ?? {
        left: window.scrollX,
        top: window.scrollY
      }
    };
    const nextState = {
      back: currentPath,
      current: nextPath,
      forward: null,
      replaced: false,
      position: currentPosition + 1,
      scroll: null
    };

    window.history.replaceState(currentState, "", currentPath);
    window.history.pushState(nextState, "", nextPath);
    window.dispatchEvent(new PopStateEvent("popstate", {
      state: nextState
    }));
  }, path);
}

async function waitForBrowserTasks(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  }));
}

async function readHistoryPosition(page: Page): Promise<number> {
  const position = await page.evaluate(() => window.history.state?.position);
  expect(position).toEqual(expect.any(Number));
  return position as number;
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
  const paymentDownloadPaths: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      pathname.includes("/api/approval-forms/payment_request/") &&
      pathname.endsWith("/download")
    ) {
      paymentDownloadPaths.push(pathname);
    }
  });

  await mockLoginAndShell(page, userId);
  await page.route("**/api/payments/payment-A", async (route) => {
    paymentARequests += 1;
    if (paymentARequests > 1) {
      slowAStarted.resolve();
      await releaseSlowA.promise;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(paymentDetail("payment-A", "A")) });
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

  const paymentAHistoryPosition = await readHistoryPosition(page);
  const paymentBResponsePromise = page.waitForResponse("**/api/payments/payment-B");
  await navigateWithinApp(page, "/付款管理/payment-B");
  const paymentBResponse = await paymentBResponsePromise;
  await paymentBResponse.finished();
  await expect.poll(() => page.evaluate(() => ({
    pathname: decodeURI(window.location.pathname),
    search: window.location.search,
    hash: window.location.hash,
    current: window.history.state?.current,
    position: window.history.state?.position
  }))).toEqual({
    pathname: "/付款管理/payment-B",
    search: "",
    hash: "",
    current: "/付款管理/payment-B",
    position: paymentAHistoryPosition + 1
  });
  await expect(page.getByRole("heading", { name: "B付款申请" })).toBeVisible();
  await expect(page.getByText("确认下载付款审批单？")).toBeHidden();

  const slowPaymentAResponsePromise = page.waitForResponse("**/api/payments/payment-A");
  releaseSlowA.resolve();
  const slowPaymentAResponse = await slowPaymentAResponsePromise;
  await slowPaymentAResponse.finished();
  await waitForBrowserTasks(page);
  await expect.poll(() => page.evaluate(
    () => decodeURI(`${window.location.pathname}${window.location.search}${window.location.hash}`)
  )).toBe("/付款管理/payment-B");
  await expect(page.getByRole("heading", { name: "B付款申请" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "A付款申请" })).toHaveCount(0);
  await expect(page.getByText("¥111.00", { exact: true })).toHaveCount(0);
  await expect(page.getByText("A付款追溯规则", { exact: true })).toHaveCount(0);
  await expect(page.getByText("¥222.00", { exact: true })).toBeVisible();
  await expect(page.getByText("B付款追溯规则", { exact: true })).toBeVisible();

  await page.locator(".detail-navigation").getByText("流程", { exact: true }).click();
  await page.locator(".action-grid").getByRole("button", { name: "下载审批单" }).click();
  await submitDownloadConfirmation(page, "**/api/approval-forms/payment_request/payment-B/download");
  expect(paymentDownloadPaths).toEqual([
    "/api/approval-forms/payment_request/payment-B/download"
  ]);
});

test("结算详情 A 的慢响应不会覆盖同路由切换后的 B", async ({ page }) => {
  const userId = "settlement-route-user";
  const releaseSlowA = deferred();
  const slowAStarted = deferred();
  let settlementARequests = 0;
  const settlementDownloadPaths: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      pathname.includes("/api/settlements/") &&
      pathname.endsWith("/approval-pdf/latest")
    ) {
      settlementDownloadPaths.push(pathname);
    }
  });

  await mockLoginAndShell(page, userId);
  await page.route("**/api/settlements/settlement-A", async (route) => {
    settlementARequests += 1;
    if (settlementARequests > 1) {
      slowAStarted.resolve();
      await releaseSlowA.promise;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(settlementDetail("settlement-A", "A")) });
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

  const settlementAHistoryPosition = await readHistoryPosition(page);
  const settlementBResponsePromise = page.waitForResponse("**/api/settlements/settlement-B");
  await navigateWithinApp(page, "/结算管理/settlement-B");
  const settlementBResponse = await settlementBResponsePromise;
  await settlementBResponse.finished();
  await expect.poll(() => page.evaluate(() => ({
    pathname: decodeURI(window.location.pathname),
    search: window.location.search,
    hash: window.location.hash,
    current: window.history.state?.current,
    position: window.history.state?.position
  }))).toEqual({
    pathname: "/结算管理/settlement-B",
    search: "",
    hash: "",
    current: "/结算管理/settlement-B",
    position: settlementAHistoryPosition + 1
  });
  await expect(page.getByRole("heading", { name: "B结算单" })).toBeVisible();
  await expect(page.getByText("确认下载结算审批单？")).toBeHidden();

  const slowSettlementAResponsePromise = page.waitForResponse("**/api/settlements/settlement-A");
  releaseSlowA.resolve();
  const slowSettlementAResponse = await slowSettlementAResponsePromise;
  await slowSettlementAResponse.finished();
  await waitForBrowserTasks(page);
  await expect.poll(() => page.evaluate(
    () => decodeURI(`${window.location.pathname}${window.location.search}${window.location.hash}`)
  )).toBe("/结算管理/settlement-B");
  await expect(page.getByRole("heading", { name: "B结算单" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "A结算单" })).toHaveCount(0);
  await expect(page.getByText("¥111.00", { exact: true })).toHaveCount(0);
  await expect(page.getByText("A结算付款边界", { exact: true })).toHaveCount(0);
  await expect(page.getByText("¥222.00", { exact: true })).toBeVisible();
  await expect(page.getByText("B结算付款边界", { exact: true })).toBeVisible();

  await page.locator(".detail-navigation").getByText("流程办理", { exact: true }).click();
  await page.locator(".action-grid").getByRole("button", { name: "下载审批单" }).click();
  await submitDownloadConfirmation(page, "**/api/settlements/settlement-B/approval-pdf/latest");
  expect(settlementDownloadPaths).toEqual([
    "/api/settlements/settlement-B/approval-pdf/latest"
  ]);
});
