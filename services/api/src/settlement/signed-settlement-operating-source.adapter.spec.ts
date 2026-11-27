import { Prisma } from "@prisma/client";
import {
  SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE,
  SignedSettlementOperatingSourceAdapter
} from "./signed-settlement-operating-source.adapter";

function signedSettlement(overrides: Record<string, unknown> = {}) {
  return {
    id: "signed-settlement-1",
    projectId: "project-1",
    contractId: "contract-1",
    contractKind: "downstream",
    state: "confirmed",
    number: "JS-2026-001",
    amountYuan: new Prisma.Decimal("1000.0000"),
    confirmationNo: 3n,
    reviewedAt: new Date("2026-11-20T00:00:00.000Z"),
    reviewedByUserId: "contract-director-1",
    confirmedContractSource: {
      relationship: "inside",
      sourceRecordId: "contract-version-1",
      sourceVersion: 2,
      contractTypeKey: "labor_subcontract",
      counterpartyVersionId: "counterparty-version-1",
      counterparty: "劳务公司",
      payerKind: "participating_company",
      payerVersionId: "company-version-1",
      companyEntityId: "company-1",
      affiliateAssignmentId: "affiliate-assignment-1",
      affiliateBusinessPartyVersionId: "affiliate-version-1"
    },
    attachments: [{ fileId: "signed-file-1" }],
    ...overrides
  };
}

function fixture() {
  const tx = {
    signedContractSettlement: {
      findMany: jest.fn().mockResolvedValue([signedSettlement()]),
      findUnique: jest.fn().mockResolvedValue(signedSettlement())
    },
    project: {
      findUnique: jest.fn().mockResolvedValue({
        operatingLedgerEffectiveDate: new Date("2026-11-01T00:00:00.000Z")
      })
    },
    projectAffiliateAssignment: {
      findFirst: jest.fn().mockResolvedValue({
        id: "affiliate-assignment-1",
        businessPartyVersionId: "affiliate-version-1",
        affiliateNameSnapshot: "施工企业甲",
        affiliateCreditCodeSnapshot: "91310000000000000X"
      })
    }
  };
  return { tx };
}

