import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(__dirname, "../../prisma/migrations/20260827270000_pol12a_wage_statement_source_and_versions/migration.sql"),
  "utf8"
);

describe("POL-12A wage schema guardrails", () => {
  it("binds each approved source to a private FileObject and each allocation to a source-controlled service basis", () => {
    expect(migration).toContain('FOREIGN KEY ("evidenceFileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT');
    expect(migration).toContain('CREATE TABLE "WageServiceBasisBinding"');
    expect(migration).toContain('FOREIGN KEY ("sourceVersionId") REFERENCES "WageApprovedSourceVersion"("id") ON DELETE RESTRICT');
    expect(migration).toContain('FOREIGN KEY ("serviceBasisBindingId") REFERENCES "WageServiceBasisBinding"("id") ON DELETE RESTRICT');
    expect(migration).toContain('"WageServiceBasisBinding_source_project_service_key"');
  });

  it("keeps a returned submitted revision superseded while projecting its review-return disposition", () => {
    expect(migration).toContain('"reviewDisposition" TEXT');
    expect(migration).toContain('"WageStatementVersion_status_check" CHECK ("status" IN (\'draft\', \'submitted\', \'confirmed\', \'superseded\'))');
    expect(migration).toContain('"WageStatementVersion_review_disposition_check" CHECK ("reviewDisposition" IS NULL OR "reviewDisposition" = \'review_returned\')');
  });

  it("rejects negative wage amounts and uncontrolled component or creditor codes at the database boundary", () => {
    for (const constraint of [
      "WagePersonLine_approved_amount_nonnegative_check",
      "WageCostComponent_amount_nonnegative_check",
      "WageProjectAllocation_amount_nonnegative_check",
      "WageCreditorBreakdown_amount_nonnegative_check",
      "WageCostComponent_code_check",
      "WageCreditorBreakdown_category_check"
    ]) {
      expect(migration).toContain(constraint);
    }
  });

  it("accepts only canonical calendar months for approved sources and monthly statements", () => {
    expect(migration).toContain(
      '"WageApprovedSourceVersion_wage_month_check" CHECK ("wageMonth" ~ \'^[0-9]{4}-(0[1-9]|1[0-2])$\')'
    );
    expect(migration).toContain(
      '"WageStatement_wage_month_check" CHECK ("wageMonth" ~ \'^[0-9]{4}-(0[1-9]|1[0-2])$\')'
    );
  });
});
