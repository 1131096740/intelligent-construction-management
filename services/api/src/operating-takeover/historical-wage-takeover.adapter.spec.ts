import { HistoricalWageTakeoverAdapter } from "./historical-wage-takeover.adapter";

const HASH = "a".repeat(64);

function evidenceCoordinate(rowNumber: string) {
  return {
    sourceObjectSha256: HASH,
    worksheetName: "余额表",
    rowNumber,
    columnNumber: "2",
    normalizedRowSha256: HASH
  };
}

describe("HistoricalWageTakeoverAdapter", () => {
  const adapter = new HistoricalWageTakeoverAdapter();

  it("maps a fully closed approved-person source to an A formal intent without accepting a name as identity", () => {
    const mapped = adapter.map({
      selectionRefFingerprint: HASH,
      grade: "A",
      authority: {
        sourceVersionId: "approved-source-1",
        sourceFingerprint: HASH,
        employmentCompanyId: "company-1",
        wageMonth: "2026-08",
        statementVersionId: "reserved-version-1",
        statementRevision: 1,
        people: [{
          employeeId: "employee-1",
          employmentSnapshotId: "employment-1",
          displayNameSuggestion: "张三",
          projectId: "project-1",
          amountCents: 1200n,
          evidenceSha256: HASH,
          creditorCells: [{
            creditorCategoryCode: "employee_net_pay",
            amountCents: 1200n,
            creditorSubjectType: "employee_user",
            creditorSubjectIdentityKey: "employee:employee-1"
          }]
        }]
      },
      legacy: {
        sourceType: "project_wage",
        sourceBusinessId: "legacy-wage-1",
        sourceVersion: 1,
        sourceFingerprint: HASH,
        projectId: "project-1",
        costImpactId: "cost-impact-1",
        payableImpactId: "payable-impact-1",
        amountCents: 1200n
      }
    });

    expect(mapped).toEqual(expect.objectContaining({
      grade: "A",
      decision: "FORMAL",
      sourceDiscriminator: "wage_statement_version",
      targetKind: "wage_takeover_projection_envelope",
      canonicalStatementVersionId: "reserved-version-1",
      projectIds: ["project-1"]
    }));
    expect(mapped.people[0]).toEqual(expect.objectContaining({ employeeId: "employee-1" }));
    expect(mapped.people[0]).not.toHaveProperty("displayNameSuggestion");
  });

  it("does not apply the B-only historical position catalog to a #105 A person snapshot", () => {
    const mapped = adapter.map({
      selectionRefFingerprint: HASH,
      grade: "A",
      authority: {
        sourceVersionId: "approved-source-1",
        sourceFingerprint: HASH,
        employmentCompanyId: "company-1",
        wageMonth: "2026-08",
        statementVersionId: "reserved-version-1",
        statementRevision: 1,
        people: [{
          employeeId: "employee-1",
          employmentSnapshotId: "employment-1",
          positionCategoryCode: "project_manager",
          projectId: "project-1",
          amountCents: 1200n,
          evidenceSha256: HASH,
          creditorCells: [{
            creditorCategoryCode: "employee_net_pay",
            amountCents: 1200n,
            creditorSubjectType: "employee_user",
            creditorSubjectIdentityKey: "employee:employee-1"
          }]
        }]
      },
      legacy: {
        sourceType: "project_wage",
        sourceBusinessId: "legacy-wage-a-position",
        sourceVersion: 1,
        sourceFingerprint: HASH,
        projectId: "project-1",
        costImpactId: "cost-impact-a-position",
        payableImpactId: "payable-impact-a-position",
        amountCents: 1200n
      }
    });

    expect(mapped).toEqual(expect.objectContaining({ grade: "A", decision: "FORMAL" }));
  });

  it("maps a controlled B summary to a non-payable historical reconciliation ref without inventing a person or payee", () => {
    const mapped = adapter.map({
      selectionRefFingerprint: HASH,
      grade: "B",
      summary: {
        sourceVersionFingerprint: HASH,
        employmentCompanyId: "company-1",
        projectId: "project-1",
        wageMonth: "2026-08",
        catalogVersion: "historical_wage_position_category_v1",
        positionCategoryCode: "engineering_technical",
        positionCategoryLabel: "工程技术人员",
        evidenceCoordinate: evidenceCoordinate("12"),
        lines: [{
          creditorCategoryCode: "employee_net_pay",
          creditorCategoryLabel: "员工实发工资",
          creditorIdentityKind: "aggregate_creditor_scope",
          creditorPartyVersionId: null,
          controlledScopeCode: null,
          controlledScopeDescription: null,
          controlledScopeEvidenceCoordinate: null,
          grossDebtCents: 1500n,
          historicallySettledCents: 500n,
          outstandingBalanceCents: 1000n,
          debtStatus: "partially_settled",
          targetBusinessKey: "balance:reconciliation-1",
          creditorStableKey: "employee-net-pay:balance:reconciliation-1",
          target: {
            kind: "historical_wage_balance_reconciliation_version",
            reconciliationAuthorityVersionId: "reconciliation-1",
            sourceVersionFingerprint: HASH,
            reconciliationFingerprint: null
          }
        }]
      },
      legacy: {
        sourceType: "project_wage",
        sourceBusinessId: "legacy-wage-2",
        sourceVersion: 1,
        sourceFingerprint: HASH,
        projectId: "project-1",
        costImpactId: "cost-impact-2",
        payableImpactId: "payable-impact-2",
        amountCents: 1500n
      }
    });

    expect(mapped).toEqual(expect.objectContaining({
      grade: "B",
      decision: "FORMAL",
      sourceDiscriminator: "historical_wage_summary",
      targetKind: "historical_wage_summary_payable_ref",
      usageScope: "historical_reconciliation_only",
      newPaymentAllowed: false,
      settlementAllocationAllowed: false
    }));
    expect(mapped.summaryLines[0]).not.toHaveProperty("payeeSubjectId");
    expect(mapped.summaryLines[0]).not.toHaveProperty("employeeId");
  });

  it("downgrades a missing canonical employee identity to a C gap instead of guessing a formal target", () => {
    const mapped = adapter.map({
      selectionRefFingerprint: HASH,
      grade: "A",
      authority: {
        sourceVersionId: "approved-source-1",
        sourceFingerprint: HASH,
        employmentCompanyId: "company-1",
        wageMonth: "2026-08",
        statementVersionId: "reserved-version-1",
        statementRevision: 1,
        people: [{
          employeeId: "",
          employmentSnapshotId: "employment-1",
          projectId: "project-1",
          amountCents: 1200n,
          evidenceSha256: HASH,
          creditorCells: [{
            creditorCategoryCode: "employee_net_pay",
            amountCents: 1200n,
            creditorSubjectType: "employee_user",
            creditorSubjectIdentityKey: "employee:employee-1"
          }]
        }]
      },
      legacy: {
        sourceType: "project_wage",
        sourceBusinessId: "legacy-wage-3",
        sourceVersion: 1,
        sourceFingerprint: HASH,
        projectId: "project-1",
        costImpactId: "cost-impact-3",
        payableImpactId: "payable-impact-3",
        amountCents: 1200n
      }
    });

    expect(mapped).toEqual(expect.objectContaining({
      grade: "C",
      decision: "GAP",
      targetKind: "unresolved_wage_payable_gap"
    }));
  });

  it("downgrades an out-of-catalog B position summary to a C gap", () => {
    const mapped = adapter.map({
      selectionRefFingerprint: HASH,
      grade: "B",
      summary: {
        sourceVersionFingerprint: HASH,
        employmentCompanyId: "company-1",
        projectId: "project-1",
        wageMonth: "2026-08",
        catalogVersion: "historical_wage_position_category_v1",
        positionCategoryCode: "other",
        positionCategoryLabel: "其他",
        evidenceCoordinate: evidenceCoordinate("12"),
        lines: [{
          creditorCategoryCode: "employee_net_pay",
          creditorCategoryLabel: "员工实发工资",
          creditorIdentityKind: "aggregate_creditor_scope",
          creditorPartyVersionId: null,
          controlledScopeCode: null,
          controlledScopeDescription: null,
          controlledScopeEvidenceCoordinate: null,
          grossDebtCents: 1200n,
          historicallySettledCents: 0n,
          outstandingBalanceCents: 1200n,
          debtStatus: "outstanding",
          targetBusinessKey: "balance:reconciliation-1",
          creditorStableKey: "employee-net-pay:balance:reconciliation-1",
          target: {
            kind: "historical_wage_balance_reconciliation_version",
            reconciliationAuthorityVersionId: "reconciliation-1",
            sourceVersionFingerprint: HASH,
            reconciliationFingerprint: null
          }
        }]
      },
      legacy: {
        sourceType: "project_wage",
        sourceBusinessId: "legacy-wage-4",
        sourceVersion: 1,
        sourceFingerprint: HASH,
        projectId: "project-1",
        costImpactId: "cost-impact-4",
        payableImpactId: "payable-impact-4",
        amountCents: 1200n
      }
    });

    expect(mapped).toEqual(expect.objectContaining({ grade: "C", decision: "GAP" }));
  });

  it("keeps an explicit zero B snapshot as a controlled tombstone for a legacy reversal", () => {
    const mapped = adapter.map({
      selectionRefFingerprint: HASH,
      grade: "B",
      summary: {
        sourceVersionFingerprint: HASH,
        employmentCompanyId: "company-1",
        projectId: "project-1",
        wageMonth: "2026-08",
        catalogVersion: "historical_wage_position_category_v1",
        positionCategoryCode: "engineering_technical",
        positionCategoryLabel: "工程技术人员",
        evidenceCoordinate: evidenceCoordinate("13"),
        lines: [{
          creditorCategoryCode: "employee_net_pay",
          creditorCategoryLabel: "员工实发工资",
          creditorIdentityKind: "aggregate_creditor_scope",
          creditorPartyVersionId: null,
          controlledScopeCode: null,
          controlledScopeDescription: null,
          controlledScopeEvidenceCoordinate: null,
          grossDebtCents: 0n,
          historicallySettledCents: 0n,
          outstandingBalanceCents: 0n,
          debtStatus: "settled",
          targetBusinessKey: "balance:reconciliation-2",
          creditorStableKey: "employee-net-pay:balance:reconciliation-2",
          target: {
            kind: "historical_wage_balance_reconciliation_version",
            reconciliationAuthorityVersionId: "reconciliation-2",
            sourceVersionFingerprint: HASH,
            reconciliationFingerprint: null
          }
        }]
      },
      legacy: {
        sourceType: "project_wage",
        sourceBusinessId: "legacy-wage-reversal-1",
        sourceVersion: 2,
        sourceFingerprint: HASH,
        projectId: "project-1",
        costImpactId: "cost-impact-reversal-1",
        payableImpactId: "payable-impact-reversal-1",
        amountCents: 1500n,
        entryKind: "reversal",
        direction: "decrease",
        adjustsFactId: "legacy-root-fact-1"
      }
    });

    expect(mapped).toEqual(expect.objectContaining({
      grade: "B",
      decision: "FORMAL",
      usageScope: "historical_reconciliation_only",
      newPaymentAllowed: false,
      settlementAllocationAllowed: false
    }));
    expect(mapped.summaryLines).toEqual([
      expect.objectContaining({ creditorCategoryCode: "employee_net_pay", grossDebtCents: 0n })
    ]);
  });
});
