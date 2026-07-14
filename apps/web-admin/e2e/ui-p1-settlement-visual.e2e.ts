import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

const screenshotDir = process.env.UI_P1_SETTLEMENT_SCREENSHOT_DIR
  ? resolve(process.env.UI_P1_SETTLEMENT_SCREENSHOT_DIR)
  : resolve("test-results/ui-p1-settlement-screenshots");

const desktopViewports = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1024, height: 768 }
];

const ledgerBody = {
  rows: [
    {
      id: "JS-UI-001",
      settlementNo: "JS-UI-001",
      contractNo: "HT-UI-001 · 科技园钢材采购",
      project: "科技园项目",
      period: "2026年6月",
      amount: "¥320,000.00",
      paymentTermsVersion: "v1",
      currentNode: "预算负责人审批",
      nodeTone: "primary",
      ownerDepartment: "预算部",
      pendingOwner: "预算主管",
      stalledFor: "5 小时",
      returnReason: "-",
      nextAction: "处理结算审批",
      updatedAt: "07-14 09:20"
    },
    {
      id: "JS-UI-ARCHIVE",
      settlementNo: "JS-UI-ARCHIVE",
      contractNo: "HT-UI-003 · 产业园劳务合同",
      project: "产业园二期",
      period: "2026年5月",
      amount: "¥180,000.00",
      paymentTermsVersion: "v2",
      currentNode: "待归档确认",
      nodeTone: "warning",
      ownerDepartment: "合同部",
      pendingOwner: "合同员",
      stalledFor: "1 天",
      returnReason: "-",
      nextAction: "上传结算归档件",
      updatedAt: "07-13 16:45"
    },
    {
      id: "JS-UI-003",
      settlementNo: "JS-UI-003",
      contractNo: "HT-UI-004 · 临建设施采购",
      project: "科技园项目",
      period: "2026年4月",
      amount: "¥86,000.00",
      paymentTermsVersion: "v1",
      currentNode: "已生效",
      nodeTone: "success",
      ownerDepartment: "合同部",
      pendingOwner: "-",
      stalledFor: "-",
      returnReason: "-",
      nextAction: "可申请付款",
      updatedAt: "07-12 11:30"
    }
  ],
  summary: { total: 3, inApproval: 1, pendingArchive: 1, effective: 1, payable: 1 }
};

const approvalDetailBody = settlementDetail({
  id: "JS-UI-001",
  title: "JS-UI-001 · 6月材料结算单",
  status: "审批中",
  statusTone: "primary",
  nextAction: "预算负责人审批",
  actions: [
    action("review_approval", "处理结算审批", "primary", true),
    action("download_approval_form", "下载最新审批 PDF", "normal", true),
    action("withdraw_approval", "撤回审批", "normal", true),
    action("remind_approval", "催办审批", "normal", true),
    action("transfer_approval", "转审", "normal", false, "当前用户不是当前审批节点处理人"),
    action("delegate_approval", "委托", "normal", false, "当前用户不是当前审批节点处理人"),
    action("generate_pdf_archive", "生成 PDF 归档", "normal", true)
  ],
  primaryAction: "review_approval",
  disabledReasons: ["转审：当前用户不是当前审批节点处理人", "委托：当前用户不是当前审批节点处理人"]
});

const archiveDetailBody = settlementDetail({
  id: "JS-UI-ARCHIVE",
  title: "JS-UI-ARCHIVE · 5月劳务结算单",
  status: "待上传归档件",
  statusTone: "warning",
  nextAction: "上传结算归档件",
  actions: [
    action("upload_archive", "上传结算归档件", "primary", true),
    action("download_approval_form", "下载最新审批 PDF", "normal", true),
    action("generate_pdf_archive", "生成 PDF 归档", "normal", true)
  ],
  primaryAction: "upload_archive",
  disabledReasons: []
});

