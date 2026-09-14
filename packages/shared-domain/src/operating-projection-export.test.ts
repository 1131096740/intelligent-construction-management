import { describe, expect, it } from "vitest";
import { OPERATING_FACT_KINDS, OPERATING_IMPACT_KINDS } from "./project-operating-contracts";
import { OPERATING_SOURCE_TYPES, OPERATING_EXPORT_SOURCE_KINDS, OPERATING_EXPORT_FACT_KINDS,
  OPERATING_EXPORT_IMPACT_KINDS, OPERATING_PROJECTION_RISK_IMPACTS,
  operatingProjectionExportMatches } from "./operating-projection-export";

describe("operating projection export contract", () => {
  it("requires an explicit frozen classification for every known source, fact, impact and synthetic risk", () => {
    expect(Object.keys(OPERATING_EXPORT_SOURCE_KINDS).sort()).toEqual([...OPERATING_SOURCE_TYPES].sort());
    expect(Object.keys(OPERATING_EXPORT_FACT_KINDS).sort())
      .toEqual([...OPERATING_FACT_KINDS, "clearing_reconciliation_risk"].sort());
    expect(Object.keys(OPERATING_EXPORT_IMPACT_KINDS).sort())
      .toEqual([...OPERATING_IMPACT_KINDS, ...OPERATING_PROJECTION_RISK_IMPACTS].sort());
    for (const map of [OPERATING_EXPORT_SOURCE_KINDS, OPERATING_EXPORT_FACT_KINDS, OPERATING_EXPORT_IMPACT_KINDS]) {
      expect(Object.isFrozen(map)).toBe(true);
      for (const values of Object.values(map)) expect(Object.isFrozen(values)).toBe(true);
    }
  });
  it("keeps all impacts in the ledger while preserving distinct cash, company and history views", () => {
    for (const impact of OPERATING_IMPACT_KINDS) {
      expect(operatingProjectionExportMatches("project_operating_ledger_detail", "owner_settlement",
        "owner_settlement", impact, "A")).toBe(true);
    }
    expect(operatingProjectionExportMatches("company_project_funds_subledger", "fund_movement",
      "fund_movement", "construction_enterprise_funds_decrease", "A")).toBe(false);
    expect(operatingProjectionExportMatches("receivable_payable_cashflow_detail", "owner_settlement",
      "owner_settlement", "confirmed_income", "A")).toBe(false);
    expect(operatingProjectionExportMatches("takeover_coverage_evidence_gap", "operating_takeover",
      "owner_settlement", "confirmed_income", "B")).toBe(true);
    expect(operatingProjectionExportMatches("construction_enterprise_funds_reconciliation", "clearing_event_version",
      "clearing_reconciliation_risk", "clearing_open_reconciliation_risk", null)).toBe(true);
  });
  it("does not silently accept unknown values or inherited property names", () => {
    for (const value of ["new_kind", "constructor", "__proto__"]) {
      expect(operatingProjectionExportMatches("project_operating_ledger_detail", value, "expense", "confirmed_cost", "A")).toBeNull();
      expect(operatingProjectionExportMatches("project_operating_ledger_detail", "expense_claim", value, "confirmed_cost", "A")).toBeNull();
      expect(operatingProjectionExportMatches("project_operating_ledger_detail", "expense_claim", "expense", value, "A")).toBeNull();
    }
  });
});
