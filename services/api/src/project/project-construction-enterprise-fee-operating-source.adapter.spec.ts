import { ConstructionEnterpriseFeeOperatingSourceAdapter } from "./project-construction-enterprise-fee-operating-source.adapter";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "deduction-1",
    projectId: "project-1",
    entryKind: "original",
    adjustsFactId: null,
    effectDirection: "increase",
    occurredAt: new Date("2026-11-20T00:00:00.000Z"),
    amountCents: 5000n,
    counterpartyName: "施工企业甲",
    basisType: "oral",
    deductionCategory: "other",
    description: "管理费",
    evidenceFileId: null,
    documentVersion: 1,
    fileContentSha256Snapshot: null,
    affiliateAssignmentId: "assignment-1",
    affiliateBusinessPartyVersionId: "party-version-1",
    affiliateNameSnapshot: "施工企业甲",
    recordedByUserId: "finance-1",
    confirmedByUserId: "director-1",
    confirmedAt: new Date("2026-11-20T01:00:00.000Z"),
    ...overrides
  };
}

function createTx(fact: ReturnType<typeof row>) {
  return {
    project: {
      findUnique: jest.fn().mockResolvedValue({
        operatingLedgerEffectiveDate: new Date("2026-01-01T00:00:00.000Z")
      })
    },
    projectAffiliateAssignment: {
      findFirst: jest.fn().mockResolvedValue({
        id: "assignment-1",
        businessPartyVersionId: "party-version-1",
        affiliateNameSnapshot: "施工企业甲",
        affiliateCreditCodeSnapshot: null
      })
    },
    projectUpstreamFundFact: {
      findFirst: jest.fn().mockResolvedValue(fact),
      findMany: jest.fn().mockResolvedValue([fact])
    }
  };
}

async function mapWith(fact: ReturnType<typeof row>) {
  const adapter = new ConstructionEnterpriseFeeOperatingSourceAdapter();
  const tx = createTx(fact);
  const snapshot = await adapter.readSourceSnapshot(tx as never, {
    projectId: "project-1",
    sourceType: adapter.sourceType,
    sourceBusinessId: fact.id
  });
  expect(snapshot).not.toBeNull();
  return adapter.toOperatingFactInput(snapshot!);
}

describe("ConstructionEnterpriseFeeOperatingSourceAdapter", () => {
  it("maps one confirmed deduction to exactly one confirmed cost impact", async () => {
    const { input, entryKind } = await mapWith(row());

    expect(entryKind).toBe("original");
    expect(input).toMatchObject({
      sourceType: "construction_enterprise_fee",
      sourceBusinessId: "deduction-1",
      factKind: "expense",
      operatingLevel: "construction_enterprise",
      amountCents: 5000n,
      direction: "outflow",
      currencyCode: "CNY"
    });
    expect(input.adjustsFactId).toBeUndefined();
    expect(input.impacts).toEqual([
      expect.objectContaining({
        impactKind: "confirmed_cost",
        amountCents: 5000n,
        direction: "increase",
        subjectRole: "cost_bearing_company",
        subject: { kind: "construction_enterprise", id: "party-version-1" },
        costCategoryCode: "other_project_cost"
      })
    ]);
    expect(
      input.impacts.some((impact) =>
        impact.impactKind.startsWith("construction_enterprise_funds_")
      )
    ).toBe(false);
  });

  it("maps a reversal to the inverse cost contribution", async () => {
    const { input, entryKind } = await mapWith(
      row({
        id: "reversal-1",
        entryKind: "reversal",
        adjustsFactId: "deduction-1",
        effectDirection: "decrease"
      })
    );

    expect(entryKind).toBe("reversal");
    expect(input.adjustsFactId).toBe("deduction-1");
    expect(input.impacts).toEqual([
      expect.objectContaining({
        impactKind: "confirmed_cost",
        amountCents: 5000n,
        direction: "decrease"
      })
    ]);
  });

  it("maps a re-registered correction to a new positive cost contribution", async () => {
    const { input, entryKind } = await mapWith(
      row({
        id: "correction-1",
        entryKind: "correction",
        adjustsFactId: "deduction-1",
        effectDirection: "increase",
        amountCents: 4000n
      })
    );

    expect(entryKind).toBe("correction");
    expect(input.adjustsFactId).toBe("deduction-1");
    expect(input.impacts).toEqual([
      expect.objectContaining({
        impactKind: "confirmed_cost",
        amountCents: 4000n,
        direction: "increase"
      })
    ]);
  });

  it("does not expose a pending deduction as a cost source", async () => {
    const adapter = new ConstructionEnterpriseFeeOperatingSourceAdapter();
    const tx = createTx(row());
    tx.projectUpstreamFundFact.findFirst.mockResolvedValue(null);

    await expect(
      adapter.readSourceSnapshot(tx as never, {
        projectId: "project-1",
        sourceType: adapter.sourceType,
        sourceBusinessId: "deduction-1"
      })
    ).resolves.toBeNull();
  });
});
