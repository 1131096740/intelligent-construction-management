import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  expectHorizontalScrollOwner,
  expectNoDocumentHorizontalOverflow,
  expectNoNestedHorizontalScrollers
} from "./helpers/responsive-assertions";

const governanceViewports = [
  { width: 1512, height: 982 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1180, height: 820 },
  { width: 1024, height: 768 },
  { width: 900, height: 768 }
] as const;

const takeover = {
  id: "takeover-responsive",
  batchNo: "手工补录",
  importRowNo: null,
  contractNo: "XYLH-2026-劳务-001",
  contractName: "劳务分包合同",
  counterparty: "云南富誉建筑劳务有限公司",
  companyEntityId: null,
  companyEntityName: "建工智管公司",
  contractTypeKey: "labor_subcontract",
  amountCents: "3000000",
  paymentTermsOriginalText: "按月结算，归档后付款",
  paymentStages: [],
  invoiceType: null,
  taxMode: "single_rate",
  defaultTaxRatePercent: null,
  taxFactStatus: "unconfirmed",
  taxFactSource: null,
  taxFactExplanation: null,
  taxFactMissingFields: ["发票类型", "默认税率", "清单项目“基础劳务”含税单价"],
  pricingItems: [
    {
      billKey: "main",
      billName: "劳务分包价格清单",
      rowKey: "labor-1",
      itemCode: "LW-001",
      itemName: "基础劳务",
      specification: null,
      unit: "项",
      estimatedQuantity: "1",
      taxInclusiveUnitPrice: null,
      taxRatePercent: null,
      pricingFactStatus: "unconfirmed",
      isProvisional: false,
      settlementBasis: "按现场确认工程量结算"
    }
  ],
  takeoverLevel: "A",
  suggestedTakeoverLevel: "A",
  takeoverLevelAdjustmentReason: null,
  levelRiskText: "A级资料较完整，可作为首批活跃合同接管。",
  paymentBlockingHint: "尚未完成主管确认，后续付款申请会被系统阻断。",
  evidenceGapSummary: "缺少：历史合同扫描件。补齐前会影响主管确认和后续付款核验。",
  takeoverStatus: "draft",
  lifecycleStatus: "in_progress",
  signedAt: "2026-07-13T00:00:00.000Z",
  historicalSettledCents: "0",
  historicalApprovalPendingPaymentCents: "0",
  historicalApprovedPendingPaymentCents: "0",
  historicalPaidCents: "0",
  historicalProxyPaidCents: "0",
  historicalAdvancePaidCents: "0",
  historicalAdvanceDeductedCents: "0",
  historicalRetentionWithheldCents: "0",
  historicalRetentionReleasedCents: "0",
  otherConfirmedOccupancyCents: "0",
  balanceSourceSummary: "项目台账",
  evidenceSummary: "已归档合同",
  takeoverCutoffDate: null,
  responsibleUserId: "contract-director",
  responsibleUserName: "合同负责人",
  reviewComment: null,
  acceptanceConclusion: null,
  submittedAt: null,
  confirmedAt: null as string | null,
  historicalBalanceConfirmedAt: null as string | null,
  changeBaselineConfirmed: false,
  originalBaseAmountCents: null,
  preTakeoverPositiveIncreaseCents: null,
  evidenceChecklist: [
    {
      purpose: "historical_contract_scan",
      purposeLabel: "历史合同扫描件",
      required: true,
      uploaded: false,
      statusLabel: "待补齐",
      riskText: "缺少历史合同扫描件，接管事实无法完整核验。"
    }
  ],
  evidenceFiles: [],
  corrections: [],
  contractSide: null as Record<string, unknown> | null,
  financeSide: null as Record<string, unknown> | null,
  appliedCorrections: [] as Array<Record<string, unknown>>,
  postConfirmationVerification: {
    statusLabel: "未到核验",
    summaryText: "主管确认后再核验接管后的业务闭环。",
    newSettlementCount: 0,
    paymentRequestCount: 0,
    paymentExecutionCount: 0,
    financeRecordCount: 0
  },
  createdAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-13T00:00:00.000Z"
};

