import { ContractService } from "./contract.service";

const CONTRACT_UPDATED_AT = new Date("2026-08-02T01:00:00.000Z");
const APPROVAL_UPDATED_AT = new Date("2026-08-02T01:00:01.000Z");
const REVIEW_COORDINATES = {
  expectedContractUpdatedAt: CONTRACT_UPDATED_AT.toISOString(),
  expectedApprovalInstanceId: "approval-instance-1",
  expectedNodeIndex: 0,
  expectedApprovalUpdatedAt: APPROVAL_UPDATED_AT.toISOString()
};

function reviewFixture(
  activeInstanceCount = 1,
  versionOverride: Partial<{
    status: string;
    updatedAt: Date;
  }> = {},
  actorPositionKey = "contract_director",
  expectedInstanceAvailable = true
) {
  const version = {
    id: "contract-version-1",
    contractId: "contract-1",
    status: "in_approval",
    updatedAt: CONTRACT_UPDATED_AT,
    ...versionOverride
  };
  const frozenNodes = [
    {
      name: "合同部主管",
      mode: "any",
      roleKeys: ["contract_director"]
    },
    {
      name: "合同部主管复核",
      mode: "any",
      roleKeys: ["contract_director"]
    }
  ];
  const instance = {
    id: "approval-instance-1",
    applicantUserId: "applicant-1",
    currentNodeIndex: 0,
    frozenNodes,
    status: "in_progress",
    updatedAt: APPROVAL_UPDATED_AT
  };
  const instances = Array.from({ length: activeInstanceCount }, (_, index) => ({
    ...instance,
    id: index === 0 ? instance.id : `approval-instance-${index + 1}`
  }));
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    contractVersion: {
      findUnique: jest.fn().mockResolvedValue(version),
      update: jest.fn().mockResolvedValue({ ...version, status: "approval_rejected" })
    },
    approvalInstance: {
      findFirst: jest.fn().mockImplementation((query: { where?: { id?: string } }) => {
        const expectedId = query.where?.id;
        if (!expectedId) return Promise.resolve(instances[0] ?? null);
        if (!expectedInstanceAvailable) return Promise.resolve(null);
        return Promise.resolve({
          ...instance,
          id: expectedId,
          currentNodeIndex:
            expectedId === instance.id && activeInstanceCount > 0 ? 0 : 1,
          status:
            expectedId === instance.id && activeInstanceCount > 0
              ? "in_progress"
              : "approved"
        });
      }),
      findMany: jest.fn().mockResolvedValue(instances),
      update: jest.fn()
    },
    approvalActionLog: { create: jest.fn() },
    contract: {
      findUnique: jest.fn().mockResolvedValue({ id: "contract-1", projectId: "project-1" })
    },
    user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
    userPosition: { findMany: jest.fn().mockResolvedValue([]) },
    projectMember: {
      findMany: jest.fn().mockResolvedValue([{ positionKey: actorPositionKey }])
    },
    position: { findMany: jest.fn().mockResolvedValue([]) }
  };
  const audit = { record: jest.fn() };
  const prisma = {
    $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx))
  };
  const service = new ContractService(prisma as never, audit as never);
  return { audit, service, tx };
}

describe("Contract approval review coordinates", () => {
  it("fails closed when more than one in-progress approval instance is locked", async () => {
    const { audit, service, tx } = reviewFixture(2);

    await expect(service.reviewApproval("contract-version-1", "reviewer-1", {
      decision: "reject",
      comment: "条款需调整",
      ...REVIEW_COORDINATES
    } as never)).rejects.toMatchObject({
      response: { code: "CONTRACT_APPROVAL_REVIEW_CONFLICT" }
    });

    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    ["contract", { expectedContractUpdatedAt: "2026-08-02T00:59:59.000Z" }],
    ["instance", { expectedApprovalInstanceId: "approval-instance-stale" }],
    ["node", { expectedNodeIndex: 1 }],
    ["approval", { expectedApprovalUpdatedAt: "2026-08-02T00:59:59.000Z" }]
  ])("rejects stale %s coordinates before any business write", async (_label, drift) => {
    const { audit, service, tx } = reviewFixture();

    await expect(service.reviewApproval("contract-version-1", "reviewer-1", {
      decision: "reject",
      comment: "条款需调整",
      ...REVIEW_COORDINATES,
      ...drift
    } as never)).rejects.toMatchObject({
      response: { code: "CONTRACT_APPROVAL_REVIEW_CONFLICT" }
    });

    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("returns a stable conflict with zero writes after another reviewer already committed", async () => {
    const { audit, service, tx } = reviewFixture(0, {
      status: "approved_pending_seal",
      updatedAt: new Date("2026-08-02T01:00:02.000Z")
    });

    await expect(service.reviewApproval("contract-version-1", "reviewer-1", {
      decision: "reject",
      comment: "条款需调整",
      ...REVIEW_COORDINATES
    } as never)).rejects.toMatchObject({
      status: 409,
      response: {
        code: "CONTRACT_APPROVAL_REVIEW_CONFLICT",
        message: "合同审批状态或坐标已变化，请刷新页面后重试"
      }
    });

    expect(tx.approvalInstance.findMany).toHaveBeenCalledTimes(1);
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    ["stale contract timestamp", 1, {}, {
      expectedContractUpdatedAt: "2026-08-02T00:59:59.000Z"
    }],
    ["terminal contract", 0, {
      status: "approved_pending_seal",
      updatedAt: new Date("2026-08-02T01:00:02.000Z")
    }, {}],
    ["duplicate active instances", 2, {}, {}]
  ] as const)(
    "returns 403 instead of exposing the %s conflict to a non-node account",
    async (_scenario, activeInstanceCount, versionOverride, coordinateOverride) => {
      const { audit, service, tx } = reviewFixture(
        activeInstanceCount,
        versionOverride,
        "employee"
      );

      await expect(service.reviewApproval("contract-version-1", "reviewer-1", {
        decision: "reject",
        comment: "条款需调整",
        ...REVIEW_COORDINATES,
        ...coordinateOverride
      } as never)).rejects.toMatchObject({
        status: 403,
        response: {
          statusCode: 403,
          message: "当前账号无权处理该合同审批节点"
        }
      });

      expect(tx.contractVersion.update).not.toHaveBeenCalled();
      expect(tx.approvalInstance.update).not.toHaveBeenCalled();
      expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    }
  );

  it("returns 403 when the claimed approval instance belongs to another business or flow", async () => {
    const { audit, service, tx } = reviewFixture(
      1,
      {},
      "contract_director",
      false
    );

    await expect(service.reviewApproval("contract-version-1", "reviewer-1", {
      decision: "reject",
      comment: "条款需调整",
      ...REVIEW_COORDINATES,
      expectedApprovalInstanceId: "other-business-instance"
    } as never)).rejects.toMatchObject({
      status: 403,
      response: {
        statusCode: 403,
        message: "当前账号无权处理该合同审批节点"
      }
    });

    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
