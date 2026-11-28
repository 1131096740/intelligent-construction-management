BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger trigger_row
    JOIN pg_catalog.pg_proc routine ON routine.oid = trigger_row.tgfoid
    JOIN pg_catalog.pg_class claim_table ON claim_table.oid = trigger_row.tgrelid
    WHERE claim_table.oid = 'public."ContractBankEventClaim"'::regclass
      AND trigger_row.tgname = 'ContractBankEventClaim_company_transfer'
      AND trigger_row.tgenabled = 'O' AND trigger_row.tgtype = 7 AND NOT trigger_row.tgisinternal
      AND routine.oid = 'public.guard_other_bank_claim_against_company_transfer()'::regprocedure
      AND routine.proowner = claim_table.relowner AND NOT routine.prosecdef
      AND pg_get_userbyid(claim_table.relowner) = current_user
      AND encode(sha256(convert_to(routine.prosrc, 'UTF8')), 'hex') =
        '5f445bd85a1309da3fae158abdd3447b011b31c0233977949fc3bffe4b097d76'
  ) THEN
    RAISE EXCEPTION 'task07_contract_bank_guard_preimage_changed';
  END IF;
END;
$$;

-- The other two claim tables keep the existing company-transfer guard.
CREATE FUNCTION public.jg_guard_contract_bank_event_company_transfer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  holder_active boolean;
BEGIN
  SELECT company."isActive" INTO STRICT holder_active
  FROM public."VerifiedBankTransactionObservation" observation
  JOIN public."CompanyEntity" company ON company."id" = observation."holderCompanyEntityId"
  WHERE observation."id" = NEW."observationId"
  FOR UPDATE OF observation;

  IF NOT holder_active THEN
    IF NEW."sourceType" IS DISTINCT FROM 'payment_execution' THEN
      RAISE EXCEPTION 'inactive_company_repayment_only';
    END IF;

    -- The execution service already holds this lock before locking the observation.
    -- A direct claim must not wait in the opposite order.
    PERFORM 1 FROM public."PaymentRequest" request
    JOIN public."PaymentExecution" execution ON execution."paymentRequestId" = request."id"
    WHERE execution."id" = NEW."sourceId"
    FOR UPDATE OF request NOWAIT;

    IF NOT EXISTS (
      SELECT 1
      FROM public."PaymentExecution" execution
      JOIN public."PaymentRequest" request ON request."id" = execution."paymentRequestId"
      JOIN public."Contract" contract ON contract."id" = request."contractId" AND contract."projectId" = request."projectId"
      JOIN public."ContractVersion" version ON version."id" = request."contractVersionId" AND version."contractId" = contract."id"
      JOIN public."Settlement" settlement ON settlement."id" = request."settlementId"
        AND settlement."projectId" = request."projectId" AND settlement."contractId" = contract."id"
        AND settlement."contractVersionId" = version."id"
        AND settlement."paymentTermsVersionId" = request."paymentTermsVersionId"
      JOIN public."CompanyEntityVersion" company ON company."id" = version."companyEntityVersionId"
        AND company."companyEntityId" = version."companyEntityIdSnapshot"
      JOIN public."VerifiedBankTransactionObservation" observation ON observation."id" = NEW."observationId"
      JOIN public."PaymentExecutionPayerVerification" verification ON verification."id" = observation."payerVerificationId"
      JOIN public."ContractBankVerificationRequest" bank ON bank."id" = observation."transactionSourceId"
        AND bank."observationId" = observation."id" AND bank."payerVerificationId" = verification."id"
      JOIN public."FileObject" holder_evidence ON holder_evidence."id" = verification."verificationEvidenceFileId"
      JOIN public."FileObject" transaction_evidence ON transaction_evidence."id" = bank."evidenceFileId"
      JOIN public."User" verifier ON verifier."id" = verification."verifiedByUserId"
      JOIN LATERAL (
        SELECT round.* FROM public."ApprovalInstance" round
        WHERE round."businessType" = 'payment_request' AND round."flowType" = 'payment.approve'
          AND round."businessId" = request."id"
        ORDER BY round."createdAt" DESC LIMIT 1
      ) approval ON approval."status" = 'approved'
      WHERE execution."id" = NEW."sourceId"
        AND execution.xmin::text = (txid_current() % 4294967296)::text
        AND execution."executedByUserId" = NEW."createdByUserId"
        AND execution."paymentSubjectType" = 'our_company'
        AND execution."settlementId" = request."settlementId"
        AND execution."amountCents" > 0
        AND execution."amountCents" <= request."approvedAmountCents" - request."paidAmountCents"
        AND request."sourceType" = 'settlement' AND request."paymentSubjectType" = 'our_company'
        AND request."status" IN ('approved_pending_payment', 'partially_paid') AND request."abandonedAt" IS NULL
        AND contract."voidedAt" IS NULL
        AND version."status" IN ('effective', 'superseded') AND version."signingSubjectType" = 'our_company'
        AND company."companyEntityId" = execution."companyEntityIdSnapshot"
        AND company."companyEntityId" = observation."holderCompanyEntityId"
        AND company."companyEntityId" = verification."holderCompanyEntityId"
        AND company."companyEntityId" = bank."companyEntityId"
        AND company."name" = version."companyEntityNameSnapshot"
        AND company."name" = execution."companyEntityNameSnapshot"
        AND company."name" = observation."holderNameSnapshot"
        AND company."name" = verification."holderNameSnapshot" AND company."name" = bank."companyName"
        AND NULLIF(btrim(company."unifiedSocialCreditCode"), '') IS NOT NULL
        AND company."unifiedSocialCreditCode" = version."companyEntityCreditCodeSnapshot"
        AND company."unifiedSocialCreditCode" = execution."companyEntityCreditCodeSnapshot"
        AND company."unifiedSocialCreditCode" = observation."holderCreditCodeSnapshot"
        AND company."unifiedSocialCreditCode" = verification."holderCreditCodeSnapshot"
        AND company."unifiedSocialCreditCode" = bank."companyCreditCode"
        AND observation."transactionSourceType" = 'contract_bank_verification'
        AND observation."payerVerificationReference" = verification."reference"
        AND observation."transactionSourceIdentity" = bank."bankIdentity"
        AND observation."direction" = 'outflow' AND bank."direction" = observation."direction"
        AND observation."amountCents" = execution."amountCents" AND bank."amountCents" = observation."amountCents"
        AND bank."occurredAt" = observation."occurredAt"
        AND (execution."paidAt" + interval '8 hours')::date = (bank."occurredAt" + interval '8 hours')::date
        AND bank."projectId" = request."projectId" AND bank."status" = 'confirmed'
        AND bank."confirmedByUserId" = verifier."id" AND bank."recordedByUserId" <> verifier."id"
        AND bank."holderEvidenceFileId" = holder_evidence."id"
        AND bank."evidenceFileId" = observation."transactionEvidenceFileId"
        AND transaction_evidence."contentSha256" = bank."evidenceSha256"
        AND transaction_evidence."contentSha256" = observation."transactionEvidenceContentSha256"
        AND transaction_evidence."storageStatus" = 'active'
        AND verification."sourceType" = 'bank_account_legal_holder' AND verification."sourceRecordId" = bank."id"
        AND verification."status" = 'verified' AND verification."verifiedAt" <= CURRENT_TIMESTAMP
        AND holder_evidence."uploadedByUserId" = verifier."id"
        AND holder_evidence."storageStatus" = 'active'
        AND holder_evidence."contentSha256" = verification."verificationEvidenceContentSha256"
        AND verifier."isActive" AND verifier."id" <> NEW."createdByUserId"
        AND EXISTS (
          SELECT 1 FROM public."UserPosition" assignment
          JOIN public."Position" position ON position."id" = assignment."positionId"
          WHERE assignment."userId" = verifier."id" AND assignment."projectId" IS NULL AND position."key" = 'finance_director'
        )
        AND NOT EXISTS (
          SELECT 1 FROM public."PaymentExecutionPayerAttestation" attestation
          WHERE attestation."paymentExecutionId" = execution."id"
            AND (attestation."payerVerificationId" IS DISTINCT FROM verification."id"
              OR attestation."holderCompanyEntityId" IS DISTINCT FROM company."companyEntityId"
              OR attestation."holderNameSnapshot" IS DISTINCT FROM company."name"
              OR attestation."holderCreditCodeSnapshot" IS DISTINCT FROM company."unifiedSocialCreditCode")
        )
        AND NOT EXISTS (
          SELECT 1 FROM public."ApprovalInstance" tied
          WHERE tied."businessType" = approval."businessType" AND tied."flowType" = approval."flowType"
            AND tied."businessId" = approval."businessId" AND tied."createdAt" = approval."createdAt" AND tied."id" <> approval."id"
        )
        AND CASE WHEN jsonb_typeof(approval."frozenNodes") = 'array'
          THEN jsonb_array_length(approval."frozenNodes") > 0
            AND approval."currentNodeIndex" = jsonb_array_length(approval."frozenNodes")
          ELSE false END
        AND EXISTS (
          SELECT 1 FROM public."BusinessEntrySubmissionSnapshot" original
          WHERE original."sceneKey" = 'payment_request' AND original."entityType" = 'payment_request'
            AND original."projectId" = request."projectId" AND original."entityId" = request."id"
            AND original."revision" = 1 AND original."definitionVersion" = 1
            AND original."frozenByUserId" = approval."applicantUserId"
            AND original."valuesSnapshot" @> jsonb_build_object(
              'code', request."code", 'sourceType', request."sourceType", 'paymentSubjectType', request."paymentSubjectType",
              'settlementId', request."settlementId", 'contractId', contract."id",
              'contractVersionId', version."id", 'paymentTermsVersionId', request."paymentTermsVersionId")
        )
        AND EXISTS (
          SELECT 1 FROM public."BusinessEntrySubmissionSnapshot" amount
          JOIN public."ApprovalActionLog" action ON action."approvalInstanceId" = approval."id"
            AND action."actorUserId" = amount."frozenByUserId" AND action."action" = 'approve'
          JOIN public."HandwrittenSignatureVersion" signature ON signature."id" = action."signatureVersionIdSnapshot"
            AND signature."userId" = action."actorUserId" AND signature."fileId" = action."signatureFileIdSnapshot"
            AND signature."contentSha256" = action."signatureSha256Snapshot"
          WHERE amount."sceneKey" = 'payment_approval_amount' AND amount."entityType" = 'payment_request'
            AND amount."projectId" = request."projectId" AND amount."entityId" = request."id"
            AND amount."revision" = 1 AND amount."definitionVersion" = 1
            AND amount."valuesSnapshot" ->> 'approvedAmountYuan' = (request."approvedAmountCents"::numeric / 100)::numeric(24,2)::text
            AND amount."frozenAt" >= approval."createdAt" AND action."createdAt" >= approval."createdAt"
            AND (approval."frozenNodes" -> -1 -> 'approvedRoleKeys') ? action."approvedRoleKey"
            AND NULLIF(btrim(action."signatureVersionIdSnapshot"), '') IS NOT NULL
        )
    ) THEN
      RAISE EXCEPTION 'inactive_company_repayment_only';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public."CompanyTransferBankClaim" WHERE "observationId" = NEW."observationId") THEN
    RAISE EXCEPTION 'bank_transaction_already_claimed';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER "ContractBankEventClaim_company_transfer" ON public."ContractBankEventClaim";
CREATE TRIGGER "ContractBankEventClaim_company_transfer"
BEFORE INSERT ON public."ContractBankEventClaim"
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_contract_bank_event_company_transfer();

COMMIT;
