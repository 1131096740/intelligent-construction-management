import {
  ProjectAffiliateContractFactOperatingSourceAdapter,
  ProjectAffiliatePaymentFactOperatingSourceAdapter,
  ProjectAffiliateSettlementFactOperatingSourceAdapter,
  ProjectUpstreamFundFactOperatingSourceAdapter,
  ProjectProxyPaymentOperatingSourceAdapter,
  ProjectUpstreamSettlementOperatingSourceAdapter
} from "./project-operating-source.adapter";

describe("POL-08 construction-enterprise operating source adapters", () => {
  it("projects confirmed construction-enterprise contracts without turning them into cost or payable", async () => {
    const adapter = new ProjectAffiliateContractFactOperatingSourceAdapter();
    const tx = {
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
      projectAffiliateContractFact: {
        findFirst: jest.fn().mockResolvedValue({
          id: "contract-fact-1",
          ledgerId: "contract-ledger-1",
          projectId: "project-1",
          entryKind: "original",
          adjustsFactId: null,
          effectDirection: "increase",
          contractType: "labor_subcontract",
          externalContractReference: "SUB-001",
          counterpartyName: "供应商乙",
          signedAt: new Date("2026-08-12T00:00:00.000Z"),
          amountNature: "fixed",
          amountCents: 2_000_00n,
          advanceAllowed: false,
          advanceLimitCents: null,
          advanceTermsSummary: null,
          affiliateAssignmentId: "affiliate-assignment-1",
          affiliateBusinessPartyVersionId: "affiliate-version-1",
          affiliateNameSnapshot: "施工企业甲",
          description: "下游合同",
          evidenceFileId: "file-1",
          documentVersion: 1,
          recordedByUserId: "contract-1",
          confirmedByUserId: "contract-director-1",
          confirmedAt: new Date("2026-08-13T01:00:00.000Z"),
          createdAt: new Date("2026-08-12T01:00:00.000Z")
        })
      }
    };
    const snapshot = await adapter.readSourceSnapshot(tx as never, {
      projectId: "project-1",
      sourceType: adapter.sourceType,
      sourceBusinessId: "contract-fact-1"
    });

    const { input } = adapter.toOperatingFactInput(snapshot!);

    expect(input.factKind).toBe("downstream_contract");
    expect(input.amountCents).toBe(2_000_00n);
    expect(input.impacts).toEqual([
      expect.objectContaining({
        impactKind: "contract_commitment_reference",
        amountCents: 0n,
        direction: "notice"
      })
    ]);
    expect(input.impacts.some((impact) => impact.impactKind === "confirmed_cost")).toBe(false);
    expect(input.impacts.some((impact) => impact.impactKind === "payable_increase")).toBe(false);
  });

  it("maps an owner payment to construction-enterprise funds without income or company cash", async () => {
    const adapter = new ProjectUpstreamFundFactOperatingSourceAdapter();
    const snapshot = await adapter.readSourceSnapshot(
      upstreamFundTx() as never,
      {
        projectId: "project-1",
        sourceType: adapter.sourceType,
        sourceBusinessId: "fund-fact-1"
      }
    );

    const { input } = adapter.toOperatingFactInput(snapshot!);

    expect(input.factKind).toBe("owner_payment");
    expect(input.subjects).toEqual({
      actualPayer: { kind: "owner", id: "owner:建设单位" },
      payee: { kind: "construction_enterprise", id: "affiliate-version-1" }
    });
    expect(input.impacts).toEqual([
      expect.objectContaining({
        impactKind: "construction_enterprise_funds_increase",
        amountCents: 1_000_00n,
        direction: "increase"
      })
    ]);
    expect(input.impacts.some((impact) => impact.impactKind === "confirmed_income")).toBe(false);
    expect(input.impacts.some((impact) => impact.impactKind.startsWith("company_") || impact.impactKind === "company_project_funds_increase")).toBe(false);
  });

  it("uses an explicitly linked owner settlement to reduce the receivable", async () => {
    const adapter = new ProjectUpstreamFundFactOperatingSourceAdapter();
    const tx = upstreamFundTx();
    tx.projectUpstreamFundFact.findFirst.mockResolvedValue({
      ...(await tx.projectUpstreamFundFact.findFirst()),
      upstreamSettlementId: "upstream-settlement-1"
    });
    const snapshot = await adapter.readSourceSnapshot(tx as never, {
      projectId: "project-1",
      sourceType: adapter.sourceType,
      sourceBusinessId: "fund-fact-1"
    });

    const { input } = adapter.toOperatingFactInput(snapshot!);

    expect(input.impacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          impactKind: "receivable_decrease",
          amountCents: 1_000_00n
        })
      ])
    );
  });

  it("maps a company remittance with immutable contract, settlement, invoice, and payable lineage", async () => {
    const adapter = new ProjectUpstreamFundFactOperatingSourceAdapter();
    const snapshot = await adapter.readSourceSnapshot(
      remittanceFundTx() as never,
      {
        projectId: "project-1",
        sourceType: adapter.sourceType,
        sourceBusinessId: "fund-fact-remittance-1"
      }
    );

    const { input } = adapter.toOperatingFactInput(snapshot!);

    expect(input.factKind).toBe("fund_movement");
    expect(input.operatingLevel).toBe("participating_company");
    expect(input.impacts.some((impact) => impact.impactKind === "confirmed_cost")).toBe(false);
    expect(input.basisSnapshot).toEqual(
      expect.objectContaining({
        affiliateCompanyContractId: "company-contract-1",
        affiliateSettlementFactId: "settlement-fact-1",
        invoiceRecordId: "invoice-1",
        payableAmountCents: "12000",
        actualPaymentAmountCents: "10000",
        companyUnpaidAmountCents: "2000",
        companyDifferenceAmountCents: "-2000"
      })
    );
  });

  it("keeps construction-enterprise deductions out of final cost impacts", async () => {
    const adapter = new ProjectUpstreamFundFactOperatingSourceAdapter();
    const tx = upstreamFundTx();
    tx.projectUpstreamFundFact.findFirst.mockResolvedValue({
      id: "fund-fact-1",
      projectId: "project-1",
      factType: "affiliate_deduction",
      entryKind: "original",
      adjustsFactId: null,
      effectDirection: "increase",
      occurredAt: new Date("2026-08-12T00:00:00.000Z"),
      amountCents: 10000n,
      counterpartyName: "施工企业甲",
      basisType: "written",
      deductionCategory: "management_fee",
      upstreamSettlementId: null,
      companyEntityId: null,
      affiliateAssignmentId: "affiliate-assignment-1",
      affiliateBusinessPartyVersionId: "affiliate-version-1",
      affiliateNameSnapshot: "施工企业甲",
      description: "施工企业扣款",
      evidenceFileId: "file-1",
      documentVersion: 1,
      recordedByUserId: "finance-1",
      confirmedByUserId: "finance-director-1",
      confirmedAt: new Date("2026-08-12T01:00:00.000Z")
    });
    const snapshot = await adapter.readSourceSnapshot(tx as never, {
      projectId: "project-1",
      sourceType: adapter.sourceType,
      sourceBusinessId: "fund-fact-1"
    });

    const { input } = adapter.toOperatingFactInput(snapshot!);
    expect(input.factKind).toBe("construction_enterprise_deduction");
    expect(input.impacts).toEqual([
      expect.objectContaining({ impactKind: "construction_enterprise_funds_decrease" })
    ]);
    expect(input.impacts.some((impact) => impact.impactKind === "confirmed_cost")).toBe(false);
  });

  it("maps construction-enterprise settlement and payment as cost then payable/funds settlement", async () => {
    const settlementAdapter = new ProjectAffiliateSettlementFactOperatingSourceAdapter();
    const settlementSnapshot = await settlementAdapter.readSourceSnapshot(
      affiliateFactTx() as never,
      {
        projectId: "project-1",
        sourceType: settlementAdapter.sourceType,
        sourceBusinessId: "settlement-fact-1"
      }
    );
    const settlement = settlementAdapter.toOperatingFactInput(settlementSnapshot!).input;
    expect(settlement.factKind).toBe("downstream_settlement");
    expect(settlement.impacts).toEqual([
      expect.objectContaining({ impactKind: "confirmed_cost", amountCents: 2_000_00n }),
      expect.objectContaining({ impactKind: "payable_increase", amountCents: 2_000_00n })
    ]);

    const paymentAdapter = new ProjectAffiliatePaymentFactOperatingSourceAdapter();
    const paymentSnapshot = await paymentAdapter.readSourceSnapshot(
      affiliateFactTx() as never,
      {
        projectId: "project-1",
        sourceType: paymentAdapter.sourceType,
        sourceBusinessId: "payment-fact-1"
      }
    );
    const payment = paymentAdapter.toOperatingFactInput(paymentSnapshot!).input;
    expect(payment.factKind).toBe("downstream_payment");
    expect(payment.impacts).toEqual([
      expect.objectContaining({ impactKind: "payable_decrease", amountCents: 500_00n }),
      expect.objectContaining({
        impactKind: "construction_enterprise_funds_decrease",
        amountCents: 500_00n
      })
    ]);
    expect(payment.impacts.some((impact) => impact.impactKind === "confirmed_cost")).toBe(false);
  });

  it.each(["advance", "direct_contract"])(
    "maps %s payment to the contract payable when no settlement is present",
    async (paymentKind) => {
      const adapter = new ProjectAffiliatePaymentFactOperatingSourceAdapter();
      const snapshot = await adapter.readSourceSnapshot(
        affiliateFactTx() as never,
        {
          projectId: "project-1",
          sourceType: adapter.sourceType,
          sourceBusinessId: "payment-fact-1"
        }
      );
      const contractPaymentSnapshot = {
        ...snapshot!,
        sourceSnapshot: {
          ...snapshot!.sourceSnapshot,
          settlementLedgerId: null,
          paymentKind
        }
      };

      const payment = adapter.toOperatingFactInput(contractPaymentSnapshot).input;

      expect(payment.impacts).toEqual([
        expect.objectContaining({
          impactKind: "payable_decrease",
          sourceImpactKey: "payable_decrease:contract-ledger-1"
        }),
        expect.objectContaining({
          impactKind: "construction_enterprise_funds_decrease"
        })
      ]);
    }
  );
});

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

    const { entryKind, input } = adapter.toOperatingFactInput(snapshot!);
    expect(entryKind).toBe("original");
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
    const { entryKind, input } = adapter.toOperatingFactInput(snapshot!);
    expect(entryKind).toBe("original");

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

