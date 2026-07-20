import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  expectHorizontalScrollOwner,
  expectNoDocumentHorizontalOverflow,
  expectNoNestedHorizontalScrollers
} from "./helpers/responsive-assertions";

const now = "2026-07-18T08:00:00.000Z";
const project = { id: "project-1", code: "XM-001", name: "一号项目" };
const handler = { id: "handler-1", name: "物资员甲" };
const applicant = { id: "applicant-1", name: "申请人甲" };
const approval = {
  status: "approved",
  statusLabel: "审批通过",
  currentNodeName: "审批完成",
  currentRoleKeys: []
};
const receiptSummary = {
  available: true,
  status: "draft",
  statusLabel: "待确认收货",
  openAfterActualPayment: true,
  blockedReason: null,
  currentRevisionNo: 1,
  firstSubmittedAt: null,
  submittedAt: null,
  lockedAt: null,
  discrepancyStatus: null
};

async function mockLogin(page: Page) {
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: "handler-1",
        name: "物资员甲",
        phone: "13900000000",
        mustChangePassword: false,
        roleKeys: ["material_staff"],
        globalRoleKeys: []
      },
      tokens: { accessToken: "spot-e2e-access-token", refreshToken: "spot-e2e-refresh-token", expiresIn: 900 }
    })
  }));
  await page.route("**/api/me/work-items", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      generatedAt: now,
      visibleProjectCount: 1,
      queues: { pending: [], blocked: [], started: [] },
      approvalCenter: { pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: [] }
    })
  }));
  await page.route("**/api/projects", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify([project]) }));
  await page.route("**/api/approval-delegations/user-options", (route) => route.fulfill({ contentType: "application/json", body: "[]" }));
}

function procurementListRow() {
  return {
    id: "procurement-1",
    code: "LXCG-E2E-001",
    project,
    supplierPartyId: null,
    supplierName: "",
    reason: "现场砌筑临时补料",
    applicant,
    handler,
    approvedAmountCents: "0",
    currentTotalAmountCents: "0",
    actualCostCents: null,
    actualCost: { available: false, status: "not_available", label: "收货复核后按付款材料单价形成" },
    invoiceComposition: "unknown",
    payment: {
      status: "partially_paid",
      statusLabel: "部分已付",
      approvalAmountCents: "440000",
      actualPaidAmountCents: "220000",
      refundAmountCents: "0",
      netPaidAmountCents: "220000",
      remainingAmountCents: "220000",
      visibilityRestricted: false
    },
    receipt: receiptSummary,
    invoiceCoverage: { available: false, status: "not_available", label: "新表单不使用结构化票据覆盖" },
    status: "approved_in_progress",
    statusLabel: "采购已批，办理中",
    approval,
    createdAt: now,
    updatedAt: now,
    form: "real_application",
    applicationDepartment: "工程部",
    applicationName: "李凤华",
    purchaserName: "物资员甲",
    purchaserDepartment: "物资部",
    requestedArrivalAt: "2026-07-18"
  };
}

