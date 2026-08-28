-- POL-13B: server-side payer authority and deferred cross-entity lineage.
--
-- This candidate migration is intentionally non-production. It makes the
-- payer attestation consume an immutable, server-issued legal-holder record,
-- then closes the database seam that otherwise allowed a cross-company wage
-- allocation/binding to exist without its confirmed relationship root.
BEGIN;

SELECT pg_advisory_xact_lock(190731, 221);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'jg_payment_execution_payer_issuer'
  ) THEN
    CREATE ROLE "jg_payment_execution_payer_issuer" NOLOGIN NOINHERIT;
  END IF;
END;
$$;

-- The bank-holder authority is not a user-maintained directory.  Its source
-- reference is accepted only through this database-owned issuance seam.  The
-- short-lived context is keyed to the current backend transaction so a direct
-- ORM/SQL INSERT cannot manufacture a verified row by merely supplying a
-- non-empty sourceRecordId.
CREATE TABLE "PaymentExecutionPayerVerificationIssuerContext" (
  "backendPid" INTEGER NOT NULL,
  "transactionId" BIGINT NOT NULL,
  "sourceRecordId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentExecutionPayerVerificationIssuerContext_pkey"
    PRIMARY KEY ("backendPid", "transactionId"),
  CONSTRAINT "PaymentExecutionPayerVerificationIssuerContext_source_check"
    CHECK (btrim("sourceRecordId") <> '')
);

REVOKE ALL ON TABLE "PaymentExecutionPayerVerificationIssuerContext" FROM PUBLIC;

CREATE TABLE "PaymentExecutionPayerVerification" (
  "id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "holderCompanyEntityId" TEXT NOT NULL,
  "holderNameSnapshot" TEXT NOT NULL,
  "holderCreditCodeSnapshot" TEXT NOT NULL,
  "verificationReference" TEXT NOT NULL,
  "verifiedByUserId" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL,
  "verificationEvidenceFileId" TEXT NOT NULL,
  "verificationEvidenceContentSha256" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'verified',
  "sourceType" TEXT NOT NULL DEFAULT 'bank_account_legal_holder',
  "sourceRecordId" TEXT NOT NULL,
  "issuedByDatabaseRole" TEXT NOT NULL DEFAULT 'jg_payment_execution_payer_issuer',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentExecutionPayerVerification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentExecutionPayerVerification_shape_check"
    CHECK (
      btrim("reference") <> ''
      AND btrim("holderCompanyEntityId") <> ''
      AND btrim("holderNameSnapshot") <> ''
      AND btrim("holderCreditCodeSnapshot") <> ''
      AND btrim("verificationReference") <> ''
      AND btrim("verifiedByUserId") <> ''
      AND btrim("verificationEvidenceFileId") <> ''
      AND "verificationEvidenceContentSha256" ~ '^[0-9a-f]{64}$'
      AND "status" = 'verified'
      AND "sourceType" = 'bank_account_legal_holder'
      AND btrim("sourceRecordId") <> ''
      AND "issuedByDatabaseRole" = 'jg_payment_execution_payer_issuer'
    )
);

CREATE UNIQUE INDEX "PaymentExecutionPayerVerification_reference_key"
  ON "PaymentExecutionPayerVerification"("reference");
CREATE UNIQUE INDEX "PaymentExecutionPayerVerification_source_key"
  ON "PaymentExecutionPayerVerification"("sourceType", "sourceRecordId");
CREATE INDEX "PaymentExecutionPayerVerification_holder_status_idx"
  ON "PaymentExecutionPayerVerification"("holderCompanyEntityId", "status");
CREATE INDEX "PaymentExecutionPayerVerification_verification_file_idx"
  ON "PaymentExecutionPayerVerification"("verificationEvidenceFileId");
CREATE INDEX "PaymentExecutionPayerVerification_verifier_idx"
  ON "PaymentExecutionPayerVerification"("verifiedByUserId");

ALTER TABLE "PaymentExecutionPayerVerification"
  ADD CONSTRAINT "PaymentExecutionPayerVerification_holder_company_fkey"
  FOREIGN KEY ("holderCompanyEntityId") REFERENCES "CompanyEntity"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentExecutionPayerVerification_verifier_fkey"
  FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentExecutionPayerVerification_evidence_file_fkey"
  FOREIGN KEY ("verificationEvidenceFileId") REFERENCES "FileObject"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE "PaymentExecutionPayerVerification"
  FROM PUBLIC;

-- The only write seam for a verified bank-holder authority.  The public
-- application role cannot call this function: the invoker wrapper requires a
-- dedicated NOLOGIN issuer role, while the definer body owns the short-lived
-- context and the authority INSERT.  No bank directory or external API is
-- introduced by this candidate.
CREATE FUNCTION "jg_issue_payment_execution_payer_verification_trusted"(p_payload JSONB)
RETURNS SETOF "PaymentExecutionPayerVerification"
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  issued "PaymentExecutionPayerVerification"%ROWTYPE;
  source_record_id TEXT;
