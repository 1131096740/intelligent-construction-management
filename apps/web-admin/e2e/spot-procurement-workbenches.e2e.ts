import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
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

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function mockLogin(
  page: Page,
  user: {
    id?: string;
    name?: string;
    phone?: string;
    roleKeys?: string[];
    globalRoleKeys?: string[];
  } = {}
) {
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: user.id ?? "handler-1",
        name: user.name ?? "物资员甲",
        phone: user.phone ?? "13900000000",
        mustChangePassword: false,
        roleKeys: user.roleKeys ?? ["material_staff"],
        globalRoleKeys: user.globalRoleKeys ?? []
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
      paymentId: "payment-1",
      status: "pending_determination",
      statusLabel: "付款金额待确定",
      approvalAmountCents: null,
      actualPaidAmountCents: null,
      refundAmountCents: null,
      netPaidAmountCents: null,
      remainingAmountCents: null,
      visibilityRestricted: false
    },
    receipt: receiptSummary,
    receiptWorkbench: {
      materialSummary: "免烧砖（240×115×53）",
      approvedQuantitySummary: "1000 块",
      actualPaidAmountCents: "220000",
      receiptResponsible: handler,
      receiptDelegate: { id: "delegate-1", name: "受托人乙" },
      updatedAt: now
    },
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

function procurementDetail(paymentOverrides = {}) {
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
    payments: [paymentListRow(paymentOverrides)], paymentSummary: procurementListRow().payment, receipt: receiptSummary,
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
      id: "payment-1", code: "LXFK-E2E-001", status: "draft", statusLabel: "付款草稿", project,
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
    paymentPdf: { available: true, businessType: "spot_procurement_payment", businessId: "payment-1", disabledReason: null },
    currentTask: { key: "complete_payment_draft", label: "完善付款草稿", hint: "补齐付款信息", priority: 300, scope: "personal", enabled: true, disabledReason: null },
    availableActions: [{ key: "edit_draft", label: "编辑付款草稿", kind: "normal", enabled: true, disabledReason: null }], primaryAction: null, disabledReasons: []
  };
}

function paymentDetailFor(
  id: string,
  code: string,
  availableActions: Array<Record<string, unknown>>
) {
  const base = paymentDetail();
  return {
    ...base,
    payment: { ...base.payment, id, code },
    paymentPdf: { ...base.paymentPdf, businessId: id },
    availableActions
  };
}

function receiptDetail() {
  return {
    receipt: {
      id: "receipt-1", projectId: "project-1", procurementId: "procurement-1", procurementCode: "LXCG-E2E-001", procurementVersionId: "version-1", procurementVersionNo: 1, procurementVersionStatus: "approved", status: "draft", currentRevisionNo: 1,
      receiptOpen: true, firstActualPayment: { executionId: "execution-1", paidAt: now }, blockedReason: null, handler,
      note: null, actualCostCents: "0", firstSubmittedAt: null, submittedAt: null, submittedBy: null, lockedAt: null
    },
    delegation: null, latestPdf: null, availableActions: [],
    lines: [{ procurementLineId: "line-1", sortOrder: 1, materialName: "免烧砖", specification: "240×115×53", unit: "块", approvedQuantity: "1000", frozenUnitPrice: "4.4", qualifiedQuantity: null, unqualifiedQuantity: null, unqualifiedReason: null, freeGiftQuantity: null, replenishmentPending: false, discrepancyNote: null, actualCostCents: null }],
    photos: [], reviews: [], discrepancy: { status: "none", nextStep: null }
  };
}

function receiptDetailFor(
  procurementId: string,
  code: string,
  availableActions: Array<{ key: string; label: string; kind: string; enabled: boolean; disabledReason: string | null }> = [],
  overrides: Record<string, unknown> = {}
) {
  const base = receiptDetail();
  return {
    ...base,
    ...overrides,
    receipt: {
      ...base.receipt,
      id: `receipt-${procurementId}`,
      procurementId,
      procurementCode: code
    },
    availableActions
  };
}

function procurementDetailFor(procurementId: string, code: string, projectName: string) {
  const base = procurementDetail();
  return {
    ...base,
    procurement: {
      ...base.procurement,
      id: procurementId,
      code,
      project: { ...project, id: `project-${procurementId}`, name: projectName }
    },
    payments: [],
    paymentSummary: null
  };
}

