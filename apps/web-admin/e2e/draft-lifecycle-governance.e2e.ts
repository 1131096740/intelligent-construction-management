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
        roleKeys: ["contract_director", "finance_staff", "material_staff"],
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

function returnedPaymentDetail() {
  return {
    id: "FK-RETURN-001",
    title: "FK-RETURN-001 · 退回待修改付款申请",
    lifecycleKind: "approval_draft",
    ledgerView: "returned_for_revision",
    lifecycleUpdatedAt: savedAt,
    meta: [
      { label: "审批状态", value: "已退回", tone: "warning" },
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
    availableActions: [
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
  await page.route("**/api/payments/FK-RETURN-001/abandonment", (route) => {
    abandonBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "FK-RETURN-001", status: "abandoned" }) });
  });
  await page.route("**/api/payments/FK-RETURN-001", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(returnedPaymentDetail()) })
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

test("合同已放弃记录只在已结束视图只读展示", async ({ page }, testInfo) => {
  await installSession(page);
  await page.route("**/api/contracts/lifecycle-ledger?*", (route) => {
    const view = new URL(route.request().url()).searchParams.get("view") ?? "formal_ledger";
    const endedRows = view === "ended" ? [{
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
        view,
        summary: { formal_ledger: 0, my_drafts: 0, returned_for_revision: 0, ended: 1 },
        meta: { page: 1, pageSize: 20, total: endedRows.length, totalPages: endedRows.length ? 1 : 0 }
      })
    });
  });
  await login(page);
  await page.goto("/合同管理?view=ended");
  await expect(page.getByText("HT-END-001", { exact: true })).toBeVisible();
  await expect(page.getByText("供应计划取消", { exact: true })).toBeVisible();
  await expect(page.getByText("历史已保留", { exact: true })).toBeVisible();
  await expect(page.getByText("进入工作台", { exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 900, height: 768 });
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
  await page.screenshot({
    path: path.join(process.env.UI_RESPONSIVE_SCREENSHOT_DIR ?? testInfo.outputDir, "draft-lifecycle-contract-ended-900x768.png"),
    fullPage: true
  });
});
