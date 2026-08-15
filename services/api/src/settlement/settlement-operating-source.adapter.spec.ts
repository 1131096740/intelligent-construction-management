import { SettlementOperatingSourceAdapter } from "./settlement-operating-source.adapter";

describe("SettlementOperatingSourceAdapter", () => {
  it.each([
    ["material_purchase", "material"],
    ["equipment_rental", "machinery_and_rental"],
    ["labor_subcontract", "crew_and_labor"],
    ["professional_subcontract", "professional_subcontract"]
  ] as const)(
    "maps effective %s settlement to one controlled %s cost",
    async (contractTypeKey, expectedCategory) => {
      const adapter = new SettlementOperatingSourceAdapter();
      const tx = settlementTx(contractTypeKey);
      const snapshot = await adapter.readSourceSnapshot(tx as never, {
        projectId: "project-1",
        sourceType: adapter.sourceType,
        sourceBusinessId: "settlement-1"
      });

      const { entryKind, input } = adapter.toOperatingFactInput(snapshot!);
      expect(entryKind).toBe("original");
      expect(input).toEqual(
        expect.objectContaining({
          sourceType: "settlement",
          sourceBusinessId: "settlement-1",
          sourceBusinessCode: "SET-202608-001",
          sourceVersion: 4,
          factKind: "downstream_settlement",
          amountCents: 1_000_00n,
          subjects: {
            debtor: { kind: "participating_company", id: "company-version-1" },
            creditor: {
              kind: "downstream_counterparty",
              id: "counterparty-version-1"
            }
          }
        })
      );
      expect(input.impacts).toEqual([
        expect.objectContaining({
          sourceImpactKey: "confirmed_cost",
          impactKind: "confirmed_cost",
          amountCents: 1_000_00n,
          costCategoryCode: expectedCategory
        }),
        expect.objectContaining({
          sourceImpactKey: "payable_increase",
          impactKind: "payable_increase",
          amountCents: 900_00n
        })
      ]);
    }
  );

  it("uses the frozen construction enterprise as debtor for affiliate contracts", async () => {
    const adapter = new SettlementOperatingSourceAdapter();
    const tx = settlementTx("professional_subcontract", {
      signingSubjectType: "affiliate",
      companyEntityVersionId: null
    });
    const snapshot = await adapter.readSourceSnapshot(tx as never, {
      projectId: "project-1",
      sourceType: adapter.sourceType,
      sourceBusinessId: "settlement-1"
    });

    expect(adapter.toOperatingFactInput(snapshot!).input.subjects.debtor).toEqual({
      kind: "construction_enterprise",
      id: "affiliate-version-1"
    });
  });

  it("requires an effective status and a formally confirmed archive", async () => {
    const adapter = new SettlementOperatingSourceAdapter();
    const tx = settlementTx("material_purchase");
    (tx.settlement.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      adapter.readSourceSnapshot(tx as never, {
        projectId: "project-1",
        sourceType: adapter.sourceType,
        sourceBusinessId: "draft-1"
      })
    ).resolves.toBeNull();
    expect(tx.settlement.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["effective", "partially_paid", "paid"] }
        })
      })
    );
  });

  it("uses takeover activation and settlement evidence for the synthetic opening settlement", async () => {
    const adapter = new SettlementOperatingSourceAdapter();
    const tx = Object.assign(settlementTx("material_purchase"), {
      contractTakeover: {
        findUnique: jest.fn().mockResolvedValue({
          activatedAt: new Date("2026-08-13T08:00:00.000Z"),
          activatedByUserId: "finance-director-1",
          confirmedByUserId: "finance-director-1",
          takeoverLevel: "A",
          signedAt: new Date("2026-07-01T00:00:00.000Z")
        })
      },
      contractTakeoverContractFacts: {
        findUnique: jest.fn().mockResolvedValue({
          signedAt: new Date("2026-07-01T00:00:00.000Z"),
          contractFactsSnapshot: { settlementCutoffDate: "2026-07-31" }
        })
      },
      contractTakeoverSettlementEvidence: {
        findFirst: jest.fn().mockResolvedValue({ id: "takeover-evidence-1" })
      }
    });
    tx.settlement.findFirst.mockResolvedValue({
      id: "settlement-1",
      projectId: "project-1",
      contractId: "contract-1",
      contractVersionId: "contract-version-1",
      code: "HT-OPEN-takeover-1",
      status: "effective",
      amountCents: 1_000_00n,
      payableAmountCents: 900_00n,
      periodEnd: null,
      calculationVersion: null,
      governanceVersion: null,
      sourceType: "historical_takeover",
      sourceTakeoverId: "takeover-1",
      updatedAt: new Date("2026-08-13T08:00:00.000Z")
    });
    tx.contractTakeoverCorrection.findMany.mockResolvedValue([
      { deltaSnapshot: { amountCents: "-10000" } }
    ]);
    const snapshot = await adapter.readSourceSnapshot(tx as never, {
      projectId: "project-1",
      sourceType: adapter.sourceType,
      sourceBusinessId: "settlement-1"
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.sourceSnapshot).toEqual(
      expect.objectContaining({
        archiveEvidenceId: "takeover-evidence-1",
        occurredAt: "2026-07-31T00:00:00.000Z",
        amountCents: "110000",
        payableAmountCents: "100000"
      })
    );
  });
});

