import { readFileSync } from "node:fs";
import { join } from "node:path";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260728135000_project_external_upstream_facts/migration.sql"
  ),
  "utf8"
);

function model(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`missing ${name}`);
  return match[1];
}

describe("project external owner-contract and upstream-settlement schema", () => {
  it("freezes the formal owner-contract document version and digest", () => {
    const ownerContract = model("ProjectOwnerContract");

    expect(ownerContract).toContain("documentVersion");
    expect(ownerContract).toContain("fileContentSha256Snapshot");
    expect(migration).toContain(
      'SET "fileContentSha256Snapshot" = file_object."contentSha256"'
    );
    expect(migration).toContain("ProjectOwnerContract_external_confirmation_check");
    expect(migration).toContain('"fileContentSha256Snapshot" IS NOT NULL');
  });

  it("separates upstream settlement recording from independent signed confirmation", () => {
    const upstreamSettlement = model("ProjectUpstreamSettlement");

    expect(upstreamSettlement).toContain("status");
    expect(upstreamSettlement).toContain("documentVersion");
    expect(upstreamSettlement).toContain("fileContentSha256Snapshot");
    expect(upstreamSettlement).toContain("confirmedByUserId");
    expect(upstreamSettlement).toContain("confirmedAt");
    expect(upstreamSettlement).toContain("confirmationSignatureVersionId");
    expect(upstreamSettlement).toContain("confirmationSignatureFileId");
    expect(upstreamSettlement).toContain("confirmationSignatureSha256");
    expect(migration).toContain("'legacy_recorded'");
    expect(migration).toContain("ProjectUpstreamSettlement_confirmation_check");
    expect(migration).toContain('"fileContentSha256Snapshot" IS NOT NULL');
  });
});
