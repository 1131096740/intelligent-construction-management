import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const apiRoot = resolve(__dirname, "../..");
const schema = readFileSync(resolve(apiRoot, "prisma/schema.prisma"), "utf8");
const migrationsPath = resolve(apiRoot, "prisma/migrations");
const migrationName = "20260728138000_project_affiliate_company_contract";
const migration = readFileSync(
  resolve(migrationsPath, migrationName, "migration.sql"),
  "utf8"
);

function model(name: string) {
  return schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`, "u"))?.[1] ?? "";
}

describe("project affiliate-company offline contract schema", () => {
  it("adds the next forward-only migration and immutable contract ledger", () => {
    const names = readdirSync(migrationsPath)
      .filter((name) => /^\d/u.test(name))
      .sort();
    expect(names).toContain(migrationName);
    expect(migration).toMatch(/\nBEGIN;\n/u);
    expect(migration).toMatch(/COMMIT;\s*$/u);
    expect(migration).not.toMatch(/\b(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM)\b/iu);

    const contract = model("ProjectAffiliateCompanyContract");
    expect(contract).toContain("affiliateAssignmentId");
    expect(contract).toContain("affiliateBusinessPartyVersionId");
    expect(contract).toContain("companyEntityVersionId");
    expect(contract).toContain("fileContentSha256Snapshot");
    expect(contract).toContain("confirmationSignatureVersionId");
    expect(contract).toContain("@@unique([projectId, contractReference])");
  });

  it("enforces frozen file, complete confirmation signature and append-only history", () => {
    expect(migration).toContain(
      'CONSTRAINT "ProjectAffiliateCompanyContract_fileId_key" UNIQUE ("fileId")'
    );
    expect(migration).toMatch(
      /ProjectAffiliateCompanyContract_file_sha256_check[\s\S]*?\^\[0-9a-f\]\{64\}\$/u
    );
    expect(migration).toMatch(
      /ProjectAffiliateCompanyContract_confirmation_check[\s\S]*?"confirmationSignatureVersionId"[\s\S]*?"confirmationSignatureFileId"[\s\S]*?"confirmationSignatureSha256"/u
    );
    expect(migration).toContain(
      "project_affiliate_company_contract_immutable_guard"
    );
    expect(migration).toContain(
      "project_affiliate_company_contract_delete_guard"
    );
  });
});