function settlementTx(
  contractTypeKey: string,
  versionOverrides: Record<string, unknown> = {}
) {
  return {
    project: {
      findUnique: jest.fn().mockResolvedValue({
        operatingLedgerEffectiveDate: new Date("2026-08-01T00:00:00.000Z")
      })
    },
    settlement: {
      findFirst: jest.fn().mockResolvedValue({
        id: "settlement-1",
        projectId: "project-1",
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        code: "SET-202608-001",
        status: "effective",
        amountCents: 1_000_00n,
        payableAmountCents: 900_00n,
        periodEnd: new Date("2026-08-12T00:00:00.000Z"),
        calculationVersion: 4,
        governanceVersion: 1,
        updatedAt: new Date("2026-08-13T08:00:00.000Z")
      }),
      findMany: jest.fn().mockResolvedValue([])
    },
    contractTakeover: {
      findUnique: jest.fn().mockResolvedValue(null)
    },
    contractTakeoverCorrection: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null)
    },
    contract: {
      findUnique: jest.fn().mockResolvedValue({ contractTypeKey })
    },
    contractVersion: {
      findUnique: jest.fn().mockResolvedValue({
        signingSubjectType: "our_company",
        companyEntityVersionId: "company-version-1",
        affiliateAssignmentId: "affiliate-assignment-1",
        affiliateBusinessPartyVersionId: "affiliate-version-1",
        affiliateNameSnapshot: "施工企业甲",
        affiliateCreditCodeSnapshot: "91310000000000000X",
        ...versionOverrides
      })
    },
    contractPartySnapshot: {
      findFirst: jest.fn().mockResolvedValue({
        businessPartyVersionId: "counterparty-version-1",
        snapshot: { name: "供应商乙" }
      })
    },
    settlementSignedDocument: {
      findFirst: jest.fn().mockResolvedValue({
        id: "signed-document-1",
        confirmedByUserId: "contract-director-1",
        confirmedAt: new Date("2026-08-13T08:00:00.000Z")
      })
    },
    settlementArchiveFile: { findFirst: jest.fn().mockResolvedValue(null) },
    projectAffiliateAssignment: {
      findFirst: jest.fn().mockResolvedValue({
        id: "affiliate-assignment-1",
        businessPartyVersionId: "affiliate-version-1",
        affiliateNameSnapshot: "施工企业甲",
        affiliateCreditCodeSnapshot: "91310000000000000X"
      })
    }
  };
}
