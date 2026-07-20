import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  expectHorizontalScrollOwner,
  expectNoDocumentHorizontalOverflow,
  expectNoNestedHorizontalScrollers
} from "./helpers/responsive-assertions";

const viewports = [
  { width: 1512, height: 982 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1180, height: 820 },
  { width: 1024, height: 768 },
  { width: 900, height: 768 }
] as const;

test.setTimeout(90_000);

const projectOverview = {
  project: { id: "project-responsive", code: "XM-001", name: "科技园项目", isActive: true },
  cash: {
    actualReceiptsCents: "32000000",
    supplierRefundsCents: "0",
    availableFundsCents: "18000000",
    actualPaidCents: "9000000",
    approvalPendingOccupancyCents: "1000000",
    approvedPendingPaymentCents: "4000000",
    financeRecordedOutflowCents: "8500000"
  },
  business: {
    effectiveContractAmountCents: "58000000",
    effectiveSettlementAmountCents: "36000000",
    payableSettlementAmountCents: "30000000",
    operatingIncomeCents: "36000000",
    operatingCostCents: "26000000",
    grossProfitCents: "10000000"
  },
  counts: { contracts: 4, settlements: 3, payments: 5 },
  dataGaps: ["尚有 1 份历史收款凭证待归档"]
};

async function mockSession(page: Page) {
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: "finance-responsive",
        name: "财务经办人",
        phone: "13900000000",
        mustChangePassword: false,
        roleKeys: ["finance_staff"],
        globalRoleKeys: ["finance_staff"]
      },
      tokens: { accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 900 }
    })
  }));
  await page.route("**/api/me/work-items", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      generatedAt: "2026-07-14T08:00:00.000Z",
      visibleProjectCount: 1,
      queues: { pending: [], blocked: [], started: [] },
      approvalCenter: {
        pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: []
      }
    })
  }));
  await page.route("**/api/business-parties/party-responsive", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      party: { id: "party-responsive", name: "昆明城建材料公司" },
      versions: [{
        id: "party-version-responsive",
        versionNo: 2,
        createdAt: "2026-07-14 16:00",
        snapshot: {
          name: "昆明城建材料公司",
          unifiedSocialCreditCode: "91530000RESPONSIVE",
          legalRepresentative: "王负责",
          address: "昆明市高新区",
          contactName: "李经理",
          contactPhone: "13800000001",
          attachments: [{
            category: "business_license",
            fileId: "file-responsive",
            name: "营业执照",
            validUntil: "2030-12-31"
          }]
        }
      }]
    })
  }));
  await page.route("**/api/projects", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([projectOverview.project])
  }));
  await page.route("**/api/projects/project-responsive/operating-funds-overview", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(projectOverview)
  }));
  await page.route("**/api/spot-procurements/capabilities?projectId=project-responsive", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      projectId: "project-responsive",
      enabled: false,
      canCreate: false,
      canExecutePayment: false,
      unavailableReason: "当前项目未启用零星采购试点",
      handlerOptions: []
    })
  }));
  await page.route("**/api/projects/project-responsive/expense-requests?*", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      rows: [{
        id: "expense-responsive",
        code: "ZC-20260714-001",
        expenseType: "spot_purchase",
        expenseSubtype: "spot_material",
        paymentSubject: "临时材料采购",
        reason: "项目临设材料采购",
        requestedAmountCents: "120000",
        approvedAmountCents: "120000",
        paidAmountCents: "0",
        paymentMethod: "bank_transfer",
        counterpartyName: "城建材料公司",
        hasAttachment: true,
        hasApprovalPdf: true,
        isPurchaseExecuted: false,
        isReceiptConfirmed: false,
        purchaseExecutedAt: null,
        receiptConfirmedAt: null,
        status: "approved_pending_payment",
        createdAt: "2026-07-14T08:00:00.000Z",
        updatedAt: "2026-07-14T08:00:00.000Z"
      }],
      summary: {
        total: 1,
        approvalPending: 0,
        approvedPendingPayment: 1,
        paid: 0,
        paymentBlocked: 0,
        totalRequestedCents: "120000",
        totalPaidCents: "0"
      },
      view: "formal_ledger",
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      viewCounts: { formal_ledger: 1, my_drafts: 0, returned_for_revision: 0, ended: 0 }
    })
  }));
  await page.route("**/api/contracts/payment-create-options*", (route) => route.fulfill({
    contentType: "application/json",
    body: "[]"
  }));
  await page.route("**/api/projects/project-responsive/expense-requests/expense-responsive/approval-detail", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      id: "expense-responsive",
      projectId: "project-responsive",
      code: "ZC-20260714-001",
      title: "临时材料采购审批",
      status: "approval_pending",
      statusLabel: "审批中",
      expenseTypeLabel: "现场零星采购",
      expenseSubtypeLabel: "材料",
      paymentSubject: "临时材料采购",
      reason: "项目临设材料采购",
      requestedAmountCents: "120000",
      approvedAmountCents: null,
      currentNodeName: "财务审核",
      lifecycleKind: "approval_draft",
      lifecycleUpdatedAt: "2026-07-14T08:00:00.000Z",
      availableActions: [],
      blockedReasons: ["当前账号只读"],
      canSetApprovedAmount: false,
      reviewAction: {
        key: "review",
        label: "审批",
        kind: "primary",
        enabled: false,
        disabledReason: "当前账号只读"
      },
      approvalTimeline: [{
        id: "timeline-responsive",
        action: "submit",
        actionLabel: "提交审批",
        actorUserId: "applicant-responsive",
        actorName: "项目经理",
        comment: "请审核",
        nodeName: "申请人",
        roleName: "项目经理",
        selfReview: false,
        selfReviewReason: null,
        createdAt: "2026-07-14T08:00:00.000Z"
      }]
    })
  }));
  await page.route("**/api/me/signature/ticket", (route) => route.fulfill({
    contentType: "application/json",
    body: "null"
  }));
  await page.route("**/api/company-entities", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([{ id: "entity-responsive", name: "建工智管建设有限公司", unifiedSocialCreditCode: "91530000ENTITY" }])
  }));
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
}