function procurementDetail() {
  return {
    procurement: {
      id: "procurement-1",
      code: "LXCG-E2E-001",
      project,
      supplierPartyId: null,
      supplierName: "",
      applicant,
      handler,
      status: "approved_in_progress",
      statusLabel: "采购已批，办理中",
      approvedAmountCents: "0",
      actualCostCents: null,
      actualCost: { available: false, status: "not_available", label: "收货复核后按付款材料单价形成" },
      closedAt: null,
      voidedAt: null,
      voidReason: null,
      createdAt: now,
      updatedAt: now,
      form: "real_application",
      payment: procurementListRow().payment
    },
    currentVersion: {
      id: "version-1", versionNo: 1, status: "approved", statusLabel: "审批通过",
      reason: "现场砌筑临时补料", note: "当天送达", supplierPartyId: null, supplierName: "",
      handlerUserId: "handler-1", totalAmountCents: "0", changeReason: null, changeSummary: null,
      submittedAt: now, approvedAt: now, createdByUserId: "applicant-1", createdAt: now, updatedAt: now,
      applicationDepartment: "工程部", applicationName: "李凤华", purchaserName: "物资员甲", purchaserDepartment: "物资部", requestedArrivalAt: "2026-07-18"
    },
    versions: [],
    lines: [{
      id: "line-1", sortOrder: 1, materialName: "免烧砖", specification: "240×115×53", unit: "块", quantity: "1000",
      invoiceMode: "no_invoice", invoiceType: null, vatRateOptionId: null, vatRateValue: null, vatRateLabel: null,
      unitPrice: "0", amountCents: "0", usageLocation: null, note: "免烧砖"
    }],
    invoiceComposition: "unknown", attachments: [], approval, approvalTimeline: [],
    payments: [paymentListRow()], paymentSummary: procurementListRow().payment, receipt: receiptSummary,
    invoiceCoverage: { available: false, status: "not_available", label: "新表单不使用结构化票据覆盖" },
    invoiceLedger: { available: false, currentCoordinates: null, invoices: [], allocations: [], noInvoiceConfirmations: [], invoiceExceptions: [] },
    discrepancy: { available: false, status: "not_available", label: "收货复核后可处理少货" },
    applicationPdf: { available: true, generated: true, businessType: "spot_procurement_version", businessId: "version-1", disabledReason: null },
    availableActions: [], primaryAction: null, disabledReasons: []
  };
}

function paymentListRow(overrides = {}) {
  return {
    id: "payment-1", code: "LXFK-E2E-001", procurement: { id: "procurement-1", code: "LXCG-E2E-001" }, project,
    form: "real_payment", paymentType: "company_direct", paymentTypeLabel: "公司直付", merchantName: "利民建材店",
    payerCompanyName: "四川建工智管建筑工程有限公司",
    payee: { name: "利民建材店", accountName: "利民建材店", accountNumberLast4: "1234" },
    approvalAmountCents: "440000", actualPaidAmountCents: "220000", refundAmountCents: "0", netPaidAmountCents: "220000", remainingAmountCents: "220000",
    receipt: receiptSummary, invoice: { status: "pending", statusLabel: "待补发票", activeCount: 0 },
    status: "partially_paid", statusLabel: "部分已付", companyPaymentStatusLabel: "部分已付", approval, handler,
    voucherStatus: "complete", voucherStatusLabel: "付款凭证完整", paymentFactConsistent: true, createdAt: now, updatedAt: now,
    currentTask: { key: "record_execution", label: "登记实际付款", hint: "登记本次付款并上传凭证", priority: 300, scope: "personal", enabled: true, disabledReason: null },
    ...overrides
  };
}

