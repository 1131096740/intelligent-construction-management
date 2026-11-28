import { expect, test, type Page } from "@playwright/test";
import { expectApprovalProgressLoaded, mockApprovalProgress } from "./helpers/approval-progress-mocks";

async function loginWithMockedAuth(page: Page, roleKeys: string[], globalRoleKeys: string[] = []) {
  await page.route("**/api/approval-delegations/user-options", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify([]) })
  );
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "e2e-user",
          name: "E2E 用户",
          phone: "13900000000",
          mustChangePassword: false,
          roleKeys,
          globalRoleKeys
        },
        tokens: { accessToken: "e2e-access-token", refreshToken: "e2e-refresh-token", expiresIn: 900 }
      })
    })
  );

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
}

async function routeCoreDetailMocks(page: Page, enableSettlementArchive = false, paymentReviewGranted = () => false) {
  await mockApprovalProgress(page, [
    { businessType: "contract_version", businessId: "contract-version-e2e" },
    { businessType: "settlement", businessId: "JS-E2E-001" },
    { businessType: "payment_request", businessId: "FK-E2E-001" }
  ]);
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
  await page.route("**/api/contract-number-rules", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify([]) })
  );
  await page.route("**/api/contracts/HT-E2E-001", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "HT-E2E-001",
        contractVersionId: "contract-version-e2e",
        title: "HT-E2E-001 · E2E 钢材采购合同",
        changeVersions: [],
        meta: [
          { label: "当前状态", value: "待归档确认", tone: "primary" },
          { label: "当前版本", value: "原合同 v1" },
          { label: "付款条款", value: "v1 随合同生效" },
          { label: "责任部门", value: "合同部" },
          { label: "当前处理人", value: "合同主管" },
          { label: "下一步动作", value: "确认归档", tone: "primary" }
        ],
        baseInfo: [
          { label: "项目", value: "E2E 项目" },
          { label: "相对方", value: "E2E 供应商" },
          { label: "合同金额", value: "¥1,200,000.00" }
        ],
        effectivenessSteps: [{ label: "归档确认", status: "待处理", tone: "primary" }],
        paymentTermStages: [],
        settlementBlockMessage: "合同归档确认后可发起结算。",
        settlementPayment: { summary: [], settlementRows: [], paymentRows: [], calculationNote: "" },
        archiveFiles: [
          {
            archiveRecordId: "archive-e2e",
            fileId: "file-contract-e2e",
            fileName: "E2E-盖章合同.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1024,
            status: "confirmed",
            statusLabel: "已确认",
            uploadedByName: "合同员",
            createdAt: new Date().toISOString(),
            confirmedByName: "合同主管",
            confirmedAt: new Date().toISOString(),
            canDownload: true,
            disabledReason: null
          }
        ],
        approvalTimeline: [
          {
            id: "contract-approval-e2e",
            action: "approve",
            actionLabel: "审批通过",
            actorUserId: "e2e-user",
            actorName: "合同主管",
            comment: "同意",
            nodeName: "合同审批",
            roleName: "合同主管",
            createdAt: new Date().toISOString()
          }
        ],
        availableActions: [
          {
            key: "confirm_archive",
            label: "确认归档",
            kind: "primary",
            enabled: false,
            disabledReason: "需要当前处理人操作",
            requiresPassword: true
          }
        ],
        primaryAction: "confirm_archive",
        disabledReasons: ["需要当前处理人操作"],
        chainLinks: [{ label: "审计日志", to: "/audit" }]
      })
    })
  );
  await page.route("**/api/contracts/contract-version-e2e/duty-sms", route =>
    route.fulfill({ json: { notices: [] } })
  );
  await page.route("**/api/contracts/contract-version-e2e/change-eligibility", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        eligible: false,
        reason: "当前样例仅验证合同详情展示。",
        currentEffective: null,
        activeChange: null
      })
    })
  );
  await page.route("**/api/settlements/JS-E2E-001", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "JS-E2E-001",
        settlementId: "settlement-e2e",
        title: "JS-E2E-001 · E2E 结算单",
        meta: [
          { label: "当前状态", value: "待归档确认", tone: "primary" },
          { label: "关联合同版本", value: "合同 v1" },
          { label: "责任部门", value: "合同部" },
          { label: "下一步动作", value: "主管确认归档", tone: "primary" }
        ],
        baseInfo: [
          { label: "结算编号", value: "JS-E2E-001" },
          { label: "关联合同", value: "HT-E2E-001 · E2E 钢材采购合同" },
          { label: "结算金额", value: "¥320,000.00" }
        ],
        effectivenessSteps: [{ label: "归档确认", status: "待处理", tone: "primary" }],
        archiveResponsibilities: ["归档由合同部主管确认"],
        paymentRules: [],
        payableCalculation: {
          items: [{ label: "剩余可申请", value: "¥256,000.00", tone: "success" }],
          note: "结算生效后可发起付款。"
        },
        paymentBlockMessage: "结算尚未生效，暂不可创建付款申请。",
        archiveFiles: [
          {
            recordId: "settlement-file-e2e",
            fileId: "file-settlement-e2e",
            fileName: "E2E-结算签认件.pdf",
            purpose: "结算签认件",
            mimeType: "application/pdf",
            sizeBytes: 2048,
            status: "uploaded",
            statusLabel: "已上传",
            uploadedByName: "合同员",
            uploadedAt: new Date().toISOString(),
            confirmedByName: null,
            confirmedAt: null,
            canDownload: true,
            disabledReason: null
          }
        ],
        approvalTimeline: [],
        availableActions: [
          {
            key: "confirm_archive",
            label: "确认归档",
            kind: "primary",
            enabled: enableSettlementArchive,
            disabledReason: "需要合同主管确认",
            requiresPassword: true
          }
        ],
        primaryAction: "confirm_archive",
        disabledReasons: ["需要合同主管确认"],
        chainLinks: [{ label: "关联合同", to: "/contracts/HT-E2E-001" }]
      })
    })
  );
  await page.route("**/api/payments/FK-E2E-001", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: "FK-E2E-001",
        lifecycleUpdatedAt: "2026-11-18T00:00:00Z",
        reviewApprovalContext: paymentReviewGranted() ? {
          expectedApprovalInstanceId: "payment-round-1", expectedNodeIndex: 0,
          expectedPaymentUpdatedAt: "2026-11-18T00:00:00Z", expectedApprovalUpdatedAt: "2026-11-18T00:00:00Z"
        } : null,
        title: "FK-E2E-001 · E2E 付款申请",
        meta: [
          { label: "审批状态", value: "已通过", tone: "success" },
          { label: "实付状态", value: "已批待付", tone: "warning" },
          { label: "责任部门", value: "财务部" },
          { label: "下一步动作", value: "出纳付款登记", tone: "primary" }
        ],
        baseInfo: [
          { label: "付款编号", value: "FK-E2E-001" },
          { label: "关联结算", value: "JS-E2E-001 · E2E 结算单" },
          { label: "申请金额", value: "¥256,000.00" }
        ],
        approvalSteps: [{ label: "审批通过", status: "已批待付", owner: "系统", tone: "warning" }],
        executionSteps: [{ label: "出纳付款登记", status: "待处理", owner: "出纳", tone: "primary" }],
        executionAllocations: [],
        executionCoverages: [
          {
            id: "coverage-e2e",
            executionCode: "FK-E2E-001 · 第1笔",
            paidAt: "-",
            paidAmount: "¥0.00",
            voucherName: "未上传付款凭证",
            financeRecordedAmount: "¥0.00",
            unrecordedAmount: "¥256,000.00",
            coverageStatus: "待入账"
          }
        ],
        evidenceFiles: [
          {
            recordId: "payment-file-e2e",
            fileId: "file-payment-e2e",
            fileName: "E2E-付款审批单.pdf",
            purpose: "付款申请单",
            mimeType: "application/pdf",
            sizeBytes: 4096,
            status: "archived",
            statusLabel: "已归档",
            uploadedByName: "系统",
            uploadedAt: new Date().toISOString(),
            confirmedByName: null,
            confirmedAt: null,
            canDownload: true,
            disabledReason: null
          }
        ],
        approvalTimeline: [],
        availableActions: [
          ...(paymentReviewGranted() ? [{ key: "review_approval", label: "办理审批", kind: "primary", enabled: true }] : []),
          {
            key: "record_execution",
            label: "登记实付",
            kind: "primary",
            enabled: false,
            disabledReason: "需要出纳操作",
            requiresPassword: true,
            requiresFile: true
          }
        ],
        primaryAction: "record_execution",
        disabledReasons: ["需要出纳操作"],
        traceRules: ["审批通过进入已批待付", "审批通过不等于实际付款完成"],
        executionBlockMessage: "付款审批已通过，但尚未登记实际付款。",
        chainLinks: [{ label: "关联结算", to: "/settlements/JS-E2E-001" }]
      })
    })
  );
}