async function assertPageShell(page: Page) {
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
}

test("普通表单、费用详情、项目概览和设置页在六档桌面窗口中正确重排", async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await mockSession(page);
  await login(page);
  const screenshotDir = process.env.UI_RESPONSIVE_SCREENSHOT_DIR ?? testInfo.outputDir;
  mkdirSync(screenshotDir, { recursive: true });

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);

    await page.goto("/合作单位档案/party-responsive");
    await expect(page.getByRole("heading", { name: "昆明城建材料公司" })).toBeVisible();
    await page.getByRole("button", { name: "新增附件" }).click();
    await assertPageShell(page);
    if (viewport.width <= 1180) {
      await expectHorizontalScrollOwner(page.locator(".jg-table-region .t-table__content"));
    }
    await page.screenshot({
      path: path.join(screenshotDir, `business-party-editor-${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });

    await page.goto("/项目支出/project-responsive/expense-responsive");
    await expect(page.getByRole("heading", { name: "项目支出审批详情" })).toBeVisible();
    await expect(page.getByText("ZC-20260714-001", { exact: true }).first()).toBeVisible();
    await assertPageShell(page);
    await page.screenshot({
      path: path.join(screenshotDir, `project-expense-detail-${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });

    await page.goto("/系统配置");
    await expect(page.getByText("我的账号", { exact: true })).toBeVisible();
    await assertPageShell(page);
    await page.screenshot({
      path: path.join(screenshotDir, `settings-${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });

    await page.goto("/项目经营");
    await expect(page.getByRole("heading", { name: "跨项目经营总览" })).toBeVisible();
    await expect(page.getByText("XM-001 · 科技园项目", { exact: true })).toBeVisible();
    await assertPageShell(page);
    if (viewport.width <= 1280) {
      await expectHorizontalScrollOwner(page.locator(".executive-panel .jg-workspace-scroll"));
    }
    await page.screenshot({
      path: path.join(screenshotDir, `project-overview-${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });

    await page.getByText("资金办理", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "支出明细" })).toBeVisible();
    await assertPageShell(page);
    if (viewport.width <= 1180) {
      await expectHorizontalScrollOwner(page.locator(".receipt-panel .jg-workspace-scroll"));
    }
    await page.screenshot({
      path: path.join(screenshotDir, `project-operations-${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });
  }

  await page.setViewportSize({ width: 1512, height: 982 });
  await page.goto("/合作单位档案/party-responsive");
  const contactInput = page.locator("label").filter({ hasText: "联系人" }).locator("input");
  await contactInput.fill("窗口变化前已填内容");
  await page.setViewportSize({ width: 900, height: 768 });
  await expect(contactInput).toHaveValue("窗口变化前已填内容");
  await assertPageShell(page);
  expect(pageErrors).toEqual([]);
});
