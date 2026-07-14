import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

const screenshotDir = process.env.UI_P0_SCREENSHOT_DIR
  ? resolve(process.env.UI_P0_SCREENSHOT_DIR)
  : resolve("test-results/ui-p0-screenshots");

const desktopViewports = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 }
];

const normalWorkItems = {
  generatedAt: "2026-07-14T08:00:00.000Z",
  visibleProjectCount: 2,
  queues: {
    pending: [
      {
        id: "approval-1",
        type: "approval",
        businessType: "payment",
        title: "付款审批：6月材料结算",
        projectName: "科技园项目",
        businessCode: "FK-UI-001",
        amountText: "¥256,000.00",
        currentNode: "财务总监审批",
        stayedText: "已停留 5 小时",
        nextAction: "处理付款审批",
        targetPath: "/付款管理/FK-UI-001",
        tone: "warning"
      },
      {
        id: "archive-1",
        type: "archive",
        businessType: "archive",
        title: "合同归档确认",
        projectName: "产业园二期",
        businessCode: "HT-UI-002",
        amountText: "¥1,280,000.00",
        currentNode: "合同主管确认",
        stayedText: "已停留 2 小时",
        nextAction: "确认归档",
        targetPath: "/contracts/HT-UI-002",
        tone: "primary"
      }
    ],
    blocked: [
      {
        id: "blocker-1",
        type: "blocker",
        businessType: "payment_execution",
        title: "付款凭证缺失",
        projectName: "科技园项目",
        businessCode: "FK-UI-003",
        amountText: "¥86,000.00",
        currentNode: "出纳付款登记",
        stayedText: "已停留 3 天",
        nextAction: "补齐付款凭证",
        targetPath: "/付款管理/FK-UI-003",
        tone: "danger"
      }
    ],
    started: [
      {
        id: "started-1",
        type: "payment",
        businessType: "payment",
        title: "我发起的付款申请",
        projectName: "产业园二期",
        businessCode: "FK-UI-004",
        amountText: "¥120,000.00",
        currentNode: "项目经理审批",
        stayedText: "已停留 1 天",
        nextAction: "查看进度",
        targetPath: "/付款管理/FK-UI-004",
        tone: "default"
      }
    ]
  },
  approvalCenter: {
    pendingApproval: [],
    startedByMe: [],
    handledByMe: [],
    delegatedToMe: [],
    overdueReminder: []
  }
};

const ledgerBody = {
  rows: [
    {
      id: "FK-UI-001",
      paymentNo: "FK-UI-001",
      contractNo: "HT-UI-001 · 科技园钢材采购",
      settlementNo: "JS-UI-006",
      project: "科技园项目",
      requestedAmount: "¥256,000.00",
      approvalStatus: "已通过",
      approvalTone: "success",
      paymentStatus: "已批待付",
      paymentTone: "warning",
      currentNode: "出纳付款登记",
      ownerDepartment: "财务部",
      pendingOwner: "出纳 王会计",
      stalledFor: "5 小时",
      returnReason: "-",
      nextAction: "登记实付",
      updatedAt: "07-14 09:20"
    },
    {
      id: "FK-UI-002",
      paymentNo: "FK-UI-002",
      contractNo: "HT-UI-003 · 产业园劳务合同",
      settlementNo: "合同累计结算",
      project: "产业园二期",
      requestedAmount: "¥180,000.00",
      approvalStatus: "审批中",
      approvalTone: "primary",
      paymentStatus: "未实付",
      paymentTone: "default",
      currentNode: "董事长/总经理或签",
      ownerDepartment: "综合部",
      pendingOwner: "总经理",
      stalledFor: "1 天",
      returnReason: "-",
      nextAction: "等待审批",
      updatedAt: "07-13 16:45"
    },
    {
      id: "FK-UI-003",
      paymentNo: "FK-UI-003",
      contractNo: "HT-UI-004 · 临建设施采购",
      settlementNo: "JS-UI-008",
      project: "科技园项目",
      requestedAmount: "¥86,000.00",
      approvalStatus: "已通过",
      approvalTone: "success",
      paymentStatus: "已实付",
      paymentTone: "success",
      currentNode: "财务入账",
      ownerDepartment: "财务部",
      pendingOwner: "财务 李会计",
      stalledFor: "2 小时",
      returnReason: "-",
      nextAction: "确认入账",
      updatedAt: "07-14 08:10"
    }
  ],
  summary: { total: 3, pendingApproval: 1, orSign: 1, pendingPayment: 1, paid: 1 }
};

