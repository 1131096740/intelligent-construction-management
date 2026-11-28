import { createHash } from "node:crypto";
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
      .mockResolvedValueOnce([{ id: "chairman-1", isActive: true, name: "签批人甲" }])
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
          candidateUserIds: ["chairman-1"],
          originatorUserIds: ["contract-staff-1"]
        }]
      }),
      update: jest.fn()
    },
    approvalActionLog: { create: jest.fn() },
    user: { findUnique: jest.fn().mockResolvedValue({ isActive: true }) },
    userPosition: {
      findMany: jest.fn().mockImplementation(({ where }: { where: { projectId: string | null } }) =>
        Promise.resolve(where.projectId === null ? [{ positionId: "position-chairman" }] : [])
      )
    },
    projectMember: { findMany: jest.fn().mockResolvedValue([]) },
    position: {
      findMany: jest.fn().mockImplementation(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(where.id.in.includes("position-chairman")
          ? [{ id: "position-chairman", key: "chairman" }]
          : [])
      )
    },
    auditLog: { create: jest.fn() }
  };
  return tx;
}

const legacyLeaderRisk = {
  status: "missing_owner_contract", ownerContractAmountCents: "0",
  downstreamContractAmountCents: "5000000", excessAmountCents: "5000000"
};

async function legacyParallelFixture(finance: boolean, recordedRisk?: unknown) {
  const base = finalApprovalTransaction();
  const round = await base.approvalInstance.findFirst();
  const version = await base.contractVersion.findUnique();
  const marker = { protocolVersion: 1, executionMode: "parallel", legacyContractCutover: true, approvedRoleKeys: [] };
  const nodes = [
    { ...marker, name: "财务主管", mode: "any", roleKeys: ["finance_director"],
      candidateUserIds: ["finance-1"], candidateUserIdsByRole: { finance_director: ["finance-1"] },
      roleScopesByRole: { finance_director: "global" }, originatorUserIds: ["contract-staff-1"] },
    { ...round.frozenNodes[0], ...marker, approvedRoleKeys: finance ? ["chairman"] : [], roleScopesByRole: { chairman: "global", general_manager: "global" } }
  ];
  base.approvalInstance.findFirst.mockResolvedValue({ ...round, frozenNodes: nodes as typeof round.frozenNodes });
  base.contractVersion.findUnique.mockResolvedValue({ ...version, numericProtocolVersion: 1 } as typeof version);
  const signatureBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==", "base64");
  const signatureHash = createHash("sha256").update(signatureBytes).digest("hex");
  const original = {
    id: "leader-action", action: "approve", actorUserId: "chairman-1", representedUserId: "chairman-1",
    approvedRoleKey: "chairman", signatureFileIdSnapshot: "old-file", signatureVersionIdSnapshot: "old-signature",
    signatureSha256Snapshot: signatureHash, metadata: { approverName: "原董事长", ownerContractRisk: recordedRisk }
  };
  const tx = {
    ...base,
    approvalActionLog: { ...base.approvalActionLog, findMany: jest.fn().mockResolvedValue([original]) },
    handwrittenSignatureVersion: { findUnique: jest.fn().mockResolvedValue({
      fileId: "old-file", source: "canvas", userId: "chairman-1", contentSha256: signatureHash
    }) }
  };
  if (finance) {
    base.position.findMany.mockResolvedValue([{ id: "position-chairman", key: "finance_director" }]);
  } else {
    base.contractVersion.update.mockResolvedValue({ ...version, status: "in_approval" });
  }
  const prisma = { $transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)) };
  const files = { getFileBuffer: jest.fn().mockResolvedValue({
    buffer: signatureBytes, file: { storageStatus: "active", contentSha256: signatureHash }
  }) };
  const seals = { ensurePendingTask: jest.fn() };
  const auth = { confirmPassword: jest.fn().mockResolvedValue(undefined) };
  const service = new ContractService(prisma as never, undefined, auth as never, undefined, files as never,
    undefined, undefined, undefined, undefined, undefined, undefined, seals as never);
  return { tx, service, version, round, nodes, seals, files, auth };
}

it("lets the frozen executive sign while another legacy duty is pending, recording the exact risk without releasing seal", async () => {
  const { tx, service, version, round, nodes, seals } = await legacyParallelFixture(false);
  await expect(service.reviewApproval(version.id, "chairman-1", {
    ...contractReviewCoordinates, expectedNodeIndex: 1, decision: "approve",
    ownerContractRiskConfirmed: true, expectedOwnerContractRisk: missingOwnerContractRiskSnapshot
  })).resolves.toMatchObject({ status: "in_approval" });
  expect(tx.approvalActionLog.create).toHaveBeenCalledWith({
    data: expect.objectContaining({ metadata: expect.objectContaining({ ownerContractRisk: legacyLeaderRisk }) })
  });
  expect(tx.approvalInstance.update).toHaveBeenCalledWith({
    where: { id: round.id },
    data: expect.objectContaining({ status: "in_progress", currentNodeIndex: 0, frozenNodes: [
      nodes[0], { ...nodes[1], approvedRoleKeys: ["chairman"] }
    ] })
  });
  expect(seals.ensurePendingTask).not.toHaveBeenCalled();
});