const departmentTakeover = {
  ...takeover,
  contractTypeKey: "labor_subcontract",
  contractSide: {
    revision: 2,
    financeBasisRevision: 1,
    signedAt: "2026-07-13T00:00:00.000Z",
    historicalSettledCents: "2000000",
    zeroSettlementDeclared: false,
    performanceStatus: "performing",
    settlementEvidenceSummary: "历史结算台账已由合同部核对",
    settlementEvidenceFileIds: ["file-settlement-ledger"],
    paymentTerms: {
      originalText: "按月结算，归档后付款",
      stages: []
    },
    contractFacts: {
      contractNo: "XYLH-2026-劳务-001",
      contractName: "劳务分包合同",
      contractTypeKey: "labor_subcontract",
      counterparty: "云南富誉建筑劳务有限公司",
      originalAmountCents: "3000000",
      settlementCutoffDate: "2026-07-13",
      zeroSettlementDeclared: false
    },
    confirmedRevision: null as number | null,
    confirmedByUserName: null as string | null,
    confirmedAt: null as string | null,
    updatedAt: "2026-07-18T08:00:00.000Z"
  },
  financeSide: {
    revision: 3,
    basedOnContractRevision: 2,
    basedOnFinanceBasisRevision: 1,
    zeroPaymentDeclared: false,
    excessTreatment: null,
    excessReason: null,
    excessEvidenceFileIds: [],
    payments: [
      {
        id: "historical-payment-1",
        rowKey: "payment-row-1",
        sequenceNo: 1,
        amountCents: "1500000",
        paidAt: "2026-07-10T00:00:00.000Z",
        payerName: "建工智管公司",
        payeeName: "云南富誉建筑劳务有限公司",
        bankReference: "BANK-20260710-001",
        paymentMethod: "银行转账",
        note: null,
        status: "draft",
        voucherFileIds: ["file-payment-voucher-1"],
        allocations: [
          {
            id: "allocation-1",
            allocationType: "historical_settlement",
            amountCents: "1500000",
            allocationOrder: 0
          }
        ]
      }
    ],
    balances: [
      {
        id: "balance-advance-1",
        balanceType: "historical_advance",
        openingCents: "0",
        balanceCents: "0",
        revision: 1,
        entries: []
      }
    ],
    confirmedRevision: null as number | null,
    confirmedContractRevision: null as number | null,
    confirmedFinanceBasisRevision: null as number | null,
    confirmedByUserName: null as string | null,
    confirmedAt: null as string | null,
    updatedAt: "2026-07-18T08:30:00.000Z"
  }
};

const takeoverWithDownloadableEvidence = {
  ...takeover,
  evidenceGapSummary: "历史合同扫描件已补齐。",
  evidenceChecklist: [
    {
      ...takeover.evidenceChecklist[0],
      uploaded: true,
      statusLabel: "已补齐",
      riskText: "历史合同扫描件已归档。"
    }
  ],
  evidenceFiles: [
    {
      recordId: "archive-file-1",
      fileId: "file-downloadable-1",
      fileName: "建工智管-中文上传验收-20260713.pdf",
      purpose: "historical_contract_scan",
      purposeLabel: "历史合同扫描件",
      mimeType: "application/pdf",
      sizeBytes: 58_314,
      uploadedByName: "合同负责人",
      uploadedAt: "2026-07-13T08:16:34.000Z",
      canDownload: true,
      disabledReason: null
    }
  ]
};

const pendingTaxRevision = {
  id: "tax-revision-1",
  revisionNo: 1,
  kind: "supplement",
  status: "pending_finance_review",
  invoiceType: "vat_special",
  taxMode: "single_rate",
  defaultTaxRatePercent: "13",
  source: "business_finance_confirmation",
  confirmationExplanation: "已按原合同签署页和财务台账核对",
  evidenceFileId: null,
  rowFacts: [
    {
      contractBillRowId: "contract-bill-row-1",
      taxInclusiveUnitPrice: "100.00",
      taxRatePercentOverride: null
    }
  ],
  beforeSnapshot: {},
  createdByUserId: "contract-staff-1",
  submittedByUserId: "contract-staff-1",
  submittedAt: "2026-07-17T08:00:00.000Z",
  financeReviewedByUserId: null,
  financeReviewedAt: null,
  financeReviewComment: null,
  confirmedByUserId: null,
  confirmedAt: null,
  contractReviewComment: null,
  createdAt: "2026-07-17T07:30:00.000Z",
  updatedAt: "2026-07-17T08:00:00.000Z"
};

interface TaxReviewMockOptions {
  userId?: string;
  roleKeys?: string[];
  revisions?: Array<Record<string, unknown>>;
  projects?: Array<{ id: string; code: string; name: string }>;
  takeoversByProject?: Record<string, Array<Record<string, unknown>>>;
}

type TakeoverFixture = Record<string, unknown> & Pick<typeof takeover,
  "invoiceType" | "taxMode" | "defaultTaxRatePercent" | "taxFactStatus" |
  "taxFactSource" | "taxFactExplanation">;