const contractOption = {
  contractId: "contract-ui-1",
  contractVersionId: "version-ui-1",
  contractNo: "HT-UI-001",
  contractName: "科技园钢材采购合同",
  counterparty: "城建物资有限公司",
  amountCents: "128000000",
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
      settlementId: "settlement-ui-1",
      settlementNo: "JS-UI-006",
      periodLabel: "2026年6月",
      amountCents: "32000000",
      payableAmountCents: "25600000",
      paidAmountCents: "0",
      status: "effective",
      statusLabel: "已生效",
      canCreatePayment: true,
      unavailableReason: null
    }
  ]
};

const previewBody = {
  contract: {
    contractId: "contract-ui-1",
    contractVersionId: "version-ui-1",
    contractNo: "HT-UI-001",
    contractName: "科技园钢材采购合同",
    contractVersion: "v1",
    projectId: "project-ui-1",
    projectName: "科技园项目"
  },
  asOf: "2026-07-14T08:00:00.000Z",
  includedSettlements: [
    {
      settlementId: "settlement-ui-1",
      settlementNo: "JS-UI-006",
      period: "2026年6月",
      amountCents: "32000000",
      status: "effective",
      isFinal: false
    }
  ],
  capacity: {
    cumulativeEffectiveSettlementCents: "32000000",
    duePayableCents: "25600000",
    occupiedCents: "0",
    actualPaidCents: "6400000",
    approvalPendingCents: "0",
    approvedPendingCents: "0",
    proxyPaidCents: "0",
    advanceDeductionCents: "0",
    maxRequestableCents: "19200000"
  },
  advanceDeduction: {
    paidAdvanceCents: "0",
    currentDeductionCents: "0",
    remainingAdvanceToDeductCents: "0"
  },
  capacityExplanation: [
    { label: "累计应付", amountCents: "25600000", operator: "add", note: "后端按合同条款核算", tone: "primary" },
    { label: "已实付", amountCents: "6400000", operator: "subtract", note: "已登记实付", tone: "default" },
    { label: "最多可申请", amountCents: "19200000", operator: "result", note: "提交时再次校验", tone: "success" }
  ],
  sections: [
    {
      type: "progress",
      title: "进度结算款",
      rows: [
        {
          id: "preview-row-1",
          source: "JS-UI-006",
          settlementId: "settlement-ui-1",
          settlementNo: "JS-UI-006",
          currentSettlementAmountCents: "32000000",
          cumulativeBeforeAmountCents: "0",
          cumulativeAfterAmountCents: "32000000",
          effectiveAt: "2026-07-01T00:00:00.000Z",
          expectedPayableAt: "2026-07-10T00:00:00.000Z",
          paymentRule: "生效后支付 80%",
          invoiceRequirement: "需提供合规发票",
          isDue: true,
          includableAmountCents: "25600000"
        }
      ]
    }
  ],
  formula: "后端核算结果"
};

