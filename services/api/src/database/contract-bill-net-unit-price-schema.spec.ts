import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("contract bill net unit price schema", () => {
  const schema = readFileSync(
    join(process.cwd(), "prisma/schema.prisma"),
    "utf8"
  );
  const migrationPath = join(
    process.cwd(),
    "prisma/migrations/20260728110000_contract_bill_net_unit_price/migration.sql"
  );

  it("stores the derived net unit price as a nullable six-decimal fact", () => {
    expect(schema).toMatch(
      /model ContractBillRow \{[\s\S]*taxExclusiveUnitPrice\s+Decimal\?\s+@db\.Decimal\(24,\s*6\)/u
    );
  });

  it("adds only the nullable column without guessing a historical backfill", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration.trim()).toMatch(/^BEGIN;[\s\S]*COMMIT;$/u);
    expect(migration).toMatch(
      /ALTER TABLE "ContractBillRow"\s+ADD COLUMN "taxExclusiveUnitPrice" DECIMAL\(24,\s*6\);/u
    );
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE|TRUNCATE|DROP)\b/iu);
    expect(migration).not.toMatch(
      /"taxExclusiveUnitPrice"[^;]*(?:NOT NULL|DEFAULT)/iu
    );
  });

  it("keeps aggregate totals independent from the derived display unit price", () => {
    const totals = readFileSync(
      join(process.cwd(), "src/contract-bill/contract-bill-totals.ts"),
      "utf8"
    );
    const reducer = totals.slice(
      totals.indexOf("const totals = rows.reduce"),
      totals.indexOf("await tx.contractBill.update")
    );
    expect(reducer).not.toContain("taxExclusiveUnitPrice");
    expect(reducer).toContain("row.taxInclusiveAmountCents");
    expect(reducer).toContain("row.taxExclusiveAmountCents");
    expect(reducer).toContain("row.taxAmountCents");
  });
});
