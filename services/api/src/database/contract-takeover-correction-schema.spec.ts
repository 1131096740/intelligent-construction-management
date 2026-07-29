import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("contract takeover correction ledger schema", () => {
  const schema = readFileSync(
    join(process.cwd(), "prisma/schema.prisma"),
    "utf8"
  );
  const migration = readFileSync(
    join(
      process.cwd(),
      "prisma/migrations/20260728132000_contract_takeover_correction_ledger/migration.sql"
    ),
    "utf8"
  );
  const correction =
    schema.match(
      /model ContractTakeoverCorrection \{([\s\S]*?)\n\}/u
    )?.[1] ?? "";

  it("keeps old rows on schema version 1 and gives version 2 structured targets and deltas", () => {
    expect(correction).toMatch(
      /schemaVersion\s+Int\s+@default\(1\)/u
    );
    expect(correction).toMatch(/correctionScope\s+String\?/u);
    expect(correction).toMatch(
      /correctionOperation\s+String\?/u
    );
    expect(correction).toMatch(
      /targetRevision\s+Int\?/u
    );
    expect(correction).toMatch(
      /targetBalanceRevision\s+Int\?/u
    );
    expect(correction).toMatch(/deltaSnapshot\s+Json\?/u);
    expect(migration).toContain(
      'UPDATE "ContractTakeoverCorrection"\nSET "schemaVersion" = 1'
    );
    expect(migration).not.toMatch(
      /\bDELETE\s+FROM\s+"ContractTakeoverCorrection"/u
    );
  });

  it("persists the exact original payment, allocation, or ledger reference and one application key", () => {
    expect(correction).toMatch(
      /targetHistoricalPaymentId\s+String\?/u
    );
    expect(correction).toMatch(
      /targetAllocationId\s+String\?/u
    );
    expect(correction).toMatch(
      /targetBalanceEntryId\s+String\?/u
    );
    expect(correction).toMatch(
      /applicationIdempotencyKey\s+String\?\s+@unique/u
    );
    expect(migration).toContain(
      '"ContractTakeoverCorrection_targetHistoricalPaymentId_fkey"'
    );
    expect(migration).toContain(
      '"ContractTakeoverCorrection_targetAllocationId_fkey"'
    );
    expect(migration).toContain(
      '"ContractTakeoverCorrection_targetBalanceEntryId_fkey"'
    );
  });

  it("enforces draft, submitted, applied and rejected lifecycle without a reviewed-but-unapplied state", () => {
    expect(migration).toMatch(
      /"schemaVersion" = 2[\s\S]*?"status" IN \('draft', 'submitted', 'applied', 'rejected'\)/u
    );
    expect(migration).toMatch(
      /"status" = 'applied'[\s\S]*?"appliedByUserId" = "reviewedByUserId"[\s\S]*?"appliedAt" = "reviewedAt"/u
    );
    expect(migration).toMatch(
      /"status" = 'submitted'[\s\S]*?"appliedByUserId" IS NULL[\s\S]*?"appliedAt" IS NULL/u
    );
    expect(migration).not.toMatch(
      /"schemaVersion" = 2[\s\S]*?"status" = 'confirmed'/u
    );
  });

  it("requires supervisor separation and makes the evidence binding exclusive", () => {
    expect(migration).toMatch(
      /"reviewedByUserId" <> "createdByUserId"/u
    );
    expect(migration).toMatch(
      /jg_enforce_exclusive_file_business_binding\(\s*'attachmentFileId',\s*'true'\s*\)/u
    );
    expect(migration).toMatch(
      /current_is_exclusive :=[\s\S]*?NEW\."correctionType" = 'company_entity'[\s\S]*?OR NEW\."schemaVersion" = 2/u
    );
    expect(migration).toMatch(
      /jg_has_exclusive_file_business_binding[\s\S]*?"correctionType" = 'company_entity'[\s\S]*?OR "schemaVersion" = 2/u
    );
    expect(migration.trimStart()).toMatch(/^BEGIN;/u);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u);
  });
});
