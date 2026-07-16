import { expect, test, type Page } from "@playwright/test";

async function loginWithMockedAuth(page: Page, roleKeys: string[]) {
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
          roleKeys
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

async function routeCoreDetailMocks(page: Page) {
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
            enabled: false,
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
  await loginWithMockedAuth(page, ["contract_staff", "contract_director"]);

  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await expect(page.getByText("待复核历史合同")).toBeVisible();
  await expect(page.getByText("合同接管复核")).toBeVisible();
  await expect(page.getByText("已停留 1 天")).toBeVisible();

  await page.getByText("历史合同接管").click();
  await expect(page.getByRole("heading", { name: "历史合同接管" })).toBeVisible();
  await expect(page.getByRole("button", { name: "新增接管合同" })).toBeVisible();
  await expect(page.getByText("接管进度概览（只读）")).toBeVisible();
  await expect(page.getByText("复核确认", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("多部门复核后由主管用当前密码确认")).toBeVisible();

  await page.locator(".ledger-panel").getByText("详情", { exact: true }).click();
  await expect(page.locator(".detail-panel").getByRole("heading", { name: "复核确认" })).toBeVisible();
  const confirmationSummary = page.locator(".detail-panel .confirmation-summary");
  await expect(confirmationSummary.getByText("历史累计结算")).toBeVisible();
  await expect(confirmationSummary.getByText("¥600,000.00")).toBeVisible();
  await expect(confirmationSummary.getByText("确认后会形成系统期初事实")).toBeVisible();

  await page.locator(".ledger-panel").getByText("确认接管", { exact: true }).click();
  const confirmDialog = page.locator(".t-dialog").filter({ hasText: "确认历史合同接管" });
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog.getByText("后续结算、付款申请、实付和审计")).toBeVisible();
  await expect(confirmDialog.getByText("历史预付款已付/已扣回")).toBeVisible();
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
  await expect(page.locator(".business-detail-header").filter({ hasText: "主管确认归档" })).toBeVisible();
  await expect(page.getByText("剩余可申请")).toBeVisible();
  await page.locator(".detail-navigation").getByText("流程办理", { exact: true }).click();
  await expect(page.getByText("当前账号在此单据暂无可办理动作。")).toBeVisible();
  await page.locator(".detail-navigation").getByText("凭证资料", { exact: true }).click();
  await expect(page.getByText("E2E-结算签认件.pdf")).toBeVisible();

  await page.goto("/payments/FK-E2E-001");
  await expect(page.getByRole("heading", { name: "E2E 付款申请" })).toBeVisible();
  await expect(page.locator(".business-detail-header").filter({ hasText: "出纳付款登记" })).toBeVisible();
  await expect(page.getByText("审批通过不等于实际付款完成")).toBeVisible();
  await page.locator(".detail-navigation").getByText("流程", { exact: true }).click();
  await expect(page.getByText("需要出纳操作")).toBeVisible();
  await page.locator(".detail-navigation").getByText("凭证资料", { exact: true }).click();
  await expect(page.getByText("E2E-付款审批单.pdf")).toBeVisible();
  await page.locator(".detail-navigation").getByText("审计", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "审批与办理时间线" })).toBeVisible();
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
