import { expect, test, type Page } from "@playwright/test";

const now = "2026-07-17T08:00:00.000Z";
const unavailable = {
  available: false,
  status: "not_available",
  label: "代码阶段 B 完成后开放"
};
const ticketCoverage = {
  available: true,
  status: "partially_covered",
  label: "尚差 70000 分",
  actualCostCents: "120000",
  normalInvoiceCents: "50000",
  confirmedNoInvoiceCents: "0",
  confirmedExceptionCents: "0",
  effectiveCoveredCents: "50000",
  remainingCents: "70000",
  pendingCount: 0,
  inconsistent: false
};
const ticketLedger = {
  available: true,
  currentCoordinates: {},
  invoices: [],
  allocations: [],
  noInvoiceConfirmations: [],
  invoiceExceptions: []
};
const project = { id: "project-1", code: "XM-001", name: "一号项目" };
const handler = { id: "handler-1", name: "物资员甲" };
const applicant = { id: "applicant-1", name: "申请人甲" };
const approval = {
  status: "approved",
  statusLabel: "审批通过",
  currentNodeName: "审批完成",
  currentRoleKeys: []
};
const paymentComposition = {
  settlementAmountCents: "120000",
  supplierBalanceAmountCents: "20000",
  companyPaymentAmountCents: "100000"
};

async function mockLogin(page: Page) {
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
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
        tokens: {
          accessToken: "spot-e2e-access-token",
          refreshToken: "spot-e2e-refresh-token",
          expiresIn: 900
        }
      })
    })
  );
  await page.route("**/api/me/work-items", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: now,
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
  await page.route("**/api/approval-delegations/user-options", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([project])
    })
  );
  await page.route("**/api/business-parties", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { id: "party-1", name: "昆明建材门市", status: "active" }
      ])
    })
  );
  await page.route("**/api/vat-rate-options", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        { id: "vat-13", label: "13%", rateValue: "0.13", enabled: true }
      ])
    })
  );
}

function procurementListRow() {
  return {
    id: "procurement-1",
    code: "LXCG-E2E-001",
    project,
    supplierPartyId: "party-1",
    supplierName: "昆明建材门市",
    reason: "现场砌筑临时补料",
    applicant,
    handler,
    approvedAmountCents: "120000",
    currentTotalAmountCents: "120000",
    actualCostCents: null,
    actualCost: unavailable,
    invoiceComposition: "invoice",
    payment: {
      paymentCount: 1,
      activeSettlementAmountCents: "120000",
      companyPaymentAmountCents: "100000",
      paidAmountCents: "50000",
      supplierBalanceAmountCents: "20000",
      executedSupplierBalanceAmountCents: "20000",
      canceledAmountCents: "0",
      statusLabel: "部分已付",
      visibilityRestricted: false
    },
    receipt: unavailable,
    invoiceCoverage: ticketCoverage,
    invoiceLedger: ticketLedger,
    status: "approved_in_progress",
    statusLabel: "采购已批，办理中",
    approval,
    createdAt: now,
    updatedAt: now
  };
}

function procurementDetail() {
  return {
    procurement: {
      id: "procurement-1",
      code: "LXCG-E2E-001",
      project,
      supplierPartyId: "party-1",
      supplierName: "昆明建材门市",
      applicant,
      handler,
      status: "approved_in_progress",
      statusLabel: "采购已批，办理中",
      approvedAmountCents: "120000",
      actualCostCents: null,
      actualCost: unavailable,
      closedAt: null,
      voidedAt: null,
      voidReason: null,
      createdAt: now,
      updatedAt: now
    },
    currentVersion: {
      id: "version-1",
      versionNo: 1,
      status: "approved",
      statusLabel: "审批通过",
      reason: "现场砌筑临时补料",
      note: "当天送达",
      supplierPartyId: "party-1",
      supplierName: "昆明建材门市",
      handlerUserId: "handler-1",
      totalAmountCents: "120000",
      changeReason: null,
      changeSummary: null,
      submittedAt: now,
      approvedAt: now,
      createdByUserId: "applicant-1",
      createdAt: now,
      updatedAt: now
    },
    versions: [],
    lines: [
      {
        id: "line-1",
        sortOrder: 1,
        materialName: "免烧砖",
        specification: "240×115×53",
        unit: "块",
        quantity: "1000",
        invoiceMode: "invoice",
        invoiceType: "vat_general",
        vatRateOptionId: "vat-13",
        vatRateValue: "0.13",
        vatRateLabel: "13%",
        unitPrice: "1.2",
        amountCents: "120000",
        usageLocation: "二层砌体",
        note: "免烧砖"
      }
    ],
    invoiceComposition: "invoice",
    attachments: [],
    approval,
    approvalTimeline: [],
    payments: [],
    paymentSummary: {
      paymentCount: 1,
      activeSettlementAmountCents: "120000",
      companyPaymentAmountCents: "100000",
      paidAmountCents: "50000",
      supplierBalanceAmountCents: "20000",
      executedSupplierBalanceAmountCents: "20000",
      canceledAmountCents: "0",
      statusLabel: "部分已付",
      visibilityRestricted: false
    },
    receipt: unavailable,
    invoiceCoverage: ticketCoverage,
    invoiceLedger: ticketLedger,
    discrepancy: unavailable,
    applicationPdf: {
      available: true,
      generated: true,
      businessType: "spot_procurement_version",
      businessId: "version-1",
      disabledReason: null
    },
    availableActions: [],
    primaryAction: null,
    disabledReasons: []
  };
}

