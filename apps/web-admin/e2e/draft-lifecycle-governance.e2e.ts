import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  expectNoDocumentHorizontalOverflow,
  expectNoNestedHorizontalScrollers
} from "./helpers/responsive-assertions";

const savedAt = "2026-07-19T08:30:00.000Z";
const viewports = [
  { width: 1512, height: 982 },
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1180, height: 820 },
  { width: 1024, height: 768 },
  { width: 900, height: 768 }
] as const;

async function installSession(page: Page) {
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: "draft-governance-user",
        name: "生命周期验收用户",
        phone: "13900000000",
        mustChangePassword: false,
        roleKeys: ["contract_director", "contract_staff", "finance_staff", "material_staff"],
        globalRoleKeys: ["contract_director", "finance_staff"]
      },
      tokens: { accessToken: "draft-governance-access", refreshToken: "draft-governance-refresh", expiresIn: 900 }
    })
  }));
  await page.route("**/api/me/work-items", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      generatedAt: savedAt,
      visibleProjectCount: 1,
      queues: { pending: [], blocked: [], started: [] },
      approvalCenter: { pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: [] }
    })
  }));
  await page.route("**/api/approval-delegations/user-options", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000000");
  await page.getByPlaceholder("请输入密码").fill("Draft@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
}

function paymentRow(view: "formal_ledger" | "returned_for_revision" | "ended") {
  const ended = view === "ended";
  return {
    id: ended ? "FK-END-001" : view === "returned_for_revision" ? "FK-RETURN-001" : "FK-FORMAL-001",
    paymentNo: ended ? "FK-END-001" : view === "returned_for_revision" ? "FK-RETURN-001" : "FK-FORMAL-001",
    contractNo: "HT-2026-001 · 材料采购合同",
    settlementNo: "JS-2026-001",
    project: "一号项目",
    requestedAmount: "¥10,000.00",
    approvalStatus: ended ? "已放弃" : view === "returned_for_revision" ? "已退回" : "审批中",
    approvalTone: ended ? "default" : "warning",
    paymentStatus: "未实付",
    paymentTone: "default",
    currentNode: ended ? "流程已结束" : "申请人修改",
    ownerDepartment: "财务部",
    pendingOwner: ended ? "—" : "生命周期验收用户",
    stalledFor: "1 小时",
    returnReason: view === "returned_for_revision" ? "请补充付款用途" : "—",
    nextAction: ended ? "查看历史" : "继续办理",
    updatedAt: "07-19 16:30",
    lifecycleKind: view === "formal_ledger" ? "formal_record" : "approval_draft",
    ledgerView: view,
    lifecycleUpdatedAt: savedAt,
    requestedAmountCents: "1000000",
    paidAmountCents: "0",
    availableActions: view === "returned_for_revision" ? ["abandon_application"] : [],
    blockedReasons: []
  };
}

function paymentLedger(view: string) {
  const rows = view === "my_drafts" ? [] : [paymentRow(view as "formal_ledger" | "returned_for_revision" | "ended")];
  return {
    rows,
    view,
    hasPersistentDraft: false,
    pagination: { page: 1, pageSize: 20, total: rows.length, totalPages: rows.length ? 1 : 0 },
    viewCounts: { formal_ledger: 1, my_drafts: 0, returned_for_revision: 1, ended: 1 },
    statistics: {
      formalRequestedAmountCents: "1000000",
      formalPaidAmountCents: "0",
      pendingApproval: 1,
      pendingPayment: 0,
      paid: 0
    }
  };
}

function returnedPaymentDetail(abandoned = false) {
  return {
    id: "FK-RETURN-001",
    title: abandoned ? "FK-RETURN-001 · 已放弃付款申请" : "FK-RETURN-001 · 退回待修改付款申请",
    lifecycleKind: abandoned ? "ended" : "approval_draft",
    ledgerView: abandoned ? "ended" : "returned_for_revision",
    lifecycleUpdatedAt: savedAt,
    meta: [
      { label: "审批状态", value: abandoned ? "已放弃" : "已退回", tone: abandoned ? "default" : "warning" },
      { label: "实付状态", value: "未实付" },
      { label: "当前节点", value: "申请人修改" },
      { label: "下一步动作", value: "修改后重新提交" }
    ],
    baseInfo: [
      { label: "付款编号", value: "FK-RETURN-001" },
      { label: "申请金额", value: "¥10,000.00" },
      { label: "申请人", value: "生命周期验收用户" }
    ],
    approvalSteps: [],
    executionSteps: [],
    executionAllocations: [],
    executionCoverages: [],
    evidenceFiles: [],
    approvalTimeline: [],
    availableActions: abandoned ? [] : [
      {
        key: "abandon_application",
        label: "放弃申请",
        kind: "danger",
        enabled: true,
        disabledReason: null,
        requiresComment: true
      },
      {
        key: "delete_pristine_draft",
        label: "删除草稿",
        kind: "danger",
        enabled: false,
        disabledReason: "已形成审批历史，不能按纯净草稿删除"
      }
    ],
    primaryAction: null,
    disabledReasons: [],
    blockedReasons: ["已形成审批历史，不能按纯净草稿删除"],
    traceRules: ["放弃申请保留审批、附件和操作历史"],
    executionBlockMessage: "当前申请尚未审批通过，不能登记实付。",
    chainLinks: []
  };
}

test("付款生命周期视图隔离已放弃记录，并以保存时间执行 CAS 放弃", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await installSession(page);
  let abandonBody: Record<string, unknown> | null = null;
  let abandoned = false;
  await page.route("**/api/payments/FK-RETURN-001/abandonment", (route) => {
    abandonBody = route.request().postDataJSON() as Record<string, unknown>;
    abandoned = true;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "FK-RETURN-001", status: "abandoned" }) });
  });
  await page.route("**/api/payments/FK-RETURN-001", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(returnedPaymentDetail(abandoned)) })
  );
  await page.route("**/api/payments?*", (route) => {
    const view = new URL(route.request().url()).searchParams.get("view") ?? "formal_ledger";
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(paymentLedger(view)) });
  });
  await login(page);

  await page.goto("/付款管理?view=my_drafts");
  await expect(page.getByText("付款申请不保存服务端草稿", { exact: true })).toBeVisible();
  await expect(page.getByText("FK-END-001", { exact: true })).toHaveCount(0);
  await expect(page.getByText("当前条件下暂无付款记录", { exact: true })).toBeVisible();

  await page.getByText("已结束 1", { exact: true }).click();
  await expect(page.getByText("FK-END-001", { exact: true })).toBeVisible();
  await expect(page.getByText("FK-RETURN-001", { exact: true })).toHaveCount(0);

  const screenshotDir = process.env.UI_RESPONSIVE_SCREENSHOT_DIR ?? testInfo.outputDir;
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expectNoDocumentHorizontalOverflow(page);
    await expectNoNestedHorizontalScrollers(page);
    await page.screenshot({
      path: path.join(screenshotDir, `draft-lifecycle-payment-ended-${viewport.width}x${viewport.height}.png`),
      fullPage: true
    });
  }

  await page.goto("/付款管理/FK-RETURN-001");
  await page.getByText("流程", { exact: true }).click();
  await expect(page.getByRole("button", { name: "删除草稿" })).toHaveCount(0);
  await expect(page.getByText("已形成审批历史，不能按纯净草稿删除", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "放弃申请" }).click();
  await page.getByPlaceholder("说明本次操作原因").fill("业务人员确认不再继续办理");
  await page.getByRole("button", { name: "确认放弃申请" }).click();
  await expect.poll(() => abandonBody).toEqual({
    expectedUpdatedAt: savedAt,
    reason: "业务人员确认不再继续办理"
  });
  await expect(page.getByText("操作已提交，付款详情已刷新。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "放弃申请" })).toHaveCount(0);
});

