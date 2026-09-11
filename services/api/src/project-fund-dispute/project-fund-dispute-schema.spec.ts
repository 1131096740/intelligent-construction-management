import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(root, "prisma/migrations/20260911140000_pol280_project_fund_dispute/migration.sql"),
  "utf8"
);

describe("POL-15P2 project fund dispute schema", () => {
  it("defines the root, append-only entries, receipts and exact replacement links", () => {
    expect(schema).toContain("model ProjectFundDispute {");
    expect(schema).toContain("model ProjectFundDisputeEntry {");
    expect(schema).toContain("model ProjectFundDisputeReplacement {");
    expect(schema).toContain("model ProjectFundDisputeCommandReceipt {");
    expect(migration).toContain('CREATE TABLE "ProjectFundDispute"');
    expect(migration).toContain('CREATE TABLE "ProjectFundDisputeEntry"');
    expect(migration).toContain('CREATE TABLE "ProjectFundDisputeReplacement"');
    expect(migration).toContain('CREATE TRIGGER "ProjectFundDisputeEntry_confirmed_immutable"');
    expect(migration).toContain('CREATE TRIGGER "ProjectFundDisputeCommandReceipt_immutable"');
    expect(migration).toContain("pg_advisory_xact_lock");
  });

  it("extends only the impact catalog and preserves earlier fact and subject constraints", () => {
    expect(migration).toContain('DROP CONSTRAINT "OperatingImpactEntry_impact_kind_check"');
    expect(migration).toContain("'project_disputed_funds_increase'");
    expect(migration).toContain("'project_disputed_funds_decrease'");
    expect(migration).not.toContain('DROP CONSTRAINT "OperatingFact_fact_kind_check"');
    expect(migration).not.toContain('DROP CONSTRAINT "OperatingImpactEntry_subject_check"');
    expect(migration).not.toContain('DROP CONSTRAINT "OperatingImpactEntry_supported_subject_check"');
  });

  it("keeps A/B CNY money, first-establish ordering and immutable capacity guards fail-closed", () => {
    expect(migration).toContain("'upstream', 'downstream', 'inter_subject', 'external_restriction'");
    expect(migration).toContain("'establish', 'increase', 'release', 'technical_reversal'");
    expect(migration).toContain("'draft', 'submitted', 'attested', 'confirmed', 'returned'");
    expect(migration).toContain("'A', 'B'");
    expect(migration).toContain('"currencyCode" = \'CNY\'');
    expect(migration).toContain("POL-280 first dispute entry must establish the dispute");
    expect(migration).toContain("POL-280 dispute establishment must be confirmed before an increase");
    expect(migration).toContain("POL-280 release or reversal exceeds remaining dispute capacity");
    expect(migration).toContain("POL-280 replacement allocation exceeds formal impact amount");
    expect(migration).toContain("POL-280 dispute root identity is immutable");
    expect(migration).toContain("REVOKE UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE");
  });

  it("shares formal-impact replacement capacity with #279 without widening runtime reads", () => {
    expect(migration).toContain(
      "hashtextextended('pol:formal-impact-replacement:'"
    );
    expect(migration).toContain(
      'FROM public."ProjectNecessaryExpenseReserveReplacement"'
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION "pol279_replacement_guard"() RETURNS trigger'
    );
    expect(migration).toMatch(
      /CREATE FUNCTION "pol280_replacement_guard"\(\) RETURNS trigger\s+LANGUAGE plpgsql\s+SECURITY DEFINER/u
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION "pol279_replacement_guard"\(\) RETURNS trigger\s+LANGUAGE plpgsql\s+SECURITY DEFINER/u
    );
    expect(migration).not.toContain(
      'GRANT SELECT ON TABLE "OperatingImpactEntry", "OperatingFact"'
    );
  });

  it("maps every custom relation, unique constraint and index name to M168", () => {
    expect(schema).toContain('map: "ProjectFundDispute_project_fkey"');
    expect(schema).toContain('map: "ProjectFundDispute_assignment_fkey"');
    expect(schema).toContain('map: "ProjectFundDispute_project_business_key"');
    expect(schema).toContain('map: "ProjectFundDisputeEntry_dispute_sequence_key"');
    expect(schema).toContain('map: "ProjectFundDisputeEntry_evidence_file_fkey"');
    expect(schema).toContain('map: "ProjectFundDisputeReplacement_entry_impact_key"');
    expect(schema).toContain('map: "ProjectFundDisputeCommandReceipt_entry_action_idx"');
  });
});