async function switchReceiptRoute(page: Page, procurementId: string) {
  await page.evaluate((nextProcurementId) => {
    history.pushState({}, "", `/零星采购收货/${nextProcurementId}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, procurementId);
}

async function mockReceiptPair(
  page: Page,
  receiptA: ReturnType<typeof receiptDetailFor>,
  options: { delayA?: Promise<void>; onARead?: () => void } = {}
) {
  await page.route("**/api/spot-procurements/**", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    const isA = pathname.includes("procurement-A");
    if (isA) {
      options.onARead?.();
      await options.delayA;
    }
    if (pathname === "/api/spot-procurements/procurement-A/receipt") {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(receiptA) });
    }
    if (pathname === "/api/spot-procurements/procurement-A") {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(procurementDetailFor("procurement-A", "LXCG-A", "项目A")) });
    }
    if (pathname === "/api/spot-procurements/procurement-B/receipt") {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(receiptDetailFor("procurement-B", "LXCG-B")) });
    }
    if (pathname === "/api/spot-procurements/procurement-B") {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(procurementDetailFor("procurement-B", "LXCG-B", "项目B")) });
    }
    return route.fallback();
  });
}

async function loginAndOpenReceipt(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Spot@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
  await page.goto("/零星采购收货/procurement-A");
}

test("renders A4 application, A5 payment and payment-opened final receipt without legacy balance fields", async ({ page }, testInfo) => {
  const paymentListViews: string[] = [];
  await mockLogin(page);
  await page.route("**/api/spot-procurements**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith("/receipt")
      ? receiptDetail()
      : path.endsWith("/procurement-fill")
        ? procurementDetail({
            status: "draft",
            statusLabel: "付款草稿",
            currentTask: { key: "complete_payment_draft", label: "完善付款草稿", hint: "补齐付款信息", priority: 300, scope: "personal", enabled: true, disabledReason: null }
          })
        : path.endsWith("/procurement-view")
          ? procurementDetail({
              status: "draft",
              statusLabel: "付款草稿",
              currentTask: { key: "complete_payment_draft", label: "完善付款草稿", hint: "当前账号无办理权", priority: 300, scope: "personal", enabled: false, disabledReason: "当前账号无办理权" }
            })
          : path.endsWith("/procurement-unknown")
            ? procurementDetail({
                status: "draft",
                statusLabel: "付款草稿",
                currentTask: { key: "unknown_task", label: "未知任务", hint: "只读查看", priority: 300, scope: "personal", enabled: true, disabledReason: null }
              })
            : path.endsWith("/procurement-1")
              ? procurementDetail()
              : {
                  items: [procurementListRow()],
                  view: "active",
                  surface: "procurement",
                  pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
                  statistics: { total: 1, byStatus: { approved_in_progress: 1 } }
                };
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
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
  await page.setViewportSize({ width: 1366, height: 768 });

  await page.goto("/零星采购工作台");
  await expect(page.getByRole("heading", { name: "零星采购工作台" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "到位日期", exact: true })).toBeVisible();
  await expect(page.getByText("2026/7/18", { exact: true })).toBeVisible();
  await expect(page.getByText("LXCG-E2E-001", { exact: true })).toBeVisible();
  await expect(page.getByText("付款：付款金额待确定", { exact: true })).toBeVisible();
  await expect(page.getByText("收货：待确认收货", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "填写付款申请", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "填写付款申请", exact: true }).click();
  await expect.poll(() => {
    const url = new URL(page.url());
    return `${decodeURIComponent(url.pathname)}${url.search}`;
  }).toBe("/零星材料付款/payment-1?tab=current");
  await expect(page.getByRole("button", { name: "编辑 A5 付款草稿", exact: true })).toBeVisible();
  await page.goto("/零星材料付款/payment-1?tab=unknown");
  await expect(page.getByRole("button", { name: "编辑 A5 付款草稿", exact: true })).toBeVisible();
  await page.goto("/零星采购/procurement-1");
  await page.locator(".t-tabs").getByText("关联付款", { exact: true }).click();
  await expect(page.getByRole("button", { name: "处理付款", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "处理付款", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "处理付款", exact: true }).click();
  await expect.poll(() => {
    const url = new URL(page.url());
    return `${decodeURIComponent(url.pathname)}${url.search}`;
  }).toBe("/零星材料付款/payment-1?tab=current");
  await page.goto("/零星采购/procurement-fill");
  await page.locator(".t-tabs").getByText("关联付款", { exact: true }).click();
  await expect(page.getByRole("button", { name: "填写付款申请", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "填写付款申请", exact: true })).toBeVisible();
  await page.goto("/零星采购/procurement-view");
  await page.locator(".t-tabs").getByText("关联付款", { exact: true }).click();
  await expect(page.getByRole("button", { name: "查看付款申请", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "查看付款申请", exact: true })).toBeVisible();
  await page.goto("/零星采购/procurement-unknown");
  await page.locator(".t-tabs").getByText("关联付款", { exact: true }).click();
  await expect(page.getByRole("button", { name: "查看付款申请", exact: true })).toBeVisible();
  await page.goto("/零星采购工作台");
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
  for (const heading of [
    "付款编号",
    "采购编号",
    "项目",
    "商户 / 收款对象",
    "审批金额",
    "实付 / 退款 / 剩余",
    "收货 / 发票",
    "状态 / 当前办理人",
    "更新时间",
    "操作"
  ]) {
    await expect(page.getByRole("columnheader", { name: heading, exact: true })).toBeVisible();
  }
  await expect(page.getByText("实付 ¥2,200.00 / 退款 ¥0.00 / 剩余 ¥2,200.00", { exact: true })).toBeVisible();
  await expect(page.getByText("待确认收货 / 待补发票", { exact: true })).toBeVisible();
  await expect(page.getByText("收货与发票", { exact: true })).toHaveCount(0);
  await expect(page.getByText("转商户余额", { exact: true })).toHaveCount(0);
  const paymentLedgerRow = page.getByRole("row").filter({ hasText: "LXFK-E2E-001" });
  await expect(paymentLedgerRow.locator(".business-status-text--neutral")).toHaveCount(0);
  await expect(paymentLedgerRow.locator(".business-status-text--required")).toHaveCount(1);
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
  await page.setViewportSize({ width: 768, height: 768 });
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
  await page.screenshot({
    path: path.join(testInfo.outputDir, "spot-procurement-payment-workbench-768x768.png"),
    fullPage: true
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const taskGridColumns = await page.locator(".payment-task-queue__cards").evaluate(
    (element) => getComputedStyle(element).gridTemplateColumns
  );
  expect(taskGridColumns.trim().split(/\s+/)).toHaveLength(1);
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
  await expectHorizontalScrollOwner(page.locator(".jg-table-region .t-table__content"));
  await page.screenshot({
    path: path.join(testInfo.outputDir, "spot-procurement-payment-workbench-390x844.png"),
    fullPage: true
  });
  await page.setViewportSize({ width: 1366, height: 768 });

  await page.locator(".payment-task-queue").getByRole("button", { name: "填写", exact: true }).click();
  await expect(page.getByRole("heading", { name: "项目零星付款申请单" })).toBeVisible();
  await page.getByRole("button", { name: "返回工作台" }).click();
  await expect(page.getByRole("heading", { name: "零星材料付款工作台" })).toBeVisible();
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe("/零星材料付款工作台");

  await page.goto("/收货确认工作台");
  await expect(page.getByRole("heading", { name: "收货确认工作台" })).toBeVisible();
  await expect(page.getByText("采购/付款编号", { exact: true })).toBeVisible();
  await expect(page.getByText("材料摘要", { exact: true })).toBeVisible();
  await expect(page.getByText("已付金额", { exact: true })).toBeVisible();
  await expect(page.getByText("收货责任人/受托人", { exact: true })).toBeVisible();
  await expect(page.getByText("免烧砖（240×115×53）", { exact: true })).toBeVisible();
  await expect(page.getByText("物资员甲（委托：受托人乙）", { exact: true })).toBeVisible();
  await expect(page.getByText("待确认收货", { exact: true })).toBeVisible();

  await page.goto("/零星采购收货/procurement-1");
  await expect(page.getByText("一次最终收货", { exact: true })).toBeVisible();
  await expect(page.getByText("没有商户余额路径", { exact: true })).toBeVisible();
  await expect(page.getByText("发票是整张付款申请的可选附件", { exact: true })).toBeVisible();
});

test("renders the seven trial roles from server tasks without privileged cross-role actions", async ({ browser }) => {
  test.slow();
  const matrix = [
    {
      roleKey: "material_staff",
      name: "物资员",
      task: { key: "complete_payment_draft", label: "完善付款草稿", hint: "补齐付款信息", priority: 300, scope: "personal", enabled: true, disabledReason: null },
      actions: [{ key: "edit_draft", label: "编辑付款草稿", enabled: true, disabledReason: null }],
      node: "尚未发起审批",
      title: "补全付款信息并提交",
      button: "编辑 A5 付款草稿",
      forbidden: ["办理审批", "维护付款主体", "登记实际付款"]
    },
    {
      roleKey: "material_director",
      name: "物资主管",
      task: { key: "none", label: "当前无需办理", hint: "当前无需办理付款；后续需复核收货", priority: 0, scope: "none", enabled: false, disabledReason: null },
      actions: [],
      node: "综合部主管审批",
      title: "当前无需办理付款",
      button: null,
      forbidden: ["编辑 A5 付款草稿", "办理审批", "维护付款主体", "登记实际付款"]
    },
    {
      roleKey: "comprehensive_director",
      name: "综合部主管",
      task: { key: "review_payment", label: "待我审批", hint: "核对资料与付款主体", priority: 300, scope: "personal", enabled: true, disabledReason: null },
      actions: [{ key: "review_approval", label: "办理审批", enabled: true, disabledReason: null }],
      node: "综合部主管审批",
      title: "办理付款审批",
      button: "办理审批",
      forbidden: ["编辑 A5 付款草稿", "维护付款主体", "登记实际付款"]
    },
    {
      roleKey: "project_manager",
      name: "项目经理",
      task: { key: "review_payment", label: "待我审批", hint: "核对项目需要与付款材料", priority: 300, scope: "personal", enabled: true, disabledReason: null },
      actions: [{ key: "review_approval", label: "办理审批", enabled: true, disabledReason: null }],
      node: "项目经理审批",
      title: "办理付款审批",
      button: "办理审批",
      forbidden: ["编辑 A5 付款草稿", "维护付款主体", "登记实际付款"]
    },
    {
      roleKey: "finance_staff",
      name: "财务人员",
      task: { key: "complete_payer", label: "待补全付款主体", hint: "共享岗位协作补全", priority: 200, scope: "shared", enabled: true, disabledReason: null },
      actions: [{ key: "complete_payer", label: "维护付款主体", enabled: true, disabledReason: null }],
      node: "综合部主管审批",
      title: "协作补全付款主体与方式",
      button: "维护付款主体",
      forbidden: ["编辑 A5 付款草稿", "办理审批", "登记实际付款"]
    },
    {
      roleKey: "finance_director",
      name: "财务主管",
      task: { key: "review_payment", label: "待我审批", hint: "核对金额、主体与收款风险", priority: 300, scope: "personal", enabled: true, disabledReason: null },
      actions: [{ key: "review_approval", label: "办理审批", enabled: true, disabledReason: null }],
      node: "财务主管审批",
      title: "办理付款审批",
      button: "办理审批",
      forbidden: ["编辑 A5 付款草稿", "维护付款主体", "登记实际付款"]
    },
    {
      roleKey: "chairman",
      name: "董事长或总经理",
      task: { key: "review_payment", label: "待我审批", hint: "办理最终审批", priority: 300, scope: "personal", enabled: true, disabledReason: null },
      actions: [{ key: "review_approval", label: "办理审批", enabled: true, disabledReason: null }],
      node: "董事长或总经理审批",
      title: "办理最终审批",
      button: "办理审批",
      forbidden: ["编辑 A5 付款草稿", "维护付款主体", "登记实际付款"]
    }
  ] as const;

  for (const [index, current] of matrix.entries()) {
    const context = await browser.newContext();
    const rolePage = await context.newPage();
    const paymentId = `payment-role-${index + 1}`;
    await mockLogin(rolePage, {
      id: `${current.roleKey}-1`,
      name: current.name,
      phone: `1390000000${index}`,
      roleKeys: [current.roleKey]
    });
    await rolePage.route(`**/api/spot-procurement-payments/${paymentId}`, (route) => {
      const base = paymentDetail();
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ...base,
          payment: {
            ...base.payment,
            id: paymentId,
            code: `LXFK-ROLE-${index + 1}`,
            status: current.roleKey === "material_staff" ? "draft" : "approval_pending",
            statusLabel: current.roleKey === "material_staff" ? "付款草稿" : "审批中",
            payerManagement: current.roleKey === "finance_staff"
              ? { visible: true, enabled: true, disabledReason: null, requiresReapproval: false }
              : { visible: false, enabled: false, disabledReason: null, requiresReapproval: false }
          },
          approval: {
            status: current.roleKey === "material_staff" ? "draft" : "approval_pending",
            statusLabel: current.roleKey === "material_staff" ? "尚未发起审批" : "审批中",
            currentNodeName: current.node,
            currentRoleKeys: [current.roleKey]
          },
          currentTask: current.task,
          availableActions: current.actions,
          paymentPdf: { ...base.paymentPdf, businessId: paymentId }
        })
      });
    });

    await rolePage.goto("/login");
    await rolePage.getByPlaceholder("请输入手机号").fill(`1390000000${index}`);
    await rolePage.getByPlaceholder("请输入密码").fill("Spot@2026");
    await rolePage.getByRole("button", { name: "登录" }).click();
    await expect(rolePage).not.toHaveURL(/\/login(?:\?|$)/u);
    await rolePage.goto(`/零星材料付款/${paymentId}?tab=current`);
    await expect(rolePage.getByRole("heading", { name: current.title, exact: true })).toBeVisible();
    if (current.button) {
      await expect(rolePage.locator(".payment-current-task").getByRole("button", { name: current.button, exact: true })).toBeVisible();
    }
    for (const forbidden of current.forbidden) {
      await expect(rolePage.locator(".payment-current-task").getByRole("button", { name: forbidden, exact: true })).toHaveCount(0);
    }
    await context.close();
  }
});

test("recovers a failed payment detail read without a blank screen", async ({ page }) => {
  let readCount = 0;
  await mockLogin(page);
  await page.route("**/api/spot-procurement-payments/payment-read-retry", async (route) => {
    readCount += 1;
    if (readCount === 1) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "模拟读取失败" })
      });
      return;
    }
    const base = paymentDetail();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...base,
        payment: { ...base.payment, id: "payment-read-retry", code: "LXFK-READ-RETRY" },
        paymentPdf: { ...base.paymentPdf, businessId: "payment-read-retry" }
      })
    });
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Spot@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
  await page.goto("/零星材料付款/payment-read-retry?tab=current");
  await expect(page.getByText("付款申请暂不可用", { exact: true })).toBeVisible();
  await expect(page.getByText("模拟读取失败", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(page.getByText("LXFK-READ-RETRY", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "项目零星付款申请单", exact: true })).toBeVisible();
  expect(readCount).toBe(2);
});

test("locally resumes an incomplete A5 draft without inventing payment facts and submits only after server save", async ({ page }, testInfo) => {
  let saved = false;
  let draftAttempts = 0;
  const writeOrder: string[] = [];

  await mockLogin(page);
  await page.route("**/api/vat-rate-options", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/spot-procurement-payments?*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items: [], viewCounts: { mine: 0, all: 0, closed: 0 }, amountSummary: null, truncated: false, limit: 200 })
    })
  );
  await page.route("**/api/spot-procurement-payments/payment-stepper/draft", async (route) => {
    draftAttempts += 1;
    writeOrder.push("save");
    const payload = route.request().postDataJSON();
    expect(payload.payeeName).toBe("利民建材店");
    expect(payload.paymentLines[0]).toMatchObject({ paymentQuantity: "10.00", unitPrice: "4.40" });
    if (draftAttempts === 1) {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "模拟保存失败" }) });
      return;
    }
    saved = true;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "payment-stepper", status: "draft" }) });
  });
  await page.route("**/api/spot-procurement-payments/payment-stepper/submission", async (route) => {
    writeOrder.push("submit");
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "payment-stepper", status: "approval_pending" }) });
  });
  await page.route("**/api/spot-procurement-payments/payment-stepper", (route) => {
    const base = paymentDetail();
    const cashChannel = {
      id: "channel-cash",
      sortOrder: 1,
      channelType: "cash",
      channelTypeLabel: "现金",
      accountName: null,
      bankName: null,
      accountNumberLast4: null,
      note: null,
      primary: true
    };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...base,
        payment: {
          ...base.payment,
          id: "payment-stepper",
          code: "LXFK-STEPPER",
          paymentType: saved ? "company_direct" : null,
          paymentTypeLabel: saved ? "公司直付" : null,
          merchantName: saved ? "利民建材店" : null,
          payee: saved
            ? { ...base.payment.payee, name: "利民建材店", primaryChannel: cashChannel }
            : { name: null, accountName: null, primaryChannel: null }
        },
        materials: saved ? [{ ...base.materials[0], paymentQuantity: "10.00", unitPrice: "4.40", amountCents: "4400", expectedInvoiceCondition: "no_invoice", vatRateOptionId: null, vatRateLabel: null }] : [],
        paymentMethods: saved ? [{ value: "cash", label: "现金" }] : [],
        paymentChannels: saved ? [cashChannel] : [],
        availableActions: [
          { key: "edit_draft", label: "编辑 A5 付款草稿", kind: "normal", enabled: true, disabledReason: null },
          { key: "submit_approval", label: "提交付款审批", kind: "primary", enabled: true, disabledReason: null }
        ]
      })
    });
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Spot@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
  await page.goto("/零星材料付款/payment-stepper?tab=current");
  const secondEntry = page.getByRole("button", { name: "提交付款审批", exact: true });
  await secondEntry.click();

  await expect(page.getByRole("heading", { name: "继续填写付款申请", exact: true })).toBeVisible();
  await expect(page.locator(".t-dialog").filter({ hasText: "编辑项目零星付款申请单" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "1. 付款与商户", exact: true })).toHaveAttribute("aria-current", "step");
  await expect(page.locator(".payment-application-stepper input[type=checkbox]:checked")).toHaveCount(0);

  await page.getByRole("button", { name: "3. 收款渠道与依据", exact: true }).click();
  await page.getByRole("button", { name: "新增收款渠道", exact: true }).click();
  await expect(page.getByText("请先在第 1 步选择拟付款方式，再新增收款渠道。", { exact: true })).toBeVisible();
  await expect(page.getByText("渠道 1", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "1. 付款与商户", exact: true }).click();
  await page.getByPlaceholder("实际购买的商户").fill("利民建材店");
  await page.getByText("现金", { exact: true }).click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.locator(".payment-application-stepper__card .t-checkbox").click();
  const materialInputs = page.locator(".payment-application-stepper__card .payment-application-stepper__grid input");
  await materialInputs.nth(0).fill("10.00");
  await materialInputs.nth(1).fill("4.40");
  await page.getByRole("button", { name: "下一步", exact: true }).click();

  await page.getByRole("button", { name: "保存并退出", exact: true }).click();
  await expect(page.getByRole("heading", { name: "继续填写付款申请", exact: true })).toHaveCount(0);
  await expect(secondEntry).toBeFocused();
  expect(draftAttempts).toBe(0);
  const serializedLocalDraft = await page.evaluate(() => Array.from(
    { length: sessionStorage.length },
    (_, index) => {
      const key = sessionStorage.key(index) ?? "";
      return `${key}:${sessionStorage.getItem(key) ?? ""}`;
    }
  ).join("\n"));
  expect(serializedLocalDraft).toContain('"resumeStep":2');
  expect(serializedLocalDraft).not.toMatch(/channels|accountNumber|bankName|attachment|password|bank_transfer/i);

  await page.reload();
  const refreshedSecondEntry = page.getByRole("button", { name: "提交付款审批", exact: true });
  await refreshedSecondEntry.click();
  await expect(page.getByRole("button", { name: "3. 收款渠道与依据", exact: true })).toHaveAttribute("aria-current", "step");
  await expect(page.getByText("本机暂存，尚未同步服务器", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "1. 付款与商户", exact: true }).click();
  await expect(page.getByPlaceholder("实际购买的商户")).toHaveValue("利民建材店");
  await page.getByRole("button", { name: "2. 付款材料", exact: true }).click();
  await expect(page.locator(".payment-application-stepper__card .payment-application-stepper__grid input").nth(0)).toHaveValue("10.00");
  await expect(page.locator(".payment-application-stepper__card .payment-application-stepper__grid input").nth(1)).toHaveValue("4.40");

  await page.setViewportSize({ width: 390, height: 844 });
  const stepColumns = await page.locator(".payment-application-stepper__steps").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length);
  expect(stepColumns).toBe(1);
  await page.screenshot({
    path: path.join(testInfo.outputDir, "spot-payment-application-stepper-390x844.png"),
    fullPage: true
  });
  await page.getByRole("button", { name: "3. 收款渠道与依据", exact: true }).click();
  await page.getByRole("button", { name: "新增收款渠道", exact: true }).click();
  await expect(page.getByText("渠道 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "1. 付款与商户", exact: true }).click();
  await expect(page.getByText("现金已关联收款渠道；如需取消，请先在第 3 步删除对应渠道。", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "现金", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "3. 收款渠道与依据", exact: true }).click();
  await page.getByRole("button", { name: "下一步", exact: true }).click();

  writeOrder.length = 0;
  await page.getByRole("region", { name: "继续填写付款申请" }).getByRole("button", { name: "提交付款审批", exact: true }).click();
  await expect(page.getByText("模拟保存失败", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "继续填写付款申请", exact: true })).toBeVisible();
  expect(writeOrder).toEqual(["save"]);
  writeOrder.length = 0;
  await page.getByRole("region", { name: "继续填写付款申请" }).getByRole("button", { name: "提交付款审批", exact: true }).click();
  await expect.poll(() => writeOrder).toEqual(["save", "submit"]);
  await expect.poll(() => page.evaluate(() => Array.from(
    { length: sessionStorage.length },
    (_, index) => sessionStorage.key(index) ?? ""
  ).join("\n"))).not.toContain("spot-payment-local-draft");
});

test("fails closed when switching A5 payment routes and discards stale merchant responses", async ({ page }) => {
  const pendingAHistory: Route[] = [];
  const pendingUploads: Route[] = [];
  let paymentAWrites = 0;
  let paymentASubmits = 0;
  let paymentBWrites = 0;
  let paymentBSubmits = 0;
  const draftDetail = (id: string, projectId: string, projectName: string, materialName: string) => {
    const base = paymentDetail();
    return {
      ...base,
      payment: {
        ...base.payment,
        id,
        code: id === "payment-A" ? "PAY-A" : "PAY-B",
        project: { id: projectId, code: projectId, name: projectName },
        paymentType: null,
        paymentTypeLabel: null,
        merchantName: null,
        payee: { name: null, accountName: null, primaryChannel: null }
      },
      materials: [],
      procurementMaterials: [{
        id: `${id}-line`, sortOrder: 1, materialName, specification: null,
        unit: "件", approvedQuantity: "2.00", note: null
      }],
      paymentMethods: [],
      paymentChannels: [],
      availableActions: [
        { key: "edit_draft", label: "编辑 A5 付款草稿", kind: "normal", enabled: true, disabledReason: null },
        { key: "submit_approval", label: "提交付款审批", kind: "primary", enabled: true, disabledReason: null }
      ]
    };
  };

  await mockLogin(page);
  await page.route("**/api/spot-procurement-payments/payment-A", (route) => {
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(draftDetail("payment-A", "project-A", "项目A", "A材料")) });
  });
  await page.route("**/api/spot-procurement-payments/payment-B", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(draftDetail("payment-B", "project-B", "项目B", "B材料")) })
  );
  await page.route("**/api/spot-procurement-payments/payment-A/draft", async (route) => {
    paymentAWrites += 1;
    await route.fulfill({ contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/spot-procurement-payments/payment-A/submission", async (route) => {
    paymentASubmits += 1;
    await route.fulfill({ contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/spot-procurement-payments/payment-B/draft", async (route) => {
    paymentBWrites += 1;
    await route.fulfill({ contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/spot-procurement-payments/payment-B/submission", async (route) => {
    paymentBSubmits += 1;
    await route.fulfill({ contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/files", (route) => { pendingUploads.push(route); });
  await page.route("**/api/spot-procurement-payments?*", async (route) => {
    const projectId = new URL(route.request().url()).searchParams.get("projectId");
    if (projectId === "project-A") {
      pendingAHistory.push(route);
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items: [{ merchantName: "B历史商户" }],
        viewCounts: { mine: 0, all: 0, closed: 0 }, amountSummary: null, truncated: false, limit: 200
      })
    });
  });
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Spot@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
  await page.goto("/零星材料付款/payment-A?tab=current");
  await page.getByRole("button", { name: "提交付款审批", exact: true }).click();
  await page.getByPlaceholder("实际购买的商户").fill("A敏感商户");
  await page.getByText("银行转账", { exact: true }).click();
  await page.getByRole("button", { name: "2. 付款材料", exact: true }).click();
  await page.locator(".payment-application-stepper__card .t-checkbox").click();
  const aMaterialInputs = page.locator(".payment-application-stepper__card .payment-application-stepper__grid input");
  await aMaterialInputs.nth(0).fill("1.00");
  await aMaterialInputs.nth(1).fill("99.00");
  await page.getByRole("button", { name: "3. 收款渠道与依据", exact: true }).click();
  await page.getByRole("button", { name: "新增收款渠道", exact: true }).click();
  const aChannelInputs = page.locator(".payment-application-stepper__card").filter({ hasText: "渠道 1" }).locator("input");
  await aChannelInputs.nth(1).fill("A账户");
  await aChannelInputs.nth(2).fill("6222000011112222");
  await aChannelInputs.nth(3).fill("A银行");
  await page.locator(".payment-application-stepper__evidence input[type=file]").setInputFiles({
    name: "A付款依据.pdf", mimeType: "application/pdf", buffer: Buffer.from("A")
  });
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await page.getByRole("region", { name: "继续填写付款申请" }).getByRole("button", { name: "提交付款审批", exact: true }).click();
  await expect.poll(() => pendingUploads.length).toBe(1);
  expect(paymentAWrites).toBe(0);

  await page.evaluate(() => {
    history.pushState({}, "", "/零星材料付款/payment-B?tab=current");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByText("PAY-B", { exact: true })).toBeVisible();
  await expect(page.getByText("页面已切换到另一张付款申请，原操作已停止，请在当前单据重新办理。", { exact: true })).toBeVisible();
  expect(paymentASubmits).toBe(0);
  expect(paymentBSubmits).toBe(0);
  await expect(page.getByRole("heading", { name: "继续填写付款申请", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "提交付款审批", exact: true }).click();
  await expect(page.getByPlaceholder("实际购买的商户")).toHaveValue("");
  await expect(page.getByText("A敏感商户", { exact: true })).toHaveCount(0);
  await expect(page.locator(".payment-application-stepper input[type=checkbox]:checked")).toHaveCount(0);
  await page.getByRole("button", { name: "2. 付款材料", exact: true }).click();
  await expect(page.getByText("B材料", { exact: false })).toBeVisible();
  await expect(page.getByText("A材料", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "3. 收款渠道与依据", exact: true }).click();
  await expect(page.getByText("渠道 1", { exact: true })).toHaveCount(0);
  await expect(page.locator(".payment-application-stepper__evidence input[type=file]")).toHaveValue("");

  await pendingAHistory[0]?.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ items: [{ merchantName: "A慢响应商户" }], viewCounts: { mine: 0, all: 0, closed: 0 }, amountSummary: null, truncated: false, limit: 200 })
  });
  await page.getByRole("button", { name: "1. 付款与商户", exact: true }).click();
  await expect(page.getByText("B历史商户", { exact: true })).toBeVisible();
  await expect(page.getByText("A慢响应商户", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "2. 付款材料", exact: true }).click();
  const bMaterialCard = page.locator(".payment-application-stepper__card").filter({ hasText: "B材料" });
  await bMaterialCard.locator(".t-checkbox").click();
  const bMaterialInputs = bMaterialCard.locator(".payment-application-stepper__grid input");
  await bMaterialInputs.nth(0).fill("1.00");
  await bMaterialInputs.nth(1).fill("88.00");
  await bMaterialCard.locator(".t-select").first().click();
  await page.getByText("普通增值税发票", { exact: true }).click();
  const bTaxRateInput = bMaterialCard.getByLabel("税率（%）", { exact: true });
  await bTaxRateInput.fill("0");
  await expect(bTaxRateInput).toHaveValue("0");

  await page.getByRole("button", { name: "1. 付款与商户", exact: true }).click();
  await page.getByPlaceholder("实际购买的商户").fill("B安全商户");
  await page.getByText("现金", { exact: true }).click();
  await page.getByRole("button", { name: "3. 收款渠道与依据", exact: true }).click();
  await page.getByRole("button", { name: "新增收款渠道", exact: true }).click();
  await page.locator(".payment-application-stepper__evidence input[type=file]").setInputFiles({
    name: "B付款依据.pdf", mimeType: "application/pdf", buffer: Buffer.from("B")
  });
  const bSave = page.getByRole("button", { name: "保存并退出", exact: true });
  await bSave.click();
  await expect.poll(() => pendingUploads.length).toBe(2);
  await expect(bSave).toBeDisabled();

  await pendingUploads[0]?.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      id: "a-evidence-file", bucket: "private", objectKey: "test/a-evidence-file",
      originalName: "A付款依据.pdf", mimeType: "application/pdf", sizeBytes: 1,
      uploadedByUserId: "handler-1", createdAt: now
    })
  });
  await expect(page.getByText("页面已切换到另一张付款申请，原操作已停止，请在当前单据重新办理。", { exact: true })).toBeVisible();
  await expect(bSave).toBeDisabled();
  expect(paymentBWrites).toBe(0);
  expect(paymentAWrites).toBe(0);
  expect(paymentASubmits).toBe(0);
  expect(paymentBSubmits).toBe(0);

  await pendingUploads[1]?.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ message: "B附件上传失败" })
  });
  await expect(page.getByRole("heading", { name: "继续填写付款申请", exact: true })).toHaveCount(0);
  const localDrafts = await page.evaluate(() => Array.from(
    { length: sessionStorage.length },
    (_, index) => `${sessionStorage.key(index) ?? ""}:${sessionStorage.getItem(sessionStorage.key(index) ?? "") ?? ""}`
  ).join("\n"));
  expect(localDrafts).toContain("payment-A");
  expect(localDrafts).toContain("A敏感商户");
  expect(localDrafts).toContain("payment-B");
  expect(localDrafts).toContain("B安全商户");
  expect(localDrafts).not.toMatch(/6222000011112222|A银行|attachmentFiles/u);
});

test("routes an enabled refund task to the real receipt workflow and preserves frozen archive facts", async ({ page }) => {
  await mockLogin(page);
  await page.route("**/api/spot-procurement-payments/payment-refund", (route) => {
    const base = paymentDetail();
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...base,
        payment: {
          ...base.payment,
          id: "payment-refund",
          code: "LXFK-REFUND",
          status: "partially_paid",
          statusLabel: "部分已付"
        },
        currentTask: {
          key: "record_refund",
          label: "登记供应商退款",
          hint: "收货差异已确认，等待登记退款到账",
          priority: 400,
          scope: "personal",
          enabled: true,
          disabledReason: null
        },
        availableActions: [],
        archives: [{
          id: "archive-1",
          versionNo: 1,
          status: "generated",
          statusLabel: "已生成",
          trigger: "付款审批完成",
          createdAt: now,
          files: []
        }]
      })
    });
  });
  await page.route("**/api/spot-procurement-payments/payment-refund-disabled", (route) => {
    const base = paymentDetail();
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...base,
        payment: { ...base.payment, id: "payment-refund-disabled", code: "LXFK-REFUND-DISABLED" },
        currentTask: {
          key: "record_refund",
          label: "登记供应商退款",
          hint: "当前账号无退款办理权",
          priority: 400,
          scope: "personal",
          enabled: false,
          disabledReason: "当前账号无退款办理权"
        },
        availableActions: []
      })
    });
  });
  await page.route("**/api/spot-procurements/procurement-1/receipt", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(receiptDetail()) })
  );
  await page.route("**/api/spot-procurements/procurement-1", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(procurementDetail()) })
  );

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Spot@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);

  await page.goto("/零星材料付款/payment-refund?tab=current");
  const taskPanel = page.locator(".payment-current-task");
  await expect(taskPanel.locator(".payment-current-task__heading .business-status-text--danger")).toBeVisible();
  await expect(taskPanel.locator(".payment-current-task__summary .business-status-text--progress")).toBeVisible();
  await expect(taskPanel.getByRole("button", { name: "办理退款", exact: true })).toBeVisible();

  await page.locator(".t-tabs").getByText("审批进度", { exact: true }).click();
  await expect(page.locator(".detail-panel > .business-status-text--success")).toBeVisible();

  await page.locator(".t-tabs").getByText("归档资料", { exact: true }).click();
  await expect(page.getByText("LXCG-E2E-001 / V1", { exact: true })).toBeVisible();
  await expect(page.getByText("付款审批完成", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "查看当前采购单、审批与 PDF 可用性", exact: true })).toBeVisible();

  await page.locator(".t-tabs").getByText("当前办理", { exact: true }).click();
  await taskPanel.getByRole("button", { name: "办理退款", exact: true }).click();
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe("/零星采购收货/procurement-1");

  await page.goto("/零星材料付款/payment-refund-disabled?tab=current");
  await expect(page.getByRole("button", { name: "办理退款", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "当前无需办理付款", exact: true })).toBeVisible();
});

test("records two controlled executions from the frozen channel and refreshes server payment facts", async ({ page }) => {
  await mockLogin(page);
  let paidCents = 0;
  let uploadNo = 0;
  const executionPayloads: Array<Record<string, unknown>> = [];
  const executionDetail = () => {
    const base = paymentDetail();
    const remainingCents = 440000 - paidCents;
    const status = paidCents === 0 ? "approved_pending_payment" : remainingCents ? "partially_paid" : "paid";
    const statusLabel = paidCents === 0 ? "待付款" : remainingCents ? "部分已付" : "已付款";
    const executions = Array.from({ length: paidCents / 220000 }, (_, index) => ({
      id: `execution-${index + 1}`,
      amountCents: "220000",
      paidAt: now,
      paymentMethod: "bank_transfer",
      paymentMethodLabel: "银行转账",
      executedBy: { id: "finance-1", name: "财务甲" },
      voucherFileId: null,
      voucherFileName: `付款成功凭证${index + 1}.pdf`,
      voidedAt: null,
      voidReason: null,
      active: true,
      vouchers: [{ id: `voucher-link-${index + 1}`, fileId: `voucher-${index + 1}`, sortOrder: 1 }]
    }));
    return {
      ...base,
      payment: {
        ...base.payment,
        id: "payment-execution",
        code: "LXFK-EXECUTION",
        status,
        statusLabel,
        actualPaidAmountCents: String(paidCents),
        netPaidAmountCents: String(paidCents),
        remainingAmountCents: String(remainingCents)
      },
      executions,
      receipt: {
        ...receiptSummary,
        statusLabel: paidCents ? "待确认收货" : "待首笔实付后开放",
        blockedReason: paidCents ? null : "待财务登记首笔实际付款"
      },
      currentTask: remainingCents
        ? { key: "record_execution", label: "登记实际付款", hint: "选择冻结渠道并上传付款成功凭证", priority: 300, scope: "personal", enabled: true, disabledReason: null }
        : { key: "none", label: "无需办理", hint: "已完成付款", priority: 0, scope: "none", enabled: false, disabledReason: null },
      availableActions: remainingCents
        ? [{ key: "record_execution", label: "登记实际付款", kind: "primary", enabled: true, disabledReason: null }]
        : [],
      paymentPdf: { ...base.paymentPdf, businessId: "payment-execution" }
    };
  };

  await page.route("**/api/spot-procurement-payments/payment-execution/executions", async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    executionPayloads.push(payload);
    paidCents += Number(payload.amountCents);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ execution: { id: `execution-${executionPayloads.length}` }, payment: { id: "payment-execution" } })
    });
  });
  await page.route("**/api/spot-procurement-payments/payment-execution", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(executionDetail()) })
  );
  await page.route("**/api/files", (route) => {
    uploadNo += 1;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ id: `voucher-${uploadNo}` })
    });
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Spot@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
  await page.goto("/零星材料付款/payment-execution?tab=current");

  for (const expectedExecutionNo of [1, 2]) {
    await page.getByRole("button", { name: "登记实际付款", exact: true }).click();
    const amountInput = page.getByPlaceholder("元，最多 2 位小数");
    await expect(amountInput).toHaveValue(
      expectedExecutionNo === 1 ? "4400.00" : "2200.00"
    );
    if (expectedExecutionNo === 1) await amountInput.fill("2200.00");
    await page.locator(".payment-execution-drawer__body input[type=file]").setInputFiles({
      name: `付款成功凭证${expectedExecutionNo}.pdf`,
      mimeType: "application/pdf",
      buffer: Buffer.from(`voucher-${expectedExecutionNo}`)
    });
    await page.getByRole("button", { name: "继续核对", exact: true }).click();
    const passwordInput = page.locator('.payment-execution-drawer__body input[aria-label="当前登录密码"]:visible');
    await expect(passwordInput).toHaveAttribute("aria-label", "当前登录密码");
    await page.getByLabel("当前登录密码", { exact: true }).fill("Spot@2026");
    await page.getByRole("button", { name: "确认登记", exact: true }).click();
    await expect.poll(() => executionPayloads.length).toBe(expectedExecutionNo);
    await expect(page.getByText(`已关联 1 份`, { exact: true })).toHaveCount(expectedExecutionNo);
    if (expectedExecutionNo === 1) {
      await expect(page.getByText("部分已付", { exact: true }).first()).toBeVisible();
      await page.locator(".t-tabs").getByText("收货与发票", { exact: true }).click();
      await expect(page.getByText("待确认收货", { exact: true })).toBeVisible();
      await page.locator(".t-tabs").getByText("当前办理", { exact: true }).click();
    }
  }

  expect(executionPayloads).toHaveLength(2);
  expect(uploadNo).toBe(2);
  expect(executionPayloads.map((payload) => payload.paymentChannelId)).toEqual(["channel-1", "channel-1"]);
  expect(executionPayloads.map((payload) => payload.amountCents)).toEqual(["220000", "220000"]);
  expect(executionPayloads.map((payload) => payload.voucherFileIds)).toEqual([
    ["voucher-1"],
    ["voucher-2"]
  ]);
  await expect(page.getByText("已付款", { exact: true }).first()).toBeVisible();
  await expect(
    page.locator(".payment-composition-card__facts > div").filter({ hasText: "剩余待付" }).getByText("¥0.00", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "登记实际付款", exact: true })).toHaveCount(0);
});

test("retries a failed execution with one upload, the same frozen attempt and a re-entered password", async ({ page }) => {
  await mockLogin(page);
  let paid = false;
  let uploadNo = 0;
  const executionPayloads: Array<Record<string, unknown>> = [];
  const executionDetail = () => {
    const base = paymentDetail();
    return {
      ...base,
      payment: {
        ...base.payment,
        id: "payment-execution-retry",
        code: "LXFK-EXECUTION-RETRY",
        status: paid ? "paid" : "approved_pending_payment",
        statusLabel: paid ? "已付款" : "待付款",
        approvalAmountCents: "440000",
        actualPaidAmountCents: paid ? "440000" : "0",
        netPaidAmountCents: paid ? "440000" : "0",
        remainingAmountCents: paid ? "0" : "440000"
      },
      executions: paid
        ? [{
            id: "execution-retry-1",
            amountCents: "440000",
            paidAt: now,
            paymentMethod: "bank_transfer",
            paymentMethodLabel: "银行转账",
            executedBy: { id: "finance-1", name: "财务甲" },
            voucherFileId: null,
            voucherFileName: "付款成功凭证.pdf",
            voidedAt: null,
            voidReason: null,
            active: true,
            vouchers: [{ id: "voucher-link-retry", fileId: "voucher-retry", sortOrder: 1 }]
          }]
        : [],
      currentTask: paid
        ? { key: "none", label: "无需办理", hint: "已完成付款", priority: 0, scope: "none", enabled: false, disabledReason: null }
        : { key: "record_execution", label: "登记实际付款", hint: "选择冻结渠道并上传付款成功凭证", priority: 300, scope: "personal", enabled: true, disabledReason: null },
      availableActions: paid
        ? []
        : [{ key: "record_execution", label: "登记实际付款", kind: "primary", enabled: true, disabledReason: null }],
      paymentPdf: { ...base.paymentPdf, businessId: "payment-execution-retry" }
    };
  };

  await page.route("**/api/spot-procurement-payments/payment-execution-retry/executions", async (route) => {
    executionPayloads.push(route.request().postDataJSON() as Record<string, unknown>);
    if (executionPayloads.length === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "模拟网络失败" })
      });
      return;
    }
    paid = true;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ execution: { id: "execution-retry-1" }, payment: { id: "payment-execution-retry" } })
    });
  });
  await page.route("**/api/spot-procurement-payments/payment-execution-retry", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(executionDetail()) })
  );
  await page.route("**/api/files", (route) => {
    uploadNo += 1;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ id: "voucher-retry" })
    });
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Spot@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
  await page.goto("/零星材料付款/payment-execution-retry?tab=current");

  await page.getByRole("button", { name: "登记实际付款", exact: true }).click();
  await page.locator(".payment-execution-drawer__body input[type=file]").setInputFiles({
    name: "付款成功凭证.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("voucher-retry")
  });
  await page.getByRole("button", { name: "继续核对", exact: true }).click();
  const passwordInput = page.getByLabel("当前登录密码", { exact: true });
  await passwordInput.fill("first-password");
  await page.getByRole("button", { name: "确认登记", exact: true }).click();
  await expect.poll(() => executionPayloads.length).toBe(1);
  await expect(passwordInput).toHaveValue("");
  await expect(page.getByText("本次重试参数已锁定", { exact: true })).toBeVisible();

  await passwordInput.fill("second-password");
  await page.getByRole("button", { name: "确认登记", exact: true }).click();
  await expect.poll(() => executionPayloads.length).toBe(2);
  await expect(page.getByText("已关联 1 份", { exact: true })).toBeVisible();

  expect(uploadNo).toBe(1);
  expect(executionPayloads[0]?.confirmationPassword).toBe("first-password");
  expect(executionPayloads[1]?.confirmationPassword).toBe("second-password");
  expect(executionPayloads[1]?.idempotencyKey).toBe(executionPayloads[0]?.idempotencyKey);
  expect(executionPayloads[1]?.voucherFileIds).toEqual(executionPayloads[0]?.voucherFileIds);
  expect(executionPayloads[1]?.voucherFileIds).toEqual(["voucher-retry"]);
  await expect(page.getByText("已付款", { exact: true }).first()).toBeVisible();
});

test("restores focus to the actual execution trigger after the drawer has closed", async ({ page }) => {
  await mockLogin(page);
  await page.route("**/api/spot-procurement-payments/payment-execution-focus", async (route) => {
    const base = paymentDetail();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...base,
        payment: { ...base.payment, id: "payment-execution-focus" },
        currentTask: { key: "record_execution", label: "登记实际付款", hint: "登记实付", priority: 300, scope: "personal", enabled: true, disabledReason: null },
        availableActions: [{ key: "record_execution", label: "登记实际付款", kind: "primary", enabled: true, disabledReason: null }],
        paymentPdf: { ...base.paymentPdf, businessId: "payment-execution-focus" }
      })
    });
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Spot@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
  await page.goto("/零星材料付款/payment-execution-focus?tab=current");

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const trigger = page.getByRole("button", { name: "登记实际付款", exact: true });
    await trigger.click();
    const drawer = page.locator(".payment-execution-drawer");
    await expect(drawer.getByText("实际付款与凭证", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(drawer.getByText("实际付款与凭证", { exact: true })).toBeHidden();
    await expect(trigger).toBeFocused();
  }
});

test("opens one responsive A5 approval drawer, confirms facts, and posts the frozen decision", async ({ page }, testInfo) => {
  await mockLogin(page);
  let approvalPayload: unknown = null;
  await page.route("**/api/spot-procurement-payments/payment-review/approval", async (route) => {
    approvalPayload = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ id: "payment-review", status: "approval_pending" })
    });
  });
  await page.route("**/api/spot-procurement-payments/payment-review", (route) => {
    const base = paymentDetail();
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...base,
        payment: {
          ...base.payment,
          id: "payment-review",
          code: "LXFK-REVIEW",
          status: "approval_pending",
          statusLabel: "审批中",
          payerCompanyName: "云南建工测试公司"
        },
        approval: {
          status: "approval_pending",
          statusLabel: "审批中",
          currentNodeName: "财务主管审批",
          currentRoleKeys: ["finance_director"]
        },
        currentTask: {
          key: "review_payment",
          label: "待我审批",
          hint: "核对付款事实并办理审批",
          priority: 400,
          scope: "personal",
          enabled: true,
          disabledReason: null
        },
        availableActions: [{
          key: "review_approval",
          label: "办理审批",
          kind: "primary",
          enabled: true,
          disabledReason: null,
          requiresSelfReviewConfirmation: false
        }]
      })
    });
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Spot@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
  await page.goto("/零星材料付款/payment-review?tab=current");

  const trigger = page.locator(".payment-current-task").getByRole("button", { name: "办理审批", exact: true });
  await trigger.click();
  const drawer = page.locator(".payment-approval-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "办理项目零星付款审批", exact: true })).toBeFocused();
  const drawerContent = drawer.locator(".t-drawer__content-wrapper");
  const desktopViewportWidth = page.viewportSize()?.width ?? 1280;
  await expect.poll(async () => {
    const box = await drawerContent.boundingBox();
    return Math.round((box?.x ?? 0) + (box?.width ?? 0));
  }).toBe(desktopViewportWidth);
  const desktopBox = await drawerContent.boundingBox();
  expect(desktopBox?.width).toBeGreaterThanOrEqual(540);
  expect(desktopBox?.width).toBeLessThanOrEqual(570);
  expect(Math.round((desktopBox?.x ?? 0) + (desktopBox?.width ?? 0))).toBe(desktopViewportWidth);
  await page.screenshot({
    path: path.join(testInfo.outputDir, "spot-payment-approval-drawer-1280x720.png"),
    fullPage: true
  });
  await expect(drawer.getByText("审批金额", { exact: true })).toBeVisible();
  await expect(drawer.getByText("云南建工测试公司", { exact: true })).toBeVisible();
  await expect(drawer.getByText("利民建材店", { exact: true })).toBeVisible();
  await expect(drawer.getByText("董事长/总经理审批", { exact: true })).toBeVisible();
  await drawer.getByText("退回申请人修改", { exact: true }).click();
  await drawer.getByRole("button", { name: "继续确认", exact: true }).click();
  await expect(drawer.getByText("退回原因不能为空", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "取消", exact: true }).click();
  await expect(drawer).not.toHaveClass(/t-drawer--open/u);
  await expect(trigger).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "办理项目零星付款审批", exact: true })).toBeFocused();
  await expect.poll(async () => {
    const box = await drawerContent.boundingBox();
    return Math.round(box?.x ?? -1);
  }).toBe(0);
  const mobileBox = await drawerContent.boundingBox();
  expect(Math.round(mobileBox?.width ?? 0)).toBe(390);
  expect(Math.round(mobileBox?.x ?? -1)).toBe(0);
  await page.screenshot({
    path: path.join(testInfo.outputDir, "spot-payment-approval-drawer-390x844.png"),
    fullPage: true
  });
  await drawer.getByRole("button", { name: "取消", exact: true }).click();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await drawer.getByRole("button", { name: "继续确认", exact: true }).click();
  await expect(drawer.getByText("提交前请再次核对", { exact: true })).toBeVisible();
  await expect(drawer.getByText("通过", { exact: true })).toBeVisible();
  await expect(drawer.getByText("¥4,400.00", { exact: true })).toBeVisible();
  await expect(drawer.getByText("云南建工测试公司", { exact: true })).toBeVisible();
  await expect(drawer.getByText("利民建材店", { exact: true })).toBeVisible();
  await expect(drawer.getByText("董事长/总经理审批", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect.poll(() => approvalPayload).toEqual({
    decision: "approve",
    comment: ""
  });
});

test("closes payer and approval editors on an SPA payment switch without writing to either record", async ({ page }) => {
  await mockLogin(page);
  let payerWrites = 0;
  let approvalWrites = 0;
  let currentTaskMode: "payer" | "approval" = "payer";
  await page.route("**/api/company-entities", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([{
      id: "company-1",
      name: "云南建工测试公司",
      unifiedSocialCreditCode: "91530000TEST000001",
      registeredAddress: null,
      dataStatus: "confirmed",
      isActive: true,
      currentVersionNo: 1,
      createdAt: now,
      updatedAt: now
    }])
  }));
  await page.route("**/api/spot-procurement-payments/payment-*", (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname.endsWith("/payer")) {
      payerWrites += 1;
      return route.fulfill({ contentType: "application/json", body: "{}" });
    }
    if (requestUrl.pathname.endsWith("/approval")) {
      approvalWrites += 1;
      return route.fulfill({ contentType: "application/json", body: "{}" });
    }
    const id = requestUrl.pathname.includes("payment-B") ? "payment-B" : "payment-A";
    const base = paymentDetailFor(id, id === "payment-A" ? "LXFK-A" : "LXFK-B", [
      { key: "complete_payer", label: "维护付款主体", kind: "primary", enabled: true, disabledReason: null },
      { key: "review_approval", label: "办理审批", kind: "primary", enabled: true, disabledReason: null, requiresSelfReviewConfirmation: false }
    ]);
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...base,
        payment: {
          ...base.payment,
          status: "approval_pending",
          statusLabel: "审批中",
          payerManagement: {
            visible: true,
            enabled: true,
            disabledReason: null,
            requiresReapproval: false
          }
        },
        approval: {
          status: "approval_pending",
          statusLabel: "审批中",
          currentNodeName: "综合部主管审批",
          currentRoleKeys: ["comprehensive_director"]
        },
        currentTask: currentTaskMode === "payer" ? {
          key: "complete_payer",
          label: "待补全主体",
          hint: "补全付款主体和方式",
          priority: 350,
          scope: "shared",
          enabled: true,
          disabledReason: null
        } : {
          key: "review_payment",
          label: "待我审批",
          hint: "核对付款事实并办理审批",
          priority: 400,
          scope: "personal",
          enabled: true,
          disabledReason: null
        }
      })
    });
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Spot@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
  await page.goto("/零星材料付款/payment-A?tab=current");
  await page.getByRole("button", { name: "维护付款主体", exact: true }).click();
  await expect(page.locator(".t-dialog").filter({ hasText: "维护我方付款主体" })).toBeVisible();

  await page.evaluate(() => {
    history.pushState({}, "", "/零星材料付款/payment-B?tab=current");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByText("LXFK-B", { exact: true })).toBeVisible();
  await expect(page.locator(".t-dialog").filter({ hasText: "维护我方付款主体" })).toBeHidden();
  await expect(page.getByText("页面已切换到另一张付款申请，原操作已停止，请在当前单据重新办理。", { exact: true })).toBeVisible();

  currentTaskMode = "approval";
  await page.goto("/零星材料付款/payment-A?tab=current");
  await page.getByRole("button", { name: "办理审批", exact: true }).click();
  await expect(page.locator(".payment-approval-drawer")).toBeVisible();
  await page.evaluate(() => {
    history.pushState({}, "", "/零星材料付款/payment-B?tab=current");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByText("LXFK-B", { exact: true })).toBeVisible();
  await expect(page.locator(".payment-approval-drawer")).not.toHaveClass(/t-drawer--open/u);
  expect(payerWrites).toBe(0);
  expect(approvalWrites).toBe(0);
});

test("refreshes the completed payer task after a stale shared-role save gets 409", async ({ page }) => {
  await mockLogin(page);
  let detailReads = 0;
  let payerWrites = 0;
  await page.route("**/api/company-entities", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([{
      id: "company-new",
      name: "云南新付款主体有限公司",
      unifiedSocialCreditCode: "91530000TEST000009",
      registeredAddress: null,
      dataStatus: "confirmed",
      isActive: true,
      currentVersionNo: 1,
      createdAt: now,
      updatedAt: now
    }])
  }));
  await page.route("**/api/spot-procurement-payments/payment-payer/payer", (route) => {
    payerWrites += 1;
    return route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        code: "SPOT_PAYMENT_PAYER_TASK_COMPLETED",
        message: "共享任务已经结束"
      })
    });
  });
  await page.route("**/api/spot-procurement-payments/payment-payer", (route) => {
    detailReads += 1;
    const base = paymentDetail();
    const completed = detailReads > 1;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...base,
        payment: {
          ...base.payment,
          id: "payment-payer",
          code: "LXFK-PAYER",
          status: "approval_pending",
          statusLabel: "审批中",
          payerCompanyName: completed ? "其他岗位已选主体" : null,
          payerManagement: {
            visible: true,
            enabled: !completed,
            disabledReason: completed ? "付款主体已确定" : null,
            requiresReapproval: false
          }
        },
        currentTask: completed ? {
          key: "none",
          label: "当前无需办理付款",
          hint: "付款主体已由其他岗位补全",
          priority: 0,
          scope: "none",
          enabled: false,
          disabledReason: "付款主体已确定"
        } : {
          key: "complete_payer",
          label: "待补全主体",
          hint: "共享岗位首位保存者完成任务",
          priority: 350,
          scope: "shared",
          enabled: true,
          disabledReason: null
        },
        availableActions: completed ? [] : [{
          key: "complete_payer",
          label: "维护付款主体",
          kind: "primary",
          enabled: true,
          disabledReason: null
        }]
      })
    });
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Spot@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
  await page.goto("/零星材料付款/payment-payer?tab=current");
  await page.getByRole("button", { name: "维护付款主体", exact: true }).click();
  const dialog = page.locator(".t-dialog").filter({ hasText: "维护我方付款主体" });
  await expect(dialog).toBeVisible();
  await dialog.locator(".t-select").click();
  await page.getByText("云南新付款主体有限公司", { exact: true }).click();
  await dialog.getByRole("checkbox", { name: /银行转账/u }).check();
  await dialog.getByText("我已确认本次付款主体变更及其审批影响", { exact: true }).click();
  await dialog.getByRole("button", { name: "确认变更", exact: true }).click();

  await expect(page.getByText("任务已由其他岗位完成，已刷新最新付款事实。", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "当前无需办理付款", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "维护付款主体", exact: true })).toHaveCount(0);
  await page.locator(".t-tabs").getByText("付款申请", { exact: true }).click();
  await expect(page.locator(".detail-panel").getByText("其他岗位已选主体", { exact: true })).toBeVisible();
  expect(payerWrites).toBe(1);
  expect(detailReads).toBeGreaterThanOrEqual(2);
});

test("keeps the latest spot payment detail and reloads a replacement draft", async ({ page }) => {
  const slowAStarted = deferred();
  const releaseSlowA = deferred();
  let paymentARequests = 0;

  await mockLogin(page);
  await page.route("**/api/spot-procurement-payments/payment-A", async (route) => {
    paymentARequests += 1;
    if (paymentARequests > 1) {
      slowAStarted.resolve();
      await releaseSlowA.promise;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(paymentDetailFor("payment-A", "LXFK-A", []))
    });
  });
  await page.route("**/api/spot-procurement-payments/payment-B", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(paymentDetailFor("payment-B", "LXFK-B", [{
        key: "withdraw_approval",
        label: "撤回付款审批",
        kind: "danger",
        enabled: true,
        disabledReason: null
      }]))
    })
  );
  await page.route("**/api/spot-procurement-payments/payment-new", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(paymentDetailFor("payment-new", "LXFK-NEW", [{
        key: "edit_draft",
        label: "编辑付款草稿",
        kind: "normal",
        enabled: true,
        disabledReason: null
      }]))
    })
  );
  await page.route("**/api/spot-procurement-payments/payment-B/approval-withdrawal", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ newDraftPaymentId: "payment-new" })
    })
  );

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Spot@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
  await page.goto("/零星材料付款/payment-A?tab=current");
  await expect(page.getByText("LXFK-A", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await slowAStarted.promise;
  await page.goto("/零星材料付款/payment-B?tab=current");
  await expect(page.getByText("LXFK-B", { exact: true })).toBeVisible();
  releaseSlowA.resolve();
  await expect(page.getByText("LXFK-B", { exact: true })).toBeVisible();
  await expect(page.getByText("LXFK-A", { exact: true })).toHaveCount(0);

  await page.locator(".t-tabs").getByText("审批进度", { exact: true }).click();
  await page.getByRole("button", { name: "撤回审批", exact: true }).click();
  const dialog = page.locator(".t-dialog").filter({ hasText: "撤回付款审批" });
  await dialog.getByRole("button", { name: "确认撤回", exact: true }).click();
  await expect.poll(() => {
    const url = new URL(page.url());
    return `${decodeURIComponent(url.pathname)}${url.search}`;
  }).toBe("/零星材料付款/payment-new?tab=current");
  await expect(page.getByText("LXFK-NEW", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "编辑 A5 付款草稿", exact: true })).toBeVisible();
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
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
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
  await expect(page.locator(".payment-task-card .business-status-text--neutral")).toHaveCount(1);
  const unknownTaskRow = page.getByRole("row").filter({ hasText: "NEW-ALL" });
  await expect(unknownTaskRow.locator(".business-status-text--neutral")).toHaveCount(1);

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

test("keeps receipt B visible when delayed receipt A reads finish after an SPA route switch", async ({ page }) => {
  const releaseA = deferred();
  let pendingAReads = 0;
  await mockLogin(page);
  await mockReceiptPair(page, receiptDetailFor("procurement-A", "LXCG-A"), {
    delayA: releaseA.promise,
    onARead: () => { pendingAReads += 1; }
  });

  await loginAndOpenReceipt(page);
  await expect.poll(() => pendingAReads).toBe(2);
  await switchReceiptRoute(page, "procurement-B");
  await expect(page.getByRole("heading", { name: "项目B · 最终收货", exact: true })).toBeVisible();
  releaseA.resolve();
  await expect(page.getByRole("heading", { name: "项目B · 最终收货", exact: true })).toBeVisible();
  await expect(page.getByText("LXCG-A", { exact: true })).toHaveCount(0);
});

test("does not bind a delayed receipt photo upload after switching from receipt A to B", async ({ page }) => {
  const uploadStarted = deferred();
  const releaseUpload = deferred();
  let photoBindings = 0;
  await mockLogin(page);
  await mockReceiptPair(page, receiptDetailFor("procurement-A", "LXCG-A", [
    { key: "append_receipt_photo", label: "补充收货照片", kind: "primary", enabled: true, disabledReason: null }
  ]));
  await page.route("**/api/spot-procurements/*/receipt/photos", async (route) => {
    photoBindings += 1;
    await route.fulfill({ contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/files", async (route) => {
    uploadStarted.resolve();
    await releaseUpload.promise;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "uploaded-photo-A" }) });
  });

  await loginAndOpenReceipt(page);
  await expect(page.getByRole("heading", { name: "项目A · 最终收货", exact: true })).toBeVisible();
  await page.locator(".photo-form input[type=file]").setInputFiles({
    name: "现场照片.jpg", mimeType: "image/jpeg", buffer: Buffer.from("receipt-photo")
  });
  await page.getByRole("button", { name: "上传并生成水印", exact: true }).click();
  await uploadStarted.promise;
  await switchReceiptRoute(page, "procurement-B");
  await expect(page.getByRole("heading", { name: "项目B · 最终收货", exact: true })).toBeVisible();
  releaseUpload.resolve();
  await expect(page.getByText("已阻止跨单写入", { exact: true })).toBeVisible();
  await expect.poll(() => photoBindings).toBe(0);
});

test("does not record a delayed refund upload after switching from receipt A to B", async ({ page }) => {
  const uploadStarted = deferred();
  const releaseUpload = deferred();
  let refundWrites = 0;
  const refundReceipt = receiptDetailFor("procurement-A", "LXCG-A", [
    { key: "record_refund", label: "登记退款", kind: "danger", enabled: true, disabledReason: null }
  ], {
    discrepancy: {
      status: "awaiting_refund", resolutionType: "full_refund",
      refundExpectedAmountCents: "44000", nextStep: "待财务登记退款"
    }
  });
  await mockLogin(page, { id: "finance-1", name: "财务甲", roleKeys: ["finance_staff"] });
  await mockReceiptPair(page, refundReceipt);
  await page.route("**/api/spot-procurements/*/refunds", async (route) => {
    refundWrites += 1;
    await route.fulfill({ contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/files", async (route) => {
    uploadStarted.resolve();
    await releaseUpload.promise;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "refund-voucher-A" }) });
  });

  await loginAndOpenReceipt(page);
  await expect(page.getByRole("heading", { name: "项目A · 最终收货", exact: true })).toBeVisible();
  await page.locator(".refund-form input[type=file]").setInputFiles({
    name: "退款凭证.pdf", mimeType: "application/pdf", buffer: Buffer.from("refund-proof")
  });
  await page.getByRole("button", { name: "确认登记退款", exact: true }).click();
  await page.getByRole("button", { name: "确定", exact: true }).click();
  await uploadStarted.promise;
  await switchReceiptRoute(page, "procurement-B");
  await expect(page.getByRole("heading", { name: "项目B · 最终收货", exact: true })).toBeVisible();
  releaseUpload.resolve();
  await expect(page.getByText("已阻止跨单写入", { exact: true })).toBeVisible();
  await expect.poll(() => refundWrites).toBe(0);
});

test("posts frozen spot procurement review coordinates after a fresh preflight", async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await mockLogin(page, {
    id: "material-director-1",
    name: "物资主管甲",
    roleKeys: ["material_director"]
  });
  const requests: Array<{
    procurementId: string;
    method: string;
    body?: unknown;
  }> = [];

  await page.route("**/api/spot-procurements/procurement-review-**", async (route) => {
    const request = route.request();
    const pathName = new URL(request.url()).pathname;
    const segments = pathName.split("/").filter(Boolean);
    const procurementId = segments.at(-1) === "approval"
      ? segments.at(-2) ?? ""
      : segments.at(-1) ?? "";
    requests.push({
      procurementId,
      method: request.method(),
      ...(request.method() === "POST" ? { body: request.postDataJSON() } : {})
    });
    if (request.method() === "POST") {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ id: procurementId, status: "approval_pending" })
      });
    }

    const base = procurementDetail();
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...base,
        procurement: {
          ...base.procurement,
          id: procurementId,
          code: procurementId.endsWith("reject")
            ? "LXCG-REVIEW-REJECT"
            : "LXCG-REVIEW-APPROVE",
          status: "approval_pending",
          statusLabel: "审批中"
        },
        currentVersion: {
          ...base.currentVersion,
          id: `version-${procurementId}`,
          status: "approval_pending",
          statusLabel: "审批中"
        },
        approval: {
          status: "approval_pending",
          statusLabel: "审批中",
          currentNodeName: "物资部主管审批",
          currentRoleKeys: ["material_director"]
        },
        availableActions: [{
          key: "review_approval",
          label: "办理审批",
          kind: "primary",
          enabled: true,
          disabledReason: null
        }],
        reviewApprovalContext: {
          expectedVersionId: `version-${procurementId}`,
          expectedApprovalInstanceId: `approval-${procurementId}`,
          expectedNodeIndex: 0
        },
        primaryAction: "review_approval"
      })
    });
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Spot@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/零星采购/procurement-review-approve");
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(
    "/零星采购/procurement-review-approve"
  );
  await expect(page.locator("#main-content")).not.toBeEmpty();
  await expect(
    page.locator("vite-error-overlay, #webpack-dev-server-client-overlay")
  ).toHaveCount(0);
  await page.getByText("审批与动作", { exact: true }).click();
  await page.getByRole("button", { name: "审批通过", exact: true }).click();
  const approveDialog = page.locator(".t-dialog").filter({ hasText: "确认通过采购审批" });
  await expect(approveDialog).toBeVisible();
  await page.screenshot({
    path: path.join(testInfo.outputDir, "spot-procurement-review-approve-1366x768.png"),
    fullPage: true
  });
  await approveDialog.getByRole("button", { name: "确认通过", exact: true }).click();
  await expect(page.getByText("采购审批已通过。", { exact: true })).toBeVisible();
  await expect.poll(() => requests
    .filter((request) => request.procurementId === "procurement-review-approve")
    .map((request) => request.method)
  ).toEqual(["GET", "GET", "POST", "GET"]);
  expect(requests.find((request) =>
    request.procurementId === "procurement-review-approve" &&
    request.method === "POST"
  )?.body).toEqual({
    decision: "approve",
    expectedVersionId: "version-procurement-review-approve",
    expectedApprovalInstanceId: "approval-procurement-review-approve",
    expectedNodeIndex: 0
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/零星采购/procurement-review-reject");
  expect(decodeURIComponent(new URL(page.url()).pathname)).toBe(
    "/零星采购/procurement-review-reject"
  );
  await expect(page.locator("#main-content")).not.toBeEmpty();
  await page.getByText("审批与动作", { exact: true }).click();
  await page.getByRole("button", { name: "驳回", exact: true }).click();
  const rejectDialog = page.locator(".t-dialog").filter({ hasText: "驳回采购申请" });
  await expect(rejectDialog).toBeVisible();
  await rejectDialog.getByPlaceholder("说明本次操作原因").fill("预算依据需要补充");
  await page.screenshot({
    path: path.join(testInfo.outputDir, "spot-procurement-review-reject-390x844.png"),
    fullPage: true
  });
  await rejectDialog.getByRole("button", { name: "确认驳回", exact: true }).click();
  await expect(page.getByText("采购申请已驳回。", { exact: true })).toBeVisible();
  await expect.poll(() => requests
    .filter((request) => request.procurementId === "procurement-review-reject")
    .map((request) => request.method)
  ).toEqual(["GET", "GET", "POST", "GET"]);
  expect(requests.find((request) =>
    request.procurementId === "procurement-review-reject" &&
    request.method === "POST"
  )?.body).toEqual({
    decision: "reject",
    comment: "预算依据需要补充",
    expectedVersionId: "version-procurement-review-reject",
    expectedApprovalInstanceId: "approval-procurement-review-reject",
    expectedNodeIndex: 0
  });
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("executes server-owned procurement, A5 payment and receipt draft lifecycle actions", async ({ page }) => {
  await mockLogin(page);
  const requests: Array<{ path: string; body: unknown }> = [];
  const procurementFixture = procurementDetail();
  const draftProcurement = {
    ...procurementFixture,
    procurement: {
      ...procurementFixture.procurement,
      status: "draft",
      statusLabel: "草稿"
    },
    currentVersion: {
      ...procurementFixture.currentVersion,
      status: "draft",
      statusLabel: "草稿"
    },
    availableActions: [{
      key: "delete_pristine_draft", label: "删除采购草稿", kind: "danger", enabled: true,
      disabledReason: null, requiresComment: false, requiresPassword: false
    }],
    primaryAction: null,
    receipt: {
      ...receiptSummary,
    workflow: {
      stage: "reset_unsubmitted_receipt",
      stageLabel: "可重置未提交收货",
      resetAction: {
        key: "reset_receipt_draft",
        label: "重置未提交收货",
        enabled: true,
        disabledReason: null,
        expectedRevision: 1
      }
    }
    }
  };
  const paymentFixture = paymentDetail();
  const draftPayment = {
    ...paymentFixture,
    payment: {
      ...paymentFixture.payment,
      status: "draft",
      statusLabel: "付款草稿",
      updatedAt: now
    },
    availableActions: [{
      key: "abandon_payment_draft", label: "放弃付款草稿", kind: "danger", enabled: true,
      disabledReason: null, requiresComment: true, requiresPassword: false
    }],
    primaryAction: null
  };

  await page.route("**/api/spot-procurements/**", async (route) => {
    const request = route.request();
    const pathName = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      requests.push({ path: pathName, body: request.postDataJSON() });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "ok" }) });
    }
    const body = pathName.endsWith("/receipt") ? receiptDetail() : draftProcurement;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/api/spot-procurement-payments/**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET") {
      requests.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "payment-1" }) });
    }
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(draftPayment) });
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Spot@2026");
  await page.getByRole("button", { name: "登录" }).click();

  await page.goto("/零星采购/procurement-1");
  await page.getByText("审批与动作", { exact: true }).click();
  await page.getByRole("button", { name: "删除采购草稿" }).click();
  await page.getByRole("button", { name: "确认删除草稿" }).click();
  await expect.poll(() => requests.some((request) => request.path.endsWith("/procurement-1/abandonment"))).toBe(true);

  await page.goto("/零星材料付款/payment-1");
  await page.getByText("审批进度", { exact: true }).click();
  await page.getByRole("button", { name: "放弃付款草稿" }).click();
  await page.getByPlaceholder("说明本次操作原因").fill("付款对象需要重新确认");
  await page.getByRole("button", { name: "确认放弃付款草稿" }).click();
  await expect.poll(() => requests.some((request) => request.path.endsWith("/payment-1/abandonment"))).toBe(true);

  await page.goto("/零星采购收货/procurement-1");
  await page.getByRole("button", { name: "重置未提交收货" }).click();
  await page.getByRole("button", { name: "确认重置" }).click();
  await expect.poll(() => requests.some((request) => request.path.endsWith("/receipt/draft-reset"))).toBe(true);
  expect(requests).toEqual(expect.arrayContaining([
    expect.objectContaining({ body: { action: "delete_pristine_draft" } }),
    expect.objectContaining({ body: { expectedUpdatedAt: now, reason: "付款对象需要重新确认" } }),
    expect.objectContaining({ body: { expectedRevision: 1 } })
  ]));
});
