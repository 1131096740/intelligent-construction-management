import { expect, test, type Page } from "@playwright/test";
import {
  expectNoDocumentHorizontalOverflow,
  expectNoNestedHorizontalScrollers
} from "./helpers/responsive-assertions";

test("费用与报销工作台在桌面和手机尺寸读取新域个人事实并切换服务端视图", async ({ page }) => {
  const requestedViews: string[] = [];
  await mockExpenseClaimSession(page, requestedViews);
  await login(page);

  await page.goto("/费用与报销工作台");
  await expect(page.getByRole("heading", { name: "费用与报销工作台" })).toBeVisible();
  await expect(page.getByText("BX-20260723-001", { exact: true })).toBeVisible();
  await expect(page.getByText("由综合部某某代办", { exact: true })).toHaveCount(0);
  await page.getByText("BX-20260723-001", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "费用报销" })).toBeVisible();
  await expect(page.getByText("项目现场交通费", { exact: true })).toBeVisible();
  await page.goto("/费用与报销工作台");
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoDocumentHorizontalOverflow(page);
  await expectNoNestedHorizontalScrollers(page);
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.locator(".expense-claim-workbench__filter-field .t-select").click();
  await page.getByText("审批中", { exact: true }).last().click();
  await expect(page.getByText("BX-20260723-002", { exact: true })).toBeVisible();
  await expect.poll(() => requestedViews).toContain("in_progress");
});

test("费用工作台用创建选项和正式写入接口保存借款草稿后进入新域详情", async ({ page }) => {
  const requestedViews: string[] = [];
  const posted: unknown[] = [];
  const submitted: string[] = [];
  const reviewed: string[] = [];
  const attachments: string[] = [];
  const appendedEvidence: string[] = [];
  await mockExpenseClaimSession(page, requestedViews, posted, submitted, reviewed, attachments, appendedEvidence);
  await login(page);

  await page.goto("/费用与报销工作台");
  await page.getByRole("button", { name: "新建费用报销 / 借款" }).click();
  await expect(page.locator(".expense-claim-create__title")).toBeVisible();
  await page.getByText("借款申请", { exact: true }).last().click();
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByPlaceholder("说明费用事由和使用场景").fill("现场周转借款");
  await page.getByPlaceholder("最多 2 位小数").fill("1234.56");
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByPlaceholder("请选择日期").click();
  await page.locator(".t-date-picker__panel .t-date-picker__cell--now").click();
  await page.getByRole("button", { name: "下一步" }).click();
  await page.getByRole("button", { name: "保存草稿" }).click();

  await expect(page.getByRole("heading", { name: "借款申请" })).toBeVisible();
  await expect.poll(() => posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    claimType: "loan",
    companyEntityId: "company-1",
    projectId: "project-1",
    requestedAmountCents: "123456",
    loanExpectedClearanceOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
  });
  await page.getByText("附件与证据", { exact: true }).click();
  await page.locator(".expense-claim-detail__attachments input[type=file]").setInputFiles({
    name: "借款说明.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("expense-attachment")
  });
  await page.getByRole("button", { name: "上传并绑定附件" }).click();
  await expect.poll(() => attachments).toEqual(["expense-file-1"]);
  await expect(page.getByText("借款说明.pdf", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "提交审批" }).click();
  await page.getByRole("button", { name: "确认提交" }).click();
  await expect.poll(() => submitted).toEqual(["expense-claim-created"]);
  await expect(page.getByText("审批中", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "办理审批" }).click();
  await page.getByRole("button", { name: "提交办理" }).click();
  await page.getByRole("button", { name: "确认办理" }).click();
  await expect.poll(() => reviewed).toEqual(["expense-claim-created"]);
  await expect(page.getByText("待放款", { exact: true })).toBeVisible();
  await page.getByText("附件与证据", { exact: true }).click();
  await page.locator(".expense-claim-detail__attachments input[type=file]").setInputFiles({
    name: "审批后补充资料.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("expense-post-submit-evidence")
  });
  await page.getByRole("button", { name: "追加并绑定资料" }).click();
  await expect.poll(() => appendedEvidence).toEqual(["expense-file-1"]);
  await expect(page.getByText("后续追加资料", { exact: true })).toBeVisible();
});