test("captures the settlement P1.1 ledger and detail states", async ({ page }) => {
  test.setTimeout(90_000);
  mkdirSync(screenshotDir, { recursive: true });

  let ledgerMode: "normal" | "failure" | "empty" = "normal";
  let pendingLoadingRoute: Route | null = null;

  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: "ui-p1-settlement-user",
        name: "结算验收用户",
        phone: "13900000000",
        mustChangePassword: false,
        roleKeys: ["budget_director", "contract_staff", "project_manager"],
        globalRoleKeys: ["budget_director"]
      },
      tokens: { accessToken: "ui-p1-access", refreshToken: "ui-p1-refresh", expiresIn: 900 }
    })
  }));
  await page.route("**/api/me/work-items", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      generatedAt: "2026-07-14T08:00:00.000Z",
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
    body: JSON.stringify([{ id: "delegate-user", name: "预算员 李工" }])
  }));
  await page.route("**/api/settlements/JS-UI-001", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(approvalDetailBody)
  }));
  await page.route("**/api/settlements/JS-UI-ARCHIVE", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(archiveDetailBody)
  }));
  await page.route("**/api/settlements/JS-UI-LOAD", (route) => {
    pendingLoadingRoute = route;
  });
  await page.route("**/api/settlements", (route) => {
    if (ledgerMode === "failure") {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "结算台账服务暂时不可用" })
      });
    }
    if (ledgerMode === "empty") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          rows: [],
          summary: { total: 0, inApproval: 0, pendingArchive: 0, effective: 0, payable: 0 }
        })
      });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(ledgerBody) });
  });

  await login(page);

  await page.goto("/结算管理");
  await expect(page.getByRole("heading", { name: "结算管理" })).toBeVisible();
  await expect(page.getByText(/暂不支持翻页/)).toBeVisible();
  await expect(page.locator(".ledger-section .t-link").filter({ hasText: "查看详情" })).toHaveCount(3);
  await captureRequiredViewports(page, "settlement-ledger", "settlement-ledger-normal");

  await page.setViewportSize({ width: 1440, height: 900 });
  ledgerMode = "failure";
  await page.goto("/结算管理");
  await expect(page.getByText("结算记录暂时无法读取")).toBeVisible();
  await expect(page.locator(".business-status-summary")).toContainText("—");
  await expect(page.getByText(/这不代表当前没有结算记录/)).toBeVisible();
  await expect(page.getByText("数据成功加载后，将在此说明本次展示范围。")).toBeVisible();
  await capture(page, "settlement-ledger-failure-1440x900.png");

  ledgerMode = "empty";
  await page.goto("/结算管理");
  await expect(page.getByText("当前条件下暂无结算记录")).toBeVisible();
  await expect(page.getByRole("button", { name: "新建结算" })).toHaveCount(1);
  await capture(page, "settlement-ledger-empty-1440x900.png");
  ledgerMode = "normal";

  await page.goto("/settlements/JS-UI-001");
  await expect(page.getByRole("heading", { name: "6月材料结算单" })).toBeVisible();
  await expect(page.locator(".business-detail-header")).toContainText("结算金额");
  await expect(page.locator(".business-detail-header")).toContainText("¥320,000.00");
  await expect(page.locator(".overview-section").first()).not.toContainText("结算金额");
  await captureRequiredViewports(page, "settlement-detail", "settlement-detail-overview");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "处理结算审批" }).click();
  await expect(page.getByText("当前办理动作")).toBeVisible();
  await expect(page.getByText("当前不可办理原因")).toBeVisible();
  await capture(page, "settlement-detail-process-1440x900.png");

  await page.goto("/settlements/JS-UI-ARCHIVE");
  await page.getByRole("button", { name: "上传结算归档件" }).click();
  await expect(page.getByText("归档办理")).toBeVisible();
  await expect(page.locator(".action-group").filter({ hasText: "上传签章结算单" }).locator(".t-upload")).toBeVisible();
  await capture(page, "settlement-detail-evidence-1440x900.png");

  await page.goto("/settlements/JS-UI-LOAD");
  await expect(page.locator(".detail-loading-skeleton")).toBeVisible();
  await expect(page.getByRole("button", { name: "审计记录" })).toBeDisabled();
  await capture(page, "settlement-detail-loading-1440x900.png");
  await pendingLoadingRoute?.fulfill({
    contentType: "application/json",
    body: JSON.stringify(approvalDetailBody)
  });
});

