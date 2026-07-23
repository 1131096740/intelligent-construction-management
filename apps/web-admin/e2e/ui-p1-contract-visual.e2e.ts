import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import {
  expectNoDocumentHorizontalOverflow,
  expectNoNestedHorizontalScrollers
} from "./helpers/responsive-assertions";

const screenshotDir = process.env.UI_P1_CONTRACT_SCREENSHOT_DIR
  ? resolve(process.env.UI_P1_CONTRACT_SCREENSHOT_DIR)
  : resolve("test-results/ui-p1-contract-screenshots");

const desktopViewports = [
  { width: 1512, height: 982 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1180, height: 820 },
  { width: 1024, height: 768 },
  { width: 900, height: 768 }
];

const ledgerBody = {
  rows: [
    {
      id: "HT-UI-001",
      contractNo: "HT-UI-001",
      name: "科技园钢材采购合同",
      project: "科技园项目",
      counterparty: "昆明建材供应有限公司",
      amount: "¥1,200,000.00",
      version: "v1",
      currentNode: "合同负责人审批",
      nodeTone: "primary",
      ownerDepartment: "合同部",
      pendingOwner: "合同主管",
      stalledFor: "5 小时",
      returnReason: "-",
      nextAction: "处理合同审批",
      updatedAt: "07-14 09:20",
      paymentTermsVersion: "v1"
    },
    {
      id: "HT-UI-ARCHIVE",
      contractNo: "HT-UI-ARCHIVE",
      name: "产业园劳务分包合同",
      project: "产业园二期",
      counterparty: "云南智建劳务有限公司",
      amount: "¥860,000.00",
      version: "v2",
      currentNode: "待归档确认",
      nodeTone: "warning",
      ownerDepartment: "合同部",
      pendingOwner: "合同主管",
      stalledFor: "1 天",
      returnReason: "-",
      nextAction: "确认合同归档",
      updatedAt: "07-13 16:45",
      paymentTermsVersion: "v2"
    },
    {
      id: "HT-UI-003",
      contractNo: "HT-UI-003",
      name: "临建设施采购合同",
      project: "科技园项目",
      counterparty: "云南临建设施有限公司",
      amount: "¥320,000.00",
      version: "v1",
      currentNode: "已生效",
      nodeTone: "success",
      ownerDepartment: "合同部",
      pendingOwner: "-",
      stalledFor: "-",
      returnReason: "-",
      nextAction: "可发起结算",
      updatedAt: "07-12 11:30",
      paymentTermsVersion: "v1"
    }
  ],
  meta: { page: 1, pageSize: 20, total: 3, totalPages: 1 },
  summary: { formal_ledger: 3, my_drafts: 2, returned_for_revision: 0, ended: 0 }
};

const drafts = [
  {
    id: "draft-ui-1",
    temporaryCode: "草稿-20260714-0001",
    code: null,
    name: "科技园防水专业分包合同",
    contractTypeKey: "professional_subcontract",
    updatedAt: "2026-07-14T08:40:00.000Z"
  },
  {
    id: "draft-ui-2",
    temporaryCode: "草稿-20260713-0008",
    code: null,
    name: "产业园模板劳务合同",
    contractTypeKey: "labor_subcontract",
    updatedAt: "2026-07-13T09:10:00.000Z"
  }
];

const approvalDetailBody = contractDetail({
  id: "HT-UI-001",
  versionId: "version-ui-approval",
  title: "HT-UI-001 · 科技园钢材采购合同",
  status: "审批中",
  statusTone: "primary",
  nextAction: "合同负责人审批",
  actions: [
    action("review_approval", "处理合同审批", "primary", true),
    action("download_approval_form", "下载最新审批单", "normal", true),
    action("withdraw_approval", "撤回审批", "normal", true),
    action("remind_approval", "催办审批", "normal", true),
    action("transfer_approval", "转审", "normal", false, "当前用户不是当前审批节点处理人"),
    action("delegate_approval", "委托", "normal", false, "当前用户不是当前审批节点处理人")
  ],
  primaryAction: "review_approval",
  disabledReasons: ["转审：当前用户不是当前审批节点处理人", "委托：当前用户不是当前审批节点处理人"]
});