function paymentDetail() {
  return {
    payment: {
      id: "payment-1", code: "LXFK-E2E-001", status: "partially_paid", statusLabel: "部分已付", project,
      procurement: { id: "procurement-1", code: "LXCG-E2E-001" }, procurementVersionId: "version-1", form: "real_payment",
      paymentType: "company_direct", paymentTypeLabel: "公司直付", merchantName: "利民建材店", merchantPayeeMismatchNote: null,
      payerCompanyName: "四川建工智管建筑工程有限公司", payee: { name: "利民建材店", accountName: "利民建材店", primaryChannel: { id: "channel-1", sortOrder: 1, channelType: "bank_transfer", channelTypeLabel: "银行转账", accountName: "利民建材店", bankName: "建设银行", accountNumberLast4: "1234", note: null, primary: true } },
      approvalAmountCents: "440000", actualPaidAmountCents: "220000", refundAmountCents: "0", netPaidAmountCents: "220000", remainingAmountCents: "220000", paymentFactConsistent: true,
      handler, payerManagement: { visible: false, enabled: false, disabledReason: null, requiresReapproval: false }
    },
    procurementVersion: procurementDetail().currentVersion, approval, approvalTimeline: [], executions: [{
      id: "execution-1", amountCents: "220000", paidAt: now, paymentMethod: "bank_transfer", paymentMethodLabel: "银行转账", executedBy: { id: "finance-1", name: "财务甲" }, voucherFileId: "voucher-1", voucherFileName: "付款凭证.pdf", voidedAt: null, voidReason: null, active: true, vouchers: [{ id: "voucher-link-1", fileId: "voucher-1", sortOrder: 1 }]
    }],
    evidenceFiles: [], receipt: receiptSummary,
    materials: [{ id: "payment-line-1", procurementLineId: "line-1", sortOrder: 1, materialName: "免烧砖", specification: "240×115×53", unit: "块", approvedQuantity: "1000", paymentQuantity: "1000", unitPrice: "4.4", amountCents: "440000", expectedInvoiceCondition: "vat_general", vatRateOptionId: "vat-13", vatRateLabel: "13%" }],
    procurementMaterials: [{ id: "line-1", sortOrder: 1, materialName: "免烧砖", specification: "240×115×53", unit: "块", approvedQuantity: "1000", note: "免烧砖" }],
    paymentMethods: [{ value: "bank_transfer", label: "银行转账" }], paymentChannels: [{ id: "channel-1", sortOrder: 1, channelType: "bank_transfer", channelTypeLabel: "银行转账", accountName: "利民建材店", bankName: "建设银行", accountNumberLast4: "1234", note: null, primary: true }],
    discrepancy: { status: "none", nextStep: null, refund: null }, approvalOriginal: { documentId: "payment-original", fileId: "a5-original", templateKey: "spot_procurement_payment_approval_original_v1", createdAt: now, immutable: true }, archives: [], archiveStatus: { status: "generated", label: "归档包已生成", canRetry: false, latestVersionNo: 1 },
    invoice: { status: "pending", statusLabel: "待补发票", activeCount: 0, invoices: [] },
    paymentPdf: { available: true, businessType: "spot_procurement_payment", businessId: "payment-1", disabledReason: null }, availableActions: [], primaryAction: null, disabledReasons: []
  };
}

function receiptDetail() {
  return {
    receipt: {
      id: "receipt-1", projectId: "project-1", procurementId: "procurement-1", procurementCode: "LXCG-E2E-001", procurementVersionId: "version-1", procurementVersionNo: 1, procurementVersionStatus: "approved", status: "draft", currentRevisionNo: 1,
      receiptOpen: true, firstActualPayment: { executionId: "execution-1", paidAt: now }, blockedReason: null, handler,
      note: null, actualCostCents: "0", firstSubmittedAt: null, submittedAt: null, submittedBy: null, lockedAt: null
    },
    delegation: null, latestPdf: null,
    lines: [{ procurementLineId: "line-1", sortOrder: 1, materialName: "免烧砖", specification: "240×115×53", unit: "块", approvedQuantity: "1000", frozenUnitPrice: "4.4", qualifiedQuantity: null, unqualifiedQuantity: null, unqualifiedReason: null, freeGiftQuantity: null, replenishmentPending: false, discrepancyNote: null, actualCostCents: null }],
    photos: [], reviews: [], discrepancy: { status: "none", nextStep: null }
  };
}

