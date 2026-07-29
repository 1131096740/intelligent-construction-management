import { readFileSync } from "node:fs";
import { join } from "node:path";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260728136000_project_upstream_fund_facts/migration.sql"
  ),
  "utf8"
);

function model(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`missing ${name}`);
  return match[1];
}

describe("project upstream fund fact schema", () => {
  it("stores each upstream money meaning as an append-only fact with independent status", () => {
    const upstreamFundFact = model("ProjectUpstreamFundFact");

    expect(upstreamFundFact).toContain("factType");
    expect(upstreamFundFact).toContain("entryKind");
    expect(upstreamFundFact).toContain("adjustsFactId");
    expect(upstreamFundFact).toContain("effectDirection");
    expect(upstreamFundFact).toContain("deductionCategory");
    expect(upstreamFundFact).toContain("idempotencyKey");
    expect(migration).toContain("'owner_payment_to_affiliate'");
    expect(migration).toContain("'affiliate_remittance_to_company'");
    expect(migration).toContain("'affiliate_deduction'");
    expect(migration).toContain("'unreconciled_receipt_difference'");
    expect(migration).toContain("ProjectUpstreamFundFact_single_reversal_idx");
    expect(migration).toContain("ProjectUpstreamFundFact_append_only");
    expect(migration).toContain("BEFORE UPDATE OR DELETE");
    expect(migration).toContain("upstream fund facts cannot be deleted");
  });

  it("requires complete written evidence and a frozen signature tuple before confirmation", () => {
    expect(migration).toContain('"basisType" = \'written\'');
    expect(migration).toContain('"fileContentSha256Snapshot" IS NOT NULL');
    expect(migration).toContain('"confirmationActionId" IS NOT NULL');
    expect(migration).toContain('"confirmationSignatureVersionId" IS NOT NULL');
    expect(migration).toContain('"confirmationSignatureFileId" IS NOT NULL');
    expect(migration).toContain('length("confirmationSignatureSha256") = 64');
  });

  it("registers evidence and signature files with the shared private-file guard", () => {
    expect(migration).toContain(
      "('ProjectUpstreamFundFact','evidenceFileId',FALSE)"
    );
    expect(migration).toContain(
      "('ProjectUpstreamFundFact','confirmationSignatureFileId',FALSE)"
    );
    expect(migration).toContain(
      'BEFORE INSERT OR UPDATE OF "evidenceFileId"'
    );
    expect(migration).toContain(
      'BEFORE INSERT OR UPDATE OF "confirmationSignatureFileId"'
    );
  });
});