function paymentListRow() {
  return {
    id: "payment-1",
    code: "LXFK-E2E-001",
    procurement: {
      id: "procurement-1",
      code: "LXCG-E2E-001",
      supplierName: "昆明建材门市"
    },
    project,
    paymentPath: "supplier_direct",
    paymentPathLabel: "公司直付供应商",
    payeeName: "昆明建材门市",
    ...paymentComposition,
    effectiveCompanyPaymentAmountCents: "100000",
    paidAmountCents: "50000",
    remainingCompanyPaymentAmountCents: "50000",
    executedSupplierBalanceAmountCents: "20000",
    canceledAmountCents: "0",
    status: "partially_paid",
    statusLabel: "部分已付",
    companyPaymentStatusLabel: "部分已付",
    approval,
    handler,
    voucherStatus: "complete",
    voucherStatusLabel: "付款凭证完整",
    paymentFactConsistent: true,
    invoiceCoverage: unavailable,
    createdAt: now,
    updatedAt: now
  };
}

function paymentDetail() {
  return {
    payment: {
      ...paymentListRow(),
      procurementVersionId: "version-1",
      paymentFactConsistent: true,
      voucherStatus: "complete",
      voucherStatusLabel: "付款凭证完整",
      executedSupplierBalanceAmountCents: "20000",
      canceledCompanyPaymentAmountCents: "0",
      canceledSupplierBalanceAmountCents: "0",
      paymentPath: "supplier_direct",
      paymentMethod: "bank_transfer",
      paymentMethodLabel: "银行转账",
      payeeAccountName: "昆明建材门市",
      payeeBankName: "某银行",
      payeeBankAccountLast4: "1234",
      expectedPaymentAt: now,
      paymentNote: "按审批金额付款",
      balanceOverrideReason: null,
      submittedAt: now,
      approvedAt: now,
      invalidatedAt: null,
      invalidatedReason: null
    },
    procurementVersion: procurementDetail().currentVersion,
    approval,
    approvalTimeline: [],
    composition: paymentComposition,
    companyPayment: {
      status: "partially_paid",
      statusLabel: "部分已付",
      approvedAmountCents: "100000",
      paidAmountCents: "50000",
      remainingAmountCents: "50000",
      paymentFactConsistent: true,
      voucherStatus: "complete",
      voucherStatusLabel: "付款凭证完整"
    },
    balanceExecution: {
      requestedAmountCents: "20000",
      executedAmountCents: "20000",
      reservationStatus: "executed"
    },
    executions: [],
    evidenceFiles: [],
    invoiceCoverage: ticketCoverage,
    invoiceLedger: ticketLedger,
    receipt: unavailable,
    paymentPdf: {
      available: true,
      businessType: "spot_procurement_payment",
      businessId: "payment-1",
      disabledReason: null
    },
    availableActions: [],
    primaryAction: null,
    disabledReasons: []
  };
}

test("renders the independent spot procurement, payment and receipt workbenches", async ({
  page
}) => {
  await mockLogin(page);
  await page.route("**/api/spot-procurements**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === "/api/spot-procurements/procurement-1"
        ? procurementDetail()
        : { items: [procurementListRow()], truncated: false, limit: 200 };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body)
    });
  });
  await page.route("**/api/spot-procurement-payments**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === "/api/spot-procurement-payments/payment-1"
        ? paymentDetail()
        : { items: [paymentListRow()], truncated: false, limit: 200 };
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(body)
    });
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Spot@2026");
  await page.getByRole("button", { name: "登录" }).click();

  await page.goto("/零星采购工作台");
  await expect(
    page.getByRole("heading", { name: "零星采购工作台" })
  ).toBeVisible();
  await expect(page.getByText("零星采购", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("LXCG-E2E-001", { exact: true })).toBeVisible();
  await expect(page.getByText("阶段 B 开放").first()).toBeVisible();
  await page.getByText("LXCG-E2E-001", { exact: true }).click();
  await expect(page).toHaveURL(/%E9%9B%B6%E6%98%9F%E9%87%87%E8%B4%AD\/procurement-1/u);
  await expect(
    page.getByRole("heading", { name: "一号项目 · 昆明建材门市" })
  ).toBeVisible();

  await page.goto("/零星材料付款工作台");
  await expect(
    page.getByRole("heading", { name: "零星材料付款工作台" })
  ).toBeVisible();
  for (const label of [
    "结算申请金额",
    "供应商余额抵扣",
    "公司付款申请",
    "公司实际付款"
  ]) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await page.getByText("LXFK-E2E-001", { exact: true }).click();
  await expect(page).toHaveURL(/%E9%9B%B6%E6%98%9F%E6%9D%90%E6%96%99%E4%BB%98%E6%AC%BE\/payment-1/u);
  await expect(
    page.getByRole("heading", { name: "一号项目 · 昆明建材门市" })
  ).toBeVisible();

  await page.goto("/收货确认工作台");
  await expect(
    page.getByRole("heading", { name: "收货确认工作台" })
  ).toBeVisible();
  await expect(page.getByText("LXCG-E2E-001", { exact: true })).toBeVisible();
  await expect(page.getByText("收货草稿", { exact: true })).toBeVisible();
});
