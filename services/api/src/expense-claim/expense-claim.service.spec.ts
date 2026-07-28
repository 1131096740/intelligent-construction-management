import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ExpenseClaimService } from "./expense-claim.service";

function createHarness(options?: { roles?: string[]; claim?: Record<string, unknown>; approvalAssignments?: Array<{ userId: string; positionId: string; role: string }>; auth?: { confirmPassword: jest.Mock }; files?: { assertFileHasNoBusinessBinding: jest.Mock }; approvalForms?: { generateForInstance: jest.Mock }; projectFunding?: { lockFundingContext: jest.Mock; allocateExecution: jest.Mock } }) {
  const approvalAssignments = options?.approvalAssignments ?? [];
  const tx = {
    companyEntity: { findFirst: jest.fn(), findMany: jest.fn() },
    project: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    userPosition: { findMany: jest.fn().mockResolvedValue(approvalAssignments.length ? approvalAssignments.map(({ userId, positionId }) => ({ userId, positionId })) : (options?.roles ?? []).map((_, index) => ({ positionId: `position-${index}` }))) },
    projectMember: { findMany: jest.fn().mockResolvedValue([]) },
    position: { findMany: jest.fn().mockResolvedValue(approvalAssignments.length ? approvalAssignments.map(({ positionId, role }) => ({ id: positionId, key: role })) : (options?.roles ?? []).map((key, index) => ({ id: `position-${index}`, key })) ) },
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue(approvalAssignments.map(({ userId }) => ({ id: userId })))
    },
    expenseClaim: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    expenseClaimLine: { createMany: jest.fn(), findMany: jest.fn() },
    expenseClaimAttachment: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    fileObject: { findUnique: jest.fn() },
    employeeProjectLoanAccount: { upsert: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    employeeProjectLoanEntry: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
    employeeLoanRepayment: { create: jest.fn(), update: jest.fn() },
    expenseClaimPaymentExecution: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    expenseLoanOffsetReservation: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn(), updateMany: jest.fn() },
    approvalInstance: { create: jest.fn(), update: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
    approvalActionLog: { create: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue(options?.claim ? [options.claim] : [])
  };
  const prisma = { $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)), companyEntity: tx.companyEntity, expenseClaim: tx.expenseClaim, expenseClaimLine: tx.expenseClaimLine, expenseClaimAttachment: tx.expenseClaimAttachment, expenseClaimPaymentExecution: tx.expenseClaimPaymentExecution, employeeLoanRepayment: { findMany: jest.fn() }, pdfDocument: { findFirst: jest.fn().mockResolvedValue(null) }, fileObject: { findMany: jest.fn() }, project: tx.project, user: tx.user, userPosition: tx.userPosition, projectMember: tx.projectMember, position: tx.position, approvalInstance: tx.approvalInstance };
  const numbering = { allocateDaily: jest.fn().mockResolvedValue("BX-20260723-001") };
  const audit = { record: jest.fn().mockResolvedValue({}) };
  const visibility = { visibleProjectIds: jest.fn().mockResolvedValue(["project-1"]) };
  const service = new ExpenseClaimService(prisma as never, numbering as never, audit as never, options?.auth as never, visibility as never, options?.files as never, options?.approvalForms as never, options?.projectFunding as never);
  return { service, tx, numbering, audit, visibility };
}

const actor = { id: "user-a", name: "经办人", phone: "13800000000", isActive: true };

