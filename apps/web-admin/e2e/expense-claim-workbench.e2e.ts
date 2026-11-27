import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
import type { ExpenseClaimLedgerPage } from "../src/api/expense-claim.api";
import {
  expectNoDocumentHorizontalOverflow,
  expectNoNestedHorizontalScrollers
} from "./helpers/responsive-assertions";

const { EXPENSE_CLAIM_ENTRY_DEFINITION } = createRequire(import.meta.url)(
  "../../../services/api/src/expense-claim/expense-claim-entry.definition.ts"
) as typeof import("../../../services/api/src/expense-claim/expense-claim-entry.definition");

test("费用与报销台账在桌面和手机尺寸读取新域个人事实并切换服务端视图", async ({ page }) => {
  const requestedViews: string[] = [];
  await mockExpenseClaimSession(page, requestedViews);
  await login(page);

  await page.goto("/费用与报销工作台");
  await expect(page.getByRole("heading", { name: "费用与报销台账" })).toBeVisible();
  const initialRow = page.getByRole("cell", { name: "BX-20260723-001", exact: true });
  await expect(initialRow).toBeVisible();
  await expect(page.getByText("由综合部某某代办", { exact: true })).toHaveCount(0);
  await initialRow.locator("a").click();
  await expect(page.getByRole("heading", { name: "费用报销" })).toBeVisible();
  await expect(page.getByText("项目现场交通费", { exact: true })).toBeVisible();
  await page.goto("/费用与报销工作台");
  await expect(initialRow).toBeVisible();
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("article").getByText("BX-20260723-001", { exact: true })).toBeVisible();
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.getByRole("textbox", { name: "办理视图", exact: true }).click();
  await page.getByRole("listitem", { name: "审批中", exact: true }).click();
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await expect(page.getByRole("cell", { name: "BX-20260723-002", exact: true })).toBeVisible();
  await expect(initialRow).toHaveCount(0);
  expect(requestedViews).toContain("in_progress");
});

test("费用工作台仅保留报销和零星费用，并办理零星费用草稿及附件", async ({ page }) => {
  const requestedViews: string[] = [];
  const posted: unknown[] = [];
  const submitted: string[] = [];
  const reviewed: string[] = [];
  const attachments: string[] = [];
  const appendedEvidence: string[] = [];
  await mockExpenseClaimSession(page, requestedViews, posted, submitted, reviewed, attachments, appendedEvidence);
  await login(page);

  await page.goto("/费用与报销工作台");
  await page.getByRole("button", { name: "新建费用申请" }).click();
  await expect(page.locator(".expense-claim-create__title")).toBeVisible();
  const drawer = page.locator(".t-drawer");
  await expect(drawer.getByText("借款申请", { exact: true })).toHaveCount(0);
  await expect(drawer.getByText("费用报销", { exact: true })).toBeVisible();
  await drawer.getByText("零星费用", { exact: true }).click();
  await drawer.locator(".t-form__item").filter({ hasText: "零星费用分类" }).locator(".t-select").click();
  await page.locator(".t-select__dropdown:visible").getByText("非材料临时服务", { exact: true }).click();
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByPlaceholder("请填写事由").fill("现场零星服务");
  await page.getByPlaceholder("请填写申请金额").fill("1234.56");
  await page.getByRole("button", { name: "下一步" }).click();
  await drawer.locator('[data-field="payeeName"] input').fill("服务供应商");
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: "保存草稿" }).click();

  await expect(page.getByRole("heading", { name: "零星费用" })).toBeVisible();
  await expect.poll(() => posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    claimType: "incidental_expense",
    incidentalExpenseCategory: "temporary_service",
    companyEntityId: "company-1",
    projectId: "project-1",
    requestedAmountCents: "123456",
    payeeName: "服务供应商"
  });
  await page.getByText("附件与证据", { exact: true }).click();
  await page.locator(".expense-claim-detail__attachments input[type=file]").setInputFiles({
    name: "服务说明.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("expense-attachment")
  });
  await page.getByRole("button", { name: "上传并绑定附件" }).click();
  await expect.poll(() => attachments).toEqual(["expense-file-1"]);
  await expect(page.getByRole("cell", { name: "服务说明.pdf", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "提交审批" }).click();
  await page.getByRole("button", { name: "确认提交" }).click();
  await expect.poll(() => submitted).toEqual(["expense-claim-created"]);
  await expect(page.getByText("审批中", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "办理审批" }).click();
  await page.getByRole("button", { name: "提交办理" }).click();
  await page.getByRole("button", { name: "确认办理" }).click();
  await expect.poll(() => reviewed).toEqual(["expense-claim-created"]);
  await expect(page.getByText("待公司付款", { exact: true })).toBeVisible();
  await page.getByText("附件与证据", { exact: true }).click();
  await page.locator(".expense-claim-detail__attachments input[type=file]").setInputFiles({
    name: "审批后补充资料.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("expense-post-submit-evidence")
  });
  await page.getByRole("button", { name: "追加并绑定资料" }).click();
  await expect.poll(() => appendedEvidence).toEqual(["expense-file-1"]);
  await expect(page.getByRole("cell", { name: "后续追加资料", exact: true })).toBeVisible();
});