test("opens the workbench shell and historical takeover entry", async ({ page }) => {
  const takeover = {
    id: "takeover-1",
    contractNo: "HT-TAKEOVER-001",
    contractName: "E2E 历史材料合同",
    counterparty: "历史供应商",
    companyEntityName: "建工智管公司",
    amountCents: "100000000",
    paymentTermsOriginalText: "按月结算付款",
    invoiceType: null,
    taxMode: "single_rate",
    defaultTaxRatePercent: null,
    taxFactStatus: "unconfirmed",
    taxFactSource: null,
    taxFactExplanation: null,
    taxFactMissingFields: ["发票类型", "默认税率"],
    pricingItems: [],
    takeoverLevel: "B",
    suggestedTakeoverLevel: "B",
    takeoverLevelAdjustmentReason: null,
    levelRiskText: "B级资料仍需跟踪，付款前需确认影响金额的缺口已补齐。",
    paymentBlockingHint: "尚未完成主管确认，后续付款申请会被系统阻断。",
    evidenceGapSummary: "历史资料已完成本轮复核。",
    takeoverStatus: "pending_review",
    lifecycleStatus: "in_progress",
    signedAt: "2026-01-01T00:00:00.000Z",
    historicalSettledCents: "60000000",
    historicalApprovalPendingPaymentCents: "1000000",
    historicalApprovedPendingPaymentCents: "2000000",
    historicalPaidCents: "30000000",
    historicalProxyPaidCents: "0",
    historicalAdvancePaidCents: "5000000",
    historicalAdvanceDeductedCents: "1000000",
    historicalRetentionWithheldCents: "3000000",
    historicalRetentionReleasedCents: "1000000",
    otherConfirmedOccupancyCents: "0",
    balanceSourceSummary: "财务台账",
    evidenceSummary: "合同扫描件、历史结算台账、付款凭证",
    takeoverCutoffDate: "2026-06-30T00:00:00.000Z",
    responsibleUserId: "合同部张工",
    responsibleUserName: "合同部张工",
    reviewComment: "预算和财务已复核历史余额",
    acceptanceConclusion: "可作为 B 级合同接管依据",
    submittedAt: "2026-07-03T10:00:00.000Z",
    confirmedAt: null,
    historicalBalanceConfirmedAt: null,
    evidenceChecklist: [],
    evidenceFiles: [],
    corrections: [],
    contractSide: {
      revision: 1,
      financeBasisRevision: 1,
      signedAt: "2026-01-01T00:00:00.000Z",
      historicalSettledCents: "60000000",
      zeroSettlementDeclared: false,
      performanceStatus: "performing",
      settlementEvidenceSummary: "历史结算台账",
      settlementEvidenceFileIds: [],
      paymentTerms: { originalText: "按月结算付款", stages: [] },
      contractFacts: {
        contractNo: "HT-TAKEOVER-001",
        contractName: "E2E 历史材料合同",
        contractTypeKey: "generic_contract",
        counterparty: "历史供应商",
        originalAmountCents: "100000000",
        settlementCutoffDate: "2026-06-30"
      },
      confirmedRevision: null,
      confirmedByUserName: null,
      confirmedAt: null,
      updatedAt: "2026-07-03T10:00:00.000Z"
    },
    financeSide: null,
    appliedCorrections: [],
    postConfirmationVerification: {
      statusLabel: "未到核验",
      summaryText: "主管确认后再核验接管后的业务闭环。",
      newSettlementCount: 0,
      paymentRequestCount: 0,
      paymentExecutionCount: 0,
      financeRecordCount: 0
    },
    createdAt: "2026-07-03T09:00:00.000Z",
    updatedAt: "2026-07-03T10:00:00.000Z"
  };

  await page.route("**/api/me/work-items", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: new Date().toISOString(),
        visibleProjectCount: 1,
        queues: {
          pending: [
            {
              id: "work-item-1",
              type: "contract_takeover",
              title: "待复核历史合同",
              projectName: "E2E 项目",
              businessCode: "HT-TAKEOVER-001",
              amountText: "20 份",
              currentNode: "合同接管复核",
              stayedText: "已停留 1 天",
              nextAction: "进入接管台账",
              targetPath: "/合同管理/历史接管",
              tone: "warning"
            }
          ],
          blocked: [],
          started: []
        },
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
  await page.route("**/api/projects", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{ id: "project-1", code: "P-001", name: "E2E 项目" }])
    })
  );
  await page.route("**/api/projects/project-1/contract-takeovers/takeover-1", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(takeover) })
  );
  await page.route(
    "**/api/projects/project-1/contract-takeovers/takeover-1/tax-fact-revisions",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          contractId: "contract-takeover-1",
          current: {
            invoiceType: null,
            taxMode: "single_rate",
            defaultTaxRatePercent: null,
            status: "unconfirmed",
            source: null,
            confirmationExplanation: null,
            evidenceFileId: null,
            revision: 0
          },
          rows: [],
          revisions: []
        })
      })
  );
  await page.route("**/api/projects/project-1/contract-takeovers", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify([takeover]) })
  );
  await page.route("**/api/projects/project-1/contract-takeovers/import-batches", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify([]) })
  );
  await page.route("**/api/projects/project-1/contract-takeovers/company-entity-candidates", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify([]) })
  );
  await loginWithMockedAuth(page, ["contract_staff", "contract_director"]);

  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  const desktopItems = page.locator(".jg-desktop-record-list");
  const mobileItems = page.locator(".business-mobile-cards");
  await expect(mobileItems).toHaveCount(1);
  await expect(mobileItems).toBeHidden();
  await expect(desktopItems.getByText("待复核历史合同")).toBeVisible();
  await expect(desktopItems.getByText("合同接管复核")).toBeVisible();
  await expect(desktopItems.getByText("已停留 1 天")).toBeVisible();
  const desktopViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(desktopItems).toBeHidden();
  await expect(mobileItems.getByText("待复核历史合同")).toBeVisible();
  await expect(mobileItems).toContainText("合同接管复核");
  await expect(mobileItems).toContainText("已停留 1 天");
  await expect(mobileItems.getByRole("button", { name: "进入接管台账", exact: true })).toBeVisible();
  await page.setViewportSize(desktopViewport);
  await expect(mobileItems).toBeHidden();
  await expect(desktopItems).toBeVisible();

  const navigationToggle = page.getByRole("button", { name: "打开导航", exact: true });
  if (await navigationToggle.isVisible()) await navigationToggle.click();
  await page.getByRole("navigation", { name: "业务导航", exact: true })
    .getByRole("link", { name: "历史合同接管", exact: true }).click();
  await expect(page.getByRole("heading", { name: "历史合同接管" })).toBeVisible();
  await expect(page.getByRole("button", { name: "新增接管合同" })).toBeVisible();
  await expect(page.getByText("接管进度概览（只读）")).toBeVisible();
  await expect(page.getByText("复核确认", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("主管先核对必需资料；缺资料点“退回补充”，齐全后输入当前密码确认")).toBeVisible();

  await page.locator(".ledger-panel").getByText("详情", { exact: true }).click();
  await expect(page.locator(".detail-panel").getByRole("heading", { name: "复核确认" })).toBeVisible();
  const confirmationSummary = page.locator(".detail-panel .confirmation-summary");
  await expect(confirmationSummary.getByText("历史累计结算")).toBeVisible();
  await expect(confirmationSummary.getByText("¥600,000.00")).toBeVisible();
  await expect(confirmationSummary.getByText("确认后会形成系统期初事实")).toBeVisible();

  await page.locator(".detail-panel").getByText("确认合同侧", { exact: true }).click();
  const confirmDialog = page.locator(".t-dialog").filter({ hasText: "确认合同侧当前修订" });
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog.getByText("合同主管将确认当前合同事实、历史结算、履约状态、付款条款和结算依据")).toBeVisible();
});

