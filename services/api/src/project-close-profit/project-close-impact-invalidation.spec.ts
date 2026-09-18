import {
  invalidateProjectCloseForOperatingImpact,
  invalidateProjectCloseForParticipationChange
} from "./project-close-impact-invalidation";

describe("project close automatic impact invalidation", () => {
  it("appends the participation impact and reopens only stages six and seven", async () => {
    const observedAt = new Date("2026-09-18T02:00:00.000Z");
    const cutoff = new Date("2026-09-18T16:00:00.000Z");
    const tx = transactionMock([
      stage("profit_distribution_completed", cutoff),
      stage("project_funds_cleared", cutoff)
    ]);

    await invalidateProjectCloseForParticipationChange(tx as never, {
      projectId: "project-1",
      participantId: "participant-1",
      companyEntityId: "company-1",
      companyEntityVersionId: "company-version-1",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      endedAt: null,
      mutation: "added",
      observedAt,
      actorUserId: "finance-director"
    });

    expect(tx.projectCloseImpact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceType: "project_participating_company",
        sourceId: "participant-1",
        affectedStages: ["profit_distribution_completed", "project_funds_cleared"]
      })
    });
    expect(tx.projectCloseStageVersion.create).toHaveBeenCalledTimes(2);
    expect(tx.projectCloseAggregate.upsert.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$executeRaw.mock.invocationCallOrder[0]
    );
    expect(tx.projectCloseAggregate.update).toHaveBeenCalledWith({
      where: { projectId: "project-1" },
      data: { revision: { increment: 2 } }
    });
  });

  it("creates and locks the aggregate coordinate before checking whether close history exists", async () => {
    const tx = transactionMock([]);

    await invalidateProjectCloseForOperatingImpact(tx as never, {
      id: "impact-first",
      projectId: "project-new",
      sourceType: "owner_settlement",
      sourceBusinessId: "settlement-1",
      sourceImpactKey: "income",
      impactKind: "confirmed_income",
      amountCents: 1000n,
      direction: "increase",
      observedAt: new Date("2026-09-18T02:00:00.000Z"),
      actorUserId: "finance-director"
    });

    expect(tx.projectCloseAggregate.upsert).toHaveBeenCalledWith({
      where: { projectId: "project-new" },
      create: { projectId: "project-new" },
      update: {}
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.projectCloseStageVersion.findMany).toHaveBeenCalled();
    expect(tx.projectCloseImpact.create).not.toHaveBeenCalled();
  });

  it("does not turn an attachment-only impact into a close impact or stale authorization", async () => {
    const tx = transactionMock([]);
    await invalidateProjectCloseForOperatingImpact(tx as never, {
      id: "impact-1",
      projectId: "project-1",
      sourceType: "invoice",
      sourceBusinessId: "invoice-1",
      sourceImpactKey: "reference",
      impactKind: "invoice_reference",
      amountCents: 0n,
      direction: "notice",
      observedAt: new Date("2026-09-18T02:00:00.000Z"),
      actorUserId: "finance-director"
    });

    expect(tx.projectCloseAggregate.upsert).not.toHaveBeenCalled();
    expect(tx.projectCloseImpact.create).not.toHaveBeenCalled();
    expect(tx.projectCloseStageVersion.create).not.toHaveBeenCalled();
  });
});

function transactionMock(stages: ReturnType<typeof stage>[]) {
  return {
    $executeRaw: jest.fn(),
    projectCloseAggregate: {
      upsert: jest.fn().mockResolvedValue({ projectId: "project-1" }),
      update: jest.fn().mockResolvedValue({})
    },
    projectCloseImpact: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "close-impact-1" })
    },
    projectCloseStageVersion: {
      findMany: jest.fn().mockResolvedValue(stages),
      create: jest.fn().mockResolvedValue({})
    }
  };
}

function stage(stageKey: string, projectionCutoffAt: Date) {
  return {
    id: `stage-${stageKey}`,
    projectId: "project-1",
    stageKey,
    revision: 1,
    status: "completed",
    projectionReadAt: projectionCutoffAt,
    projectionCutoffAt,
    projectionFingerprint: "projection-v1",
    amountSnapshot: {},
    stateSnapshot: {},
    basisSnapshot: {},
    confirmedByUserId: "actor-1",
    confirmedAt: projectionCutoffAt
  };
}
