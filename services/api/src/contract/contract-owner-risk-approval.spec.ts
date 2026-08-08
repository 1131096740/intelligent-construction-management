import { ContractService } from "./contract.service";

const CONTRACT_REVIEW_VERSION_UPDATED_AT = new Date("2026-08-02T01:00:00.000Z");
const CONTRACT_REVIEW_APPROVAL_UPDATED_AT = new Date("2026-08-02T01:00:01.000Z");
const contractReviewCoordinates = {
  expectedContractUpdatedAt: CONTRACT_REVIEW_VERSION_UPDATED_AT.toISOString(),
  expectedApprovalInstanceId: "approval-instance-1",
  expectedNodeIndex: 0,
  expectedApprovalUpdatedAt: CONTRACT_REVIEW_APPROVAL_UPDATED_AT.toISOString()
};
const missingOwnerContractRiskSnapshot = {
  status: "missing_owner_contract" as const,
  ownerContractAmountCents: "0",
  downstreamContractAmountCents: "5000000",
  excessAmountCents: "5000000",
  message: "项目尚未登记生效业主主合同，本次合同终审必须显式确认风险。",
  requiresExplicitConfirmation: true
};

function finalApprovalTransaction(ownerContractAmounts: bigint[] = []) {
  const tx = {
    $queryRaw: jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "chairman-1", isActive: true }])
      .mockResolvedValueOnce([
        {
          id: "signature-version-1",
          fileId: "signature-file-1",
          contentSha256: "a".repeat(64)
        }
      ])
      .mockResolvedValueOnce([
        {
          id: "signature-file-1",
          contentSha256: "a".repeat(64),
          storageStatus: "active"
        }
      ])
      .mockResolvedValueOnce([{ id: "project-1" }]),
    contractVersion: {
      findUnique: jest.fn().mockResolvedValue({
        id: "contract-version-1",
        contractId: "contract-1",
        status: "in_approval",
        updatedAt: CONTRACT_REVIEW_VERSION_UPDATED_AT,
        contractGovernanceVersion: 1
      }),
      findMany: jest.fn().mockResolvedValue([
        {
          contractId: "contract-1",
          amountCents: 5000000n,
          signingSubjectType: "our_company"
        }
      ]),
      update: jest.fn().mockResolvedValue({
        id: "contract-version-1",
        contractId: "contract-1",
        status: "approved_pending_seal",
        contractGovernanceVersion: 1
      })
    },
    contract: {
      findUnique: jest.fn().mockResolvedValue({ projectId: "project-1" }),
      findMany: jest.fn().mockResolvedValue([{ id: "contract-1" }])
    },
    projectOwnerContract: {
      findMany: jest.fn().mockResolvedValue(
        ownerContractAmounts.map((amountCents) => ({ amountCents }))
      )
    },
    approvalInstance: {
      findFirst: jest.fn().mockResolvedValue({
        id: "approval-instance-1",
        applicantUserId: "contract-staff-1",
        currentNodeIndex: 0,
        updatedAt: CONTRACT_REVIEW_APPROVAL_UPDATED_AT,
        frozenNodes: [{
          name: "董事长/总经理",
          mode: "any",
          roleKeys: ["chairman", "general_manager"],
          candidateUserIdsByRole: { chairman: ["chairman-1"], general_manager: [] },
          candidateUserIds: ["chairman-1"]
        }]
      }),
      update: jest.fn()
    },
    approvalActionLog: { create: jest.fn() },
    user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
    userPosition: { findMany: jest.fn().mockResolvedValue([]) },
    projectMember: {
      findMany: jest.fn().mockResolvedValue([{ positionKey: "chairman" }])
    },
    position: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn() }
  };
  return tx;
}

