import {
  createOperatingImpactInvalidator,
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


describe("one-envelope operating impact invalidation", () => {
  const cutoff = new Date("2026-09-18T02:00:00.000Z");
  const impact = (key: string, kind = "confirmed_income", observedAt = new Date("2026-09-18T03:00:00.000Z")) => ({
    id: key, projectId: "project-1", sourceType: "owner_settlement", sourceBusinessId: "source-1",
    sourceImpactKey: key, impactKind: kind, amountCents: 1n, direction: "increase", observedAt, actorUserId: "actor-1"
  });

  it("reopens a completed stage once and preserves the first impact's audit basis", async () => {
    const tx = transactionMock([stage("owner_settlement_completed", cutoff)]);
    const invalidate = createOperatingImpactInvalidator(tx as never, "project-1");
    await invalidate(impact("first"));
    await invalidate(impact("second"));
    expect(tx.projectCloseStageVersion.create).toHaveBeenCalledTimes(1);
    expect(tx.projectCloseImpact.create).toHaveBeenCalledTimes(1);
    expect(tx.projectCloseStageVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      revision: 2, status: "needs_reconfirmation", previousVersionId: "stage-owner_settlement_completed",
      basisSnapshot: expect.objectContaining({ operatingImpactEntryId: "first" })
    }) });
  });

  it("does not cache a completed stage merely because the first impact precedes its cutoff", async () => {
    const tx = transactionMock([stage("owner_settlement_completed", cutoff)]);
    const invalidate = createOperatingImpactInvalidator(tx as never, "project-1");
    await invalidate(impact("before", "confirmed_income", new Date("2026-09-18T01:00:00.000Z")));
    expect(tx.projectCloseImpact.create).not.toHaveBeenCalled();
    await invalidate(impact("after"));
    expect(tx.projectCloseImpact.create).toHaveBeenCalledTimes(1);
    expect(tx.projectCloseStageVersion.findMany).toHaveBeenCalledTimes(2);
  });

  it("checks newly encountered policy stages even after another policy was inactive", async () => {
    const tx = transactionMock([]);
    tx.projectCloseStageVersion.findMany.mockResolvedValueOnce([])
      .mockResolvedValueOnce([stage("downstream_cost_confirmed", cutoff)]);
    const invalidate = createOperatingImpactInvalidator(tx as never, "project-1");
    await invalidate(impact("income"));
    await invalidate(impact("cost", "confirmed_cost"));
    expect(tx.projectCloseStageVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      stageKey: "downstream_cost_confirmed", status: "needs_reconfirmation"
    }) });
  });

  it("does not carry inactive-stage observations into the next envelope, even in the same transaction", async () => {
    const tx = transactionMock([]);
    await createOperatingImpactInvalidator(tx as never, "project-1")(impact("old"));
    tx.projectCloseStageVersion.findMany.mockResolvedValue([stage("owner_settlement_completed", cutoff)]);
    await createOperatingImpactInvalidator(tx as never, "project-1")(impact("new"));
    expect(tx.projectCloseStageVersion.findMany).toHaveBeenCalledTimes(2);
    expect(tx.projectCloseImpact.create).toHaveBeenCalledTimes(1);
  });

  it("still rejects a different project and unknown impact kind after observing inactive stages", async () => {
    const tx = transactionMock([]);
    const invalidate = createOperatingImpactInvalidator(tx as never, "project-1");
    await invalidate(impact("known"));
    await expect(invalidate({ ...impact("other"), projectId: "project-2" })).rejects.toThrow("项目不一致");
    await expect(invalidate(impact("unknown", "unknown_kind"))).rejects.toThrow("未知经营影响类型");
  });

  it("does not turn an existing invalidation replay into permission to skip another impact", async () => {
    const tx = transactionMock([stage("owner_settlement_completed", cutoff)]);
    tx.projectCloseImpact.findUnique.mockResolvedValueOnce({ id: "existing" });
    const invalidate = createOperatingImpactInvalidator(tx as never, "project-1");
    await invalidate(impact("replayed"));
    await invalidate(impact("new"));
    expect(tx.projectCloseImpact.create).toHaveBeenCalledTimes(1);
  });
});