const detailBody = {
  id: "FK-UI-001",
  title: "FK-UI-001 · 6月材料结算付款申请",
  meta: [
    { label: "审批状态", value: "已通过", tone: "success" },
    { label: "实付状态", value: "已批待付", tone: "warning" },
    { label: "付款条款版本", value: "v1 随合同生效" },
    { label: "关联合同版本", value: "合同 v1" },
    { label: "责任部门", value: "财务部" },
    { label: "下一步动作", value: "出纳付款登记", tone: "primary" }
  ],
  baseInfo: [
    { label: "付款编号", value: "FK-UI-001" },
    { label: "关联结算", value: "JS-UI-006 · 6月材料结算单" },
    { label: "结算状态", value: "已生效" },
    { label: "付款阶段", value: "进度结算款" },
    { label: "付款比例", value: "80%" },
    { label: "付款账期", value: "10天" },
    { label: "发票要求", value: "需提供合规发票" },
    { label: "申请金额", value: "¥256,000.00" },
    { label: "申请人", value: "项目经理 张工" }
  ],
  approvalSteps: [
    { label: "付款申请", status: "已提交", owner: "项目经理", tone: "success" },
    { label: "财务总监审批", status: "已通过", owner: "财务总监", tone: "success" },
    { label: "董事长/总经理或签", status: "已通过", owner: "总经理", tone: "success" }
  ],
  executionSteps: [
    { label: "已批待付", status: "当前状态", owner: "财务部", tone: "warning" },
    { label: "出纳付款登记", status: "待处理", owner: "出纳", tone: "primary" },
    { label: "财务入账", status: "未开始", owner: "财务部", tone: "default" }
  ],
  executionAllocations: [],
  executionCoverages: [
    {
      id: "coverage-ui-1",
      executionCode: "待登记",
      paidAt: "-",
      paidAmount: "¥0.00",
      voucherName: "未上传",
      financeRecordedAmount: "¥0.00",
      unrecordedAmount: "¥256,000.00",
      coverageStatus: "待实付"
    }
  ],
  evidenceFiles: [
    {
      recordId: "file-record-ui-1",
      fileId: "file-ui-1",
      fileName: "FK-UI-001-付款审批单.pdf",
      purpose: "付款审批单",
      mimeType: "application/pdf",
      sizeBytes: 4096,
      status: "archived",
      statusLabel: "已归档",
      uploadedByName: "系统",
      uploadedAt: "2026-07-14T08:00:00.000Z",
      confirmedByName: null,
      confirmedAt: null,
      canDownload: true,
      disabledReason: null
    }
  ],
  approvalTimeline: [
    {
      id: "timeline-ui-1",
      action: "approve",
      actionLabel: "审批通过",
      actorUserId: "manager-ui",
      actorName: "财务总监",
      comment: "资料完整，同意付款",
      nodeName: "财务总监审批",
      roleName: "财务总监",
      createdAt: "2026-07-13T16:30:00.000Z"
    }
  ],
  availableActions: [
    {
      key: "record_execution",
      label: "登记实付",
      kind: "primary",
      enabled: true,
      disabledReason: null,
      requiresPassword: true,
      requiresFile: true
    }
  ],
  primaryAction: "record_execution",
  disabledReasons: [],
  traceRules: [
    "付款申请来自已生效结算",
    "审批通过进入已批待付",
    "审批通过不等于实际付款完成",
    "实付登记必须上传付款凭证并写入审计日志"
  ],
  executionBlockMessage: "付款审批已通过，但尚未登记实际付款；必须由出纳登记实付并上传付款凭证。",
  chainLinks: [
    { label: "关联合同 HT-UI-001", to: "/contracts/HT-UI-001" },
    { label: "关联结算 JS-UI-006", to: "/settlements/JS-UI-006" }
  ]
};