const archiveDetailBody = contractDetail({
  id: "HT-UI-ARCHIVE",
  versionId: "version-ui-archive",
  title: "HT-UI-ARCHIVE · 产业园劳务分包合同",
  status: "待上传归档件",
  statusTone: "warning",
  nextAction: "上传盖章合同",
  actions: [
    action("upload_archive", "上传合同归档件", "primary", true),
    action("download_approval_form", "下载最新审批单", "normal", true),
    action("generate_pdf_archive", "生成归档文件", "normal", true)
  ],
  primaryAction: "upload_archive",
  disabledReasons: []
});

test("captures the contract P1.2 ledger and detail states", async ({ page }) => {
  test.setTimeout(90_000);
  mkdirSync(screenshotDir, { recursive: true });

  let ledgerMode: "normal" | "failure" | "empty" = "normal";
  let pendingLoadingRoute: Route | null = null;
  const previewTicketBodies: unknown[] = [];

  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: "ui-p1-contract-user",
        name: "合同验收用户",
        phone: "13900000000",
        mustChangePassword: false,
        roleKeys: ["contract_director", "contract_staff", "project_manager"],
        globalRoleKeys: ["contract_director"]
      },
      tokens: { accessToken: "ui-p1-access", refreshToken: "ui-p1-refresh", expiresIn: 900 }
    })
  }));
  await page.route("**/api/me/work-items", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      generatedAt: "2026-07-14T08:00:00.000Z",
      visibleProjectCount: 2,
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
    body: JSON.stringify([{ id: "delegate-user", name: "合同员 李工" }])
  }));
  await page.route("**/api/contract-number-rules", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([{ id: "rule-1", name: "材料合同编号", pattern: "HT-CL-{YYYY}-{SEQ}" }])
  }));
  await page.route("**/api/contract-workbench?scope=my", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(drafts)
  }));
  await page.route("**/api/contract-workbench?scope=voided", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([])
  }));
  await page.route("**/api/contracts/version-ui-*/change-eligibility", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      eligible: false,
      reason: "当前版本尚未生效",
      currentEffective: null,
      activeChange: null
    })
  }));
  await page.route("**/api/contracts/HT-UI-001", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(approvalDetailBody)
  }));
  await page.route("**/api/contracts/HT-UI-ARCHIVE", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(archiveDetailBody)
  }));
  await page.route("**/api/contracts/HT-UI-LOAD", (route) => {
    pendingLoadingRoute = route;
  });
  await page.route("**/api/files/file-ui-final/download-ticket", async (route) => {
    previewTicketBodies.push(route.request().postDataJSON());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        fileId: "file-ui-final",
        fileName: "科技园钢材采购合同-双方签署版.pdf",
        mimeType: "application/pdf",
        sizeBytes: 307200,
        expiresAt: "2026-07-23T08:05:00.000Z",
        downloadUrl: "/files/file-ui-final/download?accessMode=preview&token=preview-token"
      })
    });
  });
  await page.route("**/api/files/file-ui-final/download?*", (route) => route.fulfill({
    contentType: "application/pdf",
    headers: { "Content-Disposition": "inline; filename=contract.pdf" },
    body: "%PDF-1.4\n% preview fixture\n"
  }));
  await page.route("**/api/contracts/lifecycle-ledger?*", (route) => {
    if (ledgerMode === "failure") {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "合同台账服务暂时不可用" })
      });
    }
    if (ledgerMode === "empty") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          rows: [],
          meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
          summary: { formal_ledger: 0, my_drafts: 2, returned_for_revision: 0, ended: 0 }
        })
      });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(ledgerBody) });
  });

  await login(page);

  await page.goto("/合同管理");
  await expect(page.getByRole("heading", { name: "合同管理" })).toBeVisible();
  await expect(page.getByText("科技园钢材采购合同")).toBeVisible();
  await expect(page.getByText(/当前视图由服务端分页/)).toBeVisible();
  await expect(page.locator(".data-section .t-link").filter({ hasText: "查看详情" })).toHaveCount(3);
  await captureRequiredViewports(page, "contract-ledger", "contract-ledger-normal");

  await page.setViewportSize({ width: 1440, height: 900 });
  ledgerMode = "failure";
  await page.goto("/合同管理?project=科技园项目");
  await expect(page.getByText("合同记录暂时无法读取")).toBeVisible();
  await expect(page.locator(".business-status-summary")).toContainText("—");
  await expect(page.getByText(/这不代表当前没有合同记录/)).toBeVisible();
  await expect(page.getByText("数据成功加载后，将在此说明本次展示范围。")).toBeVisible();
  await capture(page, "contract-ledger-failure-1440x900.png");

  ledgerMode = "empty";
  await page.goto("/合同管理?project=科技园项目");
  await expect(page.getByText("当前条件下暂无合同记录")).toBeVisible();
  await expect(page.getByRole("button", { name: "新建合同" })).toHaveCount(1);
  await capture(page, "contract-ledger-empty-1440x900.png");
  ledgerMode = "normal";

  await page.goto("/contracts/HT-UI-001");
  await expect(page.getByRole("heading", { name: "科技园钢材采购合同" })).toBeVisible();
  await expect(page.locator(".business-detail-header")).toContainText("合同金额");
  await expect(page.locator(".business-detail-header")).toContainText("¥1,200,000.00");
  await expect(page.locator(".overview-section").first()).not.toContainText("合同金额");
  await captureRequiredViewports(page, "contract-detail", "contract-detail-overview");

  await page.locator(".detail-navigation").getByText("凭证资料", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "正式 PDF 预览" })).toBeVisible();
  await page.getByText("双方最终签署版", { exact: true }).last().click();
  await page.getByRole("button", { name: "预览当前版本" }).click();
  await expect(page.getByText("确认预览合同正式文件？", { exact: true })).toBeVisible();
  await page.getByPlaceholder("说明本次操作原因").fill("合同归档复核");
  await page.getByPlaceholder("用于确认当前操作者身份").fill("UiP1@2026");
  await page.getByRole("button", { name: "确认预览" }).click();
  await expect(page.locator("iframe[title='双方最终签署版预览']")).toHaveAttribute(
    "src",
    /\/api\/files\/file-ui-final\/download\?accessMode=preview&token=preview-token/
  );
  expect(previewTicketBodies).toEqual([{
    confirmationPassword: "UiP1@2026",
    downloadReason: "合同归档复核",
    accessMode: "preview"
  }]);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "处理合同审批" }).click();
  await expect(page.getByText("当前办理动作")).toBeVisible();
  await expect(page.getByText("当前不可办理原因")).toBeVisible();
  await capture(page, "contract-detail-process-1440x900.png");

  await page.locator(".detail-navigation").getByText("版本与条款", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "合同版本历史" })).toBeVisible();
  await expect(page.getByText("补充钢材暂估价调整条款")).toBeVisible();
  await capture(page, "contract-detail-versions-1440x900.png");

  await page.goto("/contracts/HT-UI-ARCHIVE");
  await page.getByRole("button", { name: "上传合同归档件" }).click();
  await expect(page.getByRole("heading", { name: "签署与归档证据" })).toBeVisible();
  await expect(page.locator(".formal-evidence-item strong").filter({ hasText: "审批前乙方签章版" })).toBeVisible();
  await expect(page.locator(".formal-evidence-item strong").filter({ hasText: "双方最终签署版" })).toBeVisible();
  await expect(page.getByText("合同审批单", { exact: true })).toBeVisible();
  await expect(page.getByText("归档办理")).toBeVisible();
  await expect(page.locator(".action-group").filter({ hasText: "上传盖章合同" }).locator(".t-upload")).toBeVisible();
  await capture(page, "contract-detail-evidence-1440x900.png");

  await page.goto("/contracts/HT-UI-001");
  await expect(page.getByRole("heading", { name: "科技园钢材采购合同" })).toBeVisible();
  await page.locator(".detail-navigation").getByText("结算与付款", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "合同资金事实" })).toBeVisible();
  await expect(page.getByText("结算 JS-UI-001")).toBeVisible();
  await capture(page, "contract-detail-funds-1440x900.png");

  await page.goto("/contracts/HT-UI-LOAD");
  await expect(page.locator(".detail-loading-skeleton")).toBeVisible();
  await expect(page.getByRole("button", { name: "审计记录" })).toBeDisabled();
  await capture(page, "contract-detail-loading-1440x900.png");
  await (pendingLoadingRoute as Route | null)?.fulfill({
    contentType: "application/json",
    body: JSON.stringify(approvalDetailBody)
  });
});

