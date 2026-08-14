import {
  ProjectProxyPaymentOperatingSourceAdapter,
  ProjectUpstreamSettlementOperatingSourceAdapter
} from "./project-operating-source.adapter";

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

describe("ProjectProxyPaymentOperatingSourceAdapter", () => {
  it("maps a construction-enterprise payment to payable and enterprise funds decreases without cost", async () => {
    const adapter = new ProjectProxyPaymentOperatingSourceAdapter();
    const tx = proxyPaymentTx();
    const snapshot = await adapter.readSourceSnapshot(tx as never, {
      projectId: "project-1",
      sourceType: adapter.sourceType,
      sourceBusinessId: "proxy-payment-1"
    });
    const input = adapter.toOperatingFactInput(snapshot!);

    expect(input.subjects).toEqual({
      debtor: { kind: "construction_enterprise", id: "affiliate-version-1" },
      approvedPayer: {
        kind: "construction_enterprise",
        id: "affiliate-version-1"
      },
      actualPayer: {
        kind: "construction_enterprise",
        id: "affiliate-version-1"
      },
      payee: {
        kind: "downstream_counterparty",
        id: "counterparty-version-1"
      }
    });
    expect(input.impacts).toEqual([
      expect.objectContaining({
        impactKind: "payable_decrease",
        amountCents: 500_00n
      }),
      expect.objectContaining({
        impactKind: "construction_enterprise_funds_decrease",
        amountCents: 500_00n
      })
    ]);
    expect(input.impacts.some((impact) => impact.impactKind === "confirmed_cost"))
      .toBe(false);
  });

  it("fails closed when a construction-enterprise payment points at an own-company contract", async () => {
    const adapter = new ProjectProxyPaymentOperatingSourceAdapter();
    const tx = proxyPaymentTx();
    tx.contractVersion.findUnique.mockResolvedValue({
      id: "contract-version-1",
      signingSubjectType: "our_company",
      affiliateAssignmentId: null,
      affiliateBusinessPartyVersionId: null
    });

    await expect(
      adapter.readSourceSnapshot(tx as never, {
        projectId: "project-1",
        sourceType: adapter.sourceType,
        sourceBusinessId: "proxy-payment-1"
      })
    ).rejects.toThrow("签约主体");
  });
});

function proxyPaymentTx() {
  return {
    project: {
      findUnique: jest.fn().mockResolvedValue({
        operatingLedgerEffectiveDate: new Date("2026-08-01T00:00:00.000Z")
      })
    },
    projectAffiliateAssignment: {
      findFirst: jest.fn().mockResolvedValue({
        id: "affiliate-assignment-1",
        businessPartyVersionId: "affiliate-version-1",
        affiliateNameSnapshot: "施工企业甲",
        affiliateCreditCodeSnapshot: "91310000000000000X"
      })
    },
    projectProxyPayment: {
      findFirst: jest.fn().mockResolvedValue({
        id: "proxy-payment-1",
        projectId: "project-1",
        paidAt: new Date("2026-08-14T00:00:00.000Z"),
        amountCents: 500_00n,
        generalContractorName: "施工企业甲",
        paidTargetName: "供应商乙",
        paymentType: "contract_due",
        paymentSubjectType: "affiliate",
        affiliateAssignmentId: "affiliate-assignment-1",
        affiliateBusinessPartyVersionId: "affiliate-version-1",
        affiliateNameSnapshot: "施工企业甲",
        voucherFileId: "voucher-1",
        recordedByUserId: "finance-user-1",
        contractId: "contract-1",
        settlementId: "settlement-1",
        voidedAt: null,
        createdAt: new Date("2026-08-14T01:00:00.000Z")
      })
    },
    contract: { findUnique: jest.fn().mockResolvedValue({ code: "CON-001" }) },
    settlement: {
      findUnique: jest.fn().mockResolvedValue({
        contractVersionId: "contract-version-1"
      })
    },
    contractVersion: {
      findUnique: jest.fn().mockResolvedValue({
        id: "contract-version-1",
        signingSubjectType: "affiliate",
        affiliateAssignmentId: "affiliate-assignment-1",
        affiliateBusinessPartyVersionId: "affiliate-version-1"
      }),
      findFirst: jest.fn()
    },
    contractPartySnapshot: {
      findFirst: jest.fn().mockResolvedValue({
        businessPartyVersionId: "counterparty-version-1"
      })
    }
  };
}

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
