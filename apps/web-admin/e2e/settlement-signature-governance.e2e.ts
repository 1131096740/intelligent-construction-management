import { expect, test, type Page } from "@playwright/test";
import {
  expectHorizontalScrollOwner,
  expectNoDocumentHorizontalOverflow,
  expectNoNestedHorizontalScrollers
} from "./helpers/responsive-assertions";

const viewports = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 900, height: 768 }
] as const;

const draft = {
  id: "draft-1",
  projectId: "project-1",
  contractId: "contract-1",
  contractVersionId: "version-1",
  paymentTermsVersionId: "terms-version-1",
  settlementTemplateVersionId: "template-version-1",
  code: "JS-GOV-001",
  periodLabel: "2026-07",
  isFinal: false,
  finalCumulativeAmountCents: null,
  governanceVersion: 1,
  fieldReviewerUserId: "material-user-1",
  fieldReviewerRoleKey: "material_staff",
  finalScopeCompleted: null,
  finalPriorSettlementsIncluded: null,
  finalNoOutstandingSettlements: null,
  finalWithinContractCap: null,
  finalNoFurtherOrdinarySettlements: null,
  lines: [
    {
      sourceType: "contract_bill_row",
      contractBillRowId: "row-1",
      quantity: "2",
      sortOrder: 1
    }
  ],
  revision: 3,
  status: "draft",
  ownerUserId: "contract-staff-1",
  submittedSettlementId: null,
  submittedAt: null,
  createdAt: "2026-07-18T01:00:00.000Z",
  updatedAt: "2026-07-18T02:00:00.000Z",
  submissionBlockingReason: null,
  documents: {
    frozenDocument: null,
    counterpartySignedOriginal: null
  }
};

test("结算签章治理五步在宽表格外完成且响应式滚动唯一", async ({ page }) => {
  test.setTimeout(60_000);
  const requests = {
    frozen: [] as Array<Record<string, unknown>>,
    linked: [] as Array<Record<string, unknown>>
  };
  await installMocks(page, requests);
  await login(page);
  await page.goto("/结算工作台/新建?draftId=draft-1&project=project-1");

  await expect(page.getByRole("heading", { name: "结算工作台" })).toBeVisible();
  const steps = page.getByRole("list", { name: "结算审批准备步骤" });
  await expect(steps.locator("li strong")).toHaveText([
    "录入结算事实",
    "选择现场复核人",
    "生成冻结结算单",
    "上传乙方签章扫描件",
    "提交审批"
  ]);

  const participant = page.getByLabel("审批参与人与签章文件");
  await expect(participant.getByText("项目现场复核人", { exact: true })).toBeVisible();
  await expect(participant.getByText("冻结结算单与乙方签章原件", { exact: true })).toBeVisible();
  await expect(participant.locator(".table-shell, .jg-table-region")).toHaveCount(0);
  await expect(page.locator(".table-shell")).toHaveCount(1);
  await expect(page.locator(".table-shell").getByText("项目现场复核人", { exact: true })).toHaveCount(0);

  await expect(page.locator(".table-shell .backend-amount")).toHaveText("¥100.00");
  await page.getByRole("button", { name: "生成当前修订版", exact: true }).click();
  await expect(page.getByText("R3 · 2 页", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "下载冻结结算单" })).toBeEnabled();
  await expect(page.getByText(/请下载后交乙方完成线下签章/)).toBeVisible();

  await page.locator(".signed-pdf-panel input[type=file]").setInputFiles({
    name: "乙方签章扫描件.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("stable-mock-pdf")
  });
  await expect(page.getByText("已上传：乙方签章扫描件.pdf", { exact: true })).toBeVisible();
  await page.getByText("扫描件页数、页序与当前冻结版一致", { exact: true }).click();
  await page.getByText("乙方已在所有要求位置签字并填写日期", { exact: true }).click();
  await page.getByText("乙方已逐页盖章", { exact: true }).click();
  await page.getByText("多页文件已加盖骑缝章", { exact: false }).click();
  await page.getByRole("button", { name: "确认关联扫描件" }).click();
  await expect(page.getByText("当前修订版已关联", { exact: true })).toBeVisible();
  await expect(page.getByText(/可以提交审批/)).toBeVisible();
  expect(requests.frozen).toEqual([{ expectedRevision: 3 }]);
  expect(requests.linked).toEqual([{
    expectedRevision: 3,
    frozenDocumentId: "frozen-1",
    uploadedFileId: "file-counterparty-1",
    declaration: {
      pageOrderMatchesFrozenDocument: true,
      counterpartySignedAndDated: true,
      everyPageStamped: true,
      crossPageSealCompleted: true
    }
  }]);

  await page.getByRole("button", { name: "重新生成当前修订版", exact: true }).click();
  await expect(page.getByText("当前修订版已关联", { exact: true })).toBeVisible();
  await page.locator(".signed-pdf-panel input[type=file]").setInputFiles({
    name: "乙方签章替换件.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("replacement-mock-pdf")
  });
  await expect(page.getByText("已上传：乙方签章替换件.pdf", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "确认关联扫描件" })).toBeDisabled();
  await page.getByText("扫描件页数、页序与当前冻结版一致", { exact: true }).click();
  await page.getByText("乙方已在所有要求位置签字并填写日期", { exact: true }).click();
  await page.getByText("乙方已逐页盖章", { exact: true }).click();
  await page.getByText("多页文件已加盖骑缝章", { exact: false }).click();
  await page.getByRole("button", { name: "确认关联扫描件" }).click();
  expect(requests.linked.at(-1)).toMatchObject({
    uploadedFileId: "file-counterparty-2",
    declaration: {
      pageOrderMatchesFrozenDocument: true,
      counterpartySignedAndDated: true,
      everyPageStamped: true,
      crossPageSealCompleted: true
    }
  });

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoNestedHorizontalScrollers(page);
    await expectHorizontalScrollOwner(page.locator(".table-shell .t-table__content"));
    await expect(participant).toBeVisible();
  }
});