describe("ContractService owner master risk final confirmation", () => {
  it("fails closed when the generated Prisma client cannot query owner-contract risk", async () => {
    const tx = finalApprovalTransaction();
    delete (tx as Partial<typeof tx>).projectOwnerContract;
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const service = new ContractService(prisma as never);

    await expect(
      service.reviewApproval("contract-version-1", "chairman-1", {
        ...contractReviewCoordinates,
        decision: "approve",
        ownerContractRiskConfirmed: true,
        expectedOwnerContractRisk: missingOwnerContractRiskSnapshot
      })
    ).rejects.toThrow("业主主合同风险核对能力不可用，不能完成最终审批");
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
  });

  it("does not block submission-time workflow but rejects final approval without explicit risk confirmation", async () => {
    const tx = finalApprovalTransaction();
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const service = new ContractService(prisma as never);

    await expect(
      service.reviewApproval("contract-version-1", "chairman-1", {
        ...contractReviewCoordinates,
        decision: "approve"
      })
    ).rejects.toMatchObject({
      response: {
        message: "项目尚未登记生效业主主合同，董事长或总经理必须显式确认风险",
        ownerContractRisk: {
          status: "missing_owner_contract",
          ownerContractAmountCents: "0",
          downstreamContractAmountCents: "5000000",
          excessAmountCents: "5000000"
        }
      }
    });
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("reports exact overage and still requires an explicit chairman or general-manager confirmation", async () => {
    const tx = finalApprovalTransaction([4000000n]);
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const service = new ContractService(prisma as never);

    await expect(
      service.reviewApproval("contract-version-1", "chairman-1", {
        ...contractReviewCoordinates,
        decision: "approve"
      })
    ).rejects.toMatchObject({
      response: {
        message: "我方对下合同累计金额超过业主主合同有效金额 10,000.00 元，董事长或总经理必须显式确认风险",
        ownerContractRisk: {
          status: "exceeds_owner_contract",
          ownerContractAmountCents: "4000000",
          downstreamContractAmountCents: "5000000",
          excessAmountCents: "1000000"
        }
      }
    });
  });

  it("records the exact risk snapshot when chairman explicitly confirms final approval", async () => {
    const tx = finalApprovalTransaction();
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const seals = { ensurePendingTask: jest.fn().mockResolvedValue({ id: "seal-1" }) };
    const service = new ContractService(
      prisma as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      seals as never
    );

    await expect(
      service.reviewApproval("contract-version-1", "chairman-1", {
        ...contractReviewCoordinates,
        decision: "approve",
        ownerContractRiskConfirmed: true,
        expectedOwnerContractRisk: missingOwnerContractRiskSnapshot
      })
    ).resolves.toMatchObject({ status: "approved_pending_seal" });

    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: {
          ownerContractRisk: {
            status: "missing_owner_contract",
            ownerContractAmountCents: "0",
            downstreamContractAmountCents: "5000000",
            excessAmountCents: "5000000"
          }
        }
      })
    });
  });

  it("rejects an explicit confirmation without the expected risk snapshot before any write", async () => {
    const tx = finalApprovalTransaction();
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const seals = { ensurePendingTask: jest.fn() };
    const service = new ContractService(
      prisma as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      seals as never
    );

    await expect(
      service.reviewApproval("contract-version-1", "chairman-1", {
        ...contractReviewCoordinates,
        decision: "approve",
        ownerContractRiskConfirmed: true
      })
    ).rejects.toMatchObject({
      status: 409,
      response: { code: "CONTRACT_OWNER_RISK_SNAPSHOT_CONFLICT" }
    });

    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(seals.ensurePendingTask).not.toHaveBeenCalled();
  });

  it.each([
    ["status", { status: "clear" }],
    ["owner amount", { ownerContractAmountCents: "1" }],
    ["downstream amount", { downstreamContractAmountCents: "4999999" }],
    ["excess amount", { excessAmountCents: "4999999" }],
    ["message", { message: "旧的风险提示" }],
    ["confirmation requirement", { requiresExplicitConfirmation: false }]
  ] as const)("rejects a drifted risk snapshot field: %s, with zero writes", async (_field, drift) => {
    const tx = finalApprovalTransaction();
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const seals = { ensurePendingTask: jest.fn() };
    const service = new ContractService(
      prisma as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      seals as never
    );

    await expect(
      service.reviewApproval("contract-version-1", "chairman-1", {
        ...contractReviewCoordinates,
        decision: "approve",
        ownerContractRiskConfirmed: true,
        expectedOwnerContractRisk: {
          ...missingOwnerContractRiskSnapshot,
          ...drift
        }
      })
    ).rejects.toMatchObject({
      status: 409,
      response: { code: "CONTRACT_OWNER_RISK_SNAPSHOT_CONFLICT" }
    });

    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(seals.ensurePendingTask).not.toHaveBeenCalled();
  });

  it("allows final approval without an extra checkbox when the owner-contract risk is clear", async () => {
    const tx = finalApprovalTransaction([5000000n]);
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
    };
    const seals = { ensurePendingTask: jest.fn().mockResolvedValue({ id: "seal-1" }) };
    const service = new ContractService(
      prisma as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      seals as never
    );

    await expect(
      service.reviewApproval("contract-version-1", "chairman-1", {
        ...contractReviewCoordinates,
        decision: "approve"
      })
    ).resolves.toMatchObject({ status: "approved_pending_seal" });
    expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: {
          ownerContractRisk: {
            status: "clear",
            ownerContractAmountCents: "5000000",
            downstreamContractAmountCents: "5000000",
            excessAmountCents: "0"
          }
        }
      })
    });
  });
});