async function loginWithMocks(
  page: Page,
  takeoverFixture: TakeoverFixture = takeover,
  options: TaxReviewMockOptions = {}
) {
  const userId = options.userId ?? "contract-director";
  const roleKeys = options.roleKeys ?? ["contract_staff", "contract_director"];
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: userId,
          name: "合同负责人",
          phone: "13900000000",
          mustChangePassword: false,
          roleKeys,
          globalRoleKeys: roleKeys
        },
        tokens: {
          accessToken: "e2e-access-token",
          refreshToken: "e2e-refresh-token",
          expiresIn: 900
        }
      })
    })
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(options.projects ?? [
        { id: "project-1", code: "JGXM-001", name: "响应式验收项目" }
      ])
    })
  );
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
  await page.route("**/api/approval-delegations/user-options", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/projects/*/contract-takeovers**", (route) => {
    const url = new URL(route.request().url());
    const projectId = url.pathname.split("/")[3] ?? "";
    const projectTakeovers = options.takeoversByProject?.[projectId] ?? [takeoverFixture];
    const requestedTakeoverId = url.pathname.match(/\/contract-takeovers\/([^/]+)$/u)?.[1];
    const body = url.pathname.endsWith("/company-entity-candidates")
      ? []
      : url.pathname.endsWith("/tax-fact-revisions")
      ? {
          contractId: "contract-responsive",
          current: {
            invoiceType: takeoverFixture.invoiceType,
            taxMode: takeoverFixture.taxMode,
            defaultTaxRatePercent: takeoverFixture.defaultTaxRatePercent,
            status: takeoverFixture.taxFactStatus,
            source: takeoverFixture.taxFactSource,
            confirmationExplanation: takeoverFixture.taxFactExplanation,
            evidenceFileId: null,
            revision: 0
          },
          rows: [
            {
              contractBillRowId: "contract-bill-row-1",
              billName: "劳务分包价格清单",
              rowKey: "labor-1",
              itemName: "基础劳务",
              specification: null,
              unit: "项",
              taxInclusiveUnitPrice: null,
              taxRatePercent: null,
              taxRateSource: "version_default",
              pricingFactStatus: "unconfirmed"
            }
          ],
          revisions: options.revisions ?? []
        }
      : url.pathname.endsWith("/import-batches")
      ? []
      : requestedTakeoverId
        ? projectTakeovers.find((item) => item.id === requestedTakeoverId) ?? projectTakeovers[0]
        : projectTakeovers;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
}

function collectRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test("历史接管未保存表单在站内离开时要求明确确认", async ({ page }) => {
  await loginWithMocks(page);
  await page.goto("/历史合同接管");
  await page.getByRole("button", { name: "新增接管合同" }).click();
  const nameInput = page.getByText("合同名称").locator("..").getByRole("textbox");
  await nameInput.fill("尚未保存的接管合同");
  await expect(nameInput).toHaveValue("尚未保存的接管合同");
  await nameInput.press("Tab");
  await page.getByText("首页", { exact: true }).click();
  await expect(page.getByText("放弃未保存的接管修改？", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "取消" }).last().click();
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe("/历史合同接管");
  await expect(page.locator('input[value="尚未保存的接管合同"]')).toBeVisible();
});

for (const roleCase of [
  {
    label: "合同员",
    roleKeys: ["contract_staff"],
    contractEditable: true,
    financeEditable: false,
    contractConfirm: false,
    financeConfirm: false
  },
  {
    label: "合同部主管",
    roleKeys: ["contract_director"],
    contractEditable: true,
    financeEditable: false,
    contractConfirm: true,
    financeConfirm: false
  },
  {
    label: "财务人员",
    roleKeys: ["finance_staff"],
    contractEditable: false,
    financeEditable: true,
    contractConfirm: false,
    financeConfirm: false
  },
  {
    label: "财务主管",
    roleKeys: ["finance_director"],
    contractEditable: false,
    financeEditable: true,
    contractConfirm: false,
    financeConfirm: true
  }
] as const) {
  test(`${roleCase.label}只能编辑和确认本部门的历史接管事实`, async ({ page }) => {
    await loginWithMocks(page, departmentTakeover, {
      userId: `${roleCase.label}-1`,
      roleKeys: [...roleCase.roleKeys]
    });
    await page.goto("/历史合同接管");
    await page.locator(".ledger-panel").getByText("详情", { exact: true }).click();

    const contractPanel = page.getByTestId("contract-takeover-contract-side");
    const financePanel = page.getByTestId("contract-takeover-finance-side");
    const confirmation = page.getByTestId("contract-takeover-dual-confirmation");
    const contractName = contractPanel
      .getByText("历史合同名称", { exact: true })
      .locator("..")
      .getByRole("textbox");
    const paymentAmount = financePanel
      .getByText("实付金额（分）", { exact: true })
      .locator("..")
      .getByRole("textbox");

    if (roleCase.contractEditable) {
      await expect(contractName).toBeEnabled();
    } else {
      await expect(contractName).toBeDisabled();
    }
    if (roleCase.financeEditable) {
      await expect(paymentAmount).toBeEnabled();
    } else {
      await expect(paymentAmount).toBeDisabled();
    }
    await expect(
      confirmation.getByRole("button", { name: "确认合同侧" })
    ).toHaveCount(roleCase.contractConfirm ? 1 : 0);
    await expect(
      confirmation.getByRole("button", { name: "确认财务侧" })
    ).toHaveCount(roleCase.financeConfirm ? 1 : 0);
  });
}

test("合同侧与财务侧交错自动保存时互不覆盖 model 和 revision", async ({ page }) => {
  const detail = structuredClone(departmentTakeover);
  const contractBodies: Array<Record<string, unknown>> = [];
  const financeBodies: Array<Record<string, unknown>> = [];
  await loginWithMocks(page, detail, {
    userId: "dual-editor-1",
    roleKeys: ["contract_staff", "finance_staff"]
  });
  await page.route("**/takeover-responsive/contract-side", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    contractBodies.push(body);
    detail.contractSide.revision += 1;
    detail.contractSide.contractFacts =
      body.contractFacts as typeof detail.contractSide.contractFacts;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        takeoverId: detail.id,
        side: "contract",
        revision: detail.contractSide.revision,
        confirmedRevision: null,
        savedAt: new Date().toISOString()
      })
    });
  });
  await page.route("**/takeover-responsive/finance-side", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    financeBodies.push(body);
    detail.financeSide.revision += 1;
    detail.financeSide.payments =
      body.payments as typeof detail.financeSide.payments;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        takeoverId: detail.id,
        side: "finance",
        revision: detail.financeSide.revision,
        confirmedRevision: null,
        savedAt: new Date().toISOString()
      })
    });
  });
  await page.route(
    "**/api/projects/project-1/contract-takeovers/takeover-responsive",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(detail)
      })
  );

  await page.goto("/历史合同接管");
  await page.locator(".ledger-panel").getByText("详情", { exact: true }).click();
  const contractPanel = page.getByTestId("contract-takeover-contract-side");
  const financePanel = page.getByTestId("contract-takeover-finance-side");
  await contractPanel
    .getByText("历史合同名称", { exact: true })
    .locator("..")
    .getByRole("textbox")
    .fill("交错保存后的合同名称");
  await financePanel
    .getByText("收款单位", { exact: true })
    .locator("..")
    .getByRole("textbox")
    .fill("交错保存后的收款单位");
  await page.getByRole("heading", { name: "历史合同接管" }).click();

  await expect.poll(() => contractBodies.length).toBe(1);
  await expect.poll(() => financeBodies.length).toBe(1);
  expect(
    (contractBodies[0].contractFacts as Record<string, unknown>).contractName
  ).toBe("交错保存后的合同名称");
  expect(
    ((financeBodies[0].payments as Array<Record<string, unknown>>)[0]).payeeName
  ).toBe("交错保存后的收款单位");
  expect(contractBodies[0].expectedRevision).toBe(2);
  expect(financeBodies[0].expectedRevision).toBe(3);
});

