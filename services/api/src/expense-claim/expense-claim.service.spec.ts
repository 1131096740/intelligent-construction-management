import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ExpenseClaimService } from "./expense-claim.service";

function createHarness(options?: { roles?: string[]; claim?: Record<string, unknown>; approvalAssignments?: Array<{ userId: string; positionId: string; role: string }>; auth?: { confirmPassword: jest.Mock } }) {
  const approvalAssignments = options?.approvalAssignments ?? [];
  const tx = {
    companyEntity: { findFirst: jest.fn() },
    project: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    userPosition: { findMany: jest.fn().mockResolvedValue(approvalAssignments.length ? approvalAssignments.map(({ userId, positionId }) => ({ userId, positionId })) : (options?.roles ?? []).map((_, index) => ({ positionId: `position-${index}` }))) },
    projectMember: { findMany: jest.fn().mockResolvedValue([]) },
    position: { findMany: jest.fn().mockResolvedValue(approvalAssignments.length ? approvalAssignments.map(({ positionId, role }) => ({ id: positionId, key: role })) : (options?.roles ?? []).map((key, index) => ({ id: `position-${index}`, key })) ) },
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue(approvalAssignments.map(({ userId }) => ({ id: userId })))
    },
    expenseClaim: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    expenseClaimLine: { createMany: jest.fn(), findMany: jest.fn() },
    fileObject: { findUnique: jest.fn() },
    employeeProjectLoanAccount: { upsert: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    employeeProjectLoanEntry: { create: jest.fn(), findMany: jest.fn() },
    employeeLoanRepayment: { create: jest.fn(), update: jest.fn() },
    expenseLoanOffsetReservation: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn(), updateMany: jest.fn() },
    approvalInstance: { create: jest.fn(), update: jest.fn() },
    approvalActionLog: { create: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue(options?.claim ? [options.claim] : [])
  };
  const prisma = { $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)), expenseClaim: tx.expenseClaim, expenseClaimLine: tx.expenseClaimLine, project: tx.project };
  const numbering = { allocateDaily: jest.fn().mockResolvedValue("BX-20260723-001") };
  const audit = { record: jest.fn().mockResolvedValue({}) };
  const service = new ExpenseClaimService(prisma as never, numbering as never, audit as never, options?.auth as never);
  return { service, tx, numbering, audit };
}

const actor = { id: "user-a", name: "经办人", phone: "13800000000", isActive: true };

describe("ExpenseClaimService", () => {
  it("reads a new-domain claim detail only for its applicant or handler", async () => {
    const { service, tx } = createHarness();
    tx.expenseClaim.findFirst.mockResolvedValue({ id: "claim-1", code: "BX-1", claimType: "reimbursement", status: "draft", projectId: "project-1", companyEntityNameSnapshot: "建工", applicantNameSnapshot: "申请人", applicantPhoneSnapshot: null, handledByNameSnapshot: "经办人", proxyReason: null, factWitnessNameSnapshot: null, reason: "交通", requestedAmountCents: 1200n, loanOffsetAmountCents: 0n, companyPayableAmountCents: 1200n, fundedAmountCents: 0n, paymentMethod: null, payeeNameSnapshot: null, payeeAccountNameSnapshot: null, payeeBankNameSnapshot: null, payeeBankAccountSnapshot: null, loanExpectedClearanceAt: null, submittedAt: null, approvedAt: null, updatedAt: new Date("2026-07-23") });
    tx.project.findUnique.mockResolvedValue({ id: "project-1", code: "JGXM-001", name: "科技园项目" });
    tx.expenseClaimLine.findMany.mockResolvedValue([{ id: "line-1", sortOrder: 1, expenseCategory: "交通", occurredOn: new Date("2026-07-22"), purpose: "现场", receiptCount: 1, amountCents: 1200n, evidenceType: "receipt_or_other", noEvidenceReason: null, remark: null }]);
    await expect(service.getMine("claim-1", "user-a")).resolves.toEqual(expect.objectContaining({ project: { id: "project-1", code: "JGXM-001", name: "科技园项目" }, requestedAmountCents: "1200", lines: [expect.objectContaining({ amountCents: "1200" })] }));
    expect(tx.expenseClaim.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "claim-1", OR: [{ applicantUserId: "user-a" }, { handledByUserId: "user-a" }] } }));
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
        requestedAmountCents: 1200n
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
    tx.$queryRaw.mockResolvedValueOnce([claim]).mockResolvedValueOnce([instance]);
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
    const { service, tx, audit } = createHarness({ auth });
    const claim = { id: "claim-1", claimType: "loan", status: "approved_pending_disbursement", projectId: "project-1", companyEntityId: "company-1", applicantUserId: "user-a", requestedAmountCents: 10000n, fundedAmountCents: 2000n };
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
    expect(tx.employeeProjectLoanAccount.update).toHaveBeenCalledWith({ where: { id: "account-1" }, data: { fundedAmountCents: 5000n, balanceAmountCents: 5000n } });
    expect(tx.expenseClaim.update).toHaveBeenCalledWith({ where: { id: "claim-1" }, data: { fundedAmountCents: 5000n, status: "partially_disbursed" } });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "expense_claim.loan.disbursement.record" }));
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
    const { service, tx } = createHarness({ roles: ["comprehensive_director"] });
    tx.$queryRaw.mockResolvedValueOnce([claim]).mockResolvedValueOnce([instance]).mockResolvedValueOnce([{ id: "account-1", offsetAmountCents: 0n, reservedOffsetAmountCents: 3000n, balanceAmountCents: 3000n }]).mockResolvedValueOnce([{ nextSequenceNo: 5n }]);
    tx.expenseLoanOffsetReservation.findMany.mockResolvedValue([{ id: "reserve-1", loanAccountId: "account-1", amountCents: 3000n }]);
    tx.expenseClaim.update.mockResolvedValue({ id: "claim-r", status: "offset_completed" });

    await expect(service.review("claim-r", "comp-1", { decision: "approve" })).resolves.toEqual({ id: "claim-r", status: "offset_completed", completed: true });
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
