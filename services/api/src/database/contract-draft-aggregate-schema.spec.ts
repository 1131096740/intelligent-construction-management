import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("contract draft aggregate foundation schema", () => {
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const migrationPath = join(
    process.cwd(),
    "prisma/migrations/20260728100000_contract_draft_aggregate_foundation/migration.sql"
  );
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
  const model = (name: string) =>
    schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, "u"))?.[1] ?? "";

  it("stores one hashed edit lease per exact contract version", () => {
    const lease = model("ContractDraftEditLease");
    expect(lease).toMatch(/contractVersionId\s+String\s+@id/u);
    expect(lease).toMatch(/tokenHash\s+String\s+@unique/u);
    expect(lease).toMatch(/leaseRevision\s+Int\s+@default\(1\)/u);
    expect(lease).not.toMatch(/\btoken\s+String/u);
  });

  it("stores ordered draft attachments without allowing duplicate slot files", () => {
    const attachment = model("ContractDraftAttachment");
    expect(attachment).toContain("@@unique([contractVersionId, slotKey, displayOrder])");
    expect(attachment).toContain("@@unique([contractVersionId, slotKey, fileId])");
    expect(attachment).toContain("@@index([fileId])");
    expect(migration).toContain(
      "('ContractDraftAttachment','fileId',FALSE)"
    );
    expect(migration).toContain(
      "CREATE TRIGGER jg_efb_contract_draft_attachment"
    );
  });

  it("stores expiring authoritative save receipts and durable submission receipts", () => {
    const saveRequest = model("ContractDraftSaveRequest");
    expect(saveRequest).toMatch(/idempotencyKey\s+String\s+@id/u);
    expect(saveRequest).toMatch(/requestSha256\s+String/u);
    expect(saveRequest).toMatch(/resultRevision\s+Int/u);
    expect(saveRequest).toMatch(/responseSnapshot\s+Json/u);
    expect(saveRequest).toContain("@@index([expiresAt])");

    const submissionRequest = model("ContractDraftSubmissionRequest");
    expect(submissionRequest).toMatch(/idempotencyKey\s+String\s+@id/u);
    expect(submissionRequest).toMatch(/approvalInstanceId\s+String\s+@unique/u);
    expect(submissionRequest).toMatch(/formalCode\s+String/u);
    expect(submissionRequest).toMatch(/responseSnapshot\s+Json/u);
  });

  it("marks first successful submission and the latest successful preview", () => {
    const version = model("ContractVersion");
    expect(version).toMatch(/firstSubmittedAt\s+DateTime\?/u);
    expect(version).toMatch(/latestDraftPreviewDocumentId\s+String\?/u);
  });

  it("creates only additive tables and columns with restrictive business foreign keys", () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/u);
    expect(migration.trimEnd()).toMatch(/COMMIT;$/u);
    for (const table of [
      "ContractDraftEditLease",
      "ContractDraftAttachment",
      "ContractDraftSaveRequest",
      "ContractDraftSubmissionRequest"
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(migration).toContain('ADD COLUMN "firstSubmittedAt" TIMESTAMP(3)');
    expect(migration).toContain('ADD COLUMN "latestDraftPreviewDocumentId" TEXT');
    expect(migration).toContain(
      'CREATE INDEX "ContractDraftSaveRequest_expiresAt_idx"'
    );
    expect(migration).not.toMatch(
      /(?:^|;)\s*(?:UPDATE|DELETE|TRUNCATE|DROP TABLE)\b/imu
    );

    const foreignKeys = migration.match(
      /FOREIGN KEY \("[^"]+"\) REFERENCES "[^"]+"\("[^"]+"\)\s+ON DELETE [A-Z]+/gu
    ) ?? [];
    expect(foreignKeys.length).toBeGreaterThanOrEqual(11);
    expect(foreignKeys.every((foreignKey) => foreignKey.endsWith("ON DELETE RESTRICT"))).toBe(
      true
    );
  });
});
