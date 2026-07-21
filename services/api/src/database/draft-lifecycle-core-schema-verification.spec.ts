import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const schema = readFileSync(resolve(__dirname, "../../prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(
    __dirname,
    "../../prisma/migrations/20260719210000_contract_settlement_draft_lifecycle/migration.sql"
  ),
  "utf8"
);

const TARGETS = [
  { model: "ContractVersion", table: "ContractVersion", statusColumn: "status" },
  { model: "ContractTakeover", table: "ContractTakeover", statusColumn: "takeoverStatus" },
  { model: "ContractTaxFactRevision", table: "ContractTaxFactRevision", statusColumn: "status" },
  { model: "SettlementDraft", table: "SettlementDraft", statusColumn: "status" }
] as const;

function modelBlock(name: string) {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, "u"));
  if (!match) throw new Error(`missing model ${name}`);
  return match[1];
}

describe("M70 contract and settlement draft lifecycle schema", () => {
  it.each(TARGETS)("adds nullable abandonment facts to $model", ({ model }) => {
    const block = modelBlock(model);
    expect(block).toMatch(/\babandonedAt\s+DateTime\?/u);
    expect(block).toMatch(/\babandonedByUserId\s+String\?/u);
    expect(block).toMatch(/\babandonReason\s+String\?/u);
    expect(block).toMatch(/@@index\(\[(status|takeoverStatus), updatedAt\]\)/u);
  });

  it.each(TARGETS)("adds only forward nullable columns for $table", ({ table }) => {
    expect(migration).toContain(`ALTER TABLE "${table}" ADD COLUMN "abandonedAt" TIMESTAMP(3)`);
    expect(migration).toContain(`ALTER TABLE "${table}" ADD COLUMN "abandonedByUserId" TEXT`);
    expect(migration).toContain(`ALTER TABLE "${table}" ADD COLUMN "abandonReason" TEXT`);
  });

  it.each(TARGETS)("allows abandoned only after checking the existing $table constraint", ({ table }) => {
    expect(migration).toContain(`'"${table}"'::regclass`);
    expect(migration).toContain(`"${table}_status_check"`);
    expect(migration).toMatch(
      new RegExp(`ALTER TABLE "${table}"[\\s\\S]*ADD CONSTRAINT "${table}_status_check"[\\s\\S]*'abandoned'`, "u")
    );
    expect(migration).toContain(`"${table}_abandonment_facts_check"`);
  });

  it("adds deterministic status and updated-time indexes after collision checks", () => {
    for (const index of [
      "ContractVersion_status_updatedAt_idx",
      "ContractTakeover_takeoverStatus_updatedAt_idx",
      "ContractTaxFactRevision_status_updatedAt_idx",
      "SettlementDraft_status_updatedAt_idx"
    ]) {
      expect(migration).toContain(`indexname = '${index}'`);
      expect(migration).toContain(`CREATE INDEX IF NOT EXISTS "${index}"`);
    }
  });

  it("keeps settlement submission facts coherent when a never-submitted draft is abandoned", () => {
    expect(migration).toContain("SettlementDraft_submission_state_check");
    expect(migration).toMatch(
      /"status" IN \('draft', 'abandoned'\)[\s\S]*"submittedSettlementId" IS NULL[\s\S]*"submittedAt" IS NULL/u
    );
  });

  it("does not rewrite business rows or weaken formal foreign keys", () => {
    expect(migration).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM|TRUNCATE|MERGE\s+INTO)\b/iu);
    expect(migration).not.toMatch(/ON\s+DELETE\s+CASCADE/iu);
    expect(migration).not.toMatch(/DROP\s+TABLE|DROP\s+COLUMN/iu);
    expect(migration).toContain("BEGIN;");
    expect(migration).toContain("COMMIT;");
  });
});