test("已批待付款报销只通过受权接口调整实际付款主体并显示审计原因", async ({ page }) => {
  const requestedViews: string[] = [];
  const payerAdjustments: unknown[] = [];
  await mockExpenseClaimSession(page, requestedViews, [], [], [], [], [], true, payerAdjustments);
  await login(page);

  await page.goto("/费用与报销工作台");
  await page.getByText("BX-20260723-001", { exact: true }).click();
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

  await page.goto("/费用与报销工作台");
  await page.getByText("BX-20260723-001", { exact: true }).click();
  await page.getByRole("button", { name: "登记公司补付" }).click();
  const paymentDrawer = page.locator(".t-drawer").filter({ hasText: "登记费用报销公司补付" });
  await paymentDrawer.getByPlaceholder("例如 1250").fill("100000");
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

test("借款资金办理按放款、还款、主管确认和更正依次写入受控接口", async ({ page }) => {
  const requestedViews: string[] = [];
  const fundWrites: Array<{ kind: string; payload: unknown }> = [];
  await mockLoanFundSession(page, requestedViews, fundWrites);
  await login(page);

  await page.goto("/费用与报销/loan-funds-1");
  await expect(page.getByRole("heading", { name: "借款申请" })).toBeVisible();
  await expect(page.getByRole("button", { name: "登记实际放款" })).toBeVisible();
  await page.getByRole("button", { name: "登记实际放款" }).click();
  const disbursementDrawer = page.locator(".t-drawer").filter({ hasText: "登记借款实际放款" });
  await disbursementDrawer.getByPlaceholder("例如 1250").fill("100000");
  await disbursementDrawer.getByPlaceholder("YYYY-MM-DD").fill("2026-07-24");
  await disbursementDrawer.getByPlaceholder("例如：银行转账").fill("银行转账");
  await disbursementDrawer.locator("input[type=file]").setInputFiles({ name: "借款放款凭证.pdf", mimeType: "application/pdf", buffer: Buffer.from("loan-disbursement-voucher") });
  await disbursementDrawer.getByPlaceholder("用于确认本次资金事实").fill("E2e@2026");
  await disbursementDrawer.getByRole("button", { name: "确认登记", exact: true }).click();
  await expect(page.getByText("确认登记借款资金事实", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认写入", exact: true }).click();
  await expect.poll(() => fundWrites).toContainEqual({ kind: "disbursement", payload: {
    amountCents: "100000", paidAt: "2026-07-24", paymentMethod: "银行转账", voucherFileId: "expense-file-1", confirmationPassword: "E2e@2026"
  } });

  await page.getByRole("button", { name: "登记员工还款" }).click();
  const repaymentDrawer = page.locator(".t-drawer").filter({ hasText: "登记员工还款" });
  await repaymentDrawer.getByPlaceholder("例如 1250").fill("30000");
  await repaymentDrawer.getByPlaceholder("YYYY-MM-DD").fill("2026-07-24");
  await repaymentDrawer.getByPlaceholder("例如：银行转账").fill("现金");
  await repaymentDrawer.locator("input[type=file]").setInputFiles({ name: "员工还款凭证.pdf", mimeType: "application/pdf", buffer: Buffer.from("loan-repayment-voucher") });
  await repaymentDrawer.getByPlaceholder("用于确认本次资金事实").fill("E2e@2026");
  await repaymentDrawer.getByRole("button", { name: "确认登记", exact: true }).click();
  await expect(page.getByText("确认登记借款资金事实", { exact: true })).toBeVisible();
  const repaymentDetailReload = page.waitForResponse((response) => response.request().method() === "GET" && response.url().includes("/api/expense-claims/loan-funds-1"));
  await page.getByRole("button", { name: "确认写入", exact: true }).click();
  await repaymentDetailReload;
  await expect.poll(() => fundWrites).toContainEqual({ kind: "repayment", payload: {
    amountCents: "30000", repaidAt: "2026-07-24", paymentMethod: "现金", voucherFileId: "expense-file-1", confirmationPassword: "E2e@2026"
  } });

  await page.getByText("资金结果", { exact: true }).click();
  const repaymentRow = page.locator(".expense-claim-detail__repayment-row");
  await expect(repaymentRow).toHaveCount(1);
  await expect(repaymentRow).toContainText("待确认");
  await page.getByRole("button", { name: "确认入账" }).click();
  const confirmDialog = page.locator(".t-dialog").filter({ hasText: "确认员工还款" });
  await expect(confirmDialog).toHaveCount(1);
  await confirmDialog.getByPlaceholder("用于确认本次受控动作").fill("E2e@2026");
  const confirmationDetailReload = page.waitForResponse((response) => response.request().method() === "GET" && response.url().includes("/api/expense-claims/loan-funds-1"));
  await confirmDialog.getByRole("button", { name: "确认入账", exact: true }).click();
  await confirmationDetailReload;
  await expect.poll(() => fundWrites).toContainEqual({ kind: "confirmation", payload: { confirmationPassword: "E2e@2026" } });
  await expect(repaymentRow).toContainText("已确认");

  await page.getByRole("button", { name: "更正" }).click();
  const reversalDialog = page.locator(".t-dialog").filter({ hasText: "更正员工还款" });
  await expect(reversalDialog).toHaveCount(1);
  await reversalDialog.getByLabel("更正原因").fill("凭证金额录入错误");
  await reversalDialog.getByPlaceholder("用于确认本次受控动作").fill("E2e@2026");
  const reversalDetailReload = page.waitForResponse((response) => response.request().method() === "GET" && response.url().includes("/api/expense-claims/loan-funds-1"));
  await reversalDialog.getByRole("button", { name: "确认更正", exact: true }).click();
  await reversalDetailReload;
  await expect.poll(() => fundWrites).toContainEqual({ kind: "reversal", payload: { reason: "凭证金额录入错误", confirmationPassword: "E2e@2026" } });
  await expect(repaymentRow).toContainText("已更正");
});

async function mockLoanFundSession(page: Page, requestedViews: string[], fundWrites: Array<{ kind: string; payload: unknown }>) {
  await mockExpenseClaimSession(page, requestedViews);
  let phase: "pending" | "disbursed" | "recorded" | "confirmed" | "reversed" = "pending";
  const detail = () => {
    const repaymentStatus = phase === "recorded" ? "recorded" : phase === "confirmed" ? "confirmed" : phase === "reversed" ? "reversed" : null;
    const repaidAmountCents = phase === "confirmed" ? "30000" : "0";
    const balanceAmountCents = phase === "confirmed" ? "70000" : "100000";
    return {
      ...expenseClaim({
        id: "loan-funds-1", code: "JK-20260724-001", claimType: "loan", status: phase === "pending" ? "approved_pending_disbursement" : "disbursed",
        reason: "现场周转借款", requestedAmountCents: "100000", loanOffsetAmountCents: "0", companyPayableAmountCents: "0", fundedAmountCents: phase === "pending" ? "0" : "100000"
      }),
      applicantPhoneSnapshot: null, proxyReason: null, factWitnessNameSnapshot: null,
      paymentMethod: "bank_transfer", payeeNameSnapshot: null, payeeAccountNameSnapshot: null, payeeBankNameSnapshot: null, payeeBankAccountSnapshot: null,
      paymentSubjectCompanyEntityId: "company-1", paymentSubjectNameSnapshot: "建工智管有限公司", paymentSubjectAdjustmentReason: null, paymentSubjectAdjustedAt: null, paymentSubjectAdjustedByUserId: null, paymentSubjectAdjustedByRoleKey: null,
      loanExpectedClearanceAt: "2026-08-24T00:00:00.000Z", submittedAt: "2026-07-24T00:00:00.000Z", approvedAt: "2026-07-24T00:00:00.000Z",
      approval: null, attachmentPermissions: { canAppendEvidence: true }, paymentSubjectPermissions: { canAdjust: false }, paymentSubjectCompanyEntities: [],
      fundsPermissions: {
        canRecordReimbursementPayment: false, canGenerateFinalPaymentPdf: false, canGenerateLoanFinalDisbursementPdf: false,
        canRecordLoanDisbursement: phase === "pending", canRecordLoanRepayment: phase !== "pending", canConfirmLoanRepayment: true, canReverseLoanRepayment: true
      },
      paymentExecutions: [], finalPaymentPdf: null, attachments: [], lines: [],
      loanAccount: phase === "pending" ? null : { id: "loan-account-1", fundedAmountCents: "100000", offsetAmountCents: "0", repaidAmountCents, reservedOffsetAmountCents: "0", balanceAmountCents },
      loanDisbursements: phase === "pending" ? [] : [{ id: "disbursement-1", amountCents: "100000", occurredAt: "2026-07-24T00:00:00.000Z", paymentMethod: "银行转账", voucherFileId: "expense-file-1", note: null }],
      loanRepayments: repaymentStatus ? [{ id: "repayment-1", amountCents: "30000", repaidAt: "2026-07-24T00:00:00.000Z", paymentMethod: "现金", voucherFileId: "expense-file-1", status: repaymentStatus, confirmationNote: phase === "confirmed" ? "已核对" : null, reversalReason: phase === "reversed" ? "凭证金额录入错误" : null, createdAt: "2026-07-24T00:00:00.000Z" }] : []
    };
  };
  await page.route("**/api/expense-claims/loan-funds-1", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(detail()) }));
  await page.route("**/api/expense-claims/loan-funds-1/disbursements", (route) => {
    fundWrites.push({ kind: "disbursement", payload: route.request().postDataJSON() });
    phase = "disbursed";
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "disbursement-1", status: "disbursed" }) });
  });
  await page.route("**/api/expense-claims/loan-funds-1/repayments", (route) => {
    fundWrites.push({ kind: "repayment", payload: route.request().postDataJSON() });
    phase = "recorded";
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "repayment-1", status: "recorded" }) });
  });
  await page.route("**/api/expense-claims/loan-funds-1/repayments/repayment-1/confirmation", (route) => {
    fundWrites.push({ kind: "confirmation", payload: route.request().postDataJSON() });
    phase = "confirmed";
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "repayment-1", status: "confirmed" }) });
  });
  await page.route("**/api/expense-claims/loan-funds-1/repayments/repayment-1/reversal", (route) => {
    fundWrites.push({ kind: "reversal", payload: route.request().postDataJSON() });
    phase = "reversed";
    return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "repayment-1", status: "reversed" }) });
  });
}