test("captures the UI P0 enterprise sample and reproducible states", async ({ page }) => {
  test.setTimeout(90_000);
  mkdirSync(screenshotDir, { recursive: true });

  let ledgerMode: "normal" | "failure" = "normal";
  let pendingLoadingRoute: Route | null = null;

  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "ui-p0-user",
          name: "财务验收用户",
          phone: "13900000000",
          mustChangePassword: false,
          roleKeys: ["finance_director", "finance_staff", "project_manager"],
          globalRoleKeys: ["finance_director", "finance_staff"]
        },
        tokens: { accessToken: "ui-p0-access", refreshToken: "ui-p0-refresh", expiresIn: 900 }
      })
    })
  );
  await page.route("**/api/me/work-items", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(normalWorkItems)
    })
  );
  await page.route("**/api/approval-delegations/user-options", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{ id: "project-ui-1", code: "P-UI-001", name: "科技园项目" }])
    })
  );
  await page.route("**/api/contracts/payment-create-options?*", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify([contractOption]) })
  );
  await page.route("**/api/payments/contract-application?*", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(previewBody) })
  );
  await page.route("**/api/payments/FK-UI-001", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(detailBody) })
  );
  await page.route("**/api/payments/FK-LOAD-001", (route) => {
    pendingLoadingRoute = route;
  });
  await page.route("**/api/payments", (route) => {
    if (ledgerMode === "failure") {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "台账服务暂时不可用" })
      });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(ledgerBody) });
  });

  await login(page);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await captureRequiredViewports(page, "home", "home-normal");

  await page.goto("/付款管理");
  await expect(page.getByRole("heading", { name: "付款管理" })).toBeVisible();
  await expect(page.getByText(/暂不支持翻页/)).toBeVisible();
  await captureRequiredViewports(page, "payment-ledger", "payment-ledger-normal");

  await page.setViewportSize({ width: 1440, height: 900 });
  ledgerMode = "failure";
  await page.goto("/付款管理");
  await expect(page.getByText("付款记录暂时无法读取")).toBeVisible();
  await expect(page.locator(".business-status-summary")).toContainText("—");
  await expect(page.getByText("数据成功加载后，将在此说明本次展示范围。")).toBeVisible();
  await expect(page.getByText(/暂不支持翻页/)).toHaveCount(0);
  await capture(page, "payment-ledger-failure-1440x900.png");
  ledgerMode = "normal";

  await page.goto("/付款工作台");
  await expect(page.getByRole("heading", { name: "付款工作台" })).toBeVisible();
  const workbenchSelects = page.locator(".create-grid .t-select");
  await expect(workbenchSelects).toHaveCount(3);
  await workbenchSelects.nth(1).click();
  await page
    .getByText("HT-UI-001 · 科技园钢材采购合同 · 城建物资有限公司", { exact: true })
    .last()
    .click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByText("待补充 3 项")).toBeVisible();
  await expect(page.getByText("请先校验可付款额度").first()).toBeVisible();
  await capture(page, "payment-workbench-missing-data-1440x900.png");
  await page.getByPlaceholder("请输入申请金额").fill("192000.00");
  await page.getByRole("button", { name: "校验可付款额度" }).click();
  await expect(page.locator(".capacity-explanation")).toContainText("最多可申请");
  await captureRequiredViewports(page, "payment-workbench", "payment-workbench-normal");

  await page.goto("/付款管理/FK-UI-001");
  await expect(page.getByRole("heading", { name: "6月材料结算付款申请" })).toBeVisible();
  await expect(page.locator(".business-detail-header")).toContainText("申请金额");
  await expect(page.locator(".business-detail-header")).toContainText("¥256,000.00");
  await expect(page.locator(".overview-section").first()).not.toContainText("申请金额");
  await captureRequiredViewports(page, "payment-detail", "payment-detail-overview");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "前往实付登记" }).click();
  await expect(page.getByText("出纳实付")).toBeVisible();
  await expect(page.getByRole("button", { name: "确认登记实付" })).toBeVisible();
  await expect(page.locator(".action-group").filter({ hasText: "出纳实付" }).locator(".t-upload")).toBeVisible();
  await capture(page, "payment-detail-process-1440x900.png");

  await page.goto("/付款管理/FK-LOAD-001");
  await expect(page.locator(".detail-loading-skeleton")).toBeVisible();
  await capture(page, "payment-detail-loading-1440x900.png");
  await pendingLoadingRoute?.fulfill({
    contentType: "application/json",
    body: JSON.stringify(detailBody)
  });
});

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("UiP0@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
}

async function captureRequiredViewports(page: Page, compactPrefix: string, widePrefix: string) {
  for (const viewport of desktopViewports) {
    await page.setViewportSize(viewport);
    await page.evaluate(() =>
      new Promise<void>((resolveFrame) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()));
      })
    );
    const prefix = viewport.width === 1440 ? widePrefix : compactPrefix;
    await capture(page, `${prefix}-${viewport.width}x${viewport.height}.png`);
  }
}

async function capture(page: Page, fileName: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: resolve(screenshotDir, fileName),
    animations: "disabled"
  });
}