test("core detail pages expose flow summaries, actions, files, and timelines", async ({ page }) => {
  await routeCoreDetailMocks(page);
  await loginWithMockedAuth(page, [
    "chairman",
    "general_manager",
    "project_manager",
    "contract_director",
    "contract_staff",
    "finance_director",
    "finance_staff"
  ]);
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();

  await page.goto("/contracts/HT-E2E-001");
  await expect(page.getByRole("heading", { name: "E2E 钢材采购合同" })).toBeVisible();
  await expectApprovalProgressLoaded(page);
  await expect(page.locator(".business-detail-header")).toContainText("¥1,200,000.00");
  await expect(page.locator(".business-detail-header")).toContainText("确认归档");
  await page.locator(".detail-navigation").getByText("流程办理", { exact: true }).click();
  await expect(page.getByText("当前账号在此单据暂无可办理动作。")).toBeVisible();
  await expect(page.getByText("当前不可办理原因")).toBeVisible();
  await page.locator(".detail-navigation").getByText("凭证资料", { exact: true }).click();
  await expect(page.getByText("E2E-盖章合同.pdf")).toBeVisible();
  await page.locator(".detail-navigation").getByText("关联与审计", { exact: true }).click();
  await expect(page.getByText("审批通过").first()).toBeVisible();

  await page.goto("/settlements/JS-E2E-001");
  await expect(page.getByRole("heading", { name: "E2E 结算单" })).toBeVisible();
  await expectApprovalProgressLoaded(page);
  await expect(page.locator(".business-detail-header").filter({ hasText: "主管确认归档" })).toBeVisible();
  await expect(page.getByText("剩余可申请")).toBeVisible();
  await page.locator(".detail-navigation").getByText("流程办理", { exact: true }).click();
  await expect(page.getByText("当前账号在此单据暂无可办理动作。")).toBeVisible();
  await page.locator(".detail-navigation").getByText("凭证资料", { exact: true }).click();
  await expect(page.getByText("E2E-结算签认件.pdf")).toBeVisible();

  await page.goto("/payments/FK-E2E-001");
  await expect(page.getByRole("heading", { name: "E2E 付款申请" })).toBeVisible();
  await expectApprovalProgressLoaded(page);
  await expect(page.locator(".business-detail-header").filter({ hasText: "出纳付款登记" })).toBeVisible();
  await expect(page.getByText("审批通过不等于实际付款完成")).toBeVisible();
  await page.locator(".detail-navigation").getByText("流程", { exact: true }).click();
  await expect(page.getByText("需要出纳操作")).toBeVisible();
  await page.locator(".detail-navigation").getByText("凭证资料", { exact: true }).click();
  await expect(page.getByText("E2E-付款审批单.pdf")).toBeVisible();
  await page.locator(".detail-navigation").getByText("审计", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "审批与办理时间线" })).toBeVisible();
});