BEGIN
  source_record_id := NULLIF(btrim(p_payload ->> 'sourceRecordId'), '');
  IF source_record_id IS NULL THEN
    RAISE EXCEPTION 'payment_execution_payer_verification_source_required';
  END IF;

  INSERT INTO public."PaymentExecutionPayerVerificationIssuerContext"(
    "backendPid",
    "transactionId",
    "sourceRecordId"
  )
  VALUES (pg_backend_pid(), txid_current(), source_record_id)
  ON CONFLICT ("backendPid", "transactionId") DO UPDATE
    SET "sourceRecordId" = EXCLUDED."sourceRecordId",
        "createdAt" = CURRENT_TIMESTAMP;

  BEGIN
    INSERT INTO public."PaymentExecutionPayerVerification"(
      "id",
      "reference",
      "holderCompanyEntityId",
      "holderNameSnapshot",
      "holderCreditCodeSnapshot",
      "verificationReference",
      "verifiedByUserId",
      "verifiedAt",
      "verificationEvidenceFileId",
      "verificationEvidenceContentSha256",
      "status",
      "sourceType",
      "sourceRecordId",
      "issuedByDatabaseRole"
    )
    VALUES (
      COALESCE(NULLIF(p_payload ->> 'id', ''), public.gen_random_uuid()::TEXT),
      p_payload ->> 'reference',
      p_payload ->> 'holderCompanyEntityId',
      p_payload ->> 'holderNameSnapshot',
      p_payload ->> 'holderCreditCodeSnapshot',
      p_payload ->> 'verificationReference',
      p_payload ->> 'verifiedByUserId',
      (p_payload ->> 'verifiedAt')::TIMESTAMPTZ AT TIME ZONE 'UTC',
      p_payload ->> 'verificationEvidenceFileId',
      p_payload ->> 'verificationEvidenceContentSha256',
      COALESCE(NULLIF(p_payload ->> 'status', ''), 'verified'),
      COALESCE(NULLIF(p_payload ->> 'sourceType', ''), 'bank_account_legal_holder'),
      source_record_id,
      'jg_payment_execution_payer_issuer'
    )
    RETURNING * INTO issued;

    DELETE FROM public."PaymentExecutionPayerVerificationIssuerContext"
    WHERE "backendPid" = pg_backend_pid()
      AND "transactionId" = txid_current();

    RETURN NEXT issued;
    RETURN;
  EXCEPTION WHEN OTHERS THEN
    DELETE FROM public."PaymentExecutionPayerVerificationIssuerContext"
    WHERE "backendPid" = pg_backend_pid()
      AND "transactionId" = txid_current();
    RAISE;
  END;
END;
$$;

-- Keep the role check in an invoker function so SECURITY DEFINER cannot erase
-- the identity of the caller.  The issuer role is NOLOGIN and receives only
-- this explicit EXECUTE grant; normal runtime roles retain no direct table
-- write privilege and no function execution privilege.
CREATE FUNCTION "jg_issue_payment_execution_payer_verification"(p_payload JSONB)
RETURNS SETOF "PaymentExecutionPayerVerification"
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_user <> 'jg_payment_execution_payer_issuer' THEN
    RAISE EXCEPTION 'payment_execution_payer_verification_issuer_role_required'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT *
  FROM public."jg_issue_payment_execution_payer_verification_trusted"(p_payload);
END;
$$;

REVOKE ALL ON FUNCTION "jg_issue_payment_execution_payer_verification_trusted"(JSONB)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "jg_issue_payment_execution_payer_verification_trusted"(JSONB)
  TO "jg_payment_execution_payer_issuer";
REVOKE ALL ON FUNCTION "jg_issue_payment_execution_payer_verification"(JSONB)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "jg_issue_payment_execution_payer_verification"(JSONB)
  TO "jg_payment_execution_payer_issuer";

