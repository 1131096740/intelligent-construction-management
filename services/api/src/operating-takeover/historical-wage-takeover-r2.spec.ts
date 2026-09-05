import {
  historicalWageSummarySelectionSnapshot,
  parseHistoricalWageSummaryAuthority
} from "./historical-wage-takeover-r2";

const HASH = "a".repeat(64);

describe("POL219 B-FP/V1-R2 source authority parser", () => {
  const coordinate = (rowNumber: string) => ({
    sourceObjectSha256: HASH,
    worksheetName: "历史工资表",
    rowNumber,
    columnNumber: null,
    normalizedRowSha256: "b".repeat(64)
  });

  function balanceSummary() {
    return {
      schemaVersion: 1,
      sourceDiscriminator: "historical_wage_summary",
      sourceObjectId: "legacy-wage-1",
      sourceObjectCoordinate: coordinate("12"),
      originalSourceVersion: "V1",
      originalBusinessNumber: " WAGE-2026-08 ",
      asOfDate: "2026-08-31",
      basisDate: null,
      sourceHeader: {
        employmentCompanyId: "company-1",
        employmentCompanyNameSnapshot: "工资承担公司",
        employmentCompanyCreditCodeSnapshot: "913100000000000001",
        projectId: "project-1",
        projectCodeSnapshot: "P-1",
        projectNameSnapshot: "项目一",
        wageMonth: "2026-08",
        catalogVersion: "historical_wage_position_category_v1",
        positionCategoryCode: "engineering_technical",
        positionCategoryLabelSnapshot: "工程技术人员"
      },
      originalControlledScopeDescription: null,
      evidence: [{ fileObjectId: "file-source-1", contentSha256: "c".repeat(64), evidenceCoordinate: coordinate("12") }],
      sourceDeclarerSnapshot: { externalIdentityId: "source-declarer-1" },
      sourceEvidenceReviewerSnapshot: {
        externalIdentityId: "source-reviewer-1",
        evidence: [{ fileObjectId: "file-source-1", contentSha256: "c".repeat(64), evidenceCoordinate: coordinate("12") }]
      },
      sourceVersionFingerprint: null as string | null,
      lines: [{
        creditorCategoryCode: "employee_net_pay",
        creditorCategoryLabel: "员工实发工资",
        creditorIdentityKind: "aggregate_creditor_scope",
        creditorPartyVersionId: null,
        controlledScopeCode: "employees",
        controlledScopeDescription: null,
        controlledScopeEvidenceCoordinate: null,
        grossDebtCents: "1000",
        historicallySettledCents: "0",
        outstandingBalanceCents: "1000",
        debtStatus: "outstanding",
        target: {
          kind: "historical_wage_balance_reconciliation_version",
          reconciliationAuthorityVersionId: "balance-authority-1",
          reconciliationReference: " BAL-2026-08-1 ",
          schemaVersion: 1,
          sourceVersionFingerprint: null,
          reconciliationFingerprint: null as string | null,
          asOfDate: "2026-08-31",
          employmentCompanyId: "company-1",
          employmentCompanyNameSnapshot: "工资承担公司",
          employmentCompanyCreditCodeSnapshot: "913100000000000001",
          projectId: "project-1",
          projectCodeSnapshot: "P-1",
          projectNameSnapshot: "项目一",
          wageMonth: "2026-08",
          catalogVersion: "historical_wage_position_category_v1",
          positionCategoryCode: "engineering_technical",
          positionCategoryLabelSnapshot: "工程技术人员",
          wageCreditorCategoryCode: "employee_net_pay",
          wageCreditorCategoryLabelSnapshot: "员工实发工资",
          currencyCode: "CNY",
          debtStatus: "outstanding",
          grossDebtCents: "1000",
          historicallySettledCents: "0",
          outstandingBalanceCents: "1000",
          evidence: [{ fileObjectId: "file-balance-1", contentSha256: "d".repeat(64), evidenceCoordinate: coordinate("13") }],
          supportingPaymentExecutions: []
        }
      }],
      assignedWageExclusions: [],
      assignedWageExclusionSetFingerprint: null as string | null
    };
  }

  it("recomputes source/target-set fingerprints and returns a normalized complete closure", () => {
    const parsed = parseHistoricalWageSummaryAuthority(balanceSummary());

    expect(parsed).toEqual(expect.objectContaining({
      sourceVersionFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      assignedWageExclusionSetFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
      sourceDiscriminator: "historical_wage_summary",
      employmentCompanyId: "company-1",
      projectId: "project-1",
      wageMonth: "2026-08",
      lines: [expect.objectContaining({
        creditorCategoryCode: "employee_net_pay",
        creditorIdentityKind: "aggregate_creditor_scope",
        targetBusinessKey: "balance-authority-1",
        target: expect.objectContaining({
          kind: "historical_wage_balance_reconciliation_version",
          reservedTargetId: null,
          reconciliationFingerprint: null,
          sourceVersionFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u)
        })
      })]
    }));
    expect(historicalWageSummarySelectionSnapshot(parsed!)).toEqual(expect.objectContaining({
      schemaVersion: 1,
      sourceVersionFingerprint: parsed!.sourceVersionFingerprint,
      sourceVersionPayload: parsed!.sourceVersionPayload,
      assignedWageExclusionSetFingerprint: parsed!.assignedWageExclusionSetFingerprint
    }));

    const differentDeclarer = balanceSummary();
    differentDeclarer.sourceDeclarerSnapshot = { externalIdentityId: "post-takeover-actor-must-not-enter-source-fp" };
    const reparsed = parseHistoricalWageSummaryAuthority(differentDeclarer);
    expect(reparsed?.sourceVersionFingerprint).toBe(parsed?.sourceVersionFingerprint);
  });

  it("treats every declared hash as an equality assertion and never trusts it", () => {
    const baseline = parseHistoricalWageSummaryAuthority(balanceSummary())!;
    const claimed = balanceSummary();
    claimed.sourceVersionFingerprint = baseline.sourceVersionFingerprint;
    claimed.assignedWageExclusionSetFingerprint = baseline.assignedWageExclusionSetFingerprint;
    expect(parseHistoricalWageSummaryAuthority(claimed)).not.toBeNull();

    claimed.sourceVersionFingerprint = "f".repeat(64);
    expect(parseHistoricalWageSummaryAuthority(claimed)).toBeNull();
    claimed.sourceVersionFingerprint = baseline.sourceVersionFingerprint;
    claimed.assignedWageExclusionSetFingerprint = "e".repeat(64);
    expect(parseHistoricalWageSummaryAuthority(claimed)).toBeNull();
  });

  it("fails closed on unknown/missing fields, target responsibility mixing, and stable-key duplicates", () => {
    expect(parseHistoricalWageSummaryAuthority({ ...balanceSummary(), confirmedByUserId: "late-attester" })).toBeNull();
    const missing = balanceSummary() as Record<string, unknown>;
    delete missing.basisDate;
    expect(parseHistoricalWageSummaryAuthority(missing)).toBeNull();

    const mixed = balanceSummary();
    mixed.lines[0]!.target.reconciliationFingerprint = "d".repeat(64);
    expect(parseHistoricalWageSummaryAuthority(mixed)).toBeNull();

    const duplicate = balanceSummary();
    duplicate.lines.push({ ...duplicate.lines[0]!, grossDebtCents: "999", outstandingBalanceCents: "999" });
    expect(parseHistoricalWageSummaryAuthority(duplicate)).toBeNull();
  });
});
