BEGIN;
CREATE TABLE "ContractBankVerificationRequest" (
 "id" TEXT PRIMARY KEY,"projectId" TEXT NOT NULL REFERENCES "Project"("id"),"companyEntityId" TEXT NOT NULL REFERENCES "CompanyEntity"("id"),"companyName" TEXT NOT NULL,"companyCreditCode" TEXT NOT NULL,
 "accountHash" TEXT NOT NULL CHECK(length("accountHash")=64),"accountLast4" TEXT NOT NULL,"bankReference" TEXT NOT NULL,"bankIdentity" TEXT NOT NULL,
 "direction" TEXT NOT NULL CHECK("direction" IN ('inflow','outflow')),"amountCents" BIGINT NOT NULL CHECK("amountCents">0),"occurredAt" TIMESTAMP(3) NOT NULL,
 "evidenceFileId" TEXT NOT NULL REFERENCES "FileObject"("id"),"evidenceSha256" TEXT NOT NULL,"reason" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'pending_confirm' CHECK("status" IN ('pending_confirm','confirmed','returned')),
 "recordedByUserId" TEXT NOT NULL REFERENCES "User"("id"),"confirmedByUserId" TEXT REFERENCES "User"("id"),"confirmedAt" TIMESTAMP(3),"signatureVersionId" TEXT REFERENCES "HandwrittenSignatureVersion"("id"),"holderEvidenceFileId" TEXT REFERENCES "FileObject"("id"),
 "payerVerificationId" TEXT REFERENCES "PaymentExecutionPayerVerification"("id"),"observationId" TEXT REFERENCES "VerifiedBankTransactionObservation"("id"),
 "idempotencyKey" TEXT NOT NULL UNIQUE,"requestFingerprint" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK("confirmedByUserId" IS NULL OR "confirmedByUserId"<>"recordedByUserId"),
 CHECK("status"<>'confirmed' OR ("confirmedAt" IS NOT NULL AND "signatureVersionId" IS NOT NULL AND "holderEvidenceFileId" IS NOT NULL AND "payerVerificationId" IS NOT NULL AND "observationId" IS NOT NULL))
);
CREATE UNIQUE INDEX "ContractBankVerificationRequest_active_bank_identity" ON "ContractBankVerificationRequest"("bankIdentity") WHERE "status"<>'returned';
CREATE INDEX "ContractBankVerificationRequest_projectId_status_idx" ON "ContractBankVerificationRequest"("projectId","status");
CREATE FUNCTION guard_contract_bank_verification_request() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR OLD."status"<>'pending_confirm' THEN RAISE EXCEPTION 'bank_verification_request_immutable'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','confirmedByUserId','confirmedAt','signatureVersionId','holderEvidenceFileId','payerVerificationId','observationId']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','confirmedByUserId','confirmedAt','signatureVersionId','holderEvidenceFileId','payerVerificationId','observationId']) THEN RAISE EXCEPTION 'bank_verification_evidence_immutable'; END IF;
 RETURN NEW; END; $$;
CREATE TRIGGER "ContractBankVerificationRequest_immutable" BEFORE UPDATE OR DELETE ON "ContractBankVerificationRequest" FOR EACH ROW EXECUTE FUNCTION guard_contract_bank_verification_request();
-- Narrow issuance seam: no caller-supplied authority payload and no broad issuer grants.
CREATE FUNCTION issue_contract_bank_holder(request_id TEXT,actor_id TEXT,holder_file_id TEXT,signature_id TEXT,account_hash TEXT) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public."ContractBankVerificationRequest"%ROWTYPE; f public."FileObject"%ROWTYPE; issued_id TEXT;
BEGIN
 PERFORM public."assertOperatingLedgerWriteContext"(actor_id);
 SELECT * INTO r FROM public."ContractBankVerificationRequest" WHERE "id"=request_id FOR UPDATE;
 IF account_hash IS DISTINCT FROM r."accountHash" THEN RAISE EXCEPTION 'bank_account_independent_check_required'; END IF;
 IF r."id" IS NULL OR r."status"<>'pending_confirm' OR r."recordedByUserId"=actor_id THEN RAISE EXCEPTION 'bank_verification_independent_review_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."HandwrittenSignatureVersion" WHERE "id"=signature_id AND "userId"=actor_id) THEN RAISE EXCEPTION 'bank_verification_signature_required'; END IF;
 SELECT * INTO f FROM public."FileObject" WHERE "id"=holder_file_id AND "uploadedByUserId"=actor_id AND "storageStatus"='active' FOR UPDATE;
 IF f."id" IS NULL OR f."contentSha256" IS NULL OR f."id"=r."evidenceFileId" THEN RAISE EXCEPTION 'bank_holder_independent_evidence_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."CompanyEntity" WHERE "id"=r."companyEntityId" AND "name"=r."companyName" AND "unifiedSocialCreditCode"=r."companyCreditCode" AND "isActive") THEN RAISE EXCEPTION 'bank_holder_company_changed'; END IF;
 SELECT "id" INTO issued_id FROM public."jg_issue_payment_execution_payer_verification_trusted"(jsonb_build_object('reference','contract-bank-holder:'||r."id",'holderCompanyEntityId',r."companyEntityId",'holderNameSnapshot',r."companyName",'holderCreditCodeSnapshot',r."companyCreditCode",'verificationReference',r."id",'verifiedByUserId',actor_id,'verifiedAt',date_trunc('milliseconds',CURRENT_TIMESTAMP),'verificationEvidenceFileId',f."id",'verificationEvidenceContentSha256',f."contentSha256",'status','verified','sourceType','bank_account_legal_holder','sourceRecordId',r."id"));
 RETURN issued_id;