function settlementTemplateDetail(discarded = false) {
  return {
    template: {
      id: "settlement-template-draft",
      name: "材料月度结算模板",
      code: "SETTLEMENT-MATERIAL-DRAFT",
      createdAt: savedAt,
      updatedAt: savedAt
    },
    versions: [{
      id: "settlement-template-version-draft",
      settlementTemplateId: "settlement-template-draft",
      versionNo: 1,
      status: discarded ? "discarded" : "draft",
      draftRevision: 7,
      compatibleContractTypeKeys: ["material_purchase"],
      compatibleAmountRoles: ["included"],
      compatiblePricingModes: ["tax_inclusive"],
      columnSchema: { sheetName: "结算明细" },
      printRules: {},
      evidenceRules: {},
      anomalyRules: {},
      inspectionReport: null,
      inspectionRevision: null,
      hasSourceXlsx: true,
      hasPreviewXlsx: false,
      hasPreviewPdf: false,
      changeSummary: null,
      publishedAt: null,
      stoppedAt: null,
      createdAt: savedAt,
      updatedAt: savedAt,
      availableActions: discarded ? [] : [{
        key: "discard_version",
        label: "废弃版本",
        kind: "danger",
        enabled: true,
        disabledReason: null
      }],
      blockedReasons: discarded ? ["草稿版本已废弃"] : []
    }]
  };
}

