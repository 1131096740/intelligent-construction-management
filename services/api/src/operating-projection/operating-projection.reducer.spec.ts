import {
  OperatingProjectionStreamAccumulator,
  ProjectionResourceBudgetExceededError,
  reduceOperatingProjection,
  toOperatingProjectionAggregate,
  type ProjectionFactInput,
  type ProjectionRestrictionSourceInput
} from "./operating-projection.reducer";

const fact = (
  overrides: Partial<ProjectionFactInput> = {}
): ProjectionFactInput => ({
  id: "fact-1",
  projectId: "project-1",
  projectCode: "XM-001",
  projectName: "一号项目",
  sourceType: "owner_settlement",
  sourceBusinessId: "source-1",
  sourceVersion: 1,
  sourceBusinessCode: "YS-001",
  occurredAt: "2026-01-10T00:00:00.000Z",
  confirmedAt: "2026-01-11T00:00:00.000Z",
  affiliateBusinessPartyVersionId: "enterprise-v1",
  affiliateNameSnapshot: "施工企业甲",
  factKind: "owner_settlement",
  operatingLevel: "project",
  evidenceLevel: "A",
  amountCents: 0n,
  direction: "neutral",
  sourceSnapshot: {},
  entryKind: "original",
  impacts: [],
  ...overrides
});

const reserveFact = (input: {
  id: string;
  entryId: string;
  impactId: string;
  amountCents: bigint;
  entryKind?: "establish" | "release";
  adjustsEntryId?: string;
  replacementImpacts?: Array<{
    operatingImpactEntryId: string;
    amountCents: string;
  }>;
  impactFingerprint?: string;
}): ProjectionFactInput => {
  const entryKind = input.entryKind ?? "establish";
  const fingerprint = `${input.entryId}-fingerprint`;
  return fact({
    id: input.id,
    sourceType: "project_necessary_expense_reserve_entry",
    sourceBusinessId: input.entryId,
    sourceBusinessCode: "BYFY-001",
    evidenceLevel: "A",
    amountCents: input.amountCents,
    operatingLevel: "construction_enterprise",
    sourceSnapshot: {
      schema: "project_necessary_expense_reserve_entry/V1",
      reserveId: "reserve-1",
      entryId: input.entryId,
      entryKind,
      ...(input.adjustsEntryId ? { adjustsEntryId: input.adjustsEntryId } : {}),
      amountCents: input.amountCents.toString(),
      evidenceLevel: "A",
      fingerprint,
      confirmedAt: "2026-01-11T00:00:00.000Z",
      economicIdentityKey: "economic-reserve-1",
      sourceIdentityKey: "source-reserve-1",
      sourceVersion: "1",
      businessCode: "BYFY-001",
      fundHolder: { kind: "construction_enterprise", id: "enterprise-v1" },
      replacementImpacts: input.replacementImpacts ?? []
    },
    impacts: [{
      id: input.impactId,
      impactKind: entryKind === "release"
        ? "necessary_expense_reserve_decrease"
        : "necessary_expense_reserve_increase",
      amountCents: input.amountCents,
      direction: entryKind === "release" ? "decrease" : "increase",
      subjectRole: "fund_holder",
      subjectKind: "construction_enterprise",
      subjectId: "enterprise-v1",
      impactSnapshot: {
        reserveId: "reserve-1",
        entryId: input.entryId,
        fingerprint: input.impactFingerprint ?? fingerprint,
        economicIdentityKey: "economic-reserve-1",
        sourceIdentityKey: "source-reserve-1"
      }
    }]
  });
};

const reserveSource = (input: {
  entryId: string;
  amountCents: bigint;
  entryKind?: "establish" | "release";
  adjustsEntryId?: string;
  replacementImpacts?: Array<{
    operatingImpactEntryId: string;
    amountCents: string;
  }>;
  fingerprint?: string;
}): ProjectionRestrictionSourceInput => ({
  sourceType: "project_necessary_expense_reserve_entry",
  entryId: input.entryId,
  projectId: "project-1",
  status: "confirmed",
  sourceVersion: 1,
  entryKind: input.entryKind ?? "establish",
  adjustsEntryId: input.adjustsEntryId,
  amountCents: input.amountCents,
  evidenceLevel: "A",
  fingerprint: input.fingerprint ?? `${input.entryId}-fingerprint`,
  confirmedAt: "2026-01-11T00:00:00.000Z",
  rootId: "reserve-1",
  businessCode: "BYFY-001",
  economicIdentityKey: "economic-reserve-1",
  sourceIdentityKey: "source-reserve-1",
  fundHolderKind: "construction_enterprise",
  fundHolderId: "enterprise-v1",
  replacements: (input.replacementImpacts ?? []).map((replacement) => ({
    operatingImpactEntryId: replacement.operatingImpactEntryId,
    amountCents: BigInt(replacement.amountCents)
  }))
});