test("财务 basis 失效时保留输入并在明确重新读取后使用新依据保存", async ({ page }) => {
  const detail = structuredClone(departmentTakeover);
  detail.contractSide.financeBasisRevision = 2;
  const financeBodies: Array<Record<string, unknown>> = [];
  await loginWithMocks(page, detail, {
    userId: "finance-director-1",
    roleKeys: ["finance_director"]
  });
  await page.route("**/takeover-responsive/finance-side", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    financeBodies.push(body);
    detail.financeSide.revision += 1;
    detail.financeSide.basedOnContractRevision =
      body.basedOnContractRevision as number;
    detail.financeSide.basedOnFinanceBasisRevision =
      body.basedOnFinanceBasisRevision as number;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        takeoverId: detail.id,
        side: "finance",
        revision: detail.financeSide.revision,
        confirmedRevision: null,
        savedAt: new Date().toISOString()
      })
    });
  });
  await page.route(
    "**/api/projects/project-1/contract-takeovers/takeover-responsive",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(detail)
      })
  );

  await page.goto("/历史合同接管");
  await page.locator(".ledger-panel").getByText("详情", { exact: true }).click();
  const financePanel = page.getByTestId("contract-takeover-finance-side");
  await expect(
    financePanel.getByText("财务依据已过期，请重新读取并核对", { exact: true })
  ).toBeVisible();
  await financePanel
    .getByText("收款单位", { exact: true })
    .locator("..")
    .getByRole("textbox")
    .fill("保留的财务侧输入");
  await financePanel
    .getByRole("button", { name: "重新读取依据并保留当前输入" })
    .click();

  await expect.poll(() => financeBodies.length).toBe(1);
  expect(financeBodies[0]).toMatchObject({
    expectedRevision: 3,
    basedOnContractRevision: 2,
    basedOnFinanceBasisRevision: 2
  });
  expect(
    ((financeBodies[0].payments as Array<Record<string, unknown>>)[0]).payeeName
  ).toBe("保留的财务侧输入");
});

