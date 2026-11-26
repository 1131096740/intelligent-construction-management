import * as ExcelJS from "exceljs";
import { Reflector } from "@nestjs/core";
import { Prisma } from "@prisma/client";
import { PermissionGuard } from "../auth/guards/permission.guard";
import { Test } from "@nestjs/testing";
import { RetiredWriteEntryGuard } from "../retired-write-entry/retired-write-entry.guard";
import { FileService } from "../file/file.service";
import { ExpenseClaimController } from "./expense-claim.controller";
import { createApiValidationPipe } from "../validation/api-validation";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { ExpenseClaimService } from "./expense-claim.service";
import { appendRegisteredOperationalPayment, readRegisteredOperationalPayment } from "../fund-account/registered-operational-payment";

jest.mock("../fund-account/registered-operational-payment", () => ({
  appendRegisteredOperationalPayment: jest.fn(),
  readRegisteredOperationalPayment: jest.fn().mockResolvedValue(null)
}));

function createHarness(options?: { roles?: string[]; claim?: Record<string, unknown>; approvalAssignments?: Array<{ userId: string; positionId: string; role: string }>; auth?: { confirmPassword: jest.Mock }; files?: { assertFileHasNoBusinessBinding: jest.Mock }; approvalForms?: { generateForInstance: jest.Mock }; projectFunding?: { lockFundingContext: jest.Mock; allocateExecution: jest.Mock }; operatingSources?: { appendConfirmedSourceIfEnabledInTransaction: jest.Mock }; fundingNotifications?: { queue: jest.Mock; afterCommit: jest.Mock } }) {
  const approvalAssignments = options?.approvalAssignments ?? [];
  const tx = {
    companyEntity: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    projectParticipatingCompany: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    project: { findFirst: jest.fn().mockResolvedValue({ id: "project-1" }), findMany: jest.fn(), findUnique: jest.fn() },
    userPosition: { findMany: jest.fn().mockResolvedValue(approvalAssignments.length ? approvalAssignments.map(({ userId, positionId, role }) => ({ userId, positionId, projectId: role === "project_manager" ? "project-1" : null })) : (options?.roles ?? []).map((_, index) => ({ positionId: `position-${index}`, projectId: null }))) },
    projectMember: { findMany: jest.fn().mockResolvedValue([]) },
    projectRosterMember: { findMany: jest.fn().mockResolvedValue([{ projectId: "project-1" }]) },
    position: { findMany: jest.fn().mockResolvedValue(approvalAssignments.length ? approvalAssignments.map(({ positionId, role }) => ({ id: positionId, key: role })) : (options?.roles ?? []).map((key, index) => ({ id: `position-${index}`, key })) ) },
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: "user-a", name: "经办人", isActive: true }),
      findMany: jest.fn().mockResolvedValue(approvalAssignments.map(({ userId }) => ({ id: userId })))
    },
    expenseClaim: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), aggregate: jest.fn() },
    generalProcurement: { findUnique: jest.fn() },
    expenseClaimLine: { createMany: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    expenseClaimEntrySnapshot: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    expenseClaimAttachment: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    fileObject: { findUnique: jest.fn() },
    employeeProjectLoanAccount: { upsert: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    employeeProjectLoanEntry: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    employeeLoanRepayment: { create: jest.fn(), update: jest.fn() },
    expenseClaimPaymentExecution: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    paymentExecutionRefund: { aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 0n } }), findMany: jest.fn().mockResolvedValue([]) },
    expenseLoanOffsetReservation: { findMany: jest.fn().mockResolvedValue([]), aggregate: jest.fn().mockResolvedValue({ _max: { sequenceNo: null } }), createMany: jest.fn(), updateMany: jest.fn() },
    approvalInstance: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
    approvalActionLog: { create: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue(options?.claim ? [options.claim] : [])
  };
  const prisma = { projectParticipatingCompany: tx.projectParticipatingCompany, $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)), companyEntity: tx.companyEntity, expenseClaim: tx.expenseClaim, expenseClaimLine: tx.expenseClaimLine, expenseClaimAttachment: tx.expenseClaimAttachment, expenseClaimPaymentExecution: tx.expenseClaimPaymentExecution, employeeProjectLoanAccount: tx.employeeProjectLoanAccount, employeeProjectLoanEntry: tx.employeeProjectLoanEntry, employeeLoanRepayment: { findMany: jest.fn() }, pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) }, fileObject: { findMany: jest.fn() }, project: tx.project, user: tx.user, userPosition: tx.userPosition, projectMember: tx.projectMember, position: tx.position, approvalInstance: tx.approvalInstance };
  Object.assign(prisma, { expenseClaimEntrySnapshot: tx.expenseClaimEntrySnapshot, projectRosterMember: tx.projectRosterMember, paymentExecutionRefund: tx.paymentExecutionRefund });
  const numbering = { allocateDaily: jest.fn().mockResolvedValue("BX-20260723-001") };
  const audit = { record: jest.fn().mockResolvedValue({}) };
  const visibility = { businessProjectIdsInTransaction: jest.fn().mockResolvedValue(["project-1"]), visibleProjectIds: jest.fn().mockResolvedValue(["project-1"]), visibleProjectIdsInTransaction: jest.fn().mockResolvedValue(["project-1"]) };
  const service = new ExpenseClaimService(prisma as never, numbering as never, audit as never, options?.auth as never, visibility as never, options?.files as never, options?.approvalForms as never, options?.projectFunding as never, options?.operatingSources as never, undefined, options?.fundingNotifications as never);
  return { service, tx, prisma, numbering, audit, visibility };
}

it("exports every filtered expense ledger row visible to the employee", async () => {
  const { service, tx, audit } = createHarness({ roles: ["employee"] });
  const claim = {
    claimType: "reimbursement",
    status: "approved_pending_payment",
    projectId: "project-1",
    handledByUserId: "actor",
    applicantUserId: "actor",
    applicantNameSnapshot: "合成报销人",
    companyEntityNameSnapshot: "合成报销单位",
    requestedAmountCents: 800n,
    fundedAmountCents: 0n,
    loanOffsetAmountCents: 0n,
    companyPayableAmountCents: 800n,
    updatedAt: new Date("2026-11-25T00:00:00Z")
  };
  const rows = [
    { ...claim, id: "claim-1", code: "BX-001", reason: "=1+2 同批台账" },
    { ...claim, id: "claim-2", code: "BX-002", reason: "同批台账正常报销" },
    { ...claim, id: "claim-other-keyword", code: "BX-003", reason: "其他批次" },
    { ...claim, id: "claim-other-user", code: "BX-004", reason: "同批台账无权查看",
      applicantUserId: "outsider", handledByUserId: "outsider" }
  ];
  tx.expenseClaim.findMany.mockImplementation(async ({ where }: { where: { OR: Array<Record<string, string>> } }) =>
    rows.filter(row => where.OR.some(ownership => Object.entries(ownership).every(([key, value]) =>
      row[key as keyof typeof row] === value))));
  tx.project.findMany.mockResolvedValue([{ id: "project-1", code: "XM-001", name: "一号项目" }]);

  const filters = { keyword: "同批台账", pageSize: "1", columns: "reason" };
  const first = await service.listLedger("actor", { ...filters, page: "1" });
  const second = await service.listLedger("actor", { ...filters, page: "2" });
  expect(first.pagination.total).toBe(2);
  expect(first.rows.map(row => row.code)).toEqual(["BX-001"]);
  expect(second.rows.map(row => row.code)).toEqual(["BX-002"]);

  const exported = await service.exportLedger("actor", { ...filters, page: "1" });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(exported.buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet("费用与报销台账");
  if (!sheet) throw new Error("缺少费用与报销台账工作表");
  const header = sheet.getRow(1);
  expect([1, 2, 3, 4, 5, 6].map(column => header.getCell(column).value))
    .toEqual(["报销编号", "项目或使用单位", "报销单位", "报销人/借款人", "事由", "申请金额（元）"]);
  expect([2, 3].map(index => sheet.getRow(index).getCell(1).value)).toEqual(["BX-001", "BX-002"]);
  expect([2, 3].map(index => sheet.getRow(index).getCell(5).value))
    .toEqual(["'=1+2 同批台账", "同批台账正常报销"]);
  expect(audit.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    actorUserId: "actor",
    action: "expense_claim.ledger.export",
    metadata: expect.objectContaining({ exportedRows: 2 })
  }));
});

async function expectParticipantSerializationBoundary(
  makeHarness: () => ReturnType<typeof createHarness>,
  invoke: (service: ExpenseClaimService) => Promise<unknown>
) {
  const cases: Array<{ error: unknown; mapped: boolean }> = [
    { error: { code: "40001" }, mapped: true },
    { error: { code: "P2034", meta: { sqlstate: "40001" } }, mapped: true },
    { error: { code: "40P01" }, mapped: false },
    { error: { code: "P2034", meta: { sqlstate: "40P01" } }, mapped: false },
    { error: { code: "P2034" }, mapped: false },
    {
      error: { code: "P2010", meta: { database_error: "SQLSTATE 40001" } },
      mapped: false
    },
    { error: { message: "business token 40001" }, mapped: false },
    {
      error: new ConflictException("unrelated conflict", {
        cause: { code: "P2010", meta: { database_error: "SQLSTATE 40001" } }
      }),
      mapped: false
    }
  ];

  for (const { error, mapped } of cases) {
    const { service, prisma } = makeHarness();
    (prisma.$transaction as jest.Mock).mockRejectedValueOnce(error);
    const operation = invoke(service);
    if (mapped) {
      await expect(operation).rejects.toBeInstanceOf(ConflictException);
    } else {
      await expect(operation).rejects.toBe(error);
    }
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  }
}

const actor = { id: "user-a", name: "经办人", phone: "13800000000", isActive: true };

describe("employee loan application through HTTP", () => {
  it("retires valid loan requests while allowing incidental expense drafts", async () => {
    const files = { assertFileHasNoBusinessBinding: jest.fn().mockResolvedValue({ uploadedByUserId: actor.id }) };
    const { service, tx } = createHarness({ files });
    tx.expenseClaimAttachment.create.mockResolvedValue({ id: "attachment-1" });
    tx.user.findUnique.mockResolvedValue(actor);
    tx.companyEntity.findFirst.mockResolvedValue({ id: "company-1", name: "建工公司" });
    tx.expenseClaim.create.mockResolvedValue({ id: "claim-1", status: "draft" });
    const moduleRef = await Test.createTestingModule({
      controllers: [ExpenseClaimController],
      providers: [{ provide: ExpenseClaimService, useValue: service }]
    }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    app.use((request: { user?: { id: string } }, _response: unknown, next: () => void) => {
      request.user = actor;
      next();
    });
    app.useGlobalPipes(createApiValidationPipe());
    await app.listen(0, "127.0.0.1");

    try {
      const url = `${await app.getUrl()}/expense-claims`;
      const application = {
        companyEntityId: "company-1",
        projectId: "project-1",
        applicantUserId: actor.id,
        reason: "现场服务",
        requestedAmountCents: "1200"
      };
      const create = (body: object) => fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const retired = await create({ ...application, claimType: "loan", loanExpectedClearanceOn: "2026-12-01" });
      expect(retired.status).toBe(410);
      expect(tx.expenseClaim.create).not.toHaveBeenCalled();

      const incidental = await create({
        ...application,
        claimType: "incidental_expense",
        incidentalExpenseCategory: "temporary_service",
        payeeName: "服务商"
      });
      expect(incidental.status).toBe(201);
      expect(await incidental.json()).toMatchObject({ status: "draft", requestedAmountCents: "1200" });

      const updatedAt = new Date("2026-07-23T00:00:00Z");
      const historicalLoan = {
        ...application,
        id: "old-loan",
        handledByUserId: actor.id,
        claimType: "loan",
        status: "draft",
        requestedAmountCents: 1200n,
        updatedAt
      };
      tx.$queryRaw.mockResolvedValueOnce([historicalLoan]);
      const submit = await fetch(`${url}/old-loan/submission`, { method: "POST" });
      expect(submit.status).toBe(410);
      expect(tx.approvalInstance.create).not.toHaveBeenCalled();

      tx.expenseClaim.findUnique.mockResolvedValue({ ...historicalLoan, submittedAt: updatedAt });
      const edit = await fetch(`${url}/old-loan/draft`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedUpdatedAt: updatedAt.toISOString(), reason: "调整旧借款" })
      });
      expect(edit.status).toBe(410);
      expect(tx.expenseClaim.update).not.toHaveBeenCalled();

      const write = (suffix: string, body: object) => fetch(url + "/old-loan/" + suffix, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
      });
      tx.$queryRaw.mockResolvedValueOnce([historicalLoan]);
      expect((await write("attachments", { fileId: "existing-file", category: "receipt_or_other" })).status).toBe(410);
      expect(files.assertFileHasNoBusinessBinding).not.toHaveBeenCalled();
      tx.$queryRaw.mockResolvedValueOnce([historicalLoan]);
      expect((await write("attachments/old-attachment/removal", { reason: "尝试修改历史资料" })).status).toBe(410);
      expect(tx.expenseClaimAttachment.update).not.toHaveBeenCalled();
      tx.expenseClaim.findUnique.mockResolvedValue(historicalLoan);
      expect((await write("draft-deletion", { expectedUpdatedAt: updatedAt.toISOString() })).status).toBe(410);
    } finally {
      await app.close();
    }
  });
});

