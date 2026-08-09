import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migrationPath = resolve(
  __dirname,
  "../../prisma/migrations/20260809150000_contract_retention_policy_timestamptz/migration.sql"
);

describe("contract retention policy timezone migration", () => {
  it("converts the existing Shanghai wall-clock value to an absolute instant", () => {
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain(
      'ALTER COLUMN "activatedAt" TYPE TIMESTAMPTZ(3)'
    );
    expect(migration).toContain(
      'USING ("activatedAt" AT TIME ZONE \'Asia/Shanghai\')'
    );
    expect(migration).toContain("SET LOCAL lock_timeout = '5s';");
  });
});
