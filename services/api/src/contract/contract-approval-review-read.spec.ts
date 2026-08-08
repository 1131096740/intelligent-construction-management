import { ContractReadService } from "./contract-read.service";

const CONTRACT_UPDATED_AT = new Date("2026-08-02T01:00:00.000Z");
const APPROVAL_UPDATED_AT = new Date("2026-08-02T01:00:01.000Z");
const REVIEW_CONTEXT = {
  expectedContractUpdatedAt: CONTRACT_UPDATED_AT.toISOString(),
  expectedApprovalInstanceId: "approval-instance-1",
  expectedNodeIndex: 0,
  expectedApprovalUpdatedAt: APPROVAL_UPDATED_AT.toISOString()
};

function detailFixture(
  activeInstanceCount = 1,
  actorRoleScopes: { globalRoleKeys: readonly string[]; projectRoleKeys: readonly string[] } = {
    globalRoleKeys: ["contract_director"],
    projectRoleKeys: []
  },
  frozenNode?: Record<string, unknown>
) {
  const version = {
    id: "contract-version-1",
    contractId: "contract-1",
    versionNo: 1,
    status: "in_approval",
    changeType: "original",
    amountCents: 500_000n,
    amountLimitType: "capped",
    originalBaseAmountCents: null,
    cumulativeIncreaseCents: 0n,
    cumulativeDecreaseCents: 0n,
    pricingNature: "fixed_total",
    invoiceType: null,
    defaultTaxRatePercent: null,
    draftRevision: 3,
    contractGovernanceVersion: null,
    updatedAt: CONTRACT_UPDATED_AT
  };
  const instance = {
    id: "approval-instance-1",
    businessId: version.id,
    flowType: "contract.approve",
    status: "in_progress",
    applicantUserId: "applicant-1",
    currentNodeIndex: 0,
    frozenNodes: [frozenNode ?? {
      name: "合同部主管",
      mode: "any",
      roleKeys: ["contract_director"],
      candidateUserIdsByRole: { contract_director: ["reviewer-1"] },
      candidateUserIds: ["reviewer-1"],
      roleScopesByRole: { contract_director: "global" }
    }],
    updatedAt: APPROVAL_UPDATED_AT
  };
  const instances = Array.from({ length: activeInstanceCount }, (_, index) => ({
    ...instance,
    id: index === 0 ? instance.id : `approval-instance-${index + 1}`
  }));
  const prisma = {
    contract: {
      findFirst: jest.fn().mockResolvedValue({
        id: "contract-1",
        projectId: "project-1",
        code: "HT-2026-001",
        temporaryCode: null,
        name: "测试合同",
        counterparty: "乙方",
        ownerUserId: "applicant-1",
        contractTypeKey: "material_purchase",
        updatedAt: CONTRACT_UPDATED_AT
      })
    },
    project: {
      findUnique: jest.fn().mockResolvedValue({ id: "project-1", name: "项目一" })
    },
    contractVersion: { findMany: jest.fn().mockResolvedValue([version]) },
    paymentTermsVersion: {
      findFirst: jest.fn().mockResolvedValue({ id: "terms-1", versionNo: 1, status: "draft" })
    },
    paymentTermsStage: { findMany: jest.fn().mockResolvedValue([]) },
    settlement: { findMany: jest.fn().mockResolvedValue([]) },
    settlementArchiveFile: { findMany: jest.fn().mockResolvedValue([]) },
    paymentRequest: { findMany: jest.fn().mockResolvedValue([]) },
    paymentExecution: { findMany: jest.fn().mockResolvedValue([]) },
    contractArchiveFile: { findMany: jest.fn().mockResolvedValue([]) },
    approvalInstance: {
      findFirst: jest.fn().mockResolvedValue(instance),
      findMany: jest.fn().mockImplementation((args: {
        where?: { status?: unknown; businessId?: unknown };
      }) => {
        if (args.where?.status === "in_progress") return Promise.resolve(instances);
        return Promise.resolve(instances);
      })
    },
    approvalActionLog: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([])
    }
  };
  const projectVisibility = {
    effectiveRoleKeys: jest.fn().mockResolvedValue(Array.from(new Set([
      ...actorRoleScopes.globalRoleKeys,
      ...actorRoleScopes.projectRoleKeys
    ]))),
    effectiveRoleScopes: jest.fn().mockResolvedValue(actorRoleScopes)
  };
  return {
    service: new ContractReadService(prisma as never, projectVisibility as never)
  };
}