test("结算模板只废弃未提交草稿版本且请求携带修订号", async ({ page }, testInfo) => {
  await installSession(page);
  let discarded = false;
  let discardBody: Record<string, unknown> | null = null;
  await page.route("**/api/settlement-templates/settlement-template-draft?*", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(settlementTemplateDetail(discarded)) })
  );
  await page.route("**/api/settlement-template-versions/settlement-template-version-draft/discard", (route) => {
    discardBody = route.request().postDataJSON() as Record<string, unknown>;
    discarded = true;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "settlement-template-version-draft", status: "discarded" }) });
  });
  await login(page);
  await page.goto("/结算模板库/settlement-template-draft");
  await expect(page.getByRole("heading", { name: "结算模板治理" })).toBeVisible();
  await expect(page.getByRole("button", { name: "废弃版本" })).toBeVisible();
  await page.getByRole("button", { name: "废弃版本" }).click();
  await page.getByRole("button", { name: "确认废弃版本" }).click();
  await expect.poll(() => discardBody).toEqual({ reason: "", expectedRevision: 7 });
  await expect(page.getByRole("button", { name: "废弃版本" })).toHaveCount(0);

  await page.setViewportSize({ width: 900, height: 768 });
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
  await page.screenshot({
    path: path.join(process.env.UI_RESPONSIVE_SCREENSHOT_DIR ?? testInfo.outputDir, "draft-lifecycle-template-discarded-900x768.png"),
    fullPage: true
  });
});

test("合同业务模板保护未保存修改并废弃当前草稿版本", async ({ page }) => {
  await installSession(page);
  let discarded = false;
  let discardBody: Record<string, unknown> | null = null;
  const detail = () => ({
    template: {
      id: "business-template-draft", code: "TPL-DRAFT", businessCode: "YW-TPL-DRAFT",
      name: "材料采购模板", contractTypeKey: "material_purchase", status: "draft"
    },
    versions: [{
      id: "business-template-version-draft", templateId: "business-template-draft", versionNo: 1,
      status: discarded ? "discarded" : "draft", changeSummary: "", createdAt: savedAt, updatedAt: savedAt,
      schema: { fields: [], bills: [], clauses: [], attachments: [], validations: [] },
      availableActions: discarded ? [] : [{ key: "discard_version", label: "废弃版本", kind: "danger", enabled: true, disabledReason: null }],
      blockedReasons: discarded ? ["草稿版本已废弃"] : []
    }]
  });
  await page.route("**/api/contract-templates/business-template-draft?includeHistory=true", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(detail()) })
  );
  await page.route("**/api/contract-template-versions/business-template-version-draft/discard", (route) => {
    discardBody = route.request().postDataJSON() as Record<string, unknown>;
    discarded = true;
    return route.fulfill({ contentType: "application/json", body: "{}" });
  });
  await login(page);
  await page.goto("/合同模板库/business-template-draft");
  await page.getByText("新增字段", { exact: true }).click();
  await page.getByText("首页", { exact: true }).click();
  await expect(page.getByText("放弃未保存的模板修改？", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe(
    "/合同模板库/business-template-draft"
  );
  await page.getByRole("button", { name: "废弃版本" }).click();
  await page.getByRole("button", { name: "确认废弃版本" }).click();
  await expect.poll(() => discardBody).toEqual({ reason: "", expectedUpdatedAt: savedAt });
  await expect(page.getByRole("button", { name: "废弃版本" })).toHaveCount(0);
});

