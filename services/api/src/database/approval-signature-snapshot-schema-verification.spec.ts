import * as fs from "node:fs";
import * as path from "node:path";

const migrationPath = path.resolve(
  process.cwd(),
  "prisma/migrations/20260717120000_approval_assignee_and_signature_snapshots/migration.sql"
);

function validateMigration(sql: string) {
  expect(sql.trimStart()).toMatch(/^BEGIN;/u);
  expect(sql.trimEnd()).toMatch(/COMMIT;$/u);
  for (const column of [
    "approvedRoleKey",
    "signatureFileIdSnapshot",
    "signatureSha256Snapshot",
    "representedUserId"
  ]) {
    expect(sql).toContain(`ADD COLUMN "${column}" TEXT`);
    expect(sql).not.toMatch(new RegExp(`"${column}"\\s+TEXT\\s+NOT NULL`, "iu"));
  }
  expect(sql).not.toMatch(/\bDEFAULT\b/iu);
  expect(sql).not.toMatch(/\b(?:UPDATE|DELETE|TRUNCATE|DROP)\b/iu);
  expect(sql).not.toMatch(/INSERT\s+INTO/iu);
}

describe("M54 approval snapshots migration", () => {
  it("is ordered after M53 and only adds nullable snapshot columns", () => {
    expect(fs.existsSync(path.resolve(process.cwd(), "prisma/migrations/20260717110000_company_entity_versions_and_contract_subject_snapshots/migration.sql"))).toBe(true);
    expect(fs.existsSync(migrationPath)).toBe(true);
    validateMigration(fs.readFileSync(migrationPath, "utf8"));
  });

  it.each([
    'ALTER TABLE "ApprovalActionLog" DROP COLUMN "approvedRoleKey";',
    'ALTER TABLE "ApprovalActionLog" ADD COLUMN "approvedRoleKey" TEXT DEFAULT \'finance_director\';',
    'UPDATE "ApprovalActionLog" SET "approvedRoleKey" = \'finance_director\';'
  ])("rejects destructive or history-inventing mutation: %s", (mutation) => {
    expect(() => validateMigration(`${fs.readFileSync(migrationPath, "utf8")}\n${mutation}`)).toThrow();
  });
});
