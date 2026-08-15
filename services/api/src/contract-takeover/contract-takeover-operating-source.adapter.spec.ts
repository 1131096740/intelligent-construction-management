import {
  CONTRACT_TAKEOVER_HISTORICAL_PAYMENT_SOURCE_TYPE,
  ContractTakeoverHistoricalPaymentOperatingSourceAdapter
} from "./contract-takeover-operating-source.adapter";

describe("ContractTakeoverHistoricalPaymentOperatingSourceAdapter", () => {
  it("maps an activated A-level payment to funds, payable and advance impacts without confirmed cost", async () => {
    const adapter = new ContractTakeoverHistoricalPaymentOperatingSourceAdapter();
    const tx = historicalPaymentTx();
    const snapshot = await adapter.readSourceSnapshot(tx as never, {
      projectId: "project-1",
      sourceType: CONTRACT_TAKEOVER_HISTORICAL_PAYMENT_SOURCE_TYPE,
      sourceBusinessId: "historical-payment-1"
    });

    const mapped = adapter.toOperatingFactInput(snapshot!);

    expect(mapped.entryKind).toBe("original");
    expect(mapped.input).toEqual(
      expect.objectContaining({
        factKind: "downstream_payment",
        evidenceLevel: "A",
        amountCents: 150_000n,
        sourceType: CONTRACT_TAKEOVER_HISTORICAL_PAYMENT_SOURCE_TYPE,
        subjects: {
          debtor: { kind: "participating_company", id: "company-1" },
          approvedPayer: { kind: "participating_company", id: "company-1" },
          actualPayer: { kind: "participating_company", id: "company-1" },
          payee: {
            kind: "downstream_counterparty",
            id: "counterparty-version-1"
          }
        }
      })
    );
    expect(mapped.input.impacts).toEqual([
      expect.objectContaining({
        sourceImpactKey: "payable:initial-settlement-1",
        impactKind: "payable_decrease",
        amountCents: 100_000n
      }),
      expect.objectContaining({
        sourceImpactKey: "company_project_funds_decrease",
        impactKind: "company_project_funds_decrease",
        amountCents: 150_000n
      }),
      expect.objectContaining({
        sourceImpactKey: "historical_advance",
        impactKind: "company_advance_for_project_increase",
        amountCents: 50_000n
      })
    ]);
    expect(mapped.input.impacts).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ impactKind: "confirmed_cost" })
      ])
    );
    expect(mapped.input.isBeforeOperatingLedgerEffectiveDate).toBe(true);
  });

  it("does not expose C-level or inactive historical payments as formal sources", async () => {
    const adapter = new ContractTakeoverHistoricalPaymentOperatingSourceAdapter();
    const tx = historicalPaymentTx();
    tx.contractTakeover.findFirst.mockResolvedValue(null);

    await expect(
      adapter.readSourceSnapshot(tx as never, {
        projectId: "project-1",
        sourceType: adapter.sourceType,
        sourceBusinessId: "historical-payment-1"
      })
    ).resolves.toBeNull();

    tx.contractTakeover.findMany.mockResolvedValue([]);
    await expect(
      adapter.readProjectSnapshots(tx as never, "project-1")
    ).resolves.toEqual([]);
    expect(tx.contractTakeover.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          takeoverLevel: { in: ["A", "B"] },
          activatedAt: { not: null }
        })
      })
    );
  });

  it("projects abnormal overpay as a returnable company balance", async () => {
    const adapter = new ContractTakeoverHistoricalPaymentOperatingSourceAdapter();
    const tx = historicalPaymentTx();
    tx.contractTakeoverHistoricalPaymentAllocation.findMany.mockResolvedValue([
      {
        allocationType: "abnormal_overpay",
        amountCents: 50_000n,
        allocationOrder: 1
      }
    ]);

    const snapshot = await adapter.readSourceSnapshot(tx as never, {
      projectId: "project-1",
      sourceType: adapter.sourceType,
      sourceBusinessId: "historical-payment-1"
    });

    expect(adapter.toOperatingFactInput(snapshot!).input.impacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceImpactKey: "abnormal_overpay",
          impactKind: "company_returnable_to_project_increase",
          amountCents: 50_000n
        })
      ])
    );
  });
});

function historicalPaymentTx() {
  return {
    project: {
      findUnique: jest.fn().mockResolvedValue({
        operatingLedgerEffectiveDate: new Date("2026-08-01T00:00:00.000Z")
      })
    },
    contractTakeover: {
      findMany: jest.fn().mockResolvedValue([{ id: "takeover-1" }]),
      findFirst: jest.fn().mockResolvedValue({
        id: "takeover-1",
        projectId: "project-1",
        takeoverBatchId: "batch-1",
        contractId: "contract-1",
        contractVersionId: "contract-version-1",
        paymentTermsVersionId: "terms-1",
        takeoverLevel: "A",
        activatedAt: new Date("2026-08-02T00:00:00.000Z"),
        activatedByUserId: "finance-director-1",
        confirmedByUserId: "finance-director-1",
        historicalInitialSettlementId: "initial-settlement-1"
      })
    },
    contractTakeoverHistoricalPayment: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: "historical-payment-1",
          takeoverId: "takeover-1",
          rowKey: "row-1",
          sequenceNo: 1,
          amountCents: 150_000n,
          paidAt: new Date("2026-07-30T00:00:00.000Z"),
          payerName: "我方公司",
          payeeName: "供应商",
          bankReference: "BANK-1",
          paymentMethod: "bank",
          note: "历史付款",
          status: "activated"
        }
      ]),
      findUnique: jest.fn().mockResolvedValue({
        id: "historical-payment-1",
        takeoverId: "takeover-1",
        rowKey: "row-1",
        sequenceNo: 1,
        amountCents: 150_000n,
        paidAt: new Date("2026-07-30T00:00:00.000Z"),
        payerName: "我方公司",
        payeeName: "供应商",
        bankReference: "BANK-1",
        paymentMethod: "bank",
        note: "历史付款",
        status: "activated"
      })
    },
    contract: {
      findUnique: jest.fn().mockResolvedValue({
        code: "HT-001",
        name: "历史材料合同",
        counterparty: "供应商"
      })
    },
    contractVersion: {
      findUnique: jest.fn().mockResolvedValue({
        signingSubjectType: "our_company",
        companyEntityIdSnapshot: "company-1",
        companyEntityVersionId: "company-version-1",
        companyEntityNameSnapshot: "我方公司",
        affiliateAssignmentId: "affiliate-assignment-1",
        affiliateBusinessPartyVersionId: "affiliate-version-1",
        affiliateNameSnapshot: "施工企业甲"
      })
    },
    contractPartySnapshot: {
      findFirst: jest.fn().mockResolvedValue({
        businessPartyVersionId: "counterparty-version-1",
        snapshot: { name: "供应商" }
      })
    },
    contractTakeoverHistoricalPaymentAllocation: {
      findMany: jest.fn().mockResolvedValue([
        {
          allocationType: "settlement",
          amountCents: 100_000n,
          allocationOrder: 1
        },
        {
          allocationType: "historical_advance",
          amountCents: 50_000n,
          allocationOrder: 2
        }
      ])
    },
    contractTakeoverHistoricalPaymentVoucher: {
      findMany: jest.fn().mockResolvedValue([{ fileId: "voucher-1" }])
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
}
