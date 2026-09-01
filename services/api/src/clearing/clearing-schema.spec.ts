import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("POL-11A clearing schema artifact", () => {
  const schema = readFileSync(join(__dirname, "../../prisma/schema.prisma"), "utf8");
  const migration = readFileSync(
    join(
      __dirname,
      "../../prisma/migrations/20260826193000_pol11a_clearing_core/migration.sql"
    ),
    "utf8"
  );
  const authorityMigration = readFileSync(
    join(
      __dirname,
      "../../prisma/migrations/20260901090000_pol214_affiliate_clearing_authority/migration.sql"
    ),
    "utf8"
  );

  it("keeps stable case/event identities separate from immutable submitted versions", () => {
    expect(schema).toContain("model ClearingCase {");
    expect(schema).toContain("model ClearingEvent {");
    expect(schema).toContain("model ClearingEventVersion {");
    expect(schema).toContain("@@unique([clearingEventId, versionNo])");
    expect(schema).toContain("ClearingCase_natural_key");
  });

  it("persists explicit allocations, ledger links and actor-bound idempotency receipts", () => {
    expect(schema).toContain("model ClearingAllocation {");
    expect(schema).toContain("sourceEventVersionId");
    expect(schema).toContain("model ClearingImpactLink {");
    expect(schema).toContain("model ClearingCommandReceipt {");
    expect(schema).toContain("delegatorUserId");
    expect(schema).toContain("fingerprint");
    expect(migration).toContain("ClearingEventVersion_previousVersionId_fkey");
    expect(migration).toContain("ClearingImpactLink_operatingFactId_fkey");
    expect(migration).toContain("ClearingImpactLink_operatingImpactId_fkey");
    expect(migration).toContain("ClearingImpactLink_reversesImpactId_fkey");
  });

  it("persists a named append-only B-level evidence attestation", () => {
    expect(schema).toContain("model ClearingEvidenceAttestation {");
    expect(schema).toContain("attesterActorSetSnapshot");
    expect(migration).toContain("CREATE TABLE \"ClearingEvidenceAttestation\"");
    expect(migration).toContain("ClearingEvidenceAttestation_eventVersionId_key");
    expect(migration).toContain('CREATE TRIGGER "ClearingEvidenceAttestation_immutable"');
  });

  it("keeps clearing delegation fail-closed on an exact action and resource", () => {
    expect(schema).toContain("actionKey    String?");
    expect(schema).toContain("resourceType String?");
    expect(schema).toContain("resourceId   String?");
    expect(migration).toContain("ApprovalDelegation_scope_all_or_none");
    expect(migration).toContain("ApprovalDelegation_scoped_lookup_idx");
  });

  it("makes frozen evidence append-only at the database artifact boundary", () => {
    for (const table of [
      "ClearingEventVersion",
      "ClearingEvidenceAttestation",
      "ClearingConfirmation",
      "ClearingAllocation",
      "ClearingImpactLink",
      "ClearingCommandReceipt"
    ]) {
      expect(migration).toContain(`CREATE TRIGGER "${table}_immutable"`);
    }
    expect(migration).toContain("BEFORE UPDATE OR DELETE");
  });

  it("defines the minimum immutable authority source layer without reusing #105 wage models", () => {
    expect(schema).toContain("model AffiliateClearingAuthorityVersion {");
    expect(schema).toContain("model AssignedWageAuthorityLine {");
    expect(schema).toContain("model GuaranteeObligationVersion {");
    expect(schema).toContain("authoritySnapshotRef");
    expect(schema).toContain("wageMonth                          DateTime @db.Date");
    expect(schema).toContain("coverageKind                       String");
    expect(authorityMigration).toContain('CREATE TABLE "AffiliateClearingAuthorityVersion"');
    expect(authorityMigration).toContain('CREATE TABLE "AssignedWageAuthorityLine"');
    expect(authorityMigration).toContain('CREATE TABLE "GuaranteeObligationVersion"');
    expect(authorityMigration).toContain('CONSTRAINT "AssignedWageAuthorityLine_natural_key" UNIQUE');
    expect(authorityMigration).toContain("POL-214 confirmed authority rows are immutable");
    expect(authorityMigration).toContain("POL-214 guarantee obligation effective ranges overlap");
    expect(authorityMigration).toContain("pg_advisory_xact_lock");
  });

  it("keeps authority lifecycle and child coverage fail-closed", () => {
    expect(authorityMigration).toContain("'draft', 'submitted', 'confirmed', 'returned'");
    expect(authorityMigration).toContain("'PERSON', 'ROLE_SUMMARY'");
    expect(authorityMigration).toContain('"personAuthorityKey" IS NULL');
    expect(authorityMigration).toContain("AssignedWageAuthorityLine_parent_consistency");
    expect(authorityMigration).toContain("GuaranteeObligationVersion_nonoverlap");
    expect(authorityMigration).toContain('"ClearingCase_authority_fields_check"');
  });
});