CREATE FUNCTION guard_payment_execution_payer_verification()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'payment_execution_payer_verification_immutable';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public."PaymentExecutionPayerVerificationIssuerContext" issuer
    WHERE issuer."backendPid" = pg_backend_pid()
      AND issuer."transactionId" = txid_current()
      AND issuer."sourceRecordId" = NEW."sourceRecordId"
  ) THEN
    RAISE EXCEPTION 'payment_execution_payer_verification_issuer_required';
  END IF;
  IF NEW."verifiedAt" > CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'payment_execution_payer_verification_future';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "CompanyEntity" company
    WHERE company."id" = NEW."holderCompanyEntityId"
      AND company."isActive" = TRUE
    FOR UPDATE OF company
  ) THEN
    RAISE EXCEPTION 'payment_execution_payer_verification_holder_inactive';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "User" verifier
    INNER JOIN "UserPosition" assignment ON assignment."userId" = verifier."id"
    INNER JOIN "Position" position ON position."id" = assignment."positionId"
    WHERE verifier."id" = NEW."verifiedByUserId"
      AND verifier."isActive" = TRUE
      AND assignment."projectId" IS NULL
      AND position."key" = 'finance_director'
    FOR UPDATE OF verifier, assignment, position
  ) THEN
    RAISE EXCEPTION 'payment_execution_payer_verification_verifier_invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "FileObject" evidence
    WHERE evidence."id" = NEW."verificationEvidenceFileId"
      AND evidence."storageStatus" = 'active'
      AND evidence."uploadedByUserId" = NEW."verifiedByUserId"
      AND evidence."contentSha256" = NEW."verificationEvidenceContentSha256"
    FOR UPDATE OF evidence
  ) THEN
    RAISE EXCEPTION 'payment_execution_payer_verification_evidence_invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentExecutionPayerVerification_immutable"
  BEFORE INSERT OR UPDATE OR DELETE ON "PaymentExecutionPayerVerification"
  FOR EACH ROW EXECUTE FUNCTION guard_payment_execution_payer_verification();

ALTER TABLE "PaymentExecutionPayerAttestation"
  ADD COLUMN "payerVerificationId" TEXT NOT NULL,
  ADD COLUMN "reauthorizationApprovalInstanceId" TEXT,
  ADD COLUMN "reauthorizationApprovalActionLogId" TEXT,
  ADD COLUMN "reauthorizationPaymentRequestId" TEXT,
  ADD COLUMN "reauthorizationContractVersionId" TEXT;

ALTER TABLE "PaymentExecutionPayerAttestation"
  ADD CONSTRAINT "PaymentExecutionPayerAttestation_payer_verification_fkey"
  FOREIGN KEY ("payerVerificationId") REFERENCES "PaymentExecutionPayerVerification"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentExecutionPayerAttestation_approval_instance_fkey"
  FOREIGN KEY ("reauthorizationApprovalInstanceId") REFERENCES "ApprovalInstance"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentExecutionPayerAttestation_approval_action_log_fkey"
  FOREIGN KEY ("reauthorizationApprovalActionLogId") REFERENCES "ApprovalActionLog"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentExecutionPayerAttestation_payment_request_fkey"
  FOREIGN KEY ("reauthorizationPaymentRequestId") REFERENCES "PaymentRequest"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PaymentExecutionPayerAttestation_contract_version_fkey"
  FOREIGN KEY ("reauthorizationContractVersionId") REFERENCES "ContractVersion"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "PaymentExecutionPayerAttestation_payer_verification_idx"
  ON "PaymentExecutionPayerAttestation"("payerVerificationId");
CREATE INDEX "PaymentExecutionPayerAttestation_approval_action_log_idx"
  ON "PaymentExecutionPayerAttestation"("reauthorizationApprovalActionLogId");

ALTER TABLE "PaymentExecutionPayerAttestation"
  ADD CONSTRAINT "PaymentExecutionPayerAttestation_authorization_shape_check"
  CHECK (
    ("proxyAuthorizationReason" IS NULL
      AND "proxyAuthorizationEvidenceFileId" IS NULL
      AND "proxyAuthorizationEvidenceSha256" IS NULL
      AND "reauthorizationReference" IS NULL
      AND "reauthorizationApprovalInstanceId" IS NULL
      AND "reauthorizationApprovalActionLogId" IS NULL
      AND "reauthorizationPaymentRequestId" IS NULL
      AND "reauthorizationContractVersionId" IS NULL
      AND "reauthorizedByUserId" IS NULL
      AND "reauthorizedAt" IS NULL)
    OR
    (btrim("proxyAuthorizationReason") <> ''
      AND btrim("proxyAuthorizationEvidenceFileId") <> ''
      AND "proxyAuthorizationEvidenceSha256" ~ '^[0-9a-f]{64}$'
      AND btrim("reauthorizationReference") <> ''
      AND btrim("reauthorizationApprovalInstanceId") <> ''
      AND btrim("reauthorizationApprovalActionLogId") <> ''
      AND btrim("reauthorizationPaymentRequestId") <> ''
      AND btrim("reauthorizationContractVersionId") <> ''
      AND btrim("reauthorizedByUserId") <> ''
      AND "reauthorizedAt" IS NOT NULL)
  );

