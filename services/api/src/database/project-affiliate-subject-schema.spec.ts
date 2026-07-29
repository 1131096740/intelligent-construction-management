import { readFileSync } from "node:fs";
import { join } from "node:path";

const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260728133000_project_affiliate_subject_foundation/migration.sql"
  ),
  "utf8"
);
const upstreamMigration = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260728134000_project_affiliate_upstream_snapshots/migration.sql"
  ),
  "utf8"
);

function model(name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`missing ${name}`);
  return match[1];
}

describe("project affiliate and contract subject schema", () => {
  it("keeps immutable affiliate assignments and allows only one current assignment per project", () => {
    const assignment = model("ProjectAffiliateAssignment");

    expect(assignment).toContain("projectId");
    expect(assignment).toContain("businessPartyId");
    expect(assignment).toContain("businessPartyVersionId");
    expect(assignment).toContain("affiliateNameSnapshot");
    expect(assignment).toContain("affiliateCreditCodeSnapshot");
    expect(assignment).toContain("effectiveFrom");
    expect(assignment).toContain("endedAt");
    expect(assignment).toContain("changeReason");
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "ProjectAffiliateAssignment_one_current_per_project"'
    );
    expect(migration).toContain('WHERE "endedAt" IS NULL');
  });

  it("freezes downstream signing subjects and owner-contract affiliate parties", () => {
    const contractVersion = model("ContractVersion");
    const ownerContract = model("ProjectOwnerContract");

    expect(contractVersion).toContain("signingSubjectType");
    expect(contractVersion).toContain("affiliateAssignmentId");
    expect(contractVersion).toContain("affiliateBusinessPartyVersionId");
    expect(contractVersion).toContain("affiliateNameSnapshot");
    expect(ownerContract).toContain("affiliateAssignmentId");
    expect(ownerContract).toContain("affiliateBusinessPartyVersionId");
    expect(ownerContract).toContain("affiliateNameSnapshot");
    expect(migration).toContain("ContractVersion_signing_subject_check");
    expect(migration).toContain("'affiliate', 'our_company'");
  });

  it("freezes payment subjects instead of inferring them from the current project mapping", () => {
    expect(model("PaymentRequest")).toContain("paymentSubjectType");
    expect(model("PaymentExecution")).toContain("paymentSubjectType");
    expect(model("ProjectProxyPayment")).toContain("paymentSubjectType");
    expect(model("ProjectProxyPayment")).toContain("affiliateAssignmentId");
    expect(model("ProjectProxyPayment")).toContain("affiliateBusinessPartyVersionId");
    expect(model("ProjectProxyPayment")).toContain("affiliateNameSnapshot");
    expect(model("ProjectReceipt")).toContain("affiliateAssignmentId");
    expect(model("ProjectReceipt")).toContain("affiliateBusinessPartyVersionId");
    expect(model("ProjectUpstreamSettlement")).toContain("affiliateAssignmentId");
    expect(model("ProjectUpstreamSettlement")).toContain("affiliateBusinessPartyVersionId");
    expect(upstreamMigration).toContain("ProjectReceipt_affiliate_snapshot_check");
    expect(upstreamMigration).toContain("ProjectUpstreamSettlement_affiliate_snapshot_check");
  });
});
