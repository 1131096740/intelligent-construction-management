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

test("P0 项目支出撤回以 fresh GET 四坐标提交且双击只产生一次 POST", async ({
  browserName,
  page
}, testInfo) => {
  await installSession(page);
  await page.setViewportSize(
    browserName === "webkit"
      ? { width: 390, height: 844 }
      : { width: 1366, height: 768 }
  );
  const browserErrors: string[] = [];
  const pageErrors: string[] = [];
  const requestOrder: string[] = [];
  const withdrawalBodies: Record<string, unknown>[] = [];
  let withdrawn = false;
  let releaseWithdrawalPost!: () => void;
  const withdrawalPostGate = new Promise<void>((resolve) => {
    releaseWithdrawalPost = resolve;
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  const detail = () => ({
    id: "expense-withdraw",
    projectId: "project-1",
    code: "ZC-WITHDRAW-001",
    title: "ZC-WITHDRAW-001 · 项目临时支出",
    status: withdrawn ? "withdrawn" : "approval_pending",
    statusLabel: withdrawn ? "已撤回" : "审批中",
    expenseTypeLabel: "报销",
    expenseSubtypeLabel: "报销",
    paymentSubject: "项目临时支出",
    reason: "现场临时费用",
    requestedAmountCents: "120000",
    approvedAmountCents: null,
    currentNodeName: withdrawn ? null : "财务审核",
    lifecycleKind: "formal_record",
    ledgerView: withdrawn ? "ended" : "formal_ledger",
    lifecycleUpdatedAt: "2026-07-31T09:00:00.000Z",
    hasPersistentDraft: false,
    withdrawalContext: withdrawn
      ? null
      : {
          expectedExpenseUpdatedAt:
            "2026-07-31T09:00:00.000Z",
          expectedApprovalInstanceId:
            "approval-expense-withdraw",
          expectedNodeIndex: 1,
          expectedApprovalUpdatedAt:
            "2026-07-31T09:00:01.000Z"
        },
    availableActions: withdrawn
      ? []
      : [{
          key: "withdraw",
          label: "撤回项目支出申请",
          kind: "danger",
          enabled: true,
          disabledReason: null
        }],
    blockedReasons: withdrawn
      ? ["项目支出申请已结束，只能查看历史记录"]
      : [],
    canSetApprovedAmount: false,
    reviewAction: {
      key: "review",
      label: "审批",
      kind: "primary",
      enabled: false,
      disabledReason: withdrawn
        ? "当前项目支出状态不可审批"
        : "申请人不能审批自己发起的业务",
      requiresSelfReviewConfirmation: false
    },
    approvalTimeline: []
  });
  await page.route(
    "**/api/projects/project-1/expense-requests/expense-withdraw/approval-detail",
    (route) => {
      requestOrder.push("GET");
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(detail())
      });
    }
  );
  await page.route(
    "**/api/projects/project-1/expense-requests/expense-withdraw/approval-withdrawal",
    async (route) => {
      requestOrder.push("POST");
      withdrawalBodies.push(
        route.request().postDataJSON() as Record<string, unknown>
      );
      await withdrawalPostGate;
      withdrawn = true;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ id: "expense-withdraw", status: "withdrawn" })
      });
    }
  );

  await login(page);
  await page.goto("/项目支出/project-1/expense-withdraw");
  await expect(
    page.getByRole("heading", { name: "项目支出审批详情" })
  ).toBeVisible();
  await page
    .getByRole("button", { name: "撤回项目支出申请" })
    .click();
  const dialog = page
    .locator(".t-dialog")
    .filter({ hasText: "撤回项目支出申请" });
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole("button", {
    name: "确认撤回",
    exact: true
  });
  await expect(confirm).toBeVisible();
  await expect(confirm).toBeEnabled();
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(
      testInfo.outputDir,
      `project-expense-withdraw-${browserName}-${browserName === "webkit" ? "390x844" : "1366x768"}.png`
    ),
    fullPage: false
  });
  await confirm.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect.poll(() => withdrawalBodies).toHaveLength(1);
  await expect(dialog.locator(".t-dialog__close")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  releaseWithdrawalPost();

  await expect(page.getByText("已撤回", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "撤回项目支出申请" })
  ).toHaveCount(0);
  await expect.poll(() => requestOrder).toEqual([
    "GET",
    "GET",
    "POST",
    "GET"
  ]);
  expect(withdrawalBodies).toEqual([{
    expectedExpenseUpdatedAt: "2026-07-31T09:00:00.000Z",
    expectedApprovalInstanceId: "approval-expense-withdraw",
    expectedNodeIndex: 1,
    expectedApprovalUpdatedAt: "2026-07-31T09:00:01.000Z"
  }]);
  await expect(
    page.locator(
      "vite-error-overlay, #webpack-dev-server-client-overlay"
    )
  ).toHaveCount(0);
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
  if (browserName === "webkit") {
    expect(
      await page.evaluate(() => ({
        height: window.innerHeight,
        userAgent: navigator.userAgent,
        width: window.innerWidth
      }))
    ).toEqual(expect.objectContaining({
      height: 844,
      width: 390,
      userAgent: expect.not.stringContaining("Chrome/")
    }));
  }
  expect(browserErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("P0 项目支出审批在 Chromium 桌面通过并在 WebKit 390 驳回", async ({
  browserName,
  page
}, testInfo) => {
  await installSession(page);
  const approve = browserName === "chromium";
  await page.setViewportSize(
    approve
      ? { width: 1366, height: 768 }
      : { width: 390, height: 844 }
  );
  const browserErrors: string[] = [];
  const pageErrors: string[] = [];
  const requestOrder: string[] = [];
  const reviewBodies: Record<string, unknown>[] = [];
  let reviewed = false;
  let releaseReviewPost!: () => void;
  const reviewPostGate = new Promise<void>((resolve) => {
    releaseReviewPost = resolve;
  });
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  const detail = () => ({
    id: "expense-review",
    projectId: "project-1",
    code: "ZC-REVIEW-001",
    title: "ZC-REVIEW-001 · 项目支出审批",
    status: reviewed ? (approve ? "approval_pending" : "rejected") : "approval_pending",
    statusLabel: reviewed ? (approve ? "已通过当前节点" : "已驳回") : "审批中",
    expenseTypeLabel: "报销",
    expenseSubtypeLabel: "差旅费",
    paymentSubject: "项目差旅支出",
    reason: "现场协调差旅",
    requestedAmountCents: "100000",
    approvedAmountCents: reviewed && approve ? "80000" : null,
    currentNodeName: reviewed ? null : "财务审核",
    lifecycleKind: "formal_record",
    ledgerView: reviewed && !approve ? "ended" : "formal_ledger",
    lifecycleUpdatedAt: "2026-07-31T10:00:00.000Z",
    hasPersistentDraft: false,
    reviewApprovalContext: reviewed
      ? null
      : {
          expectedExpenseUpdatedAt: "2026-07-31T10:00:00.000Z",
          expectedApprovalInstanceId: "approval-expense-review",
          expectedNodeIndex: 2,
          expectedApprovalUpdatedAt: "2026-07-31T10:00:01.000Z"
        },
    withdrawalContext: null,
    availableActions: reviewed
      ? []
      : [{
          key: "review_approval",
          label: "审批项目支出",
          kind: "primary",
          enabled: true,
          disabledReason: null,
          requiresSelfReviewConfirmation: false
        }],
    blockedReasons: reviewed ? ["当前审批节点已办理"] : [],
    canSetApprovedAmount: approve,
    reviewAction: {
      key: "review",
      label: "审批项目支出",
      kind: "primary",
      enabled: !reviewed,
      disabledReason: reviewed ? "当前审批节点已办理" : null,
      requiresSelfReviewConfirmation: false
    },
    approvalTimeline: []
  });
  await page.route(
    "**/api/projects/project-1/expense-requests/expense-review/approval-detail",
    (route) => {
      requestOrder.push("GET");
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(detail())
      });
    }
  );
  await page.route(
    "**/api/projects/project-1/expense-requests/expense-review/approval",
    async (route) => {
      requestOrder.push("POST");
      reviewBodies.push(
        route.request().postDataJSON() as Record<string, unknown>
      );
      await reviewPostGate;
      reviewed = true;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ id: "expense-review" })
      });
    }
  );

  await login(page);
  await page.goto("/项目支出/project-1/expense-review");
  await expect(
    page.getByRole("heading", { name: "项目支出审批详情" })
  ).toBeVisible();
  const comment = approve ? "同意按核定金额支付" : "资料不足，请补充凭证";
  await page
    .getByPlaceholder("审批意见；驳回时必填")
    .fill(comment);
  if (approve) {
    await page
      .getByPlaceholder("终审批准金额（元，不填则按申请金额）")
      .fill("800.00");
  }
  await page
    .getByRole("button", { name: approve ? "审批通过" : "审批驳回" })
    .click();
  const dialog = page.locator(".t-dialog").filter({
    hasText: approve ? "确认通过项目支出审批" : "确认驳回项目支出审批"
  });
  await expect(dialog).toBeVisible();
  await page.screenshot({
    path: path.join(
      testInfo.outputDir,
      `project-expense-review-${approve ? "approve-chromium-1366x768" : "reject-webkit-390x844"}.png`
    ),
    fullPage: false
  });
  const confirm = dialog.getByRole("button", {
    name: approve ? "确认通过" : "确认驳回",
    exact: true
  });
  await confirm.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect.poll(() => reviewBodies).toHaveLength(1);
  await expect(confirm).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "取消", exact: true })
  ).toBeDisabled();
  await expect(dialog.locator(".t-dialog__close")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  releaseReviewPost();

  await expect(
    page.getByText(
      approve
        ? "项目支出审批已通过，详情已刷新。"
        : "项目支出审批已驳回，详情已刷新。",
      { exact: true }
    )
  ).toBeVisible();
  await expect(
    page.getByText(approve ? "已通过当前节点" : "已驳回", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "审批通过" })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "审批驳回" })
  ).toHaveCount(0);
  await expect.poll(() => requestOrder).toEqual([
    "GET",
    "GET",
    "POST",
    "GET"
  ]);
  expect(reviewBodies).toEqual([{
    decision: approve ? "approve" : "reject",
    ...(approve ? { approvedAmountCents: "80000" } : {}),
    comment,
    expectedExpenseUpdatedAt: "2026-07-31T10:00:00.000Z",
    expectedApprovalInstanceId: "approval-expense-review",
    expectedNodeIndex: 2,
    expectedApprovalUpdatedAt: "2026-07-31T10:00:01.000Z"
  }]);
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
  if (!approve) {
    expect(
      await page.evaluate(() => ({
        height: window.innerHeight,
        userAgent: navigator.userAgent,
        width: window.innerWidth
      }))
    ).toEqual(expect.objectContaining({
      height: 844,
      width: 390,
      userAgent: expect.not.stringContaining("Chrome/")
    }));
  }
  expect(browserErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("P0 项目支出审批 A 的迟到 preflight 不得在 B 路由发出 POST", async ({
  browserName,
  page
}) => {
  test.skip(browserName !== "chromium");
  await installSession(page);
  let expenseAGetCount = 0;
  let reviewPostCount = 0;
  let releaseExpenseAPreflight!: () => void;
  const expenseAPreflightGate = new Promise<void>((resolve) => {
    releaseExpenseAPreflight = resolve;
  });
  let markExpenseAPreflightStarted!: () => void;
  const expenseAPreflightStarted = new Promise<void>((resolve) => {
    markExpenseAPreflightStarted = resolve;
  });
  const detail = (id: "expense-review-A" | "expense-review-B") => ({
    id,
    projectId: "project-1",
    code: id === "expense-review-A" ? "ZC-REVIEW-A" : "ZC-REVIEW-B",
    title: id === "expense-review-A" ? "ZC-REVIEW-A · 待审批" : "ZC-REVIEW-B · 当前详情",
    status: "approval_pending",
    statusLabel: "审批中",
    expenseTypeLabel: "报销",
    expenseSubtypeLabel: "差旅费",
    paymentSubject: id === "expense-review-A" ? "A 支出" : "B 支出",
    reason: "审批路由归属验收",
    requestedAmountCents: "100000",
    approvedAmountCents: null,
    currentNodeName: "财务审核",
    lifecycleKind: "formal_record",
    ledgerView: "formal_ledger",
    lifecycleUpdatedAt: "2026-07-31T10:10:00.000Z",
    hasPersistentDraft: false,
    reviewApprovalContext: id === "expense-review-A"
      ? {
          expectedExpenseUpdatedAt: "2026-07-31T10:10:00.000Z",
          expectedApprovalInstanceId: "approval-expense-review-A",
          expectedNodeIndex: 1,
          expectedApprovalUpdatedAt: "2026-07-31T10:10:01.000Z"
        }
      : null,
    withdrawalContext: null,
    availableActions: id === "expense-review-A"
      ? [{
          key: "review_approval",
          label: "审批项目支出",
          kind: "primary",
          enabled: true,
          disabledReason: null,
          requiresSelfReviewConfirmation: false
        }]
      : [],
    blockedReasons: id === "expense-review-B" ? ["当前账号无此审批权限"] : [],
    canSetApprovedAmount: false,
    reviewAction: {
      key: "review",
      label: "审批项目支出",
      kind: "primary",
      enabled: id === "expense-review-A",
      disabledReason: id === "expense-review-B" ? "当前账号无此审批权限" : null,
      requiresSelfReviewConfirmation: false
    },
    approvalTimeline: []
  });
  await page.route(
    "**/api/projects/project-1/expense-requests/expense-review-A/approval-detail",
    async (route) => {
      expenseAGetCount += 1;
      if (expenseAGetCount > 1) {
        markExpenseAPreflightStarted();
        await expenseAPreflightGate;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(detail("expense-review-A"))
      });
    }
  );
  await page.route(
    "**/api/projects/project-1/expense-requests/expense-review-B/approval-detail",
    (route) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(detail("expense-review-B"))
    })
  );
  await page.route(
    "**/api/projects/project-1/expense-requests/expense-review-A/approval",
    (route) => {
      reviewPostCount += 1;
      return route.fulfill({ contentType: "application/json", body: "{}" });
    }
  );

  await login(page);
  await page.goto("/项目支出/project-1/expense-review-A");
  await page.getByRole("button", { name: "审批通过" }).click();
  const dialog = page.locator(".t-dialog").filter({
    hasText: "确认通过项目支出审批"
  });
  await dialog.getByRole("button", { name: "确认通过", exact: true }).click();
  await expenseAPreflightStarted;
  await page.evaluate(() => {
    window.history.pushState(
      {},
      "",
      "/项目支出/project-1/expense-review-B"
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByText("ZC-REVIEW-B", { exact: true })).toBeVisible();
  releaseExpenseAPreflight();
  await page.waitForTimeout(100);

  expect(reviewPostCount).toBe(0);
  await expect(page.getByText("ZC-REVIEW-B", { exact: true })).toBeVisible();
  await expect(page.getByText("ZC-REVIEW-A", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "审批通过" })
  ).toHaveCount(0);
});