CREATE FUNCTION guard_payment_execution_payer_attestation_authority()
RETURNS TRIGGER AS $$
DECLARE
  authority RECORD;
  execution_record RECORD;
  approval_record RECORD;
  authorization_evidence RECORD;
  metadata JSONB;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;

  SELECT verification.*
  INTO authority
  FROM "PaymentExecutionPayerVerification" verification
  WHERE verification."id" = NEW."payerVerificationId"
    AND verification."reference" = NEW."bankAccountReference"
  FOR UPDATE;
  IF NOT FOUND
     OR authority."status" IS DISTINCT FROM 'verified'
     OR authority."sourceType" IS DISTINCT FROM 'bank_account_legal_holder'
     OR authority."holderCompanyEntityId" IS DISTINCT FROM NEW."holderCompanyEntityId"
     OR authority."holderNameSnapshot" IS DISTINCT FROM NEW."holderNameSnapshot"
     OR authority."holderCreditCodeSnapshot" IS DISTINCT FROM NEW."holderCreditCodeSnapshot"
     OR authority."verificationReference" IS DISTINCT FROM NEW."verificationReference"
     OR authority."verifiedByUserId" IS DISTINCT FROM NEW."verifiedByUserId"
     OR authority."verifiedAt" IS DISTINCT FROM NEW."verifiedAt"
     OR authority."verificationEvidenceFileId" IS DISTINCT FROM NEW."verificationEvidenceFileId"
     OR authority."verificationEvidenceContentSha256" IS DISTINCT FROM NEW."verificationEvidenceContentSha256" THEN
    RAISE EXCEPTION 'payment_execution_payer_attestation_authority_mismatch';
  END IF;

  SELECT execution."paymentRequestId", execution."executedByUserId",
         request."contractVersionId"
  INTO execution_record
  FROM "PaymentExecution" execution
  INNER JOIN "PaymentRequest" request ON request."id" = execution."paymentRequestId"
  WHERE execution."id" = NEW."paymentExecutionId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_execution_payer_attestation_execution_missing';
  END IF;
  IF authority."verifiedByUserId" IS NOT DISTINCT FROM execution_record."executedByUserId" THEN
    RAISE EXCEPTION 'payment_execution_payer_attestation_verifier_sod_invalid';
  END IF;

  IF NEW."proxyAuthorizationReason" IS NULL THEN
    IF NEW."reauthorizedByUserId" IS NOT NULL
       OR NEW."reauthorizedAt" IS NOT NULL
       OR NEW."reauthorizationReference" IS NOT NULL
       OR NEW."reauthorizationApprovalInstanceId" IS NOT NULL
       OR NEW."reauthorizationApprovalActionLogId" IS NOT NULL
       OR NEW."reauthorizationPaymentRequestId" IS NOT NULL
       OR NEW."reauthorizationContractVersionId" IS NOT NULL THEN
      RAISE EXCEPTION 'payment_execution_payer_attestation_authorization_shape_invalid';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."reauthorizedByUserId" IS NOT DISTINCT FROM execution_record."executedByUserId"
     OR NEW."reauthorizedByUserId" IS NOT DISTINCT FROM authority."verifiedByUserId"
     OR NEW."reauthorizedAt" > CURRENT_TIMESTAMP
     OR NEW."reauthorizationPaymentRequestId" IS DISTINCT FROM execution_record."paymentRequestId"
     OR NEW."reauthorizationContractVersionId" IS DISTINCT FROM execution_record."contractVersionId" THEN
    RAISE EXCEPTION 'payment_execution_payer_attestation_authorization_sod_invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "User" reauthorizer
    INNER JOIN "UserPosition" assignment ON assignment."userId" = reauthorizer."id"
    INNER JOIN "Position" position ON position."id" = assignment."positionId"
    WHERE reauthorizer."id" = NEW."reauthorizedByUserId"
      AND reauthorizer."isActive" = TRUE
      AND assignment."projectId" IS NULL
      AND position."key" = 'finance_director'
  ) THEN
    RAISE EXCEPTION 'payment_execution_payer_attestation_reauthorizer_invalid';
  END IF;

  SELECT action_log."id" AS action_log_id,
         action_log."approvalInstanceId" AS action_instance_id,
         action_log."action" AS action,
         action_log."actorUserId" AS action_actor_user_id,
         action_log."approvedRoleKey" AS approved_role_key,
         action_log."metadata" AS action_metadata,
         instance."id" AS instance_id,
         instance."businessType" AS instance_business_type,
         instance."businessId" AS instance_business_id,
         instance."status" AS instance_status
  INTO approval_record
  FROM "ApprovalActionLog" action_log
  INNER JOIN "ApprovalInstance" instance
    ON instance."id" = action_log."approvalInstanceId"
  WHERE action_log."id" = NEW."reauthorizationApprovalActionLogId"
    AND instance."id" = NEW."reauthorizationApprovalInstanceId"
  FOR UPDATE OF action_log, instance;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_execution_payer_attestation_approval_binding_invalid';
  END IF;
  metadata := CASE
    WHEN approval_record.action_metadata IS NULL THEN '{}'::JSONB
    ELSE approval_record.action_metadata
  END;
  IF approval_record.action_log_id IS DISTINCT FROM NEW."reauthorizationReference"
     OR approval_record.action_instance_id IS DISTINCT FROM NEW."reauthorizationApprovalInstanceId"
     OR approval_record.action IS DISTINCT FROM 'approve'
     OR approval_record.action_actor_user_id IS DISTINCT FROM NEW."reauthorizedByUserId"
     OR approval_record.approved_role_key IS DISTINCT FROM 'finance_director'
     OR approval_record.instance_status IS DISTINCT FROM 'approved'
     OR approval_record.instance_business_type IS DISTINCT FROM 'payment_request'
     OR approval_record.instance_business_id IS DISTINCT FROM execution_record."paymentRequestId"
     OR metadata ->> 'paymentRequestId' IS DISTINCT FROM execution_record."paymentRequestId"
     OR metadata ->> 'contractVersionId' IS DISTINCT FROM execution_record."contractVersionId" THEN
    RAISE EXCEPTION 'payment_execution_payer_attestation_approval_binding_invalid';
  END IF;

  SELECT evidence."id", evidence."uploadedByUserId", evidence."storageStatus",
         evidence."contentSha256"
  INTO authorization_evidence
  FROM "FileObject" evidence
  WHERE evidence."id" = NEW."proxyAuthorizationEvidenceFileId"
  FOR UPDATE;
  IF NOT FOUND
     OR authorization_evidence."storageStatus" IS DISTINCT FROM 'active'
     OR authorization_evidence."uploadedByUserId" IS DISTINCT FROM NEW."reauthorizedByUserId"
     OR authorization_evidence."contentSha256" IS DISTINCT FROM NEW."proxyAuthorizationEvidenceSha256" THEN
    RAISE EXCEPTION 'payment_execution_payer_attestation_authorization_evidence_invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "zz_PaymentExecutionPayerAttestation_authority_guard"
  BEFORE INSERT ON "PaymentExecutionPayerAttestation"
  FOR EACH ROW EXECUTE FUNCTION guard_payment_execution_payer_attestation_authority();