test("RC-06 mocked contract detail remains operable on the configured mobile project", async ({
  browserName,
  page
}) => {
  test.skip(browserName !== "webkit", "mobile contract runs in the WebKit project");
  expect(browserName).toBe("webkit");
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await routeCoreDetailMocks(page);
  await loginWithMockedAuth(page, ["contract_staff"]);
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await page.goto("/contracts/HT-E2E-001");

  expect(await page.evaluate(() => ({
    height: window.innerHeight,
    width: window.innerWidth
  }))).toEqual({ height: 844, width: 390 });
  await expect(page).toHaveTitle(/建工智管/u);
  await expect(page.locator("#main-content")).not.toBeEmpty();
  await expect(page.getByRole("heading", { name: "E2E 钢材采购合同" })).toBeVisible();
  await expect(page.locator(".business-detail-header")).toContainText("确认归档");
  await page.locator(".detail-navigation").getByText("流程办理", { exact: true }).click();
  await expect(page.getByText("当前账号在此单据暂无可办理动作。")).toBeVisible();
  await expectApprovalProgressLoaded(page);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("settlement and payment detail failures do not show static samples", async ({ page }) => {
  const phone = process.env.E2E_LIMITED_PHONE;
  const password = process.env.E2E_LIMITED_PASSWORD;
  test.skip(!phone || !password, "Set E2E_LIMITED_PHONE/E2E_LIMITED_PASSWORD for detail permission checks");
  if (!phone || !password) return;

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill(phone);
  await page.getByPlaceholder("请输入密码").fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();

  await page.goto("/结算管理/not-found");
  await expect(page.getByText("结算详情读取失败").first()).toBeVisible();
  await expect(page.getByText("JS-2026-018 · 5月材料结算单")).toHaveCount(0);

  await page.goto("/付款管理/not-found");
  await expect(page.getByText("付款详情读取失败").first()).toBeVisible();
  await expect(page.getByText("FK-2026-006 · 5月材料结算付款申请")).toHaveCount(0);
});

test("temporary-password account is forced through password change when configured", async ({ page }) => {
  const phone = process.env.E2E_TEMP_PHONE;
  const tempPassword = process.env.E2E_TEMP_PASSWORD;
  const newPassword = process.env.E2E_NEW_PASSWORD;
  test.skip(!phone || !tempPassword || !newPassword, "Set E2E_TEMP_PHONE/E2E_TEMP_PASSWORD/E2E_NEW_PASSWORD");
  if (!phone || !tempPassword || !newPassword) return;

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill(phone);
  await page.getByPlaceholder("请输入密码").fill(tempPassword);
  await page.getByRole("button", { name: "登录" }).click();

  await expect(page).toHaveURL(/change-password/);
  await page.getByPlaceholder("请输入当前密码").fill(tempPassword);
  await page.getByPlaceholder("至少 8 位").fill(newPassword);
  await page.getByPlaceholder("请再次输入新密码").fill(newPassword);
  await page.getByRole("button", { name: "保存新密码" }).click();

  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
});

test("current work notifications stay unread-independent and open the authorized work route", async ({ page }) => {
  const startsNarrow = page.viewportSize()!.width <= 720;
  const item = {
    id: "approval:e2e-notice", type: "approval", title: "待审采购事项", businessCode: "CG-E2E-001",
    projectName: "合成项目", amountText: "待确定", currentNode: "项目经理审批", stayedText: "",
    nextAction: "处理审批", targetPath: "/审批中心", tone: "warning"
  };
  let pending = [item];
  let recentNotices = [item];
  await page.route(/^https?:\/\/[^/]+\/api\//u, route => route.fulfill({ json: {} }));
  await page.route("**/api/me/work-items", route => {
    const offset = Math.min(Number(route.request().headers()["x-work-item-notices"] ?? 0),
      Math.floor(Math.max(0, pending.length - 1) / 30) * 30);
    const items = pending.slice(offset, offset + 30);
    return route.fulfill({ json: {
      queues: { pending: items, blocked: [], started: [], drafts: [] },
      queueMeta: { pending: { total: pending.length, returned: items.length, truncated: items.length < pending.length } },
      noticePage: { offset, size: 30 }, recentNotices,
      approvalCenter: { pendingApproval: items, startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: [] }
    } });
  });
  await page.clock.install();
  await page.addInitScript(() => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify({
    accessToken: "mock-notices-access", refreshToken: "mock-notices-refresh",
    user: { id: "mock-notices", name: "合成账号", phone: null, mustChangePassword: false, roleKeys: ["project_manager"], globalRoleKeys: [] }
  })));
  await page.goto("/首页");
  const area = page.getByRole("region", { name: "待办通知" });
  const toggle = area.getByRole("button", { name: "待办通知，共 1 项" });
  await expect(area.getByText("有 1 项新待办")).toBeVisible();
  await expect(area).toHaveCSS("position", startsNarrow ? "relative" : "fixed");
  await toggle.click();
  await expect(toggle).toBeVisible();
  await expect(area.getByRole("heading", { name: "待我处理" })).toBeVisible();
  if (!startsNarrow) await page.setViewportSize({ width: 390, height: 844 });
  await expect(area).toHaveCSS("position", "relative");
  await area.locator("#work-notices-list").getByRole("link", { name: /CG-E2E-001/ }).click();
  await expect(page).toHaveURL(/%E5%AE%A1%E6%89%B9%E4%B8%AD%E5%BF%83/u);
  await expect(area.getByText("有 1 项新待办")).toHaveCount(0);
  await expect(toggle).toBeVisible();
  pending = [];
  recentNotices = [];
  await page.reload();
  await expect(area.getByRole("button", { name: "待办通知，共 0 项" })).toBeVisible();
  await expect(area.getByText("有 1 项新待办")).toHaveCount(0);

  pending = Array.from({ length: 102 }, (_, index) => ({ ...item, id: `approval:queued-${index}`, businessCode: `CG-QUEUE-${index}` }));
  recentNotices = pending.slice(0, 10);
  await page.clock.fastForward(31_000);
  await area.getByRole("button", { name: "关闭提示" }).click();
  await area.getByRole("button", { name: "待办通知，共 102 项" }).click();
  await area.getByRole("button", { name: "下一页" }).click();
  await expect(area.getByText("第 2 页")).toBeVisible();
  await expect(area.getByRole("link", { name: /CG-QUEUE-30$/ })).toBeVisible();

  const latest = { ...item, id: "approval:new-while-paging", businessCode: "CG-NEW-PAGE" };
  pending = [latest, ...pending];
  recentNotices = pending.slice(0, 10);
  await page.clock.fastForward(31_000);
  await expect(area.getByText("有 1 项新待办")).toBeVisible();
  await expect(area.getByRole("link", { name: /CG-NEW-PAGE$/ })).toBeVisible();
  await expect(area.getByText("第 2 页")).toBeVisible();
  await expect(area.getByRole("button", { name: "待办通知，共 103 项" })).toBeVisible();
  await area.getByRole("button", { name: "关闭提示" }).click();
  await page.clock.fastForward(31_000);
  await expect(area.getByText("有 1 项新待办")).toHaveCount(0);
  pending = pending.filter(row => row.id !== latest.id);
  recentNotices = pending.slice(0, 10);
  await page.clock.fastForward(31_000);
  await expect(area.getByRole("button", { name: "待办通知，共 102 项" })).toBeVisible();
  await expect(area.getByRole("link", { name: /CG-NEW-PAGE$/ })).toHaveCount(0);

  const reviewId = "independent:no_invoice:receipt-1";
  await page.route(url => decodeURIComponent(url.pathname) === `/api/approval-progress/${reviewId}`, route => route.fulfill({ json: {
    id: reviewId, title: "无票据确认", businessType: "no_invoice", businessId: "receipt-1",
    projectName: "合成项目", businessCode: "RC-1", applicant: { name: "合成经办" },
    status: "in_progress", currentNodeName: "财务核对", createdAt: new Date().toISOString(),
    pendingRecipients: [], nodes: [], reminders: [], history: [], canRemind: false
  } }));
  recentNotices = [{ ...item, id: "independent-notice:receipt-1", title: "无票据确认", businessCode: "RC-1",
    targetPath: `/审批中心?review=${encodeURIComponent(reviewId)}` }];
  await page.clock.fastForward(31_000);
  await area.getByRole("link", { name: /RC-1$/ }).click();
  await expect(page.getByRole("region", { name: "完整审批进度" }).getByText("无票据确认", { exact: false })).toBeVisible();
  await expect(area.getByRole("button", { name: "待办通知，共 102 项" })).toBeVisible();
});

test("settlement duty SMS shows manual retry only after an explicit failure", async ({ page }) => {
  await page.route(/^https?:\/\/[^/]+\/api\//u, route => route.fulfill({ json: {} }));
  await routeCoreDetailMocks(page, true);
  const failed = { attemptId: "a".repeat(64), status: "failed", canRetry: true };
  const unknown = { attemptId: "b".repeat(64), status: "unknown", canRetry: false };
  let notice = failed;
  const attempts: string[] = [];
  await page.route("**/api/settlements/settlement-e2e/duty-sms", route => route.fulfill({ json: { notice } }));
  await page.route("**/api/settlements/settlement-e2e/duty-sms/retry", route => {
    attempts.push(route.request().postDataJSON().attemptId);
    notice = unknown;
    return route.fulfill({ status: 201, json: unknown });
  });
  await page.addInitScript(() => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify({
    accessToken: "mock-duty-sms-access", refreshToken: "mock-duty-sms-refresh",
    user: { id: "mock-duty-sms", name: "合成主管", phone: null, mustChangePassword: false,
      roleKeys: ["contract_director"], globalRoleKeys: [] }
  })));
  await page.goto("/结算管理/JS-E2E-001");
  const panel = page.getByRole("region", { name: "待办短信" });
  await expect(panel.getByText("发送失败", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "重新发送" }).click();
  await expect(panel.getByText("发送结果待确认", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "重新发送" })).toHaveCount(0);
  await panel.getByRole("button", { name: "刷新短信状态" }).click();
  await expect(panel.getByText("发送结果待确认", { exact: true })).toBeVisible();
  expect(attempts).toEqual([failed.attemptId]);
});

test("versioned work notices report bursts and old assignments across pages", async ({ page }) => {
  const makeItem = (n: number) => ({
    id: `approval:${n}`, noticeKey: n.toString(16).padStart(64, "0"), type: "approval",
    title: "待审采购事项", businessCode: `CG-INDEX-${n}`, projectName: "合成项目", amountText: "待确定",
    currentNode: "项目经理审批", stayedText: "", nextAction: "处理审批", targetPath: "/审批中心", tone: "warning"
  });
  let pending = Array.from({ length: 102 }, (_, i) => makeItem(i + 1));
  let version = "a".repeat(64);
  let keyRequests = 0;
  let detailRequests = 0;
  let workItemsAuthorization: string | undefined;
  await page.route(/^https?:\/\/[^/]+\/api\//u, route => route.fulfill({ json: {} }));
  await page.route("**/api/me/work-items", route => {
    workItemsAuthorization = route.request().headers().authorization;
    const offset = Number(route.request().headers()["x-work-item-notices"] ?? 0);
    const items = pending.slice(offset, offset + 30);
    return route.fulfill({ json: {
      noticeIndexVersion: version, recentNotices: pending.slice(0, 10), noticePage: { offset, size: 30 },
      queues: { pending: items, blocked: [], started: [], drafts: [] },
      queueMeta: { pending: { total: pending.length, returned: items.length, truncated: true } },
      approvalCenter: { pendingApproval: items, startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: [] }
    } });
  });
  await page.route(url => url.pathname === "/api/me/work-item-notice-keys", route => {
    keyRequests++;
    const after = new URL(route.request().url()).searchParams.get("after") ?? "";
    const remaining = pending.map(item => item.noticeKey).sort().filter(key => key > after);
    const keys = remaining.slice(0, 100);
    return route.fulfill({ json: { version, keys, nextCursor: remaining.length > keys.length ? keys.at(-1) : null } });
  });
  await page.route(url => url.pathname === "/api/me/work-item-notice-details", route => {
    detailRequests++;
    const key = new URL(route.request().url()).searchParams.get("keys");
    return route.fulfill({ json: { version, items: pending.filter(item => item.noticeKey === key) } });
  });
  await page.clock.install();
  await page.addInitScript(() => {
    if (localStorage.getItem("jiangkong-web-admin-auth")) return;
    localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify({
      accessToken: "mock-notice-index-access", refreshToken: "mock-notice-index-refresh",
      user: { id: "mock-notice-index", name: "合成账号", phone: null, mustChangePassword: false, roleKeys: ["project_manager"], globalRoleKeys: [] }
    }));
  });
  await page.goto("/首页");
  const area = page.getByRole("region", { name: "待办通知" });
  await area.getByRole("button", { name: "关闭提示" }).click();
  expect(keyRequests).toBe(2);
  await area.getByRole("button", { name: "待办通知，共 102 项" }).click();
  await area.getByRole("button", { name: "下一页" }).click();
  await expect(area.getByText("第 2 页")).toBeVisible();
  expect(keyRequests).toBe(2);

  pending = [...pending, ...Array.from({ length: 14 }, (_, i) => makeItem(103 + i))];
  version = "b".repeat(64);
  await page.clock.fastForward(31_000);
  await expect(area.getByText("有 14 项新待办")).toBeVisible();
  await expect(area.getByText("第 2 页")).toBeVisible();
  await expect(area.getByRole("button", { name: "待办通知，共 116 项" })).toBeVisible();
  expect(detailRequests).toBe(0);
  await area.getByRole("button", { name: "关闭提示" }).click();
  await page.clock.fastForward(31_000);
  await expect(area.getByText("有 14 项新待办")).toHaveCount(0);
  expect(keyRequests).toBe(4);

  const oldAssigned = makeItem(117);
  pending = [...pending, oldAssigned];
  version = "c".repeat(64);
  await page.clock.fastForward(31_000);
  await expect(area.getByText("有 1 项新待办")).toBeVisible();
  await expect(area.getByRole("link", { name: /CG-INDEX-117$/u })).toBeVisible();
  expect(detailRequests).toBe(1);
  pending = pending.filter(item => item !== oldAssigned);
  version = "d".repeat(64);
  await page.clock.fastForward(31_000);
  await expect(area.getByRole("button", { name: "待办通知，共 116 项" })).toBeVisible();
  await expect(area.getByRole("link", { name: /CG-INDEX-117$/u })).toHaveCount(0);

  // A different account on the same browser must see an event it has not seen.
  // The synthetic read model intentionally gives it an event already seen by A.
  pending = [makeItem(1)];
  version = "e".repeat(64);
  const firstAccount = await page.evaluate(() => {
    const key = "jiangkong-web-admin-auth";
    const original = localStorage.getItem(key)!;
    const second = JSON.parse(original);
    second.accessToken = "mock-notice-second-access";
    second.user = { ...second.user, id: "mock-notice-second", name: "第二合成账号" };
    localStorage.setItem(key, JSON.stringify(second));
    return original;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(area).toHaveCSS("position", "relative");
  await expect.poll(() => workItemsAuthorization).toBe("Bearer mock-notice-second-access");
  await expect(area.getByText("有 1 项新待办")).toBeVisible();
  await expect(area.getByRole("link", { name: /CG-INDEX-1$/u })).toBeVisible();
  await area.getByRole("button", { name: "关闭提示" }).click();
  await page.reload();
  await expect(area.getByRole("button", { name: "待办通知，共 1 项" })).toBeVisible();
  await expect(area.getByText("有 1 项新待办")).toHaveCount(0);

  pending = [makeItem(1), makeItem(2)];
  await page.evaluate(session => localStorage.setItem("jiangkong-web-admin-auth", session), firstAccount);
  await page.reload();
  await expect(area.getByRole("button", { name: "待办通知，共 2 项" })).toBeVisible();
  await expect.poll(() => workItemsAuthorization).toBe("Bearer mock-notice-index-access");
  await expect(area.getByText("有 1 项新待办")).toHaveCount(0);
});

test("registered payment shows SMS retry only for the selected authorized failed attempt", async ({ page }) => {
  const paymentId = "registered-sms-e2e";
  const work = { paymentId, code: "FK-SMS-E2E", projectId: "synthetic-project", paidAmountCents: "4000",
    remainingAmountCents: "6000", expectedPaymentUpdatedAt: "2026-11-18T10:00:00Z" };
  let authorized = true;
  let reads = 0;
  let notice = { attemptId: "registered-original", status: "unknown", canRetry: true };
  const retries: unknown[] = [];
  const unexpected: string[] = [];
  const routePath = `/api/payment-executions/${paymentId}`;
  const match = (path: string) => (url: URL) => url.pathname === path;
  await page.addInitScript(() => localStorage.setItem("jiangkong-web-admin-auth", JSON.stringify({
    accessToken: "registered-sms-test", refreshToken: "registered-sms-test",
    user: { id: "finance-sms", name: "合成财务员", phone: null, mustChangePassword: false, roleKeys: ["finance_staff"], globalRoleKeys: ["finance_staff"] }
  })));
  await page.route(url => url.pathname.startsWith("/api/"), route => {
    unexpected.push(new URL(route.request().url()).pathname);
    return route.abort();
  });
  for (const suffix of ["/me/work-items", "/approval-delegations/user-options", "/projects", "/contract-relationship-ledger", "/operating-projections/as-of", "/payments"]) {
    await page.route(match("/api" + suffix), route => route.fulfill({ json: {
      items: [], rows: [], sections: [], queues: { pending: [], blocked: [], started: [], drafts: [] },
      statistics: { formalRequestedAmountCents: "0", formalPaidAmountCents: "0" }, viewCounts: {},
      pagination: { page: 1, pageSize: 30, total: 0 }
    } }));
  }
  await page.route(match("/api/fund-accounts"), route => route.fulfill({ json: { accounts: [], projects: [], notice: "" } }));
  await page.route(match("/api/payment-executions/work-items"), route => route.fulfill({ json: { items: [work] } }));
  await page.route(match("/api/payment-executions/recorded-items"), route => route.fulfill({ json: { items: [] } }));
  await page.route(match(routePath + "/registration-options"), route => route.fulfill({ json: {
    ...work, canRegisterPayment: authorized, accounts: [], contractHistoryBasis: { required: false, fingerprint: "none", records: [] }
  } }));
  await page.route(match(routePath + "/duty-sms"), route => {
    reads++;
    return route.fulfill({ json: { notice } });
  });
  await page.route(match(routePath + "/duty-sms/retry"), route => {
    retries.push(route.request().postDataJSON());
    return route.fulfill({ json: { attemptId: "registered-successor", status: "queued", canRetry: false } });
  });
  await page.goto("/付款管理?view=formal_ledger");
  const open = page.getByRole("button", { name: "办理实付登记", exact: true });
  await open.click();
  const panel = page.getByRole("region", { name: "待办短信" });
  const retry = panel.getByRole("button", { name: "重新发送" });
  const refresh = panel.getByRole("button", { name: "刷新短信状态" });
  await expect(panel).toContainText("发送结果待确认");
  await expect(retry).toHaveCount(0);
  notice = { ...notice, status: "accepted" };
  await refresh.click();
  await expect(panel).toContainText("供应商已受理，送达待确认");
  await expect(retry).toHaveCount(0);
  notice = { ...notice, status: "failed", canRetry: false };
  await refresh.click();
  await expect(panel).toContainText("发送失败");
  await expect(retry).toHaveCount(0);
  expect(retries).toEqual([]);
  notice = { ...notice, canRetry: true };
  await refresh.click();
  await retry.click();
  await expect(panel).toContainText("等待发送");
  expect(retries).toEqual([{ attemptId: "registered-original" }]);
  authorized = false;
  const beforeReload = reads;
  await page.reload();
  await open.click();
  await expect(page.getByRole("region", { name: "实际付款登记" })).toBeVisible();
  await expect(panel).toHaveCount(0);
  expect(reads).toBe(beforeReload);
  expect(unexpected).toEqual([]);
});

test("contract detail retries one current duty while preserving the other notices", async ({ page }) => {
  const unexpectedApi: string[] = [];
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const path = new URL(route.request().url()).pathname;
    unexpectedApi.push(path);
    await route.fulfill({ json: {} });
  });
  await routeCoreDetailMocks(page);
  const duties = [
    { attemptId: "approval-original", dutyName: "财务复核", status: "failed", canRetry: true },
    { attemptId: "seal-uncertain", dutyName: "确认已盖章", status: "unknown", canRetry: true },
    { attemptId: "other-approved", dutyName: "部门审批", status: "accepted", canRetry: true },
    { attemptId: "archive-revoked", dutyName: "归档复核", status: "failed", canRetry: false }
  ];
  const retries: unknown[] = [];
  let currentDuties = duties;
  await page.route("**/api/contracts/contract-version-e2e/duty-sms", route =>
    route.fulfill({ json: { notices: currentDuties } })
  );
  await page.route("**/api/contracts/contract-version-e2e/duty-sms/retry", route => {
    retries.push(route.request().postDataJSON());
    const queued = { ...duties[0], attemptId: "approval-retry", status: "queued", canRetry: false };
    currentDuties = [queued, ...duties.slice(1)];
    return route.fulfill({ status: 201, json: queued });
  });

  await loginWithMockedAuth(page, ["contract_staff"]);
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await page.goto("/合同管理/HT-E2E-001");
  const panel = page.getByRole("region", { name: "合同待办短信" });
  await expect(panel.getByRole("listitem")).toHaveCount(4);
  await expect(panel.getByRole("button", { name: "重新发送" })).toHaveCount(1);
  await panel.getByRole("listitem").filter({ hasText: "财务复核" }).getByRole("button", { name: "重新发送" }).click();
  await expect(panel.getByRole("listitem").filter({ hasText: "财务复核" })).toContainText("等待发送");
  await expect(panel.getByRole("listitem").filter({ hasText: "确认已盖章" })).toContainText("发送结果待确认");
  await expect(panel.getByRole("listitem").filter({ hasText: "部门审批" })).toContainText("供应商已受理");
  expect(retries).toEqual([{ attemptId: "approval-original" }]);
  currentDuties = [];
  await panel.getByRole("button", { name: "刷新短信状态" }).click();
  await expect(panel).toHaveCount(0);
  expect(unexpectedApi).toEqual([]);
});

test("fund account transfer SMS retry stays with the current eligible transfer", async ({ page }) => {
  const unexpectedApi: string[] = [];
  const statusReads: string[] = [];
  const retryBodies: unknown[] = [];
  const match = (path: string) => (url: URL) => url.pathname === path;
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    unexpectedApi.push(new URL(route.request().url()).pathname);
    await route.fulfill({ json: {} });
  });
  await routeCoreDetailMocks(page);
  await page.route(match("/api/fund-accounts"), route => route.fulfill({ json: { accounts: [], projects: [], notice: "" } }));
  const row = {
    id: "eligible-transfer", revision: 2, status: "pending_receipt", canReceive: true, canResolveRejection: false,
    sourceScopeKey: "public_cash", destinationScopeKey: "company:1", amountYuan: "5.0000",
    transferredOn: "2026-11-18", evidenceReference: "真实到账待确认", actions: []
  };
  let eligible = true;
  await page.route(match("/api/fund-account-transfers"), route => route.fulfill({ json: {
    canRegisterCash: false, canRegisterCompany: false,
    transfers: [{ ...row, canReceive: eligible }, { ...row, id: "unavailable-transfer", canReceive: false }]
  } }));
  const statusPath = "/api/fund-account-transfers/eligible-transfer/duty-sms";
  let status = { attemptId: "transfer-original", status: "failed", canRetry: true };
  await page.route(match(statusPath), route => {
    statusReads.push(route.request().url());
    return route.fulfill({ json: { notice: status } });
  });
  await page.route(match(statusPath + "/retry"), route => {
    retryBodies.push(route.request().postDataJSON());
    status = { attemptId: "transfer-retry", status: "queued", canRetry: false };
    return route.fulfill({ status: 201, json: status });
  });

  await loginWithMockedAuth(page, ["finance_staff"], ["finance_staff"]);
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await page.goto("/资金账户");
  await page.getByText("资金转款", { exact: true }).click();
  const panel = page.getByRole("region", { name: "待办短信" });
  await expect(panel).toHaveCount(1);
  await panel.getByRole("button", { name: "重新发送" }).click();
  await expect(panel).toContainText("等待发送");
  expect(retryBodies).toEqual([{ attemptId: "transfer-original" }]);
  expect(statusReads).toHaveLength(1);

  eligible = false;
  await page.reload();
  await page.getByText("资金转款", { exact: true }).click();
  await expect(page.getByText("转出依据：真实到账待确认").first()).toBeVisible();
  await expect(panel).toHaveCount(0);
  expect(statusReads).toHaveLength(1);
  expect(unexpectedApi).toEqual([]);
});

