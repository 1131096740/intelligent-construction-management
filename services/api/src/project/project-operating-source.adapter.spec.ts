import { ProjectUpstreamSettlementOperatingSourceAdapter } from "./project-operating-source.adapter";

describe("ProjectUpstreamSettlementOperatingSourceAdapter", () => {
  it("maps only a confirmed upstream settlement to income and receivable once", async () => {
    const adapter = new ProjectUpstreamSettlementOperatingSourceAdapter();
    const tx = {
      project: {
        findUnique: jest.fn().mockResolvedValue({
          operatingLedgerEffectiveDate: new Date("2026-08-01T00:00:00.000Z")
        })
      },
      projectUpstreamSettlement: {
        findMany: jest.fn().mockResolvedValue([
          upstreamSettlement({ status: "confirmed" })
        ]),
        findFirst: jest.fn().mockResolvedValue(
          upstreamSettlement({ status: "confirmed" })
        )
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

    const [snapshot] = await adapter.readProjectSnapshots(tx as never, "project-1");
    expect(tx.projectUpstreamSettlement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: "project-1",
          status: "confirmed",
          voidedAt: null
        })
      })
    );

    const input = adapter.toOperatingFactInput(snapshot!);
    expect(input).toEqual(
      expect.objectContaining({
        projectId: "project-1",
        sourceType: "project_upstream_settlement",
        sourceBusinessId: "upstream-settlement-1",
        sourceVersion: 3,
        factKind: "owner_settlement",
        amountCents: 2_500_00n,
        direction: "inflow",
        confirmedByUserId: "contract-director-1",
        subjects: {
          debtor: { kind: "owner", id: "owner:建设单位" },
          creditor: {
            kind: "construction_enterprise",
            id: "affiliate-version-1"
          }
        }
      })
    );
    expect(input.impacts).toEqual([
      expect.objectContaining({
        sourceImpactKey: "confirmed_income",
        impactKind: "confirmed_income",
        amountCents: 2_500_00n
      }),
      expect.objectContaining({
        sourceImpactKey: "receivable_increase",
        impactKind: "receivable_increase",
        amountCents: 2_500_00n
      })
    ]);
  });

  it("does not expose a pending or voided upstream settlement as a formal source", async () => {
    const adapter = new ProjectUpstreamSettlementOperatingSourceAdapter();
    const tx = {
      project: { findUnique: jest.fn() },
      projectUpstreamSettlement: { findFirst: jest.fn().mockResolvedValue(null) },
      projectAffiliateAssignment: { findFirst: jest.fn() }
    };

    await expect(
      adapter.readSourceSnapshot(tx as never, {
        projectId: "project-1",
        sourceType: adapter.sourceType,
        sourceBusinessId: "pending-1"
      })
    ).resolves.toBeNull();
    expect(tx.projectUpstreamSettlement.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "confirmed", voidedAt: null })
      })
    );
  });
});

function upstreamSettlement(overrides: Record<string, unknown> = {}) {
  return {
    id: "upstream-settlement-1",
    projectId: "project-1",
    settledAt: new Date("2026-08-12T00:00:00.000Z"),
    reportedAmountCents: 2_600_00n,
    approvedAmountCents: 2_500_00n,
    approvingPartyName: "建设单位",
    periodLabel: "2026年8月",
    isFinal: false,
    affiliateAssignmentId: "affiliate-assignment-1",
    affiliateBusinessPartyVersionId: "affiliate-version-1",
    affiliateNameSnapshot: "施工企业甲",
    description: "月度对上结算",
    voucherFileId: "file-1",
    documentVersion: 3,
    recordedByUserId: "contract-staff-1",
    status: "confirmed",
    confirmedByUserId: "contract-director-1",
    confirmedAt: new Date("2026-08-13T08:00:00.000Z"),
    voidedAt: null,
    ...overrides
  };
}