test("双主管基于同一口径确认后才显示历史接管已激活", async ({ page }) => {
  const detail = structuredClone(departmentTakeover);
  await loginWithMocks(page, detail, {
    userId: "dual-director-1",
    roleKeys: ["contract_director", "finance_director"]
  });
  await page.route(
    "**/api/projects/project-1/contract-takeovers/takeover-responsive",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(detail)
      })
  );
  await page.route("**/contract-side/confirmation", (route) => {
    detail.contractSide.confirmedRevision = detail.contractSide.revision;
    detail.contractSide.confirmedByUserName = "合同部主管";
    detail.contractSide.confirmedAt = new Date().toISOString();
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ confirmed: true, activationStatus: "waiting_finance" })
    });
  });
  await page.route("**/finance-side/confirmation", (route) => {
    detail.financeSide.confirmedRevision = detail.financeSide.revision;
    detail.financeSide.confirmedContractRevision = detail.contractSide.revision;
    detail.financeSide.confirmedFinanceBasisRevision =
      detail.contractSide.financeBasisRevision;
    detail.financeSide.confirmedByUserName = "财务主管";
    detail.financeSide.confirmedAt = new Date().toISOString();
    detail.confirmedAt = new Date().toISOString();
    detail.takeoverStatus = "confirmed";
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ confirmed: true, activationStatus: "activated" })
    });
  });

  await page.goto("/历史合同接管");
  await page.locator(".ledger-panel").getByText("详情", { exact: true }).click();
  const confirmation = page.getByTestId("contract-takeover-dual-confirmation");
  await confirmation.getByRole("button", { name: "确认合同侧" }).click();
  let dialog = page.locator(".t-dialog").filter({ hasText: "确认合同侧当前修订" });
  await dialog.getByPlaceholder("用于确认当前操作者身份").fill("E2e@2026");
  await dialog.getByRole("button", { name: "确认当前修订" }).click();
  await expect(confirmation.getByText("等待双侧确认", { exact: true })).toBeVisible();

  await confirmation.getByRole("button", { name: "确认财务侧" }).click();
  dialog = page.locator(".t-dialog").filter({ hasText: "确认财务侧当前修订" });
  await dialog.getByPlaceholder("用于确认当前操作者身份").fill("E2e@2026");
  await dialog.getByRole("button", { name: "确认当前修订" }).click();
  await expect(confirmation.getByText("已激活", { exact: true })).toBeVisible();
  await expect(
    page.getByTestId("contract-takeover-contract-side")
      .getByText("历史合同名称", { exact: true })
      .locator("..")
      .getByRole("textbox")
  ).toBeDisabled();
});

test("激活后更正展示 before delta after 并由主管复核应用", async ({ page }) => {
  const detail = structuredClone(departmentTakeover);
  detail.confirmedAt = "2026-07-18T10:00:00.000Z";
  detail.takeoverStatus = "confirmed";
  detail.contractSide.confirmedRevision = detail.contractSide.revision;
  detail.financeSide.confirmedRevision = detail.financeSide.revision;
  detail.appliedCorrections = [
    {
      id: "correction-v2-1",
      schemaVersion: 2,
      correctionScope: "historical_settlement",
      correctionOperation: "correction",
      status: "submitted",
      targetRevision: 2,
      targetBalanceRevision: null,
      before: { amountCents: "2000000" },
      delta: { amountCents: "1" },
      after: { amountCents: "2000001" },
      reason: "一分差额核对",
      responsibleUserName: "合同员",
      submittedByName: "合同员",
      submittedAt: "2026-07-18T11:00:00.000Z",
      reviewedByName: null,
      reviewedAt: null,
      reviewComment: null,
      attachmentFileId: "file-correction-1",
      attachmentFileName: "一分差额依据.pdf",
      targetHistoricalPaymentId: null,
      targetAllocationId: null,
      targetBalanceEntryId: null
    }
  ];
  await loginWithMocks(page, detail, {
    userId: "contract-director-1",
    roleKeys: ["contract_director"]
  });
  await page.route(
    "**/api/projects/project-1/contract-takeovers/takeover-responsive",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(detail)
      })
  );
  await page.route("**/corrections/correction-v2-1/review", (route) => {
    detail.appliedCorrections[0].status = "applied";
    detail.appliedCorrections[0].reviewedByName = "合同部主管";
    detail.appliedCorrections[0].reviewedAt = new Date().toISOString();
    detail.appliedCorrections[0].reviewComment =
      (route.request().postDataJSON() as { reviewComment: string }).reviewComment;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ status: "applied" })
    });
  });

  await page.goto("/历史合同接管");
  await page.locator(".ledger-panel").getByText("详情", { exact: true }).click();
  const panel = page.getByTestId("contract-takeover-correction");
  await expect(panel.getByText('改前：{"amountCents":"2000000"}', { exact: true })).toBeVisible();
  await expect(panel.getByText('差额：{"amountCents":"1"}', { exact: true })).toBeVisible();
  await expect(panel.getByText('改后：{"amountCents":"2000001"}', { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "复核并应用" }).click();
  const dialog = page.locator(".t-dialog").filter({ hasText: "复核并应用接管更正" });
  await dialog.getByPlaceholder("说明本次操作原因").fill("主管已核对一分差额");
  await dialog.getByPlaceholder("用于确认当前操作者身份").fill("E2e@2026");
  await dialog.getByRole("button", { name: "确认应用" }).click();
  await expect(panel.getByText("已应用", { exact: true })).toBeVisible();
  await expect(panel.getByText("复核意见：主管已核对一分差额", { exact: true })).toBeVisible();
});

test("双部门工作区在 375px 视口无页面横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loginWithMocks(page, departmentTakeover, {
    userId: "finance-staff-1",
    roleKeys: ["finance_staff"]
  });
  await page.goto("/历史合同接管");
  await page.locator(".ledger-panel").getByText("详情", { exact: true }).click();
  await expect(page.getByTestId("contract-takeover-contract-side")).toBeVisible();
  await expect(page.getByTestId("contract-takeover-finance-side")).toBeVisible();
  await expect(page.getByTestId("contract-takeover-dual-confirmation")).toBeVisible();
  await expectNoDocumentHorizontalOverflow(page);
});