function settlementDetail(input: {
  id: string;
  title: string;
  status: string;
  statusTone: "default" | "primary" | "warning" | "danger" | "success";
  nextAction: string;
  actions: ReturnType<typeof action>[];
  primaryAction: string | null;
  disabledReasons: string[];
}) {
  return {
    id: input.id,
    settlementId: `record-${input.id}`,
    title: input.title,
    meta: [
      { label: "当前状态", value: input.status, tone: input.statusTone },
      { label: "关联合同版本", value: "合同 v1" },
      { label: "付款条款版本", value: "v1 随合同生效" },
      { label: "结算期间", value: input.id === "JS-UI-ARCHIVE" ? "2026年5月" : "2026年6月" },
      { label: "责任部门", value: "合同部" },
      { label: "下一步动作", value: input.nextAction, tone: input.statusTone }
    ],
    baseInfo: [
      { label: "结算编号", value: input.id },
      { label: "关联合同", value: "HT-UI-001 · 科技园钢材采购合同" },
      { label: "结算性质", value: "月度结算" },
      { label: "是否最终结算", value: "否" },
      { label: "结算金额", value: "¥320,000.00" },
      { label: "创建人", value: "项目经理 张工" }
    ],
    effectivenessSteps: [
      { label: "结算审批", status: input.status === "审批中" ? "处理中" : "已通过", tone: input.status === "审批中" ? "primary" : "success" },
      { label: "签字盖章归档上传", status: input.status === "审批中" ? "待开始" : "待上传", tone: input.status === "审批中" ? "default" : "warning" },
      { label: "合同部主管确认", status: "待处理", tone: "default" },
      { label: "结算生效", status: "未生效", tone: "default" }
    ],
    archiveResponsibilities: [
      "结算审批不经过董事长/总经理",
      "结算归档件由合同部成员上传",
      "归档由合同部主管确认",
      "财务只读取业务归档件"
    ],
    paymentRules: [
      {
        id: "payment-stage-1",
        stage: "当期结算款",
        ratio: "80%",
        accountPeriod: "30天",
        invoiceRequirement: "需提供发票",
        triggerCondition: "结算归档确认生效",
        paymentRequestStatus: "未开放"
      }
    ],
    settlementLines: [
      {
        id: "line-1",
        sourceType: "contract_bill_row",
        sourceLabel: "合同清单项",
        name: "钢筋材料",
        unit: "吨",
        quantity: "100",
        unitPrice: "¥3,200.00（含税）",
        calculationMode: "normal_auto",
        amount: "¥320,000.00",
        amountCents: "32000000",
        reason: "按验收数量结算",
        remark: "-"
      }
    ],
    payableCalculation: {
      items: [
        { label: "本期结算金额", value: "¥320,000.00" },
        { label: "本期可付金额", value: "¥256,000.00", tone: "success" },
        { label: "已申请付款", value: "¥0.00", tone: "default" },
        { label: "已实付金额", value: "¥0.00" },
        { label: "剩余可申请", value: "¥256,000.00", tone: "primary" }
      ],
      note: "剩余可申请按已核定可付金额扣减有效付款申请，提交付款申请时系统会再次校验。"
    },
    paymentBlockMessage: "结算尚未生效，暂不可创建付款申请；付款比例和账期按绑定的付款条款版本执行。",
    archiveFiles: [],
    approvalTimeline: [
      {
        id: "timeline-1",
        title: "发起结算审批",
        description: "项目经理已提交本期结算",
        operator: "张工",
        occurredAt: "2026-07-14T08:30:00.000Z",
        status: "completed",
        statusLabel: "已完成",
        tone: "success"
      }
    ],
    availableActions: input.actions,
    primaryAction: input.primaryAction,
    disabledReasons: input.disabledReasons,
    chainLinks: [
      { label: "关联合同", to: "/contracts/HT-UI-001" },
      { label: "付款申请", to: "/payments" },
      { label: "归档资料", to: "/archives" },
      { label: "审计日志", to: "/audit" }
    ]
  };
}

function action(
  key: string,
  label: string,
  kind: "primary" | "normal" | "danger",
  enabled: boolean,
  disabledReason: string | null = null
) {
  return { key, label, kind, enabled, disabledReason };
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("UiP1@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
}

async function captureRequiredViewports(page: Page, compactPrefix: string, widePrefix: string) {
  for (const viewport of desktopViewports) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise<void>((resolveFrame) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()));
    }));
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