describe("ExpenseClaimService", () => {
  it("returns all selectable active company entities but only the actor's visible projects", async () => {
    const { service, tx, visibility } = createHarness();
    tx.companyEntity.findMany.mockResolvedValue([{ id: "company-1", name: "建工智管" }]);
    tx.project.findMany.mockResolvedValue([{ id: "project-1", code: "JGXM-001", name: "科技园项目" }]);
    tx.user.findMany.mockResolvedValue([{ id: "user-a", name: "经办人" }, { id: "user-b", name: "申请人" }]);
    await expect(service.createOptions("user-a")).resolves.toEqual(expect.objectContaining({ companyEntities: [{ id: "company-1", name: "建工智管" }], projects: [{ id: "project-1", code: "JGXM-001", name: "科技园项目" }], canProxy: false, applicantUsers: [{ id: "user-a", name: "经办人" }], factWitnessUsers: [{ id: "user-a", name: "经办人" }, { id: "user-b", name: "申请人" }] }));
    expect(visibility.visibleProjectIds).toHaveBeenCalledWith("user-a");
    expect(tx.project.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["project-1"] }, isActive: true } }));
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

    expect(tx.companyEntity.findFirst).toHaveBeenCalledWith({
      where: { id: "company-pay", isActive: true, dataStatus: "complete" },
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
    const { service, tx, audit } = createHarness({
      claim,
      auth: { confirmPassword: jest.fn().mockResolvedValue(undefined) },
      files,
      projectFunding
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

  it("corrects a confirmed repayment by appending one reversal entry without mutating the original entry", async () => {
    const claim = { id: "claim-1", claimType: "loan", projectId: "project-1", applicantUserId: "employee-1" };
    const { service, tx, audit } = createHarness({ claim, auth: { confirmPassword: jest.fn().mockResolvedValue(undefined) } });
    tx.$queryRaw
      .mockResolvedValueOnce([claim])
      .mockResolvedValueOnce([{ id: "repayment-1", loanAccountId: "account-1", amountCents: 300n, status: "confirmed", confirmedByUserId: "finance-director-1" }])
      .mockResolvedValueOnce([{ id: "account-1", userId: "employee-1", scopeKey: "project:project-1", balanceAmountCents: 700n, repaidAmountCents: 300n }])
      .mockResolvedValueOnce([{ id: "entry-1", entryType: "repayment", amountCents: 300n, balanceDeltaCents: -300n, sourceRepaymentId: "repayment-1" }])
      .mockResolvedValueOnce([{ nextSequenceNo: 5n }]);
    tx.employeeProjectLoanEntry.create.mockResolvedValue({ id: "reversal-entry-1" });
    tx.employeeLoanRepayment.update.mockResolvedValue({ id: "repayment-1", status: "reversed" });

    await expect(service.reverseEmployeeLoanRepayment("claim-1", "repayment-1", "finance-director-1", {
      reason: "银行回单金额录入错误", confirmationPassword: "current-password"
    })).resolves.toMatchObject({ id: "repayment-1", status: "reversed", amountCents: "300" });

    expect(tx.employeeProjectLoanEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      entryType: "reversal", amountCents: 300n, balanceDeltaCents: 300n, reversalOfEntryId: "entry-1"
    }) }));
    expect(tx.employeeProjectLoanAccount.update).toHaveBeenCalledWith(expect.objectContaining({ data: { repaidAmountCents: 0n, balanceAmountCents: 1000n } }));
    expect(tx.employeeLoanRepayment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "reversed", reversedByUserId: "finance-director-1" }) }));
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "expense_claim.loan_repayment.reverse" }));
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
    tx.expenseClaimAttachment.create.mockResolvedValue({ id: "attachment-new", fileId: "file-new", category: "receipt_or_other", expenseCategory: null, stage: "post_submit_append", createdAt: new Date() });

    await expect(service.appendAttachment("claim-1", "finance-1", { fileId: "file-new", category: "receipt_or_other" })).resolves.toMatchObject({ id: "attachment-new", stage: "post_submit_append" });

    expect(tx.expenseClaimAttachment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ stage: "post_submit_append", attachedByUserId: "finance-1" }) });
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
      .mockResolvedValueOnce([{ id: "comp-1", isActive: true }])
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

  it("rejects a same-role user who was not frozen into the current node", async () => {
    const claim = { id: "claim-1", claimType: "loan", status: "approval_pending", projectId: "project-1", handledByUserId: "user-a", factWitnessUserId: null, requestedAmountCents: 1200n };
    const instance = { id: "approval-1", currentNodeIndex: 0, applicantUserId: "user-a", frozenNodes: [{ name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"], candidateUserIds: ["comp-1"], candidateUserIdsByRole: { comprehensive_director: ["comp-1"] } }] };
    const { service, tx } = createHarness({ roles: ["comprehensive_director"] });
    tx.$queryRaw.mockResolvedValueOnce([claim]).mockResolvedValueOnce([instance]);

    await expect(service.review("claim-1", "comp-2", { decision: "approve" })).rejects.toThrow(ForbiddenException);
    expect(tx.expenseClaim.update).not.toHaveBeenCalled();
  });

  it("requires password and Canvas signature snapshot before a frozen applicant self-review", async () => {
    const claim = { id: "claim-1", claimType: "reimbursement", status: "approval_pending", projectId: "project-1", applicantUserId: "leader-1", handledByUserId: "leader-1", factWitnessUserId: null, requestedAmountCents: 1200n, loanOffsetAmountCents: 0n, companyPayableAmountCents: 1200n };
    const instance = { id: "approval-1", currentNodeIndex: 0, applicantUserId: "leader-1", frozenNodes: [{ name: "董事长/总经理", mode: "any", roleKeys: ["general_manager"], candidateUserIds: ["leader-1"], candidateUserIdsByRole: { general_manager: ["leader-1"] } }] };
    const auth = { confirmPassword: jest.fn().mockResolvedValue({}) };
    const { service, tx } = createHarness({ roles: ["general_manager"], auth });
    tx.$queryRaw
      .mockResolvedValueOnce([claim])
      .mockResolvedValueOnce([instance])
      .mockResolvedValueOnce([{ id: "leader-1", isActive: true }])
      .mockResolvedValueOnce([{ id: "signature-1", fileId: "file-1", contentSha256: "a".repeat(64) }])
      .mockResolvedValueOnce([{ id: "file-1", contentSha256: "a".repeat(64), storageStatus: "active" }]);
    tx.expenseClaim.update.mockResolvedValue({ id: "claim-1", status: "approved_pending_payment" });

    await expect(service.review("claim-1", "leader-1", { decision: "approve", selfReviewReason: "职责兼任", confirmationPassword: "current-password" })).resolves.toEqual({ id: "claim-1", status: "approved_pending_payment", completed: true });

    expect(auth.confirmPassword).toHaveBeenCalledWith("leader-1", "current-password");
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ metadata: { selfReview: true, selfReviewReason: "职责兼任" }, signatureFileIdSnapshot: "file-1", signatureVersionIdSnapshot: "signature-1" })
    });
  });

  it("records a voucher-backed actual loan disbursement and only then increases the locked account balance", async () => {
    const auth = { confirmPassword: jest.fn().mockResolvedValue({}) };
    const projectFunding = {
      lockFundingContext: jest.fn().mockResolvedValue(undefined),
      allocateExecution: jest.fn().mockResolvedValue({
        kind: "allocated",
        projectCashAmountCents: 3000n,
        financingQuotaAmountCents: 0n,
        allocations: [{ sourceType: "project_cash", sourceId: null, amountCents: 3000n }]
      })
    };
    const files = {
      assertFileHasNoBusinessBinding: jest.fn().mockResolvedValue({
        id: "voucher-1",
        uploadedByUserId: "finance-1",
        storageStatus: "active"
      })
    };
    const { service, tx, audit } = createHarness({
      auth,
      files,
      projectFunding
    });
    const claim = { id: "claim-1", claimType: "loan", status: "approved_pending_disbursement", projectId: "project-1", companyEntityId: "company-1", applicantUserId: "user-a", requestedAmountCents: 10000n, fundedAmountCents: 2000n };
    tx.expenseClaim.findUnique.mockResolvedValue({ id: "claim-1", projectId: "project-1" });
    tx.$queryRaw
      .mockResolvedValueOnce([claim])
      .mockResolvedValueOnce([{ id: "account-1", fundedAmountCents: 2000n, offsetAmountCents: 0n, repaidAmountCents: 0n, reservedOffsetAmountCents: 0n, balanceAmountCents: 2000n }])
      .mockResolvedValueOnce([{ nextSequenceNo: 2n }]);
    tx.fileObject.findUnique.mockResolvedValue({ id: "voucher-1", uploadedByUserId: "finance-1" });
    tx.employeeProjectLoanEntry.create.mockResolvedValue({ id: "entry-2" });

    await expect(service.recordLoanDisbursement("claim-1", "finance-1", {
      amountCents: "3000", paidAt: "2026-07-23", paymentMethod: "银行转账", voucherFileId: "voucher-1", confirmationPassword: "current-password"
    })).resolves.toEqual({ id: "entry-2", expenseClaimId: "claim-1", loanAccountId: "account-1", amountCents: "3000", fundedAmountCents: "5000", status: "partially_disbursed" });

    expect(tx.employeeProjectLoanEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ loanAccountId: "account-1", sequenceNo: 2n, entryType: "disbursement", amountCents: 3000n, voucherFileId: "voucher-1", paymentMethod: "银行转账" }) });
    expect(projectFunding.lockFundingContext).toHaveBeenCalledWith(tx, "project-1");
    expect(
      projectFunding.lockFundingContext.mock.invocationCallOrder[0]
    ).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[0]);
    expect(projectFunding.allocateExecution).toHaveBeenCalledWith(tx, {
      projectId: "project-1",
      executionType: "employee_loan_disbursement",
      executionId: "entry-2",
      businessType: "expense_claim",
      businessId: "claim-1",
      amountCents: 3000n,
      occurredAt: new Date("2026-07-23"),
      actorUserId: "finance-1"
    });
    expect(
      projectFunding.allocateExecution.mock.invocationCallOrder[0]
    ).toBeLessThan(
      tx.employeeProjectLoanAccount.update.mock.invocationCallOrder[0]
    );
    expect(files.assertFileHasNoBusinessBinding).toHaveBeenCalledWith(tx, "voucher-1");
    expect(tx.employeeProjectLoanAccount.update).toHaveBeenCalledWith({ where: { id: "account-1" }, data: { fundedAmountCents: 5000n, balanceAmountCents: 5000n } });
    expect(tx.expenseClaim.update).toHaveBeenCalledWith({ where: { id: "claim-1" }, data: { fundedAmountCents: 5000n, status: "partially_disbursed" } });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({
      action: "expense_claim.loan.disbursement.record",
      metadata: expect.objectContaining({
        fundingAllocation: {
          kind: "allocated",
          projectCashAmountCents: "3000",
          financingQuotaAmountCents: "0",
          allocations: [
            {
              sourceType: "project_cash",
              sourceId: null,
              amountCents: "3000"
            }
          ]
        }
      })
    }));
  });

  it("rolls back loan balances and audit when unified project funding is insufficient", async () => {
    const auth = { confirmPassword: jest.fn().mockResolvedValue({}) };
    const projectFunding = {
      lockFundingContext: jest.fn().mockResolvedValue(undefined),
      allocateExecution: jest.fn().mockRejectedValue(
        new BadRequestException("项目可用资金不足，当前最多可实际支付 2000 分")
      )
    };
    const { service, tx, audit } = createHarness({
      auth,
      files: { assertFileHasNoBusinessBinding: jest.fn().mockResolvedValue({}) },
      projectFunding
    });
    const claim = { id: "claim-1", claimType: "loan", status: "approved_pending_disbursement", projectId: "project-1", companyEntityId: "company-1", applicantUserId: "user-a", requestedAmountCents: 10000n, fundedAmountCents: 2000n };
    tx.expenseClaim.findUnique.mockResolvedValue({ id: "claim-1", projectId: "project-1" });
    tx.$queryRaw
      .mockResolvedValueOnce([claim])
      .mockResolvedValueOnce([{ id: "account-1", fundedAmountCents: 2000n, offsetAmountCents: 0n, repaidAmountCents: 0n, reservedOffsetAmountCents: 0n, balanceAmountCents: 2000n }])
      .mockResolvedValueOnce([{ nextSequenceNo: 2n }]);
    tx.fileObject.findUnique.mockResolvedValue({ id: "voucher-1", uploadedByUserId: "finance-1" });
    tx.employeeProjectLoanEntry.create.mockResolvedValue({ id: "entry-2" });

    await expect(service.recordLoanDisbursement("claim-1", "finance-1", {
      amountCents: "3000", paidAt: "2026-07-23", paymentMethod: "银行转账", voucherFileId: "voucher-1", confirmationPassword: "current-password"
    })).rejects.toThrow("项目可用资金不足，当前最多可实际支付 2000 分");

    expect(tx.employeeProjectLoanEntry.create).toHaveBeenCalled();
    expect(tx.employeeProjectLoanAccount.update).not.toHaveBeenCalled();
    expect(tx.expenseClaim.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("replays the same loan disbursement and funding allocation for an exact voucher retry", async () => {
    const paidAt = new Date("2026-07-23");
    const auth = { confirmPassword: jest.fn().mockResolvedValue({}) };
    const projectFunding = {
      lockFundingContext: jest.fn().mockResolvedValue(undefined),
      allocateExecution: jest.fn().mockResolvedValue({
        kind: "replayed",
        projectCashAmountCents: 3000n,
        financingQuotaAmountCents: 0n,
        allocations: [{ sourceType: "project_cash", sourceId: null, amountCents: 3000n }]
      })
    };
    const { service, tx, audit } = createHarness({
      auth,
      projectFunding
    });
    const claim = { id: "claim-1", claimType: "loan", status: "disbursed", projectId: "project-1", companyEntityId: "company-1", applicantUserId: "user-a", requestedAmountCents: 3000n, fundedAmountCents: 3000n };
    tx.expenseClaim.findUnique.mockResolvedValue({ id: "claim-1", projectId: "project-1" });
    tx.$queryRaw.mockResolvedValueOnce([claim]);
    tx.employeeProjectLoanEntry.findFirst.mockResolvedValue({
      id: "entry-1",
      loanAccountId: "account-1",
      entryType: "disbursement",
      amountCents: 3000n,
      balanceDeltaCents: 3000n,
      sourceExpenseClaimId: "claim-1",
      occurredAt: paidAt,
      createdByUserId: "finance-1",
      voucherFileId: "voucher-1",
      paymentMethod: "银行转账",
      note: null
    });

    await expect(service.recordLoanDisbursement("claim-1", "finance-1", {
      amountCents: "3000", paidAt: "2026-07-23", paymentMethod: "银行转账", voucherFileId: "voucher-1", confirmationPassword: "current-password"
    })).resolves.toEqual({
      id: "entry-1",
      expenseClaimId: "claim-1",
      loanAccountId: "account-1",
      amountCents: "3000",
      fundedAmountCents: "3000",
      status: "disbursed"
    });
    expect(projectFunding.allocateExecution).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ executionId: "entry-1" })
    );
    expect(tx.employeeProjectLoanEntry.create).not.toHaveBeenCalled();
    expect(tx.employeeProjectLoanAccount.update).not.toHaveBeenCalled();
    expect(tx.expenseClaim.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("does not create a loan ledger entry when a disbursement exceeds the remaining approved amount", async () => {
    const auth = { confirmPassword: jest.fn().mockResolvedValue({}) };
    const { service, tx } = createHarness({ auth });
    tx.$queryRaw.mockResolvedValueOnce([{ id: "claim-1", claimType: "loan", status: "approved_pending_disbursement", projectId: "project-1", companyEntityId: "company-1", applicantUserId: "user-a", requestedAmountCents: 10000n, fundedAmountCents: 9000n }]);
    await expect(service.recordLoanDisbursement("claim-1", "finance-1", {
      amountCents: "1001", paidAt: "2026-07-23", paymentMethod: "银行转账", voucherFileId: "voucher-1", confirmationPassword: "current-password"
    })).rejects.toThrow(BadRequestException);
    expect(tx.employeeProjectLoanEntry.create).not.toHaveBeenCalled();
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
    tx.$queryRaw.mockResolvedValueOnce([claim]).mockResolvedValueOnce([{ id: "account-1", balanceAmountCents: 10000n, reservedOffsetAmountCents: 1000n }]);
    tx.employeeProjectLoanEntry.findMany.mockResolvedValue([{ id: "entry-old", amountCents: 5000n }, { id: "entry-new", amountCents: 6000n }]);
    tx.expenseLoanOffsetReservation.findMany.mockResolvedValue([{ loanEntryId: "entry-old", amountCents: 1000n }]);
    tx.approvalInstance.create.mockResolvedValue({ id: "approval-r" });
    tx.expenseClaim.update.mockResolvedValue({ id: "claim-r", status: "approval_pending" });

    await expect(service.submit("claim-r", "user-a")).resolves.toEqual(expect.objectContaining({ loanOffsetAmountCents: "7000", companyPayableAmountCents: "0" }));
    expect(tx.expenseLoanOffsetReservation.createMany).toHaveBeenCalledWith({ data: [
      expect.objectContaining({ loanEntryId: "entry-old", amountCents: 4000n, sequenceNo: 1 }),
      expect.objectContaining({ loanEntryId: "entry-new", amountCents: 3000n, sequenceNo: 2 })
    ] });
    expect(tx.employeeProjectLoanAccount.update).toHaveBeenCalledWith({ where: { id: "account-1" }, data: { reservedOffsetAmountCents: 8000n } });
  });

  it("posts frozen reservations as immutable offsets at final reimbursement approval without creating company payment", async () => {
    const claim = { id: "claim-r", claimType: "reimbursement", status: "approval_pending", projectId: "project-1", applicantUserId: "user-a", handledByUserId: "user-a", factWitnessUserId: null, requestedAmountCents: 3000n, loanOffsetAmountCents: 3000n, companyPayableAmountCents: 0n };
    const instance = { id: "approval-r", currentNodeIndex: 0, applicantUserId: "user-a", frozenNodes: [{ name: "综合部主管", mode: "any", roleKeys: ["comprehensive_director"], candidateUserIds: ["comp-1"], candidateUserIdsByRole: { comprehensive_director: ["comp-1"] } }] };
    const approvalForms = { generateForInstance: jest.fn().mockResolvedValue({ id: "pdf-1" }) };
    const { service, tx } = createHarness({ roles: ["comprehensive_director"], approvalForms });
    tx.$queryRaw
      .mockResolvedValueOnce([claim])
      .mockResolvedValueOnce([instance])
      .mockResolvedValueOnce([{ id: "comp-1", isActive: true }])
      .mockResolvedValueOnce([{ id: "signature-1", fileId: "file-1", contentSha256: "a".repeat(64) }])
      .mockResolvedValueOnce([{ id: "file-1", contentSha256: "a".repeat(64), storageStatus: "active" }])
      .mockResolvedValueOnce([{ id: "account-1", offsetAmountCents: 0n, reservedOffsetAmountCents: 3000n, balanceAmountCents: 3000n }])
      .mockResolvedValueOnce([{ nextSequenceNo: 5n }]);
    tx.expenseLoanOffsetReservation.findMany.mockResolvedValue([{ id: "reserve-1", loanAccountId: "account-1", amountCents: 3000n }]);
    tx.expenseClaim.update.mockResolvedValue({ id: "claim-r", status: "offset_completed" });

    await expect(service.review("claim-r", "comp-1", { decision: "approve" })).resolves.toEqual({ id: "claim-r", status: "offset_completed", completed: true });
    expect(approvalForms.generateForInstance).toHaveBeenCalledWith("approval-r", "comp-1");
    expect(tx.employeeProjectLoanEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ entryType: "offset", sourceExpenseClaimId: "claim-r", sourceReservationId: "reserve-1", amountCents: 3000n, balanceDeltaCents: -3000n }) });
    expect(tx.employeeProjectLoanAccount.update).toHaveBeenCalledWith({ where: { id: "account-1" }, data: { offsetAmountCents: 3000n, reservedOffsetAmountCents: 0n, balanceAmountCents: 0n } });
    expect(tx.expenseLoanOffsetReservation.updateMany).toHaveBeenCalledWith({ where: { id: { in: ["reserve-1"] }, status: "reserved" }, data: expect.objectContaining({ status: "posted" }) });
  });

  it("records repayment without reducing the balance, then confirms it as an immutable ledger entry", async () => {
    const auth = { confirmPassword: jest.fn().mockResolvedValue({}) };
    const { service, tx } = createHarness({ auth });
    const claim = { id: "loan-1", claimType: "loan", projectId: "project-1", applicantUserId: "user-a" };
    tx.$queryRaw.mockResolvedValueOnce([claim]);
    tx.employeeProjectLoanAccount.findUnique.mockResolvedValue({ id: "account-1" });
    tx.employeeLoanRepayment.create.mockResolvedValue({ id: "repayment-1", status: "recorded" });
    await expect(service.recordEmployeeLoanRepayment("loan-1", "finance-1", { amountCents: "2000", repaidAt: "2026-07-23", paymentMethod: "现金", confirmationPassword: "current-password" })).resolves.toEqual({ id: "repayment-1", status: "recorded", amountCents: "2000" });
    expect(tx.employeeProjectLoanAccount.update).not.toHaveBeenCalled();

    tx.$queryRaw.mockResolvedValueOnce([claim]).mockResolvedValueOnce([{ id: "repayment-1", loanAccountId: "account-1", amountCents: 2000n, status: "recorded" }]).mockResolvedValueOnce([{ id: "account-1", userId: "user-a", scopeKey: "project:project-1", balanceAmountCents: 5000n, repaidAmountCents: 1000n }]).mockResolvedValueOnce([{ nextSequenceNo: 4n }]);
    tx.employeeProjectLoanEntry.create.mockResolvedValue({ id: "entry-4" });
    tx.employeeLoanRepayment.update.mockResolvedValue({ id: "repayment-1", status: "confirmed" });
    await expect(service.confirmEmployeeLoanRepayment("loan-1", "repayment-1", "finance-director-1", { confirmationPassword: "current-password" })).resolves.toEqual({ id: "repayment-1", status: "confirmed", amountCents: "2000" });
    expect(tx.employeeProjectLoanEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ entryType: "repayment", sourceRepaymentId: "repayment-1", balanceDeltaCents: -2000n }) });
    expect(tx.employeeProjectLoanAccount.update).toHaveBeenCalledWith({ where: { id: "account-1" }, data: { repaidAmountCents: 3000n, balanceAmountCents: 3000n } });
  });

  it("blocks over-balance repayment confirmation before writing a ledger entry", async () => {
    const auth = { confirmPassword: jest.fn().mockResolvedValue({}) };
    const { service, tx } = createHarness({ auth });
    tx.$queryRaw.mockResolvedValueOnce([{ id: "loan-1", claimType: "loan", projectId: "project-1", applicantUserId: "user-a" }]).mockResolvedValueOnce([{ id: "repayment-1", loanAccountId: "account-1", amountCents: 5001n, status: "recorded" }]).mockResolvedValueOnce([{ id: "account-1", userId: "user-a", scopeKey: "project:project-1", balanceAmountCents: 5000n, repaidAmountCents: 0n }]);
    await expect(service.confirmEmployeeLoanRepayment("loan-1", "repayment-1", "finance-director-1", { confirmationPassword: "current-password" })).rejects.toThrow(BadRequestException);
    expect(tx.employeeProjectLoanEntry.create).not.toHaveBeenCalled();
  });
});