function upstreamFundTx() {
  return {
    project: {
      findUnique: jest.fn().mockResolvedValue({
        operatingLedgerEffectiveDate: new Date("2026-08-01T00:00:00.000Z")
      })
    },
    projectUpstreamFundFact: {
      findFirst: jest.fn().mockResolvedValue({
        id: "fund-fact-1",
        projectId: "project-1",
        factType: "owner_payment_to_affiliate",
        entryKind: "original",
        adjustsFactId: null,
        effectDirection: "increase",
        occurredAt: new Date("2026-08-12T00:00:00.000Z"),
        amountCents: 1_000_00n,
        counterpartyName: "建设单位",
        basisType: "written",
        deductionCategory: null,
        upstreamSettlementId: null,
        affiliateAssignmentId: "affiliate-assignment-1",
        affiliateBusinessPartyVersionId: "affiliate-version-1",
        affiliateNameSnapshot: "施工企业甲",
        description: "业主已付款",
        evidenceFileId: "file-1",
        documentVersion: 2,
        recordedByUserId: "finance-1",
        confirmedByUserId: "finance-director-1",
        confirmedAt: new Date("2026-08-12T01:00:00.000Z")
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
}

function remittanceFundTx() {
  return {
    project: {
      findUnique: jest.fn().mockResolvedValue({
        operatingLedgerEffectiveDate: new Date("2026-08-01T00:00:00.000Z")
      })
    },
    projectUpstreamFundFact: {
      findFirst: jest.fn().mockResolvedValue({
        id: "fund-fact-remittance-1",
        projectId: "project-1",
        factType: "affiliate_remittance_to_company",
        entryKind: "original",
        adjustsFactId: null,
        effectDirection: "increase",
        occurredAt: new Date("2026-08-12T00:00:00.000Z"),
        amountCents: 10000n,
        counterpartyName: "我方公司",
        basisType: "written",
        deductionCategory: null,
        upstreamSettlementId: null,
        companyEntityId: "company-1",
        affiliateCompanyContractId: "company-contract-1",
        affiliateSettlementFactId: "settlement-fact-1",
        invoiceRecordId: "invoice-1",
        affiliateAssignmentId: "affiliate-assignment-1",
        affiliateBusinessPartyVersionId: "affiliate-version-1",
        affiliateNameSnapshot: "施工企业甲",
        description: "施工企业向我方拨款",
        evidenceFileId: "file-1",
        documentVersion: 1,
        recordedByUserId: "finance-1",
        confirmedByUserId: "finance-director-1",
        confirmedAt: new Date("2026-08-12T01:00:00.000Z")
      })
    },
    projectAffiliateSettlementFact: {
      findFirst: jest.fn().mockResolvedValue({ amountCents: 12000n })
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

function affiliateFactTx() {
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
    projectAffiliateContractFact: {
      findFirst: jest.fn().mockResolvedValue({ contractType: "labor_subcontract" })
    },
    projectAffiliateSettlementFact: {
      findFirst: jest.fn().mockResolvedValue({
        id: "settlement-fact-1",
        ledgerId: "settlement-ledger-1",
        projectId: "project-1",
        contractLedgerId: "contract-ledger-1",
        entryKind: "original",
        adjustsFactId: null,
        effectDirection: "increase",
        counterpartyName: "供应商乙",
        settledAt: new Date("2026-08-12T00:00:00.000Z"),
        periodLabel: "2026-08",
        amountCents: 2_000_00n,
        affiliateAssignmentId: "affiliate-assignment-1",
        affiliateBusinessPartyVersionId: "affiliate-version-1",
        affiliateNameSnapshot: "施工企业甲",
        basisType: "written",
        description: "下游结算",
        evidenceFileId: "file-2",
        documentVersion: 1,
        recordedByUserId: "finance-1",
        confirmedByUserId: "finance-director-1",
        confirmedAt: new Date("2026-08-12T01:00:00.000Z")
      })
    },
    projectAffiliatePaymentFact: {
      findFirst: jest.fn().mockResolvedValue({
        id: "payment-fact-1",
        ledgerId: "payment-ledger-1",
        projectId: "project-1",
        contractLedgerId: "contract-ledger-1",
        settlementLedgerId: "settlement-ledger-1",
        paymentRequestId: "payment-request-1",
        entryKind: "original",
        adjustsFactId: null,
        effectDirection: "increase",
        counterpartyName: "供应商乙",
        paidAt: new Date("2026-08-13T00:00:00.000Z"),
        amountCents: 500_00n,
        paymentKind: "normal",
        externalPaymentReference: "BANK-1",
        affiliateAssignmentId: "affiliate-assignment-1",
        affiliateBusinessPartyVersionId: "affiliate-version-1",
        affiliateNameSnapshot: "施工企业甲",
        basisType: "written",
        description: "下游实付",
        evidenceFileId: "file-3",
        documentVersion: 1,
        recordedByUserId: "finance-1",
        confirmedByUserId: "finance-director-1",
        confirmedAt: new Date("2026-08-13T01:00:00.000Z")
      })
    }
  };
}