-- A cross-company relationship is only valid when the immutable attestation
-- also carries the approved proxy reauthorization.  The attestation trigger
-- verifies the approval facts; this guard prevents a direct SQL writer from
-- omitting that binding when the relationship root is confirmed later.
CREATE FUNCTION guard_inter_entity_relationship_proxy_authorization()
RETURNS TRIGGER AS $$
DECLARE
  execution_record RECORD;
  attestation_record RECORD;
BEGIN
  IF NEW."status" IS DISTINCT FROM 'confirmed'
     OR NEW."entryKind" IS DISTINCT FROM 'proxy_payment' THEN
    RETURN NEW;
  END IF;

  SELECT execution."paymentRequestId" AS payment_request_id,
         execution."voucherFileId" AS voucher_file_id,
         version."companyEntityIdSnapshot" AS approved_payer_company_id
  INTO execution_record
  FROM "PaymentExecution" execution
  INNER JOIN "PaymentRequest" request
    ON request."id" = execution."paymentRequestId"
  INNER JOIN "ContractVersion" version
    ON version."id" = request."contractVersionId"
  WHERE execution."id" = NEW."paymentExecutionId";
  IF NOT FOUND
     OR execution_record.approved_payer_company_id IS NULL
     OR NEW."evidenceFileId" IS DISTINCT FROM execution_record.voucher_file_id THEN
    RAISE EXCEPTION 'inter_entity_relationship_scope_invalid';
  END IF;

  SELECT attestation.*
  INTO attestation_record
  FROM "PaymentExecutionPayerAttestation" attestation
  WHERE attestation."paymentExecutionId" = NEW."paymentExecutionId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inter_entity_relationship_payer_attestation_invalid';
  END IF;

  IF NEW."originalDebtorCompanyId" IS DISTINCT FROM execution_record.approved_payer_company_id
     OR NEW."creditorCompanyId" IS DISTINCT FROM execution_record.approved_payer_company_id THEN
    IF attestation_record."proxyAuthorizationReason" IS NULL
       OR attestation_record."proxyAuthorizationEvidenceFileId" IS NULL
       OR attestation_record."proxyAuthorizationEvidenceSha256" IS NULL
       OR attestation_record."reauthorizationReference" IS NULL
       OR attestation_record."reauthorizationApprovalInstanceId" IS NULL
       OR attestation_record."reauthorizationApprovalActionLogId" IS NULL
       OR attestation_record."reauthorizationPaymentRequestId" IS NULL
       OR attestation_record."reauthorizationContractVersionId" IS NULL
       OR attestation_record."reauthorizedByUserId" IS NULL
       OR attestation_record."reauthorizedAt" IS NULL
       OR NEW."authorizationEvidenceFileId" IS DISTINCT FROM attestation_record."proxyAuthorizationEvidenceFileId"
       OR NEW."authorizationEvidenceContentSha256" IS DISTINCT FROM attestation_record."proxyAuthorizationEvidenceSha256"
       OR NEW."reauthorizationReference" IS DISTINCT FROM attestation_record."reauthorizationReference"
       OR NEW."reauthorizedByUserId" IS DISTINCT FROM attestation_record."reauthorizedByUserId"
       OR NEW."reauthorizedAt" IS DISTINCT FROM attestation_record."reauthorizedAt" THEN
      RAISE EXCEPTION 'inter_entity_relationship_authorization_required';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "zzz_inter_entity_relationship_proxy_authorization_guard"
  BEFORE INSERT OR UPDATE ON "InterEntityRelationshipEntry"
  FOR EACH ROW EXECUTE FUNCTION guard_inter_entity_relationship_proxy_authorization();

