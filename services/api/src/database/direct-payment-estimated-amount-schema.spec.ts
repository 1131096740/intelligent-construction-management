import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("direct payment estimated amount schema", () => {
  const schema = readFileSync(
    join(process.cwd(), "prisma/schema.prisma"),
    "utf8"
  );
  const migrationPath = join(
    process.cwd(),
    "prisma/migrations/20260728125500_direct_payment_estimated_amount/migration.sql"
  );

  it("stores a nullable estimate separately from the legal contract amount", () => {
    expect(schema).toMatch(
      /model ContractVersion \{[\s\S]*amountCents\s+BigInt[\s\S]*estimatedAmountCents\s+BigInt\?/u
    );
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration.trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/u);
    expect(migration).toContain('"estimatedAmountCents" BIGINT');
    expect(migration).toContain(
      '"ContractVersion_estimated_amount_nonnegative_check"'
    );
  });

  it("is forward-only and does not rewrite existing contract versions", () => {
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).not.toMatch(
      /^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP TABLE)\b/imu
    );
  });
});