test("company transfer SMS retries only the chosen independent reconciliation duty", async ({ page }) => {
  const unexpectedApi: string[] = [];
  const retryBodies: unknown[] = [];
  let statusReads = 0;
  const match = (path: string) => (url: URL) => url.pathname === path;
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    unexpectedApi.push(new URL(route.request().url()).pathname);
    await route.fulfill({ json: {} });
  });
  await routeCoreDetailMocks(page);
  const row = {
    id: "company-transfer", code: "HZ-E2E", kindLabel: "资金转存", status: "approved", statusLabel: "已终审",
    sourceCompany: "合成甲公司", destinationCompany: "合成乙公司", sourceScope: "公司自有资金", destinationScope: "公司自有资金",
    amountCents: "500", sentCents: "400", receivedCents: "0", returnedCents: "0", inTransitCents: "400",
    reason: "合成转款", approvalActions: [], events: [], canApprove: false, canExecute: true
  };
  let authorized = true;
  await page.route(match("/api/company-transfers"), route => route.fulfill({ json: {
    rows: [{ ...row, canExecute: authorized }], total: 1, projects: [], companies: [],
    legacyOptions: [], originalLoans: [], originalProxies: [], balances: [], notice: ""
  } }));
  await page.route(match("/api/approval-forms/company_transfer/company-transfer/capability"), route => route.fulfill({ status: 404, json: {} }));
  const statusPath = "/api/company-transfers/company-transfer/duty-sms";
  const statuses = [
    { attemptId: "outgoing-unknown", dutyName: "登记实际出款", status: "unknown", canRetry: false },
    { attemptId: "incoming-original", dutyName: "独立确认第一笔到账", status: "failed", canRetry: true },
    { attemptId: "other-original", dutyName: "独立确认第二笔到账", status: "failed", canRetry: true }
  ];
  await page.route(match(statusPath), route => {
    statusReads++;
    return route.fulfill({ json: { notices: statuses } });
  });
  await page.route(match(statusPath + "/retry"), route => {
    retryBodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: {
      ...statuses[1], attemptId: "incoming-retry", status: "queued", canRetry: false
    } });
  });
  await loginWithMockedAuth(page, ["finance_staff"], ["finance_staff"]);
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await page.goto("/公司互转台账");
  const panel = page.getByRole("region", { name: "公司互转待办短信" });
  await expect(panel.getByRole("button", { name: "重新发送" })).toHaveCount(2);
  await panel.getByRole("listitem").filter({ hasText: "第一笔" }).getByRole("button", { name: "重新发送" }).click();
  await expect(panel.getByRole("listitem").filter({ hasText: "第一笔" })).toContainText("等待发送");
  await expect(panel.getByRole("listitem").filter({ hasText: "第二笔" })).toContainText("发送失败");
  await expect(panel.getByRole("listitem").filter({ hasText: "登记实际出款" })).toContainText("发送结果待确认");
  expect(retryBodies).toEqual([{ attemptId: "incoming-original" }]);
  authorized = false;
  await page.reload();
  await expect(page.getByRole("heading", { name: /HZ-E2E/ })).toBeVisible();
  await expect(panel).toHaveCount(0);
  expect(statusReads).toBe(1);
  expect(unexpectedApi).toEqual([]);
});