-- Once an attestation has captured an approval, the approval rows and their
-- evidence identity are frozen.  This prevents later edits from silently
-- invalidating the SoD and approval binding that the payment fact relied on.
CREATE FUNCTION guard_payment_execution_payer_approval_binding_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'ApprovalActionLog' AND EXISTS (
    SELECT 1
    FROM "PaymentExecutionPayerAttestation" attestation
    WHERE attestation."reauthorizationApprovalActionLogId" = OLD."id"
  ) THEN
    RAISE EXCEPTION 'payment_execution_payer_approval_binding_immutable';
  END IF;
  IF TG_TABLE_NAME = 'ApprovalInstance' AND EXISTS (
    SELECT 1
    FROM "PaymentExecutionPayerAttestation" attestation
    WHERE attestation."reauthorizationApprovalInstanceId" = OLD."id"
  ) THEN
    RAISE EXCEPTION 'payment_execution_payer_approval_binding_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentExecutionPayerAttestation_approval_action_immutable"
  BEFORE UPDATE OR DELETE ON "ApprovalActionLog"
  FOR EACH ROW EXECUTE FUNCTION guard_payment_execution_payer_approval_binding_immutable();
CREATE TRIGGER "PaymentExecutionPayerAttestation_approval_instance_immutable"
  BEFORE UPDATE OR DELETE ON "ApprovalInstance"
  FOR EACH ROW EXECUTE FUNCTION guard_payment_execution_payer_approval_binding_immutable();

CREATE FUNCTION guard_payment_execution_payer_evidence_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1
    FROM "PaymentExecutionPayerVerification" authority
    WHERE authority."verificationEvidenceFileId" = OLD."id"
  ) THEN
    RAISE EXCEPTION 'payment_execution_payer_evidence_immutable';
  END IF;
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1
    FROM "PaymentExecutionPayerAttestation" attestation
    WHERE attestation."verificationEvidenceFileId" = OLD."id"
       OR attestation."proxyAuthorizationEvidenceFileId" = OLD."id"
  ) THEN
    RAISE EXCEPTION 'payment_execution_payer_evidence_immutable';
  END IF;
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1
    FROM "InterEntityRelationshipEntry" relationship
    WHERE relationship."authorizationEvidenceFileId" = OLD."id"
       OR relationship."actualPayerVerificationEvidenceFileId" = OLD."id"
  ) THEN
    RAISE EXCEPTION 'payment_execution_payer_evidence_immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF (NEW."contentSha256" IS DISTINCT FROM OLD."contentSha256"
      OR NEW."storageStatus" IS DISTINCT FROM OLD."storageStatus"
      OR NEW."uploadedByUserId" IS DISTINCT FROM OLD."uploadedByUserId"
      OR NEW."supersedesFileObjectId" IS DISTINCT FROM OLD."supersedesFileObjectId")
     AND (
       EXISTS (
         SELECT 1
         FROM "PaymentExecutionPayerVerification" authority
         WHERE authority."verificationEvidenceFileId" = OLD."id"
       )
       OR EXISTS (
         SELECT 1
         FROM "PaymentExecutionPayerAttestation" attestation
         WHERE attestation."verificationEvidenceFileId" = OLD."id"
            OR attestation."proxyAuthorizationEvidenceFileId" = OLD."id"
       )
       OR EXISTS (
         SELECT 1
         FROM "InterEntityRelationshipEntry" relationship
         WHERE relationship."authorizationEvidenceFileId" = OLD."id"
            OR relationship."actualPayerVerificationEvidenceFileId" = OLD."id"
       )
     ) THEN
    RAISE EXCEPTION 'payment_execution_payer_evidence_immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentExecutionPayerAttestation_evidence_immutable"
  BEFORE UPDATE OF "contentSha256", "storageStatus", "uploadedByUserId", "supersedesFileObjectId"
    OR DELETE ON "FileObject"
  FOR EACH ROW EXECUTE FUNCTION guard_payment_execution_payer_evidence_immutable();