it("requires creation provenance even when the frozen executive is the marked legacy applicant", async () => {
  const { tx, service, version, round, nodes, seals, auth } = await legacyParallelFixture(false);
  const setProvenance = (complete: boolean) => tx.approvalInstance.findFirst.mockResolvedValue({
    ...round, applicantUserId: "chairman-1", frozenNodes: nodes.map((node, index) => ({
      ...node, originatorUserIds: !complete && index === 1 ? [] : ["chairman-1"]
    })) as typeof round.frozenNodes
  });
  const approve = {
    ...contractReviewCoordinates, expectedNodeIndex: 1, decision: "approve" as const,
    ownerContractRiskConfirmed: true, expectedOwnerContractRisk: missingOwnerContractRiskSnapshot,
    selfReviewReason: "核对原版合同资料", confirmationPassword: "fixture-password"
  };

  setProvenance(false);
  await expect(service.reviewApproval(version.id, "chairman-1", approve)).rejects.toMatchObject({ status: 409 });
  expect(auth.confirmPassword).not.toHaveBeenCalled();
  expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
  expect(tx.approvalInstance.update).not.toHaveBeenCalled();
  expect(seals.ensurePendingTask).not.toHaveBeenCalled();

  setProvenance(true);
  await expect(service.reviewApproval(version.id, "chairman-1", { ...approve, selfReviewReason: undefined }))
    .rejects.toMatchObject({ status: 400 });
  await expect(service.reviewApproval(version.id, "chairman-1", { ...approve, confirmationPassword: undefined }))
    .rejects.toMatchObject({ status: 400 });
  expect(auth.confirmPassword).not.toHaveBeenCalled();

  // The failed requests have consumed only row-lock reads, so use a fresh
  // database fixture for the successful authenticated self-review.
  const valid = await legacyParallelFixture(false);
  valid.tx.approvalInstance.findFirst.mockResolvedValue({
    ...round, applicantUserId: "chairman-1", frozenNodes: nodes.map(node => ({
      ...node, originatorUserIds: ["chairman-1"]
    })) as typeof round.frozenNodes
  });
  await expect(valid.service.reviewApproval(version.id, "chairman-1", approve)).resolves.toMatchObject({ status: "in_approval" });
  expect(valid.auth.confirmPassword).toHaveBeenCalledWith("chairman-1", "fixture-password");
  expect(valid.tx.approvalActionLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
    metadata: expect.objectContaining({ selfReview: true, selfReviewReason: "核对原版合同资料", ownerContractRisk: legacyLeaderRisk })
  }) });
});

it("releases legacy seal handoff when the last duty sees the exact signed executive risk", async () => {
  const { tx, service, version, round, seals, files } = await legacyParallelFixture(true, legacyLeaderRisk);
  await expect(service.reviewApproval(version.id, "finance-1", {
    ...contractReviewCoordinates, decision: "approve"
  })).resolves.toMatchObject({ status: "approved_pending_seal" });
  expect(files.getFileBuffer).toHaveBeenCalledWith("old-file", tx);
  expect(tx.approvalActionLog.create).toHaveBeenCalledTimes(1);
  expect(seals.ensurePendingTask).toHaveBeenCalledWith(tx, expect.objectContaining({ id: version.id }),
    round.id, round.applicantUserId, "finance-1");
});

it.each([undefined, { ...legacyLeaderRisk, downstreamContractAmountCents: "4999999" }])(
  "leaves legacy approval and original signatures untouched when signed risk is missing or changed (%o)",
  async (recordedRisk) => {
    const { tx, service, version, seals } = await legacyParallelFixture(true, recordedRisk);
    await expect(service.reviewApproval(version.id, "finance-1", {
      ...contractReviewCoordinates, decision: "approve", ownerContractRiskConfirmed: true,
      expectedOwnerContractRisk: missingOwnerContractRiskSnapshot
    })).rejects.toMatchObject({ status: 409, response: { code: "CONTRACT_OWNER_RISK_SNAPSHOT_CONFLICT" } });
    expect(tx.approvalInstance.update).not.toHaveBeenCalled();
    expect(tx.contractVersion.update).not.toHaveBeenCalled();
    expect(tx.approvalActionLog.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(seals.ensurePendingTask).not.toHaveBeenCalled();
  }
);

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
          approverName: "签批人甲",
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
          approverName: "签批人甲",
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
