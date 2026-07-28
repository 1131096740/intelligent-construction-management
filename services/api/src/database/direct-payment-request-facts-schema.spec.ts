import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("direct payment request facts schema", () => {
  const schema = readFileSync(
    join(process.cwd(), "prisma/schema.prisma"),
    "utf8"
  );
  const migrationPath = join(
    process.cwd(),
    "prisma/migrations/20260728125000_direct_payment_request_facts/migration.sql"
  );

  it("stores the payment matter and amount calculation explanation as a pair", () => {
    expect(schema).toMatch(
      /model PaymentRequest \{[\s\S]*paymentMatter\s+String\?[\s\S]*amountCalculationExplanation\s+String\?/u
    );
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration.trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/u);
    expect(migration).toContain(
      '"PaymentRequest_direct_payment_facts_pair_check"'
    );
    expect(migration).toContain('btrim("paymentMatter")');
    expect(migration).toContain('btrim("amountCalculationExplanation")');
  });

  it("is forward-only and does not rewrite or delete existing payment facts", () => {
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).not.toMatch(
      /^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP TABLE)\b/imu
    );
  });
});
