import { readFileSync } from "node:fs";
import { join } from "node:path";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260728137000_project_affiliate_business_facts/migration.sql"
  ),
  "utf8"
);

function model(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`missing ${name}`);
  return match[1];
}

describe("project affiliate business fact schema", () => {
  it("separates external contract, settlement, and payment facts from company approvals", () => {
    expect(model("ProjectAffiliateContractFact")).toContain("ledgerId");
    expect(model("ProjectAffiliateSettlementFact")).toContain("contractLedgerId");
    expect(model("ProjectAffiliatePaymentFact")).toContain("settlementLedgerId");
    expect(migration).not.toContain('INSERT INTO "ApprovalInstance"');
  });

  it("keeps confirmed facts append-only and protects one reversal per ledger entry", () => {
    expect(migration).toContain("ProjectAffiliateContractFact_append_only");
    expect(migration).toContain("ProjectAffiliateSettlementFact_append_only");
    expect(migration).toContain("ProjectAffiliatePaymentFact_append_only");
    expect(migration).toContain("ProjectAffiliateContractFact_single_reversal_idx");
    expect(migration).toContain("ProjectAffiliateSettlementFact_single_reversal_idx");
    expect(migration).toContain("ProjectAffiliatePaymentFact_single_reversal_idx");
  });

  it("makes external evidence exclusive across projects and business facts", () => {
    expect(model("ProjectAffiliateBusinessEvidence")).toContain("fileId");
    expect(migration).toContain(
      "('ProjectAffiliateContractFact','evidenceFileId',TRUE)"
    );
    expect(migration).toContain(
      "('ProjectAffiliateSettlementFact','evidenceFileId',TRUE)"
    );
    expect(migration).toContain(
      "('ProjectAffiliatePaymentFact','evidenceFileId',TRUE)"
    );
    expect(migration).toContain(
      "('ProjectAffiliateBusinessEvidence','fileId',TRUE)"
    );
  });

  it("deduplicates original external payments by their frozen external reference", () => {
    expect(model("ProjectAffiliatePaymentFact")).toContain(
      "externalPaymentReference"
    );
    expect(migration).toContain(
      "ProjectAffiliatePaymentFact_externalPaymentReference_original_key"
    );
  });
});
