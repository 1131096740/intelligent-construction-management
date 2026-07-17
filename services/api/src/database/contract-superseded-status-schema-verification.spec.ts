import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("contract superseded status database guard", () => {
  const migrationPath = join(
    process.cwd(),
    "prisma/migrations/20260715150000_contract_superseded_status_constraints/migration.sql"
  );
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

  it.each([
    {
      table: "ContractVersion",
      constraint: "ContractVersion_status_check",
      statuses: [
        "draft",
        "in_approval",
        "approval_rejected",
        "approved_pending_seal",
        "in_seal",
        "seal_approved_pending_archive",
        "pending_archive_confirm",
        "effective",
        "superseded",
        "voided"
      ]
    },
    {
      table: "PaymentTermsVersion",
      constraint: "PaymentTermsVersion_status_check",
      statuses: ["draft", "effective", "superseded", "voided"]
    }
  ])("preserves the complete allowed status set in $constraint", ({ table, constraint, statuses }) => {
    expect(migration).toMatch(
      new RegExp(
        `ALTER TABLE "${table}"\\s+DROP CONSTRAINT "${constraint}";[\\s\\S]*?` +
          `ALTER TABLE "${table}"\\s+ADD CONSTRAINT "${constraint}"\\s+` +
          `CHECK\\s*\\(\\s*"status" IN \\([\\s\\S]*?'superseded'[\\s\\S]*?\\)\\s*\\) NOT VALID;`,
        "u"
      )
    );

    const constraintStart = migration.indexOf(`ADD CONSTRAINT "${constraint}"`);
    const constraintEnd = migration.indexOf("NOT VALID;", constraintStart);
    const constraintSql = migration.slice(constraintStart, constraintEnd);
    expect(Array.from(constraintSql.matchAll(/'([^']+)'/gu), (match) => match[1])).toEqual(statuses);
  });

  it("applies both constraint replacements atomically and contains no data mutation", () => {
    expect(migration).toMatch(/^BEGIN;/u);
    expect(migration).toMatch(/COMMIT;\s*$/u);
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/iu);
    expect(migration).not.toMatch(/DROP\s+(?:TABLE|COLUMN)\b/iu);
  });
});