function contractDetail(input: {
  id: string;
  versionId: string;
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
    contractVersionId: input.versionId,
    title: input.title,
    meta: [
      { label: "当前状态", value: input.status, tone: input.statusTone },
      { label: "当前版本", value: "合同 v2" },
      { label: "付款条款", value: "v2 随合同生效" },
      { label: "责任部门", value: "合同部" },
      { label: "当前处理人", value: "合同主管 王工" },
      { label: "下一步动作", value: input.nextAction, tone: input.statusTone }
    ],
    baseInfo: [
      { label: "合同编号", value: input.id },
      { label: "项目", value: input.id === "HT-UI-ARCHIVE" ? "产业园二期" : "科技园项目" },
      { label: "相对方", value: input.id === "HT-UI-ARCHIVE" ? "云南智建劳务有限公司" : "昆明建材供应有限公司" },
      { label: "合同金额", value: "¥1,200,000.00" },
      { label: "签订日期", value: "2026-07-01" },
      { label: "合同类型", value: input.id === "HT-UI-ARCHIVE" ? "劳务分包" : "材料采购" },
      { label: "创建人", value: "项目经理 张工" }
    ],
    effectivenessSteps: [
      { label: "合同审批", status: input.status === "审批中" ? "处理中" : "已通过", tone: input.status === "审批中" ? "primary" : "success" },
      { label: "用章", status: input.status === "审批中" ? "待开始" : "已完成", tone: input.status === "审批中" ? "default" : "success" },
      { label: "归档上传", status: input.status === "待上传归档件" ? "待上传" : "未开始", tone: input.status === "待上传归档件" ? "warning" : "default" },
      { label: "主管确认", status: "未开始", tone: "default" },
      { label: "合同生效", status: "未生效", tone: "default" }
    ],
    paymentTermStages: [
      {
        id: "term-stage-1",
        version: "v2",
        status: "随合同生效",
        contractVersion: "合同 v2",
        basis: "当期结算",
        ratio: "80%",
        accountPeriod: "30天",
        triggerEvent: "结算归档确认"
      },
      {
        id: "term-stage-2",
        version: "v2",
        status: "随合同生效",
        contractVersion: "合同 v2",
        basis: "质保金",
        ratio: "20%",
        accountPeriod: "365天",
        triggerEvent: "质保期届满"
      }
    ],
    settlementBlockMessage: "合同尚未生效，暂不可发起结算；结算生效后方可创建付款申请。",
    settlementPayment: {
      summary: [
        { label: "合同金额", value: "¥1,200,000.00" },
        { label: "累计结算", value: "¥320,000.00", tone: "primary" },
        { label: "累计申请付款", value: "¥256,000.00" },
        { label: "累计实付", value: "¥180,000.00", tone: "success" }
      ],
      calculationNote: "金额来自合同、结算、付款申请和实付记录；各环节继续按系统业务规则校验。",
      settlementRows: [
        {
          id: "settlement-1",
          settlementNo: "JS-UI-001",
          period: "2026年6月",
          settlementDate: "2026-07-10",
          settlementMethod: "过程结算",
          currentAmount: "¥320,000.00",
          cumulativeBeforeAmount: "¥0.00",
          cumulativeAfterAmount: "¥320,000.00",
          approvalStatus: "已通过",
          archiveStatus: "已生效"
        }
      ],
      paymentRows: [
        {
          id: "payment-1",
          paymentNo: "FK-UI-001",
          settlementNo: "JS-UI-001",
          requestedAmount: "¥256,000.00",
          approvedAmount: "¥256,000.00",
          paidAmount: "¥180,000.00",
          paymentDate: "2026-07-13",
          approvalStatus: "已通过",
          paymentStatus: "部分付款",
          voucherStatus: "已上传"
        }
      ]
    },
    archiveFiles: input.id === "HT-UI-ARCHIVE" ? [] : [
      {
        archiveRecordId: "archive-ui-1",
        fileId: "file-ui-1",
        fileName: "科技园钢材采购合同-审批稿.pdf",
        mimeType: "application/pdf",
        sizeBytes: 204800,
        status: "uploaded",
        statusLabel: "已上传",
        uploadedByName: "合同员 李工",
        createdAt: "2026-07-12T09:30:00.000Z",
        confirmedByName: null,
        confirmedAt: null,
        canDownload: true,
        disabledReason: null
      }
    ],
    formalFiles: input.id === "HT-UI-001" ? [
      {
        formalFileId: "formal-ui-approval",
        purpose: "approval_original",
        fileId: "file-ui-approval",
        fileName: "科技园钢材采购合同-乙方签章版.pdf",
        pageCount: 12,
        sourceRevision: 1,
        status: "active",
        uploadedByUserId: "contract-staff-1",
        confirmedByUserId: null,
        confirmedAt: null
      },
      {
        formalFileId: "formal-ui-final",
        purpose: "mutually_signed_final",
        fileId: "file-ui-final",
        fileName: "科技园钢材采购合同-双方签署版.pdf",
        pageCount: 12,
        sourceRevision: 1,
        status: "active",
        uploadedByUserId: "contract-staff-1",
        confirmedByUserId: "contract-director-1",
        confirmedAt: "2026-07-14T08:00:00.000Z"
      }
    ] : [],
    approvalTimeline: [
      {
        id: "timeline-1",
        action: "submit",
        actionLabel: "提交合同审批",
        actorUserId: "user-1",
        actorName: "合同员 李工",
        comment: "资料已核对",
        nodeName: "合同审批",
        roleName: "合同经办人",
        createdAt: "2026-07-12T08:30:00.000Z"
      }
    ],
    changeVersions: [
      {
        versionNo: 2,
        status: "in_approval",
        changeType: "supplement",
        changeReason: "补充钢材暂估价调整条款",
        changeDirection: "increase",
        changeAmountCents: "20000000",
        amountCents: "120000000",
        approvalRoute: ["contract_director", "chairman_or_general_manager"],
        archiveEffect: null
      },
      {
        versionNo: 1,
        status: "effective",
        changeType: "original",
        changeReason: null,
        changeDirection: null,
        changeAmountCents: null,
        amountCents: "100000000",
        approvalRoute: ["contract_director", "chairman_or_general_manager"],
        archiveEffect: null
      }
    ],
    availableActions: input.actions,
    primaryAction: input.primaryAction,
    disabledReasons: input.disabledReasons,
    chainLinks: [
      { label: "结算台账", to: "/settlements" },
      { label: "付款台账", to: "/payments" },
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
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoNestedHorizontalScrollers(page);
    const prefix = viewport.width === 1440 ? widePrefix : compactPrefix;
    await capture(page, `${prefix}-${viewport.width}x${viewport.height}.png`);
  }
}

async function capture(page: Page, fileName: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => new Promise<void>((resolveFrame) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()));
  }));
  await page.screenshot({
    path: resolve(screenshotDir, fileName),
    animations: "disabled"
  });
}