it("retires dedicated loan cash HTTP writes while preserving history and ordinary voucher upload", async () => {
  const attachmentBinding = jest.fn();
  const { service, tx, prisma } = createHarness({ roles: ["finance_staff"], files: { assertFileHasNoBusinessBinding: attachmentBinding } });
  const historical = {
    id: "historical-loan", code: "JK-001", claimType: "loan", projectId: "project-1",
    status: "disbursed", companyEntityId: "company-1", applicantUserId: actor.id, handledByUserId: actor.id,
    requestedAmountCents: 1200n, companyPayableAmountCents: 0n, loanOffsetAmountCents: 0n, fundedAmountCents: 1200n
  };
  tx.expenseClaim.findFirst.mockImplementation(async ({ where }) => where.id === "historical-loan" ? historical : {
    ...historical, id: "ordinary-expense", claimType: "incidental_expense", status: "approved_pending_payment",
    companyPayableAmountCents: 1200n, fundedAmountCents: 0n
  });
  tx.employeeProjectLoanAccount.findUnique.mockResolvedValue({ id: "account-1", fundedAmountCents: 1200n,
    offsetAmountCents: 0n, repaidAmountCents: 300n, reservedOffsetAmountCents: 0n, balanceAmountCents: 900n });
  tx.employeeProjectLoanEntry.findMany.mockResolvedValue([{ id: "disbursement-1", amountCents: 1200n, voucherFileId: "loan-voucher" }]);
  prisma.employeeLoanRepayment.findMany.mockResolvedValue([{ id: "repayment-1", amountCents: 300n,
    status: "confirmed", voucherFileId: "repayment-voucher" }]);
  prisma.pdfDocument.findFirst.mockResolvedValue({ id: "historic-pdf", fileId: "loan-pdf" });
  const files = { uploadPrivateFile: jest.fn().mockResolvedValue({ id: "ordinary-voucher" }) };
  const moduleRef = await Test.createTestingModule({
    controllers: [ExpenseClaimController],
    providers: [{ provide: ExpenseClaimService, useValue: service }, { provide: FileService, useValue: files }]
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.use((request: { user?: typeof actor }, _response: unknown, next: () => void) => {
    request.user = actor;
    next();
  });
  app.useGlobalGuards(new RetiredWriteEntryGuard());
  app.useGlobalPipes(createApiValidationPipe());
  await app.listen(0, "127.0.0.1");
  try {
    const base = `${await app.getUrl()}/expense-claims`;
    const historicalUrl = base + "/historical-loan";
    const upload = (url: string) => {
      const body = new FormData();
      body.append("file", new Blob(["synthetic voucher"], { type: "application/pdf" }), "凭证.pdf");
      return fetch(url, { method: "POST", body });
    };
    for (const route of ["disbursement-voucher-file-uploads", "repayment-voucher-file-uploads"]) {
      expect((await upload(historicalUrl + "/" + route)).status).toBe(410);
    }
    const confirmationPassword = "test-only-password";
    const common = { amountCents: "100", paymentMethod: "现金", voucherFileId: "unbound-file", confirmationPassword };
    for (const [route, body] of [
      ["disbursements", { ...common, paidAt: "2026-10-01" }],
      ["repayments", { ...common, repaidAt: "2026-10-01" }],
      ["repayments/repayment-1/confirmation", { confirmationPassword }],
      ["repayments/repayment-1/reversal", { confirmationPassword, reason: "合成更正" }],
      ["final-disbursement-pdf", {}]
    ] as const) {
      const result = await fetch(historicalUrl + "/" + route, { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      expect(result.status).toBe(410);
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(files.uploadPrivateFile).not.toHaveBeenCalled();

    const detail = await fetch(historicalUrl);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      finalPaymentPdf: { fileId: "loan-pdf" },
      loanAccount: { balanceAmountCents: "900" },
      loanDisbursements: [{ amountCents: "1200", voucherFileId: "loan-voucher" }],
      loanRepayments: [{ amountCents: "300", status: "confirmed", voucherFileId: "repayment-voucher" }]
    });
    expect(await (await fetch(historicalUrl + "/capability")).json()).toMatchObject({ availableActions: [] });
    expect(await (await fetch(historicalUrl + "/repayments/repayment-1/capability")).json())
      .toMatchObject({ repaymentId: "repayment-1", availableActions: [] });
    expect((await upload(historicalUrl + "/append-attachment-file-uploads")).status).toBe(403);
    tx.$queryRaw.mockResolvedValueOnce([historical]);
    const append = await fetch(historicalUrl + "/attachments/append", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ fileId: "unbound-file", category: "receipt_or_other" }) });
    expect(append.status).toBe(410);
    expect(attachmentBinding).not.toHaveBeenCalled();
    expect(tx.expenseClaimAttachment.create).not.toHaveBeenCalled();
    const allowed = await upload(base + "/ordinary-expense/payment-voucher-file-uploads");
    expect(allowed.status).toBe(201);
    expect(await allowed.json()).toEqual({ id: "ordinary-voucher" });
  } finally {
    await app.close();
  }
});

