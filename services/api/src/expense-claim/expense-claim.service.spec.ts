import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ExpenseClaimService } from "./expense-claim.service";

function createHarness(options?: { roles?: string[]; claim?: Record<string, unknown> }) {
  const tx = {
    user: { findUnique: jest.fn() },
    companyEntity: { findFirst: jest.fn() },
    project: { findFirst: jest.fn() },
    userPosition: { findMany: jest.fn().mockResolvedValue((options?.roles ?? []).map((_, index) => ({ positionId: `position-${index}` }))) },
    projectMember: { findMany: jest.fn().mockResolvedValue([]) },
    position: { findMany: jest.fn().mockResolvedValue((options?.roles ?? []).map((key) => ({ key })) ) },
    expenseClaim: { create: jest.fn(), update: jest.fn() },
    expenseClaimLine: { createMany: jest.fn() },
    approvalInstance: { create: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    $queryRaw: jest.fn().mockResolvedValue(options?.claim ? [options.claim] : [])
  };
  const prisma = { $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)) };
  const numbering = { allocateDaily: jest.fn().mockResolvedValue("BX-20260723-001") };
  const audit = { record: jest.fn().mockResolvedValue({}) };
  const service = new ExpenseClaimService(prisma as never, numbering as never, audit as never);
  return { service, tx, numbering, audit };
}

const actor = { id: "user-a", name: "经办人", phone: "13800000000", isActive: true };

describe("ExpenseClaimService", () => {
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
    const claim = { id: "claim-1", claimType: "reimbursement", status: "draft", projectId: "project-1", handledByUserId: "user-a", factWitnessUserId: null };
    const { service, tx, audit } = createHarness({ claim });
    tx.approvalInstance.create.mockResolvedValue({ id: "approval-1" });
    tx.expenseClaim.update.mockResolvedValue({ id: "claim-1", status: "approval_pending" });

    await expect(service.submit("claim-1", "user-a")).resolves.toEqual({ id: "claim-1", status: "approval_pending", approvalInstanceId: "approval-1" });

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.approvalInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ flowType: "expense_claim.approve", businessId: "claim-1", currentNodeIndex: 0, status: "in_progress" })
    });
    expect(tx.expenseClaim.update).toHaveBeenCalledWith({
      where: { id: "claim-1" },
      data: expect.objectContaining({ status: "approval_pending", approvalInstanceId: "approval-1" })
    });
    expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "expense_claim.submit" }));
  });
});