END; $$;
ALTER FUNCTION jg_file_business_binding_columns() RENAME TO jg_file_business_binding_columns_before_bank_verification;
CREATE FUNCTION jg_file_business_binding_columns() RETURNS TABLE ("tableName" TEXT,"columnName" TEXT,"exclusive" BOOLEAN) LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT * FROM jg_file_business_binding_columns_before_bank_verification() UNION ALL VALUES ('ContractBankVerificationRequest','evidenceFileId',FALSE),('ContractBankVerificationRequest','holderEvidenceFileId',FALSE); $$;
CREATE FUNCTION guard_contract_bank_project_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE observation_id TEXT; bank_project TEXT; target_project TEXT;
BEGIN
 IF TG_TABLE_NAME='FundExecutionCaseAxisSelection' THEN
  SELECT c."observationId" INTO observation_id FROM "BankTransactionClaim" c JOIN "FundExecutionCase" f ON f."fundExecutionId"=c."fundExecutionId" WHERE f."id"=NEW."fundExecutionCaseId";
  target_project:=NEW."optionSnapshot"->'line'->>'projectId';
 ELSE
  observation_id:=NEW."observationId";
  IF TG_TABLE_NAME='ContractProxyBankClaim' THEN
   SELECT "projectId" INTO target_project FROM "ContractProxyExecution" WHERE "id"=NEW."proxyExecutionId";
  ELSIF TG_TABLE_NAME='ContractBankEventClaim' THEN
   IF NEW."sourceType"='payment_execution' THEN
    SELECT r."projectId" INTO target_project FROM "PaymentRequest" r JOIN "PaymentExecution" e ON e."paymentRequestId"=r."id" WHERE e."id"=NEW."sourceId";
   ELSE SELECT "projectId" INTO target_project FROM "ProjectUpstreamFundFact" WHERE "id"=NEW."sourceId"; END IF;
  ELSE
   IF NEW."paymentExecutionId" IS NULL THEN RETURN NEW; END IF;
   SELECT r."projectId" INTO target_project FROM "PaymentRequest" r JOIN "PaymentExecution" e ON e."paymentRequestId"=r."id" WHERE e."id"=NEW."paymentExecutionId";
  END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM "VerifiedBankTransactionObservation" WHERE "id"=observation_id AND "transactionSourceType"='contract_bank_verification') THEN RETURN NEW; END IF;
 SELECT r."projectId" INTO bank_project FROM "ContractBankVerificationRequest" r JOIN "VerifiedBankTransactionObservation" o ON o."transactionSourceId"=r."id" WHERE o."id"=observation_id AND r."status"='confirmed';
 IF bank_project IS NULL OR target_project IS DISTINCT FROM bank_project THEN RAISE EXCEPTION 'bank_transaction_project_mismatch'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "ContractProxyBankClaim_project_scope" BEFORE INSERT ON "ContractProxyBankClaim" FOR EACH ROW EXECUTE FUNCTION guard_contract_bank_project_scope();
CREATE TRIGGER "ContractBankEventClaim_project_scope" BEFORE INSERT ON "ContractBankEventClaim" FOR EACH ROW EXECUTE FUNCTION guard_contract_bank_project_scope();
CREATE TRIGGER "BankTransactionClaim_project_scope" BEFORE INSERT ON "BankTransactionClaim" FOR EACH ROW EXECUTE FUNCTION guard_contract_bank_project_scope();
CREATE TRIGGER "FundExecutionCaseAxisSelection_bank_project_scope" BEFORE INSERT ON "FundExecutionCaseAxisSelection" FOR EACH ROW EXECUTE FUNCTION guard_contract_bank_project_scope();
COMMIT;