test("bank verification retries only the original pending independent review", async ({ page }) => {
  const unexpectedApi: string[] = [];
  const retries: Array<{ id: string; body: unknown }> = [];
  const statusReads: string[] = [];
  const match = (path: string) => (url: URL) => url.pathname === path;
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    unexpectedApi.push(new URL(route.request().url()).pathname);
    await route.fulfill({ json: {} });
  });
  await routeCoreDetailMocks(page);
  await page.route(match("/api/company-transfers"), route => route.fulfill({ json: {
    rows: [], total: 0, projects: [{ id: "bank-project", name: "合成项目" }], companies: [], canCreate: true, canUseOwnFunds: true,
    legacyOptions: [], originalLoans: [], originalProxies: [], balances: [], notice: ""
  } }));
  const row = {
    companyName: "合成公司", accountLast4: "4321", bankReference: "合成流水", direction: "outflow",
    amountCents: "500", occurredAt: "2026-11-18T00:00:00.000Z", status: "pending_confirm", reason: "合成核验", canConfirm: true
  };
  await page.route(match("/api/contract-bank-verifications"), route => {
    const id = new URL(route.request().url()).searchParams.get("projectId") || "bank-owned";
    return route.fulfill({ json: { canReview: true, total: 3, companies: [], rows: [
      { ...row, id },
      { ...row, id: "bank-self", canConfirm: false },
      { ...row, id: "bank-processed", status: "confirmed", canConfirm: false }
    ] } });
  });
  await page.route(url => /^\/api\/approval-forms\/contract_bank_verification\/bank-[a-z]+\/capability$/u.test(url.pathname),
    route => route.fulfill({ status: 404, json: {} }));
  await page.route(url => /^\/api\/contract-bank-verifications\/bank-(?:owned|project)\/duty-sms$/u.test(url.pathname), route => {
    const id = new URL(route.request().url()).pathname.split("/")[3];
    statusReads.push(id);
    return route.fulfill({ json: { notice: { attemptId: id + "-original", status: "failed", canRetry: true } } });
  });
  await page.route(url => /^\/api\/contract-bank-verifications\/bank-(?:owned|project)\/duty-sms\/retry$/u.test(url.pathname), route => {
    const id = new URL(route.request().url()).pathname.split("/")[3];
    retries.push({ id, body: route.request().postDataJSON() });
    return route.fulfill({ status: 201, json: { attemptId: id + "-retry", status: "queued", canRetry: false } });
  });

  await loginWithMockedAuth(page, ["finance_director"], ["finance_director"]);
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await page.goto("/公司互转台账");
  const scope = page.getByPlaceholder("选择流水所属项目或公司自有资金");
  const panel = page.getByRole("region", { name: "待办短信" });
  for (const label of ["公司自有资金", "合成项目"]) {
    await scope.click();
    await page.getByText(label, { exact: true }).last().click();
    await expect(panel).toHaveCount(1);
    await panel.getByRole("button", { name: "重新发送" }).click();
    await expect(panel).toContainText("等待发送");
  }
  expect(statusReads).toEqual(["bank-owned", "bank-project"]);
  expect(retries).toEqual([
    { id: "bank-owned", body: { attemptId: "bank-owned-original" } },
    { id: "bank-project", body: { attemptId: "bank-project-original" } }
  ]);
  expect(unexpectedApi).toEqual([]);
});