test("超过 100 行的结算清单使用多维网格且保留唯一滚动边界", async ({ page }) => {
  test.setTimeout(60_000);
  const requests = {
    frozen: [] as Array<Record<string, unknown>>,
    linked: [] as Array<Record<string, unknown>>
  };
  await installMocks(page, requests, sourceLines(101));
  await login(page);
  await page.goto("/结算工作台/新建?draftId=draft-1&project=project-1");

  await expect(page.getByRole("heading", { name: "结算工作台" })).toBeVisible();
  await expect(page.locator(".settlement-bill-grid revo-grid")).toBeVisible();
  await expect(page.locator(".table-shell .t-table")).toHaveCount(0);
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
});

test("结算详情展示双证据并按后端状态重试与敏感重新生成", async ({ page }) => {
  let generationState: "failed" | "completed" = "failed";
  let retryCalls = 0;
  const regenerationBodies: Array<Record<string, unknown>> = [];
  await installDetailMocks(page, () => governedSettlementDetail(generationState));
  await page.route(
    "**/api/settlements/settlement-governed/signed-document-generation-retry",
    (route) => {
      retryCalls += 1;
      generationState = "completed";
      return route.fulfill({ contentType: "application/json", body: "{}" });
    }
  );
  await page.route(
    "**/api/settlements/settlement-governed/signed-document-regeneration",
    (route) => {
      regenerationBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({ contentType: "application/json", body: "{}" });
    }
  );
  await login(page);
  await page.goto("/结算管理/settlement-governed");
  await page.getByText("凭证资料", { exact: true }).last().click();

  const evidence = page.getByLabel("结算签章证据");
  await expect(evidence.getByText("乙方签章原件", { exact: true })).toBeVisible();
  await expect(evidence.getByText("最终内部签名合成件", { exact: true })).toBeVisible();
  await expect(evidence.getByText("最终签名合成件生成失败", { exact: true })).toBeVisible();
  await evidence.getByRole("button", { name: "重试生成签名合成件" }).click();
  await expect.poll(() => retryCalls).toBe(1);
  await expect(page.getByText("最终件已冻结", { exact: true })).toBeVisible();
  await expect(evidence.getByRole("button", { name: "下载最终内部签名合成件" })).toBeVisible();

  await evidence.getByRole("button", { name: "仅修复渲染问题并重新生成" }).click();
  await expect(page.getByText("仅修复渲染问题并重新生成？", { exact: true })).toBeVisible();
  await expect(page.getByText(/不会改变乙方原件、结算事实或审批结果/)).toBeVisible();
  await page.getByPlaceholder("说明本次操作原因").fill("最终件第 2 页签名显示错位，仅重新渲染");
  await page.getByPlaceholder("用于确认当前操作者身份").fill("Contract@2026");
  await page.getByRole("button", { name: "确认重新生成", exact: true }).click();
  await expect.poll(() => regenerationBodies).toEqual([{
    confirmPureRenderingIssue: true,
    reason: "最终件第 2 页签名显示错位，仅重新渲染",
    confirmationPassword: "Contract@2026"
  }]);
  await expect(page.getByText("操作已提交，结算详情已刷新。", { exact: true })).toBeVisible();
  await evidence.getByRole("button", { name: "确认最终签名合成件归档" }).click();
  await expect(page.getByText("确认结算归档？", { exact: true })).toBeVisible();
});