const confirmedTakeoverWithoutChangeBaseline = {
  ...takeover,
  takeoverStatus: "confirmed",
  confirmedAt: "2026-07-17T10:00:00.000Z",
  historicalBalanceConfirmedAt: "2026-07-17T10:00:00.000Z",
  changeBaselineConfirmed: false,
  originalBaseAmountCents: null,
  preTakeoverPositiveIncreaseCents: null
};

test("合同部主管确认历史变更基线时保留失败输入并在成功刷新后冻结入口", async ({ page }) => {
  let frozen = false;
  let requestCount = 0;
  let submittedBody: Record<string, unknown> = {};
  await loginWithMocks(page, confirmedTakeoverWithoutChangeBaseline);
  await page.route(
    "**/api/projects/project-1/contract-takeovers/takeover-responsive/change-baseline-confirmation",
    async (route) => {
      requestCount += 1;
      submittedBody = route.request().postDataJSON() as Record<string, unknown>;
      if (requestCount === 1) {
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ message: "当前密码不正确，请重新输入" })
        });
      }
      frozen = true;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          takeoverId: "takeover-responsive",
          contractVersionId: "contract-version-takeover-responsive",
          changeBaselineConfirmed: true,
          originalBaseAmountCents: submittedBody.originalSignedAmountCents,
          preTakeoverPositiveIncreaseCents: submittedBody.preTakeoverPositiveIncreaseCents
        })
      });
    }
  );
  await page.route("**/api/projects/project-1/contract-takeovers/takeover-responsive", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(frozen ? {
        ...confirmedTakeoverWithoutChangeBaseline,
        changeBaselineConfirmed: true,
        originalBaseAmountCents: "12345678",
        preTakeoverPositiveIncreaseCents: "123456"
      } : confirmedTakeoverWithoutChangeBaseline)
    })
  );

  await page.goto("/历史合同接管");
  await page.locator(".ledger-panel").getByText("详情", { exact: true }).click();
  await expect(page.locator(".detail-panel")).toBeVisible();
  await expect(page.getByText("历史变更基线", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认历史变更基线" }).click();
  const dialog = page.locator(".t-dialog").filter({ hasText: "确认历史变更基线" });
  const amountInputs = dialog.getByRole("textbox");
  await amountInputs.nth(0).fill("123456.78");
  await amountInputs.nth(1).fill("1234.56");
  await dialog.getByPlaceholder("用于确认当前操作者身份").fill("wrong-password");
  await dialog.getByRole("button", { name: "确认并冻结基线" }).click();

  await expect(dialog.getByText("当前密码不正确，请重新输入", { exact: true })).toBeVisible();
  await expect(amountInputs.nth(0)).toHaveValue("123456.78");
  await expect(amountInputs.nth(1)).toHaveValue("1234.56");

  await dialog.getByPlaceholder("用于确认当前操作者身份").fill("E2e@2026");
  await dialog.getByRole("button", { name: "确认并冻结基线" }).click();
  await expect(page.getByText("历史变更基线已一次性确认，后续合同变更将按累计正向增项判断", { exact: true }))
    .toBeVisible();
  await expect(page.getByText("已一次性确认", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "确认历史变更基线" })).toHaveCount(0);
  expect(submittedBody).toEqual({
    originalSignedAmountCents: "12345678",
    preTakeoverPositiveIncreaseCents: "123456",
    currentPassword: "E2e@2026"
  });
});

test("非合同部主管只能查看历史变更基线且没有确认入口", async ({ page }) => {
  await loginWithMocks(page, confirmedTakeoverWithoutChangeBaseline, {
    userId: "finance-director-1",
    roleKeys: ["finance_director"]
  });
  await page.goto("/历史合同接管");
  await page.locator(".ledger-panel").getByText("详情", { exact: true }).click();
  await expect(page.getByText("历史变更基线", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "确认历史变更基线" })).toHaveCount(0);
});