test("general procurement keeps SMS retry on the current independent duty", async ({ page }) => {
  const unexpectedApi: string[] = [];
  const attempts: unknown[] = [];
  let statusReads = 0;
  const match = (path: string) => (url: URL) => url.pathname === path;
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    unexpectedApi.push(new URL(route.request().url()).pathname);
    await route.fulfill({ json: {} });
  });
  await routeCoreDetailMocks(page);
  const path = "/api/general-procurements/synthetic-general";
  let state = { revision: 1, status: "approval_pending", canReview: true, canProcure: false, canEdit: false, requestProtocolVersion: 2 };
  await page.route(match(path), route => route.fulfill({ json: {
    id: "synthetic-general", code: "CG-E2E", statusLabel: "综合采购待办理", projectName: "合成项目",
    applicantName: "合成申请人", categoryLabel: "合成材料", reason: "合成用途",
    estimatedAmount: null, approvals: [], submissions: [], payments: [], ...state
  } }));
  await page.route(match("/api/approval-forms/general_procurement/synthetic-general/capability"), route => route.fulfill({ status: 404, json: {} }));
  const approval = [
    { attemptId: "procurement-original", dutyName: "部门并联审批", status: "failed", canRetry: true },
    { attemptId: "director-unknown", dutyName: "主管并联审批", status: "unknown", canRetry: false }
  ];
  const correction = { attemptId: "correction-original", dutyName: "退回修改", status: "failed", canRetry: true };
  await page.route(match(path + "/duty-sms"), route => {
    statusReads++;
    const notices = state.status === "approval_pending" ? approval : state.status === "returned" ? [correction] : [
      { attemptId: "buyer-accepted", dutyName: "综合部采购", status: "accepted", canRetry: false }
    ];
    return route.fulfill({ json: { notices } });
  });
  await page.route(match(path + "/duty-sms/retry"), route => {
    const body = route.request().postDataJSON();
    attempts.push(body);
    const selected = body.attemptId === approval[0].attemptId ? approval[0] : correction;
    return route.fulfill({ status: 201, json: { ...selected, attemptId: selected.attemptId + "-retry", status: "accepted", canRetry: false } });
  });
  await loginWithMockedAuth(page, ["comprehensive_director"], ["comprehensive_director"]);
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await page.goto("/综合采购申请/synthetic-general");
  const panel = page.getByRole("region", { name: "综合采购待办短信" });
  await expect(panel.getByRole("button", { name: "重新发送" })).toHaveCount(1);
  await panel.getByRole("listitem").filter({ hasText: "部门并联审批" }).getByRole("button", { name: "重新发送" }).click();
  await expect(panel.getByRole("listitem").filter({ hasText: "部门并联审批" })).toContainText("供应商已受理");
  await expect(panel.getByRole("listitem").filter({ hasText: "主管并联审批" })).toContainText("发送结果待确认");

  state = { ...state, revision: 2, status: "approved_pending_procurement", canReview: false, canProcure: true };
  await page.reload();
  await expect(panel).toContainText("综合部采购");
  await expect(panel.getByRole("button", { name: "重新发送" })).toHaveCount(0);

  state = { ...state, revision: 3, status: "returned", canProcure: false, canEdit: true };
  await page.reload();
  await panel.getByRole("listitem").filter({ hasText: "退回修改" }).getByRole("button", { name: "重新发送" }).click();
  await expect(panel).toContainText("供应商已受理");
  expect(attempts).toEqual([{ attemptId: "procurement-original" }, { attemptId: "correction-original" }]);

  state = { ...state, revision: 4, requestProtocolVersion: 1 };
  await page.reload();
  await expect(page.getByRole("heading", { name: "综合采购申请" })).toBeVisible();
  await expect(panel).toHaveCount(0);
  expect(statusReads).toBe(3);
  expect(unexpectedApi).toEqual([]);
});