test("合同版式模板废弃使用服务端修订号并刷新版本状态", async ({ page }) => {
  await installSession(page);
  let discarded = false;
  let discardBody: Record<string, unknown> | null = null;
  const detail = () => ({
    template: { id: "layout-draft", name: "材料合同版式", contractTypeKey: "material_purchase" },
    versions: [{
      id: "layout-version-draft", layoutTemplateId: "layout-draft", versionNo: 1,
      status: discarded ? "discarded" : "draft", docxFileId: "docx-1", placeholderSchema: {},
      draftRevision: 4, inspectionReport: null, inspectionRevision: null, latestPreview: null,
      createdAt: savedAt, updatedAt: savedAt,
      availableActions: discarded ? [] : [{ key: "discard_version", label: "废弃版本", kind: "danger", enabled: true, disabledReason: null }],
      blockedReasons: discarded ? ["草稿版本已废弃"] : []
    }]
  });
  await page.route("**/api/contract-layout-templates/layout-draft?includeHistory=true", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(detail()) })
  );
  await page.route("**/api/contract-layout-template-versions/layout-version-draft/discard", (route) => {
    discardBody = route.request().postDataJSON() as Record<string, unknown>;
    discarded = true;
    return route.fulfill({ contentType: "application/json", body: "{}" });
  });
  await login(page);
  await page.goto("/合同模板库/版式/layout-draft");
  await page.getByRole("button", { name: "废弃版本" }).click();
  await page.getByRole("button", { name: "确认废弃版本" }).click();
  await expect.poll(() => discardBody).toEqual({ reason: "", expectedRevision: 4 });
  await expect(page.getByRole("button", { name: "废弃版本" })).toHaveCount(0);
});

test("标准条款模板废弃使用保存时间并保留历史行", async ({ page }) => {
  await installSession(page);
  let discarded = false;
  let discardBody: Record<string, unknown> | null = null;
  const history = () => [{
    id: "clause-draft", code: "CLAUSE-DRAFT", category: "付款", name: "付款条款",
    versions: [{
      id: "clause-version-draft", clauseId: "clause-draft", versionNo: 1,
      status: discarded ? "discarded" : "draft", title: "付款方式", content: { text: "按合同约定支付" },
      createdAt: savedAt, updatedAt: savedAt,
      availableActions: discarded ? [] : [{ key: "discard_version", label: "废弃版本", kind: "danger", enabled: true, disabledReason: null }],
      blockedReasons: discarded ? ["草稿版本已废弃"] : []
    }]
  }];
  await page.route("**/api/standard-clauses", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/standard-clauses/history*", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(history()) })
  );
  await page.route("**/api/standard-clause-versions/clause-version-draft/discard", (route) => {
    discardBody = route.request().postDataJSON() as Record<string, unknown>;
    discarded = true;
    return route.fulfill({ contentType: "application/json", body: "{}" });
  });
  await login(page);
  await page.goto("/合同模板库/标准条款");
  await page.getByText("治理版本", { exact: true }).click();
  await page.getByRole("button", { name: "废弃版本" }).click();
  await page.getByRole("button", { name: "确认废弃版本" }).click();
  await expect.poll(() => discardBody).toEqual({ reason: "", expectedUpdatedAt: savedAt });
  await expect(page.getByText("已废弃", { exact: true })).toBeVisible();
});

test("项目支出作废成功后刷新详情并移除重复动作", async ({ page }) => {
  await installSession(page);
  let voided = false;
  let voidBody: Record<string, unknown> | null = null;
  const detail = () => ({
    id: "expense-lifecycle", projectId: "project-1", code: "ZC-DRAFT-001",
    title: "项目临时支出", status: voided ? "voided" : "approval_pending",
    statusLabel: voided ? "已作废" : "审批中", expenseTypeLabel: "现场零星采购",
    expenseSubtypeLabel: "材料", paymentSubject: "临时材料", reason: "现场急需",
    requestedAmountCents: "120000", approvedAmountCents: null, currentNodeName: voided ? "流程已结束" : "财务审核",
    lifecycleKind: voided ? "ended" : "approval_draft", lifecycleUpdatedAt: savedAt,
    availableActions: voided ? [] : [{
      key: "void", label: "作废支出单", kind: "danger", enabled: true,
      disabledReason: null, requiresComment: true
    }],
    blockedReasons: [], canSetApprovedAmount: false,
    reviewAction: { key: "review", label: "审批", kind: "primary", enabled: false, disabledReason: "当前状态不能审批" },
    approvalTimeline: []
  });
  await page.route("**/api/projects/project-1/expense-requests/expense-lifecycle/approval-detail", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(detail()) })
  );
  await page.route("**/api/projects/project-1/expense-requests/expense-lifecycle/voiding", (route) => {
    voidBody = route.request().postDataJSON() as Record<string, unknown>;
    voided = true;
    return route.fulfill({ contentType: "application/json", body: "{}" });
  });
  await login(page);
  await page.goto("/项目支出/project-1/expense-lifecycle");
  await page.getByRole("button", { name: "作废支出单" }).click();
  await page.getByPlaceholder("说明本次操作原因").fill("重复申请，确认终止");
  await page.getByRole("button", { name: "确认作废" }).click();
  await expect.poll(() => voidBody).toEqual({ reason: "重复申请，确认终止" });
  await expect(page.getByText("已作废", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "作废支出单" })).toHaveCount(0);
});