async function installMocks(
  page: Page,
  requests: {
    frozen: Array<Record<string, unknown>>;
    linked: Array<Record<string, unknown>>;
  },
  source = sourceLines()
) {
  let uploadCount = 0;
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: "contract-staff-1",
        name: "合同经办人",
        phone: "13900000000",
        mustChangePassword: false,
        roleKeys: ["contract_staff"],
        globalRoleKeys: ["contract_staff"]
      },
      tokens: { accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 900 }
    })
  }));
  await page.route("**/api/me/work-items", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      generatedAt: "2026-07-18T02:00:00.000Z",
      visibleProjectCount: 1,
      queues: { pending: [], blocked: [], started: [] },
      approvalCenter: {
        pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: []
      }
    })
  }));
  await page.route("**/api/approval-delegations/user-options", (route) => route.fulfill({
    contentType: "application/json",
    body: "[]"
  }));
  await page.route("**/api/projects", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([{ id: "project-1", code: "P001", name: "科技园项目" }])
  }));
  await page.route("**/api/contracts/settlement-create-options?*", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([{
      contractId: "contract-1",
      contractVersionId: "version-1",
      contractNo: "HT-2026-001",
      contractName: "科技园材料采购合同",
      counterparty: "城建物资公司",
      amountCents: "1000000",
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
      canCreatePayment: false,
      paymentUnavailableReason: "尚无生效结算",
      settlements: []
    }])
  }));
  await page.route("**/api/projects/project-1/settlement-drafts**", (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET" && url.pathname.endsWith("/draft-1")) {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(draft) });
    }
    if (route.request().method() === "GET") {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify([draft]) });
    }
    if (url.pathname.endsWith("/frozen-document")) {
      requests.frozen.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(signedDocument("frozen-1", "file-frozen-1", "frozen_counterparty_copy"))
      });
    }
    if (url.pathname.endsWith("/counterparty-signed-documents")) {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      requests.linked.push(body);
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(signedDocument(
          "counterparty-original-1",
          String(body.uploadedFileId),
          "counterparty_signed_original"
        ))
      });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.route(
    "**/api/settlement-workbench/contract-versions/version-1/participant-options",
    (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        route: "material_mechanical",
        options: [{
          userId: "material-user-1",
          name: "王物资",
          roleKey: "material_staff",
          roleLabel: "物资员"
        }]
      })
    })
  );
  await page.route(
    "**/api/settlement-workbench/contract-versions/version-1/source-lines",
    (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(source) })
  );
  await page.route(
    "**/api/settlement-workbench/projects/project-1/contract-versions/version-1/template-recommendations",
    (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        selectionMode: "automatic",
        selected: {
          templateVersionId: "template-version-1",
          templateName: "材料结算模板",
          templateCode: "SETTLEMENT-MATERIAL",
          versionNo: 1,
          reasons: ["合同类型匹配"]
        },
        choices: [{
          templateVersionId: "template-version-1",
          templateName: "材料结算模板",
          templateCode: "SETTLEMENT-MATERIAL",
          versionNo: 1,
          reasons: ["合同类型匹配"]
        }]
      })
    })
  );
  await page.route(
    "**/api/settlement-workbench/contract-versions/version-1/preview",
    (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        contractVersionId: "version-1",
        amountCents: "10000",
        submissionBlockers: [],
        lines: [{
          sourceType: "contract_bill_row",
          calculationMode: "normal_auto",
          contractBillRowId: "row-1",
          name: "螺纹钢",
          unit: "吨",
          quantity: "2",
          unitPrice: "50.00",
          amountCents: "10000",
          reason: null,
          remark: null,
          sortOrder: 1
        }]
      })
    })
  );
  await page.route("**/api/files", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      id: `file-counterparty-${++uploadCount}`,
      originalName: uploadCount === 1 ? "乙方签章扫描件.pdf" : "乙方签章替换件.pdf"
    })
  }));
}

