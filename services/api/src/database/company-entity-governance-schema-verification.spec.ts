import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

describe("company entity versions and contract subject snapshots schema", () => {
  const migrationsPath = join(process.cwd(), "prisma/migrations");
  const m52Name = "20260716160000_contract_tax_facts_and_settlement_drafts";
  const m53Name = "20260717110000_company_entity_versions_and_contract_subject_snapshots";
  const migrationPath = join(migrationsPath, m53Name, "migration.sql");
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const model = (name: string) =>
    schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, "u"))?.[1] ?? "";

  it("adds M53 after M52 and applies it as one drift-visible transaction", () => {
    const migrationNames = readdirSync(migrationsPath).sort();

    expect(migrationNames).toContain(m52Name);
    expect(migrationNames).toContain(m53Name);
    expect(migrationNames.indexOf(m52Name)).toBeLessThan(migrationNames.indexOf(m53Name));
    expect(migration).toMatch(/^BEGIN;/u);
    expect(migration).toMatch(/COMMIT;\s*$/u);
    expect(migration).not.toMatch(/\bIF\s+(?:NOT\s+)?EXISTS\b/iu);
  });

  it("defines the compatible company entity master and immutable version ledger", () => {
    expect(schema).toContain("model CompanyEntityVersion");
    expect(schema).toContain("registeredAddress");

    const companyEntity = model("CompanyEntity");
    expect(companyEntity).toMatch(/unifiedSocialCreditCode\s+String\?/u);
    expect(companyEntity).toMatch(/registeredAddress\s+String\?/u);
    expect(companyEntity).toMatch(
      /dataStatus\s+String\s+@default\("legacy_incomplete"\)/u
    );
    expect(companyEntity).toMatch(/currentVersionNo\s+Int\s+@default\(0\)/u);

    const version = model("CompanyEntityVersion");
    expect(version).toMatch(/companyEntityId\s+String/u);
    expect(version).toMatch(/versionNo\s+Int/u);
    expect(version).toMatch(/unifiedSocialCreditCode\s+String\?/u);
    expect(version).toMatch(/registeredAddress\s+String\?/u);
    expect(version).toMatch(/actorUserId\s+String\?/u);
    expect(version).toMatch(/actorRoleKey\s+String\?/u);
    expect(version).toContain("@@unique([companyEntityId, versionNo])");
    expect(version).toContain("@@index([name])");
    expect(version).toContain("@@index([unifiedSocialCreditCode])");
  });

  it("adds nullable historical subject snapshots to contract versions", () => {
    expect(schema).toContain("companyEntityVersionId");
    expect(schema).toContain("companyEntityCreditCodeSnapshot");

    const contractVersion = model("ContractVersion");
    expect(contractVersion).toMatch(/companyEntityIdSnapshot\s+String\?/u);
    expect(contractVersion).toMatch(/companyEntityVersionId\s+String\?/u);
    expect(contractVersion).toMatch(/companyEntityNameSnapshot\s+String\?/u);
    expect(contractVersion).toMatch(/companyEntityCreditCodeSnapshot\s+String\?/u);
    expect(contractVersion).toMatch(/companyEntityRegisteredAddressSnapshot\s+String\?/u);

    for (const column of [
      "companyEntityIdSnapshot",
      "companyEntityVersionId",
      "companyEntityNameSnapshot",
      "companyEntityCreditCodeSnapshot",
      "companyEntityRegisteredAddressSnapshot"
    ]) {
      expect(migration).toContain(`ADD COLUMN "${column}" TEXT`);
    }
  });

  it("adds normalized uniqueness, lookup indexes, and NOT VALID subject links", () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "CompanyEntity_unifiedSocialCreditCode_normalized_key"[\s\S]*?ON "CompanyEntity"\s*\(upper\(btrim\("unifiedSocialCreditCode"\)\)\)[\s\S]*?WHERE "unifiedSocialCreditCode" IS NOT NULL[\s\S]*?btrim\("unifiedSocialCreditCode"\) <> '';/u
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "CompanyEntityVersion_companyEntityId_versionNo_key"'
    );
    expect(migration).toContain('CREATE INDEX "CompanyEntityVersion_name_idx"');
    expect(migration).toContain(
      'CREATE INDEX "CompanyEntityVersion_unifiedSocialCreditCode_idx"'
    );
    expect(migration).toContain('CREATE INDEX "ContractVersion_companyEntityIdSnapshot_idx"');
    expect(migration).toContain('CREATE INDEX "ContractVersion_companyEntityVersionId_idx"');
    expect(migration).toMatch(
      /FOREIGN KEY \("companyEntityId"\) REFERENCES "CompanyEntity"\("id"\) NOT VALID;/u
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("companyEntityIdSnapshot"\) REFERENCES "CompanyEntity"\("id"\) NOT VALID;/u
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("companyEntityVersionId"\) REFERENCES "CompanyEntityVersion"\("id"\) NOT VALID;/u
    );
  });

  it("creates an append-only legacy version 1 and advances the master pointer", () => {
    const legacyInsert =
      migration.match(/INSERT INTO "CompanyEntityVersion"[\s\S]*?;/u)?.[0] ?? "";
    const companyEntityUpdates = migration.match(/UPDATE\s+"CompanyEntity"[\s\S]*?;/gu) ?? [];

    expect(legacyInsert).toMatch(
      /'company-entity-version-v1-'\s*\|\|\s*ce\."id"[\s\S]*?ce\."id"[\s\S]*?1[\s\S]*?ce\."name"[\s\S]*?ce\."unifiedSocialCreditCode"[\s\S]*?ce\."registeredAddress"[\s\S]*?ce\."isActive"[\s\S]*?'legacy_backfill'[\s\S]*?FROM "CompanyEntity" ce/u
    );
    expect(legacyInsert).not.toMatch(/ON\s+CONFLICT[\s\S]*?DO\s+UPDATE/iu);
    expect(companyEntityUpdates).toEqual([
      expect.stringMatching(/SET\s+"currentVersionNo"\s*=\s*1/u)
    ]);
    expect(migration).toMatch(
      /ADD CONSTRAINT "CompanyEntity_data_status_check"[\s\S]*?'legacy_incomplete'[\s\S]*?'complete'[\s\S]*?NOT VALID;/u
    );
    expect(migration).toMatch(
      /ADD CONSTRAINT "CompanyEntity_current_version_no_check"[\s\S]*?"currentVersionNo"\s*>=\s*0[\s\S]*?NOT VALID;/u
    );
  });

  it("backfills only reliable entity ids, version links, and names", () => {
    const contractVersionBackfill =
      migration.match(/UPDATE\s+"ContractVersion"[\s\S]*?;/u)?.[0] ?? "";

    expect(contractVersionBackfill).toMatch(
      /"companyEntityIdSnapshot"\s*=\s*ce\."id"/u
    );
    expect(contractVersionBackfill).toMatch(
      /"companyEntityVersionId"\s*=\s*cev\."id"/u
    );
    expect(contractVersionBackfill).toMatch(
      /NULLIF\(BTRIM\(c\."companyEntityName"\), ''\)[\s\S]*?c\."companyEntityName"[\s\S]*?ce\."name"/u
    );
    expect(contractVersionBackfill).toMatch(/FROM "Contract" c/u);
    expect(contractVersionBackfill).toMatch(
      /LEFT JOIN "CompanyEntity" ce ON ce\."id" = c\."companyEntityId"/u
    );
    expect(contractVersionBackfill).toMatch(
      /LEFT JOIN "CompanyEntityVersion" cev[\s\S]*?cev\."companyEntityId" = ce\."id"[\s\S]*?cev\."versionNo" = 1/u
    );
    expect(contractVersionBackfill).not.toMatch(
      /"companyEntityCreditCodeSnapshot"\s*=/u
    );
    expect(contractVersionBackfill).not.toMatch(
      /"companyEntityRegisteredAddressSnapshot"\s*=/u
    );
  });

  it("does not rewrite or invent legacy facts and contains no destructive DML", () => {
    const governedModels = `${model("CompanyEntity")}\n${model("CompanyEntityVersion")}`;

    expect(migration).not.toContain(
      'UPDATE "CompanyEntity" SET "unifiedSocialCreditCode"'
    );
    expect(migration).not.toMatch(/UPDATE\s+"CompanyEntity"[\s\S]*?"dataStatus"\s*=/iu);
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\b/iu);
    expect(governedModels).not.toMatch(
      /\b(?:legalRepresentative|phone|bank|seal|license|remark)\w*\b/iu
    );
    expect(migration).not.toMatch(
      /"(?:legalRepresentative|phone|bank\w*|seal\w*|license\w*|remark\w*)"/iu
    );
  });
});
