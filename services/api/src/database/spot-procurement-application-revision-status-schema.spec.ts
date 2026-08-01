import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("spot procurement application revision-status database guard", () => {
  const lifecycleStatuses = [
    "draft",
    "approval_pending",
    "returned",
    "withdrawn",
    "rejected",
    "approved",
    "invalidated",
    "abandoned"
  ];
  const migrationPath = join(
    process.cwd(),
    "prisma/migrations/20260728161000_spot_procurement_application_revision_status/migration.sql"
  );
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

  it("replaces the version status check with the complete revision lifecycle", () => {
    expect(migration).toContain(
      'ADD CONSTRAINT "SpotProcurementVersion_status_check_next"'
    );
    expect(migration).toContain(
      'VALIDATE CONSTRAINT "SpotProcurementVersion_status_check_next"'
    );
    expect(migration).toContain(
      'DROP CONSTRAINT "SpotProcurementVersion_status_check"'
    );
    expect(migration).toMatch(
      /RENAME CONSTRAINT "SpotProcurementVersion_status_check_next"\s+TO "SpotProcurementVersion_status_check"/u
    );

    const constraintStart = migration.indexOf(
      'ADD CONSTRAINT "SpotProcurementVersion_status_check_next"'
    );
    const constraintEnd = migration.indexOf("NOT VALID;", constraintStart);
    const constraintSql = migration.slice(constraintStart, constraintEnd);
    expect(
      Array.from(
        constraintSql.matchAll(/'([^']+)'/gu),
        (match) => match[1]
      )
    ).toEqual(lifecycleStatuses);

    const scanStart = migration.indexOf('WHERE "status" NOT IN');
    const scanEnd = migration.indexOf(")\n  ) THEN", scanStart);
    const scanSql = migration.slice(scanStart, scanEnd);
    expect(
      Array.from(scanSql.matchAll(/'([^']+)'/gu), (match) => match[1])
    ).toEqual(lifecycleStatuses);
  });

  it("fails closed on incompatible retained facts and never mutates business rows", () => {
    expect(migration).toMatch(/^BEGIN;/u);
    expect(migration).toContain("pg_get_constraintdef");
    expect(migration).toContain(
      "unexpected SpotProcurementVersion_status_check definition"
    );
    expect(migration).toContain("expected_status");
    expect(migration).toContain("literal_count");
    expect(migration).toContain("unexpected_literal_definition");
    expect(migration).toContain("normalized_definition");
    expect(migration).toContain(
      "CHECK((status=ANY(ARRAY[''draft''::text"
    );
    expect(migration).toContain(
      "''invalidated''::text,''abandoned''::text])))NOTVALID'"
    );
    expect(migration).toContain("spot_procurement_version_status_invalid");
    expect(migration).toContain("pg_try_advisory_xact_lock");
    expect(migration).toContain("LOCK TABLE");
    expect(migration).toContain("NOWAIT");
    expect(migration).toMatch(/COMMIT;\s*$/u);
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/iu);
    expect(migration).not.toMatch(/DROP\s+(?:TABLE|COLUMN)\b/iu);
  });
});