test("independent reviews retry only their own current SMS attempt and balance round", async ({ page }) => {
  const unexpectedApi: string[] = [];
  const retries: Array<{ path: string; body: unknown }> = [];
  const statusReads: string[] = [];
  const match = (path: string) => (url: URL) => url.pathname === path;
  const respond = async (path: string, value: unknown) => page.route(match(path), route => route.fulfill({ json: value }));
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    unexpectedApi.push(new URL(route.request().url()).pathname);
    await route.fulfill({ json: {} });
  });
  await routeCoreDetailMocks(page);
  const project = { id: "review-project", name: "合成项目", code: "XM-E2E" };
  await respond("/api/projects", [project]);
  await respond("/api/funds-workbench", { items: [], viewCounts: {} });
  await respond("/api/contract-relationship-ledger", { rows: [], totals: [], companies: [], asOf: "2026-11-18", readAt: "2026-11-18T00:00:00Z" });
  await page.route(match("/api/operating-projections/project/review-project"), route => route.fulfill({ status: 404, json: {} }));
  await respond("/api/contract-bank-verifications", { rows: [], companies: [] });
  await respond("/api/contract-proxy-executions", {
    canReview: true, entries: [{ id: "proxy-review", canConfirm: true, status: "pending_confirm", entryKind: "payment", amountCents: "500",
      frozenSource: { contractRelationship: "inside", reference: "代付样例", debtor: { name: "甲" }, actualPayer: { name: "乙" }, counterparty: "丙" } }]
  });
  await respond("/api/upward-contract-amount-revisions", { canReview: true, contracts: [],
    revisions: [{ id: "amount-review", canConfirm: true, status: "pending_confirm", amountCents: "500", effectiveAt: "2026-11-18", reason: "金额修订样例" }] });
  await respond("/api/contract-economic-reviews", { canReview: true, documents: [], candidates: [], pendingSettlements: [], reviews: [
    { id: "economic-review", canFinanceReview: true, status: "pending_finance_review", revision: 2, coverage: [], reason: "履约财务样例" },
    { id: "economic-contract-stage", canContractReview: true, canFinanceReview: false, revision: 1, coverage: [], reason: "合同专业样例" }
  ] });
  await respond("/api/upward-receipt-matches", { canReview: true, receipts: [], settlements: [], matches: [
    { id: "receipt-review", canConfirm: true, status: "pending_confirm", amountCents: "500", reason: "核销样例" }
  ] });
  await page.route(url => /^\/api\/approval-forms\/(contract_proxy_execution|upward_contract_amount_revision|contract_economic_review|upward_receipt_match)\/[a-z-]+\/capability$/u.test(url.pathname),
    route => route.fulfill({ status: 404, json: {} }));

  const registration = {
    id: "fund-review", approvalInstanceId: "fund-review-round", kind: "correction", status: "pending_review",
    version: 2, balanceYuan: "5.0000", asOfDate: "2026-11-18", canConfirm: true, sources: []
  };
  const balancePath = "/api/fund-accounts/registrations/fund-review/review";
  await respond(balancePath, {
    ...registration, projects: [], account: {
      scopeKey: "public_cash", name: "合成公共现金", kind: "public_cash", history: [registration],
      sources: [], projectBalances: [], registeredPayments: []
    }
  });
  const cases = [
    ["/api/contract-proxy-executions/proxy-review", "代理原键"],
    ["/api/upward-contract-amount-revisions/amount-review", "金额原键"],
    ["/api/contract-economic-reviews/economic-review", "履约原键"],
    ["/api/upward-receipt-matches/receipt-review", "核销原键"],
    [balancePath, "余额原键"]
  ];
  for (const [path, attemptId] of cases) {
    await page.route(match(path + "/duty-sms"), route => {
      statusReads.push(path);
      return route.fulfill({ json: { notice: { attemptId, status: "failed", canRetry: true } } });
    });
    await page.route(match(path + "/duty-sms/retry"), route => {
      retries.push({ path, body: route.request().postDataJSON() });
      return route.fulfill({ status: 201, json: { attemptId: attemptId + "-retry", status: "queued", canRetry: false } });
    });
  }

  await loginWithMockedAuth(page, ["finance_director", "contract_director"], ["finance_director", "contract_director"]);
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await page.goto("/统一资金办理工作台?projectId=review-project&ledgerSection=contracts");
  const panel = page.getByRole("region", { name: "待办短信" });
  await expect(panel).toHaveCount(3);
  for (const i of [0, 1, 2]) {
    await panel.nth(i).getByRole("button", { name: "重新发送" }).click();
    await expect(panel.nth(i)).toContainText("等待发送");
  }
  await page.goto("/统一资金办理工作台?projectId=review-project&ledgerSection=receipts");
  await expect(panel).toHaveCount(2);
  await panel.first().getByRole("button", { name: "重新发送" }).click();
  await expect(panel.first()).toContainText("等待发送");

  await page.goto("/资金余额复核/fund-review");
  await page.getByRole("button", { name: "复核余额更正" }).click();
  await expect(page.getByText("处理余额核对更正", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "重新发送" }).click();
  await expect(panel).toContainText("等待发送");
  expect(retries).toEqual(cases.map(([path, attemptId]) => ({
    path, body: path === balancePath ? { attemptId, expectedApprovalInstanceId: "fund-review-round" } : { attemptId }
  })));
  expect(new Set(statusReads)).toEqual(new Set(cases.map(([path]) => path)));
  expect(unexpectedApi).toEqual([]);
});

test("payment approval SMS retry follows the current review and stays separate from registration", async ({ page }) => {
  const unexpectedApi: string[] = [];
  const attempts: unknown[] = [];
  let statusReads = 0;
  let allowed = true;
  const match = (path: string) => (url: URL) => url.pathname === path;
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    unexpectedApi.push(new URL(route.request().url()).pathname);
    await route.fulfill({ json: {} });
  });
  await routeCoreDetailMocks(page, false, () => allowed);
  for (const suffix of ["work-items", "recorded-items"]) {
    await page.route(match("/api/payment-executions/" + suffix), route => route.fulfill({ json: { items: [] } }));
  }
  const path = "/api/payments/FK-E2E-001/approval/duty-sms";
  await page.route(match(path), route => {
    statusReads++;
    return route.fulfill({ json: { notice: { attemptId: "current-approval-original", status: "failed", canRetry: true } } });
  });
  await page.route(match(path + "/retry"), route => {
    attempts.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: { attemptId: "current-approval-retry", status: "queued", canRetry: false } });
  });
  await loginWithMockedAuth(page, ["finance_director"], ["finance_director"]);
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await page.goto("/付款管理/FK-E2E-001");
  const panel = page.getByRole("region", { name: "待办短信" });
  await panel.getByRole("button", { name: "重新发送" }).click();
  await expect(panel).toContainText("等待发送");
  expect(attempts).toEqual([{ attemptId: "current-approval-original" }]);
  allowed = false;
  await page.reload();
  await expect(page.getByRole("heading", { name: /FK-E2E-001/ })).toBeVisible();
  await expect(panel).toHaveCount(0);
  expect(statusReads).toBe(1);
  expect(unexpectedApi).toEqual([]);
});

test("company transfer deep link opens one authorized record on reload without searching pages", async ({ page }) => {
  const listQueries: string[] = [];
  const detailReads: string[] = [];
  const unexpectedApi: string[] = [];
  const row = {
    id: "exact-transfer", code: "HZ-EXACT", kindLabel: "资金转存", statusLabel: "已完成", status: "approved",
    sourceCompany: "合成转出公司", destinationCompany: "合成转入公司", sourceScope: "项目资金", destinationScope: "项目资金",
    amountCents: "100", sentCents: "100", receivedCents: "100", returnedCents: "0", inTransitCents: "0",
    approvalActions: [], events: [], canApprove: false, canExecute: false
  };
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    unexpectedApi.push(new URL(route.request().url()).pathname);
    await route.fulfill({ json: {} });
  });
  await routeCoreDetailMocks(page);
  await page.route(url => url.pathname === "/api/company-transfers", route => {
    listQueries.push(new URL(route.request().url()).search);
    return route.fulfill({ json: {
      total: 100, rows: [], projects: [{ id: "sample-project", name: "合成项目" }], companies: [],
      legacyOptions: [], originalLoans: [], originalProxies: [], balances: []
    } });
  });
  await page.route(url => /^\/api\/company-transfers\/(exact-transfer|hidden-transfer)$/u.test(url.pathname), route => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    detailReads.push(id);
    return id === row.id ? route.fulfill({ json: row }) :
      route.fulfill({ status: 404, json: { message: "互转记录不存在或当前账号无权查看" } });
  });
  await page.route(url => url.pathname === "/api/approval-forms/company_transfer/exact-transfer/capability",
    route => route.fulfill({ status: 404, json: {} }));
  await loginWithMockedAuth(page, ["finance_staff"], ["finance_staff"]);
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  const target = "/公司互转台账?projectId=sample-project&transferId=exact-transfer";
  await page.goto(target);
  await expect(page.getByRole("heading", { name: /HZ-EXACT/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /HZ-EXACT/ })).toBeVisible();
  expect(detailReads).toEqual(["exact-transfer", "exact-transfer"]);
  expect(listQueries).toEqual([]);

  await page.goto(target.replace("exact-transfer", "hidden-transfer"));
  await expect(page.getByText("互转记录不存在或当前账号无权查看", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /HZ-EXACT/ })).toHaveCount(0);
  expect(detailReads.at(-1)).toBe("hidden-transfer");
  expect(listQueries).toEqual([]);
  await page.getByRole("link", { name: "返回公司互转台账" }).click();
  await expect.poll(() => listQueries).toEqual(["?projectId=sample-project&page=1"]);
  expect(unexpectedApi).toEqual([]);
});