describe("SignedSettlementOperatingSourceAdapter", () => {
  it("maps a positive confirmed signed settlement to one cost and one payable increase", async () => {
    const { tx } = fixture();
    const adapter = new SignedSettlementOperatingSourceAdapter();

    const snapshot = await adapter.readSourceSnapshot(tx as never, {
      projectId: "project-1",
      sourceType: SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE,
      sourceBusinessId: "signed-settlement-1"
    });
    expect(snapshot).toMatchObject({
      sourceType: "signed_contract_settlement",
      sourceBusinessId: "signed-settlement-1",
      sourceBusinessCode: "JS-2026-001",
      sourceVersion: 3
    });

    const { entryKind, input } = adapter.toOperatingFactInput(snapshot!);
    expect(entryKind).toBe("original");
    expect(input).toMatchObject({
      sourceType: "signed_contract_settlement",
      sourceBusinessId: "signed-settlement-1",
      factKind: "downstream_settlement",
      amountCents: 100_000n,
      direction: "neutral",
      occurredAt: new Date("2026-11-20T00:00:00.000Z"),
      confirmedAt: new Date("2026-11-20T00:00:00.000Z"),
      confirmedByUserId: "contract-director-1",
      subjects: {
        debtor: { kind: "participating_company", id: "company-version-1" },
        creditor: { kind: "downstream_counterparty", id: "counterparty-version-1" }
      }
    });
    expect(input.impacts).toHaveLength(2);
    expect(input.impacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceImpactKey: "confirmed_cost",
          impactKind: "confirmed_cost",
          amountCents: 100_000n,
          direction: "increase",
          costCategoryCode: "crew_and_labor"
        }),
        expect.objectContaining({
          sourceImpactKey: "payable_increase",
          impactKind: "payable_increase",
          amountCents: 100_000n,
          direction: "increase"
        })
      ])
    );
  });

  it.each([
    ["-0.0050", "1.0100", "1.0050", "0", "0.0050"],
    ["-0.0050", "1.0050", "1.0000", "-1", "0.0050"],
    ["-0.0001", "1.0000", "0.9999", "0", "0.0001"]
  ])("keeps signed cost %s and uses the frozen cumulative payable delta", async (amount, before, after, delta, magnitude) => {
    const { tx } = fixture();
    const row = signedSettlement();
    const operatingNumericFacts = {
      protocolVersion: 2, cumulativeBeforeYuan: before, cumulativeAfterYuan: after, payableDeltaCents: delta
    };
    tx.signedContractSettlement.findUnique.mockResolvedValue(signedSettlement({
      amountYuan: new Prisma.Decimal(amount),
      confirmedContractSource: { ...row.confirmedContractSource, operatingNumericFacts }
    }));
    const adapter = new SignedSettlementOperatingSourceAdapter();
    const snapshot = await adapter.readSourceSnapshot(tx as never, {
      projectId: "project-1", sourceType: SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE, sourceBusinessId: row.id
    });
    const { input } = adapter.toOperatingFactInput(snapshot!);
    expect(input).toMatchObject({
      numericProtocolVersion: 2, amountCents: null, amountYuan: magnitude,
      sourceSnapshot: { signedAmountYuan: amount, operatingNumericFacts,
        numericFacts: { protocolVersion: 2, amountState: "known", amountYuan: magnitude } }
    });
    expect(input.impacts).toHaveLength(delta === "0" ? 1 : 2);
    expect(input.impacts[0]).toMatchObject({
      sourceImpactKey: "confirmed_cost", numericProtocolVersion: 2, amountCents: null,
      amountYuan: magnitude, direction: "decrease"
    });
    if (delta === "-1") {
      expect(input.impacts[1]).toMatchObject({
        sourceImpactKey: "payable_decrease", numericProtocolVersion: 2, amountCents: null,
        amountYuan: "0.0100", direction: "decrease"
      });
    }
  });

  it("keeps a sub-cent upward reduction as an internal receivable only", async () => {
    const { tx } = fixture();
    const row = signedSettlement();
    tx.signedContractSettlement.findUnique.mockResolvedValue(signedSettlement({
      contractKind: "upward",
      amountYuan: new Prisma.Decimal("-0.0001"),
      confirmedContractSource: {
        ...row.confirmedContractSource, relationship: "upward", payerKind: "construction_enterprise",
        operatingNumericFacts: {
          protocolVersion: 2, cumulativeBeforeYuan: "1.0050", cumulativeAfterYuan: "1.0049", payableDeltaCents: "0"
        }
      }
    }));
    const adapter = new SignedSettlementOperatingSourceAdapter();
    const snapshot = await adapter.readSourceSnapshot(tx as never, {
      projectId: "project-1", sourceType: SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE, sourceBusinessId: row.id
    });
    const { input } = adapter.toOperatingFactInput(snapshot!);
    expect(input).toMatchObject({ operatingLevel: "participating_company", amountYuan: "0.0001" });
    expect(input.impacts).toHaveLength(1);
    expect(input.impacts[0]).toMatchObject({
      sourceImpactKey: "receivable_increase", amountYuan: "0.0001", direction: "decrease",
      impactSnapshot: { relationship: "upward", projectConsolidation: "exclude_internal" }
    });
  });

  it("maps a negative settlement to cost and payable decreases with the same magnitude", async () => {
    const { tx } = fixture();
    tx.signedContractSettlement.findUnique.mockResolvedValue(
      signedSettlement({ id: "signed-negative", amountYuan: new Prisma.Decimal("-8.0000") })
    );
    const adapter = new SignedSettlementOperatingSourceAdapter();
    const snapshot = await adapter.readSourceSnapshot(tx as never, {
      projectId: "project-1",
      sourceType: SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE,
      sourceBusinessId: "signed-negative"
    });

    const { input } = adapter.toOperatingFactInput(snapshot!);
    expect(input.amountCents).toBe(800n);
    expect(input.impacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          impactKind: "confirmed_cost",
          amountCents: 800n,
          direction: "decrease"
        }),
        expect.objectContaining({
          impactKind: "payable_decrease",
          amountCents: 800n,
          direction: "decrease"
        })
      ])
    );
  });

  it("does not project a confirmed settlement for a contract type without settlement cost", async () => {
    const { tx } = fixture();
    tx.signedContractSettlement.findUnique.mockResolvedValue(
      signedSettlement({
        confirmedContractSource: {
          sourceRecordId: "contract-version-1",
          sourceVersion: 1,
          contractTypeKey: "generic_contract",
          counterpartyVersionId: "counterparty-version-1",
          payerKind: "participating_company",
          payerVersionId: "company-version-1"
        }
      })
    );
    const adapter = new SignedSettlementOperatingSourceAdapter();

    await expect(
      adapter.readSourceSnapshot(tx as never, {
        projectId: "project-1",
        sourceType: SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE,
        sourceBusinessId: "signed-settlement-1"
      })
    ).resolves.toBeNull();
  });

  it("reads every confirmed supported contract kind for replay", async () => {
    const { tx } = fixture();
    tx.signedContractSettlement.findMany.mockResolvedValue([
      signedSettlement(),
      signedSettlement({
        id: "outside",
        contractKind: "outside_fact",
        confirmedContractSource: {
          sourceRecordId: "contract-version-2",
          sourceVersion: 1,
          contractTypeKey: "labor_subcontract",
          counterpartyVersionId: "counterparty-version-1",
          payerKind: "participating_company",
          payerVersionId: "company-version-1"
        }
      })
    ]);
    const adapter = new SignedSettlementOperatingSourceAdapter();

    const snapshots = await adapter.readProjectSnapshots(tx as never, "project-1");

    expect(snapshots.map(snapshot => snapshot.sourceBusinessId)).toEqual([
      "signed-settlement-1",
      "outside"
    ]);
    expect(tx.signedContractSettlement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: "project-1", state: "confirmed" }
      })
    );
  });
});

