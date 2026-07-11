import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("global role assignment database guard", () => {
  const migrationPath = join(
    process.cwd(),
    "prisma/migrations/20260712023000_global_role_assignment_uniqueness/migration.sql"
  );
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

  it("fails closed when duplicate global assignments still exist", () => {
    expect(migration).toContain('FROM "UserPosition"');
    expect(migration).toContain('WHERE "projectId" IS NULL');
    expect(migration).toMatch(/GROUP BY\s+"userId",\s*"positionId"/u);
    expect(migration).toMatch(/HAVING COUNT\(\*\) > 1/u);
    expect(migration).toContain("RAISE EXCEPTION");
  });

  it("adds the exact partial unique index without rewriting role facts", () => {
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "UserPosition_global_user_position_key"'
    );
    expect(migration).toMatch(
      /ON\s+"UserPosition"\s*\(\s*"userId"\s*,\s*"positionId"\s*\)/u
    );
    expect(migration).toMatch(/WHERE\s+"projectId"\s+IS\s+NULL/u);
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/iu);
  });
});
