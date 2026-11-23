import { readFileSync } from "node:fs";
import { join } from "node:path";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20261124010000_expense_claim_line_quantity/migration.sql"
  ),
  "utf8"
);

const model = (name: string) =>
  schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, "u"))?.[1] ?? "";
const normalizedModel = (name: string) => model(name).replace(/[ \t]+/gu, " ");
const normalizedMigration = migration.replace(/\s+/gu, " ");

/**
 * #404 EXP-02：报销明细可填“数量（可空）”。
 * 精度依据：技术方案 D02 规定新协议数量/单价最多 4 位小数并建议 numeric(24,4)。
 * 既有数量列（SettlementLine/SpotProcurementLine/ActualPurchaseBatchLine 等）是
 * 历史 numeric(24,6)，不复制旧口径，也不改写历史值。
 */
describe("expense claim line quantity migration", () => {
  it("adds a nullable 4-decimal quantity column without default or backfill", () => {
    expect(normalizedModel("ExpenseClaimLine")).toContain(
      "quantity Decimal? @db.Decimal(24, 4)"
    );
    expect(migration).toContain(
      'ALTER TABLE "ExpenseClaimLine" ADD COLUMN "quantity" DECIMAL(24,4);'
    );
    expect(migration).not.toMatch(/ADD COLUMN "quantity"[^;]*NOT NULL/u);
    expect(migration).not.toMatch(/ADD COLUMN "quantity"[^;]*DEFAULT/u);
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE)\s+"ExpenseClaimLine"/u);
    expect(migration).not.toMatch(/\b(?:DROP|ALTER)\s+COLUMN\s+"(?:receiptCount|amountCents|expenseCategory)"/u);
  });

  it("keeps zero and negative quantities invalid while allowing NULL", () => {
    expect(normalizedMigration).toContain(
      'CONSTRAINT "ExpenseClaimLine_quantity_positive_check" CHECK ("quantity" IS NULL OR "quantity" > 0)'
    );
    expect(migration).toMatch(/quantity[^\n]*最多\s*4\s*位|最多\s*4\s*位[^\n]*quantity/u);
  });
});