async function installDetailMocks(page: Page, detail: () => Record<string, unknown>) {
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: "contract-director-1",
        name: "合同部主管",
        phone: "13900000000",
        mustChangePassword: false,
        roleKeys: ["contract_director"],
        globalRoleKeys: ["contract_director"]
      },
      tokens: { accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 900 }
    })
  }));
  await page.route("**/api/me/work-items", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      generatedAt: "2026-07-18T04:00:00.000Z",
      visibleProjectCount: 1,
      queues: { pending: [], blocked: [], started: [] },
      approvalCenter: {
        pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: []
      }
    })
  }));
  await page.route("**/api/approval-delegations/user-options", (route) => route.fulfill({
    contentType: "application/json",
    body: "[]"
  }));
  await page.route("**/api/projects", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify([{ id: "project-1", code: "P001", name: "科技园项目" }])
  }));
  await page.route("**/api/settlements/settlement-governed", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(detail())
  }));
}

function governedSettlementDetail(generationState: "failed" | "completed") {
  const completed = generationState === "completed";
  const evidenceBase = {
    mimeType: "application/pdf",
    sizeBytes: 2048,
    status: "active",
    uploadedByName: "合同员",
    uploadedAt: "2026-07-18T02:00:00.000Z",
    confirmedByName: completed ? "合同部主管" : null,
    confirmedAt: null,
    disabledReason: null
  };
  return {
    id: "settlement-governed",
    settlementId: "settlement-governed",
    title: "JS-GOV-001 · 7月材料结算单",
    meta: [
      {
        label: "当前状态",
        value: completed ? "待归档确认" : "最终结算文件生成失败",
        tone: completed ? "warning" : "danger"
      },
      { label: "关联合同版本", value: "合同 v1" },
      { label: "付款条款版本", value: "v1" },
      { label: "结算期间", value: "2026年7月" },
      { label: "责任部门", value: "合同部" },
      { label: "下一步动作", value: completed ? "合同部主管确认归档" : "重试生成最终件" }
    ],
    baseInfo: [
      { label: "结算编号", value: "JS-GOV-001" },
      { label: "关联合同", value: "HT-2026-001 · 材料采购合同" },
      { label: "结算性质", value: "过程结算" },
      { label: "是否最终结算", value: "否" },
      { label: "结算金额", value: "¥100.00" },
      { label: "创建人", value: "合同员" }
    ],
    taxFactSummary: [],
    effectivenessSteps: [
      { label: "结算审批", status: "已通过", tone: "success" },
      { label: "签字盖章归档上传", status: completed ? "已上传" : "生成失败", tone: completed ? "success" : "danger" },
      { label: "合同部主管确认", status: "待处理", tone: "default" },
      { label: "结算生效", status: "未生效", tone: "default" }
    ],
    archiveResponsibilities: [],
    paymentRules: [],
    settlementLines: [],
    payableCalculation: { items: [], note: "" },
    paymentBlockMessage: "结算尚未生效。",
    archiveFiles: [
      {
        ...evidenceBase,
        recordId: "original-record",
        fileId: "original-file",
        fileName: "乙方签章扫描件.pdf",
        purpose: "乙方签章原件",
        statusLabel: "已冻结",
        canDownload: true,
        purposeKey: "counterparty_signed_original",
        generationStatus: "not_applicable",
        downloadability: "available"
      },
      {
        ...evidenceBase,
        recordId: "final-record",
        fileId: "final-file",
        fileName: "最终内部审批签名合成件.pdf",
        purpose: "最终内部审批签名合成件",
        statusLabel: completed ? "已冻结" : "生成失败",
        canDownload: completed,
        disabledReason: completed ? null : "最终签名合成件生成失败，请重试",
        purposeKey: "final_internal_signed_copy",
        generationStatus: generationState,
        downloadability: completed ? "available" : "unavailable"
      }
    ],
    approvalTimeline: [{
      id: "timeline-1",
      title: "财务主管审批",
      description: "审批通过并冻结签名",
      operator: "财务主管",
      occurredAt: "2026-07-18T01:30:00.000Z",
      status: "completed",
      statusLabel: "已完成",
      tone: "success"
    }],
    availableActions: [
      {
        key: "retry_signed_document_generation",
        label: "重试生成签名合成件",
        kind: "primary",
        enabled: !completed,
        disabledReason: completed ? "最终签名合成件已生成" : null
      },
      {
        key: "confirm_archive",
        label: "确认结算归档",
        kind: "primary",
        enabled: completed,
        disabledReason: completed ? null : "最终签名合成件尚未生成"
      }
    ],
    primaryAction: completed ? "confirm_archive" : "retry_signed_document_generation",
    disabledReasons: [],
    chainLinks: []
  };
}

