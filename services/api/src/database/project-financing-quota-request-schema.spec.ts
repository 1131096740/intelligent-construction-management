import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const apiRoot = resolve(__dirname, "../..");
const schema = readFileSync(resolve(apiRoot, "prisma/schema.prisma"), "utf8");
const migrationsPath = resolve(apiRoot, "prisma/migrations");
const migrationName = "20260802010000_project_financing_quota_request_idempotency";
const migrationPath = resolve(migrationsPath, migrationName, "migration.sql");

function model(name: string) {
  return schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, "u"))?.[1] ?? "";
}

describe("project financing quota request schema", () => {
  it("keeps a forward-only 115th migration without fabricating legacy request facts", () => {
    const names = readdirSync(migrationsPath)
      .filter((name) => /^\d/u.test(name))
      .sort();
    expect(names).toHaveLength(115);
    expect(names.at(-1)).toBe(migrationName);

    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).toMatch(/\nBEGIN;\n/u);
    expect(migration).toMatch(/COMMIT;\s*$/u);
    expect(migration).not.toMatch(
      /\b(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM|UPDATE\s+"ProjectFinancingQuota")\b/iu
    );
    expect(migration).not.toMatch(
      /ALTER\s+COLUMN\s+"(?:requestIdempotencyKey|requestFingerprint|attachmentFileSha256Snapshot|requestedByRoleKey)"\s+SET\s+NOT\s+NULL/iu
    );
  });

  it("stores an all-or-none immutable request snapshot for new quota applications", () => {
    const quota = model("ProjectFinancingQuota");
    expect(quota).toContain("requestIdempotencyKey");
    expect(quota).toContain("requestFingerprint");
    expect(quota).toContain("attachmentFileSha256Snapshot");
    expect(quota).toContain("requestedByRoleKey");
    expect(quota).toMatch(/requestIdempotencyKey\s+String\?\s+@unique/u);

    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ProjectFinancingQuota_requestIdempotencyKey_key"'
    );
    expect(migration).toMatch(
      /ProjectFinancingQuota_request_snapshot_check[\s\S]*?requestIdempotencyKey[\s\S]*?requestFingerprint[\s\S]*?attachmentFileSha256Snapshot[\s\S]*?requestedByRoleKey/u
    );
    expect(migration).toMatch(
      /attachmentFileSha256Snapshot" IS NOT NULL[\s\S]*?requestedByRoleKey" IS NOT NULL[\s\S]*?requestIdempotencyKey" IS NOT NULL[\s\S]*?requestFingerprint" IS NOT NULL/u
    );
    expect(migration).toMatch(/\^\[0-9a-f\]\{64\}\$/u);
    expect(migration).toMatch(/finance_staff[\s\S]*finance_director/u);
    expect(migration).toContain("project_financing_quota_request_insert_guard");
    expect(migration).toContain("ProjectFinancingQuota_request_snapshot_required");
    expect(migration).toContain("project_financing_quota_request_immutable_guard");
    expect(migration).toContain("ProjectFinancingQuota_request_immutable");
    expect(migration).toContain("project_financing_quota_delete_guard");
    expect(migration).toMatch(
      /ProjectFinancingQuota_delete_guard[\s\S]*?BEFORE DELETE ON "ProjectFinancingQuota"/u
    );
  });

  it("enforces the exact namespace and at most one lifecycle approval instance", () => {
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ApprovalInstance_project_financing_quota_lifecycle_key"'
    );
    expect(migration).toContain(
      'CONSTRAINT "ApprovalInstance_project_financing_quota_flow_check"'
    );
    expect(migration).toMatch(
      /ApprovalInstance_project_financing_quota_flow_check[\s\S]*?"businessType" <> 'project_financing_quota'[\s\S]*?"flowType" = 'project_financing_quota\.approve'/u
    );
    expect(migration).toMatch(
      /ApprovalInstance_project_financing_quota_lifecycle_key[\s\S]*?WHERE "businessType" = 'project_financing_quota'/u
    );
  });

  it("keeps every new request attachment globally exclusive in both binding directions", () => {
    const migration = readFileSync(migrationPath, "utf8");
    expect(migration).toContain("project_financing_quota_request_migration_requires_quiescence");
    expect(migration).toContain("pg_try_advisory_xact_lock(190731, 13)");
    expect(model("ProjectFinancingQuota")).toMatch(
      /attachmentFileId\s+String\s+@unique/u
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ProjectFinancingQuota_attachmentFileId_key"'
    );
    expect(migration).toMatch(
      /jg_file_business_binding_columns_before_project_financing_quota_request[\s\S]*?"tableName" = 'ProjectFinancingQuota'[\s\S]*?"columnName" = 'attachmentFileId' THEN TRUE/u
    );
    expect(migration).toContain(
      "project_financing_quota_cross_business_attachment"
    );
    expect(migration).toContain(
      "jg_efb_project_financing_quota_request_attachment"
    );
    expect(migration).toMatch(
      /jg_enforce_exclusive_file_business_binding\(\s*'attachmentFileId',\s*'true'\s*\)/u
    );
    expect(migration).toMatch(
      /jg_enforce_exclusive_file_business_binding\(\s*'terminationSignatureFileId',\s*'false'\s*\)/u
    );
  });
});