describe("SignedSettlementOperatingSourceAdapter upward/outside projection", () => {
  function upwardSettlement() {
    return signedSettlement({
      id: "signed-upward-1",
      contractKind: "upward",
      contractId: "company-contract-1",
      number: "UP-2026-001",
      confirmedContractSource: {
        relationship: "upward",
        sourceRecordId: "company-contract-1",
        sourceVersion: 1,
        contractTypeKey: null,
        counterpartyVersionId: "company-version-1",
        counterparty: "我方建设有限公司",
        payerKind: "construction_enterprise",
        payerVersionId: "affiliate-version-1",
        companyEntityId: "company-1",
        affiliateAssignmentId: "affiliate-assignment-1",
        affiliateBusinessPartyVersionId: "affiliate-version-1"
      }
    });
  }
  function outsideSettlement() {
    return signedSettlement({
      id: "signed-outside-1",
      contractKind: "outside_fact",
      contractId: "outside-contract-1",
      number: "OUT-2026-001",
      confirmedContractSource: {
        relationship: "outside",
        sourceRecordId: "outside-contract-1",
        sourceVersion: 1,
        contractTypeKey: "labor_subcontract",
        counterpartyVersionId: "counterparty-version-1",
        counterparty: "劳务公司",
        payerKind: "construction_enterprise",
        payerVersionId: "affiliate-version-1",
        companyEntityId: null,
        affiliateAssignmentId: "affiliate-assignment-1",
        affiliateBusinessPartyVersionId: "affiliate-version-1"
      }
    });
  }

  it("reads confirmed upward and outside settlements of the same project", async () => {
    const { tx } = fixture();
    tx.signedContractSettlement.findMany.mockResolvedValue([
      upwardSettlement(),
      outsideSettlement()
    ]);
    const adapter = new SignedSettlementOperatingSourceAdapter();
    const snapshots = await adapter.readProjectSnapshots(tx as never, "project-1");
    expect(snapshots.map((row) => row.sourceBusinessId)).toEqual([
      "signed-upward-1",
      "signed-outside-1"
    ]);
  });

  it("maps an upward settlement to an internal receivable only, never project cost or income", async () => {
    const { tx } = fixture();
    tx.signedContractSettlement.findUnique.mockResolvedValue(upwardSettlement());
    const adapter = new SignedSettlementOperatingSourceAdapter();
    const snapshot = await adapter.readSourceSnapshot(tx as never, {
      projectId: "project-1",
      sourceType: SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE,
      sourceBusinessId: "signed-upward-1"
    });
    const { input } = adapter.toOperatingFactInput(snapshot!);
    expect(input.factKind).toBe("downstream_settlement");
    expect(input.operatingLevel).toBe("participating_company");
    expect(input.subjects).toEqual({
      debtor: { kind: "construction_enterprise", id: "affiliate-version-1" },
      creditor: { kind: "participating_company", id: "company-version-1" }
    });
    expect(input.impacts).toEqual([
      expect.objectContaining({
        sourceImpactKey: "receivable_increase",
        impactKind: "receivable_increase",
        amountCents: 100_000n,
        direction: "increase"
      })
    ]);
    expect(input.impacts.some((impact) =>
      impact.impactKind === "confirmed_cost" || impact.impactKind === "confirmed_income"
    )).toBe(false);
  });

  it("maps a negative upward settlement to an internal receivable decrease", async () => {
    const { tx } = fixture();
    tx.signedContractSettlement.findUnique.mockResolvedValue(
      {
        ...upwardSettlement(),
        id: "signed-upward-negative",
        amountYuan: new Prisma.Decimal("-12.0000")
      }
    );
    const adapter = new SignedSettlementOperatingSourceAdapter();
    const snapshot = await adapter.readSourceSnapshot(tx as never, {
      projectId: "project-1",
      sourceType: SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE,
      sourceBusinessId: "signed-upward-negative"
    });
    const { input } = adapter.toOperatingFactInput(snapshot!);
    expect(input.impacts).toEqual([
      expect.objectContaining({
        impactKind: "receivable_increase",
        amountCents: 1200n,
        direction: "decrease"
      })
    ]);
    expect(input.impacts.some((impact) => impact.impactKind === "confirmed_cost")).toBe(false);
  });

  it("maps an outside settlement to project cost and downstream payable", async () => {
    const { tx } = fixture();
    tx.signedContractSettlement.findUnique.mockResolvedValue(outsideSettlement());
    const adapter = new SignedSettlementOperatingSourceAdapter();
    const snapshot = await adapter.readSourceSnapshot(tx as never, {
      projectId: "project-1",
      sourceType: SIGNED_SETTLEMENT_OPERATING_SOURCE_TYPE,
      sourceBusinessId: "signed-outside-1"
    });
    const { input } = adapter.toOperatingFactInput(snapshot!);
    expect(input.factKind).toBe("downstream_settlement");
    expect(input.subjects).toEqual({
      debtor: { kind: "construction_enterprise", id: "affiliate-version-1" },
      creditor: { kind: "downstream_counterparty", id: "counterparty-version-1" }
    });
    expect(input.impacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ impactKind: "confirmed_cost", amountCents: 100_000n, costCategoryCode: "crew_and_labor" }),
        expect.objectContaining({ impactKind: "payable_increase", amountCents: 100_000n })
      ])
    );
  });
});