async function mockExpenseClaimSession(page: Page, requestedViews: string[], posted: unknown[] = [], submitted: string[] = [], reviewed: string[] = [], attached: string[] = [], appended: string[] = [], canAdjustPaymentSubject = false, payerAdjustments: unknown[] = [], companyPayments: unknown[] = []) {
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
        roleKeys: ["employee"],
        globalRoleKeys: []
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
  await page.route("**/api/expense-claims*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST") {
      posted.push(request.postDataJSON());
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: "expense-claim-created", code: "JK-20260723-001", status: "draft", requestedAmountCents: "123456" })
      });
    }
    const view = url.searchParams.get("view") ?? "all";
    requestedViews.push(view);
    const body = view === "in_progress"
      ? [expenseClaim({ code: "BX-20260723-002", status: "approval_pending" })]
      : [expenseClaim({ code: "BX-20260723-001", status: "approved_pending_payment" })];
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/api/expense-claims/expense-claim-1", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      ...expenseClaim({}), applicantPhoneSnapshot: null, proxyReason: null, factWitnessNameSnapshot: null,
      paymentMethod: null, payeeNameSnapshot: null, payeeAccountNameSnapshot: null, payeeBankNameSnapshot: null,
      payeeBankAccountSnapshot: null, loanExpectedClearanceAt: null, submittedAt: null, approvedAt: null,
      attachmentPermissions: { canAppendEvidence: true },
      paymentSubjectCompanyEntityId: paymentSubjectName === "集团资金公司" ? "company-pay" : "company-1",
      paymentSubjectNameSnapshot: paymentSubjectName,
      paymentSubjectAdjustmentReason: paymentSubjectReason,
      paymentSubjectAdjustedAt: paymentSubjectReason ? "2026-07-23T11:00:00.000Z" : null,
      paymentSubjectAdjustedByUserId: paymentSubjectReason ? "finance-1" : null,
      paymentSubjectAdjustedByRoleKey: paymentSubjectReason ? "finance_staff" : null,
      paymentSubjectPermissions: { canAdjust: canAdjustPaymentSubject },
      fundsPermissions: { canRecordReimbursementPayment: true, canGenerateFinalPaymentPdf: false, canGenerateLoanFinalDisbursementPdf: false },
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
      canProxy: false,
      applicantUsers: [{ id: "expense-claim-canary", name: "费用金丝雀" }],
      factWitnessUsers: [{ id: "witness-1", name: "事实证明人" }]
    })
  }));
  await page.route("**/api/expense-claims/expense-claim-created", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      ...expenseClaim({ id: "expense-claim-created", code: "JK-20260723-001", claimType: "loan", status: reviewed.length ? "approved_pending_disbursement" : submitted.length ? "approval_pending" : "draft", reason: "现场周转借款", requestedAmountCents: "123456" }),
      applicantPhoneSnapshot: null, proxyReason: null, factWitnessNameSnapshot: null,
      paymentMethod: "bank_transfer", payeeNameSnapshot: null, payeeAccountNameSnapshot: null, payeeBankNameSnapshot: null,
      payeeBankAccountSnapshot: null, loanExpectedClearanceAt: "2026-07-23T00:00:00.000Z", submittedAt: null, approvedAt: null,
      approval: submitted.length && !reviewed.length ? { currentNodeName: "综合部主管", canReview: true, requiresSelfReviewConfirmation: false } : null,
      attachmentPermissions: { canAppendEvidence: appendEvidenceAllowed },
      attachments: [
        ...attached.map((fileId) => ({
          id: "attachment-1", fileId, fileName: "借款说明.pdf", mimeType: "application/pdf", sizeBytes: 18,
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
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "expense-claim-created", status: "approved_pending_disbursement", completed: true }) });
  });
  await page.route("**/api/files", (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({ id: "expense-file-1", originalName: "借款说明.pdf", mimeType: "application/pdf", sizeBytes: 18 })
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
    ...overrides
  };
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("请输入手机号").fill("13900000002");
  await page.getByPlaceholder("请输入密码").fill("E2e@2026");
  await page.getByRole("button", { name: "登录" }).click();
}
