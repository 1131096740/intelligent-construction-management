import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const migrationsPath = join(process.cwd(), "prisma/migrations");
const m55Name = "20260717130000_contract_formal_documents_authorizations_and_seal_tasks";
const m56Name = "20260717140000_settlement_participants_and_signed_documents";
const migrationPath = join(migrationsPath, m56Name, "migration.sql");

function validateM56(sql: string) {
  expect(sql.trimStart()).toMatch(/^BEGIN;/u);
  expect(sql.trimEnd()).toMatch(/COMMIT;$/u);
  expect(sql.match(/\bBEGIN;/gu)).toHaveLength(1);
  expect(sql.match(/\bCOMMIT;/gu)).toHaveLength(1);
  expect(sql).not.toMatch(/\bIF\s+(?:NOT\s+)?EXISTS\b/iu);
  expect(sql).not.toMatch(/(?:^|;)\s*(?:UPDATE|DELETE|TRUNCATE|DROP|INSERT\s+INTO)\b/imu);

  for (const table of ["SettlementDraft", "Settlement"]) {
    const governanceColumn = sql.match(
      new RegExp(`ALTER TABLE "${table}"[\\s\\S]*?ADD COLUMN "governanceVersion"[\\s\\S]*?;`, "u")
    )?.[0] ?? "";
    expect(governanceColumn).toMatch(/ADD COLUMN "governanceVersion" INTEGER/u);
    expect(governanceColumn).not.toMatch(/\b(?:NOT\s+NULL|DEFAULT)\b/iu);
    expect(sql).toMatch(new RegExp(
      `${table}_governance_version_check[\\s\\S]*?"governanceVersion" IS NULL[\\s\\S]*?"governanceVersion" = 1[\\s\\S]*?NOT VALID;`,
      "u"
    ));
    for (const column of [
      "finalScopeCompleted",
      "finalPriorSettlementsIncluded",
      "finalNoOutstandingSettlements",
      "finalWithinContractCap",
      "finalNoFurtherOrdinarySettlements"
    ]) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE "${table}"[\\s\\S]*?ADD COLUMN "${column}" BOOLEAN`, "u"));
    }
    expect(sql).toMatch(new RegExp(
      `${table}_final_confirmation_group_check[\\s\\S]*?"finalScopeCompleted" IS NULL[\\s\\S]*?"finalNoFurtherOrdinarySettlements" IS NULL[\\s\\S]*?"finalScopeCompleted" IS NOT NULL[\\s\\S]*?"finalNoFurtherOrdinarySettlements" IS NOT NULL[\\s\\S]*?NOT VALID;`,
      "u"
    ));
  }

  for (const column of ["fieldReviewerUserId", "fieldReviewerRoleKey"]) {
    expect(sql).toMatch(new RegExp(`ALTER TABLE "SettlementDraft"[\\s\\S]*?ADD COLUMN "${column}" TEXT`, "u"));
    expect(sql).toMatch(new RegExp(`ALTER TABLE "Settlement"[\\s\\S]*?ADD COLUMN "${column}" TEXT`, "u"));
  }
  for (const column of ["preparedByUserId", "preparerSignatureFileId", "preparerSignatureSha256"]) {
    expect(sql).toMatch(new RegExp(`ALTER TABLE "Settlement"[\\s\\S]*?ADD COLUMN "${column}" TEXT`, "u"));
  }

  expect(sql).toContain('CREATE TABLE "SettlementSignedDocument"');
  for (const reference of [
    'FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id")',
    'FOREIGN KEY ("settlementDraftId") REFERENCES "SettlementDraft"("id")',
    'FOREIGN KEY ("fileId") REFERENCES "FileObject"("id")',
    'FOREIGN KEY ("declaredByUserId") REFERENCES "User"("id")',
    'FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id")',
    'FOREIGN KEY ("generatedByUserId") REFERENCES "User"("id")',
    'FOREIGN KEY ("supersedesId") REFERENCES "SettlementSignedDocument"("id")'
  ]) {
    expect(sql).toContain(reference);
  }
  expect(sql).toMatch(/Settlement_field_reviewer_fk[\s\S]*?ON DELETE RESTRICT/u);
  expect(sql).toMatch(/SettlementDraft_field_reviewer_fk[\s\S]*?ON DELETE RESTRICT/u);
  expect(sql).toMatch(/SettlementSignedDocument_purpose_check[\s\S]*?'frozen_counterparty_copy'[\s\S]*?'counterparty_signed_original'[\s\S]*?'final_internal_signed_copy'/u);
  expect(sql).toMatch(/SettlementSignedDocument_status_check[\s\S]*?'active'[\s\S]*?'invalidated'[\s\S]*?'superseded'/u);
  expect(sql).toMatch(/SettlementSignedDocument_generation_status_check[\s\S]*?'not_applicable'[\s\S]*?'pending'[\s\S]*?'generating'[\s\S]*?'completed'[\s\S]*?'failed'/u);
  expect(sql).toMatch(/SettlementSignedDocument_page_count_check[\s\S]*?"pageCount" > 0/u);
  expect(sql).toMatch(/SettlementSignedDocument_source_revision_check[\s\S]*?"sourceRevision" >= 1/u);
  expect(sql).toMatch(/SettlementSignedDocument_sha256_check"\s+CHECK \("contentSha256" ~ '\^\[0-9a-f\]\{64\}\$'\)/u);
  expect(sql).toMatch(/SettlementSignedDocument_parent_check[\s\S]*?"settlementId" IS NOT NULL[\s\S]*?"settlementDraftId" IS NULL[\s\S]*?"settlementId" IS NULL[\s\S]*?"settlementDraftId" IS NOT NULL/u);
  expect(sql).toMatch(/SettlementSignedDocument_purpose_facts_check[\s\S]*?"purpose" = 'frozen_counterparty_copy'[\s\S]*?"settlementDraftId" IS NOT NULL[\s\S]*?"generationStatus" = 'completed'[\s\S]*?"generatedByUserId" IS NOT NULL[\s\S]*?"declarationSnapshot" IS NULL[\s\S]*?"approvalActionSetHash" IS NULL/u);
  expect(sql).toMatch(/SettlementSignedDocument_purpose_facts_check[\s\S]*?"purpose" = 'counterparty_signed_original'[\s\S]*?"settlementDraftId" IS NOT NULL[\s\S]*?"generationStatus" = 'not_applicable'[\s\S]*?"uploadedByUserId" IS NOT NULL[\s\S]*?"declarationSnapshot" IS NOT NULL[\s\S]*?"approvalActionSetHash" IS NULL/u);
  expect(sql).toMatch(/SettlementSignedDocument_purpose_facts_check[\s\S]*?"purpose" = 'final_internal_signed_copy'[\s\S]*?"settlementId" IS NOT NULL[\s\S]*?"generationStatus" = 'completed'[\s\S]*?"generatedByUserId" IS NOT NULL[\s\S]*?"declarationSnapshot" IS NULL[\s\S]*?"approvalActionSetHash" IS NOT NULL/u);
  expect(sql).toMatch(/SettlementSignedDocument_supersedes_not_self_check[\s\S]*?"supersedesId" <> "id"/u);
  expect(sql).toMatch(/CREATE UNIQUE INDEX "SettlementSignedDocument_active_settlement_revision_purpose_key"[\s\S]*?"settlementId", "sourceRevision", "purpose"[\s\S]*?WHERE "status" = 'active' AND "settlementId" IS NOT NULL/u);
  expect(sql).toMatch(/CREATE UNIQUE INDEX "SettlementSignedDocument_active_draft_revision_purpose_key"[\s\S]*?"settlementDraftId", "sourceRevision", "purpose"[\s\S]*?WHERE "status" = 'active' AND "settlementDraftId" IS NOT NULL/u);
  expect(sql).toContain('CREATE INDEX "SettlementSignedDocument_fileId_idx"');
  expect(sql).toContain('CREATE INDEX "SettlementSignedDocument_settlementId_purpose_status_idx"');
  expect(sql).toContain('CREATE INDEX "SettlementSignedDocument_settlementDraftId_purpose_status_idx"');
}

function removeNamedConstraint(sql: string, name: string) {
  return sql.replace(
    new RegExp(
      `,?\\n  ADD CONSTRAINT "${name}"[\\s\\S]*?(?=,\\n  ADD CONSTRAINT|;\\n)`,
      "u"
    ),
    ""
  );
}

describe("M56 settlement participant and signed-document governance schema", () => {
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");

  it("is ordered after M55 and is one compatible drift-visible transaction", () => {
    const names = readdirSync(migrationsPath).sort();
    expect(names).toContain(m55Name);
    expect(names).toContain(m56Name);
    expect(names.indexOf(m55Name)).toBeLessThan(names.indexOf(m56Name));
    validateM56(migration);
  });

  it("exposes nullable governance markers, frozen participants, and signed documents in Prisma", () => {
    for (const model of ["SettlementDraft", "Settlement"]) {
      expect(schema).toMatch(new RegExp(`model ${model}[\\s\\S]*?governanceVersion\\s+Int\\?`, "u"));
      expect(schema).toMatch(new RegExp(`model ${model}[\\s\\S]*?fieldReviewerUserId\\s+String\\?`, "u"));
      expect(schema).toMatch(new RegExp(`model ${model}[\\s\\S]*?fieldReviewerRoleKey\\s+String\\?`, "u"));
      for (const column of [
        "finalScopeCompleted",
        "finalPriorSettlementsIncluded",
        "finalNoOutstandingSettlements",
        "finalWithinContractCap",
        "finalNoFurtherOrdinarySettlements"
      ]) {
        expect(schema).toMatch(new RegExp(`model ${model}[\\s\\S]*?${column}\\s+Boolean\\?`, "u"));
      }
    }
    expect(schema).toMatch(/model Settlement[\s\S]*?preparedByUserId\s+String\?[\s\S]*?preparerSignatureFileId\s+String\?[\s\S]*?preparerSignatureSha256\s+String\?/u);
    expect(schema).toContain("model SettlementSignedDocument");
  });

  it.each([
    ["removing a file foreign key", (sql: string) =>
      removeNamedConstraint(sql, "SettlementSignedDocument_file_fk")],
    ["removing the sha check", (sql: string) =>
      removeNamedConstraint(sql, "SettlementSignedDocument_sha256_check")],
    ["removing the purpose-specific facts check", (sql: string) =>
      removeNamedConstraint(sql, "SettlementSignedDocument_purpose_facts_check")],
    ["removing the settlement partial unique index", (sql: string) => sql.replace(
      /CREATE UNIQUE INDEX "SettlementSignedDocument_active_settlement_revision_purpose_key"[\s\S]*?;\n/u,
      ""
    )],
    ["backfilling old settlements", (sql: string) => sql.replace(
      "\nCOMMIT;",
      '\nUPDATE "Settlement" SET "governanceVersion" = 1;\nCOMMIT;'
    )],
    ["deleting historical settlements", (sql: string) => sql.replace(
      "\nCOMMIT;",
      '\nDELETE FROM "Settlement";\nCOMMIT;'
    )]
  ])("rejects mutation: %s", (_label, mutate) => {
    expect(() => validateM56(mutate(migration))).toThrow();
  });
});