test("普通报销保留错误输入并按四位原值保存费用明细", async ({ page }) => {
  const posted: unknown[] = [];
  await mockExpenseClaimSession(page, [], posted);
  await page.route("**/api/expense-claims/expense-categories?*", route => route.fulfill({ json: { categories: [] } }));
  await page.route("**/api/expense-claims/selectable-purchase-batches?*", route => route.fulfill({ json: { batches: [] } }));
  await page.route("**/api/approval-forms/expense_claim/expense-claim-created/capability", route =>
    route.fulfill({ json: { availableActions: [] } }));
  await page.route("**/api/expense-claims/expense-claim-created", route => route.fulfill({
    json: {
      ...expenseClaim({ id: "expense-claim-created", status: "draft", requestedAmountCents: "1235", requestedAmountYuan: "12.3456" }),
      approval: null,
      lines: [{
        id: "line-four-place", sortOrder: 1, expenseCategory: "车辆使用费", purpose: "油费",
        occurredOn: "2026-07-22", quantity: null, receiptCount: 0, amountCents: "1235",
        amountYuan: "12.3456", evidenceType: "invoice", noEvidenceReason: null, remark: null
      }],
      attachments: [], paymentExecutions: [], entrySnapshots: []
    }
  }));
  await login(page);
  await page.goto("/费用与报销工作台");
  await page.getByRole("button", { name: "新建费用申请" }).click();
  await page.getByRole("button", { name: "下一步" }).click();

  const drawer = page.locator(".t-drawer");
  await drawer.getByPlaceholder("请填写事由").fill("四位费用测试");
  const requestAmount = drawer.getByPlaceholder("请填写申请金额");
  await requestAmount.fill("12.34567");
  await drawer.getByRole("button", { name: "下一步" }).click();
  await expect(drawer.getByText(/申请金额.*4位小数/)).toBeVisible();
  await expect(requestAmount).toHaveValue("12.34567");
  expect(posted).toHaveLength(0);

  await requestAmount.fill("12.3456");
  const grid = drawer.locator("revo-grid");
  for (const [column, value] of [[0, "车辆使用费"], [2, "油费"], [5, "12.3456"]] as const) {
    await grid.locator(`revogr-data [data-rgrow="0"][data-rgcol="${column}"]`).dblclick();
    const editor = grid.locator("revogr-edit input");
    await editor.fill(value);
    await editor.press("Enter");
  }
  await drawer.getByRole("button", { name: "下一步" }).click();
  await drawer.getByRole("button", { name: "下一步" }).click();
  await expect(drawer.getByText("1 行；合计 12.3456 元")).toBeVisible();
  await drawer.getByRole("button", { name: "保存草稿" }).click();
  await expect.poll(() => posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    requestedAmountYuan: "12.3456",
    lines: [{ expenseCategory: "车辆使用费", purpose: "油费", amountYuan: "12.3456" }]
  });
  expect(posted[0]).not.toHaveProperty("requestedAmountCents");
  expect(posted[0]).not.toHaveProperty("lines.0.amountCents");
  await expect(page.getByText("¥12.3456", { exact: true })).toBeVisible();
  await page.getByText("费用明细", { exact: true }).click();
  await expect(page.getByRole("cell", { name: "¥12.3456", exact: true })).toBeVisible();
});

