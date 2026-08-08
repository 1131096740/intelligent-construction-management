import {
  BadRequestException,
  ConflictException,
  ForbiddenException
} from "@nestjs/common";
import { ProjectExpenseService } from "./project-expense.service";

const EXPENSE_UPDATED_AT = new Date("2026-07-31T01:00:00.000Z");
const APPROVAL_UPDATED_AT = new Date("2026-07-31T01:00:01.000Z");
const REVIEW_COORDINATES = {
  expectedExpenseUpdatedAt: EXPENSE_UPDATED_AT.toISOString(),
  expectedApprovalInstanceId: "approval-instance-1",
  expectedNodeIndex: 0,
  expectedApprovalUpdatedAt: APPROVAL_UPDATED_AT.toISOString()
};

function roleTables(roleKey: string | null = "finance_director") {
  return {
    userPosition: { findMany: jest.fn().mockResolvedValue([]) },
    projectMember: {
      findMany: jest.fn().mockResolvedValue(roleKey ? [{ positionKey: roleKey }] : [])
    },
    position: { findMany: jest.fn().mockResolvedValue([]) }
  };
}

function detailFixture(
  currentNode: Record<string, unknown>,
  actorRoleKey: string | null = "finance_director"
) {
  const prisma = {
    projectExpenseRequest: {
      findFirst: jest.fn().mockResolvedValue({
        id: "expense-1",
        projectId: "project-1",
        code: "BX-2026-001",
        expenseType: "reimbursement",
        expenseSubtype: "reimbursement",
        paymentSubject: "现场报销",
        reason: "现场零星费用",
        requestedAmountCents: 50_000n,
        approvedAmountCents: null,
        paidAmountCents: 0n,
        applicantUserId: "applicant-1",
        status: "approval_pending",
        updatedAt: EXPENSE_UPDATED_AT
      })
    },
    approvalInstance: {
      findMany: jest.fn().mockResolvedValue([{
        id: "approval-instance-1",
        status: "in_progress",
        currentNodeIndex: 0,
        frozenNodes: [currentNode],
        applicantUserId: "applicant-1",
        updatedAt: APPROVAL_UPDATED_AT
      }]),
      findFirst: jest.fn().mockResolvedValue({ id: "approval-instance-1" })
    },
    approvalActionLog: { findMany: jest.fn().mockResolvedValue([]) },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: "reviewer-1",
        isActive: true
      }),
      findMany: jest.fn().mockResolvedValue([])
    },
    approvalDelegation: { findMany: jest.fn().mockResolvedValue([]) },
    projectExpenseFinancingQuotaUsage: { findFirst: jest.fn().mockResolvedValue(null) },
    ...roleTables(actorRoleKey)
  };
  const service = new ProjectExpenseService(prisma as never);
  return { prisma, service };
}

function reviewFixture({
  currentNode = {
    name: "财务部",
    mode: "any",
    roleKeys: ["finance_director"]
  },
  instances,
  signature = false,
  actorRoleKey = "finance_director",
  paidAmountCents = 0n
}: {
  currentNode?: Record<string, unknown>;
  instances?: Array<Record<string, unknown>>;
  signature?: boolean;
  actorRoleKey?: string | null;
  paidAmountCents?: bigint;
} = {}) {
  const request = {
    id: "expense-1",
    projectId: "project-1",
    code: "BX-2026-001",
    expenseType: "reimbursement",
    status: "approval_pending",
    requestedAmountCents: 50_000n,
    approvedAmountCents: null,
    paidAmountCents,
    applicantUserId: "applicant-1",
    purchaseExecutedAt: null,
    receiptConfirmedAt: null,
    updatedAt: EXPENSE_UPDATED_AT
  };
  const instance = {
    id: "approval-instance-1",
    status: "in_progress",
    currentNodeIndex: 0,
    frozenNodes: [currentNode],
    applicantUserId: "applicant-1",
    updatedAt: APPROVAL_UPDATED_AT
  };
  const queryResults: unknown[] = [[request], instances ?? [instance]];
  if (signature) {
    const sha256 = "a".repeat(64);
    queryResults.push(
      [{ id: "reviewer-1", isActive: true }],
      [{ id: "signature-version-1", fileId: "signature-file-1", contentSha256: sha256 }],
      [{ id: "signature-file-1", contentSha256: sha256, storageStatus: "active" }]
    );
  }
  const tx = {
    $queryRaw: jest.fn(),
    projectExpenseRequest: {
      update: jest.fn().mockResolvedValue({
        id: "expense-1",
        status: "approved_pending_payment",
        approvedAmountCents: 50_000n
      })
    },
    approvalInstance: { update: jest.fn() },
    approvalActionLog: { create: jest.fn() },
    projectExpenseFinancingQuotaUsage: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      create: jest.fn()
    },
    approvalDelegation: { findMany: jest.fn().mockResolvedValue([]) },
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: "reviewer-1",
        isActive: true
      }),
      findMany: jest.fn().mockResolvedValue([])
    },
    ...roleTables(actorRoleKey)
  };
  for (const result of queryResults) {
    tx.$queryRaw.mockResolvedValueOnce(result);
  }
  const audit = { record: jest.fn() };
  const auth = { confirmPassword: jest.fn().mockResolvedValue({ ok: true }) };
  const prisma = { $transaction: jest.fn(async (callback) => callback(tx)) };
  const service = new ProjectExpenseService(prisma as never, audit as never, auth as never);
  return { audit, instance, prisma, request, service, tx };
}

