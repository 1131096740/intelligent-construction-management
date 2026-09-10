import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(root, "prisma/migrations/20260910170000_pol279_necessary_expense_reserve/migration.sql"),
  "utf8"
);

describe("POL-15P1 necessary expense reserve schema", () => {
  it("defines the root, append-only entries and exact replacement links", () => {
    expect(schema).toContain("model ProjectNecessaryExpenseReserve {");
    expect(schema).toContain("model ProjectNecessaryExpenseReserveEntry {");
    expect(schema).toContain("model ProjectNecessaryExpenseReserveReplacement {");
    expect(schema).toContain("model ProjectNecessaryExpenseReserveCommandReceipt {");
    expect(migration).toContain('CREATE TABLE "ProjectNecessaryExpenseReserve"');
    expect(migration).toContain('CREATE TABLE "ProjectNecessaryExpenseReserveEntry"');
    expect(migration).toContain('CREATE TABLE "ProjectNecessaryExpenseReserveReplacement"');
    expect(migration).toContain('CREATE TRIGGER "ProjectNecessaryExpenseReserveEntry_confirmed_immutable"');
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain('DROP CONSTRAINT "OperatingFact_fact_kind_check"');
    expect(migration).toContain("'project_cash_restriction'");
    expect(migration).toContain('DROP CONSTRAINT "OperatingImpactEntry_impact_kind_check"');
    expect(migration).toContain("'necessary_expense_reserve_increase'");
    expect(migration).toContain("'necessary_expense_reserve_decrease'");
    expect(migration).toContain('DROP CONSTRAINT "OperatingImpactEntry_subject_check"');
    expect(migration).toContain('DROP CONSTRAINT "OperatingImpactEntry_supported_subject_check"');
    expect(migration).toContain("'fund_holder'");
  });

  it("keeps source money CNY-only, A/B-only and replacement capacity fail-closed", () => {
    expect(migration).toContain("'establish', 'increase', 'release', 'technical_reversal'");
    expect(migration).toContain("'draft', 'submitted', 'attested', 'confirmed', 'returned'");
    expect(migration).toContain("'A', 'B'");
    expect(migration).toContain('"currencyCode" = \'CNY\'');
    expect(migration).toContain("POL-279 replacement allocation exceeds release amount");
    expect(migration).toContain("POL-279 replacement must reference a confirmed formal deduction impact");
    expect(migration).toContain("POL-279 reserve root identity is immutable");
    expect(migration).toContain("POL-279 reserve description is frozen outside its sole editable draft");
    expect(migration).toContain("REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE");
    expect(migration).toContain('CREATE TRIGGER "ProjectNecessaryExpenseReserveCommandReceipt_immutable"');
    expect(migration).toContain("POL-279 first reserve entry must establish the reserve");
    expect(migration).toContain("POL-279 reserve establishment must be confirmed before an increase");
  });

  it("maps every custom relation, unique constraint and index name to the migration", () => {
    expect(schema).toContain('map: "ProjectNecessaryExpenseReserve_project_fkey"');
    expect(schema).toContain('map: "ProjectNecessaryExpenseReserve_assignment_fkey"');
    expect(schema).toContain('map: "ProjectNecessaryExpenseReserve_project_business_key"');
    expect(schema).toContain('map: "ProjectNecessaryExpenseReserveEntry_reserve_sequence_key"');
    expect(schema).toContain('map: "ProjectNecessaryExpenseReserveEntry_evidence_file_fkey"');
    expect(schema).toContain('map: "ProjectNecessaryExpenseReserveReplacement_entry_impact_key"');
    expect(schema).toContain('map: "ProjectNecessaryExpenseReserveCommandReceipt_entry_action_idx"');
  });
});