describe("ExpenseClaimService", () => {
  it("returns all selectable active company entities but only the actor's visible projects", async () => {
    const { service, tx } = createHarness();
    tx.companyEntity.findMany.mockResolvedValue([{ id: "company-1", name: "建工智管" }]);
    tx.project.findMany.mockResolvedValue([{ id: "project-1", code: "JGXM-001", name: "科技园项目" }]);
    tx.user.findMany.mockResolvedValue([{ id: "user-a", name: "经办人" }, { id: "user-b", name: "申请人" }]);
    await expect(service.createOptions("user-a")).resolves.toEqual(expect.objectContaining({ companyEntities: [{ id: "company-1", name: "建工智管" }], projects: [{ id: "project-1", code: "JGXM-001", name: "科技园项目" }], canProxy: false, applicantUsers: [{ id: "user-a", name: "经办人" }], factWitnessUsers: [{ id: "user-a", name: "经办人" }, { id: "user-b", name: "申请人" }], availableActions: ["create_expense_claim"] }));
    expect(tx.project.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
 id: { in: ["project-1"] }, isActive: true } }));
  });

  it("derives exact claim actions from the authorized server detail", async () => {
    const { service } = createHarness();
    jest.spyOn(service, "getMine").mockResolvedValue({
      id: "claim-1",
      handledByUserId: "handler-1",
      status: "draft",
      approval: null,
      attachmentPermissions: { canAppendEvidence: false },
      paymentSubjectPermissions: { canAdjust: false },
      fundsPermissions: {
        canRecordPayment: false,
        canRecordReimbursementPayment: false,
        canGenerateFinalPaymentPdf: false,
        canGenerateLoanFinalDisbursementPdf: false,
        canRecordLoanDisbursement: false,
        canRecordLoanRepayment: false,
        canConfirmLoanRepayment: false,
        canReverseLoanRepayment: false
      },
      attachments: [
        { id: "attachment-1", removedAt: null },
        { id: "attachment-2", removedAt: new Date() }
      ]
    } as never);

    await expect(
      service.getActionCapability("claim-1", "handler-1")
    ).resolves.toEqual({
      claimId: "claim-1",
      availableActions: [
        "submit_expense_claim",
        "attach_expense_claim_attachment",
        "remove_expense_claim_attachment"
      ],
      removableAttachmentIds: ["attachment-1"]
    });
  });

  it.each([
    [true, false],
    [false, true]
  ])("authorizes payment only for the requested funding scope", async (companyAvailable, cashAvailable) => {
    const { service } = createHarness();
    jest.spyOn(service, "getMine").mockResolvedValue({
      id: "claim-1",
      status: "approved_pending_payment",
      attachmentPermissions: { canAppendEvidence: false },
      paymentSubjectPermissions: { canAdjust: false },
      fundsPermissions: {
        canRecordPayment: companyAvailable,
        canRecordPublicCashPayment: cashAvailable
      }
    } as never);
    const company = await service.getActionCapability("claim-1", "finance-1");
    const publicCash = await service.getActionCapability("claim-1", "finance-1", "public_cash");
    expect(company.availableActions.includes("record_expense_claim_payment")).toBe(companyAvailable);
    expect(publicCash.availableActions.includes("record_expense_claim_payment")).toBe(cashAvailable);
  });

  it("retains read access to exact repayments without advertising retired money actions", async () => {
    const { service, tx } = createHarness();
    jest.spyOn(service, "getMine").mockResolvedValue({
      id: "claim-1",
      fundsPermissions: {
        canConfirmLoanRepayment: true,
        canReverseLoanRepayment: true
      },
      loanAccount: { id: "account-1", balanceAmountCents: "500" },
      loanRepayments: [
        { id: "repayment-recorded", status: "recorded", amountCents: "300" },
        { id: "repayment-confirmed", status: "confirmed", amountCents: "200" }
      ]
    } as never);
    tx.employeeProjectLoanEntry.findFirst.mockResolvedValue({
      id: "entry-1",
      entryType: "repayment",
      amountCents: 200n,
      balanceDeltaCents: -200n,
      sourceRepaymentId: "repayment-confirmed"
    });

    await expect(
      service.getRepaymentActionCapability(
        "claim-1",
        "repayment-recorded",
        "finance-director-1"
      )
    ).resolves.toEqual({
      claimId: "claim-1",
      repaymentId: "repayment-recorded",
      availableActions: []
    });
    await expect(
      service.getRepaymentActionCapability(
        "claim-1",
        "repayment-confirmed",
        "finance-director-1"
      )
    ).resolves.toEqual({
      claimId: "claim-1",
      repaymentId: "repayment-confirmed",
      availableActions: []
    });
  });
  it("reads a new-domain claim detail only for its applicant or handler", async () => {
    const { service, tx } = createHarness();
    tx.expenseClaim.findFirst.mockResolvedValue({ id: "claim-1", code: "BX-1", claimType: "reimbursement", status: "draft", projectId: "project-1", applicantUserId: "user-a", handledByUserId: "user-a", companyEntityNameSnapshot: "建工", applicantNameSnapshot: "申请人", applicantPhoneSnapshot: null, handledByNameSnapshot: "经办人", proxyReason: null, factWitnessNameSnapshot: null, reason: "交通", requestedAmountCents: 1200n, loanOffsetAmountCents: 0n, companyPayableAmountCents: 1200n, fundedAmountCents: 0n, paymentMethod: null, payeeNameSnapshot: null, payeeAccountNameSnapshot: null, payeeBankNameSnapshot: null, payeeBankAccountSnapshot: null, loanExpectedClearanceAt: null, submittedAt: null, approvedAt: null, updatedAt: new Date("2026-07-23") });
    tx.project.findUnique.mockResolvedValue({ id: "project-1", code: "JGXM-001", name: "科技园项目" });
    tx.expenseClaimLine.findMany.mockResolvedValue([{ id: "line-1", sortOrder: 1, expenseCategory: "交通", occurredOn: new Date("2026-07-22"), purpose: "现场", receiptCount: 1, amountCents: 1200n, evidenceType: "receipt_or_other", noEvidenceReason: null, remark: null }]);
    await expect(service.getMine("claim-1", "user-a")).resolves.toEqual(expect.objectContaining({ project: { id: "project-1", code: "JGXM-001", name: "科技园项目" }, requestedAmountCents: "1200", approval: null, lines: [expect.objectContaining({ amountCents: "1200" })] }));
    expect(tx.expenseClaim.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "claim-1" } }));
  });

  it("permits only the frozen current approver to read a pending claim and returns a minimal review projection", async () => {
    const { service, tx } = createHarness({ roles: ["comprehensive_director"] });
    tx.expenseClaim.findFirst.mockResolvedValue({ id: "claim-1", code: "BX-1", claimType: "reimbursement", status: "approval_pending", projectId: null, applicantUserId: "applicant-1", handledByUserId: "applicant-1", companyEntityNameSnapshot: "建工", applicantNameSnapshot: "申请人", applicantPhoneSnapshot: null, handledByNameSnapshot: "申请人", proxyReason: null, factWitnessNameSnapshot: null, reason: "交通", requestedAmountCents: 1200n, loanOffsetAmountCents: 0n, companyPayableAmountCents: 1200n, fundedAmountCents: 0n, paymentMethod: null, payeeNameSnapshot: null, payeeAccountNameSnapshot: null, payeeBankNameSnapshot: null, payeeBankAccountSnapshot: null, loanExpectedClearanceAt: null, submittedAt: new Date(), approvedAt: null, updatedAt: new Date() });
    tx.approvalInstance.findFirst.mockResolvedValue({ currentNodeIndex: 0, applicantUserId: "applicant-1", frozenNodes: [{ name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"], candidateUserIds: ["reviewer-1"], candidateUserIdsByRole: { comprehensive_director: ["reviewer-1"] } }] });
    tx.expenseClaimLine.findMany.mockResolvedValue([]);
    await expect(service.getMine("claim-1", "reviewer-1")).resolves.toEqual(expect.objectContaining({ approval: { currentNodeName: "综合部主管", canReview: true, requiresSelfReviewConfirmation: false } }));
  });

  it("lists only the current applicant or handler and serializes all money fields", async () => {
    const { service, tx } = createHarness();
    tx.expenseClaim.findMany.mockResolvedValue([{ id: "claim-1", code: "BX-1", claimType: "reimbursement", status: "draft", projectId: "project-1", companyEntityNameSnapshot: "建工", applicantNameSnapshot: "申请人", handledByNameSnapshot: "经办人", reason: "交通", requestedAmountCents: 1200n, loanOffsetAmountCents: 0n, companyPayableAmountCents: 1200n, fundedAmountCents: 0n, updatedAt: new Date("2026-07-23") }]);
    tx.project.findMany.mockResolvedValue([{ id: "project-1", code: "JGXM-001", name: "科技园项目" }]);
    await expect(service.listMine("user-a", "drafts")).resolves.toEqual([expect.objectContaining({ project: { id: "project-1", code: "JGXM-001", name: "科技园项目" }, requestedAmountCents: "1200", companyPayableAmountCents: "1200" })]);
    expect(tx.expenseClaim.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: [{ applicantUserId: "user-a" }, { handledByUserId: "user-a" }], status: { in: ["draft"] } }) }));
    expect(tx.project.findMany).toHaveBeenCalledWith({ where: { id: { in: ["project-1"] } }, select: { id: true, code: true, name: true } });
  });
  it("creates a new-domain reimbursement draft with a Beijing daily number and frozen source snapshots", async () => {
    const { service, tx, numbering, audit } = createHarness();
    tx.user.findUnique.mockResolvedValue(actor);
    tx.companyEntity.findFirst.mockResolvedValue({ id: "company-1", name: "建工公司" });
    tx.project.findFirst.mockResolvedValue({ id: "project-1" });
    tx.expenseClaim.create.mockResolvedValue({ id: "claim-1", status: "draft" });

    await expect(
      service.create("user-a", {
        claimType: "reimbursement",
        companyEntityId: "company-1",
        projectId: "project-1",
        applicantUserId: "user-a",
        reason: "现场交通费",
        requestedAmountCents: "1200",
        lines: [{ expenseCategory: "交通", occurredOn: "2026-07-23", purpose: "现场往返", receiptCount: 2, amountCents: "1200", evidenceType: "receipt_or_other" }]
      })
    ).resolves.toEqual({ id: "claim-1", code: "BX-20260723-001", status: "draft", requestedAmountCents: "1200" });

    expect(numbering.allocateDaily).toHaveBeenCalledWith(tx, "BX");
    expect(tx.expenseClaim.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: "BX-20260723-001",
        status: "draft",
        applicantUserId: "user-a",
        handledByUserId: "user-a",
        projectId: "project-1",
        factWitnessUserId: null,
        requestedAmountCents: 1200n,
        paymentSubjectCompanyEntityId: "company-1",
        paymentSubjectNameSnapshot: "建工公司"
      })
    });
    expect(tx.expenseClaimLine.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ expenseClaimId: "claim-1", sortOrder: 1, receiptCount: 2, amountCents: 1200n })]
    });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "expense_claim.draft.create" }));
  });

  it.each([null, "bearing-company"])("keeps the original debtor when the bearing decision is %s", async companyId => {
    const { service, tx } = createHarness();
    tx.user.findUnique.mockResolvedValue(actor);
    tx.companyEntity.findFirst.mockResolvedValue({ id: "original-company", name: "原使用单位" });
    tx.projectParticipatingCompany.findFirst.mockResolvedValue({ id: "participation" });
    tx.expenseClaim.create.mockResolvedValue({ id: "claim-bearing", status: "draft" });
    await service.create("user-a", {
      claimType: "incidental_expense", incidentalExpenseCategory: "temporary_service", projectId: "project-1",
      companyEntityId: "original-company", costBearingCompanyEntityId: companyId, applicantUserId: "user-a",
      reason: "独立项目费用", payeeName: "服务方", requestedAmountCents: "800"
    });
    expect(tx.expenseClaim.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      companyEntityId: "original-company", paymentSubjectCompanyEntityId: "original-company",
      costBearingCompanySpecified: true, costBearingCompanyEntityId: companyId
    }) });
    expect(tx.projectParticipatingCompany.findFirst).toHaveBeenCalledTimes(companyId === null ? 0 : 1);
  });

  it("rejects an explicit company outside the expense project", async () => {
    const { service, tx } = createHarness();
    tx.user.findUnique.mockResolvedValue(actor);
    tx.companyEntity.findFirst.mockResolvedValue({ id: "original-company", name: "原使用单位" });
    tx.projectParticipatingCompany.findFirst.mockResolvedValue(null);
    await expect(service.create("user-a", {
      claimType: "incidental_expense", incidentalExpenseCategory: "temporary_service", projectId: "project-1",
      companyEntityId: "original-company", costBearingCompanyEntityId: "outside-company", applicantUserId: "user-a",
      reason: "独立项目费用", payeeName: "服务方", requestedAmountCents: "800"
    })).rejects.toThrow("请选择当前项目有效的成本承担公司");
    expect(tx.expenseClaim.create).not.toHaveBeenCalled();
  });

  it("creates a project-scoped incidental expense without an amount cap or required attachment", async () => {
    const { service, tx, numbering, audit } = createHarness();
    tx.user.findUnique.mockResolvedValue(actor);
    tx.companyEntity.findFirst.mockResolvedValue({ id: "company-1", name: "建工公司" });
    tx.project.findFirst.mockResolvedValue({ id: "project-1" });
    tx.expenseClaim.create.mockResolvedValue({ id: "claim-incidental-1", status: "draft" });

    await expect(
      service.create("user-a", {
        claimType: "incidental_expense",
        incidentalExpenseCategory: "temporary_machinery_shift",
        companyEntityId: "company-1",
        projectId: "project-1",
        applicantUserId: "user-a",
        payeeName: "机械服务商",
        reason: "临时机械台班",
        requestedAmountCents: "999999999999"
      } as never)
    ).resolves.toMatchObject({
      id: "claim-incidental-1",
      status: "draft",
      requestedAmountCents: "999999999999"
    });

    expect(numbering.allocateDaily).toHaveBeenCalledWith(tx, "LXFY");
    expect(tx.expenseClaim.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        claimType: "incidental_expense",
        incidentalExpenseCategory: "temporary_machinery_shift",
        projectId: "project-1",
        requestedAmountCents: 999_999_999_999n
      })
    });
    expect(tx.expenseClaimLine.createMany).not.toHaveBeenCalled();
    expect(tx.expenseClaimAttachment.create).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "incidental_expense.draft.create",
        businessType: "incidental_expense"
      })
    );
  });

  it("requires a project and rejects material classification for incidental expenses", async () => {
    const { service, tx } = createHarness();

    await expect(
      service.create("user-a", {
        claimType: "incidental_expense",
        incidentalExpenseCategory: "temporary_service",
        companyEntityId: "company-1",
        applicantUserId: "user-a",
        reason: "临时服务",
        requestedAmountCents: "1000"
      } as never)
    ).rejects.toThrow("零星费用必须选择项目");

    await expect(
      service.create("user-a", {
        claimType: "incidental_expense",
        incidentalExpenseCategory: "sporadic_material",
        companyEntityId: "company-1",
        projectId: "project-1",
        applicantUserId: "user-a",
        payeeName: "材料供应商",
        reason: "材料费用",
        requestedAmountCents: "1000"
      } as never)
    ).rejects.toThrow("材料费用必须走零星材料或材料采购流程");
    expect(tx.expenseClaim.create).not.toHaveBeenCalled();
  });

  it("requires exact line total and never falls back to the legacy project expense table", async () => {
    const { service, tx } = createHarness();
    await expect(
      service.create("user-a", {
        claimType: "reimbursement",
        companyEntityId: "company-1",
        projectId: "project-1",
        applicantUserId: "user-a",
        reason: "金额不一致",
        requestedAmountCents: "1200",
        lines: [{ expenseCategory: "交通", occurredOn: "2026-07-23", purpose: "现场往返", receiptCount: 1, amountCents: "1199", evidenceType: "invoice" }]
      })
    ).rejects.toThrow(BadRequestException);
    expect(tx.expenseClaim.create).not.toHaveBeenCalled();
    expect((tx as Record<string, unknown>).projectExpenseRequest).toBeUndefined();
  });

  it("allows an authorized finance role to change the pending reimbursement payer only with a reason and audit fact", async () => {
    const claim = {
      id: "claim-1", claimType: "reimbursement", status: "approved_pending_payment", projectId: "project-1",
      paymentSubjectCompanyEntityId: "company-use", paymentSubjectNameSnapshot: "使用单位"
    };
    const { service, tx, audit } = createHarness({ roles: ["finance_staff"], claim });
    tx.companyEntity.findFirst.mockResolvedValue({ id: "company-pay", name: "付款单位" });
    tx.expenseClaim.update.mockResolvedValue({
      id: "claim-1", paymentSubjectCompanyEntityId: "company-pay", paymentSubjectNameSnapshot: "付款单位",
      paymentSubjectAdjustmentReason: "资金由集团统一支付", paymentSubjectAdjustedAt: new Date(),
      paymentSubjectAdjustedByUserId: "finance-1", paymentSubjectAdjustedByRoleKey: "finance_staff"
    });

    await expect(service.adjustPaymentSubject("claim-1", "finance-1", {
      companyEntityId: "company-pay", reason: "资金由集团统一支付"
    })).resolves.toMatchObject({ paymentSubjectNameSnapshot: "付款单位", paymentSubjectAdjustedByRoleKey: "finance_staff" });

    const companyLockIndex = tx.$queryRaw.mock.calls.findIndex(([sql]) => sql.strings.join("").includes('FROM "CompanyEntity"'));
    expect(companyLockIndex).toBeGreaterThanOrEqual(0);
    expect(tx.$queryRaw.mock.invocationCallOrder[companyLockIndex]).toBeLessThan(tx.companyEntity.findFirst.mock.invocationCallOrder[0]);
    expect(tx.companyEntity.findFirst).toHaveBeenCalledWith({
      where: {
 id: "company-pay", isActive: true, dataStatus: "complete" },
      select: { id: true, name: true }
    });
    expect(tx.expenseClaim.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ paymentSubjectCompanyEntityId: "company-pay", paymentSubjectAdjustmentReason: "资金由集团统一支付" })
    }));
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "expense_claim.payment_subject.adjust",
      metadata: expect.objectContaining({ previousCompanyEntityId: "company-use", companyEntityId: "company-pay" })
    }));
  });

  it("does not adjust a reimbursement payer before approval or from an unauthorized role", async () => {
    const { service, tx } = createHarness({
      roles: ["employee"],
      claim: { id: "claim-1", claimType: "reimbursement", status: "approved_pending_payment", projectId: null, paymentSubjectCompanyEntityId: "company-use", paymentSubjectNameSnapshot: "使用单位" }
    });
    await expect(service.adjustPaymentSubject("claim-1", "employee-1", { companyEntityId: "company-pay", reason: "调整" })).rejects.toThrow(ForbiddenException);
    expect(tx.expenseClaim.update).not.toHaveBeenCalled();
  });

  it("maps only explicit 40001 at the payment-subject adjustment transaction boundary without retry", async () => {
    await expectParticipantSerializationBoundary(
      () => createHarness(),
      (service) => service.adjustPaymentSubject("claim-1", "finance-1", {
        companyEntityId: "company-pay",
        reason: "参与公司并发变化"
      })
    );
  });

  it("maps only explicit 40001 at the expense-payment transaction boundary without retry", async () => {
    await expectParticipantSerializationBoundary(
      () => createHarness({
        auth: { confirmPassword: jest.fn().mockResolvedValue(undefined) }
      }),
      (service) => service.recordPayment("claim-1", "finance-1", {
        amountCents: "100",
        paidAt: "2026-07-23",
        paymentMethod: "银行转账",
        voucherFileId: "voucher-1",
        confirmationPassword: "current-password"
      })
    );
  });

  it("maps only explicit 40001 at the approval-review transaction boundary without retry", async () => {
    await expectParticipantSerializationBoundary(
      () => createHarness(),
      (service) => service.review("claim-1", "reviewer-1", { decision: "approve" })
    );
  });

  it("records a reimbursement company payment only within the frozen payable amount and advances the source status", async () => {
    const claim = {
      id: "claim-1", claimType: "reimbursement", status: "approved_pending_payment", projectId: "project-1",
      companyPayableAmountCents: 1200n, fundedAmountCents: 0n
    };
    const projectFunding = {
      lockFundingContext: jest.fn().mockResolvedValue(undefined),
      allocateExecution: jest.fn().mockResolvedValue({
        kind: "allocated",
        projectCashAmountCents: 1200n,
        financingQuotaAmountCents: 0n,
        allocations: [{ sourceType: "project_cash", sourceId: null, amountCents: 1200n }]
      })
    };
    const files = {
      assertFileHasNoBusinessBinding: jest.fn().mockResolvedValue({
        id: "voucher-1",
        uploadedByUserId: "finance-1",
        storageStatus: "active"
      })
    };
    const operatingSources = {
      appendConfirmedSourceIfEnabledInTransaction: jest.fn().mockResolvedValue(null)
    };
    const { service, tx, audit } = createHarness({
      claim,
      auth: { confirmPassword: jest.fn().mockResolvedValue(undefined) },
      files,
      projectFunding,
      operatingSources
    });
    tx.expenseClaim.findUnique.mockResolvedValue({ id: "claim-1", projectId: "project-1" });
    tx.fileObject.findUnique.mockResolvedValue({ id: "voucher-1", uploadedByUserId: "finance-1" });
    tx.expenseClaimPaymentExecution.create.mockResolvedValue({ id: "payment-1" });

    await expect(service.recordReimbursementPayment("claim-1", "finance-1", {
      amountCents: "1200", paidAt: "2020-07-24", paymentMethod: "银行转账", voucherFileId: "voucher-1", confirmationPassword: "current-password"
    })).resolves.toMatchObject({ id: "payment-1", status: "paid", paidAmountCents: "1200" });

    expect(tx.expenseClaimPaymentExecution.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ expenseClaimId: "claim-1", amountCents: 1200n, voucherFileId: "voucher-1", recordedByUserId: "finance-1" })
    }));
    expect(projectFunding.lockFundingContext).toHaveBeenCalledWith(tx, "project-1");
    expect(
      projectFunding.lockFundingContext.mock.invocationCallOrder[0]
    ).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[0]);
    expect(projectFunding.allocateExecution).toHaveBeenCalledWith(tx, {
      projectId: "project-1",
      executionType: "expense_claim_payment_execution",
      executionId: "payment-1",
      businessType: "expense_claim",
      businessId: "claim-1",
      amountCents: 1200n,
      occurredAt: new Date("2020-07-24"),
      actorUserId: "finance-1"
    });
    expect(
      projectFunding.allocateExecution.mock.invocationCallOrder[0]
    ).toBeLessThan(tx.expenseClaim.update.mock.invocationCallOrder[0]);
    expect(files.assertFileHasNoBusinessBinding).toHaveBeenCalledWith(tx, "voucher-1");
    expect(tx.expenseClaim.update).toHaveBeenCalledWith(expect.objectContaining({ data: { fundedAmountCents: 1200n, status: "paid" } }));
    expect(
      operatingSources.appendConfirmedSourceIfEnabledInTransaction
    ).toHaveBeenCalledWith(
      tx,
      {
        projectId: "project-1",
        sourceType: "expense_claim_payment_execution",
        sourceBusinessId: "payment-1"
      },
      "finance-1"
    );
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "expense_claim.reimbursement.payment.record",
      metadata: expect.objectContaining({
        fundingAllocation: {
          kind: "allocated",
          projectCashAmountCents: "1200",
          financingQuotaAmountCents: "0",
          allocations: [
            {
              sourceType: "project_cash",
              sourceId: null,
              amountCents: "1200"
            }
          ]
        }
      })
    }));
  });

  it("records an incidental expense payment through the unified project funding transaction", async () => {
    const claim = {
      id: "claim-incidental-1",
      claimType: "incidental_expense",
      status: "approved_pending_payment",
      projectId: "project-1",
      companyPayableAmountCents: 500_000n,
      fundedAmountCents: 0n
    };
    const projectFunding = {
      lockFundingContext: jest.fn().mockResolvedValue(undefined),
      allocateExecution: jest.fn().mockResolvedValue({
        kind: "allocated",
        projectCashAmountCents: 500_000n,
        financingQuotaAmountCents: 0n,
        allocations: [
          {
            sourceType: "project_cash",
            sourceId: null,
            amountCents: 500_000n
          }
        ]
      })
    };
    const files = {
      assertFileHasNoBusinessBinding: jest.fn().mockResolvedValue({
        id: "voucher-incidental-1",
        uploadedByUserId: "finance-1",
        storageStatus: "active"
      })
    };
    const { service, tx, audit } = createHarness({
      claim,
      auth: { confirmPassword: jest.fn().mockResolvedValue(undefined) },
      files,
      projectFunding
    });
    const createReceipt = jest.fn();
    (tx as typeof tx & {
      spotProcurementReceipt: { create: typeof createReceipt };
    }).spotProcurementReceipt = { create: createReceipt };
    tx.expenseClaim.findUnique.mockResolvedValue({
      id: "claim-incidental-1",
      projectId: "project-1"
    });
    tx.fileObject.findUnique.mockResolvedValue({
      id: "voucher-incidental-1",
      uploadedByUserId: "finance-1"
    });
    tx.expenseClaimPaymentExecution.create.mockResolvedValue({
      id: "payment-incidental-1"
    });

    const recordPayment = (
      service as unknown as {
        recordPayment(
          claimId: string,
          actorUserId: string,
          input: {
            amountCents: string;
            paidAt: string;
            paymentMethod: string;
            voucherFileId: string;
            confirmationPassword: string;
          }
        ): Promise<unknown>;
      }
    ).recordPayment.bind(service);
    await expect(
      recordPayment("claim-incidental-1", "finance-1", {
        amountCents: "500000",
        paidAt: "2020-07-24",
        paymentMethod: "银行转账",
        voucherFileId: "voucher-incidental-1",
        confirmationPassword: "current-password"
      })
    ).resolves.toMatchObject({
      id: "payment-incidental-1",
      status: "paid",
      paidAmountCents: "500000"
    });
    expect(projectFunding.allocateExecution).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        projectId: "project-1",
        executionType: "expense_claim_payment_execution",
        businessType: "incidental_expense",
        businessId: "claim-incidental-1",
        amountCents: 500_000n
      })
    );
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "incidental_expense.payment.record",
        businessType: "incidental_expense"
      })
    );
    expect(createReceipt).not.toHaveBeenCalled();
  });

  it("rolls back reimbursement state and audit when unified project funding is insufficient", async () => {
    const claim = {
      id: "claim-1", claimType: "reimbursement", status: "approved_pending_payment", projectId: "project-1",
      companyPayableAmountCents: 1200n, fundedAmountCents: 0n
    };
    const projectFunding = {
      lockFundingContext: jest.fn().mockResolvedValue(undefined),
      allocateExecution: jest.fn().mockRejectedValue(
        new BadRequestException("项目可用资金不足，当前最多可实际支付 1000 分")
      )
    };
    const { service, tx, audit } = createHarness({
      claim,
      auth: { confirmPassword: jest.fn().mockResolvedValue(undefined) },
      files: { assertFileHasNoBusinessBinding: jest.fn().mockResolvedValue({}) },
      projectFunding
    });
    tx.expenseClaim.findUnique.mockResolvedValue({ id: "claim-1", projectId: "project-1" });
    tx.fileObject.findUnique.mockResolvedValue({ id: "voucher-1", uploadedByUserId: "finance-1" });
    tx.expenseClaimPaymentExecution.create.mockResolvedValue({ id: "payment-1" });

    await expect(service.recordReimbursementPayment("claim-1", "finance-1", {
      amountCents: "1200", paidAt: "2020-07-24", paymentMethod: "银行转账", voucherFileId: "voucher-1", confirmationPassword: "current-password"
    })).rejects.toThrow("项目可用资金不足，当前最多可实际支付 1000 分");

    expect(tx.expenseClaimPaymentExecution.create).toHaveBeenCalled();
    expect(tx.expenseClaim.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("replays the same reimbursement execution and funding allocation for an exact voucher retry", async () => {
    const paidAt = new Date("2020-07-24");
    const claim = {
      id: "claim-1", claimType: "reimbursement", status: "paid", projectId: "project-1",
      companyPayableAmountCents: 1200n, fundedAmountCents: 1200n
    };
    const projectFunding = {
      lockFundingContext: jest.fn().mockResolvedValue(undefined),
      allocateExecution: jest.fn().mockResolvedValue({
        kind: "replayed",
        projectCashAmountCents: 1200n,
        financingQuotaAmountCents: 0n,
        allocations: [{ sourceType: "project_cash", sourceId: null, amountCents: 1200n }]
      })
    };
    const { service, tx, audit } = createHarness({
      claim,
      auth: { confirmPassword: jest.fn().mockResolvedValue(undefined) },
      projectFunding
    });
    tx.expenseClaim.findUnique.mockResolvedValue({ id: "claim-1", projectId: "project-1" });
    tx.expenseClaimPaymentExecution.findUnique.mockResolvedValue({
      id: "payment-1",
      expenseClaimId: "claim-1",
      amountCents: 1200n,
      paidAt,
      paymentMethod: "银行转账",
      voucherFileId: "voucher-1",
      recordedByUserId: "finance-1",
      note: null
    });

    await expect(service.recordReimbursementPayment("claim-1", "finance-1", {
      amountCents: "1200", paidAt: "2020-07-24", paymentMethod: "银行转账", voucherFileId: "voucher-1", confirmationPassword: "current-password"
    })).resolves.toEqual({
      id: "payment-1",
      expenseClaimId: "claim-1",
      paidAmountCents: "1200",
      status: "paid"
    });
    expect(projectFunding.allocateExecution).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ executionId: "payment-1" })
    );
    expect(tx.expenseClaimPaymentExecution.create).not.toHaveBeenCalled();
    expect(tx.expenseClaim.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("does not let a reimbursement without a project bypass unified funding", async () => {
    const projectFunding = {
      lockFundingContext: jest.fn().mockResolvedValue(undefined),
      allocateExecution: jest.fn()
    };
    const { service, tx } = createHarness({
      auth: { confirmPassword: jest.fn().mockResolvedValue(undefined) },
      projectFunding
    });
    tx.expenseClaim.findUnique.mockResolvedValue({
      id: "claim-1",
      projectId: null
    });

    await expect(service.recordReimbursementPayment("claim-1", "finance-1", {
      amountCents: "1200", paidAt: "2020-07-24", paymentMethod: "银行转账", voucherFileId: "voucher-1", confirmationPassword: "current-password"
    })).rejects.toThrow("报销申请未关联项目，不能登记公司补付");
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(projectFunding.allocateExecution).not.toHaveBeenCalled();
    expect(tx.expenseClaimPaymentExecution.create).not.toHaveBeenCalled();
  });

  it("binds only the current handler's unbound private file to a draft expense claim", async () => {
    const files = { assertFileHasNoBusinessBinding: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "user-a", storageStatus: "active" }) };
    const { service, tx, audit } = createHarness({
      claim: { id: "claim-1", status: "draft", handledByUserId: "user-a" },
      files
    });
    tx.expenseClaimAttachment.create.mockResolvedValue({ id: "attachment-1", fileId: "file-1", category: "invoice", expenseCategory: "交通", stage: "draft", createdAt: new Date() });

    await expect(service.attachAttachment("claim-1", "user-a", {
      fileId: "file-1", category: "invoice", expenseCategory: "交通"
    })).resolves.toMatchObject({ id: "attachment-1", stage: "draft" });

    expect(files.assertFileHasNoBusinessBinding).toHaveBeenCalledWith(tx, "file-1");
    expect(tx.expenseClaimAttachment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ expenseClaimId: "claim-1", fileId: "file-1", category: "invoice", stage: "draft", attachedByUserId: "user-a" })
    });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "expense_claim.attachment.attach" }));
  });

  it("rejects an expense attachment uploaded by another user before writing a binding", async () => {
    const files = { assertFileHasNoBusinessBinding: jest.fn().mockResolvedValue({ id: "file-1", uploadedByUserId: "other-user", storageStatus: "active" }) };
    const { service, tx } = createHarness({ claim: { id: "claim-1", status: "draft", handledByUserId: "user-a" }, files });

    await expect(service.attachAttachment("claim-1", "user-a", { fileId: "file-1", category: "other" })).rejects.toThrow(ForbiddenException);
    expect(tx.expenseClaimAttachment.create).not.toHaveBeenCalled();
  });

  it("lets finance append a new immutable evidence file after submission without replacing frozen attachments", async () => {
    const files = { assertFileHasNoBusinessBinding: jest.fn().mockResolvedValue({ id: "file-new", uploadedByUserId: "finance-1", storageStatus: "active" }) };
    const { service, tx, audit } = createHarness({ roles: ["finance_staff"], files });
    tx.$queryRaw.mockResolvedValueOnce([{ id: "claim-1", status: "approved_pending_payment", projectId: "project-1", handledByUserId: "user-a" }]);
    tx.expenseClaimAttachment.create.mockResolvedValue({ id: "attachment-new", fileId: "file-new", category: "receipt_or_other", expenseCategory: null, stage: "appended", createdAt: new Date() });

    await expect(service.appendAttachment("claim-1", "finance-1", { fileId: "file-new", category: "receipt_or_other" })).resolves.toMatchObject({ id: "attachment-new", stage: "post_submit_append" });

    expect(tx.expenseClaimAttachment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ stage: "appended", attachedByUserId: "finance-1" }) });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "expense_claim.attachment.append" }));
  });

  it("does not let submitted-claim evidence appenders replace a frozen attachment", async () => {
    const files = { assertFileHasNoBusinessBinding: jest.fn() };
    const { service, tx } = createHarness({ roles: ["finance_staff"], files });
    tx.$queryRaw.mockResolvedValueOnce([{ id: "claim-1", status: "rejected", projectId: "project-1", handledByUserId: "user-a" }]);

    await expect(service.appendAttachment("claim-1", "finance-1", { fileId: "file-new", category: "other" })).rejects.toThrow(BadRequestException);
    expect(files.assertFileHasNoBusinessBinding).not.toHaveBeenCalled();
    expect(tx.expenseClaimAttachment.create).not.toHaveBeenCalled();
  });

  it("allows a comprehensive director to record a no-account non-project reimbursement with a frozen witness", async () => {
    const { service, tx, numbering } = createHarness({ roles: ["comprehensive_director"] });
    numbering.allocateDaily.mockResolvedValue("BX-20260723-002");
    tx.user.findUnique
      .mockResolvedValueOnce(actor)
      .mockResolvedValueOnce({ id: "witness-1", name: "事实证明人", isActive: true });
    tx.companyEntity.findFirst.mockResolvedValue({ id: "company-1", name: "建工公司" });
    tx.expenseClaim.create.mockResolvedValue({ id: "claim-2", status: "draft" });

    await service.create("user-a", {
      claimType: "reimbursement",
      companyEntityId: "company-1",
      factWitnessUserId: "witness-1",
      applicantName: "无账号报销人",
      applicantPhone: "13900000000",
      reason: "非项目交通费",
      requestedAmountCents: "800",
      lines: [{ expenseCategory: "交通", occurredOn: "2026-07-23", purpose: "业务外出", receiptCount: 0, amountCents: "800", evidenceType: "none", noEvidenceReason: "遗失凭证" }]
    });

    expect(tx.expenseClaim.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ applicantUserId: null, applicantNameSnapshot: "无账号报销人", factWitnessUserId: "witness-1", proxyReason: "由综合部代办" })
    });
  });

  it("blocks no-account proxy claims from non-comprehensive roles", async () => {
    const { service, tx } = createHarness();
    tx.user.findUnique.mockResolvedValue(actor);
    tx.companyEntity.findFirst.mockResolvedValue({ id: "company-1", name: "建工公司" });
    await expect(
      service.create("user-a", {
        claimType: "reimbursement",
        companyEntityId: "company-1",
        factWitnessUserId: "witness-1",
        applicantName: "无账号报销人",
        applicantPhone: "13900000000",
        reason: "非项目交通费",
        requestedAmountCents: "800",
        lines: [{ expenseCategory: "交通", occurredOn: "2026-07-23", purpose: "业务外出", receiptCount: 1, amountCents: "800", evidenceType: "invoice" }]
      })
    ).rejects.toThrow(ForbiddenException);
  });

  it("submits exactly one frozen approval instance from a locked draft", async () => {
    const claim = { id: "claim-1", claimType: "reimbursement", status: "draft", projectId: "project-1", applicantUserId: null, companyEntityId: "company-1", requestedAmountCents: 1000n, handledByUserId: "user-a", factWitnessUserId: null };
    const { service, tx, audit } = createHarness({
      claim,
      approvalAssignments: [
        { userId: "comp-1", positionId: "position-comp", role: "comprehensive_director" },
        { userId: "pm-1", positionId: "position-pm", role: "project_manager" },
        { userId: "finance-1", positionId: "position-finance", role: "finance_director" },
        { userId: "leader-1", positionId: "position-leader", role: "general_manager" }
      ]
    });
    tx.approvalInstance.create.mockResolvedValue({ id: "approval-1" });
    tx.expenseClaim.update.mockResolvedValue({ id: "claim-1", status: "approval_pending" });
    tx.expenseClaim.findUnique.mockResolvedValue({ ...claim, status: "approval_pending", approvalInstanceId: "approval-1", loanOffsetAmountCents: 0n, companyPayableAmountCents: 1000n });

    await expect(service.submit("claim-1", "user-a")).resolves.toEqual({ id: "claim-1", status: "approval_pending", approvalInstanceId: "approval-1", loanOffsetAmountCents: "0", companyPayableAmountCents: "1000" });

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        flowType: "expense_claim.approve",
        businessId: "claim-1",
        currentNodeIndex: 0,
        status: "in_progress",
        frozenNodes: expect.arrayContaining([expect.objectContaining({ candidateUserIds: ["comp-1"], candidateUserIdsByRole: { comprehensive_director: ["comp-1"] } })])
      })
    });
    expect(tx.expenseClaim.update).toHaveBeenCalledWith({
      where: { id: "claim-1" },
      data: expect.objectContaining({ status: "approval_pending", approvalInstanceId: "approval-1" })
    });
    expect(tx.expenseClaimAttachment.updateMany).toHaveBeenCalledWith({
      where: { expenseClaimId: "claim-1", stage: "draft", removedAt: null },
      data: expect.objectContaining({ stage: "approval_frozen" })
    });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "expense_claim.submit" }));
  });

  it("submits an incidental expense with its full amount payable and no attachment requirement", async () => {
    const claim = {
      id: "claim-incidental-1",
      claimType: "incidental_expense",
      status: "draft",
      projectId: "project-1",
      applicantUserId: "user-a",
      companyEntityId: "company-1",
      costBearingCompanySpecified: true,
      costBearingCompanyEntityId: null,
      requestedAmountCents: 500_000n,
      handledByUserId: "user-a",
      factWitnessUserId: null
    };
    const { service, tx } = createHarness({
      claim,
      approvalAssignments: [
        { userId: "comp-1", positionId: "position-comp", role: "comprehensive_director" },
        { userId: "pm-1", positionId: "position-pm", role: "project_manager" },
        { userId: "finance-1", positionId: "position-finance", role: "finance_director" },
        { userId: "leader-1", positionId: "position-leader", role: "general_manager" }
      ]
    });
    tx.approvalInstance.create.mockResolvedValue({ id: "approval-incidental-1" });
    tx.expenseClaim.findUnique.mockResolvedValue({ ...claim, status: "approval_pending", approvalInstanceId: "approval-incidental-1", loanOffsetAmountCents: 0n, companyPayableAmountCents: 500000n });
    tx.expenseClaim.update.mockResolvedValue({
      id: "claim-incidental-1",
      status: "approval_pending"
    });

    await expect(
      service.submit("claim-incidental-1", "user-a")
    ).resolves.toMatchObject({
      status: "approval_pending",
      loanOffsetAmountCents: "0",
      companyPayableAmountCents: "500000"
    });
    expect(tx.expenseClaimEntrySnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ valuesSnapshot: expect.objectContaining({
        companyEntityId: "company-1", costBearingCompanyEntityId: null
      }) })
    });
    expect(tx.expenseClaim.update).toHaveBeenCalledWith({
      where: { id: "claim-incidental-1" },
      data: expect.objectContaining({
        status: "approval_pending",
        companyPayableAmountCents: 500_000n
      })
    });
  });

  it("advances only the frozen current approver and records the frozen role", async () => {
    const claim = { id: "claim-1", claimType: "reimbursement", status: "approval_pending", projectId: "project-1", handledByUserId: "user-a", factWitnessUserId: null, requestedAmountCents: 1200n };
    const instance = {
      id: "approval-1",
      currentNodeIndex: 0,
      applicantUserId: "user-a",
      frozenNodes: [
        { name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"], candidateUserIds: ["comp-1"], candidateUserIdsByRole: { comprehensive_director: ["comp-1"] } },
        { name: "项目经理", mode: "any", roleKeys: ["project_manager"], candidateUserIds: ["pm-1"], candidateUserIdsByRole: { project_manager: ["pm-1"] } }
      ]
    };
    const { service, tx, audit } = createHarness({ roles: ["comprehensive_director"] });
    tx.$queryRaw
      .mockResolvedValueOnce([claim])
      .mockResolvedValueOnce([instance])
      .mockResolvedValueOnce([{ id: "comp-1", isActive: true, name: "签批人甲" }])
      .mockResolvedValueOnce([{ id: "signature-1", fileId: "file-1", contentSha256: "a".repeat(64) }])
      .mockResolvedValueOnce([{ id: "file-1", contentSha256: "a".repeat(64), storageStatus: "active" }]);
    tx.expenseClaim.update.mockResolvedValue({ id: "claim-1", status: "approval_pending" });

    await expect(service.review("claim-1", "comp-1", { decision: "approve", comment: "同意" })).resolves.toEqual({ id: "claim-1", status: "approval_pending", completed: false });

    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: "approval-1" },
      data: expect.objectContaining({ currentNodeIndex: 1, status: "in_progress" })
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: "approve", approvedRoleKey: "comprehensive_director", representedUserId: "comp-1" })
    });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "expense_claim.approval.approve" }));
  });

  it.each([
    { claimType: "reimbursement", generalProcurementId: null },
    { claimType: "incidental_expense", generalProcurementId: null },
    { claimType: "incidental_expense", generalProcurementId: "procurement-1" }
  ])("lets finance sign $claimType with procurement $generalProcurementId before the first frozen duty", async source => {
    const claim = { id: "claim-1", ...source, status: "approval_pending", projectId: "project-1", approvalInstanceId: "approval-1" };
    const instance = {
      id: "approval-1",
      currentNodeIndex: 0,
      applicantUserId: "applicant",
      frozenNodes: [
        { name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"], candidateUserIdsByRole: { comprehensive_director: ["comp"] } },
        { name: "财务主管", mode: "any", roleKeys: ["finance_director"], candidateUserIdsByRole: { finance_director: ["finance"] } }
      ].map(node => ({ ...node, protocolVersion: 1, executionMode: "parallel" }))
    };
    const { service, tx } = createHarness({ roles: ["finance_director"] });
    tx.$queryRaw
      .mockResolvedValueOnce([claim])
      .mockResolvedValueOnce([instance])
      .mockResolvedValueOnce([{ id: "finance", isActive: true, name: "财务人员" }])
      .mockResolvedValueOnce([{ id: "signature", fileId: "file", contentSha256: "a".repeat(64) }])
      .mockResolvedValueOnce([{ id: "file", contentSha256: "a".repeat(64), storageStatus: "active" }]);
    tx.expenseClaim.update.mockResolvedValue({ id: claim.id, status: "approval_pending" });
    const review = { decision: "approve" as const, approvalInstanceId: "approval-1", approvalDutyIndex: 1 };

    await expect(service.review(claim.id, "finance", review)).resolves.toEqual({
      id: claim.id, status: "approval_pending", completed: false
    });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({
      where: { id: instance.id },
      data: expect.objectContaining({
        currentNodeIndex: 0,
        frozenNodes: [instance.frozenNodes[0], { ...instance.frozenNodes[1], approvedRoleKeys: ["finance_director"] }]
      })
    });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ approvedRoleKey: "finance_director", signatureVersionIdSnapshot: "signature" })
    });
  });

  it("rejects a same-role user who was not frozen into the current node", async () => {
    const claim = { id: "claim-1", claimType: "loan", status: "approval_pending", projectId: "project-1", handledByUserId: "user-a", factWitnessUserId: null, requestedAmountCents: 1200n };
    const instance = { id: "approval-1", currentNodeIndex: 0, applicantUserId: "user-a", frozenNodes: [{ name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"], candidateUserIds: ["comp-1"], candidateUserIdsByRole: { comprehensive_director: ["comp-1"] } }] };
    const { service, tx } = createHarness({ roles: ["comprehensive_director"] });
    tx.$queryRaw.mockResolvedValueOnce([claim]).mockResolvedValueOnce([instance]);

    await expect(service.review("claim-1", "comp-2", { decision: "approve" })).rejects.toThrow(ForbiddenException);
    expect(tx.expenseClaim.update).not.toHaveBeenCalled();
  });

  it.each([
    ["current", { isActive: true, passwordHash: "verified-hash" }, 0],
    ["rotated", { isActive: true, passwordHash: "rotated-hash" }, 0],
    ["inactive", { isActive: false, passwordHash: "verified-hash" }, 0],
    ["advanced", { isActive: true, passwordHash: "verified-hash" }, 1]
  ] as const)("rechecks a %s self-review after confirming the password outside the write transaction", async (state, lockedAccount, lockedNode) => {
    const claim = { id: "claim-1", claimType: "reimbursement", status: "approval_pending", projectId: "project-1", applicantUserId: "leader-1", handledByUserId: "leader-1", factWitnessUserId: null, requestedAmountCents: 1200n, loanOffsetAmountCents: 0n, companyPayableAmountCents: 1200n };
    const instance = { id: "approval-1", currentNodeIndex: 0, applicantUserId: "leader-1", frozenNodes: [{ name: "董事长/总经理", mode: "any", roleKeys: ["general_manager"], candidateUserIds: ["leader-1"], candidateUserIdsByRole: { general_manager: ["leader-1"] } }] };
    instance.frozenNodes.push(instance.frozenNodes[0]!);
    const auth = { confirmPassword: jest.fn() };
    const { service, tx, prisma } = createHarness({ roles: ["general_manager"], auth });
    auth.confirmPassword.mockImplementation(async (_id, _password, persistence) => {
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(await persistence.user.findUnique({ where: { id: "leader-1" } }))
        .toEqual({ isActive: true, passwordHash: "verified-hash" });
      return { ok: true };
    });
    tx.approvalInstance.findFirst.mockResolvedValue(instance);
    tx.expenseClaim.findUnique.mockResolvedValue(claim);
    tx.user.findUnique.mockResolvedValue({ isActive: true, passwordHash: "verified-hash" });
    tx.$queryRaw
      .mockResolvedValueOnce([claim])
      .mockResolvedValueOnce([{ ...instance, currentNodeIndex: lockedNode }])
      .mockResolvedValueOnce([lockedAccount])
      .mockResolvedValueOnce([{ id: "leader-1", isActive: true, name: "签批人甲" }])
      .mockResolvedValueOnce([{ id: "signature-1", fileId: "file-1", contentSha256: "a".repeat(64) }])
      .mockResolvedValueOnce([{ id: "file-1", contentSha256: "a".repeat(64), storageStatus: "active" }]);
    tx.expenseClaim.update.mockResolvedValue({ id: "claim-1", status: "approval_pending" });

    const review = service.review("claim-1", "leader-1", { decision: "approve", selfReviewReason: "职责兼任", confirmationPassword: "current-password" });
    if (state !== "current") {
      await expect(review).rejects.toThrow(ConflictException);
      expect(tx.expenseClaim.update).not.toHaveBeenCalled();
      expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
      return;
    }
    await expect(review).resolves.toEqual({ id: "claim-1", status: "approval_pending", completed: false });

    expect(auth.confirmPassword).toHaveBeenCalledWith("leader-1", "current-password", expect.anything());
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ metadata: { selfReview: true, selfReviewReason: "职责兼任", approverName: "签批人甲" }, signatureFileIdSnapshot: "file-1", signatureVersionIdSnapshot: "signature-1" })
    });
  });

  it.each([
    ["reimbursement", "approved_pending_payment"],
    ["incidental_expense", "approved_pending_payment"]
  ])("终审 %s 在原事务登记资金待办，提交后才唤醒派发", async (claimType, status) => {
    const claim = { id: "funding-claim", claimType, status: "approval_pending", projectId: "project-1", applicantUserId: "applicant",
      handledByUserId: "applicant", requestedAmountCents: 100n, loanOffsetAmountCents: 0n, companyPayableAmountCents: 100n };
    const instance = { id: "round", currentNodeIndex: 0, applicantUserId: "applicant", frozenNodes: [{
      name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"], candidateUserIds: ["reviewer"],
      candidateUserIdsByRole: { comprehensive_director: ["reviewer"] }
    }] };
    const events: string[] = [];
    const fundingNotifications = { queue: jest.fn(async () => { events.push("queued"); return true; }),
      afterCommit: jest.fn(async () => { events.push("dispatch"); }) };
    const operatingSources = { appendConfirmedSourceIfEnabledInTransaction: jest.fn() };
    const { service, tx, prisma } = createHarness({ roles: ["comprehensive_director"], fundingNotifications, operatingSources });
    prisma.$transaction.mockImplementationOnce(async run => {
      const result = await run(tx);
      events.push("commit");
      return result;
    });
    tx.$queryRaw.mockResolvedValueOnce([claim]).mockResolvedValueOnce([instance])
      .mockResolvedValueOnce([{ id: "reviewer", isActive: true, name: "签批人" }])
      .mockResolvedValueOnce([{ id: "signature", fileId: "file", contentSha256: "a".repeat(64) }])
      .mockResolvedValueOnce([{ id: "file", contentSha256: "a".repeat(64), storageStatus: "active" }]);
    const approved = { ...claim, status };
    tx.expenseClaim.update.mockResolvedValue(approved);
    await expect(service.review(claim.id, "reviewer", { decision: "approve" })).resolves.toMatchObject({ status, completed: true });
    expect(events).toEqual(["queued", "commit", "dispatch"]);
    expect(fundingNotifications.queue).toHaveBeenCalledWith(tx, approved, "reviewer");
  });

  it("keeps the historic loan approval readable but rejects an authorized signature or rejection", async () => {
    const { service, tx, audit } = createHarness({ roles: ["comprehensive_director"] });
    const claim = { id: "loan-1", claimType: "loan", status: "approval_pending", applicantUserId: "owner",
      handledByUserId: "owner", projectId: "project-1", requestedAmountCents: 100n, fundedAmountCents: 0n,
      companyPayableAmountCents: 0n, loanOffsetAmountCents: 0n };
    const round = { id: "round-1", currentNodeIndex: 0, applicantUserId: "owner", frozenNodes: [{
      name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"], candidateUserIdsByRole: { comprehensive_director: ["reviewer"] }
    }] };
    tx.expenseClaim.findFirst.mockResolvedValue(claim);
    tx.employeeProjectLoanEntry.findMany.mockResolvedValue([]);
    tx.approvalInstance.findFirst.mockResolvedValue(round);
    const detail = await service.getMine(claim.id, "reviewer");
    expect(detail.approval).toMatchObject({ currentNodeName: "综合部主管", canReview: false });
    expect((await service.getActionCapability(claim.id, "reviewer")).availableActions).not.toContain("review_expense_claim");

    for (const decision of ["approve", "reject"] as const) {
      tx.$queryRaw.mockResolvedValueOnce([claim]).mockResolvedValueOnce([round]);
      await expect(service.review(claim.id, "reviewer", { decision, comment: "保留原审批" })).rejects.toMatchObject({ status: 410 });
    }
    tx.$queryRaw.mockResolvedValueOnce([claim]).mockResolvedValueOnce([round]);
    await expect(service.review(claim.id, "stranger", { decision: "approve" })).rejects.toMatchObject({ status: 403 });
    expect(tx.expenseClaim.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("approves an incidental expense into payment instead of loan disbursement", async () => {
    const claim = {
      id: "claim-incidental-1",
      claimType: "incidental_expense",
      status: "approval_pending",
      projectId: "project-1",
      applicantUserId: "user-a",
      handledByUserId: "user-a",
      factWitnessUserId: null,
      requestedAmountCents: 500_000n,
      loanOffsetAmountCents: 0n,
      companyPayableAmountCents: 500_000n
    };
    const instance = {
      id: "approval-incidental-1",
      currentNodeIndex: 0,
      applicantUserId: "user-a",
      frozenNodes: [
        {
          name: "董事长/总经理",
          mode: "any",
          roleKeys: ["general_manager"],
          candidateUserIds: ["leader-1"],
          candidateUserIdsByRole: { general_manager: ["leader-1"] }
        }
      ]
    };
    const operatingSources = {
      appendConfirmedSourceIfEnabledInTransaction: jest.fn().mockResolvedValue(null)
    };
    const { service, tx } = createHarness({
      roles: ["general_manager"],
      operatingSources
    });
    tx.$queryRaw
      .mockResolvedValueOnce([claim])
      .mockResolvedValueOnce([instance])
      .mockResolvedValueOnce([{ id: "leader-1", isActive: true, name: "签批人甲" }])
      .mockResolvedValueOnce([
        {
          id: "signature-1",
          fileId: "file-1",
          contentSha256: "a".repeat(64)
        }
      ])
      .mockResolvedValueOnce([
        {
          id: "file-1",
          contentSha256: "a".repeat(64),
          storageStatus: "active"
        }
      ]);
    tx.expenseClaim.update.mockResolvedValue({
      id: "claim-incidental-1",
      status: "approved_pending_payment"
    });

    await expect(
      service.review("claim-incidental-1", "leader-1", {
        decision: "approve"
      })
    ).resolves.toEqual({
      id: "claim-incidental-1",
      status: "approved_pending_payment",
      completed: true
    });
    expect(tx.expenseClaim.update).toHaveBeenCalledWith({
      where: { id: "claim-incidental-1" },
      data: expect.objectContaining({
        status: "approved_pending_payment"
      })
    });
    expect(
      operatingSources.appendConfirmedSourceIfEnabledInTransaction
    ).toHaveBeenCalledWith(
      tx,
      {
        projectId: "project-1",
        sourceType: "expense_claim_approval",
        sourceBusinessId: "claim-incidental-1"
      },
      "leader-1"
    );
  });

  it("reserves only same-project actual disbursements in FIFO order when a reimbursement is submitted", async () => {
    const claim = { id: "claim-r", claimType: "reimbursement", status: "draft", projectId: "project-1", applicantUserId: "user-a", companyEntityId: "company-1", requestedAmountCents: 7000n, handledByUserId: "user-a", factWitnessUserId: null };
    const { service, tx } = createHarness({
      claim,
      approvalAssignments: [
        { userId: "comp-1", positionId: "position-comp", role: "comprehensive_director" },
        { userId: "pm-1", positionId: "position-pm", role: "project_manager" },
        { userId: "finance-1", positionId: "position-finance", role: "finance_director" },
        { userId: "leader-1", positionId: "position-leader", role: "general_manager" }
      ]
    });
    tx.$queryRaw.mockImplementation(async (query: { sql: string }) => query.sql.includes('"EmployeeProjectLoanAccount"')
      ? [{ id: "account-1", balanceAmountCents: 10000n, reservedOffsetAmountCents: 1000n }]
      : query.sql.includes('"ExpenseClaim"') ? [claim] : []);
    tx.employeeProjectLoanEntry.findMany.mockResolvedValue([{ id: "entry-old", amountCents: 5000n }, { id: "entry-new", amountCents: 6000n }]);
    tx.expenseLoanOffsetReservation.findMany.mockResolvedValue([{ loanEntryId: "entry-old", amountCents: 1000n }]);
    tx.expenseLoanOffsetReservation.aggregate.mockResolvedValue({ _max: { sequenceNo: 3 } });
    tx.approvalInstance.create.mockResolvedValue({ id: "approval-r" });
    tx.expenseClaim.findUnique.mockResolvedValue({ ...claim, status: "approval_pending", approvalInstanceId: "approval-r", loanOffsetAmountCents: 7000n, companyPayableAmountCents: 0n });
    tx.expenseClaim.update.mockResolvedValue({ id: "claim-r", status: "approval_pending" });

    await expect(service.submit("claim-r", "user-a")).resolves.toEqual(expect.objectContaining({ loanOffsetAmountCents: "7000", companyPayableAmountCents: "0" }));
    expect(tx.expenseLoanOffsetReservation.createMany).toHaveBeenCalledWith({ data: [
      expect.objectContaining({ loanEntryId: "entry-old", amountCents: 4000n, sequenceNo: 4 }),
      expect.objectContaining({ loanEntryId: "entry-new", amountCents: 3000n, sequenceNo: 5 })
    ] });
    expect(tx.employeeProjectLoanAccount.update).toHaveBeenCalledWith({ where: { id: "account-1" }, data: { reservedOffsetAmountCents: 8000n } });
  });

  it.each([true, false])("keeps the required rejection reason and historical status distinct: parallel=%s", async parallel => {
    const claim = { id: "claim-r", claimType: "reimbursement", status: "approval_pending", projectId: "project-1",
      approvalInstanceId: "approval-old", handledByUserId: "user-a", fundedAmountCents: 0n };
    const round = { id: "approval-old", applicantUserId: "user-a", currentNodeIndex: 0, frozenNodes: [
      { name: "财务主管", roleKeys: ["finance_director"], mode: "any", candidateUserIds: ["finance-user"],
        candidateUserIdsByRole: { finance_director: ["finance-user"] },
        ...(parallel ? { approvedRoleKeys: [], protocolVersion: 1, executionMode: "parallel",
          candidatePolicy: "current_role_scope", roleScopesByRole: { finance_director: "global" } } : {}) }
    ] };
    const { service, tx } = createHarness({ roles: ["finance_director"] });
    tx.$queryRaw.mockImplementation(async (query: { sql: string }) => query.sql.includes('"ApprovalInstance"') ? [round]
      : query.sql.includes('"User"') ? [{ isActive: true }] : [claim]);
    const coordinates = parallel ? { approvalInstanceId: round.id, approvalDutyIndex: 0 } : {};

    if (parallel) {
      await expect(service.review(claim.id, "finance-user", { decision: "reject", ...coordinates }))
        .rejects.toThrow("驳回费用申请必须填写原因");
      expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    }
    await expect(service.review(claim.id, "finance-user", { decision: "reject", ...(parallel ? { comment: "核对后请修订" } : {}), ...coordinates }))
      .resolves.toEqual({ id: claim.id, status: parallel ? "draft" : "rejected" });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({ where: { id: round.id }, data: { status: parallel ? "returned" : "rejected" } });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      approvalInstanceId: round.id, action: parallel ? "return_to_applicant" : "reject", comment: parallel ? "核对后请修订" : null
    }) });
    expect(tx.approvalActionLog.create.mock.calls[0]?.[0].data).not.toHaveProperty("signatureFileIdSnapshot");
  });

  it("withdraws a partially signed expense round and releases its reserved loan amount", async () => {
    const claim = { id: "claim-r", claimType: "reimbursement", status: "approval_pending", projectId: "project-1",
      approvalInstanceId: "approval-old", handledByUserId: "user-a", fundedAmountCents: 0n };
    const round = { id: "approval-old", applicantUserId: "user-a", frozenNodes: [
      { roleKeys: ["project_manager"], mode: "any", approvedRoleKeys: ["project_manager"], protocolVersion: 1, executionMode: "parallel" },
      { roleKeys: ["finance_director"], mode: "any", approvedRoleKeys: [], protocolVersion: 1, executionMode: "parallel" }
    ] };
    const { service, tx, audit } = createHarness();
    tx.expenseClaim.findUnique.mockResolvedValue(claim);
    tx.$queryRaw.mockImplementation(async (query: { sql: string }) => query.sql.includes('"ApprovalInstance"') ? [round]
      : query.sql.includes('"EmployeeProjectLoanAccount"') ? [{ id: "loan-1", reservedOffsetAmountCents: 900n }]
      : query.sql.includes('"User"') ? [{ isActive: true }] : [claim]);
    tx.expenseLoanOffsetReservation.findMany.mockResolvedValue([{ id: "reserved-1", loanAccountId: "loan-1", amountCents: 600n }]);

    await expect(service.withdrawApproval(claim.id, "user-foreign", round.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.withdrawApproval(claim.id, "user-a", "stale")).rejects.toBeInstanceOf(ConflictException);
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    await expect(service.withdrawApproval(claim.id, "user-a", round.id)).resolves.toEqual({ id: claim.id, status: "draft" });

    expect(tx.expenseClaim.update).toHaveBeenCalledWith({ where: { id: claim.id }, data: {
      status: "draft", approvalInstanceId: null, loanOffsetAmountCents: 0n, companyPayableAmountCents: 0n
    } });
    expect(tx.approvalInstance.update).toHaveBeenCalledWith({ where: { id: round.id }, data: { status: "withdrawn" } });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: { approvalInstanceId: round.id, action: "withdraw", actorUserId: "user-a" }
    });
    expect(tx.expenseLoanOffsetReservation.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["reserved-1"] }, status: "reserved" },
      data: expect.objectContaining({ status: "released" })
    });
    expect(tx.employeeProjectLoanAccount.update).toHaveBeenCalledWith({ where: { id: "loan-1" }, data: { reservedOffsetAmountCents: 300n } });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "expense_claim.approval.withdraw", metadata: { approvalInstanceId: round.id, releasedAmountCents: "600" }
    }));

    tx.expenseClaim.findUnique.mockResolvedValue({ ...claim, status: "approved_pending_payment" });
    await expect(service.withdrawApproval(claim.id, "user-a", round.id)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.approvalInstance.update).toHaveBeenCalledTimes(1);
  });

  it("updates the returned draft bearing decision without updating the original company or payment subject", async () => {
    const updatedAt = new Date("2026-11-12T10:00:00Z");
    const claim = { id: "claim-returned", status: "draft", submittedAt: updatedAt, approvalInstanceId: null,
      approvedAt: null, handledByUserId: "user-a", claimType: "incidental_expense", companyEntityId: "company-1",
      projectId: "project-1", requestedAmountCents: 800n, fundedAmountCents: 0n, updatedAt };
    const { service, tx } = createHarness({ claim });
    tx.expenseClaim.findUnique.mockResolvedValue(claim);
    tx.$queryRaw.mockImplementation(async ({ sql }) => sql.includes('"User"') ? [{ isActive: true }] : [claim]);
    tx.expenseClaim.update.mockResolvedValue(claim);
    await service.editReturnedDraft(claim.id, "user-a", {
      expectedUpdatedAt: updatedAt.toISOString(), reason: "核对后尚无承担公司", costBearingCompanyEntityId: null
    });
    const fields = tx.expenseClaim.update.mock.calls[0][0].data;
    expect(fields).toMatchObject({ costBearingCompanySpecified: true, costBearingCompanyEntityId: null });
    expect(fields).not.toHaveProperty("companyEntityId");
    expect(fields).not.toHaveProperty("paymentSubjectCompanyEntityId");
  });

  it("checks a linked returned draft revision against the original procurement's remaining approved amount", async () => {
    const updatedAt = new Date("2026-11-12T10:00:00Z");
    const claim = { id: "claim-r", status: "draft", claimType: "incidental_expense", projectId: "project-1",
      companyEntityId: "company-1", generalProcurementId: "procurement-1", incidentalExpenseCategory: "procurement_construction_tools",
      generalProcurementRequestKey: "original-request-key", generalProcurementFingerprint: "original-fingerprint",
      approvalInstanceId: null, handledByUserId: "user-a", fundedAmountCents: 0n, submittedAt: updatedAt, updatedAt, requestedAmountCents: 70n };
    const { service, tx } = createHarness();
    tx.expenseClaim.findUnique.mockResolvedValue(claim);
    tx.$queryRaw.mockImplementation(async (query: { sql: string }) => query.sql.includes('"User"') ? [{ isActive: true }] : [claim]);
    tx.generalProcurement.findUnique.mockResolvedValue({ status: "archived", category: "construction_tools", requestProtocolVersion: 1,
      requestedAmountCents: 100n, projectId: claim.projectId, companyEntityId: claim.companyEntityId });
    tx.expenseClaim.aggregate.mockResolvedValue({ _sum: { requestedAmountCents: 25n } });
    const input = { reason: "更正请款金额", expectedUpdatedAt: updatedAt.toISOString() };
    await expect(service.editReturnedDraft(claim.id, "user-a", { ...input, requestedAmountCents: "76" })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.expenseClaim.update).not.toHaveBeenCalled();
    tx.expenseClaim.update.mockResolvedValue({ id: claim.id, status: "draft", updatedAt, requestedAmountCents: 65n });
    await expect(service.editReturnedDraft(claim.id, "user-a", { ...input, requestedAmountCents: "65" }))
      .resolves.toEqual({ id: claim.id, status: "draft", updatedAt, requestedAmountCents: "65" });
    expect(tx.expenseClaim.aggregate).toHaveBeenCalledWith({
      where: { generalProcurementId: claim.generalProcurementId, id: { not: claim.id }, status: { not: "rejected" } },
      _sum: { requestedAmountCents: true }
    });
    expect(tx.expenseClaim.update).toHaveBeenCalledWith({
      where: { id: claim.id }, data: { reason: input.reason, requestedAmountCents: 65n, updatedAt: expect.any(Date) },
      select: { id: true, status: true, updatedAt: true, requestedAmountCents: true }
    });
  });

  it("posts frozen reservations as immutable offsets at final reimbursement approval without creating company payment", async () => {
    const claim = { id: "claim-r", claimType: "reimbursement", status: "approval_pending", projectId: "project-1", applicantUserId: "user-a", handledByUserId: "user-a", factWitnessUserId: null, requestedAmountCents: 3000n, loanOffsetAmountCents: 3000n, companyPayableAmountCents: 0n };
    const instance = { id: "approval-r", currentNodeIndex: 0, applicantUserId: "user-a", frozenNodes: [{ name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"], candidateUserIds: ["comp-1"], candidateUserIdsByRole: { comprehensive_director: ["comp-1"] } }] };
    const approvalForms = { generateForInstance: jest.fn().mockResolvedValue({ id: "pdf-1" }) };
    const operatingSources = {
      appendConfirmedSourceIfEnabledInTransaction: jest.fn().mockResolvedValue(null)
    };
    const { service, tx } = createHarness({
      roles: ["comprehensive_director"],
      approvalForms,
      operatingSources
    });
    tx.$queryRaw
      .mockResolvedValueOnce([claim])
      .mockResolvedValueOnce([instance])
      .mockResolvedValueOnce([{ id: "comp-1", isActive: true, name: "签批人甲" }])
      .mockResolvedValueOnce([{ id: "signature-1", fileId: "file-1", contentSha256: "a".repeat(64) }])
      .mockResolvedValueOnce([{ id: "file-1", contentSha256: "a".repeat(64), storageStatus: "active" }])
      .mockResolvedValueOnce([{ id: "account-1", offsetAmountCents: 0n, reservedOffsetAmountCents: 3000n, balanceAmountCents: 3000n }])
      .mockResolvedValueOnce([{ nextSequenceNo: 5n }]);
    tx.expenseLoanOffsetReservation.findMany.mockResolvedValue([{ id: "reserve-1", loanAccountId: "account-1", amountCents: 3000n }]);
    tx.employeeProjectLoanEntry.create.mockResolvedValue({ id: "loan-entry-offset-1" });
    tx.expenseClaim.update.mockResolvedValue({ id: "claim-r", status: "offset_completed" });

    await expect(service.review("claim-r", "comp-1", { decision: "approve" })).resolves.toEqual({ id: "claim-r", status: "offset_completed", completed: true });
    expect(approvalForms.generateForInstance).toHaveBeenCalledWith("approval-r", "comp-1");
    expect(tx.employeeProjectLoanEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ entryType: "offset", sourceExpenseClaimId: "claim-r", sourceReservationId: "reserve-1", amountCents: 3000n, balanceDeltaCents: -3000n }) });
    expect(
      operatingSources.appendConfirmedSourceIfEnabledInTransaction
    ).toHaveBeenCalledWith(
      tx,
      {
        projectId: "project-1",
        sourceType: "employee_project_loan_entry",
        sourceBusinessId: "loan-entry-offset-1"
      },
      "comp-1"
    );
    expect(tx.employeeProjectLoanAccount.update).toHaveBeenCalledWith({ where: { id: "account-1" }, data: { offsetAmountCents: 3000n, reservedOffsetAmountCents: 0n, balanceAmountCents: 0n } });
    expect(tx.expenseLoanOffsetReservation.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["reserve-1"] }, status: "reserved" }, data: expect.objectContaining({ status: "posted" }) });
  });

});