-- A confirmed cross-company case must have exactly one confirmed relationship
-- root whose immutable source snapshot equals the case allocations. Drafts
-- remain writable so the service can build the complete set in one transaction.
CREATE OR REPLACE FUNCTION assert_inter_entity_relationship_lineage(
  p_settlement_case_id TEXT,
  p_payment_execution_id TEXT
)
RETURNS VOID AS $$
DECLARE
  case_status TEXT;
  case_execution_id TEXT;
  execution_company_id TEXT;
  approved_payer_company_id TEXT;
  request_project_id TEXT;
  request_contract_id TEXT;
  request_contract_version_id TEXT;
  execution_voucher_file_id TEXT;
  allocation_count BIGINT;
  allocation_amount_cents BIGINT;
  cross_allocation_count BIGINT;
  debtor_count BIGINT;
  project_count BIGINT;
  source_count BIGINT;
  source_type TEXT;
  source_aggregate_id TEXT;
  debtor_company_id TEXT;
  project_id TEXT;
  root_record RECORD;
  invalid_binding_count BIGINT;
BEGIN
  SELECT settlement_case."status", settlement_case."paymentExecutionId"
  INTO case_status, case_execution_id
  FROM "PayableSettlementCase" settlement_case
  WHERE settlement_case."id" = p_settlement_case_id;
  IF NOT FOUND OR case_status IS DISTINCT FROM 'confirmed' THEN
    RETURN;
  END IF;
  IF case_execution_id IS DISTINCT FROM p_payment_execution_id THEN
    RAISE EXCEPTION 'inter_entity_relationship_execution_missing';
  END IF;

  SELECT COALESCE(attestation."holderCompanyEntityId", execution."companyEntityIdSnapshot"),
         version."companyEntityIdSnapshot",
         request."projectId",
         request."contractId",
         request."contractVersionId",
         execution."voucherFileId"
  INTO execution_company_id, approved_payer_company_id, request_project_id,
       request_contract_id, request_contract_version_id, execution_voucher_file_id
  FROM "PaymentExecution" execution
  INNER JOIN "PaymentRequest" request
    ON request."id" = execution."paymentRequestId"
  INNER JOIN "ContractVersion" version
    ON version."id" = request."contractVersionId"
  LEFT JOIN "PaymentExecutionPayerAttestation" attestation
    ON attestation."paymentExecutionId" = execution."id"
  WHERE execution."id" = p_payment_execution_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inter_entity_relationship_execution_missing';
  END IF;

  SELECT COUNT(*)::BIGINT,
         COALESCE(SUM(allocation."amountCents"), 0),
         COUNT(*) FILTER (
           WHERE allocation."debtorCompanyId" IS DISTINCT FROM execution_company_id
         )::BIGINT,
         COUNT(DISTINCT allocation."debtorCompanyId")::BIGINT,
         COUNT(DISTINCT allocation."beneficiaryProjectId")::BIGINT,
         COUNT(DISTINCT allocation."sourceAggregateId")::BIGINT,
         MIN(allocation."sourceType"),
         MIN(allocation."sourceAggregateId"),
         MIN(allocation."debtorCompanyId"),
         MIN(allocation."beneficiaryProjectId")
  INTO allocation_count, allocation_amount_cents, cross_allocation_count,
       debtor_count, project_count, source_count, source_type,
       source_aggregate_id, debtor_company_id, project_id
  FROM "PayableSettlementAllocation" allocation
  WHERE allocation."settlementCaseId" = p_settlement_case_id;
  IF cross_allocation_count = 0 THEN
    RETURN;
  END IF;
  IF allocation_count = 0
     OR cross_allocation_count <> allocation_count
     OR debtor_count <> 1
     OR project_count <> 1
     OR source_count <> 1
     OR source_type IS DISTINCT FROM 'wage_payable_ref' THEN
    RAISE EXCEPTION 'inter_entity_relationship_source_lineage_invalid';
  END IF;

  SELECT root.*
  INTO root_record
  FROM "InterEntityRelationshipEntry" root
  WHERE root."settlementCaseId" = p_settlement_case_id
    AND root."paymentExecutionId" = p_payment_execution_id
    AND root."entryKind" = 'proxy_payment'
    AND root."direction" = 'increase'
    AND root."status" = 'confirmed'
    AND root."adjustsEntryId" IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inter_entity_relationship_required';
  END IF;
  IF root_record."originalDebtorCompanyId" IS DISTINCT FROM debtor_company_id
     OR root_record."creditorCompanyId" IS DISTINCT FROM execution_company_id
     OR root_record."approvedPayerCompanyId" IS DISTINCT FROM approved_payer_company_id
     OR root_record."evidenceFileId" IS DISTINCT FROM execution_voucher_file_id
     OR root_record."projectId" IS DISTINCT FROM project_id
     OR root_record."projectId" IS DISTINCT FROM request_project_id
     OR root_record."contractId" IS DISTINCT FROM request_contract_id
     OR root_record."contractVersionId" IS DISTINCT FROM request_contract_version_id
     OR root_record."sourceType" IS DISTINCT FROM source_type
     OR root_record."sourceAggregateId" IS DISTINCT FROM source_aggregate_id
     OR root_record."sourceAllocationCount" IS DISTINCT FROM allocation_count::INTEGER
     OR root_record."sourceAllocationAmountCents" IS DISTINCT FROM allocation_amount_cents
     OR root_record."amountCents" IS DISTINCT FROM allocation_amount_cents THEN
    RAISE EXCEPTION 'inter_entity_relationship_source_lineage_invalid';
  END IF;

  SELECT COUNT(*)::BIGINT
  INTO invalid_binding_count
  FROM "PaymentExecutionWagePayableBinding" binding
  LEFT JOIN "PayableSettlementAllocation" allocation
    ON allocation."settlementCaseId" = p_settlement_case_id
   AND allocation."payableRef" = binding."wagePayableRefId"
  WHERE binding."paymentExecutionId" = p_payment_execution_id
    AND (
      allocation."id" IS NULL
      OR binding."debtorCompanyId" IS DISTINCT FROM root_record."originalDebtorCompanyId"
      OR binding."projectId" IS DISTINCT FROM root_record."projectId"
      OR binding."amountCents" > allocation."amountCents"
    );
  IF invalid_binding_count > 0 THEN
    RAISE EXCEPTION 'inter_entity_relationship_binding_lineage_invalid';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION guard_inter_entity_relationship_lineage_deferred()
