import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("project funding allocation schema", () => {
  const schema = readFileSync(
    join(process.cwd(), "prisma/schema.prisma"),
    "utf8"
  );
  const migrationPath = join(
    process.cwd(),
    "prisma/migrations/20260728120000_project_funding_allocation/migration.sql"
  );

  it("defines one append-only execution funding ledger shared by every payment source", () => {
    expect(schema).toMatch(/model ProjectFundingAllocation \{/u);
    expect(schema).toMatch(/executionType\s+String/u);
    expect(schema).toMatch(/executionId\s+String/u);
    expect(schema).toMatch(/sourceType\s+String/u);
    expect(schema).toMatch(/sourceKey\s+String/u);
    expect(schema).toMatch(/direction\s+String/u);
    expect(schema).toMatch(/reversalOfAllocationId\s+String\?/u);
    expect(schema).toMatch(/reversalKey\s+String\s+@default\("original"\)/u);
    expect(schema).toMatch(
      /@@unique\(\[executionType, executionId, sourceKey, direction, reversalKey\]/u
    );
  });

  it("adds constraints and indexes without rewriting existing business data", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration.trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/u);
    expect(migration).toContain('CREATE TABLE "ProjectFundingAllocation"');
    expect(migration).toContain(
      'CONSTRAINT "ProjectFundingAllocation_amount_positive_check" CHECK ("amountCents" > 0)'
    );
    expect(migration).toContain(
      'CONSTRAINT "ProjectFundingAllocation_direction_check" CHECK ("direction" IN (\'debit\', \'credit\'))'
    );
    expect(migration).toContain(
      'CONSTRAINT "ProjectFundingAllocation_projectId_fkey"'
    );
    expect(migration).toContain(
      'CONSTRAINT "ProjectFundingAllocation_sourceId_fkey"'
    );
    expect(migration).not.toMatch(
      /^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/imu
    );
  });
});