test("renders A4 application, A5 payment and payment-opened final receipt without legacy balance fields", async ({ page }, testInfo) => {
  const paymentListViews: string[] = [];
  await mockLogin(page);
  await page.route("**/api/spot-procurements**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith("/receipt") ? receiptDetail() : path.endsWith("/procurement-1") ? procurementDetail() : { items: [procurementListRow()], truncated: false, limit: 200 };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/api/spot-procurement-payments**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const requestedView = url.searchParams.get("view") ?? "mine";
    if (!path.endsWith("/payment-1")) paymentListViews.push(requestedView);
    const body = path.endsWith("/payment-1") ? paymentDetail() : {
      view: requestedView,
      items: [paymentListRow({
        status: "draft",
        statusLabel: "付款草稿",
        approval: { ...approval, currentNodeName: "尚未发起审批" },
        approvalAmountCents: null,
        currentTask: { key: "complete_payment_draft", label: "补全付款信息并提交", hint: "采购已通过，请完善 A5 付款申请", priority: 300, scope: "personal", enabled: true, disabledReason: null }
      })],
      viewCounts: { mine: 1, all: 1, closed: 0 },
      amountSummary: requestedView === "all" ? {
        approvalAmountCents: "440000",
        actualPaidAmountCents: "220000",
        refundAmountCents: "0",
        netPaidAmountCents: "220000",
        complete: false
      } : null,
      truncated: false,
      limit: 200
    };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/api/spot-procurements/create-project-options", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify([project]) })
  );
  await page.route("**/api/spot-procurements/capabilities?*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        projectId: project.id,
        enabled: true,
        canCreate: true,
        canExecutePayment: false,
        unavailableReason: null,
        handlerOptions: []
      })
    })
  );
  await page.route("**/api/spot-procurements/application-text-suggestions?*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Spot@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await page.setViewportSize({ width: 1366, height: 768 });

  await page.goto("/零星采购工作台");
  await expect(page.getByRole("heading", { name: "零星采购工作台" })).toBeVisible();
  await expect(page.getByText("LXCG-E2E-001", { exact: true })).toBeVisible();
  await expect(page.getByText("付款：部分已付", { exact: true })).toBeVisible();
  await expect(page.getByText("收货：待确认收货", { exact: true })).toBeVisible();
  await expect(page.getByText("供应商余额抵扣", { exact: true })).toHaveCount(0);
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
  await page.screenshot({
    path: path.join(testInfo.outputDir, "spot-procurement-workbench-1366x768.png"),
    fullPage: true
  });

  await page.getByRole("button", { name: "新建采购申请" }).click();
  await expect(page.getByText("采购申请单号会在保存草稿时由系统自动生成。")).toBeVisible();
  await expect(page.getByText("XM-001 · 一号项目", { exact: true })).toBeVisible();
  await expect(page.getByText("系统申请单编号", { exact: true })).toHaveCount(0);

  await page.goto("/零星材料付款工作台");
  await expect(page.getByRole("heading", { name: "零星材料付款工作台" })).toBeVisible();
  expect(paymentListViews[0]).toBe("mine");
  await expect(page.getByRole("heading", { name: "当前付款任务" })).toBeVisible();
  await expect(page.getByText("补全付款信息并提交", { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel("当前真实付款金额摘要")).toHaveCount(0);
  await expect(page.getByText("利民建材店", { exact: true }).first()).toBeVisible();
  for (const heading of ["付款申请", "项目 / 商户", "金额", "当前状态", "当前任务", "操作"]) {
    await expect(page.getByRole("columnheader", { name: heading, exact: true })).toBeVisible();
  }
  await expect(page.getByText("收货与发票", { exact: true })).toHaveCount(0);
  await expect(page.getByText("转商户余额", { exact: true })).toHaveCount(0);
  await expect(page.locator(".payment-task-queue").getByRole("button", { name: "填写", exact: true })).toBeVisible();
  await page.screenshot({
    path: path.join(testInfo.outputDir, "spot-procurement-payment-workbench-mine-1366x768.png"),
    fullPage: true
  });
  await page.getByRole("button", { name: "全部申请 1", exact: true }).click();
  await expect(page.getByLabel("当前真实付款金额摘要").getByText("累计实付", { exact: true })).toBeVisible();
  await expect(page.getByText("汇总未覆盖全部可见记录", { exact: true })).toBeVisible();
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
  await page.screenshot({
    path: path.join(testInfo.outputDir, "spot-procurement-payment-workbench-1366x768.png"),
    fullPage: true
  });
  await page.setViewportSize({ width: 1024, height: 768 });
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
  await expectHorizontalScrollOwner(page.locator(".jg-table-region .t-table__content"));
  await page.screenshot({
    path: path.join(testInfo.outputDir, "spot-procurement-payment-workbench-all-1024x768.png"),
    fullPage: true
  });
  await page.setViewportSize({ width: 720, height: 768 });
  const taskGridColumns = await page.locator(".payment-task-queue__cards").evaluate(
    (element) => getComputedStyle(element).gridTemplateColumns
  );
  expect(taskGridColumns.trim().split(/\s+/)).toHaveLength(1);
  await page.setViewportSize({ width: 1366, height: 768 });

  await page.locator(".payment-task-queue").getByRole("button", { name: "填写", exact: true }).click();
  await expect(page.getByRole("heading", { name: "项目零星付款申请单" })).toBeVisible();
  await page.getByRole("button", { name: "返回工作台" }).click();
  await expect(page.getByRole("heading", { name: "零星材料付款工作台" })).toBeVisible();
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe("/零星材料付款工作台");

  await page.goto("/收货确认工作台");
  await expect(page.getByRole("heading", { name: "收货确认工作台" })).toBeVisible();
  await expect(page.getByText("付款状态", { exact: true })).toBeVisible();
  await expect(page.getByText("待确认收货", { exact: true })).toBeVisible();

  await page.goto("/零星采购收货/procurement-1");
  await expect(page.getByText("一次最终收货", { exact: true })).toBeVisible();
  await expect(page.getByText("没有商户余额路径", { exact: true })).toBeVisible();
  await expect(page.getByText("发票是整张付款申请的可选附件", { exact: true })).toBeVisible();
});

test("keeps only the latest payment workbench request when views resolve out of order", async ({ page }) => {
  await mockLogin(page);
  await page.route("**/api/projects", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([project])
  }));

  type Outcome = "success" | "failure";
  type PendingRequest = {
    view: string;
    release: (outcome: Outcome) => void;
    completed: Promise<void>;
  };
  const pendingRequests: PendingRequest[] = [];

  await page.route("**/api/spot-procurement-payments**", async (route) => {
    const view = new URL(route.request().url()).searchParams.get("view") ?? "mine";
    let release!: (outcome: Outcome) => void;
    let complete!: () => void;
    const outcome = new Promise<Outcome>((resolve) => { release = resolve; });
    const completed = new Promise<void>((resolve) => { complete = resolve; });
    pendingRequests.push({ view, release, completed });

    try {
      if (await outcome === "failure") {
        await route.abort("failed");
        return;
      }
      const code = view === "mine" ? "OLD-MINE" : view === "all" ? "NEW-ALL" : "NEW-CLOSED";
      const currentTask = view === "all"
        ? { key: "unknown_task", label: "未知服务端任务", hint: "仅允许查看", priority: 300, scope: "personal", enabled: true, disabledReason: null }
        : { key: "view_only", label: "无需办理", hint: "当前为只读记录", priority: 0, scope: "none", enabled: false, disabledReason: null };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          view,
          items: [paymentListRow({ id: `payment-${view}`, code, currentTask })],
          viewCounts: { mine: 1, all: 1, closed: 1 },
          amountSummary: null,
          truncated: false,
          limit: 200
        })
      });
    } finally {
      complete();
    }
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Spot@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await page.goto("/零星材料付款工作台");
  await expect.poll(() => pendingRequests.length).toBe(1);
  expect(pendingRequests[0]!.view).toBe("mine");
  await expect(page.getByRole("button", { name: "待我办理 0", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "全部申请 0", exact: true }).click();
  await expect.poll(() => pendingRequests.length).toBe(2);
  expect(pendingRequests[1]!.view).toBe("all");
  pendingRequests[0]!.release("success");
  await pendingRequests[0]!.completed;
  await expect(page.getByText("正在读取零星材料付款", { exact: true })).toBeVisible();
  await expect(page.getByText("OLD-MINE", { exact: true })).toHaveCount(0);

  pendingRequests[1]!.release("success");
  await pendingRequests[1]!.completed;
  await expect(page.getByText("NEW-ALL", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "全部申请 1", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "处理", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "查看", exact: true })).toHaveCount(2);

  await page.getByRole("button", { name: "待我办理 1", exact: true }).click();
  await expect.poll(() => pendingRequests.length).toBe(3);
  await page.getByRole("button", { name: "已办结 1", exact: true }).click();
  await expect.poll(() => pendingRequests.length).toBe(4);
  expect(pendingRequests[2]!.view).toBe("mine");
  expect(pendingRequests[3]!.view).toBe("closed");
  pendingRequests[3]!.release("success");
  await pendingRequests[3]!.completed;
  await expect(page.getByText("NEW-CLOSED", { exact: true })).toBeVisible();
  pendingRequests[2]!.release("failure");
  await pendingRequests[2]!.completed;
  await expect(page.getByText("NEW-CLOSED", { exact: true })).toBeVisible();
  await expect(page.getByText("零星材料付款暂不可用", { exact: true })).toHaveCount(0);
});