test("P0 项目支出 A 路由迟到响应不能覆盖 B 详情", async ({
  browserName,
  page
}) => {
  test.skip(browserName !== "chromium");
  await installSession(page);
  let releaseExpenseA!: () => void;
  const expenseAGate = new Promise<void>((resolve) => {
    releaseExpenseA = resolve;
  });
  let markExpenseAStarted!: () => void;
  const expenseAStarted = new Promise<void>((resolve) => {
    markExpenseAStarted = resolve;
  });
  const detail = (id: "expense-A" | "expense-B") => ({
    id,
    projectId: "project-1",
    code: id === "expense-A" ? "ZC-LATE-A" : "ZC-CURRENT-B",
    title:
      id === "expense-A"
        ? "ZC-LATE-A · 迟到支出"
        : "ZC-CURRENT-B · 当前支出",
    status: "approval_pending",
    statusLabel: "审批中",
    expenseTypeLabel: "报销",
    expenseSubtypeLabel: "报销",
    paymentSubject:
      id === "expense-A" ? "迟到支出" : "当前支出",
    reason: "路由归属验收",
    requestedAmountCents: "10000",
    approvedAmountCents: null,
    currentNodeName: "财务审核",
    lifecycleKind: "formal_record",
    ledgerView: "formal_ledger",
    lifecycleUpdatedAt: "2026-07-31T09:10:00.000Z",
    hasPersistentDraft: false,
    withdrawalContext:
      id === "expense-A"
        ? {
            expectedExpenseUpdatedAt:
              "2026-07-31T09:10:00.000Z",
            expectedApprovalInstanceId: "approval-expense-A",
            expectedNodeIndex: 1,
            expectedApprovalUpdatedAt:
              "2026-07-31T09:10:01.000Z"
          }
        : null,
    availableActions:
      id === "expense-A"
        ? [{
            key: "withdraw",
            label: "撤回迟到支出",
            kind: "danger",
            enabled: true,
            disabledReason: null
          }]
        : [],
    blockedReasons:
      id === "expense-B"
        ? ["当前账号不具备撤回权限"]
        : [],
    canSetApprovedAmount: false,
    reviewAction: {
      key: "review",
      label: "审批",
      kind: "primary",
      enabled: false,
      disabledReason: "当前岗位无权审批此节点",
      requiresSelfReviewConfirmation: false
    },
    approvalTimeline: []
  });
  await page.route(
    "**/api/projects/project-1/expense-requests/expense-A/approval-detail",
    async (route) => {
      markExpenseAStarted();
      await expenseAGate;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(detail("expense-A"))
      });
    }
  );
  await page.route(
    "**/api/projects/project-1/expense-requests/expense-B/approval-detail",
    (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(detail("expense-B"))
      })
  );

  await login(page);
  await page.goto("/项目支出/project-1/expense-A");
  await expect(
    page.getByRole("heading", { name: "项目支出审批详情" })
  ).toBeVisible();
  await expenseAStarted;
  await page.evaluate(() => {
    window.history.pushState(
      {},
      "",
      "/项目支出/project-1/expense-B"
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(
    page.getByText("ZC-CURRENT-B", { exact: true })
  ).toBeVisible();
  releaseExpenseA();
  await page.waitForTimeout(100);

  await expect(
    page.getByText("ZC-CURRENT-B", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("ZC-LATE-A", { exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "撤回迟到支出" })
  ).toHaveCount(0);
});

test("合同工作台直接删除服务端纯净草稿", async ({ page }) => {
  await installSession(page);
  let saveCalls = 0;
  const deleteBodies: Array<Record<string, unknown>> = [];
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
  await page.route("**/api/company-entities*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/standard-clauses*", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-workbench/version-delete/negotiation-rounds", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" })
  );
  await page.route("**/api/contract-workbench/version-delete", (route) => {
    saveCalls += 1;
    return route.fulfill({ contentType: "application/json", body: "{}" });
  });
  await page.route(/\/api\/contract-drafts\/version-delete$/, (route) => {
    deleteBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        contractVersionId: "version-delete",
        status: deleteBodies.length === 1 ? "deleting" : "deleted",
        lifecycleKind: "pristine_draft",
        ...(deleteBodies.length === 1 ? { retryable: true } : {})
      })
    });
  });
  await page.route("**/api/contract-drafts/version-delete/workbench", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      lifecycleKind: "pristine_draft",
      availableLifecycleActions: ["delete_pristine_draft"],
      draftOperationAvailableActions: [],
      lease: {
        state: "available",
        holderDisplayName: null,
        expiresAt: null,
        canTakeOver: false
      },
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
        estimatedAmountCents: null,
        amountLimitType: "capped",
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
      draft: {},
      attachments: [],
      settlementMode: {
        value: null,
        source: null,
        confirmedAt: null,
        confirmedByUserId: null,
        confirmationRequired: false,
        canConfirm: false
      },
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
  await page.route("**/api/contracts/lifecycle-ledger?*", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      rows: [],
      summary: { formal_ledger: 0, my_drafts: 0, returned_for_revision: 0, ended: 0 },
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 }
    })
  }));

  await login(page);
  await page.goto("/合同工作台/contract-delete?versionId=version-delete");
  await expect(page.getByRole("button", { name: "删除草稿" })).toBeVisible();
  await page.getByRole("button", { name: "删除草稿" }).click();
  await page.getByRole("button", { name: "确认删除草稿" }).click();

  await expect.poll(() => deleteBodies).toEqual([{ expectedRevision: 7 }]);
  expect(saveCalls).toBe(0);
  await expect(page.getByText("草稿已进入待删除状态，但对象清理未完成")).toBeVisible();
  expect(
    decodeURIComponent(new URL(page.url()).pathname + new URL(page.url()).search)
  ).toBe("/合同工作台/contract-delete?versionId=version-delete");

  await page.getByRole("button", { name: "确认删除草稿" }).click();
  await expect.poll(() => deleteBodies).toEqual([
    { expectedRevision: 7 },
    { expectedRevision: 7 }
  ]);
  await expect
    .poll(() => decodeURIComponent(new URL(page.url()).pathname + new URL(page.url()).search))
    .toBe("/合同工作台?view=ended");
});