it.each(["reimbursement", "incidental_expense"])(
  "registers %s public cash on the existing payment HTTP entry",
  async claimType => {
    const keeper = { ...actor, id: "cash-keeper" };
    const voucherFileId = "cash-keeper-voucher";
    const previousId = "00000000-0000-4000-8000-000000000001";
    const sourceBatchId = "00000000-0000-4000-8000-000000000002";
    const costImpactId = "00000000-0000-4000-8000-000000000004";
    const claim = {
      id: "cash-claim", claimType, status: "approved_pending_payment", projectId: "project-1",
      companyEntityId: "claim-debtor", companyEntityNameSnapshot: "合成申请公司",
      companyPayableAmountCents: 800n, fundedAmountCents: 0n
    };
    const appendSource = jest.fn();
    const { service, tx, prisma, audit } = createHarness({
      roles: ["comprehensive_director"], claim,
      auth: { confirmPassword: jest.fn().mockResolvedValue(undefined) },
      files: { assertFileHasNoBusinessBinding: jest.fn().mockResolvedValue(undefined) },
      operatingSources: { appendConfirmedSourceIfEnabledInTransaction: appendSource }
    });
    tx.expenseClaim.findUnique.mockResolvedValue({ projectId: claim.projectId });
    const source = { id: sourceBatchId, lineNo: 1, sourceStatus: "pending", sourceName: null,
      projectStatus: "pending", projectId: null, amountYuan: new Prisma.Decimal("100") };
    const previous = {
      id: previousId, accountId: "cash-account", asOfDate: "2026-11-01", version: 1,
      balanceYuan: new Prisma.Decimal("100"), sources: [source]
    };
    const createRegistration = jest.fn().mockResolvedValue({ id: "cash-debit" });
    const createSources = jest.fn();
    const readCustody = jest.fn().mockResolvedValue({ currentCustodianId: keeper.id });
    const writeRevision = jest.fn();
    const findAccount = jest.fn().mockResolvedValue({
      id: "cash-account", kind: "public_cash", companyEntityId: null, company: null, writeRevision: 1
    });
    const findRecorded = jest.fn();
    const createPayment = jest.fn(async ({ data }) => {
      findRecorded.mockResolvedValue(data);
      return data;
    });
    const originalCosts = jest.fn().mockResolvedValue([{ id: costImpactId, amountCents: 800n }]);
    const readLinks = jest.fn().mockResolvedValue([]);
    const createLinks = jest.fn();
    Object.assign(tx, {
      operatingImpactEntry: { findMany: originalCosts },
      expensePublicCashCostLink: { groupBy: readLinks, createMany: createLinks },
      registeredFundAccount: { findUnique: findAccount, update: writeRevision },
      publicCashCustody: { findUnique: readCustody },
      fundAccountBalanceRegistration: {
        findFirst: jest.fn().mockResolvedValue(previous), findFirstOrThrow: jest.fn().mockResolvedValue(previous),
        findMany: jest.fn().mockResolvedValue([{ id: previousId }]), create: createRegistration
      },
      registeredFundPaymentAllocation: { findMany: jest.fn().mockResolvedValue([]) },
      registeredFundTransferLine: { findMany: jest.fn().mockResolvedValue([]) },
      fundAccountSourceBatch: { findMany: jest.fn().mockResolvedValue([source]), createMany: createSources },
      registeredOperationalPayment: { create: createPayment, findUnique: findRecorded },
      $executeRaw: jest.fn()
    });
    tx.fileObject.findUnique.mockResolvedValue({ id: voucherFileId, uploadedByUserId: keeper.id });
    const controlledVoucher = jest.fn(async (query: Prisma.Sql) => {
      const execution = {
        id: "cash-execution", expenseClaimId: query.values[0], recordedByUserId: query.values[1],
        amountCents: query.values[2], paidAt: query.values[3], paymentMethod: query.values[4],
        voucherFileId: query.values[5], note: query.values[6]
      };
      tx.expenseClaimPaymentExecution.findUnique.mockResolvedValue(execution);
      return [{ id: execution.id }];
    });
    tx.$queryRaw.mockImplementation(async (query: Prisma.Sql) =>
      query.sql.includes("jg_record_expense_public_cash_voucher") ? controlledVoucher(query) : [claim]);
    tx.expenseClaim.update.mockImplementation(async ({ data }) => {
      Object.assign(claim, data);
      return claim;
    });
    const productionFunding = jest.requireActual<typeof import("../fund-account/registered-operational-payment")>(
      "../fund-account/registered-operational-payment"
    );
    jest.mocked(appendRegisteredOperationalPayment).mockImplementation(productionFunding.appendRegisteredOperationalPayment);
    jest.mocked(readRegisteredOperationalPayment).mockImplementation(productionFunding.readRegisteredOperationalPayment);

    const testModule = await Test.createTestingModule({
      controllers: [ExpenseClaimController],
      providers: [{ provide: ExpenseClaimService, useValue: service }, { provide: FileService, useValue: {} }]
    }).compile();
    const app = testModule.createNestApplication({ logger: false });
    app.use((request: { user?: typeof actor }, _response: unknown, next: () => void) => {
      request.user = keeper;
      next();
    });
    app.useGlobalGuards(new RetiredWriteEntryGuard(), new PermissionGuard(new Reflector(), prisma as never));
    app.useGlobalPipes(createApiValidationPipe());
    const registeredFunding = {
      scopeKey: "public_cash", expectedRegistrationId: previousId,
      sourceAllocations: [{ sourceBatchId, amountCents: "800" }],
      costAllocations: [{ costImpactId, amountCents: "300" }]
    };
    const previousSecret = process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
    const testSecret = "isolated-expense-cash-write-authority";
    process.env.OPERATING_LEDGER_DB_WRITE_SECRET = testSecret;
    try {
      await app.listen(0, "127.0.0.1");
      const url = `${await app.getUrl()}/expense-claims/cash-claim/payments`;
      const post = (funding = registeredFunding) => fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountCents: "800", paidAt: "2026-11-05", paymentMethod: "现金",
          voucherFileId, confirmationPassword: "synthetic-only", registeredFunding: funding })
      });
      expect((await post({ ...registeredFunding, scopeKey: "company:claim-debtor" })).status).toBe(403);
      // The synthetic Prisma fixture does not roll back writes. Check wrong
      // custody directly before testing the real HTTP commit and replay.
      readCustody.mockResolvedValueOnce({ currentCustodianId: "previous-keeper" });
      await expect(productionFunding.appendRegisteredOperationalPayment(tx as never, {
        sourceType: "expense_claim_payment_execution", executionId: "not-posted", actorUserId: keeper.id,
        projectId: claim.projectId, originalDebtorCompanyId: claim.companyEntityId, amountCents: 800n,
        paidAt: new Date("2026-11-05"), funding: registeredFunding
      })).rejects.toThrow(ForbiddenException);
      expect(writeRevision).not.toHaveBeenCalled();
      expect(createPayment).not.toHaveBeenCalled();
      controlledVoucher.mockRejectedValueOnce(Object.assign(new Error("collision"), {
        code: "P2010",
        meta: { code: "P0A24", message: "EXPENSE_PUBLIC_CASH_VOUCHER_COLLISION" }
      }));
      expect((await post()).status).toBe(409);
      expect(writeRevision).not.toHaveBeenCalled();
      expect(createPayment).not.toHaveBeenCalled();

      const receipt = await post();
      expect({ status: receipt.status, body: await receipt.json() }).toMatchObject({
        status: 201,
        body: { id: "cash-execution", paidAmountCents: "800", status: "paid",
          registeredFunding: { actualPayerKind: "public_cash", actualPayerCompanyId: null, relationshipEntryId: null } }
      });
      const replay = await post();
      expect({ status: replay.status, body: await replay.json() }).toMatchObject({
        status: 201, body: { id: "cash-execution", paidAmountCents: "800", status: "paid" }
      });
      expect((await post({ ...registeredFunding, costAllocations: [{ costImpactId, amountCents: "301" }] })).status).toBe(409);
      expect((await post({ ...registeredFunding, expectedRegistrationId: "00000000-0000-4000-8000-000000000003" })).status).toBe(409);
      expect(writeRevision).toHaveBeenCalledTimes(1);
      expect(controlledVoucher).toHaveBeenCalledTimes(2);
      expect(controlledVoucher.mock.calls[1][0].values)
        .toEqual([claim.id, keeper.id, 800n, new Date("2026-11-05"), "现金", voucherFileId, null, previousId, testSecret]);
      expect(tx.expenseClaimPaymentExecution.create).not.toHaveBeenCalled();
      expect(createRegistration.mock.calls[0][0].data.balanceYuan.toFixed(4)).toBe("92.0000");
      expect(createSources.mock.calls[0][0].data).toMatchObject([
        { previousSourceBatchId: sourceBatchId, sourceStatus: "pending", sourceName: null }
      ]);
      expect(createSources.mock.calls[0][0].data[0].amountYuan.toFixed(4)).toBe("92.0000");
      expect(createPayment).toHaveBeenCalledTimes(1);
      expect(createPayment.mock.calls[0][0].data).toMatchObject({
        actualPayerCompanyId: null, actualPayerName: "公共现金", originalDebtorCompanyId: claim.companyEntityId,
        allocations: { create: [{ sourceBatchId, amountCents: 800n }] }
      });
      expect(originalCosts).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          projectId: claim.projectId, impactKind: "confirmed_cost",
          fact: expect.objectContaining({ sourceBusinessId: claim.id, sourceType: "expense_claim_approval" })
        })
      }));
      expect(createLinks).toHaveBeenCalledTimes(1);
      expect(createLinks).toHaveBeenCalledWith({ data: [{ operationalPaymentId: createPayment.mock.calls[0][0].data.id,
        costImpactId, amountCents: 300n }] });
      expect(appendSource).toHaveBeenCalledTimes(1);
      const payments = audit.record.mock.calls.filter(([, event]) =>
        event.action === "expense_claim.reimbursement.payment.record" || event.action === "incidental_expense.payment.record"
      );
      expect(payments).toHaveLength(1);
    } finally {
      if (previousSecret === undefined) delete process.env.OPERATING_LEDGER_DB_WRITE_SECRET;
      else process.env.OPERATING_LEDGER_DB_WRITE_SECRET = previousSecret;
      jest.mocked(appendRegisteredOperationalPayment).mockReset();
      jest.mocked(readRegisteredOperationalPayment).mockReset().mockResolvedValue(null);
      await app.close();
    }
  }
);

