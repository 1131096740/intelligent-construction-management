import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(
    __dirname,
    "../../prisma/migrations/20260827280000_pol12b_wage_operating_projection_foundation/migration.sql"
  ),
  "utf8"
);

describe("POL-12B wage operating-projection schema guardrails", () => {
  it("freezes each creditor as exactly one employee user or BusinessPartyVersion", () => {
    // Existing POL-12A frozen rows are retained as legacy-only rows; every new
    // non-null type is forced by the CHECK to have exactly one identity.
    expect(migration).toContain('ADD COLUMN "creditorSubjectType" TEXT');
    expect(migration).toContain('"creditorUserId" TEXT');
    expect(migration).toContain('"creditorBusinessPartyVersionId" TEXT');
    expect(migration).toContain('"WageCreditorBreakdown_creditor_subject_check"');
    expect(migration).toContain('FOREIGN KEY ("creditorUserId") REFERENCES "User"("id") ON DELETE RESTRICT');
    expect(migration).toContain(
      'FOREIGN KEY ("creditorBusinessPartyVersionId") REFERENCES "BusinessPartyVersion"("id") ON DELETE RESTRICT'
    );
    expect(migration).toContain('ADD COLUMN "creditorNameSnapshot" TEXT');
    expect(migration).toContain('"creditorUnifiedIdentitySnapshot" TEXT');
    expect(migration).toContain('ADD COLUMN "creditorVersionFingerprint" TEXT');
    expect(migration).toContain('"creditorNameSnapshot" IS NOT NULL');
    expect(migration).toContain('"creditorVersionFingerprint" IS NOT NULL');
  });

  it("makes both required allocation cross-matrices explicit and nonnegative", () => {
    expect(migration).toContain('CREATE TABLE "WageProjectCostComponentAllocation"');
    expect(migration).toContain('CREATE TABLE "WageProjectCreditorAllocation"');
    expect(migration).toContain('"WageProjectCostComponentAllocation_project_component_key"');
    expect(migration).toContain('"WageProjectCreditorAllocation_project_creditor_key"');
    expect(migration).toContain('"WageProjectCostComponentAllocation_amount_nonnegative_check"');
    expect(migration).toContain('"WageProjectCreditorAllocation_amount_nonnegative_check"');
    expect(migration).toContain('"WageProjectCostComponentAllocation_same_person_line"');
    expect(migration).toContain('"WageProjectCreditorAllocation_same_person_line"');
  });

  it("keeps wage payable references append-only and makes only base identities unique", () => {
    expect(migration).toContain('CREATE TABLE "WagePayableRef"');
    expect(migration).toContain('"confirmedVersionId" TEXT NOT NULL');
    expect(migration).toContain('"adjustsPayableRefId" TEXT');
    expect(migration).toContain('"settlementRecheckRequired" BOOLEAN NOT NULL DEFAULT false');
    expect(migration).toContain('"WagePayableRef_base_identity_key"');
    expect(migration).toContain('WHERE "adjustsPayableRefId" IS NULL');
    expect(migration).toContain('"WagePayableRef_direction_check" CHECK ("direction" IN (\'increase\', \'decrease\'))');
    expect(migration).toContain('"WagePayableRef_adjustment_direction_check"');
    expect(migration).toContain('"WagePayableRef_immutable"');
    expect(migration).toContain('"costBearingCompanyId" TEXT NOT NULL');
    expect(migration).toContain('"WagePayableRef_debtor_cost_bearing_company_check"');
    expect(migration).toContain('"WagePayableRef_endpoints_same_person_and_version"');
    expect(migration).toContain('"WagePayableRef_adjustment_effective_nonnegative"');
    expect(migration).toContain('"WagePayableRef_settlement_recheck_check"');
  });

  it("allows an adjustment only from a later version of the same statement while preserving frozen business identities", () => {
    expect(migration).toContain('SELECT * INTO target_root FROM "WagePayableRef"');
    expect(migration).toContain('WHERE "id" = NEW."adjustsPayableRefId"');
    expect(migration).toContain('WagePayableRef adjustment must directly target an original base reference');
    expect(migration).toContain('target_version."statementId" IS DISTINCT FROM root_version."statementId"');
    expect(migration).toContain('target_version."revision" <= root_version."revision"');
    expect(migration).toContain('WagePayableRef adjustment must target a later version of the same wage statement');
    expect(migration).toContain('new_person."employeeId" IS DISTINCT FROM root_person."employeeId"');
    expect(migration).toContain('new_person."employmentSnapshotId" IS DISTINCT FROM root_person."employmentSnapshotId"');
    expect(migration).toContain('new_creditor."creditorSubjectIdentityKey" IS DISTINCT FROM root_creditor."creditorSubjectIdentityKey"');
    expect(migration).toContain('new_creditor."creditorCategory" IS DISTINCT FROM root_creditor."creditorCategory"');
    expect(migration).toContain('NEW."personSnapshot" IS DISTINCT FROM target_root."personSnapshot"');
    expect(migration).toContain('NEW."creditorSnapshot" IS DISTINCT FROM target_root."creditorSnapshot"');
    expect(migration).toContain('WagePayableRef adjustment must preserve the original debtor, project, person and creditor identity');
    expect(migration).not.toContain('OR NEW."projectAllocationId" IS DISTINCT FROM target_root."projectAllocationId"');
    expect(migration).not.toContain('OR NEW."creditorBreakdownId" IS DISTINCT FROM target_root."creditorBreakdownId"');
  });

  it("freezes confirmed matrix cells and each matrix endpoint against direct mutation", () => {
    expect(migration).toContain('CREATE FUNCTION jg_reject_confirmed_wage_projection_mutation()');
    expect(migration).toContain("confirmed WageStatementVersion projection rows are immutable");
    expect(migration).toContain('"WageCostComponent_confirmed_projection_immutable"');
    expect(migration).toContain('"WageCreditorBreakdown_confirmed_projection_immutable"');
    expect(migration).toContain('"WageProjectAllocation_confirmed_projection_immutable"');
    expect(migration).toContain('"WageProjectCostComponentAllocation_confirmed_projection_immutable"');
    expect(migration).toContain('"WageProjectCreditorAllocation_confirmed_projection_immutable"');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "WageProjectCostComponentAllocation"');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "WageProjectCreditorAllocation"');
  });
});
