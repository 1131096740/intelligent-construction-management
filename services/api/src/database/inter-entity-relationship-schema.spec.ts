import { readFileSync } from "node:fs";
import { join } from "node:path";

const migrationRoot = join(__dirname, "../../prisma/migrations");
const relationshipMigration = readFileSync(
  join(migrationRoot, "20260828070000_pol13b_inter_entity_relationship/migration.sql"),
  "utf8"
);
const guardMigration = readFileSync(
  join(migrationRoot, "20260828071000_pol13b_proxy_scope_guards/migration.sql"),
  "utf8"
);
const attestationMigration = readFileSync(
  join(migrationRoot, "20260828073000_pol13b_payer_attestation_lineage/migration.sql"),
  "utf8"
);
const sourceSnapshotMigration = readFileSync(
  join(migrationRoot, "20260828074000_pol13b_relationship_source_snapshot/migration.sql"),
  "utf8"
);
const authorityMigration = readFileSync(
  join(migrationRoot, "20260828080000_pol13b_payer_authority_and_relation_guards/migration.sql"),
  "utf8"
);

describe("POL-13B inter-entity relationship schema", () => {
  it("keeps the relationship append-only and draft-first at the database boundary", () => {
    expect(relationshipMigration).toContain('CREATE TABLE "InterEntityRelationshipEntry"');
    expect(relationshipMigration).toContain('IF TG_OP = \'INSERT\' THEN\n    NEW."status" := \'draft\';');
    expect(relationshipMigration).toContain("inter_entity_relationship_entry_immutable");
    expect(relationshipMigration).toContain('"entryKind" = \'proxy_payment\'');
    expect(relationshipMigration).toContain('"entryKind" = \'proxy_return\'');
    expect(relationshipMigration).toContain('"InterEntityRelationshipEntry_case_kind_key"');
  });

  it("allows the explicitly authorized cross-company proxy while retaining project and source guards", () => {
    expect(guardMigration).toContain(
      "CREATE OR REPLACE FUNCTION guard_payable_settlement_allocation_source()"
    );
    expect(guardMigration).toContain(
      "CREATE OR REPLACE FUNCTION guard_payment_execution_wage_payable_binding_scope()"
    );
    expect(guardMigration).toContain(
      'IF request_project_id IS DISTINCT FROM NEW."beneficiaryProjectId" THEN'
    );
    expect(guardMigration).toContain(
      'OR request_project_id IS DISTINCT FROM NEW."projectId" THEN'
    );
    expect(guardMigration).not.toContain(
      'execution_company_entity_id IS DISTINCT FROM NEW."debtorCompanyId"'
    );
    expect(guardMigration).not.toContain(
      'contract_company_entity_id IS DISTINCT FROM NEW."debtorCompanyId"'
    );
    expect(guardMigration).toContain("payable_settlement_source_snapshot_invalid");
    expect(guardMigration).toContain("payment_execution_wage_binding_source_invalid");
    expect(attestationMigration).toContain(
      "CREATE OR REPLACE FUNCTION guard_payable_settlement_allocation_source()"
    );
    expect(attestationMigration).toContain(
      "CREATE OR REPLACE FUNCTION guard_payment_execution_wage_payable_binding_scope()"
    );
    expect(attestationMigration).toContain(
      'CREATE TRIGGER "PayableSettlementAllocation_source_guard"'
    );
    expect(attestationMigration).toContain(
      'CREATE TRIGGER "PaymentExecutionWagePayableBinding_scope_guard"'
    );
    expect(attestationMigration).not.toContain(
      'execution_company_entity_id IS DISTINCT FROM NEW."debtorCompanyId"'
    );
    expect(attestationMigration).not.toContain(
      'contract_company_entity_id IS DISTINCT FROM NEW."debtorCompanyId"'
    );
    expect(attestationMigration).toContain(
      'request_project_id IS DISTINCT FROM NEW."beneficiaryProjectId"'
    );
    expect(attestationMigration).toContain(
      'request_project_id IS DISTINCT FROM NEW."projectId"'
    );
  });

  it("binds cross-entity subjects to verified payer and consumed return evidence", () => {
    expect(attestationMigration).toContain(
      'CREATE TABLE "PaymentExecutionPayerAttestation"'
    );
    expect(attestationMigration).toContain(
      'CREATE TABLE "InterEntityRelationshipEvidenceClaim"'
    );
    expect(attestationMigration).toContain(
      'CREATE OR REPLACE FUNCTION guard_inter_entity_relationship_entry()'
    );
    expect(attestationMigration).toContain(
      'attestation_record."holderCompanyEntityId" IS DISTINCT FROM NEW."creditorCompanyId"'
    );
    expect(attestationMigration).toContain(
      "inter_entity_relationship_return_evidence_claim_invalid"
    );
    expect(attestationMigration).not.toContain(
      'execution_company_entity_id IS DISTINCT FROM NEW."debtorCompanyId"'
    );
    expect(attestationMigration).not.toContain(
      'contract_company_entity_id IS DISTINCT FROM NEW."debtorCompanyId"'
    );
  });

  it("freezes source, contract and allocation snapshots on the confirmed root", () => {
    expect(sourceSnapshotMigration).toContain(
      'ADD COLUMN "projectId" TEXT'
    );
    expect(sourceSnapshotMigration).toContain(
      'ADD COLUMN "contractVersionId" TEXT'
    );
    expect(sourceSnapshotMigration).toContain(
      'ADD COLUMN "sourceAllocationCount" INTEGER'
    );
    expect(sourceSnapshotMigration).toContain(
      'ADD COLUMN "sourceAllocationAmountCents" BIGINT'
    );
    expect(sourceSnapshotMigration).toContain(
      "inter_entity_relationship_source_contract_snapshot_invalid"
    );
    expect(sourceSnapshotMigration).toContain(
      "inter_entity_relationship_source_allocation_snapshot_invalid"
    );
    expect(sourceSnapshotMigration).toContain(
      "inter_entity_relationship_return_source_snapshot_invalid"
    );
    expect(sourceSnapshotMigration).toContain(
      'CREATE TRIGGER "zz_inter_entity_relationship_source_snapshot_guard"'
    );
  });

  it("keeps payer authority, evidence SoD and cross-company lineage fail-closed at the database boundary", () => {
    expect(authorityMigration).toContain(
      'CREATE TABLE "PaymentExecutionPayerVerification"'
    );
    expect(authorityMigration).toContain(
      'CREATE TABLE "PaymentExecutionPayerVerificationIssuerContext"'
    );
    expect(authorityMigration).toContain(
      'CREATE FUNCTION "jg_issue_payment_execution_payer_verification"(p_payload JSONB)'
    );
    expect(authorityMigration).toContain(
      'CREATE ROLE "jg_payment_execution_payer_issuer" NOLOGIN NOINHERIT'
    );
    expect(authorityMigration).toContain(
      'GRANT EXECUTE ON FUNCTION "jg_issue_payment_execution_payer_verification"(JSONB)'
    );
    expect(authorityMigration).toContain(
      'GRANT EXECUTE ON FUNCTION "jg_issue_payment_execution_payer_verification_trusted"(JSONB)'
    );
    expect(authorityMigration).toContain(
      'CREATE UNIQUE INDEX "PaymentExecutionPayerVerification_source_key"'
    );
    expect(authorityMigration).toContain(
      'payment_execution_payer_verification_issuer_required'
    );
    expect(authorityMigration).toContain(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE\n  ON TABLE "PaymentExecutionPayerVerification"\n  FROM PUBLIC;'
    );
    expect(authorityMigration).toContain(
      'CREATE FUNCTION guard_payment_execution_payer_verification()'
    );
    expect(authorityMigration).toContain(
      'CREATE FUNCTION guard_payment_execution_payer_attestation_authority()'
    );
    expect(authorityMigration).toContain(
      'CREATE FUNCTION guard_inter_entity_relationship_proxy_authorization()'
    );
    expect(authorityMigration).toContain(
      'inter_entity_relationship_authorization_required'
    );
    expect(authorityMigration).toContain(
      'CREATE FUNCTION guard_payment_execution_payer_approval_binding_immutable()'
    );
    expect(authorityMigration).toContain(
      'CREATE FUNCTION guard_payment_execution_payer_evidence_immutable()'
    );
    expect(authorityMigration).toContain(
      'FOR UPDATE OF action_log, instance;'
    );
    expect(authorityMigration).toContain(
      'FOR UPDATE OF company'
    );
    expect(authorityMigration).toContain(
      'FOR UPDATE OF verifier, assignment, position'
    );
    expect(authorityMigration).toContain(
      'FOR UPDATE OF evidence'
    );
    expect(authorityMigration).toContain(
      'NEW."evidenceFileId" IS DISTINCT FROM execution_record.voucher_file_id'
    );
    expect(attestationMigration).toContain(
      'SELECT version."companyEntityIdSnapshot" AS approved_payer_company_id'
    );
    expect(authorityMigration).toContain(
      'CREATE CONSTRAINT TRIGGER "PayableSettlementCase_inter_entity_lineage_guard"'
    );
    expect(authorityMigration).toContain(
      'CREATE CONSTRAINT TRIGGER "PayableSettlementAllocation_inter_entity_lineage_guard"'
    );
    expect(authorityMigration).toContain(
      'CREATE CONSTRAINT TRIGGER "PaymentExecutionWagePayableBinding_inter_entity_lineage_guard"'
    );
    expect(authorityMigration).toContain(
      'CREATE CONSTRAINT TRIGGER "InterEntityRelationshipEntry_inter_entity_lineage_guard"'
    );
    expect(authorityMigration).toContain(
      "inter_entity_relationship_required"
    );
    expect(authorityMigration).toContain(
      "inter_entity_relationship_binding_lineage_invalid"
    );
    expect(authorityMigration).toContain(
      'LEFT JOIN "PaymentExecutionPayerAttestation" attestation'
    );
    expect(authorityMigration).toContain(
      "PaymentExecutionPayerVerification_immutable"
    );
    expect(authorityMigration).toContain(
      "jg_efb_payment_execution_payer_authority_evidence"
    );
    expect(authorityMigration).not.toContain(
      'execution_company_entity_id IS DISTINCT FROM NEW."debtorCompanyId"'
    );
    expect(authorityMigration).not.toContain(
      'contract_company_entity_id IS DISTINCT FROM NEW."debtorCompanyId"'
    );
  });
});