test("合同已放弃记录保持只读且不开放复制", async ({ page }, testInfo) => {
  await installSession(page);
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
      abandonReason: "供应计划取消"
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
  await expect(page.getByText("复制为新草稿", { exact: true })).toHaveCount(0);
  await expect(page.getByText("查看详情", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 900, height: 768 });
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
  await page.screenshot({
    path: path.join(process.env.UI_RESPONSIVE_SCREENSHOT_DIR ?? testInfo.outputDir, "draft-lifecycle-contract-ended-900x768.png"),
    fullPage: true
  });
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

test("P0 项目支出实付在 Chromium 桌面与 WebKit 390 只提交一个原子事实", async ({
  browserName,
  page
}, testInfo) => {
  await installSession(page);
  await page.setViewportSize(
    browserName === "webkit"
      ? { width: 390, height: 844 }
      : { width: 1366, height: 768 }
  );
  const browserErrors: string[] = [];
  const pageErrors: string[] = [];
  const requestOrder: string[] = [];
  const uploadIdempotencyKeys: string[] = [];
  const executionBodies: Record<string, unknown>[] = [];
  let executed = false;
  let releaseExecutionPost!: () => void;
  const executionPostGate = new Promise<void>((resolve) => {
    releaseExecutionPost = resolve;
  });
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  const detail = () => {
    const expectedExpenseUpdatedAt = executed
      ? "2026-07-31T11:00:02.000Z"
      : "2026-07-31T11:00:00.000Z";
    return {
      id: "expense-execution",
      projectId: "project-1",
      code: "ZC-EXECUTION-001",
      title: "ZC-EXECUTION-001 · 项目支出实付",
      status: executed ? "paid" : "partially_paid",
      statusLabel: executed ? "已付清" : "部分付款",
      expenseTypeLabel: "零星付款",
      expenseSubtypeLabel: "其他",
      paymentSubject: "项目现场支出",
      reason: "现场临时费用",
      requestedAmountCents: "50000",
      approvedAmountCents: "50000",
      paidAmountCents: executed ? "50000" : "20000",
      remainingAmountCents: executed ? "0" : "30000",
      currentNodeName: null,
      lifecycleKind: "formal_record",
      ledgerView: "formal_ledger",
      lifecycleUpdatedAt: expectedExpenseUpdatedAt,
      hasPersistentDraft: false,
      withdrawalContext: null,
      reviewApprovalContext: null,
      executionContext: executed
        ? null
        : { expectedExpenseUpdatedAt },
      availableActions: executed
        ? []
        : [{
            key: "record_execution",
            label: "登记实付",
            kind: "primary",
            enabled: true,
            disabledReason: null,
            requiredAction: "project_expense.execution"
          }],
      blockedReasons: executed ? ["项目支出已全部付清"] : [],
      canSetApprovedAmount: false,
      reviewAction: {
        key: "review",
        label: "审批",
        kind: "primary",
        enabled: false,
        disabledReason: "当前项目支出状态不可审批",
        requiresSelfReviewConfirmation: false
      },
      approvalTimeline: []
    };
  };

  await page.route(
    "**/api/projects/project-1/expense-requests/expense-execution/approval-detail",
    (route) => {
      requestOrder.push("GET /approval-detail");
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(detail())
      });
    }
  );
  await page.route("**/api/files", (route) => {
    const requestBody =
      route.request().postDataBuffer()?.toString("utf8") ?? "";
    const idempotencyKey =
      /name="idempotencyKey"\r\n\r\n([^\r\n]+)/u.exec(
        requestBody
      )?.[1] ?? "";
    requestOrder.push("POST /files");
    uploadIdempotencyKeys.push(idempotencyKey);
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ id: idempotencyKey })
    });
  });
  await page.route(
    "**/api/projects/project-1/expense-requests/expense-execution/executions",
    async (route) => {
      requestOrder.push("POST /executions");
      executionBodies.push(
        route.request().postDataJSON() as Record<string, unknown>
      );
      await executionPostGate;
      executed = true;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ id: "project-expense-execution-p0" })
      });
    }
  );

  await login(page);
  await page.goto("/项目支出/project-1/expense-execution");
  await expect(
    page.getByRole("heading", { name: "项目支出审批详情" })
  ).toBeVisible();
  const executionCard = page
    .locator(".section-card")
    .filter({ hasText: "实付办理" });
  await expect(executionCard).toBeVisible();
  await executionCard.locator(".money-input input").fill("300.00");
  const paidAt = executionCard.locator(".t-date-picker input");
  const paidAtInput = await paidAt.inputValue();
  expect(paidAtInput).not.toBe("");
  await executionCard.locator('input[type="file"]').setInputFiles({
    name: "项目支出实付凭证.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("project-expense-execution-p0")
  });
  await executionCard
    .getByRole("button", { name: "确认登记实付", exact: true })
    .click();

  const dialog = page
    .locator(".t-dialog")
    .filter({ hasText: "确认登记项目支出实付？" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByPlaceholder("用于确认当前操作者身份")
    .fill("Draft@2026");
  await page.screenshot({
    path: path.join(
      testInfo.outputDir,
      `project-expense-execution-${browserName}-${browserName === "webkit" ? "390x844" : "1366x768"}.png`
    ),
    fullPage: false
  });
  const confirm = dialog.getByRole("button", {
    name: "确认登记实付",
    exact: true
  });
  await confirm.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect.poll(() => executionBodies).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: "刷新", exact: true })
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "取消", exact: true })
  ).toBeDisabled();
  await expect(dialog.locator(".t-dialog__close")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  releaseExecutionPost();

  await expect(
    page.getByText(
      "项目支出实付已登记，权威详情已刷新。",
      { exact: true }
    )
  ).toBeVisible();
  await expect(
    page.getByText("已付清", { exact: true })
  ).toBeVisible();
  await expect(executionCard).toHaveCount(0);
  await expect.poll(() => requestOrder).toEqual([
    "GET /approval-detail",
    "GET /approval-detail",
    "POST /files",
    "POST /executions",
    "GET /approval-detail"
  ]);
  expect(uploadIdempotencyKeys).toHaveLength(1);
  expect(uploadIdempotencyKeys[0]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
  );
  const submittedPaidAt = executionBodies[0]?.paidAt;
  expect(submittedPaidAt).toEqual(expect.any(String));
  expect(
    await page.evaluate((value) => {
      const date = new Date(value);
      const pad = (part: number) => String(part).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }, submittedPaidAt as string)
  ).toBe(paidAtInput);
  expect(executionBodies).toEqual([{
    amountCents: "30000",
    paidAt: submittedPaidAt,
    voucherFileId: uploadIdempotencyKeys[0],
    confirmationPassword: "Draft@2026",
    expectedExpenseUpdatedAt:
      "2026-07-31T11:00:00.000Z",
    idempotencyKey: uploadIdempotencyKeys[0]
  }]);
  await expect(
    page.locator(
      "vite-error-overlay, #webpack-dev-server-client-overlay"
    )
  ).toHaveCount(0);
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
  if (browserName === "webkit") {
    expect(
      await page.evaluate(() => ({
        height: window.innerHeight,
        userAgent: navigator.userAgent,
        width: window.innerWidth
      }))
    ).toEqual(expect.objectContaining({
      height: 844,
      width: 390,
      userAgent: expect.not.stringContaining("Chrome/")
    }));
  }
  expect(browserErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("P0 项目支出财务入账在 Chromium 桌面与 WebKit 390 只提交一个单调事实", async ({
  browserName,
  page
}, testInfo) => {
  await installSession(page);
  await page.setViewportSize(
    browserName === "webkit"
      ? { width: 390, height: 844 }
      : { width: 1366, height: 768 }
  );
  const browserErrors: string[] = [];
  const pageErrors: string[] = [];
  const requestOrder: string[] = [];
  const financeBodies: Record<string, unknown>[] = [];
  let financed = false;
  let releaseFinancePost!: () => void;
  const financePostGate = new Promise<void>((resolve) => {
    releaseFinancePost = resolve;
  });
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  const detail = () => {
    const expectedExpenseUpdatedAt = financed
      ? "2026-07-31T12:00:02.000Z"
      : "2026-07-31T12:00:00.000Z";
    return {
      id: "expense-finance",
      projectId: "project-1",
      code: "ZC-FINANCE-001",
      title: "ZC-FINANCE-001 · 项目支出财务入账",
      status: "paid",
      statusLabel: "已付清",
      expenseTypeLabel: "零星付款",
      expenseSubtypeLabel: "其他",
      paymentSubject: "项目现场支出",
      reason: "现场临时费用",
      requestedAmountCents: "50000",
      approvedAmountCents: "50000",
      paidAmountCents: "50000",
      remainingAmountCents: "0",
      financeRecordedAmountCents: financed ? "50000" : "20000",
      financeRemainingAmountCents: financed ? "0" : "30000",
      currentNodeName: null,
      lifecycleKind: "formal_record",
      ledgerView: "formal_ledger",
      lifecycleUpdatedAt: expectedExpenseUpdatedAt,
      hasPersistentDraft: false,
      withdrawalContext: null,
      reviewApprovalContext: null,
      executionContext: null,
      financeContext: financed
        ? null
        : { expectedExpenseUpdatedAt },
      availableActions: financed
        ? []
        : [{
            key: "record_finance",
            label: "财务入账",
            kind: "primary",
            enabled: true,
            disabledReason: null,
            requiredAction: "project_expense.finance_record",
            requiresPassword: true
          }],
      blockedReasons: financed ? ["项目支出已全部入账"] : [],
      canSetApprovedAmount: false,
      reviewAction: {
        key: "review",
        label: "审批",
        kind: "primary",
        enabled: false,
        disabledReason: "当前项目支出状态不可审批",
        requiresSelfReviewConfirmation: false
      },
      approvalTimeline: []
    };
  };

  await page.route(
    "**/api/projects/project-1/expense-requests/expense-finance/approval-detail",
    (route) => {
      requestOrder.push("GET /approval-detail");
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(detail())
      });
    }
  );
  await page.route(
    "**/api/projects/project-1/expense-requests/expense-finance/finance-records",
    async (route) => {
      requestOrder.push("POST /finance-records");
      const body =
        route.request().postDataJSON() as Record<string, unknown>;
      financeBodies.push(body);
      await financePostGate;
      financed = true;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          id: "project-expense-finance-p0",
          idempotencyKey: body.idempotencyKey,
          projectId: "project-1",
          projectExpenseRequestId: "expense-finance",
          paymentRequestId: null,
          settlementId: null,
          direction: "outflow",
          amountCents: body.amountCents,
          occurredAt: body.occurredAt,
          createdByUserId: "draft-governance-user"
        })
      });
    }
  );

  await login(page);
  await page.goto("/项目支出/project-1/expense-finance");
  await expect(
    page.getByRole("heading", { name: "项目支出审批详情" })
  ).toBeVisible();
  const financeCard = page
    .locator(".section-card")
    .filter({
      has: page.getByRole("button", {
        name: "确认财务入账",
        exact: true
      })
    });
  await expect(financeCard).toBeVisible();
  await financeCard.locator(".money-input input").fill("300.00");
  const occurredAt = financeCard.locator(".t-date-picker input");
  const occurredAtInput = await occurredAt.inputValue();
  expect(occurredAtInput).not.toBe("");
  await financeCard
    .getByRole("button", { name: "确认财务入账", exact: true })
    .click();

  const dialog = page
    .locator(".t-dialog")
    .filter({ hasText: "确认项目支出财务入账？" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByPlaceholder("用于确认当前操作者身份")
    .fill("Draft@2026");
  await page.screenshot({
    path: path.join(
      testInfo.outputDir,
      `project-expense-finance-${browserName}-${browserName === "webkit" ? "390x844" : "1366x768"}.png`
    ),
    fullPage: false
  });
  const confirm = dialog.getByRole("button", {
    name: "确认财务入账",
    exact: true
  });
  await confirm.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect.poll(() => financeBodies).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: "刷新", exact: true })
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "取消", exact: true })
  ).toBeDisabled();
  await expect(dialog.locator(".t-dialog__close")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  releaseFinancePost();

  await expect(
    page.getByText(
      "项目支出财务入账已登记，权威详情已刷新。",
      { exact: true }
    )
  ).toBeVisible();
  await expect(
    page
      .locator(".summary-grid > div")
      .filter({ hasText: "已入账金额" })
  ).toContainText("¥500.00");
  await expect(
    page
      .locator(".summary-grid > div")
      .filter({ hasText: "待入账金额" })
  ).toContainText("¥0.00");
  await expect(financeCard).toHaveCount(0);
  await expect.poll(() => requestOrder).toEqual([
    "GET /approval-detail",
    "GET /approval-detail",
    "POST /finance-records",
    "GET /approval-detail",
    "GET /approval-detail"
  ]);
  expect(financeBodies).toHaveLength(1);
  expect(financeBodies[0]?.idempotencyKey).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
  );
  const submittedOccurredAt = financeBodies[0]?.occurredAt;
  expect(submittedOccurredAt).toEqual(expect.any(String));
  expect(
    await page.evaluate((value) => {
      const date = new Date(value);
      const pad = (part: number) => String(part).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }, submittedOccurredAt as string)
  ).toBe(occurredAtInput);
  expect(financeBodies).toEqual([{
    amountCents: "30000",
    occurredAt: submittedOccurredAt,
    confirmationPassword: "Draft@2026",
    expectedExpenseUpdatedAt:
      "2026-07-31T12:00:00.000Z",
    idempotencyKey: financeBodies[0]?.idempotencyKey
  }]);
  await expect(
    page.locator(
      "vite-error-overlay, #webpack-dev-server-client-overlay"
    )
  ).toHaveCount(0);
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
  if (browserName === "webkit") {
    expect(
      await page.evaluate(() => ({
        height: window.innerHeight,
        userAgent: navigator.userAgent,
        width: window.innerWidth
      }))
    ).toEqual(expect.objectContaining({
      height: 844,
      width: 390,
      userAgent: expect.not.stringContaining("Chrome/")
    }));
  }
  expect(browserErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("P0 项目支出收货在 Chromium 1366 与 WebKit 390 只提交一个 CAS 事实", async ({
  browserName,
  page
}, testInfo) => {
  test.setTimeout(60_000);
  await installSession(page);
  await page.setViewportSize(
    browserName === "webkit"
      ? { width: 390, height: 844 }
      : { width: 1366, height: 768 }
  );
  const browserErrors: string[] = [];
  const pageErrors: string[] = [];
  const requestOrder: string[] = [];
  const receiptBodies: Record<string, unknown>[] = [];
  let confirmed = false;
  let confirmedIdempotencyKey: string | null = null;
  let releaseReceiptPost!: () => void;
  const receiptPostGate = new Promise<void>((resolve) => {
    releaseReceiptPost = resolve;
  });
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  const initialUpdatedAt = "2026-08-01T04:00:00.000Z";
  const completedUpdatedAt = "2026-08-01T04:00:02.000Z";
  const detail = () => ({
    id: "expense-receipt",
    projectId: "project-1",
    code: "CG-RECEIPT-001",
    title: "CG-RECEIPT-001 · 零星采购收货",
    status: "paid",
    statusLabel: "已付清",
    expenseTypeLabel: "零星采购",
    expenseSubtypeLabel: "零星材料采购",
    paymentSubject: "现场零星材料",
    reason: "现场急用材料",
    requestedAmountCents: "50000",
    approvedAmountCents: "50000",
    paidAmountCents: "50000",
    remainingAmountCents: "0",
    financeRecordedAmountCents: "50000",
    financeRemainingAmountCents: "0",
    receiptConfirmedAt: confirmed
      ? "2026-08-01T04:00:01.000Z"
      : null,
    receiptConfirmedByUserId: confirmed
      ? "draft-governance-user"
      : null,
    receiptConfirmationIdempotencyKey:
      confirmedIdempotencyKey,
    receiptConfirmationNote: confirmed
      ? "数量、质量与现场交付无误"
      : null,
    currentNodeName: null,
    lifecycleKind: "formal_record",
    ledgerView: "formal_ledger",
    lifecycleUpdatedAt: confirmed
      ? completedUpdatedAt
      : initialUpdatedAt,
    hasPersistentDraft: false,
    withdrawalContext: null,
    reviewApprovalContext: null,
    executionContext: null,
    financeContext: null,
    receiptContext: confirmed
      ? null
      : { expectedExpenseUpdatedAt: initialUpdatedAt },
    availableActions: confirmed
      ? []
      : [{
          key: "confirm_receipt",
          label: "确认收货",
          kind: "primary",
          enabled: true,
          disabledReason: null,
          requiredAction: "project_expense.receipt_confirm",
          requiresPassword: true
        }],
    blockedReasons: confirmed ? ["零星采购已确认收货"] : [],
    canSetApprovedAmount: false,
    reviewAction: {
      key: "review",
      label: "审批",
      kind: "primary",
      enabled: false,
      disabledReason: "当前项目支出状态不可审批",
      requiresSelfReviewConfirmation: false
    },
    approvalTimeline: []
  });

  await page.route(
    "**/api/projects/project-1/expense-requests/expense-receipt/approval-detail",
    (route) => {
      requestOrder.push("GET /approval-detail");
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(detail())
      });
    }
  );
  await page.route(
    "**/api/projects/project-1/expense-requests/expense-receipt/receipt-confirmation",
    async (route) => {
      requestOrder.push("POST /receipt-confirmation");
      const body =
        route.request().postDataJSON() as Record<string, unknown>;
      receiptBodies.push(body);
      await receiptPostGate;
      confirmed = true;
      confirmedIdempotencyKey = String(body.idempotencyKey);
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          projectId: "project-1",
          expenseRequestId: "expense-receipt",
          idempotencyKey: body.idempotencyKey,
          confirmedByUserId: "draft-governance-user",
          confirmedAt: "2026-08-01T04:00:01.000Z",
          note: body.note,
          updatedAt: completedUpdatedAt
        })
      });
    }
  );

  await login(page);
  await page.goto("/项目支出/project-1/expense-receipt");
  await expect(
    page.getByRole("heading", { name: "项目支出审批详情" })
  ).toBeVisible();
  const receiptCard = page
    .locator(".section-card")
    .filter({
      has: page.getByRole("button", {
        name: "确认收货",
        exact: true
      })
    });
  await expect(receiptCard).toBeVisible();
  await receiptCard
    .locator("textarea")
    .fill("数量、质量与现场交付无误");
  await receiptCard
    .getByRole("button", { name: "确认收货", exact: true })
    .click();

  const dialog = page
    .locator(".t-dialog")
    .filter({ hasText: "确认历史项目支出已收货？" });
  await expect(dialog).toBeVisible();
  await dialog
    .getByPlaceholder("用于确认当前操作者身份")
    .fill("Draft@2026");
  await page.screenshot({
    path: path.join(
      testInfo.outputDir,
      `project-expense-receipt-${browserName}-${browserName === "webkit" ? "390x844" : "1366x768"}.png`
    ),
    fullPage: false
  });
  const confirm = dialog.getByRole("button", {
    name: "确认收货",
    exact: true
  });
  await confirm.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
  await expect.poll(() => receiptBodies).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: "刷新", exact: true })
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "取消", exact: true })
  ).toBeDisabled();
  await expect(dialog.locator(".t-dialog__close")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  releaseReceiptPost();

  await expect(
    page.getByText(
      "项目支出收货已确认，权威详情已刷新。",
      { exact: true }
    )
  ).toBeVisible();
  await expect(
    page
      .locator(".summary-grid > div")
      .filter({ hasText: "收货状态" })
  ).toContainText("已确认");
  await expect(receiptCard).toHaveCount(0);
  await expect.poll(() => requestOrder).toEqual([
    "GET /approval-detail",
    "GET /approval-detail",
    "POST /receipt-confirmation",
    "GET /approval-detail"
  ]);
  expect(receiptBodies).toHaveLength(1);
  expect(receiptBodies[0]?.idempotencyKey).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
  );
  expect(receiptBodies).toEqual([{
    confirmationPassword: "Draft@2026",
    note: "数量、质量与现场交付无误",
    expectedExpenseUpdatedAt: initialUpdatedAt,
    idempotencyKey: receiptBodies[0]?.idempotencyKey
  }]);
  await expect(
    page.locator(
      "vite-error-overlay, #webpack-dev-server-client-overlay"
    )
  ).toHaveCount(0);
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
  if (browserName === "webkit") {
    expect(
      await page.evaluate(() => ({
        height: window.innerHeight,
        userAgent: navigator.userAgent,
        width: window.innerWidth
      }))
    ).toEqual(expect.objectContaining({
      height: 844,
      width: 390,
      userAgent: expect.not.stringContaining("Chrome/")
    }));
  }
  expect(browserErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
