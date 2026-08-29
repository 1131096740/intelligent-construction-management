import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const apiRoot = resolve(__dirname, "../..");
const schema = readFileSync(resolve(apiRoot, "prisma/schema.prisma"), "utf8");
const migrationName = "20260829090000_pol13c_fund_movement";
const migrationPath = resolve(
  apiRoot,
  "prisma/migrations",
  migrationName,
  "migration.sql"
);

function readMigration() {
  return readFileSync(migrationPath, "utf8");
}

function model(name: string) {
  return schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, "u"))?.[1] ?? "";
}

describe("POL-13C fund movement schema", () => {
  it("declares an isolated forward-only migration with the required models", () => {
    const migration = readMigration();
    expect(migration).toMatch(/BEGIN;/u);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u);
    expect(migration).toContain("POL-13C");
    expect(migration).toContain('CREATE TABLE "FundMovement"');
    expect(migration).toContain('CREATE TABLE "FundMovementLeg"');
    expect(migration).toContain('CREATE TABLE "FundMovementRelationshipEntry"');
    expect(migration).toContain('CREATE TABLE "FundMovementCommandReceipt"');
    expect(migration).toContain('"FundMovement_payment_execution_unique"');
    expect(migration).toContain('"FundMovementLeg_relationship_entry_unique"');
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN)\b/iu);
    expect(migration).not.toMatch(/^\s*(?:TRUNCATE|DELETE\s+FROM)\b/imu);
  });

  it("keeps the aggregate and leg scope closed and rejects quarantine", () => {
    const migration = readMigration();
    expect(migration).toMatch(
      /FundMovement_kind_check[\s\S]*?cross_project_payment[\s\S]*?same_project_company_transfer[\s\S]*?temporary_project_fund_use[\s\S]*?temporary_project_fund_return[\s\S]*?company_advance[\s\S]*?company_advance_recovery[\s\S]*?profit_distribution_execution/u
    );
    expect(migration).not.toMatch(/'quarantine'/u);
    expect(migration).toContain('"FundMovement_status_check"');
    expect(migration).toContain('"FundMovementLeg_role_check"');
    expect(migration).toContain('"FundMovementLeg_direction_check"');
    expect(migration).toContain('"FundMovementRelationshipEntry_entry_kind_check"');
    expect(migration).toContain('"FundMovementRelationshipEntry_direction_check"');
  });

  it("enforces positive amounts, explicit decomposition and JSON object snapshots", () => {
    const migration = readMigration();
    expect(migration).toContain('"FundMovement_amount_check"');
    expect(migration).toContain('"FundMovement_amount_conservation_check"');
    expect(migration).toContain('"FundMovementLeg_amount_check"');
    expect(migration).toContain('"FundMovementLeg_amount_conservation_check"');
    expect(migration).toContain('"FundMovementLeg_source_snapshot_check"');
    expect(migration).toContain('jsonb_typeof("sourceSnapshot") = \'object\'');
    expect(migration).toContain('"FundMovementRelationshipEntry_source_snapshot_check"');
    expect(migration).toContain('"FundMovementRelationshipEntry_amount_check"');
    expect(migration).toContain('FundMovement_revision_must_increase');
    expect(migration).toContain('leg."projectFundUsedCents" IS DISTINCT FROM movement."projectFundUsedCents"');
    expect(migration).toContain('source_leg."relationshipEntryId"');
  });

  it("links each confirmed leg to exactly one same-project OperatingFact", () => {
    const migration = readMigration();
    expect(model("FundMovementLeg")).toMatch(/operatingFactId\s+String\?/u);
    expect(model("FundMovementLeg")).toMatch(/operatingFact\s+OperatingFact\?/u);
    expect(model("OperatingFact")).toContain("fundMovementLegs");
    expect(migration).toContain('"FundMovementLeg_operating_fact_fkey"');
    expect(migration).toContain('"FundMovementLeg_operating_fact_unique"');
    expect(migration).toContain("fund_movement_operating_fact_scope_invalid");
    expect(migration).toContain("fund_movement_confirmed_leg_operating_fact_required");
  });

  it("makes lifecycle and evidence append-only with fail-closed SoD", () => {
    const migration = readMigration();
    expect(migration).toContain("assert_fund_movement_write_context");
    expect(migration).toContain('"OperatingLedgerWriteContext"');
    expect(migration).toContain('"backendPid" = pg_backend_pid()');
    expect(migration).toContain('"transactionId" = txid_current()');
    expect(migration).toContain("require_fund_movement_write_context");
    expect(migration).toContain('"FundMovement_require_write_context"');
    expect(migration).toContain('"FundMovementLeg_require_write_context"');
    expect(migration).toContain('"FundMovementRelationshipEntry_require_write_context"');
    expect(migration).toContain('"FundMovementCommandReceipt_require_write_context"');
    expect(migration).toMatch(
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE\s+ON TABLE "FundMovement", "FundMovementLeg",\s+"FundMovementRelationshipEntry", "FundMovementCommandReceipt"\s+FROM PUBLIC;/u
    );
    expect(migration).toMatch(
      /CREATE FUNCTION assert_fund_movement_write_context\(\)[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = pg_catalog, public/u
    );
    expect(migration).toMatch(
      /CREATE FUNCTION require_fund_movement_write_context\(\)[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = pg_catalog, public/u
    );
    expect(migration).toContain("guard_fund_movement_lifecycle");
    expect(migration).toContain("FundMovement_insert_forces_draft");
    expect(migration).toContain("FundMovement_confirmed_immutable");
    expect(migration).toContain("FundMovement_invalid_transition");
    expect(migration).toContain("guard_fund_movement_leg_immutable");
    expect(migration).toContain("guard_fund_movement_relationship_immutable");
    expect(migration).toContain("fund_movement_sod_invalid");
    expect(migration).toContain("fund_movement_relationship_sod_invalid");
    expect(migration).toContain("fund_movement_cross_project_lineage_invalid");
    expect(migration).toContain("DEFERRABLE INITIALLY DEFERRED");
  });

  it("does not allow child evidence to outlive the parent draft lifecycle", () => {
    const migration = readMigration();
    expect(migration).toMatch(
      /IF TG_OP = 'INSERT' AND movement_status <> 'draft'[\s\S]*?fund_movement_leg_insert_requires_draft/u
    );
    expect(migration).toMatch(
      /IF NEW\."status" = 'confirmed' AND movement_status <> 'submitted'[\s\S]*?fund_movement_relationship_parent_transition_invalid/u
    );
    expect(migration).toContain('NEW."submittedByUserId" IS DISTINCT FROM OLD."submittedByUserId"');
    expect(migration).toContain('NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt"');
    expect(migration).toContain("fund_movement_operating_fact_requires_confirmed_movement");
    expect(migration).toContain("app.fund_movement_snapshot_projection");
    expect(migration).toContain("fund_movement_snapshot_projection_requires_confirmation");
  });

  it("binds cross-project payment and relationship source coordinates", () => {
    const migration = readMigration();
    expect(migration).toContain('execution."paymentRequestId"');
    expect(migration).toContain('request_project_id IS DISTINCT FROM movement."beneficiaryProjectId"');
    expect(migration).toContain('request_contract_id IS DISTINCT FROM source_leg_contract_id');
    expect(migration).toContain('request_contract_version_id IS DISTINCT FROM source_leg_contract_version_id');
    expect(migration).toContain('request_settlement_id IS DISTINCT FROM execution_settlement_id');
    expect(migration).toContain('source_leg_source_aggregate_id');
    expect(migration).toContain('leg."sourceAggregateId" IS DISTINCT FROM source_leg_source_aggregate_id');
    expect(migration).toContain('relationship."sourceAggregateId" IS DISTINCT FROM source_leg."sourceAggregateId"');
    expect(migration).toContain('relationship."contractVersionId" IS DISTINCT FROM source_leg."contractVersionId"');
  });

  it("locks original relationships and confirmed adjustments before balance checks", () => {
    const migration = readMigration();
    expect(migration).toMatch(
      /FROM "FundMovementRelationshipEntry" relationship[\s\S]*?FOR UPDATE;/u
    );
    expect(migration).toMatch(
      /adjustment\."status" = 'confirmed'[\s\S]*?FOR UPDATE;/u
    );
  });

  it("keeps payable registry and fund movement settlement locks in one order", () => {
    const movement = readFileSync(
      resolve(apiRoot, "src/fund-movement/fund-movement.service.ts"),
      "utf8"
    );
    const registry = readFileSync(
      resolve(apiRoot, "src/payable-registry/payable-registry.service.ts"),
      "utf8"
    );
    const movementSection = movement.slice(
      movement.indexOf("private async lockAndValidatePayableSettlement")
    );
    const registrySection = registry.slice(
      registry.indexOf("private async lockSettlementContext")
    );
    for (const section of [movementSection, registrySection]) {
      expect(section.indexOf('FROM "WagePayableRef"')).toBeGreaterThanOrEqual(0);
      expect(section.indexOf('FROM "PayableSettlementCase"')).toBeGreaterThanOrEqual(0);
      expect(section.indexOf('FROM "PayableSettlementAllocation"')).toBeGreaterThanOrEqual(0);
      expect(section.indexOf('FROM "WagePayableRef"')).toBeLessThan(
        section.indexOf('FROM "PayableSettlementCase"')
      );
      expect(section.indexOf('FROM "PayableSettlementCase"')).toBeLessThan(
        section.indexOf('FROM "PayableSettlementAllocation"')
      );
    }
  });

  it("retains source, contract and allocation snapshots and strict foreign keys", () => {
    const migration = readMigration();
    expect(model("FundMovementLeg")).toMatch(/sourceType\s+String\?/u);
    expect(model("FundMovementLeg")).toMatch(/sourceAggregateId\s+String\?/u);
    expect(model("FundMovementLeg")).toMatch(/sourceAllocationCount\s+Int\?/u);
    expect(model("FundMovementLeg")).toMatch(/sourceAllocationAmountCents\s+BigInt\?/u);
    expect(model("FundMovementLeg")).toMatch(/contractId\s+String\?/u);
    expect(model("FundMovementLeg")).toMatch(/contractVersionId\s+String\?/u);
    expect(migration).toContain('"FundMovement_payment_execution_fkey"');
    expect(model("FundMovement")).toMatch(/@@unique\(\[paymentExecutionId\]/u);
    expect(migration).toContain('"FundMovement_source_project_fkey"');
    expect(migration).toContain('"FundMovement_beneficiary_project_fkey"');
    expect(migration).toContain('"FundMovement_source_company_fkey"');
    expect(migration).toContain('"FundMovement_beneficiary_company_fkey"');
    expect(migration).toContain('"FundMovement_created_by_fkey"');
    expect(migration).toContain('"FundMovementLeg_created_by_fkey"');
    expect(migration).toContain('"FundMovementRelationshipEntry_created_by_fkey"');
  });
});
