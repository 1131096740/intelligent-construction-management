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
});