describe("ProjectExpense review approval concurrency contract", () => {
  it("publishes exactly one enabled review action and four-coordinate context", async () => {
    const { service } = detailFixture({
      name: "财务部",
      mode: "any",
      roleKeys: ["finance_director"]
    });

    const detail = await service.getApprovalDetail(
      "project-1",
      "expense-1",
      "reviewer-1"
    );

    expect((detail as unknown as { reviewApprovalContext: unknown }).reviewApprovalContext)
      .toEqual(REVIEW_COORDINATES);
    expect(detail.availableActions.filter((action) => action.key === "review_approval"))
      .toEqual([expect.objectContaining({ enabled: true })]);
    expect(detail.canSetApprovedAmount).toBe(true);
  });

  it("does not let a current role bypass a governed frozen candidate set", async () => {
    const { service } = detailFixture({
      name: "财务部",
      mode: "any",
      roleKeys: ["finance_director"],
      candidateUserIdsByRole: { finance_director: ["other-reviewer"] },
      candidateUserIds: ["other-reviewer"]
    });

    const detail = await service.getApprovalDetail(
      "project-1",
      "expense-1",
      "reviewer-1"
    );

    expect((detail as unknown as { reviewApprovalContext: unknown }).reviewApprovalContext)
      .toBeNull();
    expect(detail.reviewAction.enabled).toBe(false);
    expect(detail.availableActions.filter((action) => action.key === "review_approval"))
      .toEqual([expect.objectContaining({ enabled: false })]);
    expect(detail.canSetApprovedAmount).toBe(false);
  });

  it("rejects a direct frozen candidate after current role removal on read", async () => {
    const currentNode = {
      name: "财务部",
      mode: "any",
      roleKeys: ["finance_director"],
      candidateUserIdsByRole: { finance_director: ["reviewer-1"] },
      candidateUserIds: ["reviewer-1"]
    };
    const { service } = detailFixture(currentNode, null);

    await expect(service.getApprovalDetail(
      "project-1",
      "expense-1",
      "reviewer-1"
    )).rejects.toThrow("无权查看该项目支出审批详情");
  });

  it("rejects a frozen assignment recipient after current role removal", async () => {
    const currentNode = {
      name: "财务部",
      mode: "any",
      roleKeys: ["finance_director"],
      candidateUserIdsByRole: { finance_director: ["former-finance-1"] },
      candidateUserIds: ["former-finance-1"],
      assignments: [{
        kind: "transfer",
        fromUserId: "former-finance-1",
        fromRoleKey: "finance_director",
        toUserId: "reviewer-1"
      }]
    };
    const { prisma, service } = detailFixture(currentNode, null);

    await expect(service.getApprovalDetail(
      "project-1",
      "expense-1",
      "reviewer-1"
    )).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.approvalDelegation.findMany).not.toHaveBeenCalled();
  });

  it("rejects an active delegation recipient for a frozen delegator", async () => {
    const { prisma, service } = detailFixture({
      name: "财务部",
      mode: "any",
      roleKeys: ["finance_director"],
      candidateUserIdsByRole: { finance_director: ["former-finance-1"] },
      candidateUserIds: ["former-finance-1"]
    }, null);
    prisma.approvalDelegation.findMany.mockResolvedValue([
      { fromUserId: "former-finance-1" }
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: "reviewer-1", isActive: true },
      { id: "former-finance-1", isActive: true }
    ]);

    await expect(service.getApprovalDetail(
      "project-1",
      "expense-1",
      "reviewer-1"
    )).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.approvalDelegation.findMany).not.toHaveBeenCalled();
  });

  it("rejects a standing delegation recipient for a legacy role-only node on read", async () => {
    const { prisma, service } = detailFixture({
      name: "财务部",
      mode: "any",
      roleKeys: ["finance_director"]
    }, null);
    prisma.approvalDelegation.findMany.mockResolvedValue([
      { fromUserId: "former-finance-1" }
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: "reviewer-1", isActive: true },
      { id: "former-finance-1", isActive: true }
    ]);
    prisma.projectMember.findMany.mockImplementation(
      ({ where }: { where: { userId: string } }) =>
        Promise.resolve(
          where.userId === "former-finance-1"
            ? [{ positionKey: "finance_director" }]
            : []
        )
    );

    await expect(service.getApprovalDetail(
      "project-1",
      "expense-1",
      "reviewer-1"
    )).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.approvalDelegation.findMany).not.toHaveBeenCalled();
  });

  it("fails closed when more than one active approval instance is locked", async () => {
    const first = {
      id: "approval-instance-1",
      status: "in_progress",
      currentNodeIndex: 0,
      frozenNodes: [{ name: "财务部", mode: "any", roleKeys: ["finance_director"] }],
      applicantUserId: "applicant-1",
      updatedAt: APPROVAL_UPDATED_AT
    };
    const { service, tx } = reviewFixture({
      instances: [first, { ...first, id: "approval-instance-2" }]
    });

    await expect(service.reviewApproval("project-1", "expense-1", "reviewer-1", {
      decision: "approve",
      ...REVIEW_COORDINATES
    })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
  });

  it.each([
    ["expense", { expectedExpenseUpdatedAt: "2026-07-31T00:59:59.000Z" }],
    ["instance", { expectedApprovalInstanceId: "forged-instance" }],
    ["node", { expectedNodeIndex: 1 }],
    ["approval", { expectedApprovalUpdatedAt: "2026-07-31T00:59:59.000Z" }]
  ])("rejects stale %s coordinates before any write", async (_name, drift) => {
    const { service, tx } = reviewFixture();

    await expect(service.reviewApproval("project-1", "expense-1", "reviewer-1", {
      decision: "approve",
      ...REVIEW_COORDINATES,
      ...drift
    })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
  });

  it("checks governed frozen identity before reporting coordinate drift", async () => {
    const currentNode = {
      name: "财务部",
      mode: "any",
      roleKeys: ["finance_director"],
      candidateUserIdsByRole: { finance_director: ["other-reviewer"] },
      candidateUserIds: ["other-reviewer"]
    };
    const { service, tx } = reviewFixture({ currentNode });

    await expect(service.reviewApproval("project-1", "expense-1", "reviewer-1", {
      decision: "approve",
      ...REVIEW_COORDINATES,
      expectedNodeIndex: 99
    } as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
  });

  it("requires a non-blank reject reason before opening the transaction", async () => {
    const { prisma, service, tx } = reviewFixture();

    await expect(service.reviewApproval("project-1", "expense-1", "reviewer-1", {
      decision: "reject",
      ...REVIEW_COORDINATES,
      comment: "   "
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it("snapshots a governed approver signature and records immutable identity", async () => {
    const currentNode = {
      name: "财务部",
      mode: "any",
      roleKeys: ["finance_director"],
      candidateUserIdsByRole: { finance_director: ["reviewer-1"] },
      candidateUserIds: ["reviewer-1"]
    };
    const { audit, service, tx } = reviewFixture({ currentNode, signature: true });

    await service.reviewApproval("project-1", "expense-1", "reviewer-1", {
      decision: "approve",
      ...REVIEW_COORDINATES,
      comment: "同意"
    });

    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "approve",
        approvedRoleKey: "finance_director",
        representedUserId: "reviewer-1",
        signatureFileIdSnapshot: "signature-file-1",
        signatureSha256Snapshot: "a".repeat(64),
        signatureVersionIdSnapshot: "signature-version-1"
      })
    });
    const metadata = audit.record.mock.calls[0]?.[1].metadata;
    expect(metadata).toEqual(expect.objectContaining({
      fromStatus: "approval_pending",
      toStatus: "approved_pending_payment",
      expectedExpenseUpdatedAt: REVIEW_COORDINATES.expectedExpenseUpdatedAt,
      expectedApprovalInstanceId: REVIEW_COORDINATES.expectedApprovalInstanceId,
      expectedNodeIndex: REVIEW_COORDINATES.expectedNodeIndex,
      expectedApprovalUpdatedAt: REVIEW_COORDINATES.expectedApprovalUpdatedAt
    }));
    expect(JSON.stringify(metadata)).not.toContain("confirmationPassword");
  });

  it("rejects a direct frozen candidate without a current approval role", async () => {
    const currentNode = {
      name: "财务部",
      mode: "any",
      roleKeys: ["finance_director"],
      candidateUserIdsByRole: { finance_director: ["reviewer-1"] },
      candidateUserIds: ["reviewer-1"]
    };
    const { service, tx } = reviewFixture({
      currentNode,
      signature: true,
      actorRoleKey: null
    });

    await expect(service.reviewApproval("project-1", "expense-1", "reviewer-1", {
      decision: "approve",
      ...REVIEW_COORDINATES
    })).rejects.toBeInstanceOf(ForbiddenException);

    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
  });

  it("rejects a frozen assignment recipient without a current approval role", async () => {
    const currentNode = {
      name: "财务部",
      mode: "any",
      roleKeys: ["finance_director"],
      candidateUserIdsByRole: { finance_director: ["former-finance-1"] },
      candidateUserIds: ["former-finance-1"],
      assignments: [{
        kind: "transfer",
        fromUserId: "former-finance-1",
        fromRoleKey: "finance_director",
        toUserId: "reviewer-1"
      }]
    };
    const { service, tx } = reviewFixture({
      currentNode,
      signature: true,
      actorRoleKey: null
    });

    await expect(service.reviewApproval("project-1", "expense-1", "reviewer-1", {
      decision: "approve",
      ...REVIEW_COORDINATES
    })).rejects.toBeInstanceOf(ForbiddenException);

    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(tx.approvalDelegation.findMany).not.toHaveBeenCalled();
  });

  it("rejects an active delegation recipient for a frozen delegator", async () => {
    const currentNode = {
      name: "财务部",
      mode: "any",
      roleKeys: ["finance_director"],
      candidateUserIdsByRole: { finance_director: ["former-finance-1"] },
      candidateUserIds: ["former-finance-1"]
    };
    const { service, tx } = reviewFixture({
      currentNode,
      signature: true,
      actorRoleKey: null
    });
    tx.approvalDelegation.findMany.mockResolvedValue([
      { fromUserId: "former-finance-1" }
    ]);
    tx.user.findMany.mockResolvedValue([
        { id: "reviewer-1", isActive: true },
        { id: "former-finance-1", isActive: true }
    ]);
    tx.projectMember.findMany.mockImplementation(
      ({ where }: { where: { userId: string } }) =>
        Promise.resolve(
          where.userId === "former-finance-1"
            ? [{ positionKey: "finance_director" }]
            : []
        )
    );

    await expect(service.reviewApproval("project-1", "expense-1", "reviewer-1", {
      decision: "approve",
      ...REVIEW_COORDINATES
    })).rejects.toBeInstanceOf(ForbiddenException);

    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(tx.approvalDelegation.findMany).not.toHaveBeenCalled();
  });

  it("rejects a standing delegation recipient for a legacy role-only node", async () => {
    const { service, tx } = reviewFixture({ actorRoleKey: null });
    tx.approvalDelegation.findMany.mockResolvedValue([
      { fromUserId: "former-finance-1" }
    ]);
    tx.user.findMany.mockResolvedValue([
      { id: "reviewer-1", isActive: true },
      { id: "former-finance-1", isActive: true }
    ]);
    tx.projectMember.findMany.mockImplementation(
      ({ where }: { where: { userId: string } }) =>
        Promise.resolve(
          where.userId === "former-finance-1"
            ? [{ positionKey: "finance_director" }]
            : []
        )
    );

    await expect(service.reviewApproval("project-1", "expense-1", "reviewer-1", {
      decision: "approve",
      ...REVIEW_COORDINATES
    })).rejects.toBeInstanceOf(ForbiddenException);

    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(tx.approvalDelegation.findMany).not.toHaveBeenCalled();
  });

  it("does not snapshot a governed signature on reject", async () => {
    const currentNode = {
      name: "财务部",
      mode: "any",
      roleKeys: ["finance_director"],
      candidateUserIdsByRole: { finance_director: ["reviewer-1"] },
      candidateUserIds: ["reviewer-1"]
    };
    const { service, tx } = reviewFixture({ currentNode });
    tx.projectExpenseRequest.update.mockResolvedValue({ id: "expense-1", status: "rejected" });

    await service.reviewApproval("project-1", "expense-1", "reviewer-1", {
      decision: "reject",
      ...REVIEW_COORDINATES,
      comment: "凭证不完整"
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "reject",
        approvedRoleKey: "finance_director",
        representedUserId: "reviewer-1"
      })
    });
    expect(tx.approvalActionLog.create.mock.calls[0]?.[0].data)
      .not.toHaveProperty("signatureFileIdSnapshot");
  });

  it("keeps legacy role-only approval compatible with null signature snapshots", async () => {
    const { service, tx } = reviewFixture();

    await service.reviewApproval("project-1", "expense-1", "reviewer-1", {
      decision: "approve",
      ...REVIEW_COORDINATES
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    const data = tx.approvalActionLog.create.mock.calls[0]?.[0].data;
    expect(data).toEqual(expect.objectContaining({
      approvedRoleKey: "finance_director",
      representedUserId: "reviewer-1"
    }));
    expect(data).not.toHaveProperty("signatureFileIdSnapshot");
  });

  it("fails final approval when used financing makes the requested shrink impossible", async () => {
    const { audit, service, tx } = reviewFixture();
    tx.projectExpenseFinancingQuotaUsage.findMany
      .mockResolvedValueOnce([
        { id: "occupied-1", status: "occupied", amountCents: 10_000n },
        { id: "used-1", status: "used", amountCents: 30_000n }
      ])
      .mockResolvedValueOnce([
        {
          id: "occupied-1",
          quotaId: "quota-1",
          projectId: "project-1",
          amountCents: 10_000n
        }
      ]);

    await expect(service.reviewApproval("project-1", "expense-1", "reviewer-1", {
      decision: "approve",
      approvedAmountCents: "20000",
      ...REVIEW_COORDINATES
    })).rejects.toBeInstanceOf(BadRequestException);

    expect(audit.record).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "project_expense.approval.approve" })
    );
  });

  it("rejects a final approved amount below existing paid amount before any write", async () => {
    const { audit, service, tx } = reviewFixture({ paidAmountCents: 30_000n });

    await expect(service.reviewApproval("project-1", "expense-1", "reviewer-1", {
      decision: "approve",
      approvedAmountCents: "20000",
      ...REVIEW_COORDINATES
    })).rejects.toThrow("批准金额不能低于已实付金额");

    expect(tx.projectExpenseRequest.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("locks the project expense by exact id instead of accepting its code", async () => {
    const { service, tx } = reviewFixture();

    await service.reviewApproval("project-1", "expense-1", "reviewer-1", {
      decision: "approve",
      ...REVIEW_COORDINATES
    });

    const firstSql = tx.$queryRaw.mock.calls[0]?.[0] as { strings?: readonly string[] };
    expect(firstSql.strings?.join(" ")).not.toContain('OR "code"');
  });
});