test("合同工作台丢弃未保存修改后直接删除服务端草稿", async ({ page }) => {
  await installSession(page);
  let saveCalls = 0;
  let abandonBody: Record<string, unknown> | null = null;
  await page.route("**/api/projects/contract-create-options", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-number-rules", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-templates*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-layout-templates*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/company-entities?*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-workbench/version-delete/negotiation-rounds", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-workbench/version-delete", (route) => {
    saveCalls += 1;
    return route.fulfill({ contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/contracts/version-delete/abandonment", (route) => {
    abandonBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        contractVersionId: "version-delete",
        status: "abandoned",
        lifecycleKind: "pristine_draft",
        action: "delete_pristine_draft",
        abandonedAt: savedAt,
        abandonedByUserId: "draft-governance-user",
        reason: null,
        idempotent: false
      })
    });
  });
  await page.route("**/api/contract-workbench/contract-delete", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      lifecycleKind: "pristine_draft",
      availableLifecycleActions: ["delete_pristine_draft"],
      availableActions: [{
        key: "delete_pristine_draft",
        label: "删除草稿",
        kind: "danger",
        enabled: true,
        disabledReason: null,
        requiresComment: false
      }],
      lifecycleBlockers: [],
      lifecycleUpdatedAt: savedAt,
      expectedDraftRevision: 7,
      contract: {
        id: "contract-delete",
        temporaryCode: "草稿-20260720-0001",
        code: null,
        projectId: "project-1",
        contractTypeKey: "material_purchase",
        ownerUserId: "draft-governance-user",
        name: "待删除材料采购合同"
      },
      version: {
        id: "version-delete",
        versionNo: 1,
        status: "draft",
        changeType: "original",
        draftRevision: 7,
        amountCents: "0",
        pricingNature: "fixed_total",
        amountSource: "manual",
        taxFacts: {
          invoiceType: "vat_special",
          taxMode: "single_rate",
          defaultTaxRatePercent: "3",
          status: "draft",
          source: "contract_document",
          revision: 1,
          frozenAt: null
        },
        draftData: { contractName: "待删除材料采购合同" },
        clauseSnapshot: [],
        templateSnapshot: {
          fieldSchema: [{ key: "deliveryDeadline", label: "交货期限", type: "date", required: true }],
          billSchema: [],
          clauseSchema: [],
          attachmentSchema: [],
          validationSchema: []
        }
      },
      parties: [],
      bills: [],
      paymentTerms: { originalText: "", stages: [] },
      checkpoints: [],
      documents: [],
      readiness: { ready: false, blockingMessages: [], warningMessages: [] }
    })
  }));
  await page.route("**/api/contracts/workbench?*", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      rows: [],
      summary: { pending_action: 0, my_drafts: 0, in_approval: 0, pending_seal: 0, pending_archive: 0, effective: 0, all: 1 },
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 }
    })
  }));

  await login(page);
  await page.goto("/contracts/contract-delete/workbench");
  await page.getByText("信息", { exact: true }).click();
  await page.getByPlaceholder("请输入合同名称").fill("不会保存的本地修改");
  await expect(page.getByRole("button", { name: "删除草稿" })).toBeVisible();
  await page.getByRole("button", { name: "删除草稿" }).click();
  await page.getByRole("button", { name: "确认删除草稿" }).click();

  await expect.poll(() => abandonBody).toEqual({
    expectedRevision: 7,
    action: "delete_pristine_draft"
  });
  expect(saveCalls).toBe(0);
  await expect
    .poll(() => decodeURIComponent(new URL(page.url()).pathname + new URL(page.url()).search))
    .toBe("/合同工作台?view=all");
});