describe("Contract approval review read coordinates", () => {
  it("publishes four-coordinate context only with one enabled review action", async () => {
    const { service } = detailFixture();

    const detail = await service.getDetail(
      "HT-2026-001",
      ["project-1"],
      "reviewer-1"
    );

    expect(detail.reviewApprovalContext).toEqual(REVIEW_CONTEXT);
    expect(detail.availableActions.filter((action) => action.key === "review_approval"))
      .toEqual([expect.objectContaining({ enabled: true })]);
  });

  it("fails closed when more than one in-progress approval instance exists", async () => {
    const { service } = detailFixture(2);

    const detail = await service.getDetail(
      "HT-2026-001",
      ["project-1"],
      "reviewer-1"
    );

    expect(detail.reviewApprovalContext).toBeNull();
    expect(detail.availableActions.filter((action) => action.key === "review_approval"))
      .toEqual([expect.objectContaining({ enabled: false })]);
  });

  it("does not expose a frozen global contract-director node after the reviewer only retains the same project-scoped role", async () => {
    const { service } = detailFixture(1, {
      globalRoleKeys: [],
      projectRoleKeys: ["contract_director"]
    });

    const detail = await service.getDetail(
      "HT-2026-001",
      ["project-1"],
      "reviewer-1"
    );

    expect(detail.reviewApprovalContext).toBeNull();
    expect(detail.availableActions.filter((action) => action.key === "review_approval"))
      .toEqual([expect.objectContaining({ enabled: false })]);
  });

  it("does not expose a legacy global contract-director node after a project-scoped transfer", async () => {
    const { service } = detailFixture(1, {
      globalRoleKeys: [],
      projectRoleKeys: ["contract_director"]
    }, legacyFrozenNode("合同部主管", "contract_director"));

    const detail = await service.getDetail(
      "HT-2026-001",
      ["project-1"],
      "reviewer-1"
    );

    expect(detail.reviewApprovalContext).toBeNull();
    expect(detail.availableActions.filter((action) => action.key === "review_approval"))
      .toEqual([expect.objectContaining({ enabled: false })]);
  });

  it.each([
    [
      "global contract director",
      { globalRoleKeys: ["contract_director"], projectRoleKeys: [] },
      legacyFrozenNode("合同部主管", "contract_director")
    ],
    [
      "project manager",
      { globalRoleKeys: [], projectRoleKeys: ["project_manager"] },
      legacyFrozenNode("项目经理", "project_manager")
    ]
  ] as const)("keeps the legacy %s capability at its inferred scope", async (
    _label,
    actorRoleScopes,
    frozenNode
  ) => {
    const { service } = detailFixture(1, actorRoleScopes, frozenNode);

    const detail = await service.getDetail(
      "HT-2026-001",
      ["project-1"],
      "reviewer-1"
    );

    expect(detail.reviewApprovalContext).toEqual(REVIEW_CONTEXT);
    expect(detail.availableActions.filter((action) => action.key === "review_approval"))
      .toEqual([expect.objectContaining({ enabled: true })]);
  });

  it("publishes withdrawal coordinates and one enabled action only to the applicant", async () => {
    const { service } = detailFixture();

    const detail = await service.getDetail(
      "HT-2026-001",
      ["project-1"],
      "applicant-1"
    );

    expect(detail).toHaveProperty("withdrawApprovalContext", REVIEW_CONTEXT);
    expect(detail.availableActions.filter(
      (action) => action.key === "withdraw_approval" && action.enabled
    )).toHaveLength(1);
  });

  it.each([
    ["non-applicant", 1, "reviewer-1"],
    ["missing active instance", 0, "applicant-1"],
    ["duplicate active instances", 2, "applicant-1"]
  ] as const)("does not publish withdrawal authority for %s", async (_label, count, actorUserId) => {
    const { service } = detailFixture(count);

    const detail = await service.getDetail(
      "HT-2026-001",
      ["project-1"],
      actorUserId
    );

    expect(detail).toHaveProperty("withdrawApprovalContext", null);
    expect(detail.availableActions.filter(
      (action) => action.key === "withdraw_approval" && action.enabled
    )).toEqual([]);
  });
});

function legacyFrozenNode(
  name: "合同部主管" | "项目经理",
  roleKey: "contract_director" | "project_manager"
) {
  return {
    name,
    mode: "any",
    roleKeys: [roleKey],
    candidateUserIdsByRole: { [roleKey]: ["reviewer-1"] },
    candidateUserIds: ["reviewer-1"]
  };
}
