import { readFileSync } from "node:fs";
import { join } from "node:path";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260727120000_contract_bill_lineage_settlement_v2_foundation/migration.sql"
  ),
  "utf8"
);

const model = (name: string) =>
  schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, "u"))?.[1] ?? "";

describe("contract bill lineage and settlement workbench v2 foundation schema", () => {
  it("adds lineage, transition, carry-forward, process and structured draft-line models without replacing legacy facts", () => {
    expect(model("ContractBillRowLineage")).toContain("createdInContractVersionId String");
    expect(model("ContractBillRowTransition")).toContain("sourceSettledQuantityAllocated Decimal?");
    expect(model("ContractBillRowTransition")).toContain("@@unique([fromContractVersionId, toContractVersionId, sourceContractBillRowId, targetContractBillRowId])");
    expect(model("ContractBillRowCarryForward")).toMatch(/contractBillRowId\s+String\s+@unique/u);
    expect(model("ContractSettlementProcess")).toContain("@@unique([contractId, sequenceNo])");
    expect(model("SettlementDraftLine")).toContain("@@unique([settlementDraftId, lineKey])");
    expect(model("SettlementLineAttachment")).toContain("settlementDraftLineId String?");
    expect(model("SettlementLineAttachment")).toContain("settlementLineId      String?");
    expect(model("SettlementDraft")).toContain("lines                             Json");
    expect(model("SettlementLine")).toContain("contractBillRowId        String?");
  });

  it("keeps compatibility columns nullable and supplies all v2 read-model links", () => {
    expect(model("Contract")).toContain("finalSettlementId         String?   @unique");
    expect(model("ContractBillRow")).toMatch(/lineageId\s+String\?/u);
    expect(model("SettlementDraft")).toContain("processId                         String?   @unique");
    expect(model("Settlement")).toContain("processId                         String?   @unique");
    expect(model("SettlementLine")).toMatch(/contractBillRowLineageId\s+String\?/u);
    expect(model("ContractBillImport")).toMatch(/mappingStatus\s+String\?/u);
    expect(model("SettlementImport")).toMatch(/settlementDraftId\s+String\?/u);
    expect(model("SettlementSignedDocument")).toMatch(/fileFactsSnapshot\s+Json\?/u);
  });

  it("builds the concurrency, foreign-key and stable structural constraints at the database boundary", () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "ContractSettlementProcess_one_open_per_contract_idx"');
    expect(migration).toContain("WHERE \"status\" = 'open'");
    expect(migration).toContain('FOREIGN KEY ("lineageId") REFERENCES "ContractBillRowLineage"("id") ON DELETE RESTRICT ON UPDATE RESTRICT');
    expect(migration).toContain('FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE RESTRICT');
    expect(migration).toContain('"SettlementLineAttachment_parent_check" CHECK (("settlementDraftLineId" IS NULL) <> ("settlementLineId" IS NULL)) NOT VALID');
    expect(migration).toContain('"SettlementDraftLine_calculation_fields_check"');
    expect(migration).toContain('"ContractSettlementProcess_period_check"');
    expect(migration).toContain("pg_advisory_xact_lock(190731, 27)");
  });

  it("does not backfill, rewrite, or delete existing contract and settlement business facts", () => {
    expect(migration).toContain("T03 foundation only");
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE)\s+"(?:Contract|ContractBillRow|SettlementDraft|Settlement|SettlementLine)"/u);
    expect(migration).toMatch(/^-- T03[\s\S]*?BEGIN;/u);
    expect(migration).toMatch(/COMMIT;\s*$/u);
  });
});