describe("登记资金报销补付", () => {
  const registeredFunding = { scopeKey: "company:actual", expectedRegistrationId: "registration-1",
    sourceAllocations: [{ sourceBatchId: "batch-1", amountCents: "800" }] };
  const body = { amountCents: "800", paidAt: "2020-07-24", paymentMethod: "银行转账",
    voucherFileId: "voucher-1", confirmationPassword: "current-password", registeredFunding };
  const receipt = { actualPayerCompanyId: "actual-company", relationshipEntryId: "debt-1" };
  const first = { id: "execution-1", expenseClaimId: "claim-1", amountCents: 800n, paidAt: new Date(body.paidAt),
    paymentMethod: body.paymentMethod, voucherFileId: body.voucherFileId, recordedByUserId: "finance-1", note: null };

  function setup(existing: boolean, companyName = "原债务公司") {
    jest.mocked(appendRegisteredOperationalPayment).mockReset().mockResolvedValue(receipt);
    jest.mocked(readRegisteredOperationalPayment).mockReset().mockResolvedValue(existing ? receipt : null);
    const projectFunding = { lockFundingContext: jest.fn(), allocateExecution: jest.fn() };
    const { service, tx, audit } = createHarness({
      claim: { id: "claim-1", claimType: "reimbursement", status: "partially_paid", projectId: "project-1",
        companyEntityId: "original-debtor", companyEntityNameSnapshot: companyName,
        paymentSubjectCompanyEntityId: "approved-payer", companyPayableAmountCents: 1800n,
        fundedAmountCents: existing ? 800n : 0n },
      auth: { confirmPassword: jest.fn().mockResolvedValue(undefined) }, projectFunding
    });
    tx.expenseClaimPaymentExecution.findUnique.mockResolvedValue(existing ? first : null);
    tx.expenseClaimPaymentExecution.create.mockResolvedValue(first);
    tx.fileObject.findUnique.mockResolvedValue({ id: "voucher-1", uploadedByUserId: "finance-1" });
    return { service, tx, audit, projectFunding };
  }

  it("posts once by the execution and frozen original debtor, without a second project allocation", async () => {
    const { service, tx, projectFunding, audit } = setup(false);
    await expect(service.recordPayment("claim-1", "finance-1", body)).resolves.toEqual({
      id: "execution-1", expenseClaimId: "claim-1", paidAmountCents: "800", status: "partially_paid", registeredFunding: receipt
    });
    expect(appendRegisteredOperationalPayment).toHaveBeenCalledWith(tx, {
      sourceType: "expense_claim_payment_execution", executionId: "execution-1", actorUserId: "finance-1",
      projectId: "project-1", originalDebtorCompanyId: "original-debtor", amountCents: 800n,
      paidAt: new Date(body.paidAt), funding: registeredFunding
    });
    expect(projectFunding.lockFundingContext).not.toHaveBeenCalled();
    expect(projectFunding.allocateExecution).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it("returns the stored registered funding receipt for the same voucher without writing again", async () => {
    const { service, tx, projectFunding, audit } = setup(true);
    await expect(service.recordPayment("claim-1", "finance-1", body)).resolves.toMatchObject({ id: first.id, registeredFunding: receipt });
    expect(readRegisteredOperationalPayment).toHaveBeenCalledWith(tx, expect.objectContaining({ executionId: first.id, funding: registeredFunding }));
    expect(appendRegisteredOperationalPayment).not.toHaveBeenCalled();
    expect(tx.expenseClaimPaymentExecution.create).not.toHaveBeenCalled();
    expect(tx.expenseClaim.update).not.toHaveBeenCalled();
    expect(projectFunding.allocateExecution).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("does not add registered funding to an already recorded historical execution", async () => {
    const { service, tx, projectFunding } = setup(true);
    jest.mocked(readRegisteredOperationalPayment).mockRejectedValueOnce(new ConflictException("资金凭据与本次提交不同"));
    await expect(service.recordPayment("claim-1", "finance-1", body)).rejects.toThrow("资金凭据与本次提交不同");
    expect(appendRegisteredOperationalPayment).not.toHaveBeenCalled();
    expect(tx.expenseClaim.update).not.toHaveBeenCalled();
    expect(projectFunding.allocateExecution).not.toHaveBeenCalled();
  });

  it("does not write or fall back to legacy funding after a registered replay mismatch", async () => {
    const { service, tx, projectFunding, audit } = setup(true);
    jest.mocked(readRegisteredOperationalPayment).mockRejectedValueOnce(new ConflictException("资金凭据与本次提交不同"));
    await expect(service.recordPayment("claim-1", "finance-1", body)).rejects.toThrow("资金凭据与本次提交不同");
    expect(appendRegisteredOperationalPayment).not.toHaveBeenCalled();
    expect(projectFunding.allocateExecution).not.toHaveBeenCalled();
    expect(tx.expenseClaim.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("returns the frozen company only for registered rows in authorized payment history", async () => {
    const { service, tx } = createHarness();
    tx.expenseClaim.findFirst.mockResolvedValue({
      id: "claim-1", code: "BX-1", claimType: "reimbursement", status: "partially_paid",
      projectId: "project-1", applicantUserId: "user-a", handledByUserId: "user-a",
      requestedAmountCents: 1800n, loanOffsetAmountCents: 0n, companyPayableAmountCents: 1800n,
      fundedAmountCents: 1000n, paymentSubjectCompanyEntityId: "later-claim-payer",
      companyEntityId: "original-debtor", companyEntityNameSnapshot: "原债务公司"
    });
    tx.expenseClaimLine.findMany.mockResolvedValue([]);
    tx.expenseClaimPaymentExecution.findMany.mockResolvedValue([
      { ...first, registeredOperationalPayment: { id: "debt-1", actualPayerCompanyId: "actual-company",
        actualPayerName: "实付公司", originalDebtorCompanyId: "original-debtor" } },
      { id: "history", amountCents: 200n, registeredOperationalPayment: null }
    ]);
    const result = await service.getMine("claim-1", "user-a");
    expect(result.originalDebtorCompanyId).toBe("original-debtor");
    expect(result.paymentExecutions).toMatchObject([
      { id: first.id, amountCents: "800", registeredFunding: {
        actualPayerCompanyId: "actual-company", actualPayerName: "实付公司",
        originalDebtorCompanyId: "original-debtor", relationshipEntryId: "debt-1"
      } },
      { id: "history", amountCents: "200" }
    ]);
    expect(result.paymentExecutions[1]).not.toHaveProperty("registeredFunding");
  });

  it("rejects unresolved original debt while retaining the existing claim", async () => {
    const { service, tx } = setup(false, "");
    await expect(service.recordPayment("claim-1", "finance-1", body)).rejects.toThrow("归属待核对");
    expect(tx.expenseClaimPaymentExecution.create).not.toHaveBeenCalled();
    expect(appendRegisteredOperationalPayment).not.toHaveBeenCalled();
  });
});