test("延迟的基线确认响应在切换接管合同和项目后都不会污染当前上下文", async ({ page }) => {
  const takeoverTwo = {
    ...confirmedTakeoverWithoutChangeBaseline,
    id: "takeover-two",
    contractNo: "HT-LS-002",
    contractName: "历史劳务合同二"
  };
  const takeoverProjectTwo = {
    ...confirmedTakeoverWithoutChangeBaseline,
    id: "takeover-project-two",
    contractNo: "HT-P2-001",
    contractName: "项目二历史合同"
  };
  const releases: Array<() => void> = [];
  let requestCount = 0;
  await loginWithMocks(page, confirmedTakeoverWithoutChangeBaseline, {
    projects: [
      { id: "project-1", code: "JGXM-001", name: "响应式验收项目" },
      { id: "project-2", code: "JGXM-002", name: "第二验收项目" }
    ],
    takeoversByProject: {
      "project-1": [confirmedTakeoverWithoutChangeBaseline, takeoverTwo],
      "project-2": [takeoverProjectTwo]
    }
  });
  await page.route("**/change-baseline-confirmation", async (route) => {
    requestCount += 1;
    await new Promise<void>((resolve) => releases.push(resolve));
    const takeoverId = new URL(route.request().url()).pathname.split("/").at(-2)!;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        takeoverId,
        contractVersionId: `version-${takeoverId}`,
        changeBaselineConfirmed: true,
        originalBaseAmountCents: body.originalSignedAmountCents,
        preTakeoverPositiveIncreaseCents: body.preTakeoverPositiveIncreaseCents
      })
    });
  });

  await page.goto("/历史合同接管");
  await page.locator(".ledger-panel tr").filter({ hasText: "XYLH-2026-劳务-001" })
    .getByText("详情", { exact: true }).click();
  await page.getByRole("button", { name: "确认历史变更基线" }).click();
  let dialog = page.locator(".t-dialog").filter({ hasText: "确认历史变更基线" });
  await dialog.getByRole("textbox").nth(0).fill("100000.00");
  await dialog.getByRole("textbox").nth(1).fill("0");
  await dialog.getByPlaceholder("用于确认当前操作者身份").fill("E2e@2026");
  await dialog.getByRole("button", { name: "确认并冻结基线" }).click();
  await expect.poll(() => requestCount).toBe(1);

  await page.locator(".ledger-panel tr").filter({ hasText: "HT-LS-002" })
    .getByText("详情", { exact: true }).last()
    .evaluate((element) => (element.closest(".t-link") as HTMLElement | null)?.click());
  releases.shift()?.();
  await expect(page.locator(".detail-panel").getByText("历史劳务合同二", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("历史变更基线已一次性确认", { exact: false })).toHaveCount(0);

  await page.getByRole("button", { name: "确认历史变更基线" }).click();
  dialog = page.locator(".t-dialog").filter({ hasText: "确认历史变更基线" });
  await dialog.getByRole("textbox").nth(0).fill("200000.00");
  await dialog.getByRole("textbox").nth(1).fill("1000.00");
  await dialog.getByPlaceholder("用于确认当前操作者身份").fill("E2e@2026");
  await dialog.getByRole("button", { name: "确认并冻结基线" }).click();
  await expect.poll(() => requestCount).toBe(2);

  await page.locator(".project-picker select").selectOption("project-2", { force: true });
  releases.shift()?.();
  await expect(page.locator(".ledger-panel").getByText("HT-P2-001", { exact: true })).toBeVisible();
  await expect(page.getByText("历史变更基线已一次性确认", { exact: false })).toHaveCount(0);
});

test("keeps takeover details and upload controls inside a 1224px desktop viewport", async ({
  page
}) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 1224, height: 900 });
  await loginWithMocks(page);
  await page.goto("/历史合同接管");
  await page.locator(".ledger-panel").getByText("详情", { exact: true }).click();

  const ledger = page.locator(".ledger-panel");
  const detail = page.locator(".detail-panel");
  await expect(detail.getByText("资料核验", { exact: true })).toBeVisible();

  const [ledgerBox, detailBox] = await Promise.all([ledger.boundingBox(), detail.boundingBox()]);
  expect(ledgerBox).not.toBeNull();
  expect(detailBox).not.toBeNull();
  expect(Math.abs(detailBox!.x - ledgerBox!.x)).toBeLessThanOrEqual(1);
  expect(detailBox!.y).toBeGreaterThan(ledgerBox!.y + ledgerBox!.height);

  await detail.locator(".evidence-uploader").first().locator('input[type="file"]').setInputFiles({
    name: "建工智管-中文上传验收-20260713.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("responsive-uploader-check")
  });

  const uploadButton = detail.getByRole("button", { name: "上传接管资料" });
  await expect(uploadButton).toBeVisible();
  const uploadButtonBox = await uploadButton.boundingBox();
  expect(uploadButtonBox).not.toBeNull();
  expect(uploadButtonBox!.x + uploadButtonBox!.width).toBeLessThanOrEqual(1224);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
  ).toBe(true);
  expect(runtimeErrors).toEqual([]);
});

