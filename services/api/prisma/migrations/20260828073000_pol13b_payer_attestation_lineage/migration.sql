-- POL-13B: payer attestation and relationship-evidence lineage.
-- This migration is candidate-only. It keeps the project, contract, source,
-- balance, append-only and audit guards while removing only the equality
-- assumption that the execution/approved payer must be the wage debtor.
BEGIN;

ALTER TABLE "PaymentExecution"
  ADD COLUMN "payerAttestationFingerprint" TEXT;

CREATE TABLE "PaymentExecutionPayerAttestation" (
  "id" TEXT NOT NULL,
  "paymentExecutionId" TEXT NOT NULL,
  "bankAccountReference" TEXT NOT NULL,
  "holderCompanyEntityId" TEXT NOT NULL,
  "holderNameSnapshot" TEXT NOT NULL,
  "holderCreditCodeSnapshot" TEXT NOT NULL,
  "verificationReference" TEXT NOT NULL,
  "verifiedByUserId" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL,
  "verificationEvidenceFileId" TEXT NOT NULL,
  "verificationEvidenceContentSha256" TEXT NOT NULL,
  "proxyAuthorizationReason" TEXT,
  "proxyAuthorizationEvidenceFileId" TEXT,
  "proxyAuthorizationEvidenceSha256" TEXT,
  "reauthorizationReference" TEXT,
  "reauthorizedByUserId" TEXT,
  "reauthorizedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentExecutionPayerAttestation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentExecutionPayerAttestation_reference_check"
    CHECK (
      btrim("paymentExecutionId") <> ''
      AND btrim("bankAccountReference") <> ''
      AND btrim("holderCompanyEntityId") <> ''
      AND btrim("holderNameSnapshot") <> ''
      AND btrim("holderCreditCodeSnapshot") <> ''
      AND btrim("verificationReference") <> ''
      AND btrim("verifiedByUserId") <> ''
      AND btrim("verificationEvidenceFileId") <> ''
      AND "verificationEvidenceContentSha256" ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT "PaymentExecutionPayerAttestation_proxy_authorization_check"
    CHECK (
      ("proxyAuthorizationReason" IS NULL
       AND "proxyAuthorizationEvidenceFileId" IS NULL
       AND "proxyAuthorizationEvidenceSha256" IS NULL
       AND "reauthorizationReference" IS NULL
       AND "reauthorizedByUserId" IS NULL
       AND "reauthorizedAt" IS NULL)
      OR
      (btrim("proxyAuthorizationReason") <> ''
       AND btrim("proxyAuthorizationEvidenceFileId") <> ''
       AND "proxyAuthorizationEvidenceSha256" ~ '^[0-9a-f]{64}$'
       AND btrim("reauthorizationReference") <> ''
       AND btrim("reauthorizedByUserId") <> ''
       AND "reauthorizedAt" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "PaymentExecutionPayerAttestation_execution_key"
  ON "PaymentExecutionPayerAttestation"("paymentExecutionId");
CREATE INDEX "PaymentExecutionPayerAttestation_holder_idx"
  ON "PaymentExecutionPayerAttestation"("holderCompanyEntityId");
CREATE INDEX "PaymentExecutionPayerAttestation_verification_file_idx"
  ON "PaymentExecutionPayerAttestation"("verificationEvidenceFileId");
CREATE INDEX "PaymentExecutionPayerAttestation_authorization_file_idx"
  ON "PaymentExecutionPayerAttestation"("proxyAuthorizationEvidenceFileId");
CREATE INDEX "PaymentExecutionPayerAttestation_verifier_idx"
  ON "PaymentExecutionPayerAttestation"("verifiedByUserId");

ALTER TABLE "PaymentExecutionPayerAttestation"
  ADD CONSTRAINT "PaymentExecutionPayerAttestation_execution_fkey"
  FOREIGN KEY ("paymentExecutionId") REFERENCES "PaymentExecution"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentExecutionPayerAttestation"
  ADD CONSTRAINT "PaymentExecutionPayerAttestation_verification_file_fkey"
  FOREIGN KEY ("verificationEvidenceFileId") REFERENCES "FileObject"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentExecutionPayerAttestation"
  ADD CONSTRAINT "PaymentExecutionPayerAttestation_authorization_file_fkey"
  FOREIGN KEY ("proxyAuthorizationEvidenceFileId") REFERENCES "FileObject"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION guard_payment_execution_payer_attestation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'payment_execution_payer_attestation_append_only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentExecutionPayerAttestation_immutable"
  BEFORE UPDATE OR DELETE ON "PaymentExecutionPayerAttestation"
  FOR EACH ROW EXECUTE FUNCTION guard_payment_execution_payer_attestation();

CREATE FUNCTION guard_payment_execution_payer_attestation_fingerprint()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."payerAttestationFingerprint" IS DISTINCT FROM OLD."payerAttestationFingerprint" THEN
    RAISE EXCEPTION 'payment_execution_payer_attestation_fingerprint_immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentExecution_payer_attestation_fingerprint_immutable"
  BEFORE UPDATE OF "payerAttestationFingerprint" ON "PaymentExecution"
  FOR EACH ROW EXECUTE FUNCTION guard_payment_execution_payer_attestation_fingerprint();

ALTER TABLE "InterEntityRelationshipEntry"
  ADD COLUMN "evidenceClaimId" TEXT,
  ADD COLUMN "evidenceUploadedByUserId" TEXT,
  ADD COLUMN "evidenceContentSha256" TEXT,
  ADD COLUMN "authorizationEvidenceFileId" TEXT,
  ADD COLUMN "authorizationEvidenceContentSha256" TEXT,
  ADD COLUMN "reauthorizationReference" TEXT,
  ADD COLUMN "reauthorizedByUserId" TEXT,
  ADD COLUMN "reauthorizedAt" TIMESTAMP(3),
  ADD COLUMN "actualPayerVerificationEvidenceFileId" TEXT,
  ADD COLUMN "actualPayerVerificationContentSha256" TEXT;

ALTER TABLE "InterEntityRelationshipEntry"
  ADD CONSTRAINT "InterEntityRelationshipEntry_payer_attestation_check"
  CHECK (
    "entryKind" <> 'proxy_payment'
    OR (
      btrim("authorizationEvidenceFileId") <> ''
      AND "authorizationEvidenceContentSha256" ~ '^[0-9a-f]{64}$'
      AND btrim("reauthorizationReference") <> ''
      AND btrim("reauthorizedByUserId") <> ''
      AND "reauthorizedAt" IS NOT NULL
      AND btrim("actualPayerVerificationEvidenceFileId") <> ''
      AND "actualPayerVerificationContentSha256" ~ '^[0-9a-f]{64}$'
    )
  ) NOT VALID;
ALTER TABLE "InterEntityRelationshipEntry"
  ADD CONSTRAINT "InterEntityRelationshipEntry_return_evidence_claim_check"
  CHECK (
    "entryKind" <> 'proxy_return'
    OR (
      btrim("evidenceClaimId") <> ''
      AND btrim("evidenceUploadedByUserId") <> ''
      AND "evidenceContentSha256" ~ '^[0-9a-f]{64}$'
    )
  ) NOT VALID;

CREATE TABLE "InterEntityRelationshipEvidenceClaim" (
  "id" TEXT NOT NULL,
  "relationshipEntryId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL,
  "uploadedByUserId" TEXT NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consumedAt" TIMESTAMP(3),
  "consumedByUserId" TEXT,
  CONSTRAINT "InterEntityRelationshipEvidenceClaim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InterEntityRelationshipEvidenceClaim_status_check"
    CHECK ("status" IN ('pending', 'consumed')),
  CONSTRAINT "InterEntityRelationshipEvidenceClaim_reference_check"
    CHECK (
      btrim("relationshipEntryId") <> ''
      AND btrim("fileId") <> ''
      AND btrim("uploadedByUserId") <> ''
      AND "contentSha256" ~ '^[0-9a-f]{64}$'
      AND btrim("idempotencyKey") <> ''
    ),
  CONSTRAINT "InterEntityRelationshipEvidenceClaim_audit_check"
    CHECK (
      ("status" = 'pending' AND "consumedAt" IS NULL AND "consumedByUserId" IS NULL)
      OR
      ("status" = 'consumed' AND "consumedAt" IS NOT NULL AND btrim("consumedByUserId") <> '')
    )
);

CREATE UNIQUE INDEX "InterEntityRelationshipEvidenceClaim_file_key"
  ON "InterEntityRelationshipEvidenceClaim"("fileId");
CREATE UNIQUE INDEX "InterEntityRelationshipEvidenceClaim_idempotency_key"
  ON "InterEntityRelationshipEvidenceClaim"("idempotencyKey");
CREATE INDEX "InterEntityRelationshipEvidenceClaim_relationship_status_idx"
  ON "InterEntityRelationshipEvidenceClaim"("relationshipEntryId", "status", "createdAt");
CREATE INDEX "InterEntityRelationshipEvidenceClaim_uploader_idx"
  ON "InterEntityRelationshipEvidenceClaim"("uploadedByUserId");

ALTER TABLE "InterEntityRelationshipEvidenceClaim"
  ADD CONSTRAINT "InterEntityRelationshipEvidenceClaim_relationship_fkey"
  FOREIGN KEY ("relationshipEntryId") REFERENCES "InterEntityRelationshipEntry"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InterEntityRelationshipEvidenceClaim"
  ADD CONSTRAINT "InterEntityRelationshipEvidenceClaim_file_fkey"
  FOREIGN KEY ("fileId") REFERENCES "FileObject"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION guard_inter_entity_relationship_evidence_claim()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."status" := 'pending';
    NEW."consumedAt" := NULL;
    NEW."consumedByUserId" := NULL;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'inter_entity_relationship_evidence_claim_append_only';
  END IF;
  IF OLD."relationshipEntryId" <> NEW."relationshipEntryId"
     OR OLD."fileId" <> NEW."fileId"
     OR OLD."uploadedByUserId" <> NEW."uploadedByUserId"
     OR OLD."contentSha256" <> NEW."contentSha256"
     OR OLD."idempotencyKey" <> NEW."idempotencyKey"
     OR OLD."createdAt" <> NEW."createdAt" THEN
    RAISE EXCEPTION 'inter_entity_relationship_evidence_claim_identity_immutable';
  END IF;
  IF OLD."status" <> 'pending' OR NEW."status" <> 'consumed'
     OR NEW."consumedAt" IS NULL OR btrim(NEW."consumedByUserId") = '' THEN
    RAISE EXCEPTION 'inter_entity_relationship_evidence_claim_transition_invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InterEntityRelationshipEvidenceClaim_immutable"
  BEFORE INSERT OR UPDATE OR DELETE ON "InterEntityRelationshipEvidenceClaim"
  FOR EACH ROW EXECUTE FUNCTION guard_inter_entity_relationship_evidence_claim();

CREATE OR REPLACE FUNCTION guard_inter_entity_relationship_entry()
RETURNS TRIGGER AS $$
DECLARE
  root_entry RECORD;
  claim_record RECORD;
  execution_record RECORD;
  attestation_record RECORD;
  confirmed_decreased_amount BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."status" := 'draft';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'inter_entity_relationship_entry_append_only';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" = 'confirmed' THEN
      RAISE EXCEPTION 'inter_entity_relationship_entry_immutable';
    END IF;
    IF NEW."id" <> OLD."id"
       OR NEW."entryKind" <> OLD."entryKind"
       OR NEW."direction" <> OLD."direction"
       OR NEW."adjustsEntryId" IS DISTINCT FROM OLD."adjustsEntryId"
       OR NEW."paymentExecutionId" IS DISTINCT FROM OLD."paymentExecutionId"
       OR NEW."settlementCaseId" IS DISTINCT FROM OLD."settlementCaseId"
       OR NEW."originalDebtorCompanyId" <> OLD."originalDebtorCompanyId"
       OR NEW."creditorCompanyId" <> OLD."creditorCompanyId"
       OR NEW."approvedPayerCompanyId" <> OLD."approvedPayerCompanyId"
       OR NEW."debtorSnapshot" IS DISTINCT FROM OLD."debtorSnapshot"
       OR NEW."creditorSnapshot" IS DISTINCT FROM OLD."creditorSnapshot"
       OR NEW."approvedPayerSnapshot" IS DISTINCT FROM OLD."approvedPayerSnapshot"
       OR NEW."amountCents" <> OLD."amountCents"
       OR NEW."currencyCode" <> OLD."currencyCode"
       OR NEW."evidenceFileId" <> OLD."evidenceFileId"
       OR NEW."evidenceClaimId" IS DISTINCT FROM OLD."evidenceClaimId"
       OR NEW."evidenceUploadedByUserId" IS DISTINCT FROM OLD."evidenceUploadedByUserId"
       OR NEW."evidenceContentSha256" IS DISTINCT FROM OLD."evidenceContentSha256"
       OR NEW."authorizationEvidenceFileId" IS DISTINCT FROM OLD."authorizationEvidenceFileId"
       OR NEW."authorizationEvidenceContentSha256" IS DISTINCT FROM OLD."authorizationEvidenceContentSha256"
       OR NEW."reauthorizationReference" IS DISTINCT FROM OLD."reauthorizationReference"
       OR NEW."reauthorizedByUserId" IS DISTINCT FROM OLD."reauthorizedByUserId"
       OR NEW."reauthorizedAt" IS DISTINCT FROM OLD."reauthorizedAt"
       OR NEW."actualPayerVerificationEvidenceFileId" IS DISTINCT FROM OLD."actualPayerVerificationEvidenceFileId"
       OR NEW."actualPayerVerificationContentSha256" IS DISTINCT FROM OLD."actualPayerVerificationContentSha256"
       OR NEW."reason" IS DISTINCT FROM OLD."reason"
       OR NEW."idempotencyKey" <> OLD."idempotencyKey"
       OR NEW."payloadFingerprint" <> OLD."payloadFingerprint"
       OR NEW."createdByUserId" <> OLD."createdByUserId"
       OR NEW."createdAt" <> OLD."createdAt" THEN
      RAISE EXCEPTION 'inter_entity_relationship_entry_identity_immutable';
    END IF;
    IF OLD."status" <> 'draft' OR NEW."status" <> 'confirmed' THEN
      RAISE EXCEPTION 'inter_entity_relationship_entry_transition_invalid';
    END IF;
  END IF;
  IF NEW."status" = 'draft'
     AND (NEW."confirmedByUserId" IS NOT NULL OR NEW."confirmedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'inter_entity_relationship_entry_draft_audit_invalid';
  END IF;
  IF NEW."status" = 'confirmed'
     AND (NEW."confirmedByUserId" IS NULL OR NEW."confirmedAt" IS NULL) THEN
    RAISE EXCEPTION 'inter_entity_relationship_entry_confirmation_audit_invalid';
  END IF;

  IF NEW."status" = 'confirmed' AND NEW."entryKind" = 'proxy_payment' THEN
    SELECT version."companyEntityIdSnapshot" AS approved_payer_company_id,
           execution."paymentRequestId" AS payment_request_id,
           request."projectId" AS project_id,
           request."contractId" AS contract_id,
           request."paymentSubjectType" AS request_subject_type,
           version."contractId" AS version_contract_id,
           version."companyEntityIdSnapshot" AS version_company_id,
           version."signingSubjectType" AS signing_subject_type,
           contract."projectId" AS contract_project_id,
           contract."contractTypeKey" AS contract_type_key,
           execution."paymentSubjectType" AS execution_subject_type,
           case_row."status" AS case_status
    INTO execution_record
    FROM "PaymentExecution" execution
    INNER JOIN "PaymentRequest" request ON request."id" = execution."paymentRequestId"
    INNER JOIN "ContractVersion" version ON version."id" = request."contractVersionId"
    INNER JOIN "Contract" contract ON contract."id" = request."contractId"
    INNER JOIN "PayableSettlementCase" case_row ON case_row."id" = NEW."settlementCaseId"
    WHERE execution."id" = NEW."paymentExecutionId"
      AND case_row."paymentExecutionId" = execution."id";
    IF NOT FOUND
       OR execution_record.execution_subject_type IS DISTINCT FROM 'our_company'
       OR execution_record.request_subject_type IS DISTINCT FROM 'our_company'
       OR execution_record.signing_subject_type IS DISTINCT FROM 'our_company'
       OR execution_record.contract_type_key IS DISTINCT FROM 'labor_subcontract'
       OR execution_record.project_id IS DISTINCT FROM execution_record.contract_project_id
       OR execution_record.version_contract_id IS DISTINCT FROM execution_record.contract_id
       OR execution_record.version_company_id IS DISTINCT FROM execution_record.approved_payer_company_id
       OR execution_record.case_status IS DISTINCT FROM 'confirmed'
       OR NEW."approvedPayerCompanyId" IS DISTINCT FROM execution_record.approved_payer_company_id THEN
      RAISE EXCEPTION 'inter_entity_relationship_scope_invalid';
    END IF;
    SELECT attestation.* INTO attestation_record
    FROM "PaymentExecutionPayerAttestation" attestation
    WHERE attestation."paymentExecutionId" = NEW."paymentExecutionId";
    IF NOT FOUND
       OR attestation_record."holderCompanyEntityId" IS DISTINCT FROM NEW."creditorCompanyId"
       OR attestation_record."verificationEvidenceFileId" IS DISTINCT FROM NEW."actualPayerVerificationEvidenceFileId"
       OR attestation_record."verificationEvidenceContentSha256" IS DISTINCT FROM NEW."actualPayerVerificationContentSha256"
       OR attestation_record."proxyAuthorizationEvidenceFileId" IS DISTINCT FROM NEW."authorizationEvidenceFileId"
       OR attestation_record."proxyAuthorizationEvidenceSha256" IS DISTINCT FROM NEW."authorizationEvidenceContentSha256"
       OR attestation_record."proxyAuthorizationReason" IS DISTINCT FROM NEW."reason"
       OR attestation_record."reauthorizationReference" IS DISTINCT FROM NEW."reauthorizationReference"
       OR attestation_record."reauthorizedByUserId" IS DISTINCT FROM NEW."reauthorizedByUserId"
       OR attestation_record."reauthorizedAt" IS DISTINCT FROM NEW."reauthorizedAt" THEN
      RAISE EXCEPTION 'inter_entity_relationship_payer_attestation_invalid';
    END IF;
  END IF;

  IF NEW."status" = 'confirmed' AND NEW."entryKind" = 'proxy_return' THEN
    SELECT root.* INTO root_entry
    FROM "InterEntityRelationshipEntry" root
    WHERE root."id" = NEW."adjustsEntryId"
      AND root."entryKind" = 'proxy_payment'
      AND root."direction" = 'increase'
      AND root."status" = 'confirmed'
      AND root."adjustsEntryId" IS NULL
    FOR UPDATE;
    IF NOT FOUND
       OR NEW."originalDebtorCompanyId" IS DISTINCT FROM root_entry."originalDebtorCompanyId"
       OR NEW."creditorCompanyId" IS DISTINCT FROM root_entry."creditorCompanyId"
       OR NEW."approvedPayerCompanyId" IS DISTINCT FROM root_entry."approvedPayerCompanyId"
       OR NEW."currencyCode" IS DISTINCT FROM root_entry."currencyCode"
       OR NEW."debtorSnapshot" IS DISTINCT FROM root_entry."debtorSnapshot"
       OR NEW."creditorSnapshot" IS DISTINCT FROM root_entry."creditorSnapshot"
       OR NEW."approvedPayerSnapshot" IS DISTINCT FROM root_entry."approvedPayerSnapshot" THEN
      RAISE EXCEPTION 'inter_entity_relationship_return_lineage_invalid';
    END IF;
    SELECT claim.* INTO claim_record
    FROM "InterEntityRelationshipEvidenceClaim" claim
    WHERE claim."id" = NEW."evidenceClaimId"
      AND claim."relationshipEntryId" = root_entry."id"
      AND claim."fileId" = NEW."evidenceFileId"
      AND claim."uploadedByUserId" = NEW."evidenceUploadedByUserId"
      AND claim."contentSha256" = NEW."evidenceContentSha256"
      AND claim."status" = 'consumed';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'inter_entity_relationship_return_evidence_claim_invalid';
    END IF;
    SELECT COALESCE(SUM(entry."amountCents"), 0)
    INTO confirmed_decreased_amount
    FROM "InterEntityRelationshipEntry" entry
    WHERE entry."adjustsEntryId" = root_entry."id"
      AND entry."entryKind" = 'proxy_return'
      AND entry."direction" = 'decrease'
      AND entry."status" = 'confirmed'
      AND entry."id" <> NEW."id";
    IF confirmed_decreased_amount + NEW."amountCents" > root_entry."amountCents" THEN
      RAISE EXCEPTION 'inter_entity_relationship_return_balance_invalid';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "PayableSettlementAllocation_source_guard"
  ON "PayableSettlementAllocation";
DROP TRIGGER IF EXISTS "PaymentExecutionWagePayableBinding_scope_guard"
  ON "PaymentExecutionWagePayableBinding";

-- The following two guards intentionally retain all source/project/contract
-- and cumulative-balance checks. Only the old equality against the wage
-- debtor is removed; the three frozen subjects are validated by the
-- relationship entry guard above.
CREATE OR REPLACE FUNCTION guard_payable_settlement_allocation_source()
RETURNS TRIGGER AS $$
DECLARE
  source_confirmed_version_id TEXT;
  source_debtor_company_id TEXT;
  source_project_id TEXT;
  source_amount_cents BIGINT;
  source_effective_amount_cents BIGINT;
  source_payee_subject_type TEXT;
  source_payee_subject_id TEXT;
  execution_amount_cents BIGINT;
  execution_payment_subject_type TEXT;
  request_project_id TEXT;
  request_contract_id TEXT;
  request_payment_subject_type TEXT;
  contract_version_contract_id TEXT;
  contract_company_entity_id TEXT;
  contract_signing_subject_type TEXT;
  contract_project_id TEXT;
  contract_type_key TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW."sourceType" <> 'wage_payable_ref' THEN
    RAISE EXCEPTION 'payable_settlement_source_type_invalid';
  END IF;
  SELECT ref."confirmedVersionId", ref."debtorCompanyId", ref."projectId",
         ref."amountCents", breakdown."creditorSubjectType",
         breakdown."creditorSubjectIdentityKey"
  INTO source_confirmed_version_id, source_debtor_company_id, source_project_id,
       source_amount_cents, source_payee_subject_type, source_payee_subject_id
  FROM "WagePayableRef" ref
  INNER JOIN "WageCreditorBreakdown" breakdown ON breakdown."id" = ref."creditorBreakdownId"
  INNER JOIN "WageStatementVersion" version ON version."id" = ref."confirmedVersionId"
  WHERE ref."id" = NEW."payableRef"
    AND ref."direction" = 'increase'
    AND ref."adjustsPayableRefId" IS NULL
    AND version."status" = 'confirmed';
  IF NOT FOUND OR source_payee_subject_type IS NULL OR source_payee_subject_id IS NULL THEN
    RAISE EXCEPTION 'payable_settlement_source_not_confirmed';
  END IF;
  SELECT execution."amountCents", execution."paymentSubjectType",
         request."projectId", request."contractId", request."paymentSubjectType",
         version."contractId", version."companyEntityIdSnapshot",
         version."signingSubjectType", contract."projectId", contract."contractTypeKey"
  INTO execution_amount_cents, execution_payment_subject_type,
       request_project_id, request_contract_id, request_payment_subject_type,
       contract_version_contract_id, contract_company_entity_id,
       contract_signing_subject_type, contract_project_id, contract_type_key
  FROM "PaymentExecution" execution
  INNER JOIN "PaymentRequest" request ON request."id" = execution."paymentRequestId"
  INNER JOIN "ContractVersion" version ON version."id" = request."contractVersionId"
  INNER JOIN "Contract" contract ON contract."id" = request."contractId"
  WHERE execution."id" = NEW."paymentExecutionId";
  IF NOT FOUND
     OR execution_payment_subject_type IS DISTINCT FROM 'our_company'
     OR request_payment_subject_type IS DISTINCT FROM 'our_company'
     OR contract_signing_subject_type IS DISTINCT FROM 'our_company'
     OR contract_type_key IS DISTINCT FROM 'labor_subcontract'
     OR contract_company_entity_id IS NULL
     OR request_project_id IS NULL
     OR request_contract_id IS NULL
     OR contract_version_contract_id IS DISTINCT FROM request_contract_id
     OR contract_project_id IS DISTINCT FROM request_project_id THEN
    RAISE EXCEPTION 'payable_settlement_execution_scope_invalid';
  END IF;
  IF request_project_id IS DISTINCT FROM NEW."beneficiaryProjectId" THEN
    RAISE EXCEPTION 'payable_settlement_execution_scope_invalid';
  END IF;
  SELECT source_amount_cents + COALESCE(SUM(
    CASE adjustment."direction"
      WHEN 'increase' THEN adjustment."amountCents"
      WHEN 'decrease' THEN -adjustment."amountCents"
      ELSE 0
    END
  ), 0)
  INTO source_effective_amount_cents
  FROM "WagePayableRef" adjustment
  WHERE adjustment."adjustsPayableRefId" = NEW."payableRef";
  IF source_effective_amount_cents < 0 THEN
    RAISE EXCEPTION 'payable_settlement_source_balance_invalid';
  END IF;
  IF NEW."amountCents" > execution_amount_cents THEN
    RAISE EXCEPTION 'payable_settlement_execution_amount_invalid';
  END IF;
  IF NEW."sourceAggregateId" IS DISTINCT FROM source_confirmed_version_id
     OR NEW."sourceLineId" IS DISTINCT FROM NEW."payableRef"
     OR NEW."confirmedVersionId" IS DISTINCT FROM source_confirmed_version_id
     OR NEW."debtorCompanyId" IS DISTINCT FROM source_debtor_company_id
     OR NEW."payeeSubjectType" IS DISTINCT FROM source_payee_subject_type
     OR NEW."payeeSubjectId" IS DISTINCT FROM source_payee_subject_id
     OR NEW."beneficiaryProjectId" IS DISTINCT FROM source_project_id
     OR NEW."confirmedAmountCents" IS DISTINCT FROM source_amount_cents
     OR NEW."amountCents" > source_effective_amount_cents THEN
    RAISE EXCEPTION 'payable_settlement_source_snapshot_invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PayableSettlementAllocation_source_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "PayableSettlementAllocation"
  FOR EACH ROW EXECUTE FUNCTION guard_payable_settlement_allocation_source();

CREATE OR REPLACE FUNCTION guard_payment_execution_wage_payable_binding_scope()
RETURNS TRIGGER AS $$
DECLARE
  execution_amount_cents BIGINT;
  execution_payment_subject_type TEXT;
  request_project_id TEXT;
  request_contract_id TEXT;
  request_payment_subject_type TEXT;
  contract_version_contract_id TEXT;
  contract_company_entity_id TEXT;
  contract_signing_subject_type TEXT;
  contract_project_id TEXT;
  contract_type_key TEXT;
  source_debtor_company_id TEXT;
  source_debtor_company_snapshot JSONB;
  source_project_id TEXT;
  source_project_snapshot JSONB;
  source_amount_cents BIGINT;
  source_effective_amount_cents BIGINT;
  source_direction TEXT;
  source_adjustment_id TEXT;
  source_version_status TEXT;
  source_subject_type TEXT;
  source_user_id TEXT;
  source_business_party_version_id TEXT;
  source_subject_identity_key TEXT;
  source_name TEXT;
  source_unified_identity TEXT;
  source_version_fingerprint TEXT;
  source_creditor_snapshot JSONB;
  existing_payment_execution_allocation_amount_cents BIGINT;
  existing_execution_binding_amount_cents BIGINT;
  existing_ref_binding_amount_cents BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  PERFORM 1 FROM "PaymentExecution"
  WHERE "id" = NEW."paymentExecutionId" FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_execution_wage_binding_scope_invalid';
  END IF;
  PERFORM 1 FROM "WagePayableRef"
  WHERE "id" = NEW."wagePayableRefId" FOR UPDATE;
  SELECT execution."amountCents", execution."paymentSubjectType", request."projectId",
         request."contractId", request."paymentSubjectType", version."contractId",
         version."companyEntityIdSnapshot", version."signingSubjectType",
         contract."projectId", contract."contractTypeKey"
  INTO execution_amount_cents, execution_payment_subject_type, request_project_id,
       request_contract_id, request_payment_subject_type, contract_version_contract_id,
       contract_company_entity_id, contract_signing_subject_type, contract_project_id,
       contract_type_key
  FROM "PaymentExecution" execution
  INNER JOIN "PaymentRequest" request ON request."id" = execution."paymentRequestId"
  INNER JOIN "ContractVersion" version ON version."id" = request."contractVersionId"
  INNER JOIN "Contract" contract ON contract."id" = request."contractId"
  WHERE execution."id" = NEW."paymentExecutionId";
  IF NOT FOUND
     OR execution_payment_subject_type IS DISTINCT FROM 'our_company'
     OR request_payment_subject_type IS DISTINCT FROM 'our_company'
     OR contract_signing_subject_type IS DISTINCT FROM 'our_company'
     OR contract_type_key IS DISTINCT FROM 'labor_subcontract'
     OR contract_company_entity_id IS NULL
     OR request_project_id IS NULL
     OR request_contract_id IS NULL
     OR contract_version_contract_id IS DISTINCT FROM request_contract_id
     OR contract_project_id IS DISTINCT FROM request_project_id
     OR request_project_id IS DISTINCT FROM NEW."projectId" THEN
    RAISE EXCEPTION 'payment_execution_wage_binding_scope_invalid';
  END IF;
  SELECT ref."debtorCompanyId", ref."debtorCompanySnapshot", ref."projectId",
         ref."projectSnapshot", ref."amountCents", ref."direction",
         ref."adjustsPayableRefId", version."status", breakdown."creditorSubjectType",
         breakdown."creditorUserId", breakdown."creditorBusinessPartyVersionId",
         breakdown."creditorSubjectIdentityKey", breakdown."creditorNameSnapshot",
         breakdown."creditorUnifiedIdentitySnapshot", breakdown."creditorVersionFingerprint",
         ref."creditorSnapshot", ref."amountCents" + COALESCE(SUM(
           CASE adjustment."direction"
             WHEN 'increase' THEN adjustment."amountCents"
             WHEN 'decrease' THEN -adjustment."amountCents"
             ELSE 0
           END
         ), 0)
  INTO source_debtor_company_id, source_debtor_company_snapshot, source_project_id,
       source_project_snapshot, source_amount_cents, source_direction,
       source_adjustment_id, source_version_status, source_subject_type, source_user_id,
       source_business_party_version_id, source_subject_identity_key, source_name,
       source_unified_identity, source_version_fingerprint, source_creditor_snapshot,
       source_effective_amount_cents
  FROM "WagePayableRef" ref
  INNER JOIN "WageStatementVersion" version ON version."id" = ref."confirmedVersionId"
  INNER JOIN "WageCreditorBreakdown" breakdown ON breakdown."id" = ref."creditorBreakdownId"
  LEFT JOIN "WagePayableRef" adjustment ON adjustment."adjustsPayableRefId" = ref."id"
  WHERE ref."id" = NEW."wagePayableRefId"
  GROUP BY ref."debtorCompanyId", ref."debtorCompanySnapshot", ref."projectId",
           ref."projectSnapshot", ref."amountCents", ref."direction",
           ref."adjustsPayableRefId", version."status", breakdown."creditorSubjectType",
           breakdown."creditorUserId", breakdown."creditorBusinessPartyVersionId",
           breakdown."creditorSubjectIdentityKey", breakdown."creditorNameSnapshot",
           breakdown."creditorUnifiedIdentitySnapshot", breakdown."creditorVersionFingerprint",
           ref."creditorSnapshot";
  IF NOT FOUND
     OR source_direction IS DISTINCT FROM 'increase'
     OR source_adjustment_id IS NOT NULL
     OR source_version_status IS DISTINCT FROM 'confirmed'
     OR source_debtor_company_id IS DISTINCT FROM NEW."debtorCompanyId"
     OR source_debtor_company_snapshot IS DISTINCT FROM NEW."debtorCompanySnapshot"
     OR source_project_id IS DISTINCT FROM NEW."projectId"
     OR source_project_snapshot IS DISTINCT FROM NEW."projectSnapshot"
     OR source_subject_type IS DISTINCT FROM NEW."creditorSubjectType"
     OR source_user_id IS DISTINCT FROM NEW."creditorUserId"
     OR source_business_party_version_id IS DISTINCT FROM NEW."creditorBusinessPartyVersionId"
     OR source_subject_identity_key IS DISTINCT FROM NEW."creditorSubjectIdentityKey"
     OR source_name IS DISTINCT FROM NEW."creditorNameSnapshot"
     OR source_unified_identity IS DISTINCT FROM NEW."creditorUnifiedIdentitySnapshot"
     OR source_version_fingerprint IS DISTINCT FROM NEW."creditorVersionFingerprint"
     OR source_creditor_snapshot IS DISTINCT FROM NEW."creditorSnapshot"
     OR source_effective_amount_cents < 0
     OR NEW."amountCents" > source_effective_amount_cents
     OR NEW."amountCents" > execution_amount_cents THEN
    RAISE EXCEPTION 'payment_execution_wage_binding_source_invalid';
  END IF;
  SELECT COALESCE(SUM("amountCents"), 0)
  INTO existing_payment_execution_allocation_amount_cents
  FROM "PaymentExecutionAllocation"
  WHERE "paymentExecutionId" = NEW."paymentExecutionId"
    AND "allocationType" = 'contract_due_payment';
  SELECT COALESCE(SUM("amountCents"), 0)
  INTO existing_execution_binding_amount_cents
  FROM "PaymentExecutionWagePayableBinding"
  WHERE "paymentExecutionId" = NEW."paymentExecutionId";
  IF existing_payment_execution_allocation_amount_cents
       + existing_execution_binding_amount_cents + NEW."amountCents" > execution_amount_cents THEN
    RAISE EXCEPTION 'payment_execution_wage_binding_execution_balance_invalid';
  END IF;
  SELECT COALESCE(SUM("amountCents"), 0)
  INTO existing_ref_binding_amount_cents
  FROM "PaymentExecutionWagePayableBinding"
  WHERE "wagePayableRefId" = NEW."wagePayableRefId";
  IF existing_ref_binding_amount_cents + NEW."amountCents" > source_effective_amount_cents THEN
    RAISE EXCEPTION 'payment_execution_wage_binding_source_balance_invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentExecutionWagePayableBinding_scope_guard"
  BEFORE INSERT OR UPDATE ON "PaymentExecutionWagePayableBinding"
  FOR EACH ROW EXECUTE FUNCTION guard_payment_execution_wage_payable_binding_scope();

-- The relationship root reuses the immutable payment voucher as a controlled
-- lineage reference.  Its old generic non-exclusive trigger would still
-- reject a voucher already owned by PaymentExecution, so remove that trigger
-- while retaining the field in the registry for schema/manifest coverage.
DROP TRIGGER IF EXISTS jg_efb_inter_entity_relationship_evidence
  ON "InterEntityRelationshipEntry";
DROP TRIGGER IF EXISTS jg_efb_inter_entity_relationship_authorization_evidence
  ON "InterEntityRelationshipEntry";

-- Register every new FileObject reference in the one global binding registry.
ALTER FUNCTION jg_file_business_binding_columns()
  RENAME TO jg_file_business_binding_columns_before_pol13b_attestation;
CREATE FUNCTION jg_file_business_binding_columns()
RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM jg_file_business_binding_columns_before_pol13b_attestation()
  UNION ALL
  VALUES
    -- The attestation owns the single exclusive reauthorization evidence
    -- binding.  The relationship row is an immutable snapshot reference to
    -- that same proof and is checked by the lineage guard below.
    ('InterEntityRelationshipEntry', 'authorizationEvidenceFileId', FALSE),
    ('InterEntityRelationshipEntry', 'actualPayerVerificationEvidenceFileId', FALSE),
    -- The immutable attestation snapshots the same server-issued authority
    -- evidence; both references remain hash/uploader/SoD checked but are
    -- intentionally non-exclusive so one verified bank holder can be reused
    -- across its payment executions.
    ('PaymentExecutionPayerAttestation', 'verificationEvidenceFileId', FALSE),
    ('PaymentExecutionPayerAttestation', 'proxyAuthorizationEvidenceFileId', TRUE),
    ('InterEntityRelationshipEvidenceClaim', 'fileId', TRUE);
$$;

CREATE TRIGGER jg_efb_inter_entity_relationship_payer_verification_evidence
BEFORE INSERT OR UPDATE OF "actualPayerVerificationEvidenceFileId" ON "InterEntityRelationshipEntry"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding(
  'actualPayerVerificationEvidenceFileId', 'false');
CREATE TRIGGER jg_efb_payment_execution_payer_verification_evidence
BEFORE INSERT OR UPDATE OF "verificationEvidenceFileId" ON "PaymentExecutionPayerAttestation"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding(
  'verificationEvidenceFileId', 'false');
CREATE TRIGGER jg_efb_payment_execution_proxy_authorization_evidence
BEFORE INSERT OR UPDATE OF "proxyAuthorizationEvidenceFileId" ON "PaymentExecutionPayerAttestation"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding(
  'proxyAuthorizationEvidenceFileId', 'true');
CREATE TRIGGER jg_efb_inter_entity_relationship_evidence_claim
BEFORE INSERT OR UPDATE OF "fileId" ON "InterEntityRelationshipEvidenceClaim"
FOR EACH ROW EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding(
  'fileId', 'true');

COMMIT;
