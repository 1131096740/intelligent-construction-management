import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function expectArtifactContains(
  artifactName: string,
  artifact: string,
  expectedTokens: readonly string[]
) {
  const missing = expectedTokens.filter((token) => !artifact.includes(token));
  expect({ artifactName, missing }).toEqual({ artifactName, missing: [] });
}

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
  const reconciliationMigrationPath = join(
    __dirname,
    "../../prisma/migrations/20260909100000_pol275_clearing_reconciliation_repair/migration.sql"
  );
  const reconciliationMigration = existsSync(reconciliationMigrationPath)
    ? readFileSync(reconciliationMigrationPath, "utf8")
    : "";

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
    expect(schema).toMatch(/wageMonth\s+DateTime\s+@db\.Date/u);
    expect(schema).toMatch(/coverageKind\s+String/u);
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

  it("seals the seven append-only reconciliation relations behind one controlled writer", () => {
    const modelTokens: string[] = [];
    const migrationTokens: string[] = [];
    for (const model of [
      "ClearingReconciliationItem",
      "ClearingReconciliationRevision",
      "ClearingReconciliationCoverage",
      "ClearingReconciliationResolution",
      "ClearingReconciliationDefinitionReversal",
      "ClearingReconciliationResolutionLine",
      "ClearingReconciliationDecisionSeal"
    ]) {
      modelTokens.push(`model ${model} {`);
      migrationTokens.push(`CREATE TABLE "${model}"`);
      migrationTokens.push(`CREATE TRIGGER "${model}_pol275_immutable"`);
    }
    modelTokens.push("@@unique([id, clearingCaseId])");
    migrationTokens.push(
      '"ClearingEventVersion_id_clearingCaseId_key"',
      '"ClearingAllocation_no_self_reversal"',
      "ON DELETE RESTRICT ON UPDATE RESTRICT",
      'CREATE OR REPLACE FUNCTION "pol214_clearing_allocation_guard"()',
      "pg_catalog.pg_advisory_xact_lock",
      "coverage_relief := coverage_relief + NEW.\"amountCents\"",
      "revision 有效覆盖超过当前未解决金额",
      "新核对事件确认必须使用 V1 意图并同事务封印",
      'CREATE FUNCTION "pol275_clearing_impact_link_guard"()',
      'CREATE TRIGGER "ClearingImpactLink_pol275_insert_guard"',
      'CREATE CONSTRAINT TRIGGER "ClearingImpactLink_pol275_v1_closure"',
      'CREATE FUNCTION "pol275_utf16_sort_key_v1"',
      'CREATE FUNCTION "pol275_jcs_v1"',
      'CREATE FUNCTION "pol275_relation_set_hash_v1"',
      "'pol275/relation-set/V1' || chr(10) || public.\"pol275_jcs_v1\"",
      'CREATE FUNCTION "pol275_jsonb_is_cents_v1"',
      'CREATE FUNCTION "pol275_jsonb_is_positive_integer_v1"',
      'POL-275 operation 分支不互斥或包含无关关系',
      'POL-275 plannedIds 的 item/revision ID 与冻结定义不闭合',
      'POL-275 解决行与 eventAllocations 完整计划不闭合',
      'CREATE FUNCTION "pol275_append_reconciliation_set"',
      "SECURITY DEFINER",
      "SET search_path = pg_catalog, public, pg_temp",
      "DEFERRABLE INITIALLY DEFERRED",
      'REVOKE ALL ON FUNCTION "pol275_append_reconciliation_set"(TEXT, TEXT) FROM PUBLIC',
      'REVOKE ALL ON FUNCTION "pol275_jcs_v1"(JSONB) FROM PUBLIC',
      "REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE",
      'GRANT EXECUTE ON FUNCTION "pol275_append_reconciliation_set"(TEXT, TEXT)',
      'CREATE ROLE "jg_pol275_owner" NOLOGIN NOINHERIT',
      'CREATE ROLE "jg_pol275_runtime" NOLOGIN NOINHERIT'
    );
    expectArtifactContains("schema.prisma", schema, modelTokens);
    expectArtifactContains("POL-275 migration", reconciliationMigration, migrationTokens);
  });
});