test("合同已放弃记录可携带保存时间复制为全新草稿", async ({ page }, testInfo) => {
  await installSession(page);
  let copyBody: Record<string, unknown> | null = null;
  await page.route("**/api/contracts/contract-version-abandoned-1/copies", (route) => {
    copyBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ contract: { id: "contract-copy-1" }, version: { id: "contract-version-copy-1" } })
    });
  });
  await page.route("**/api/contracts/workbench?*", (route) => {
    const view = new URL(route.request().url()).searchParams.get("view") ?? "all";
    const endedRows = view === "all" ? [{
      id: "contract-abandoned-1",
      contractVersionId: "contract-version-abandoned-1",
      contractNo: "HT-END-001",
      name: "已放弃材料采购合同",
      project: "一号项目",
      counterparty: "示例供应商",
      amount: "¥0.00",
      version: "v1",
      currentNode: "流程已结束",
      nodeTone: "default",
      ownerDepartment: "合同部",
      pendingOwner: "—",
      stalledFor: "—",
      returnReason: "—",
      nextAction: "查看历史",
      updatedAt: "2026-07-19",
      lifecycleKind: "approval_draft",
      draftRevision: 3,
      lifecycleUpdatedAt: savedAt,
      abandonedAt: savedAt,
      abandonReason: "供应计划取消",
      copyAvailable: true
    }] : [];
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        rows: endedRows,
        summary: { pending_action: 0, my_drafts: 0, in_approval: 0, pending_seal: 0, pending_archive: 0, effective: 0, all: 1 },
        meta: { page: 1, pageSize: 20, total: endedRows.length, totalPages: endedRows.length ? 1 : 0 }
      })
    });
  });
  await login(page);
  await page.goto("/合同工作台?view=all");
  await expect(page.getByText("HT-END-001", { exact: true })).toBeVisible();
  await expect(page.getByText("供应计划取消", { exact: true })).toBeVisible();
  await expect(page.getByText("复制为新草稿", { exact: true })).toBeVisible();
  await expect(page.getByText("进入工作台", { exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 900, height: 768 });
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
  await page.screenshot({
    path: path.join(process.env.UI_RESPONSIVE_SCREENSHOT_DIR ?? testInfo.outputDir, "draft-lifecycle-contract-ended-900x768.png"),
    fullPage: true
  });

  await page.getByText("复制为新草稿", { exact: true }).click();
  await expect.poll(() => copyBody).toEqual({ expectedUpdatedAt: savedAt });
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname + new URL(page.url()).search))
    .toBe("/合同工作台/contract-copy-1?versionId=contract-version-copy-1");
});

test("结算已放弃记录可携带保存时间复制为全新草稿", async ({ page }) => {
  await installSession(page);
  let copyBody: Record<string, unknown> | null = null;
  await page.route("**/api/projects/project-1/settlement-drafts/settlement-draft-abandoned-1/copies", (route) => {
    copyBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ id: "settlement-draft-copy-1" })
    });
  });
  await page.route("**/api/settlements/lifecycle-ledger?*", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      rows: [{
        id: "settlement-draft-abandoned-1",
        projectId: "project-1",
        settlementNo: "JSC-END-001",
        contractNo: "HT-2026-001",
        project: "一号项目",
        period: "2026-07",
        amount: "—",
        paymentTermsVersion: "—",
        currentNode: "已放弃",
        nodeTone: "default",
        ownerDepartment: "合同部",
        pendingOwner: "本人",
        stalledFor: "—",
        returnReason: "重复结算草稿",
        nextAction: "查看历史",
        updatedAt: "2026-07-20",
        lifecycleKind: "approval_draft",
        revision: 4,
        lifecycleUpdatedAt: savedAt,
        abandonedAt: savedAt,
        abandonReason: "重复结算草稿",
        copyAvailable: true
      }],
      view: "ended",
      summary: { formal_ledger: 0, my_drafts: 0, returned_for_revision: 0, ended: 1 },
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 }
    })
  }));

  await login(page);
  await page.goto("/结算管理?view=ended");
  await expect(page.getByText("JSC-END-001", { exact: true })).toBeVisible();
  await expect(page.getByText("重复结算草稿", { exact: true })).toBeVisible();
  await page.getByText("复制为新草稿", { exact: true }).click();
  await expect.poll(() => copyBody).toEqual({ expectedUpdatedAt: savedAt });
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname + new URL(page.url()).search))
    .toBe("/结算工作台?project=project-1&draftId=settlement-draft-copy-1");
});
