import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("project financing quota lifecycle schema", () => {
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const migrationPath = join(
    process.cwd(),
    "prisma/migrations/20260728123000_project_financing_quota_lifecycle/migration.sql"
  );

  it("makes expiry optional and records an immutable termination receipt", () => {
    expect(schema).toMatch(/model ProjectFinancingQuota \{[\s\S]*validUntil\s+DateTime\?/u);
    expect(schema).toMatch(/model ProjectFinancingQuota \{[\s\S]*terminatedAt\s+DateTime\?/u);
    expect(schema).toMatch(/model ProjectFinancingQuota \{[\s\S]*terminatedByUserId\s+String\?/u);
    expect(schema).toMatch(/model ProjectFinancingQuota \{[\s\S]*terminationReason\s+String\?/u);
    expect(schema).toMatch(
      /model ProjectFinancingQuota \{[\s\S]*terminationSignatureFileId\s+String\?/u
    );
    expect(schema).toMatch(
      /model ProjectFinancingQuota \{[\s\S]*terminationSignatureSha256\s+String\?/u
    );
    expect(schema).toMatch(
      /model ProjectFinancingQuota \{[\s\S]*terminationSignatureVersionId\s+String\?/u
    );
  });

  it("adds the terminated state with all-or-none termination facts and no data deletion", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration.trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/u);
    expect(migration).toContain('ALTER COLUMN "validUntil" DROP NOT NULL');
    expect(migration).toContain(
      "CHECK (\"status\" IN ('approval_pending', 'approved', 'rejected', 'terminated'))"
    );
    expect(migration).toContain(
      'CONSTRAINT "ProjectFinancingQuota_termination_facts_check"'
    );
    expect(migration).not.toMatch(/^\s*(?:DELETE|TRUNCATE|DROP TABLE)\b/imu);
  });
});