test("旧借款草稿显示历史附件且不再显示草稿操作", async ({ page }) => {
  await mockExpenseClaimSession(page, []);
  await page.route("**/api/expense-claims/historical-loan-draft", route => route.fulfill({
    json: {
      ...expenseClaim({ id: "historical-loan-draft", code: "JK-HISTORY-001", claimType: "loan", status: "draft", reason: "旧借款草稿" }),
      canDeleteDraft: true, canEditReturnedDraft: true,
      submittedAt: null, approvedAt: null, lines: [], loanDisbursements: [], loanRepayments: [],
      attachments: [{
        id: "historical-attachment", fileId: "historical-file", fileName: "旧借款资料.pdf", mimeType: "application/pdf",
        category: "receipt_or_other", stage: "draft", fileStatus: "active", removedAt: null
      }]
    }
  }));
  await login(page);
  await page.goto("/费用与报销/historical-loan-draft");
  await expect(page.getByRole("heading", { name: "借款申请" })).toBeVisible();
  for (const name of ["修改草稿", "删除草稿", "提交审批", "重新提交审批"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  await page.getByText("附件与证据", { exact: true }).click();
  await expect(page.locator(".expense-claim-detail__attachment-table").getByText("旧借款资料.pdf", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "上传并绑定附件", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "移除", exact: true })).toHaveCount(0);
});

test("公司日常报销不选择事实证明人也可填写明细", async ({ page }) => {
  await mockExpenseClaimSession(page, []);
  await page.route("**/api/expense-claims/create-options", route => route.fulfill({
    json: {
      companyEntities: [{ id: "company-1", name: "建工智管有限公司" }],
      projects: [],
      selfProjectIds: [],
      selfApplicantUserId: "expense-claim-canary",
      canProxy: false,
      applicantUsers: [],
      factWitnessUsers: [],
      entryDefinition: EXPENSE_CLAIM_ENTRY_DEFINITION,
      availableActions: ["create_expense_claim"]
    }
  }));
  await page.route("**/api/expense-claims/expense-categories?*", route => route.fulfill({ json: { categories: [] } }));
  await page.route("**/api/expense-claims/selectable-purchase-batches?*", route => route.fulfill({ json: { batches: [] } }));
  await login(page);
  await page.goto("/费用与报销工作台");
  await page.getByRole("button", { name: "新建费用申请" }).click();
  await expect(page.getByText("事实证明人（选填）", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByText(/公司常用费用类别/)).toBeVisible();
});

test("报销并联审批重新核对所选职责后提交准确轮次和职责", async ({ page }) => {
  await mockExpenseClaimSession(page, []);
  const writes: unknown[] = [];
  let parallel = true;
  let duties = [{ index: 0, name: "综合部主管" }, { index: 1, name: "财务主管" }];
  await page.route("**/api/expense-claims/expense-claim-1", route => route.fulfill({
    json: {
      ...expenseClaim({ status: "approval_pending" }),
      approval: parallel
        ? { currentNodeName: "并联审批", canReview: Boolean(duties.length), requiresSelfReviewConfirmation: false,
            approvalInstanceId: "round-1", actionableDuties: duties }
        : { currentNodeName: "综合部主管", canReview: true, requiresSelfReviewConfirmation: false },
      attachmentPermissions: { canAppendEvidence: false },
      lines: [], attachments: [], paymentExecutions: [], entrySnapshots: []
    }
  }));
  await page.route("**/api/expense-claims/expense-claim-1/capability", route => route.fulfill({
    json: { claimId: "expense-claim-1", availableActions: ["review_expense_claim"] }
  }));
  await page.route("**/api/expense-claims/expense-claim-1/approval", route => {
    writes.push(route.request().postDataJSON());
    duties = [];
    return route.fulfill({ status: 201, json: { id: "expense-claim-1", status: "approval_pending" } });
  });
  await login(page);
  await page.goto("/费用与报销/expense-claim-1");
  await page.getByRole("button", { name: "办理审批" }).click();

  const submit = page.getByRole("button", { name: "提交办理" });
  const select = page.getByPlaceholder("请选择本次办理的职责");
  await expect(submit).toBeDisabled();
  await select.click();
  await page.getByText("综合部主管", { exact: true }).click();
  duties = [{ index: 1, name: "财务主管" }];
  await submit.click();
  await page.getByRole("button", { name: "确认办理" }).click();
  await expect(page.getByRole("button", { name: "确认办理" })).toBeHidden();
  await expect(page.locator(".t-alert").getByText("所选审批职责已变化，请重新选择")).toBeVisible();
  expect(writes).toEqual([]);

  await select.click();
  await page.getByText("财务主管", { exact: true }).click();
  await submit.click();
  await page.getByRole("button", { name: "确认办理" }).click();
  const parallelWrite = { decision: "approve", approvalInstanceId: "round-1", approvalDutyIndex: 1 };
  await expect.poll(() => writes).toEqual([parallelWrite]);

  parallel = false;
  await page.reload();
  await page.getByRole("button", { name: "办理审批" }).click();
  await expect(select).toHaveCount(0);
  await submit.click();
  await page.getByRole("button", { name: "确认办理" }).click();
  await expect.poll(() => writes).toEqual([parallelWrite, { decision: "approve" }]);
});

test("撤回零星费用后修改同一份草稿并提交新审批轮次", async ({ page }) => {
  await mockExpenseClaimSession(page, []);
  const claimId = "expense-claim-1";
  const editedAt = "2026-11-24T08:00:00.000Z";
  const writes: unknown[] = [];
  let status = "approval_pending";
  let roundId: string | null = "round-original";
  let reason = "现场临时费用";
  let requestedAmountCents = "123456";
  await page.route("**/api/expense-claims/expense-claim-1", route => route.fulfill({
    json: {
      ...expenseClaim({ claimType: "incidental_expense", status, reason, requestedAmountCents }),
      updatedAt: editedAt,
      approvalInstanceId: roundId,
      canWithdrawApproval: status === "approval_pending",
      canEditReturnedDraft: status === "draft",
      approval: roundId ? { currentNodeName: "并联审批", approvalInstanceId: roundId, canReview: false, actionableDuties: [] } : null,
      attachmentPermissions: { canAppendEvidence: false },
      lines: [], attachments: [], paymentExecutions: [], entrySnapshots: []
    }
  }));
  await page.route("**/api/expense-claims/expense-claim-1/capability", route => route.fulfill({
    json: { claimId, availableActions: status === "draft"
      ? ["edit_returned_expense_claim", "submit_expense_claim"] : ["withdraw_expense_claim"] }
  }));
  await page.route("**/api/expense-claims/expense-claim-1/withdrawal", route => {
    writes.push(route.request().postDataJSON());
    status = "draft";
    roundId = null;
    return route.fulfill({ status: 201, json: { id: claimId, status } });
  });
  await page.route("**/api/expense-claims/expense-claim-1/draft", route => {
    const body = route.request().postDataJSON();
    writes.push(body);
    reason = body.reason;
    requestedAmountCents = body.requestedAmountCents;
    return route.fulfill({ json: { id: claimId, status, requestedAmountCents } });
  });
  await page.route("**/api/expense-claims/expense-claim-1/submission", route => {
    writes.push("submission");
    status = "approval_pending";
    roundId = "round-new";
    return route.fulfill({ status: 201, json: { id: claimId, status, approvalInstanceId: roundId } });
  });

  await login(page);
  await page.goto(`/费用与报销/${claimId}`);
  await page.getByRole("button", { name: "撤回审批" }).click();
  await page.getByRole("button", { name: "确认撤回" }).click();
  await page.getByRole("button", { name: "修改草稿" }).click();
  await page.getByPlaceholder("请填写费用事由").fill("修订现场临时费用");
  await page.getByPlaceholder("请填写申请金额").fill("128.50");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("button", { name: "保存修改" })).toBeHidden();
  await expect(page.getByText("修订现场临时费用", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重新提交审批" }).click();
  await page.getByRole("button", { name: "确认提交" }).click();
  await expect.poll(() => writes).toEqual([
    { approvalInstanceId: "round-original" },
    { expectedUpdatedAt: editedAt, reason: "修订现场临时费用", requestedAmountCents: "12850" },
    "submission",
  ]);
  await expect(page.getByRole("button", { name: "修改草稿" })).toBeHidden();
});

test("手机修改退回报销的明细，金额校验失败后保留输入", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockExpenseClaimSession(page, []);
  const claimId = "expense-claim-1";
  const expectedUpdatedAt = "2026-11-24T08:00:00.000Z";
  const savedLine = { expenseCategory: "交通费", occurredOn: "2026-11-23", purpose: "现场交通",
    receiptCount: 0, amountCents: "123456", evidenceType: "none", noEvidenceReason: "遗失车票", remark: "补说明" };
  const writes: unknown[] = [];
  await page.route("**/api/expense-claims/expense-claim-1", route => route.fulfill({
    json: {
      ...expenseClaim({ status: "draft" }),
      updatedAt: expectedUpdatedAt,
      canEditReturnedDraft: true,
      returnedDraftEntryDefinition: EXPENSE_CLAIM_ENTRY_DEFINITION,
      approval: null,
      lines: [{ id: "original-line", sortOrder: 1, quantity: null, ...savedLine }],
      attachments: [], paymentExecutions: [], entrySnapshots: []
    }
  }));
  await page.route("**/api/expense-claims/expense-claim-1/capability", route => route.fulfill({ json: {
    claimId, availableActions: ["edit_returned_expense_claim", "submit_expense_claim"]
  } }));
  await page.route("**/api/expense-claims/expense-claim-1/draft", route => {
    writes.push(route.request().postDataJSON());
    return writes.length === 1
      ? route.fulfill({ status: 422, json: { message: "请复核原始单据金额" } })
      : route.fulfill({ json: { id: claimId, status: "draft" } });
  });

  await login(page);
  await page.goto(`/费用与报销/${claimId}`);
  await page.getByRole("button", { name: "修改草稿" }).click();
  const lineAmount = page.locator('[data-field="amountYuan"] input, input[data-field="amountYuan"]');
  await expect(lineAmount).toHaveValue("1234.56");
  const save = page.getByRole("button", { name: "保存修改" });
  await lineAmount.fill("128.56789");
  await save.click();
  await expect(page.getByText(/第 1 行费用金额.*4位小数/)).toBeVisible();
  await expect(lineAmount).toHaveValue("128.56789");
  expect(writes).toEqual([]);

  await lineAmount.fill("128.5678");
  await save.click();
  await expect(page.getByText("请复核原始单据金额", { exact: true })).toBeVisible();
  await expect(lineAmount).toHaveValue("128.5678");
  await save.click();
  await expect(save).toBeHidden();
  const { amountCents: _legacyCents, ...line } = savedLine;
  const edit = {
    expectedUpdatedAt,
    reason: "项目现场交通费",
    lines: [{ ...line, amountYuan: "128.5678" }]
  };
  expect(writes).toEqual([edit, edit]);
});

test("已批待付款报销只通过受权接口调整实际付款主体并显示审计原因", async ({ page }) => {
  const requestedViews: string[] = [];
  const payerAdjustments: unknown[] = [];
  await mockExpenseClaimSession(page, requestedViews, [], [], [], [], [], true, payerAdjustments);
  await login(page);

  await page.goto("/费用与报销工作台");
  await page.getByRole("table").getByText("BX-20260723-001", { exact: true }).click();
  await expect(page.getByRole("button", { name: "调整", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "调整", exact: true }).click();
  await expect(page.getByText("调整实际付款主体", { exact: true })).toBeVisible();
  await page.getByPlaceholder("请选择已启用且资料完整的公司主体").click();
  await page.getByText("集团资金公司", { exact: true }).last().click();
  await page.getByPlaceholder("请说明实际付款主体与使用单位不一致的原因").fill("集团统一付款");
  await page.getByRole("button", { name: "确认调整", exact: true }).click();
  await expect(page.getByText("确认写入实际付款主体调整", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认写入", exact: true }).click();

  await expect.poll(() => payerAdjustments).toEqual([{ companyEntityId: "company-pay", reason: "集团统一付款" }]);
  await expect(page.locator(".expense-claim-detail__payment-subject").getByText("集团资金公司", { exact: true })).toBeVisible();
  await expect(page.getByText(/已调整：集团统一付款/)).toBeVisible();
});

test("财务登记带凭证的公司补付，只调用新的受控付款事实接口", async ({ page }) => {
  const requestedViews: string[] = [];
  const companyPayments: unknown[] = [];
  await mockExpenseClaimSession(page, requestedViews, [], [], [], [], [], false, [], companyPayments);
  await login(page);

  await page.goto("/费用与报销/expense-claim-1");
  await page.getByRole("button", { name: "登记公司补付" }).click();
  const paymentDrawer = page.locator(".t-drawer").filter({ hasText: "登记费用报销公司补付" });
  await paymentDrawer.getByPlaceholder("例如 1250").fill("1000");
  await paymentDrawer.getByPlaceholder("YYYY-MM-DD").fill("2026-07-24");
  await paymentDrawer.getByPlaceholder("例如：银行转账").fill("银行转账");
  await paymentDrawer.locator("input[type=file]").setInputFiles({
    name: "公司补付凭证.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("reimbursement-payment-voucher")
  });
  await paymentDrawer.getByPlaceholder("用于确认本次实际付款").fill("E2e@2026");
  await paymentDrawer.getByRole("button", { name: "确认登记", exact: true }).click();
  await expect(page.getByText("确认登记公司补付", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认写入", exact: true }).click();

  await expect.poll(() => companyPayments).toEqual([{
    amountCents: "100000",
    paidAt: "2026-07-24",
    paymentMethod: "银行转账",
    voucherFileId: "expense-file-1",
    confirmationPassword: "E2e@2026"
  }]);
});

test("报销实付选定公司与已核来源，丢响应后刷新仍使用原凭证", async ({ page }) => {
  await mockExpenseClaimSession(page, [], [], [], [], [], [], false, [], [], true);
  const requests: unknown[] = [];
  let uploads = 0;
  const project = { id: "project-1" };
  await page.route(url => url.pathname === "/api/fund-accounts", route => {
    expect(new URL(route.request().url()).searchParams.get("includeSourceOwnership")).toBe("true");
    const account = { active: true, kind: "company", balanceYuan: "125.5000", asOfDate: "2026-07-20" };
    return route.fulfill({ json: { accounts: [{
      ...account, scopeKey: "company:other", name: "核验实际付款乙公司", companyEntityId: "company-other",
      currentRegistrationId: "registration", sources: [
        { id: "owned-source", amountYuan: "125.5000", sourceName: "已核公司自有", sourceStatus: "known", projectStatus: "company_daily", isCompanyOwnedUnadvanced: true },
        { id: "wrong-source", amountYuan: "125.5000", sourceName: "未核公司来源", sourceStatus: "known", projectStatus: "company_daily" },
      ],
    }, {
      ...account, active: false, scopeKey: "company:inactive", name: "已停用公司", companyEntityId: "inactive",
      currentRegistrationId: "inactive-registration", sources: [
        { id: "other-batch", amountYuan: "125.5000", projectId: project.id, projectStatus: "project" },
      ],
    }] } });
  });
  await page.route(url => url.pathname === "/api/expense-claims/expense-claim-1/payment-voucher-file-uploads", route => {
    uploads++;
    return route.fulfill({ status: 201, json: { id: "shared-voucher" } });
  });
  await page.route(url => url.pathname === "/api/expense-claims/expense-claim-1/payments", route => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) return route.abort("failed");
    return route.fulfill({ status: 201, json: { id: "payment-registered", status: "partially_paid" } });
  });
  await login(page);
  await page.goto("/费用与报销/expense-claim-1");
  await page.getByRole("button", { name: "登记公司补付" }).click();
  let drawer = page.locator(".t-drawer:visible").filter({ hasText: /登记费用报销公司补付|核对原实际付款/ });
  await drawer.getByText("确认使用已登记公司账户和资金来源").click();
  await drawer.getByPlaceholder("YYYY-MM-DD").fill("2026-07-24");
  await drawer.getByPlaceholder("请选择实际付款的已登记账户").click();
  await page.getByText("核验实际付款乙公司", { exact: true }).click();
  await expect(drawer.getByText("未核公司来源")).toHaveCount(0);
  await drawer.getByPlaceholder("例如 1250").fill("20");
  await drawer.locator("label").filter({ hasText: "已核公司自有" }).locator("input").fill("20");
  await drawer.locator("input[type=file]").setInputFiles({
    name: "实付凭证.pdf", mimeType: "application/pdf", buffer: Buffer.from("synthetic"),
  });
  await drawer.getByPlaceholder("用于确认本次实际付款").fill("E2e@2026");
  await drawer.getByRole("button", { name: "确认登记", exact: true }).click();
  await page.getByRole("button", { name: "确认写入", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);

  await page.reload();
  await page.getByRole("button", { name: "核对原实际付款" }).click();
  drawer = page.locator(".t-drawer:visible").filter({ hasText: /登记费用报销公司补付|核对原实际付款/ });
  await expect(drawer.locator("input[type=file]")).toHaveCount(0);
  await expect(drawer.getByPlaceholder("例如 1250")).toBeDisabled();
  await drawer.getByPlaceholder("用于确认本次实际付款").fill("E2e@2026");
  await drawer.getByRole("button", { name: "继续核对原付款" }).click();
  await page.getByRole("button", { name: "确认写入", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(uploads).toBe(1);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[0]).toMatchObject({ amountCents: "2000", voucherFileId: "shared-voucher", registeredFunding: {
    scopeKey: "company:other", expectedRegistrationId: "registration",
    sourceAllocations: [{ sourceBatchId: "owned-source", amountCents: "2000" }],
  } });
});

test("公共现金已登记付款通过精确读回完成核对", async ({ page }) => {
  await mockExpenseClaimSession(page, []);
  const attemptKey = "jiangkong-expense-registered-payment:expense-claim-canary:expense-claim-1";
  const pending = {
    amountCents: "2000", paidAt: "2026-07-24", paymentMethod: "现金", voucherFileId: "cash-voucher",
    registeredFunding: { scopeKey: "public_cash", expectedRegistrationId: "registration",
      sourceAllocations: [{ sourceBatchId: "cash-source", amountCents: "2000" }] }
  };
  let detailReads = 0;
  let paymentWrites = 0;
  await page.route("**/api/expense-claims/expense-claim-1", route => {
    detailReads++;
    const recorded = detailReads > 1;
    return route.fulfill({ json: expenseClaim({
      status: recorded ? "paid" : "approved_pending_payment", fundedAmountCents: recorded ? pending.amountCents : "0",
      attachments: [], lines: [],
      fundsPermissions: { canRecordPayment: false, canRecordPublicCashPayment: false },
      paymentExecutions: recorded ? [{
        id: "cash-execution", amountCents: pending.amountCents, paidAt: "2026-07-24T00:00:00.000Z",
        paymentMethod: pending.paymentMethod, voucherFileId: pending.voucherFileId,
        recordedByUserId: "expense-claim-canary", note: null, createdAt: "2026-07-24T09:00:00.000Z",
        registeredFunding: { actualPayerKind: "public_cash", actualPayerName: "公共现金" }
      }] : []
    }) });
  });
  await page.route("**/api/expense-claims/expense-claim-1/payments", route => {
    paymentWrites++;
    return route.fulfill({ status: 409, json: {} });
  });
  await login(page);
  await page.evaluate(({ attemptKey, pending }) => sessionStorage.setItem(attemptKey, JSON.stringify(pending)), { attemptKey, pending });
  await page.goto("/费用与报销/expense-claim-1");
  await page.getByRole("button", { name: "核对原实际付款" }).click();
  await page.getByPlaceholder("用于确认本次实际付款").fill("E2e@2026");
  await page.getByRole("button", { name: "继续核对原付款" }).click();
  await page.getByRole("button", { name: "确认写入", exact: true }).click();

  await expect.poll(() => page.evaluate(key => sessionStorage.getItem(key), attemptKey)).toBeNull();
  await expect(page.getByRole("button", { name: "核对原实际付款" })).toHaveCount(0);
  expect(detailReads).toBeGreaterThanOrEqual(2);
  expect(paymentWrites).toBe(0);
});

test("历史借款保留余额与资金记录，旧客户端权限也不再显示办理动作", async ({ page }) => {
  await mockExpenseClaimSession(page, []);
  const writes: string[] = [];
  await page.route("**/api/expense-claims/loan-funds-1**", async route => {
    if (route.request().method() !== "GET") {
      writes.push(route.request().url());
      return route.fulfill({ status: 410, json: {} });
    }
    return route.fulfill({ json: {
      ...expenseClaim({
        id: "loan-funds-1", code: "JK-20260724-001", claimType: "loan", status: "disbursed",
        reason: "旧现场周转借款", requestedAmountCents: "100000", fundedAmountCents: "100000"
      }),
      fundsPermissions: {
        canRecordLoanDisbursement: true, canRecordLoanRepayment: true, canConfirmLoanRepayment: true,
        canReverseLoanRepayment: true, canGenerateLoanFinalDisbursementPdf: true
      },
      attachmentPermissions: { canAppendEvidence: true },
      loanAccount: { balanceAmountCents: "70000", fundedAmountCents: "100000", offsetAmountCents: "0", repaidAmountCents: "30000", reservedOffsetAmountCents: "0" },
      loanDisbursements: [{ id: "disbursement-1", amountCents: "100000", occurredAt: "2026-07-24", paymentMethod: "历史银行转账" }],
      loanRepayments: [
        { id: "repayment-1", amountCents: "30000", repaidAt: "2026-07-25", paymentMethod: "历史现金", status: "confirmed" },
        { id: "repayment-2", amountCents: "10000", repaidAt: "2026-07-26", paymentMethod: "旧待确认记录", status: "recorded" }
      ]
    } });
  });
  await login(page);
  await page.goto("/费用与报销/loan-funds-1");
  await expect(page.getByRole("heading", { name: "借款申请" })).toBeVisible();
  for (const name of ["登记实际放款", "登记员工还款", "生成放款归档 PDF"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  await page.getByText("资金结果", { exact: true }).click();
  await expect(page.getByText("当前借款余额").locator("..")).toContainText("¥700.00");
  await expect(page.getByText(/历史银行转账/)).toBeVisible();
  await expect(page.getByText(/历史现金/)).toBeVisible();
  await expect(page.getByText(/旧待确认记录/)).toBeVisible();
  for (const name of ["确认入账", "更正"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  await page.getByText("附件与证据", { exact: true }).click();
  await expect(page.getByRole("button", { name: "追加并绑定资料", exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
});

async function mockExpenseClaimSession(page: Page, requestedViews: string[], posted: unknown[] = [], submitted: string[] = [], reviewed: string[] = [], attached: string[] = [], appended: string[] = [], canAdjustPaymentSubject = false, payerAdjustments: unknown[] = [], companyPayments: unknown[] = [], registeredFunding = false) {
  let appendEvidenceAllowed = false;
  let paymentSubjectName = "建工智管有限公司";
  let paymentSubjectReason: string | null = null;
  await page.route("**/api/auth/login", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      user: {
        id: "expense-claim-canary",
        name: "费用金丝雀",
        phone: "13900000002",
        mustChangePassword: false,
        roleKeys: registeredFunding ? ["finance_staff"] : ["employee"],
        globalRoleKeys: registeredFunding ? ["finance_staff"] : []
      },
      tokens: { accessToken: "access-token", refreshToken: "refresh-token", expiresIn: 900 }
    })
  }));
  await page.route("**/api/me/work-items", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      generatedAt: "2026-07-23T00:00:00.000Z",
      visibleProjectCount: 0,
      queues: { pending: [], blocked: [], started: [] },
      approvalCenter: {
        pendingApproval: [], startedByMe: [], handledByMe: [], delegatedToMe: [], overdueReminder: []
      }
    })
  }));
  await page.route((url) => url.pathname === "/api/projects", (route) => route.fulfill({
    json: [{ id: "project-1", code: "JGXM-001", name: "科技园项目" }]
  }));
  await page.route((url) => url.pathname === "/api/expense-claims", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    posted.push(route.request().postDataJSON());
    return route.fulfill({
      status: 201,
      json: { id: "expense-claim-created", code: "LXFY-20260723-001", status: "draft", requestedAmountCents: "123456" }
    });
  });
  await page.route((url) => url.pathname === "/api/expense-claims/ledger", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const query = new URL(route.request().url()).searchParams;
    const view = query.get("view") ?? "all";
    const inProgress = view === "in_progress";
    requestedViews.push(view);
    const claim = expenseClaim({});
    const ledger: ExpenseClaimLedgerPage = {
      rows: [{
        id: claim.id, code: inProgress ? "BX-20260723-002" : claim.code,
        claimType: claim.claimType, claimTypeLabel: "费用报销", categoryLabel: "交通",
        status: inProgress ? "approval_pending" : claim.status,
        statusLabel: inProgress ? "审批中" : "待公司付款",
        projectId: claim.projectId, projectName: claim.project.name,
        companyName: claim.companyEntityNameSnapshot, applicantName: claim.applicantNameSnapshot,
        handledByName: claim.handledByNameSnapshot, reason: claim.reason, payeeName: claim.applicantNameSnapshot,
        requestedAmountCents: claim.requestedAmountCents, loanOffsetAmountCents: claim.loanOffsetAmountCents,
        companyPayableAmountCents: claim.companyPayableAmountCents, fundedAmountCents: claim.fundedAmountCents,
        updatedAt: claim.updatedAt
      }],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      summary: { total: 1, drafts: 0, inProgress: inProgress ? 1 : 0, pendingFunds: inProgress ? 0 : 1, knownAmountRows: 1 },
      filters: { view },
      columns: []
    };
    return route.fulfill({ json: ledger });
  });
  await page.route("**/api/expense-claims/expense-claim-1", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      ...expenseClaim({}), applicantPhoneSnapshot: null, proxyReason: null, factWitnessNameSnapshot: null,
      paymentMethod: null, payeeNameSnapshot: null, payeeAccountNameSnapshot: null, payeeBankNameSnapshot: null,
      payeeBankAccountSnapshot: null, loanExpectedClearanceAt: null, submittedAt: null, approvedAt: null,
      attachmentPermissions: { canAppendEvidence: true },
      originalDebtorCompanyId: registeredFunding ? "company-1" : undefined,
      paymentSubjectCompanyEntityId: paymentSubjectName === "集团资金公司" ? "company-pay" : "company-1",
      paymentSubjectNameSnapshot: paymentSubjectName,
      paymentSubjectAdjustmentReason: paymentSubjectReason,
      paymentSubjectAdjustedAt: paymentSubjectReason ? "2026-07-23T11:00:00.000Z" : null,
      paymentSubjectAdjustedByUserId: paymentSubjectReason ? "finance-1" : null,
      paymentSubjectAdjustedByRoleKey: paymentSubjectReason ? "finance_staff" : null,
      paymentSubjectPermissions: { canAdjust: canAdjustPaymentSubject },
      fundsPermissions: { canRecordPayment: registeredFunding, canRecordReimbursementPayment: true,
        canGenerateFinalPaymentPdf: false, canGenerateLoanFinalDisbursementPdf: false },
      paymentSubjectCompanyEntities: [{ id: "company-1", name: "建工智管有限公司" }, { id: "company-pay", name: "集团资金公司" }],
      paymentExecutions: [],
      finalPaymentPdf: null,
      attachments: [],
      lines: [{ id: "line-1", sortOrder: 1, expenseCategory: "交通", occurredOn: "2026-07-22T00:00:00.000Z", purpose: "项目现场交通费", receiptCount: 1, amountCents: "123456", evidenceType: "receipt_or_other", noEvidenceReason: null, remark: null }]
    })
  }));
  await page.route("**/api/expense-claims/create-options", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      companyEntities: [{ id: "company-1", name: "建工智管有限公司" }],
      projects: [{ id: "project-1", code: "JGXM-001", name: "科技园项目" }],
      selfProjectIds: ["project-1"],
      selfApplicantUserId: "expense-claim-canary",
      canProxy: false,
      applicantUsers: [{ id: "expense-claim-canary", name: "费用金丝雀" }],
      factWitnessUsers: [{ id: "witness-1", name: "事实证明人" }],
      entryDefinition: EXPENSE_CLAIM_ENTRY_DEFINITION,
      availableActions: ["create_expense_claim"]
    })
  }));
  await page.route("**/api/expense-claims/expense-claim-created", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      ...expenseClaim({ id: "expense-claim-created", code: "LXFY-20260723-001", claimType: "incidental_expense", status: reviewed.length ? "approved_pending_payment" : submitted.length ? "approval_pending" : "draft", reason: "现场零星服务", requestedAmountCents: "123456" }),
      applicantPhoneSnapshot: null, proxyReason: null, factWitnessNameSnapshot: null,
      paymentMethod: "bank_transfer", payeeNameSnapshot: null, payeeAccountNameSnapshot: null, payeeBankNameSnapshot: null,
      payeeBankAccountSnapshot: null, loanExpectedClearanceAt: null, submittedAt: null, approvedAt: null,
      approval: submitted.length && !reviewed.length ? { currentNodeName: "综合部主管", canReview: true, requiresSelfReviewConfirmation: false } : null,
      attachmentPermissions: { canAppendEvidence: appendEvidenceAllowed },
      attachments: [
        ...attached.map((fileId) => ({
          id: "attachment-1", fileId, fileName: "服务说明.pdf", mimeType: "application/pdf", sizeBytes: 18,
          fileStatus: "active", category: "receipt_or_other", expenseCategory: null, stage: "draft",
          attachedByUserId: "expense-claim-canary", attachedByName: "费用金丝雀", frozenAt: null, removedAt: null,
          createdAt: "2026-07-23T10:00:00.000Z"
        })),
        ...appended.map((fileId, index) => ({
          id: `attachment-appended-${index + 1}`, fileId, fileName: "审批后补充资料.pdf", mimeType: "application/pdf", sizeBytes: 28,
          fileStatus: "active", category: "receipt_or_other", expenseCategory: null, stage: "post_submit_append",
          attachedByUserId: "expense-claim-canary", attachedByName: "费用金丝雀", frozenAt: null, removedAt: null,
          createdAt: "2026-07-23T10:02:00.000Z"
        }))
      ],
      lines: []
    })
  }));
  await page.route("**/api/expense-claims/expense-claim-created/capability", route => route.fulfill({
    json: {
      claimId: "expense-claim-created",
      availableActions: reviewed.length ? ["append_expense_claim_attachment"] :
        submitted.length ? ["review_expense_claim"] :
        ["attach_expense_claim_attachment", "submit_expense_claim"]
    }
  }));
  await page.route("**/api/expense-claims/expense-claim-created/submission", (route) => {
    submitted.push("expense-claim-created");
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ id: "expense-claim-created", status: "approval_pending", submittedAt: "2026-07-23T10:00:00.000Z" })
    });
  });
  await page.route("**/api/expense-claims/expense-claim-created/approval", (route) => {
    reviewed.push("expense-claim-created");
    appendEvidenceAllowed = true;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "expense-claim-created", status: "approved_pending_payment", completed: true }) });
  });
  await page.route(/\/api\/expense-claims\/expense-claim-created\/(draft|append)-attachment-file-uploads$/, route => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({ id: "expense-file-1", originalName: "服务说明.pdf", mimeType: "application/pdf", sizeBytes: 18 })
  }));
  await page.route("**/api/expense-claims/expense-claim-created/attachments", (route) => {
    attached.push("expense-file-1");
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "attachment-1" }) });
  });
  await page.route("**/api/expense-claims/expense-claim-created/attachments/append", (route) => {
    appended.push("expense-file-1");
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "attachment-2" }) });
  });
  await page.route("**/api/expense-claims/expense-claim-1/payment-subject", (route) => {
    const payload = route.request().postDataJSON();
    payerAdjustments.push(payload);
    paymentSubjectName = "集团资金公司";
    paymentSubjectReason = "集团统一付款";
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ id: "expense-claim-1", paymentSubjectCompanyEntityId: "company-pay", paymentSubjectNameSnapshot: paymentSubjectName, paymentSubjectAdjustmentReason: paymentSubjectReason })
    });
  });
  await page.route(url => url.pathname === "/api/expense-claims/expense-claim-1/capability", route => route.fulfill({ json: {
    claimId: "expense-claim-1",
    availableActions: ["record_expense_claim_payment", ...(canAdjustPaymentSubject ? ["adjust_expense_claim_payment_subject"] : [])],
  } }));
  await page.route(url => url.pathname === "/api/expense-claims/expense-claim-1/payment-voucher-file-uploads", route =>
    route.fulfill({ status: 201, json: { id: "expense-file-1" } }));
  await page.route(url => url.pathname === "/api/approval-forms/expense_claim/expense-claim-1/capability", route =>
    route.fulfill({ json: { canDownload: false } }));
  await page.route(url => url.pathname === "/api/approval-progress", route =>
    route.fulfill({ json: { rounds: [] } }));
  await page.route("**/api/expense-claims/expense-claim-1/payments", (route) => {
    companyPayments.push(route.request().postDataJSON());
    return route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ id: "payment-1", expenseClaimId: "expense-claim-1", paidAmountCents: "100000", status: "paid" })
    });
  });
}

function expenseClaim(overrides: Partial<Record<string, unknown>>) {
  return {
    id: "expense-claim-1",
    code: "BX-20260723-001",
    claimType: "reimbursement",
    status: "approved_pending_payment",
    projectId: "project-1",
    project: { id: "project-1", code: "JGXM-001", name: "科技园项目" },
    companyEntityNameSnapshot: "建工智管有限公司",
    applicantNameSnapshot: "张三",
    handledByNameSnapshot: "费用金丝雀",
    reason: "项目现场交通费",
    requestedAmountCents: "123456",
    loanOffsetAmountCents: "23456",
    companyPayableAmountCents: "100000",
    fundedAmountCents: "0",
    updatedAt: "2026-07-23T10:30:00.000Z",
    paymentSubjectCompanyEntities: [],
    paymentSubjectPermissions: { canAdjust: false },
    ...overrides
  };
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000002");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL(url => url.pathname !== "/login");
}
