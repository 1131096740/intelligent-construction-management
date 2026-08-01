import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const apiRoot = resolve(__dirname, "../..");
const schema = readFileSync(resolve(apiRoot, "prisma/schema.prisma"), "utf8");
const migrationsPath = resolve(apiRoot, "prisma/migrations");
const migrationName =
  "20260802020000_project_financing_quota_termination_idempotency";
const migration = readFileSync(
  resolve(migrationsPath, migrationName, "migration.sql"),
  "utf8"
);

function model(name: string) {
  return schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, "u"))?.[1] ?? "";
}

describe("project financing quota termination schema", () => {
  it("keeps a forward-only 116th migration with no legacy fact fabrication", () => {
    const names = readdirSync(migrationsPath)
      .filter((name) => /^\d/u.test(name))
      .sort();
    expect(names).toHaveLength(116);
    expect(names.at(-1)).toBe(migrationName);
    expect(migration).toMatch(/\nBEGIN;\n/u);
    expect(migration).toMatch(/COMMIT;\s*$/u);
    expect(migration).not.toMatch(
      /\b(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM|UPDATE\s+"ProjectFinancingQuota")\b/iu
    );
    expect(migration).not.toMatch(/ALTER\s+COLUMN[\s\S]*?SET\s+NOT\s+NULL/iu);
  });

  it("stores a nullable unique action id and paired request fingerprint", () => {
    const quota = model("ProjectFinancingQuota");
    expect(quota).toMatch(/terminationActionId\s+String\?\s+@unique/u);
    expect(quota).toMatch(/terminationRequestFingerprint\s+String\?/u);
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ProjectFinancingQuota_terminationActionId_key"'
    );
    expect(migration).toMatch(
      /termination_idempotency_check[\s\S]*?terminationActionId" IS NULL[\s\S]*?terminationRequestFingerprint" IS NULL[\s\S]*?OR[\s\S]*?status" = 'terminated'/u
    );
    expect(migration).toMatch(
      /status" = 'terminated'[\s\S]*?terminationActionId" IS NOT NULL[\s\S]*?terminationRequestFingerprint" IS NOT NULL/u
    );
    expect(migration).toMatch(/\^\[0-9a-f\]\{64\}\$/u);
    expect(migration).toMatch(/-4\[0-9a-f\]\{3\}-\[89ab\]/u);
  });

  it("fails fast when the quota table is not quiescent", () => {
    expect(migration).toContain(
      "project_financing_quota_termination_migration_requires_quiescence"
    );
    expect(migration).toContain("pg_try_advisory_xact_lock(190731, 14)");
    expect(migration).toMatch(
      /LOCK TABLE "ProjectFinancingQuota" IN ACCESS EXCLUSIVE MODE NOWAIT/u
    );
  });

  it("requires durable facts for new terminal transitions and freezes every terminal fact", () => {
    expect(migration).toContain("project_financing_quota_termination_guard");
    expect(migration).toMatch(
      /IF TG_OP = 'INSERT' THEN[\s\S]*?NEW\."status" = 'terminated'[\s\S]*?terminationActionId[\s\S]*?terminationRequestFingerprint/u
    );
    expect(migration).toMatch(
      /ELSIF TG_OP = 'UPDATE' THEN[\s\S]*?OLD\."status" IS DISTINCT FROM 'terminated'[\s\S]*?terminationActionId[\s\S]*?terminationRequestFingerprint/u
    );
    expect(migration).toMatch(
      /OLD\."status" = 'terminated'[\s\S]*?NEW\."terminatedAt"[\s\S]*?NEW\."terminatedByUserId"[\s\S]*?NEW\."terminationReason"[\s\S]*?NEW\."terminationSignatureFileId"[\s\S]*?NEW\."terminationSignatureSha256"[\s\S]*?NEW\."terminationSignatureVersionId"[\s\S]*?NEW\."terminationActionId"[\s\S]*?NEW\."terminationRequestFingerprint"/u
    );
    expect(migration).toMatch(
      /BEFORE INSERT OR UPDATE ON "ProjectFinancingQuota"/u
    );
  });
});
