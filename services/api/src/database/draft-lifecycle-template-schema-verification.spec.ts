import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const schema = readFileSync(resolve(__dirname, "../../prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(
    __dirname,
    "../../prisma/migrations/20260719212000_template_draft_lifecycle/migration.sql"
  ),
  "utf8"
);

const TARGETS = [
  "ContractBusinessTemplateVersion",
  "StandardClauseVersion",
  "ContractLayoutTemplateVersion",
  "SettlementTemplateVersion"
] as const;

function modelBlock(name: string) {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, "u"));
  if (!match) throw new Error(`missing model ${name}`);
  return match[1];
}

function constraintBlock(name: string) {
  const match = migration.match(
    new RegExp(`ADD CONSTRAINT "${name}_status_check"([\\s\\S]*?)NOT VALID;`, "u")
  );
  if (!match) throw new Error(`missing status constraint ${name}`);
  return match[1];
}

describe("M72 template draft lifecycle schema", () => {
  it.each(TARGETS)("adds nullable discard facts and the lifecycle index to %s", (model) => {
    const block = modelBlock(model);
    expect(block).toMatch(/\bdiscardedAt\s+DateTime\?/u);
    expect(block).toMatch(/\bdiscardedByUserId\s+String\?/u);
    expect(block).toMatch(/\bdiscardReason\s+String\?/u);
    expect(block).toContain("@@index([status, updatedAt])");

    expect(migration).toContain(`ALTER TABLE "${model}" ADD COLUMN "discardedAt" TIMESTAMP(3)`);
    expect(migration).toContain(`ALTER TABLE "${model}" ADD COLUMN "discardedByUserId" TEXT`);
    expect(migration).toContain(`ALTER TABLE "${model}" ADD COLUMN "discardReason" TEXT`);
    expect(migration).toContain(`"${model}_discard_facts_check"`);
    expect(migration).toContain(
      `CREATE INDEX IF NOT EXISTS "${model}_status_updatedAt_idx"`
    );
  });

  it("preserves each domain's existing statuses and adds only discarded", () => {
    const expectedStatuses = {
      ContractBusinessTemplateVersion: ["draft", "submitted", "published", "stopped", "revoked", "discarded"],
      StandardClauseVersion: ["draft", "submitted", "published", "discarded"],
      ContractLayoutTemplateVersion: ["draft", "submitted", "published", "stopped", "revoked", "discarded"],
      SettlementTemplateVersion: ["draft", "submitted", "published", "stopped", "discarded"]
    } as const;

    for (const [model, statuses] of Object.entries(expectedStatuses)) {
      const block = constraintBlock(model);
      for (const status of statuses) expect(block).toContain(`'${status}'`);
      expect([...block.matchAll(/'([a-z_]+)'/gu)].map((match) => match[1])).toEqual(statuses);
    }
  });

  it("replaces the existing settlement constraint and rejects unexpected same-name constraints elsewhere", () => {
    expect(migration).toContain(
      'ALTER TABLE "SettlementTemplateVersion" DROP CONSTRAINT "SettlementTemplateVersion_status_check"'
    );
    for (const model of [
      "ContractBusinessTemplateVersion",
      "StandardClauseVersion",
      "ContractLayoutTemplateVersion"
    ]) {
      expect(migration).toContain(`conname = '${model}_status_check'`);
      expect(migration).not.toContain(
        `ALTER TABLE "${model}" DROP CONSTRAINT "${model}_status_check"`
      );
    }
  });

  it.each(TARGETS)("keeps discard facts coherent for %s", (model) => {
    expect(migration).toMatch(
      new RegExp(
        `ADD CONSTRAINT "${model}_discard_facts_check"[\\s\\S]*?"status" = 'discarded'[\\s\\S]*?"discardedAt" IS NOT NULL[\\s\\S]*?"discardedByUserId" IS NOT NULL[\\s\\S]*?"status" <> 'discarded'[\\s\\S]*?"discardReason" IS NULL[\\s\\S]*?NOT VALID;`,
        "u"
      )
    );
  });

  it("preserves settlement publication indexes and formal version references", () => {
    expect(migration).toContain("SettlementTemplateVersion_status_publishedAt_idx");
    expect(migration).toContain("SettlementTemplateVersion_one_published_per_template_key");
    expect(migration).not.toMatch(/DROP\s+INDEX/iu);
    expect(migration).not.toMatch(/ALTER TABLE "(?:Settlement|SettlementImport|ContractVersion)"/u);
  });

  it("adds only forward nullable facts and indexes without business DML or cascades", () => {
    expect(migration).not.toMatch(/ADD COLUMN "(?:discardedAt|discardedByUserId|discardReason)"[^;]*(?:NOT NULL|DEFAULT)/iu);
    expect(migration).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM|TRUNCATE|MERGE\s+INTO)\b/iu);
    expect(migration).not.toMatch(/ON\s+DELETE\s+CASCADE/iu);
    expect(migration).not.toMatch(/DROP\s+TABLE|DROP\s+COLUMN/iu);
    expect(migration).toContain("BEGIN;");
    expect(migration).toContain("COMMIT;");
  });
});
