import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("incidental expense classification schema", () => {
  const schema = readFileSync(
    join(process.cwd(), "prisma/schema.prisma"),
    "utf8"
  );
  const migrationPath = join(
    process.cwd(),
    "prisma/migrations/20260728124000_incidental_expense_classification/migration.sql"
  );

  it("adds an explicit incidental expense category to the new expense domain", () => {
    expect(schema).toMatch(
      /model ExpenseClaim \{[\s\S]*incidentalExpenseCategory\s+String\?/u
    );
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration.trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/u);
    expect(migration).toContain(
      "CHECK (\"claimType\" IN ('reimbursement', 'loan', 'incidental_expense'))"
    );
    expect(migration).toContain("'temporary_service'");
    expect(migration).toContain("'temporary_machinery_shift'");
    expect(migration).toContain("'sporadic_labor'");
    expect(migration).toContain("'other_incidental'");
    expect(migration).toContain('"projectId" IS NOT NULL');
  });

  it("is forward-only and does not rewrite or delete historical expense facts", () => {
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).not.toMatch(
      /^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP TABLE)\b/imu
    );
  });
});