RETURNS TRIGGER AS $$
DECLARE
  confirmed_case RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'PayableSettlementCase' THEN
      PERFORM assert_inter_entity_relationship_lineage(OLD."id", OLD."paymentExecutionId");
    END IF;
    RETURN OLD;
  END IF;
  IF TG_TABLE_NAME = 'PayableSettlementCase' THEN
    PERFORM assert_inter_entity_relationship_lineage(NEW."id", NEW."paymentExecutionId");
  ELSIF TG_TABLE_NAME = 'PayableSettlementAllocation' THEN
    PERFORM assert_inter_entity_relationship_lineage(NEW."settlementCaseId", NEW."paymentExecutionId");
  ELSIF TG_TABLE_NAME = 'PaymentExecutionWagePayableBinding' THEN
    FOR confirmed_case IN
      SELECT settlement_case."id", settlement_case."paymentExecutionId"
      FROM "PayableSettlementCase" settlement_case
      WHERE settlement_case."paymentExecutionId" = NEW."paymentExecutionId"
        AND settlement_case."status" = 'confirmed'
    LOOP
      PERFORM assert_inter_entity_relationship_lineage(
        confirmed_case."id",
        confirmed_case."paymentExecutionId"
      );
    END LOOP;
  ELSIF TG_TABLE_NAME = 'InterEntityRelationshipEntry' THEN
    PERFORM assert_inter_entity_relationship_lineage(
      NEW."settlementCaseId",
      NEW."paymentExecutionId"
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "PayableSettlementCase_inter_entity_lineage_guard"
  AFTER INSERT OR UPDATE ON "PayableSettlementCase"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION guard_inter_entity_relationship_lineage_deferred();

CREATE CONSTRAINT TRIGGER "PayableSettlementAllocation_inter_entity_lineage_guard"
  AFTER INSERT OR UPDATE ON "PayableSettlementAllocation"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION guard_inter_entity_relationship_lineage_deferred();

CREATE CONSTRAINT TRIGGER "PaymentExecutionWagePayableBinding_inter_entity_lineage_guard"
  AFTER INSERT OR UPDATE ON "PaymentExecutionWagePayableBinding"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION guard_inter_entity_relationship_lineage_deferred();

CREATE CONSTRAINT TRIGGER "InterEntityRelationshipEntry_inter_entity_lineage_guard"
  AFTER INSERT OR UPDATE ON "InterEntityRelationshipEntry"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION guard_inter_entity_relationship_lineage_deferred();

-- Extend the single file-binding registry with the authority evidence file.
ALTER FUNCTION jg_file_business_binding_columns()
  RENAME TO jg_file_business_binding_columns_before_pol13b_payer_authority;
CREATE FUNCTION jg_file_business_binding_columns()
RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN)
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT * FROM jg_file_business_binding_columns_before_pol13b_payer_authority()
  UNION ALL
  VALUES
    ('PaymentExecutionPayerVerification', 'verificationEvidenceFileId', FALSE);
$$;

CREATE TRIGGER jg_efb_payment_execution_payer_authority_evidence
BEFORE INSERT OR UPDATE OF "verificationEvidenceFileId" ON "PaymentExecutionPayerVerification"
FOR EACH ROW
EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding(
  'verificationEvidenceFileId',
  'false'
);

COMMIT;