function signedDocument(id: string, fileId: string, purpose: string) {
  return {
    id,
    settlementDraftId: "draft-1",
    settlementId: null,
    purpose,
    fileId,
    contentSha256: "a".repeat(64),
    pageCount: 2,
    sourceRevision: 3,
    businessSnapshotToken: "b".repeat(64),
    status: "active",
    generationStatus: purpose === "counterparty_signed_original" ? "not_applicable" : "completed",
    createdAt: "2026-07-18T02:00:00.000Z",
    updatedAt: "2026-07-18T02:00:00.000Z"
  };
}

function sourceLines(rowCount = 1) {
  const rows = Array.from({ length: rowCount }, (_unused, index) => ({
    id: `row-${index + 1}`,
    billId: "bill-1",
    billKey: "material",
    billName: "材料清单",
    rowKey: `row-${index + 1}`,
    sortOrder: index + 1,
    itemCode: `CL-${String(index + 1).padStart(3, "0")}`,
    itemName: index === 0 ? "螺纹钢" : `材料 ${index + 1}`,
    specification: "HRB400",
    unit: "吨",
    quantity: "10",
    unitPrice: "50.00",
    taxRatePercent: "13",
    taxExclusiveUnitPrice: "44.25",
    pricingFactStatus: "confirmed",
    calculationAvailable: true,
    submissionBlocker: null,
    amountRole: "included",
    pricingMode: "tax_inclusive",
    calculationMode: "normal_auto",
    contractAmountCents: "50000",
    settledQuantity: "0",
    previousSettledQuantity: "0",
    remainingQuantity: "10",
    settledAmountCents: "0",
    remainingAmountCents: "50000",
    provisional: false,
    settlementBasis: null,
    exception: null,
    exceptions: []
  }));
  return {
    contractVersionId: "version-1",
    contractId: "contract-1",
    projectId: "project-1",
    contractAmountCents: "1000000",
    summary: {
      rowCount: 1,
      exceptionCount: 0,
      contractAmountCents: "1000000",
      settledAmountCents: "0",
      remainingAmountCents: "1000000"
    },
    rows
  };
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
}
