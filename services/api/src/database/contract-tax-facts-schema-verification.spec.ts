import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("contract tax facts and settlement drafts schema", () => {
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const migrationPath = join(
    process.cwd(),
    "prisma/migrations/20260716160000_contract_tax_facts_and_settlement_drafts/migration.sql"
  );
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
  const model = (name: string) =>
    schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, "u"))?.[1] ?? "";

  it("defines version tax facts, nullable historical bill facts, and immutable settlement snapshots", () => {
    expect(model("ContractVersion")).toMatch(/invoiceType\s+String\?/u);
    expect(model("ContractVersion")).toMatch(/taxFactStatus\s+String\s+@default\("unconfirmed"\)/u);
    expect(model("ContractVersion")).toMatch(
      /defaultTaxRatePercent\s+Decimal\?\s+@db\.Decimal\(9, 6\)/u
    );
    expect(model("ContractVersion")).toMatch(/taxFactRevision\s+Int\s+@default\(0\)/u);

    expect(model("ContractBillRow")).toMatch(/quantity\s+Decimal\?\s+@db\.Decimal\(24, 6\)/u);
    expect(model("ContractBillRow")).toMatch(/unitPrice\s+Decimal\?\s+@db\.Decimal\(24, 6\)/u);
    expect(model("ContractBillRow")).toMatch(/taxRate\s+Decimal\?\s+@db\.Decimal\(9, 6\)/u);
    expect(model("ContractBillRow")).toMatch(
      /pricingFactStatus\s+String\s+@default\("unconfirmed"\)/u
    );
    expect(model("ContractBillRow")).toMatch(
      /precisionPolicy\s+String\s+@default\("two_decimal"\)/u
    );
    expect(model("ContractBillRow")).toMatch(/taxInclusiveAmountCents\s+BigInt\?/u);
    expect(model("ContractBillRow")).toMatch(/taxExclusiveAmountCents\s+BigInt\?/u);
    expect(model("ContractBillRow")).toMatch(/taxAmountCents\s+BigInt\?/u);

    expect(model("Settlement")).toMatch(/invoiceTypeSnapshot\s+String\?/u);
    expect(model("Settlement")).toMatch(/taxFactRevisionSnapshot\s+Int\?/u);
    expect(model("SettlementLine")).toMatch(/taxExclusiveAmountCents\s+BigInt\?/u);
    expect(model("SettlementLine")).toMatch(/taxAmountCents\s+BigInt\?/u);
  });

  it("defines the revision ledger and settlement draft persistence models", () => {
    const revision = model("ContractTaxFactRevision");
    expect(revision).toContain("@@unique([contractVersionId, revisionNo])");
    expect(revision).toContain("@@index([projectId, status])");
    expect(revision).toContain("@@index([contractVersionId, status])");
    expect(revision).toMatch(/rowFacts\s+Json/u);
    expect(revision).toMatch(/beforeSnapshot\s+Json/u);

    const draft = model("SettlementDraft");
    expect(draft).toMatch(/lines\s+Json/u);
    expect(draft).toMatch(/revision\s+Int\s+@default\(1\)/u);
    expect(draft).toMatch(/status\s+String\s+@default\("draft"\)/u);
    expect(draft).toMatch(/submittedSettlementId\s+String\?\s+@unique/u);
    expect(draft).toContain("@@index([projectId, ownerUserId, status, updatedAt])");
    expect(draft).toContain("@@index([contractVersionId, status])");
  });

  it("adds the compatible columns and leaves existing monetary facts untouched", () => {
    expect(migration).toContain('ADD COLUMN "invoiceType" TEXT');
    expect(migration).toContain('ADD COLUMN "taxFactStatus" TEXT NOT NULL DEFAULT');
    expect(migration).toContain('ALTER COLUMN "quantity" DROP NOT NULL');
    expect(migration).toContain('ALTER COLUMN "unitPrice" DROP NOT NULL');
    expect(migration).toContain('ALTER COLUMN "taxRate" DROP NOT NULL');
    expect(migration).toContain('ALTER COLUMN "taxInclusiveAmountCents" DROP NOT NULL');
    expect(migration).toContain('ALTER COLUMN "taxExclusiveAmountCents" DROP NOT NULL');
    expect(migration).toContain('ALTER COLUMN "taxAmountCents" DROP NOT NULL');
    const rowBackfill = migration.match(/UPDATE\s+"ContractBillRow"[\s\S]*?;/u)?.[0] ?? "";
    expect(rowBackfill).not.toMatch(
      /"(?:quantity|unitPrice|taxRate|taxInclusiveAmountCents|taxExclusiveAmountCents|taxAmountCents)"\s*=/iu
    );
  });

  it("backfills only proven system facts and never auto-confirms historical takeovers", () => {
    expect(migration).toContain("#>> '{fieldValues,invoiceType}'");
    expect(migration).toContain("->> 'invoiceType'");
    expect(migration).toContain("#>> '{fieldValues,taxRatePercent}'");
    expect(migration).toContain("->> 'taxRatePercent'");
    expect(migration).toContain("WHEN '增值税普通发票' THEN 'vat_general'");
    expect(migration).toContain("WHEN '增值税专用发票' THEN 'vat_special'");
    expect(migration).toMatch(/"source"\s*<>\s*'historical_takeover'/u);
    expect(migration).toMatch(/"changeType"\s*<>\s*'historical_takeover'/u);
    expect(migration).not.toMatch(
      /(?:"source"|"changeType")\s*=\s*'historical_takeover'[\s\S]*?"taxFactStatus"\s*=\s*'confirmed'/iu
    );
    expect(migration).toMatch(
      /UPDATE\s+"ContractBillRow"[\s\S]*?"precisionPolicy"\s*=\s*'legacy'/u
    );
    expect(migration).toMatch(
      /"pricingFactStatus"\s*=\s*CASE[\s\S]*?"unitPrice"\s+IS NOT NULL[\s\S]*?"taxRate"\s*>\s*0[\s\S]*?THEN 'confirmed'/u
    );
  });

  it("creates constrained ledgers, required foreign keys, and one active revision per version", () => {
    expect(migration).toContain('CREATE TABLE "ContractTaxFactRevision"');
    expect(migration).toContain('CREATE TABLE "SettlementDraft"');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ContractTaxFactRevision_contractVersionId_revisionNo_key"'
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "ContractTaxFactRevision_one_in_progress_per_version_key"[\s\S]*?WHERE "status" IN \('draft', 'pending_finance_review', 'pending_contract_confirmation'\)/u
    );
    expect(migration).toContain(
      'FOREIGN KEY ("contractVersionId") REFERENCES "ContractVersion"("id")'
    );
    expect(migration).toContain(
      'FOREIGN KEY ("submittedSettlementId") REFERENCES "Settlement"("id")'
    );
    expect(migration).toContain(
      'FOREIGN KEY ("paymentTermsVersionId") REFERENCES "PaymentTermsVersion"("id")'
    );
    expect(migration).toContain(
      'FOREIGN KEY ("settlementTemplateVersionId") REFERENCES "SettlementTemplateVersion"("id")'
    );
  });

  it("uses finite NOT VALID checks for new and touched records", () => {
    expect(migration).toMatch(
      /ADD CONSTRAINT "ContractVersion_invoice_type_check"[\s\S]*?NOT VALID;/u
    );
    expect(migration).toMatch(
      /ADD CONSTRAINT "ContractVersion_tax_fact_status_check"[\s\S]*?'pending_finance_review'[\s\S]*?'pending_contract_confirmation'[\s\S]*?NOT VALID;/u
    );
    expect(migration).toMatch(
      /ADD CONSTRAINT "ContractBillRow_pricing_fact_status_check"[\s\S]*?NOT VALID;/u
    );
    expect(migration).toMatch(
      /ADD CONSTRAINT "ContractTaxFactRevision_status_check"[\s\S]*?'rejected'[\s\S]*?NOT VALID;/u
    );
    expect(migration).toMatch(
      /ADD CONSTRAINT "SettlementDraft_status_check"[\s\S]*?'draft'[\s\S]*?'submitted'[\s\S]*?NOT VALID;/u
    );
    expect(migration).toMatch(
      /ADD CONSTRAINT "SettlementLine_tax_amounts_check"[\s\S]*?"taxExclusiveAmountCents"\s+IS NULL[\s\S]*?"taxAmountCents"\s+IS NULL[\s\S]*?"amountCents"\s*=\s*"taxExclusiveAmountCents"\s*\+\s*"taxAmountCents"[\s\S]*?NOT VALID;/u
    );
  });

  it("applies the migration atomically", () => {
    expect(migration).toMatch(/^BEGIN;/u);
    expect(migration).toMatch(/COMMIT;\s*$/u);
  });
});