test("keeps the takeover ledger as the only horizontal scroller across six desktop viewports", async ({
  page
}, testInfo) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await loginWithMocks(page);
  const screenshotDir = process.env.UI_RESPONSIVE_SCREENSHOT_DIR ?? testInfo.outputDir;

  for (const viewport of governanceViewports) {
    await page.setViewportSize(viewport);
    await page.goto("/历史合同接管");
    await expect(page.getByRole("heading", { name: "历史合同接管" })).toBeVisible();
    await page.locator(".ledger-panel").getByText("详情", { exact: true }).click();

    const ledger = page.locator(".ledger-panel");
    const detail = page.locator(".detail-panel");
    const [ledgerBox, detailBox] = await Promise.all([ledger.boundingBox(), detail.boundingBox()]);
    expect(ledgerBox).not.toBeNull();
    expect(detailBox).not.toBeNull();
    if (viewport.width >= 1440) {
      expect(ledgerBox!.x).toBeLessThan(detailBox!.x);
    } else {
      expect(Math.abs(detailBox!.x - ledgerBox!.x)).toBeLessThanOrEqual(1);
      expect(detailBox!.y).toBeGreaterThan(ledgerBox!.y + ledgerBox!.height);
    }

    await expectHorizontalScrollOwner(ledger.locator(".t-table__content"));
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoNestedHorizontalScrollers(page);
    await page.screenshot({
      path: path.join(screenshotDir, `contract-takeover-${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });
  }

  expect(runtimeErrors).toEqual([]);
});

test("keeps takeover evidence controls reachable without a 390px page overflow", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await loginWithMocks(page);
  await page.goto("/历史合同接管");
  await page.locator(".ledger-panel").getByText("详情", { exact: true }).click();

  const detail = page.locator(".detail-panel");
  await detail.locator(".evidence-uploader").first().locator('input[type="file"]').setInputFiles({
    name: "建工智管-中文上传验收-20260713.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("mobile-responsive-uploader-check")
  });

  const uploadButton = detail.getByRole("button", { name: "上传接管资料" });
  await expect(uploadButton).toBeVisible();
  await page.evaluate(() => window.scrollTo({ left: 0, top: window.scrollY }));
  await uploadButton.scrollIntoViewIfNeeded();
  const uploadButtonBox = await uploadButton.boundingBox();
  expect(uploadButtonBox).not.toBeNull();
  expect(uploadButtonBox!.x).toBeGreaterThanOrEqual(-1);
  expect(uploadButtonBox!.x + uploadButtonBox!.width).toBeLessThanOrEqual(390);
  await expectNoDocumentHorizontalOverflow(page);
  expect(runtimeErrors).toEqual([]);
});

test("shows the finance review action only for a pending finance tax revision", async ({
  page
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithMocks(page, takeover, {
    userId: "finance-director-1",
    roleKeys: ["contract_staff", "finance_director"],
    revisions: [pendingTaxRevision]
  });
  await page.goto("/历史合同接管");
  await page.locator(".ledger-panel").getByText("详情", { exact: true }).click();

  const reviewPanel = page.locator(".tax-review-panel");
  await expect(reviewPanel.getByText("待财务复核", { exact: true })).toBeVisible();
  await expect(reviewPanel.getByRole("button", { name: "财务复核" })).toBeVisible();
  await expect(reviewPanel.getByRole("button", { name: "合同部确认" })).toHaveCount(0);
  await expectNoDocumentHorizontalOverflow(page);
  await page.screenshot({
    path: path.join(testInfo.outputDir, "contract-tax-review-pending-finance-1440x900.png"),
    fullPage: true
  });
});

test("shows the contract confirmation action only after finance review passed", async ({
  page
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithMocks(page, takeover, {
    userId: "contract-director",
    roleKeys: ["contract_director"],
    revisions: [
      {
        ...pendingTaxRevision,
        status: "pending_contract_confirmation",
        financeReviewedByUserId: "finance-director-1",
        financeReviewedAt: "2026-07-17T09:00:00.000Z",
        financeReviewComment: "票种、税率和含税单价核对无误",
        updatedAt: "2026-07-17T09:00:00.000Z"
      }
    ]
  });
  await page.goto("/历史合同接管");
  await page.locator(".ledger-panel").getByText("详情", { exact: true }).click();

  const reviewPanel = page.locator(".tax-review-panel");
  await expect(reviewPanel.getByText("待合同部确认", { exact: true })).toBeVisible();
  await expect(reviewPanel.getByRole("button", { name: "合同部确认" })).toBeVisible();
  await expect(reviewPanel.getByRole("button", { name: "财务复核" })).toHaveCount(0);
  await expectNoDocumentHorizontalOverflow(page);
  await page.screenshot({
    path: path.join(testInfo.outputDir, "contract-tax-review-pending-contract-1440x900.png"),
    fullPage: true
  });
});

test("keeps the signed-in session when a sensitive download password is incorrect", async ({
  page
}) => {
  let downloadTicketRequests = 0;
  let refreshRequests = 0;
  await page.route("**/api/files/file-downloadable-1/download-ticket", (route) => {
    downloadTicketRequests += 1;
    return route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ message: "当前密码不正确，请重新输入" })
    });
  });
  await page.route("**/api/auth/refresh", (route) => {
    refreshRequests += 1;
    return route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
  });

  await loginWithMocks(page, takeoverWithDownloadableEvidence);
  await page.goto("/历史合同接管");
  await page.locator(".ledger-panel").getByText("详情", { exact: true }).click();
  const detail = page.locator(".detail-panel");
  await detail.getByPlaceholder("下载前需校验当前登录密码").fill("wrong-password");
  await detail
    .getByPlaceholder("例如：复核历史付款凭证")
    .fill("生产验收：错误密码不应退出登录");
  await detail.getByRole("button", { name: "安全下载资料" }).click();
  await page.getByRole("button", { name: "确认下载", exact: true }).click();

  await expect(page.getByText("当前密码不正确，请重新输入", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/%E5%8E%86%E5%8F%B2%E5%90%88%E5%90%8C%E6%8E%A5%E7%AE%A1$/u);
  await expect(page.getByText("合同负责人 · 合同员、合同部主管", { exact: true })).toBeVisible();
  expect(downloadTicketRequests).toBe(1);
  expect(refreshRequests).toBe(0);
});