describe("reduceOperatingProjection", () => {
  it("recomputes project layers from signed impacts and eliminates internal carriers", () => {
    const result = reduceOperatingProjection({
      scope: { kind: "project", projectIds: ["project-1"], projectId: "project-1" },
      readAt: "2026-09-11T00:00:00.000Z",
      cutoffAt: "2026-09-11T00:00:00.000Z",
      facts: [fact({
        impacts: [
          { id: "i-1", impactKind: "confirmed_income", amountCents: 1_000n, direction: "increase" },
          { id: "i-2", impactKind: "confirmed_cost", amountCents: 300n, direction: "increase" },
          { id: "i-3", impactKind: "construction_enterprise_funds_increase", amountCents: 800n, direction: "increase", subjectKind: "construction_enterprise", subjectId: "enterprise-v1" },
          { id: "i-4", impactKind: "company_project_funds_decrease", amountCents: 50n, direction: "decrease", subjectKind: "participating_company", subjectId: "company-1" },
          { id: "i-5", impactKind: "payable_increase", amountCents: 200n, direction: "increase" },
          { id: "i-6", impactKind: "estimated_clearing_expense", amountCents: 40n, direction: "increase" },
          { id: "i-7", impactKind: "necessary_expense_reserve_increase", amountCents: 30n, direction: "increase" },
          { id: "i-8", impactKind: "project_disputed_funds_increase", amountCents: 20n, direction: "increase" },
          { id: "i-9", impactKind: "construction_enterprise_funds_freeze", amountCents: 10n, direction: "increase" },
          { id: "i-10", impactKind: "company_advance_for_project_increase", amountCents: 50n, direction: "increase" },
          { id: "i-11", impactKind: "temporary_profit_distribution", amountCents: 50n, direction: "increase" }
        ]
      }), fact({
        id: "internal-fact",
        sourceType: "fund_movement",
        sourceBusinessId: "movement-1",
        sourceBusinessCode: "ZJDD-001",
        factKind: "fund_movement",
        impacts: [
          { id: "internal-1", impactKind: "construction_enterprise_funds_decrease", amountCents: 100n, direction: "decrease" },
          { id: "internal-2", impactKind: "company_project_funds_increase", amountCents: 100n, direction: "increase", subjectKind: "participating_company", subjectId: "company-1" },
          { id: "internal-3", impactKind: "inter_subject_balance_increase", amountCents: 100n, direction: "increase" }
        ]
      })],
      riskByProject: [{
        projectId: "project-1",
        relationshipCompleteness: "coverage_incomplete",
        openPendingGrossCents: 100n,
        openCoveredCents: 75n,
        openUncoveredCents: 25n,
        continuedWithheldRetainedCents: 10n,
        coveredWithheldSources: [{
          openCoveredCents: 75n,
          continuedRetainedCents: 10n
        }],
        items: [{
          openAmountCents: 100n,
          openCoveredCents: 75n,
          openUncoveredCents: 25n,
          status: "open"
        }]
      }]
    });

    expect(result.profitAndLoss).toEqual({
      currentOperatingProfitCents: "700",
      estimatedClearingExpenseCents: "40",
      currentEstimatedProfitCents: "660",
      finalConfirmedProfitCents: null,
      finalConfirmable: false
    });
    expect(result.actualFunds).toEqual(expect.objectContaining({
      constructionEnterpriseFundsCents: "700",
      companyProjectFundsCents: "50",
      netProjectCashPositionCents: "750",
      nonNegativeUsableCashStartCents: "750"
    }));
    expect(result.restrictions).toEqual(expect.objectContaining({
      openCoveredReconciliationCents: "75",
      openUncoveredReconciliationCents: "25",
      continuedWithheldRetainedCents: "10"
    }));
    // 750 - (200 + 40 + 30 + 20 + 10 + 25 + 50 + 50) = 325.
    expect(result.distribution).toEqual({
      cashCeilingCents: "325",
      projectedProfitCeilingCents: "610",
      currentDistributableProfitCents: "325"
    });
    expect(result.impactTotalsByKind.confirmed_income).toBe("1000");
    expect(result.impactTotalsByKind.inter_subject_balance_increase).toBe("100");
  });

  it("counts A/B/C evidence, keeps C gaps non-financial, and marks retroactive facts", () => {
    const result = reduceOperatingProjection({
      scope: { kind: "project", projectIds: ["project-1"], projectId: "project-1" },
      readAt: "2026-03-10T00:00:00.000Z",
      cutoffAt: "2026-02-01T15:59:59.999Z",
      facts: [
        fact({ evidenceLevel: "A", amountCents: 100n }),
        fact({ id: "fact-b", sourceBusinessId: "source-b", evidenceLevel: "B", amountCents: 200n }),
        fact({
          id: "fact-c",
          sourceBusinessId: "source-c",
          evidenceLevel: "C",
          amountCents: 999n,
          confirmedAt: "2026-03-01T00:00:00.000Z",
          factKind: "historical_gap",
          impacts: [{ id: "gap-cost", impactKind: "confirmed_cost", amountCents: 999n, direction: "increase" }]
        })
      ],
      riskByProject: []
    });

    expect(result.evidence).toEqual(expect.objectContaining({
      A: { factCount: 1, amountCents: "100" },
      B: { factCount: 1, amountCents: "200" },
      C: { factCount: 1, amountCents: "999" },
      gapFactCount: 1,
      gapAmountCents: "999"
    }));
    expect(result.asOf.retroactiveFactCount).toBe(1);
    expect(result.profitAndLoss.currentOperatingProfitCents).toBe("0");
    expect(result.integrity.moneyComplete).toBe(true);
  });

  it.each(["legacy_unmodeled", "integrity_conflict"] as const)(
    "fails closed for risk-sensitive money on %s reconciliation",
    (relationshipCompleteness) => {
      const result = reduceOperatingProjection({
        scope: { kind: "project", projectIds: ["project-1"], projectId: "project-1" },
        readAt: "2026-09-11T00:00:00.000Z",
        cutoffAt: "2026-09-11T00:00:00.000Z",
        facts: [fact({ impacts: [{ id: "cash", impactKind: "construction_enterprise_funds_increase", amountCents: 500n, direction: "increase" }] })],
        riskByProject: [{
          projectId: "project-1",
          relationshipCompleteness,
          openPendingGrossCents: null,
          openCoveredCents: null,
          openUncoveredCents: null,
          continuedWithheldRetainedCents: null,
          coveredWithheldSources: [],
          items: []
        }]
      });

      expect(result.restrictions.openUncoveredReconciliationCents).toBeNull();
      expect(result.distribution).toEqual({
        cashCeilingCents: null,
        projectedProfitCeilingCents: "0",
        currentDistributableProfitCents: null
      });
      expect(result.integrity.moneyComplete).toBe(false);
    }
  );

  it("fails closed when #275 aggregate risk cannot be reconciled to its public breakdown", () => {
    const result = reduceOperatingProjection({
      scope: { kind: "project", projectIds: ["project-1"], projectId: "project-1" },
      readAt: "2026-09-11T00:00:00.000Z",
      cutoffAt: "2026-09-11T00:00:00.000Z",
      facts: [],
      riskByProject: [{
        projectId: "project-1",
        relationshipCompleteness: "coverage_incomplete",
        openPendingGrossCents: 100n,
        openCoveredCents: 75n,
        openUncoveredCents: 25n,
        continuedWithheldRetainedCents: 10n,
        coveredWithheldSources: [{
          openCoveredCents: 75n,
          continuedRetainedCents: 10n
        }],
        items: [{
          openAmountCents: 99n,
          openCoveredCents: 75n,
          openUncoveredCents: 24n,
          status: "open"
        }]
      }]
    });

    expect(result.integrity.moneyComplete).toBe(false);
    expect(result.integrity.notices).toContain(
      "待核对风险汇总与逐项明细不一致，风险敏感金额不得展示。"
    );
    expect(result.restrictions.openPendingReconciliationGrossCents).toBeNull();
    expect(result.restrictions.relationshipCompleteness).toBe("integrity_conflict");
    expect(result.clearingRiskDetails).toEqual([]);
    expect(result.clearingRiskSourceDrilldown).toEqual([]);
    expect(toOperatingProjectionAggregate(result).sources).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceTypeLabel: "施工企业清分" })
      ])
    );
    expect(result.distribution.cashCeilingCents).toBeNull();
  });

  it("fails closed when #275 covered-source totals disagree with the aggregate", () => {
    const result = reduceOperatingProjection({
      scope: { kind: "project", projectIds: ["project-1"], projectId: "project-1" },
      readAt: "2026-09-11T00:00:00.000Z",
      cutoffAt: "2026-09-11T00:00:00.000Z",
      facts: [],
      riskByProject: [{
        projectId: "project-1",
        relationshipCompleteness: "coverage_incomplete",
        openPendingGrossCents: 100n,
        openCoveredCents: 75n,
        openUncoveredCents: 25n,
        continuedWithheldRetainedCents: 10n,
        coveredWithheldSources: [{
          openCoveredCents: 74n,
          continuedRetainedCents: 10n
        }],
        items: [{
          openAmountCents: 100n,
          openCoveredCents: 75n,
          openUncoveredCents: 25n,
          status: "open"
        }]
      }]
    });

    expect(result.integrity.moneyComplete).toBe(false);
    expect(result.restrictions.relationshipCompleteness).toBe("integrity_conflict");
    expect(result.restrictions.openCoveredReconciliationCents).toBeNull();
    expect(result.clearingRiskDetails).toEqual([]);
    expect(result.clearingRiskSourceDrilldown).toEqual([]);
  });

  it("fails closed on unknown impact metadata instead of treating it as zero", () => {
    const result = reduceOperatingProjection({
      scope: { kind: "project", projectIds: ["project-1"], projectId: "project-1" },
      readAt: "2026-09-11T00:00:00.000Z",
      cutoffAt: "2026-09-11T00:00:00.000Z",
      facts: [fact({
        evidenceLevel: "Z",
        impacts: [{ id: "unknown", impactKind: "unknown_impact", amountCents: 10n, direction: "sideways" }]
      })],
      riskByProject: []
    });

    expect(result.integrity.moneyComplete).toBe(false);
    expect(result.integrity.notices).toEqual(expect.arrayContaining([
      expect.stringContaining("未知证据等级"),
      expect.stringContaining("未知经营影响")
    ]));
    expect(result.distribution.currentDistributableProfitCents).toBeNull();
  });

  it("applies source and cost-category filters to detail, summary, and drill-down together", () => {
    const result = reduceOperatingProjection({
      scope: {
        kind: "project",
        projectIds: ["project-1"],
        projectId: "project-1",
        filters: { sourceType: "expense_claim", costCategoryCode: "project_management" }
      },
      readAt: "2026-09-11T00:00:00.000Z",
      cutoffAt: "2026-09-11T00:00:00.000Z",
      facts: [fact({
        sourceType: "expense_claim",
        sourceBusinessId: "expense-1",
        sourceBusinessCode: "BX-001",
        factKind: "expense",
        impacts: [
          { id: "management", impactKind: "confirmed_cost", amountCents: 80n, direction: "increase", costCategoryCode: "project_management" },
          { id: "material", impactKind: "confirmed_cost", amountCents: 20n, direction: "increase", costCategoryCode: "material" }
        ]
      }), fact({ sourceType: "other_source", sourceBusinessId: "other", sourceBusinessCode: "QT-001" })],
      riskByProject: []
    });

    expect(result.profitAndLoss.currentOperatingProfitCents).toBe("-80");
    expect(result.details).toHaveLength(1);
    expect(result.sourceDrilldown).toEqual([expect.objectContaining({
      sourceType: "expense_claim",
      sourceBusinessId: "expense-1",
      signedImpactCents: "80"
    })]);
  });

  it("publishes execution totals by public source reference for compatibility readers", () => {
    const result = reduceOperatingProjection({
      scope: { kind: "project", projectIds: ["project-1"], projectId: "project-1" },
      readAt: "2026-09-11T00:00:00.000Z",
      cutoffAt: "2026-09-11T00:00:00.000Z",
      facts: [fact({
        sourceType: "payment_execution",
        sourceBusinessId: "execution-1",
        sourceSnapshot: { paymentRequestId: "payment-1" },
        impacts: [{
          id: "cash-out",
          impactKind: "company_project_funds_decrease",
          amountCents: 120n,
          direction: "decrease"
        }]
      })],
      riskByProject: []
    });

    expect(result.sourceReferenceTotals).toEqual([{
      sourceReferenceId: "payment-1",
      confirmedProjectOutflowCents: "120"
    }]);
  });

  it("keeps notice-only contract commitments monetary without treating invoice references as cash", () => {
    const result = reduceOperatingProjection({
      scope: { kind: "project", projectIds: ["project-1"], projectId: "project-1" },
      readAt: "2026-09-11T00:00:00.000Z",
      cutoffAt: "2026-09-11T00:00:00.000Z",
      facts: [fact({
        factKind: "downstream_contract",
        amountCents: 500n,
        impacts: [
          {
            id: "commitment",
            impactKind: "contract_commitment_reference",
            amountCents: 500n,
            direction: "notice"
          },
          {
            id: "invoice",
            impactKind: "invoice_reference",
            amountCents: 300n,
            direction: "notice"
          }
        ]
      })],
      riskByProject: []
    });

    expect(result.integrity.moneyComplete).toBe(true);
    expect(result.commitments.contractCommitmentCents).toBe("500");
    expect(result.details.map((detail) => detail.signedImpactCents)).toEqual(["500", null]);
    expect(result.actualFunds.netProjectCashPositionCents).toBe("0");
  });

  it("matches company-version aliases per impact without widening the whole fact", () => {
    const result = reduceOperatingProjection({
      scope: {
        kind: "company",
        projectIds: ["project-1"],
        companyEntityId: "company-entity-1",
        filters: { companyEntityId: "company-entity-1" }
      },
      companyEntityVersionIds: ["company-version-1"],
      readAt: "2026-09-11T00:00:00.000Z",
      cutoffAt: "2026-09-11T00:00:00.000Z",
      facts: [fact({
        sourceType: "project_cash_restriction",
        subjectReferences: [
          { kind: "participating_company", id: "company-version-1" },
          { kind: "construction_enterprise", id: "enterprise-v1" }
        ],
        impacts: [
          {
            id: "company-impact",
            impactKind: "company_advance_for_project_increase",
            amountCents: 50n,
            direction: "increase",
            subjectKind: "participating_company",
            subjectId: "company-version-1"
          },
          {
            id: "enterprise-impact",
            impactKind: "construction_enterprise_funds_freeze",
            amountCents: 20n,
            direction: "increase",
            subjectKind: "construction_enterprise",
            subjectId: "enterprise-v1"
          }
        ]
      })],
      riskByProject: []
    });

    expect(result.details).toEqual([
      expect.objectContaining({
        impactId: "company-impact",
        subjectId: "company-version-1"
      })
    ]);
    expect(result.actualFunds.companyAdvanceForProjectCents).toBe("50");
    expect(result.restrictions.constructionEnterpriseFrozenFundsCents).toBe("0");
  });

  it("computes usable cash only from holders selected by the company filter", () => {
    const result = reduceOperatingProjection({
      scope: {
        kind: "company",
        projectIds: ["project-1"],
        companyEntityId: "company-a",
        filters: { companyEntityId: "company-a" }
      },
      companyEntityVersionIds: ["company-a-v1"],
      holderAliases: [
        { projectId: "project-1", kind: "participating_company", id: "company-a-v1", canonicalId: "company-a" },
        { projectId: "project-1", kind: "participating_company", id: "company-b-v1", canonicalId: "company-b" }
      ],
      readAt: "2026-09-11T00:00:00.000Z",
      cutoffAt: "2026-09-11T00:00:00.000Z",
      facts: [fact({
        impacts: [
          { id: "company-a-cash", impactKind: "company_project_funds_increase", amountCents: 80n, direction: "increase", subjectKind: "participating_company", subjectId: "company-a-v1" },
          { id: "company-b-cash", impactKind: "company_project_funds_increase", amountCents: 120n, direction: "increase", subjectKind: "participating_company", subjectId: "company-b-v1" }
        ]
      })],
      riskByProject: []
    });

    expect(result.actualFunds.companyProjectFundsCents).toBe("80");
    expect(result.actualFunds.nonNegativeUsableCashStartCents).toBe("80");
  });

  it("deduplicates holder aliases deterministically and rejects conflicting canonical mappings", () => {
    const duplicate = {
      projectId: "project-1",
      kind: "participating_company" as const,
      id: "company-version-1",
      canonicalId: "company-1"
    };
    expect(() => reduceOperatingProjection({
      scope: { kind: "project", projectIds: ["project-1"], projectId: "project-1" },
      readAt: "2026-09-11T00:00:00.000Z",
      cutoffAt: "2026-09-11T00:00:00.000Z",
      facts: [],
      riskByProject: [],
      holderAliases: [duplicate, duplicate]
    })).not.toThrow();

    const conflicting = [
      duplicate,
      { ...duplicate, canonicalId: "company-2" }
    ];
    expect(() => reduceOperatingProjection({
      scope: { kind: "project", projectIds: ["project-1"], projectId: "project-1" },
      readAt: "2026-09-11T00:00:00.000Z",
      cutoffAt: "2026-09-11T00:00:00.000Z",
      facts: [],
      riskByProject: [],
      holderAliases: conflicting
    })).toThrow(ProjectionResourceBudgetExceededError);
    expect(() => new OperatingProjectionStreamAccumulator({
      scope: { kind: "project", projectIds: ["project-1"], projectId: "project-1" },
      cutoffAt: "2026-09-11T00:00:00.000Z",
      holderAliases: conflicting,
      maxHolderAliases: 10
    })).toThrow(ProjectionResourceBudgetExceededError);
  });

  it("keeps C-level cash outside holder balances and distribution", () => {
    const result = reduceOperatingProjection({
      scope: { kind: "project", projectIds: ["project-1"], projectId: "project-1" },
      readAt: "2026-09-11T00:00:00.000Z",
      cutoffAt: "2026-09-11T00:00:00.000Z",
      holderAliases: [{
        projectId: "project-1",
        kind: "construction_enterprise",
        id: "enterprise-v1",
        canonicalId: "enterprise-v1"
      }],
      facts: [fact({
        evidenceLevel: "C",
        amountCents: 500n,
        impacts: [{
          id: "c-level-cash",
          impactKind: "construction_enterprise_funds_increase",
          amountCents: 500n,
          direction: "increase",
          subjectKind: "construction_enterprise",
          subjectId: "enterprise-v1"
        }]
      })],
      riskByProject: []
    });

    expect(result.actualFunds.constructionEnterpriseFundsCents).toBe("0");
    expect(result.actualFunds.nonNegativeUsableCashStartCents).toBe("0");
    expect(result.distribution.cashCeilingCents).toBe("0");
  });

  it("derives the default business date in China Standard Time", () => {
    const result = reduceOperatingProjection({
      scope: { kind: "project", projectIds: ["project-1"], projectId: "project-1" },
      readAt: "2026-09-10T17:00:00.000Z",
      cutoffAt: "2026-09-10T17:00:00.000Z",
      facts: [],
      riskByProject: []
    });

    expect(result.asOf.businessDate).toBe("2026-09-11");
  });

  it("keeps distinct source types separate even when their display labels fall back", () => {
    const result = reduceOperatingProjection({
      scope: { kind: "project", projectIds: ["project-1"], projectId: "project-1" },
      readAt: "2026-09-11T00:00:00.000Z",
      cutoffAt: "2026-09-11T00:00:00.000Z",
      facts: [
        fact({
          id: "source-a-fact",
          sourceType: "future_source_a",
          sourceBusinessId: "source-a",
          impacts: [{ id: "source-a-impact", impactKind: "confirmed_income", amountCents: 10n, direction: "increase" }]
        }),
        fact({
          id: "source-b-fact",
          sourceType: "future_source_b",
          sourceBusinessId: "source-b",
          impacts: [{ id: "source-b-impact", impactKind: "confirmed_income", amountCents: 20n, direction: "increase" }]
        })
      ],
      riskByProject: []
    });

    const fallbackSources = result.sourceDrilldown.filter(
      (row) => row.sourceTypeLabel === "其他正式来源"
    );
    expect(fallbackSources).toHaveLength(2);
    expect(toOperatingProjectionAggregate(result).sources).toHaveLength(2);
    expect(result.operating.confirmedIncomeCents).toBe("30");
  });

  it("does not double-deduct one holder's negative cash from another holder's usable cash", () => {
    const result = reduceOperatingProjection({
      scope: { kind: "project", projectIds: ["project-1"], projectId: "project-1" },
      readAt: "2026-09-11T00:00:00.000Z",
      cutoffAt: "2026-09-11T00:00:00.000Z",
      facts: [fact({
        amountCents: 1_000n,
        impacts: [
          { id: "income", impactKind: "confirmed_income", amountCents: 1_000n, direction: "increase" },
          { id: "enterprise-cash", impactKind: "construction_enterprise_funds_increase", amountCents: 100n, direction: "increase", subjectKind: "construction_enterprise", subjectId: "enterprise-v1" },
          { id: "company-a-cash", impactKind: "company_project_funds_increase", amountCents: 80n, direction: "increase", subjectKind: "participating_company", subjectId: "company-a" },
          { id: "company-b-cash", impactKind: "company_project_funds_decrease", amountCents: 60n, direction: "decrease", subjectKind: "participating_company", subjectId: "company-b" },
          { id: "company-b-advance", impactKind: "company_advance_for_project_increase", amountCents: 60n, direction: "increase", subjectKind: "participating_company", subjectId: "company-b" }
        ]
      })],
      riskByProject: []
    });

    expect(result.actualFunds).toEqual(expect.objectContaining({
      companyProjectFundsCents: "20",
      netProjectCashPositionCents: "120",
      nonNegativeUsableCashStartCents: "180",
      companyAdvanceForProjectCents: "60"
    }));
    expect(result.distribution.cashCeilingCents).toBe("120");
    expect(result.distribution.currentDistributableProfitCents).toBe("120");
  });

  it("validates #279 restriction source contracts and fails closed on drift, replacement overage, or holder overdraw", () => {
    const cashFact = fact({
      id: "cash-fact",
      sourceBusinessId: "cash-source",
      amountCents: 200n,
      impacts: [
        { id: "income", impactKind: "confirmed_income", amountCents: 200n, direction: "increase" },
        { id: "cash", impactKind: "construction_enterprise_funds_increase", amountCents: 100n, direction: "increase", subjectKind: "construction_enterprise", subjectId: "enterprise-v1" }
      ]
    });
    const holderAliases = [{
      projectId: "project-1",
      kind: "construction_enterprise" as const,
      id: "enterprise-v1",
      canonicalId: "enterprise-v1"
    }];
    const project = (
      facts: ProjectionFactInput[],
      restrictionSources: ProjectionRestrictionSourceInput[]
    ) => reduceOperatingProjection({
      scope: { kind: "project", projectIds: ["project-1"], projectId: "project-1" },
      readAt: "2026-09-11T00:00:00.000Z",
      cutoffAt: "2026-09-11T00:00:00.000Z",
      facts: [cashFact, ...facts],
      riskByProject: [],
      holderAliases,
      restrictionSources
    });

    const validEntry = reserveFact({
      id: "reserve-fact",
      entryId: "reserve-entry-1",
      impactId: "reserve-impact-1",
      amountCents: 30n
    });
    const valid = project([validEntry], [reserveSource({
      entryId: "reserve-entry-1",
      amountCents: 30n
    })]);
    expect(valid.integrity.moneyComplete).toBe(true);
    expect(valid.restrictions.necessaryExpenseReserveCents).toBe("30");
    expect(valid.distribution.currentDistributableProfitCents).toBe("70");

    const driftEntry = reserveFact({
      id: "reserve-drift-fact",
      entryId: "reserve-drift-entry",
      impactId: "reserve-drift-impact",
      amountCents: 30n
    });
    const fingerprintDrift = project([driftEntry], [reserveSource({
      entryId: "reserve-drift-entry",
      amountCents: 30n,
      fingerprint: "authoritative-source-drift"
    })]);
    expect(fingerprintDrift.integrity.moneyComplete).toBe(false);
    expect(fingerprintDrift.restrictions.relationshipCompleteness).toBe("integrity_conflict");
    expect(fingerprintDrift.distribution.currentDistributableProfitCents).toBeNull();

    const targetFact = fact({
      id: "target-fact",
      sourceBusinessId: "target-source",
      sourceType: "expense_claim",
      impacts: [{
        id: "target-cost",
        impactKind: "confirmed_cost",
        amountCents: 20n,
        direction: "increase"
      }]
    });
    const originalEntry = reserveFact({
        id: "reserve-original-fact",
        entryId: "reserve-original-entry",
        impactId: "reserve-original-impact",
        amountCents: 30n
      });
    const replacementImpacts = [{
      operatingImpactEntryId: "target-cost",
      amountCents: "31"
    }];
    const releaseEntry = reserveFact({
        id: "reserve-release-fact",
        entryId: "reserve-release-entry",
        impactId: "reserve-release-impact",
        amountCents: 30n,
        entryKind: "release",
        adjustsEntryId: "reserve-original-entry",
        replacementImpacts
      });
    const replacementOverage = project(
      [targetFact, originalEntry, releaseEntry],
      [
        reserveSource({
          entryId: "reserve-original-entry",
          amountCents: 30n
        }),
        reserveSource({
          entryId: "reserve-release-entry",
          amountCents: 30n,
          entryKind: "release",
          adjustsEntryId: "reserve-original-entry",
          replacementImpacts
        })
      ]
    );
    expect(replacementOverage.integrity.moneyComplete).toBe(false);
    expect(replacementOverage.integrity.notices).toEqual(expect.arrayContaining([
      expect.stringContaining("替代金额超过释放金额")
    ]));

    const overdrawEntry = reserveFact({
      id: "reserve-overdraw-fact",
      entryId: "reserve-overdraw-entry",
      impactId: "reserve-overdraw-impact",
      amountCents: 120n
    });
    const holderOverdraw = project([overdrawEntry], [reserveSource({
      entryId: "reserve-overdraw-entry",
      amountCents: 120n
    })]);
    expect(holderOverdraw.integrity.moneyComplete).toBe(false);
    expect(holderOverdraw.integrity.notices).toEqual(expect.arrayContaining([
      expect.stringContaining("超过同一持有主体")
    ]));
  });

  it("keeps another holder's invalid restriction outside a filtered company view", () => {
    const result = reduceOperatingProjection({
      scope: {
        kind: "company",
        projectIds: ["project-1"],
        companyEntityId: "company-a",
        filters: { companyEntityId: "company-a" }
      },
      companyEntityVersionIds: ["company-a-v1"],
      holderAliases: [
        {
          projectId: "project-1",
          kind: "participating_company",
          id: "company-a-v1",
          canonicalId: "company-a"
        },
        {
          projectId: "project-1",
          kind: "construction_enterprise",
          id: "enterprise-b-v1",
          canonicalId: "enterprise-b-v1"
        }
      ],
      readAt: "2026-09-11T00:00:00.000Z",
      cutoffAt: "2026-09-11T00:00:00.000Z",
      facts: [
        fact({
          id: "company-a-cash-fact",
          sourceBusinessId: "company-a-cash",
          impacts: [{
            id: "company-a-cash-impact",
            impactKind: "company_project_funds_increase",
            amountCents: 80n,
            direction: "increase",
            subjectKind: "participating_company",
            subjectId: "company-a-v1"
          }]
        }),
        reserveFact({
          id: "enterprise-b-invalid-reserve-fact",
          entryId: "enterprise-b-invalid-reserve",
          impactId: "enterprise-b-invalid-reserve-impact",
          amountCents: 120n
        })
      ],
      riskByProject: []
    });

    expect(result.integrity).toEqual(expect.objectContaining({
      moneyComplete: true,
      status: "complete"
    }));
    expect(result.actualFunds.companyProjectFundsCents).toBe("80");
    expect(result.restrictions.necessaryExpenseReserveCents).toBe("0");
  });

  it("uses unfiltered holder cash when a #279 source filter selects the restriction", () => {
    const cashFact = fact({
      id: "cash-support-fact",
      sourceBusinessId: "cash-support-source",
      amountCents: 100n,
      impacts: [{
        id: "cash-support-impact",
        impactKind: "construction_enterprise_funds_increase",
        amountCents: 100n,
        direction: "increase",
        subjectKind: "construction_enterprise",
        subjectId: "enterprise-v1"
      }]
    });
    const restriction = reserveFact({
      id: "reserve-filtered-fact",
      entryId: "reserve-filtered-entry",
      impactId: "reserve-filtered-impact",
      amountCents: 30n
    });
    const result = reduceOperatingProjection({
      scope: {
        kind: "project",
        projectIds: ["project-1"],
        projectId: "project-1",
        filters: { sourceType: "project_necessary_expense_reserve_entry" }
      },
      readAt: "2026-09-11T00:00:00.000Z",
      cutoffAt: "2026-09-11T00:00:00.000Z",
      facts: [cashFact, restriction],
      riskByProject: [],
      holderAliases: [{
        projectId: "project-1",
        kind: "construction_enterprise",
        id: "enterprise-v1",
        canonicalId: "enterprise-v1"
      }],
      restrictionSources: [reserveSource({
        entryId: "reserve-filtered-entry",
        amountCents: 30n
      })]
    });

    expect(result.integrity.moneyComplete).toBe(true);
    expect(result.restrictions.relationshipCompleteness).toBe("complete");
    expect(result.restrictions.necessaryExpenseReserveCents).toBe("30");
    expect(result.actualFunds.constructionEnterpriseFundsCents).toBe("0");
    expect(result.sourceDrilldown).toEqual([
      expect.objectContaining({
        sourceType: "project_necessary_expense_reserve_entry",
        signedImpactCents: "30"
      })
    ]);
  });

  it("uses same-holder cash support without disclosing it through a subject filter", () => {
    const cashFact = fact({
      id: "subject-filter-cash-fact",
      sourceBusinessId: "subject-filter-cash-source",
      amountCents: 100n,
      impacts: [{
        id: "subject-filter-cash-impact",
        impactKind: "construction_enterprise_funds_increase",
        amountCents: 100n,
        direction: "increase",
        subjectKind: "construction_enterprise",
        subjectId: "enterprise-v1"
      }]
    });
    const restriction = {
      ...reserveFact({
        id: "subject-filter-reserve-fact",
        entryId: "subject-filter-reserve-entry",
        impactId: "subject-filter-reserve-impact",
        amountCents: 30n
      }),
      subjectReferences: [
        { kind: "construction_enterprise", id: "enterprise-v1" },
        { kind: "counterparty", id: "counterparty-1" }
      ]
    };
    const result = reduceOperatingProjection({
      scope: {
        kind: "project",
        projectIds: ["project-1"],
        projectId: "project-1",
        filters: { counterpartyId: "counterparty-1" }
      },
      readAt: "2026-09-11T00:00:00.000Z",
      cutoffAt: "2026-09-11T00:00:00.000Z",
      facts: [cashFact, restriction],
      riskByProject: [],
      holderAliases: [{
        projectId: "project-1",
        kind: "construction_enterprise",
        id: "enterprise-v1",
        canonicalId: "enterprise-v1"
      }],
      restrictionSources: [reserveSource({
        entryId: "subject-filter-reserve-entry",
        amountCents: 30n
      })]
    });

    expect(result.integrity.moneyComplete).toBe(true);
    expect(result.restrictions.relationshipCompleteness).toBe("complete");
    expect(result.restrictions.necessaryExpenseReserveCents).toBe("30");
    expect(result.actualFunds.constructionEnterpriseFundsCents).toBe("0");
    expect(result.sourceDrilldown).toEqual([
      expect.objectContaining({
        sourceType: "project_necessary_expense_reserve_entry",
        signedImpactCents: "30"
      })
    ]);
  });

  it("fails before retaining restriction coordinates beyond the configured hard budget", () => {
    const restriction = reserveFact({
      id: "budget-fact",
      entryId: "budget-entry",
      impactId: "budget-impact",
      amountCents: 1n
    });
    const accumulator = new OperatingProjectionStreamAccumulator({
      scope: { kind: "project", projectIds: ["project-1"], projectId: "project-1" },
      cutoffAt: "2026-09-11T00:00:00.000Z",
      maxIntegrityFacts: 0,
      maxIntegrityImpacts: 1
    });

    accumulator.startFacts([restriction]);
    accumulator.addImpacts(restriction.impacts.map((impact) => ({
      ...impact,
      factId: restriction.id
    })));
    expect(() => accumulator.finishFacts()).toThrow(
      ProjectionResourceBudgetExceededError
    );
  });

  it("fails before retaining unbounded holder aliases or source-reference totals", () => {
    expect(() => new OperatingProjectionStreamAccumulator({
      scope: { kind: "project", projectIds: ["project-1"], projectId: "project-1" },
      cutoffAt: "2026-09-11T00:00:00.000Z",
      maxHolderAliases: 0,
      holderAliases: [{
        projectId: "project-1",
        kind: "construction_enterprise",
        id: "enterprise-v1",
        canonicalId: "enterprise-v1"
      }]
    })).toThrow(ProjectionResourceBudgetExceededError);

    const holderAccumulator = new OperatingProjectionStreamAccumulator({
      scope: { kind: "project", projectIds: ["project-1"], projectId: "project-1" },
      cutoffAt: "2026-09-11T00:00:00.000Z",
      maxHolderCoordinates: 1
    });
    const holderFacts = ["enterprise-1", "enterprise-2"].map((holder, index) => fact({
      id: `holder-fact-${index}`,
      affiliateBusinessPartyVersionId: holder,
      impacts: [{
        id: `holder-impact-${index}`,
        impactKind: "construction_enterprise_funds_increase",
        amountCents: 1n,
        direction: "increase",
        subjectKind: "construction_enterprise",
        subjectId: holder
      }]
    }));
    holderAccumulator.startFacts(holderFacts);
    expect(() => holderAccumulator.addImpacts(holderFacts.flatMap((value) =>
      value.impacts.map((impact) => ({ ...impact, factId: value.id }))
    ))).toThrow(ProjectionResourceBudgetExceededError);

    const accumulator = new OperatingProjectionStreamAccumulator({
      scope: { kind: "project", projectIds: ["project-1"], projectId: "project-1" },
      cutoffAt: "2026-09-11T00:00:00.000Z",
      collectSourceReferenceTotals: true,
      maxSourceReferenceTotals: 1
    });
    accumulator.startFacts([
      fact({ id: "source-reference-1", sourceSnapshot: { paymentRequestId: "payment-1" } }),
      fact({ id: "source-reference-2", sourceSnapshot: { paymentRequestId: "payment-2" } })
    ]);
    expect(() => accumulator.finishFacts()).toThrow(
      ProjectionResourceBudgetExceededError
    );
  });

  it("retains every authoritative coordinate required after compact streaming", () => {
    const cash = fact({
      id: "stream-cash-fact",
      impacts: [{
        id: "stream-cash-impact",
        impactKind: "construction_enterprise_funds_increase",
        amountCents: 100n,
        direction: "increase",
        subjectKind: "construction_enterprise",
        subjectId: "enterprise-v1"
      }]
    });
    const restriction = reserveFact({
      id: "stream-reserve-fact",
      entryId: "stream-reserve-entry",
      impactId: "stream-reserve-impact",
      amountCents: 30n
    });
    const scope = {
      kind: "project" as const,
      projectIds: ["project-1"],
      projectId: "project-1"
    };
    const holderAliases = [{
      projectId: "project-1",
      kind: "construction_enterprise" as const,
      id: "enterprise-v1",
      canonicalId: "enterprise-v1"
    }];
    const accumulator = new OperatingProjectionStreamAccumulator({
      scope,
      cutoffAt: "2026-09-11T00:00:00.000Z",
      holderAliases,
      maxIntegrityFacts: 10,
      maxIntegrityImpacts: 10
    });
    for (const value of [cash, restriction]) {
      accumulator.startFacts([value]);
      accumulator.addImpacts(value.impacts.map((impact) => ({
        ...impact,
        factId: value.id
      })));
      accumulator.finishFacts();
    }
    const streamed = accumulator.result();
    const result = reduceOperatingProjection({
      scope,
      readAt: "2026-09-11T00:00:00.000Z",
      cutoffAt: "2026-09-11T00:00:00.000Z",
      facts: [],
      aggregateSeed: streamed.aggregateSeed,
      integrityFacts: streamed.integrityFacts,
      restrictionCashContext: streamed.restrictionCashContext,
      riskByProject: [],
      holderAliases,
      restrictionSources: [reserveSource({
        entryId: "stream-reserve-entry",
        amountCents: 30n
      })]
    });

    expect(result.integrity.moneyComplete).toBe(true);
    expect(result.restrictions.relationshipCompleteness).toBe("complete");
    expect(result.restrictions.necessaryExpenseReserveCents).toBe("30");
  });
});
