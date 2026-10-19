BEGIN;
ALTER TABLE "ContractBankVerificationRequest" ALTER COLUMN "projectId" DROP NOT NULL;
CREATE TABLE "CompanyTransfer" (
 "id" TEXT PRIMARY KEY,"code" TEXT NOT NULL UNIQUE,"kind" TEXT NOT NULL CHECK("kind" IN ('storage','loan','repayment')),
 "sourceCompanyId" TEXT NOT NULL REFERENCES "CompanyEntity"("id"),"destinationCompanyId" TEXT NOT NULL REFERENCES "CompanyEntity"("id"),
 "sourceProjectId" TEXT REFERENCES "Project"("id"),"destinationProjectId" TEXT REFERENCES "Project"("id"),
 "sourceAccountHash" TEXT NOT NULL,"destinationAccountHash" TEXT NOT NULL,"sourceAccountLast4" TEXT NOT NULL,"destinationAccountLast4" TEXT NOT NULL,
 "amountCents" BIGINT NOT NULL CHECK("amountCents">0),"originalTransferId" TEXT REFERENCES "CompanyTransfer"("id"),"originalProxyId" TEXT REFERENCES "ContractProxyExecution"("id"),
 "originalFundMovementRelationshipId" TEXT REFERENCES "FundMovementRelationshipEntry"("id"),"originalInterEntityRelationshipId" TEXT REFERENCES "InterEntityRelationshipEntry"("id"),
 "reason" TEXT NOT NULL,"evidenceFileId" TEXT NOT NULL REFERENCES "FileObject"("id"),"evidenceSha256" TEXT NOT NULL,"frozenParties" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'submitted' CHECK("status" IN ('submitted','approved','rejected','withdrawn')),"approvalInstanceId" TEXT UNIQUE REFERENCES "ApprovalInstance"("id"),
 "applicantUserId" TEXT NOT NULL REFERENCES "User"("id"),"approvedByUserId" TEXT REFERENCES "User"("id"),"approvedAt" TIMESTAMP(3),
 "idempotencyKey" TEXT NOT NULL UNIQUE,"requestFingerprint" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK("sourceCompanyId"<>"destinationCompanyId"),CHECK("kind"<>'storage' OR "sourceProjectId" IS NOT DISTINCT FROM "destinationProjectId"),
 CHECK(("kind"='repayment' AND num_nonnulls("originalTransferId","originalProxyId","originalFundMovementRelationshipId","originalInterEntityRelationshipId")=1) OR ("kind"<>'repayment' AND num_nonnulls("originalTransferId","originalProxyId","originalFundMovementRelationshipId","originalInterEntityRelationshipId")=0))
);
CREATE INDEX "CompanyTransfer_sourceProjectId_status_idx" ON "CompanyTransfer"("sourceProjectId","status");
CREATE INDEX "CompanyTransfer_destinationProjectId_status_idx" ON "CompanyTransfer"("destinationProjectId","status");
CREATE TABLE "CompanyTransferEvent" (
 "id" TEXT PRIMARY KEY,"transferId" TEXT NOT NULL REFERENCES "CompanyTransfer"("id"),"kind" TEXT NOT NULL CHECK("kind" IN ('outgoing','incoming','returned')),
 "outgoingEventId" TEXT REFERENCES "CompanyTransferEvent"("id"),"observationId" TEXT NOT NULL UNIQUE REFERENCES "VerifiedBankTransactionObservation"("id"),
 "amountCents" BIGINT NOT NULL CHECK("amountCents">0),"occurredAt" TIMESTAMP(3) NOT NULL,"recordedByUserId" TEXT NOT NULL REFERENCES "User"("id"),
 "idempotencyKey" TEXT NOT NULL UNIQUE,"requestFingerprint" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(("kind"='outgoing')=("outgoingEventId" IS NULL))
);
CREATE INDEX "CompanyTransferEvent_transferId_kind_idx" ON "CompanyTransferEvent"("transferId","kind");
CREATE INDEX "CompanyTransferEvent_outgoingEventId_idx" ON "CompanyTransferEvent"("outgoingEventId");
CREATE TABLE "CompanyTransferBankClaim"("observationId" TEXT PRIMARY KEY REFERENCES "VerifiedBankTransactionObservation"("id"),"eventId" TEXT NOT NULL UNIQUE REFERENCES "CompanyTransferEvent"("id"),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE FUNCTION guard_company_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "ApprovalInstance"%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'company_transfer_immutable'; END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['status','approvalInstanceId','approvedByUserId','approvedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','approvalInstanceId','approvedByUserId','approvedAt']) THEN RAISE EXCEPTION 'company_transfer_terms_immutable'; END IF;
 IF TG_OP='UPDATE' AND OLD."status"<>'submitted' THEN RAISE EXCEPTION 'company_transfer_decision_final'; END IF;
 IF NEW."status"='approved' THEN
  SELECT * INTO a FROM "ApprovalInstance" WHERE "id"=NEW."approvalInstanceId";
  IF a."businessType" IS DISTINCT FROM 'company_transfer' OR a."businessId" IS DISTINCT FROM NEW."id" OR a."status" IS DISTINCT FROM 'approved' OR NEW."approvedByUserId" IS NULL OR NEW."approvedByUserId"=NEW."applicantUserId" OR NEW."approvedAt" IS NULL OR NOT EXISTS(SELECT 1 FROM "ApprovalActionLog" WHERE "approvalInstanceId"=a."id" AND "action"='approve' AND "actorUserId"=NEW."approvedByUserId" AND "approvedRoleKey" IN ('chairman','general_manager') AND "signatureVersionIdSnapshot" IS NOT NULL) THEN RAISE EXCEPTION 'company_transfer_leader_approval_required'; END IF;
 END IF; RETURN NEW;
END; $$;
CREATE TRIGGER "CompanyTransfer_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CompanyTransfer" FOR EACH ROW EXECUTE FUNCTION guard_company_transfer();
CREATE FUNCTION guard_company_transfer_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t "CompanyTransfer"%ROWTYPE; o "VerifiedBankTransactionObservation"%ROWTYPE; r "ContractBankVerificationRequest"%ROWTYPE; original "CompanyTransferEvent"%ROWTYPE; expected_company TEXT; expected_project TEXT; expected_account TEXT; used BIGINT;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'company_transfer_event_immutable'; END IF;
 PERFORM public."assertOperatingLedgerWriteContext"(NEW."recordedByUserId");
 SELECT * INTO t FROM "CompanyTransfer" WHERE "id"=NEW."transferId" FOR UPDATE;
 IF t."status" IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'company_transfer_not_approved'; END IF;
 SELECT * INTO o FROM "VerifiedBankTransactionObservation" WHERE "id"=NEW."observationId" FOR UPDATE;
 SELECT * INTO r FROM "ContractBankVerificationRequest" WHERE "observationId"=o."id" AND "status"='confirmed';
 expected_company:=CASE WHEN NEW."kind"='incoming' THEN t."destinationCompanyId" ELSE t."sourceCompanyId" END;
 expected_project:=CASE WHEN NEW."kind"='incoming' THEN t."destinationProjectId" ELSE t."sourceProjectId" END;
 expected_account:=CASE WHEN NEW."kind"='incoming' THEN t."destinationAccountHash" ELSE t."sourceAccountHash" END;
 IF r."id" IS NULL OR r."companyEntityId"<>expected_company OR r."projectId" IS DISTINCT FROM expected_project OR r."accountHash"<>expected_account OR o."amountCents"<>NEW."amountCents" OR o."occurredAt"<>NEW."occurredAt" OR o."direction"<>(CASE WHEN NEW."kind"='outgoing' THEN 'outflow' ELSE 'inflow' END) THEN RAISE EXCEPTION 'company_transfer_bank_mismatch'; END IF;
 IF NEW."kind"='outgoing' THEN
  SELECT coalesce(sum("amountCents"),0) INTO used FROM "CompanyTransferEvent" WHERE "transferId"=t."id" AND "kind"='outgoing';
  IF used+NEW."amountCents">t."amountCents" THEN RAISE EXCEPTION 'company_transfer_approved_capacity'; END IF;
 ELSE
  SELECT * INTO original FROM "CompanyTransferEvent" WHERE "id"=NEW."outgoingEventId";
  IF original."transferId" IS DISTINCT FROM t."id" OR original."kind" IS DISTINCT FROM 'outgoing' OR NEW."occurredAt"<original."occurredAt" OR NEW."recordedByUserId"=original."recordedByUserId" THEN RAISE EXCEPTION 'company_transfer_independent_reconciliation_required'; END IF;
  SELECT coalesce(sum("amountCents"),0) INTO used FROM "CompanyTransferEvent" WHERE "outgoingEventId"=original."id";
  IF used+NEW."amountCents">original."amountCents" THEN RAISE EXCEPTION 'company_transfer_receipt_capacity'; END IF;
 END IF; IF EXISTS(SELECT 1 FROM "VerifiedBankTransactionObservation" observed JOIN "CompanyEntity" c ON c."id"=observed."holderCompanyEntityId" WHERE observed."id"=NEW."observationId" AND NOT c."isActive") AND t."kind"<>'repayment' THEN RAISE EXCEPTION 'inactive_company_repayment_only'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "CompanyTransferEvent_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CompanyTransferEvent" FOR EACH ROW EXECUTE FUNCTION guard_company_transfer_event();
CREATE FUNCTION guard_company_transfer_bank_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'company_transfer_bank_claim_immutable'; END IF;
 PERFORM 1 FROM "VerifiedBankTransactionObservation" WHERE "id"=NEW."observationId" FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM "CompanyTransferEvent" WHERE "id"=NEW."eventId" AND "observationId"=NEW."observationId") OR EXISTS(SELECT 1 FROM "BankTransactionClaim" WHERE "observationId"=NEW."observationId") OR EXISTS(SELECT 1 FROM "ContractProxyBankClaim" WHERE "observationId"=NEW."observationId") OR EXISTS(SELECT 1 FROM "ContractBankEventClaim" WHERE "observationId"=NEW."observationId") THEN RAISE EXCEPTION 'bank_transaction_already_claimed'; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER "CompanyTransferBankClaim_guard" BEFORE INSERT OR UPDATE OR DELETE ON "CompanyTransferBankClaim" FOR EACH ROW EXECUTE FUNCTION guard_company_transfer_bank_claim();
CREATE FUNCTION guard_other_bank_claim_against_company_transfer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM "VerifiedBankTransactionObservation" observed JOIN "CompanyEntity" c ON c."id"=observed."holderCompanyEntityId" WHERE observed."id"=NEW."observationId" AND NOT c."isActive") THEN RAISE EXCEPTION 'inactive_company_repayment_only'; END IF;
 PERFORM 1 FROM "VerifiedBankTransactionObservation" WHERE "id"=NEW."observationId" FOR UPDATE;
 IF EXISTS(SELECT 1 FROM "CompanyTransferBankClaim" WHERE "observationId"=NEW."observationId") THEN RAISE EXCEPTION 'bank_transaction_already_claimed'; END IF; RETURN NEW; END; $$;
CREATE TRIGGER "BankTransactionClaim_company_transfer" BEFORE INSERT ON "BankTransactionClaim" FOR EACH ROW EXECUTE FUNCTION guard_other_bank_claim_against_company_transfer();
CREATE TRIGGER "ContractProxyBankClaim_company_transfer" BEFORE INSERT ON "ContractProxyBankClaim" FOR EACH ROW EXECUTE FUNCTION guard_other_bank_claim_against_company_transfer();
CREATE TRIGGER "ContractBankEventClaim_company_transfer" BEFORE INSERT ON "ContractBankEventClaim" FOR EACH ROW EXECUTE FUNCTION guard_other_bank_claim_against_company_transfer();
CREATE FUNCTION require_company_transfer_bank_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NOT EXISTS(SELECT 1 FROM "CompanyTransferBankClaim" WHERE "eventId"=NEW."id" AND "observationId"=NEW."observationId") THEN RAISE EXCEPTION 'company_transfer_bank_claim_required'; END IF; RETURN NEW; END; $$;
CREATE CONSTRAINT TRIGGER "CompanyTransferEvent_claim_required" AFTER INSERT ON "CompanyTransferEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_company_transfer_bank_claim();
ALTER FUNCTION jg_file_business_binding_columns() RENAME TO jg_file_business_binding_columns_before_company_transfer;
CREATE FUNCTION jg_file_business_binding_columns() RETURNS TABLE("tableName" TEXT,"columnName" TEXT,"exclusive" BOOLEAN) LANGUAGE sql STABLE PARALLEL SAFE AS $$ SELECT * FROM jg_file_business_binding_columns_before_company_transfer() UNION ALL VALUES ('CompanyTransfer','evidenceFileId',FALSE); $$;
ALTER TABLE "OperatingFact" DROP CONSTRAINT "OperatingFact_fact_kind_check", ADD CONSTRAINT "OperatingFact_fact_kind_check" CHECK("factKind" IN ('owner_settlement','owner_payment','downstream_contract','downstream_settlement','downstream_payment','expense','employee_loan','project_wage','construction_enterprise_deduction','invoice','fund_movement','company_transfer','profit_distribution','project_cash_restriction','historical_gap'));
-- Reserve a single original debt across approvals, actual repayments and legacy corrections.
CREATE FUNCTION company_transfer_debt_limit(t "CompanyTransfer", cutoff TIMESTAMP DEFAULT NULL) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE loan "CompanyTransfer"%ROWTYPE; proxy "ContractProxyExecution"%ROWTYPE; movement "FundMovementRelationshipEntry"%ROWTYPE; inter "InterEntityRelationshipEntry"%ROWTYPE; cap BIGINT; changes BIGINT;
BEGIN
 IF t."kind"<>'repayment' THEN RETURN NULL; END IF;
 IF t."originalTransferId" IS NOT NULL THEN
  SELECT * INTO loan FROM "CompanyTransfer" WHERE "id"=t."originalTransferId" FOR UPDATE;
  IF loan."kind" IS DISTINCT FROM 'loan' OR loan."status" IS DISTINCT FROM 'approved' OR loan."sourceCompanyId"<>t."destinationCompanyId" OR loan."destinationCompanyId"<>t."sourceCompanyId" OR loan."sourceProjectId" IS DISTINCT FROM t."destinationProjectId" OR loan."destinationProjectId" IS DISTINCT FROM t."sourceProjectId" THEN RAISE EXCEPTION 'company_transfer_original_mismatch'; END IF;
  SELECT coalesce(sum("amountCents"),0) INTO cap FROM "CompanyTransferEvent" WHERE "transferId"=loan."id" AND "kind"='incoming' AND (cutoff IS NULL OR "occurredAt"<=cutoff);
 ELSIF t."originalProxyId" IS NOT NULL THEN
  SELECT * INTO proxy FROM "ContractProxyExecution" WHERE "id"=t."originalProxyId" FOR UPDATE;
  IF proxy."status" IS DISTINCT FROM 'confirmed' OR proxy."entryKind" IS DISTINCT FROM 'payment' OR proxy."frozenSource"#>>'{debtor,kind}' IS DISTINCT FROM 'participating_company' OR proxy."frozenSource"#>>'{actualPayer,kind}' IS DISTINCT FROM 'participating_company' OR proxy."frozenSource"#>>'{debtor,id}' IS DISTINCT FROM t."sourceCompanyId" OR proxy."frozenSource"#>>'{actualPayer,id}' IS DISTINCT FROM t."destinationCompanyId" OR proxy."projectId" IS DISTINCT FROM t."sourceProjectId" OR proxy."projectId" IS DISTINCT FROM t."destinationProjectId" THEN RAISE EXCEPTION 'company_transfer_original_mismatch'; END IF;
  SELECT coalesce(sum("amountCents"),0) INTO changes FROM "ContractProxyExecution" WHERE "originalId"=proxy."id" AND "status" IN ('pending_confirm','confirmed') AND (cutoff IS NULL OR "occurredAt"<=cutoff);
  cap:=CASE WHEN cutoff IS NULL OR proxy."occurredAt"<=cutoff THEN proxy."amountCents" ELSE 0 END-changes;
 ELSIF t."originalFundMovementRelationshipId" IS NOT NULL THEN
  SELECT * INTO movement FROM "FundMovementRelationshipEntry" WHERE "id"=t."originalFundMovementRelationshipId" FOR UPDATE;
  IF movement."status" IS DISTINCT FROM 'confirmed' OR movement."direction" IS DISTINCT FROM 'increase' OR movement."adjustsEntryId" IS NOT NULL OR movement."debtorCompanyEntityId" IS DISTINCT FROM t."sourceCompanyId" OR movement."creditorCompanyEntityId" IS DISTINCT FROM t."destinationCompanyId" OR movement."beneficiaryProjectId" IS DISTINCT FROM t."sourceProjectId" OR movement."sourceProjectId" IS DISTINCT FROM t."destinationProjectId" THEN RAISE EXCEPTION 'company_transfer_original_mismatch'; END IF;
  SELECT coalesce(sum("amountCents"),0) INTO changes FROM "FundMovementRelationshipEntry" WHERE "adjustsEntryId"=movement."id" AND "status"='confirmed' AND "direction"='decrease' AND (cutoff IS NULL OR "confirmedAt"<=cutoff);
  cap:=CASE WHEN cutoff IS NULL OR coalesce(movement."confirmedAt",movement."createdAt")<=cutoff THEN movement."amountCents" ELSE 0 END-changes;
 ELSE
  SELECT * INTO inter FROM "InterEntityRelationshipEntry" WHERE "id"=t."originalInterEntityRelationshipId" FOR UPDATE;
  IF inter."status" IS DISTINCT FROM 'confirmed' OR inter."entryKind" IS DISTINCT FROM 'proxy_payment' OR inter."direction" IS DISTINCT FROM 'increase' OR inter."adjustsEntryId" IS NOT NULL OR inter."originalDebtorCompanyId" IS DISTINCT FROM t."sourceCompanyId" OR inter."creditorCompanyId" IS DISTINCT FROM t."destinationCompanyId" OR inter."projectId" IS NULL OR inter."projectId" IS DISTINCT FROM t."sourceProjectId" OR inter."projectId" IS DISTINCT FROM t."destinationProjectId" THEN RAISE EXCEPTION 'company_transfer_original_mismatch'; END IF;
  SELECT coalesce(sum("amountCents"),0) INTO changes FROM "InterEntityRelationshipEntry" WHERE "adjustsEntryId"=inter."id" AND "status"='confirmed' AND "direction"='decrease' AND (cutoff IS NULL OR "confirmedAt"<=cutoff);
  cap:=CASE WHEN cutoff IS NULL OR coalesce(inter."confirmedAt",inter."createdAt")<=cutoff THEN inter."amountCents" ELSE 0 END-changes;
 END IF;
 RETURN cap;
END; $$;
CREATE FUNCTION guard_company_transfer_original_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cap BIGINT; reserved BIGINT;
BEGIN
 IF NEW."kind"<>'repayment' OR NEW."status" NOT IN ('submitted','approved') THEN RETURN NEW; END IF;
 cap:=company_transfer_debt_limit(NEW,NULL);
 SELECT coalesce(sum(t."amountCents"-coalesce((SELECT sum(e."amountCents") FROM "CompanyTransferEvent" e WHERE e."transferId"=t."id" AND e."kind"='returned'),0)),0) INTO reserved FROM "CompanyTransfer" t WHERE t."id"<>NEW."id" AND t."status" IN ('submitted','approved') AND t."originalTransferId" IS NOT DISTINCT FROM NEW."originalTransferId" AND t."originalProxyId" IS NOT DISTINCT FROM NEW."originalProxyId" AND t."originalFundMovementRelationshipId" IS NOT DISTINCT FROM NEW."originalFundMovementRelationshipId" AND t."originalInterEntityRelationshipId" IS NOT DISTINCT FROM NEW."originalInterEntityRelationshipId";
 IF reserved+NEW."amountCents">cap THEN RAISE EXCEPTION 'company_transfer_original_capacity'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "CompanyTransfer_original_capacity" BEFORE INSERT OR UPDATE ON "CompanyTransfer" FOR EACH ROW EXECUTE FUNCTION guard_company_transfer_original_reservation();
CREATE FUNCTION guard_company_transfer_dated_repayment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t "CompanyTransfer"%ROWTYPE; cap BIGINT; used BIGINT; checkpoint TIMESTAMP;
BEGIN
 IF NEW."kind"<>'outgoing' THEN RETURN NEW; END IF;
 SELECT * INTO t FROM "CompanyTransfer" WHERE "id"=NEW."transferId";
 IF t."kind"<>'repayment' THEN RETURN NEW; END IF;
 -- A backdated insertion must preserve every later recorded repayment boundary.
 PERFORM company_transfer_debt_limit(t,NEW."occurredAt");
 FOR checkpoint IN SELECT NEW."occurredAt" UNION SELECT e."occurredAt" FROM "CompanyTransferEvent" e JOIN "CompanyTransfer" r ON r."id"=e."transferId" WHERE e."kind"='outgoing' AND e."occurredAt">NEW."occurredAt" AND r."originalTransferId" IS NOT DISTINCT FROM t."originalTransferId" AND r."originalProxyId" IS NOT DISTINCT FROM t."originalProxyId" AND r."originalFundMovementRelationshipId" IS NOT DISTINCT FROM t."originalFundMovementRelationshipId" AND r."originalInterEntityRelationshipId" IS NOT DISTINCT FROM t."originalInterEntityRelationshipId" LOOP
  cap:=company_transfer_debt_limit(t,checkpoint);
  SELECT coalesce(sum(CASE WHEN e."kind"='outgoing' THEN e."amountCents" ELSE -e."amountCents" END),0) INTO used FROM "CompanyTransferEvent" e JOIN "CompanyTransfer" r ON r."id"=e."transferId" WHERE e."kind" IN ('outgoing','returned') AND e."occurredAt"<=checkpoint AND r."originalTransferId" IS NOT DISTINCT FROM t."originalTransferId" AND r."originalProxyId" IS NOT DISTINCT FROM t."originalProxyId" AND r."originalFundMovementRelationshipId" IS NOT DISTINCT FROM t."originalFundMovementRelationshipId" AND r."originalInterEntityRelationshipId" IS NOT DISTINCT FROM t."originalInterEntityRelationshipId";
  IF used+NEW."amountCents">cap THEN RAISE EXCEPTION 'company_transfer_dated_original_capacity'; END IF;
 END LOOP;
 RETURN NEW;
END; $$;
CREATE TRIGGER "CompanyTransferEvent_dated_repayment" BEFORE INSERT ON "CompanyTransferEvent" FOR EACH ROW EXECUTE FUNCTION guard_company_transfer_dated_repayment();
CREATE FUNCTION guard_legacy_debt_against_transfer_reservations() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original_id TEXT; original_amount BIGINT; other_decreases BIGINT; reserved BIGINT;
BEGIN
 IF NEW."direction"<>'decrease' OR NEW."status"<>'confirmed' OR NEW."adjustsEntryId" IS NULL THEN RETURN NEW; END IF;
 original_id:=NEW."adjustsEntryId";
 IF TG_TABLE_NAME='InterEntityRelationshipEntry' THEN
  SELECT "amountCents" INTO original_amount FROM "InterEntityRelationshipEntry" WHERE "id"=original_id FOR UPDATE;
  SELECT coalesce(sum("amountCents"),0) INTO other_decreases FROM "InterEntityRelationshipEntry" WHERE "adjustsEntryId"=original_id AND "id"<>NEW."id" AND "status"='confirmed' AND "direction"='decrease';
 ELSE
  SELECT "amountCents" INTO original_amount FROM "FundMovementRelationshipEntry" WHERE "id"=original_id FOR UPDATE;
  SELECT coalesce(sum("amountCents"),0) INTO other_decreases FROM "FundMovementRelationshipEntry" WHERE "adjustsEntryId"=original_id AND "id"<>NEW."id" AND "status"='confirmed' AND "direction"='decrease';
 END IF;
 SELECT coalesce(sum(t."amountCents"-coalesce((SELECT sum(e."amountCents") FROM "CompanyTransferEvent" e WHERE e."transferId"=t."id" AND e."kind"='returned'),0)),0) INTO reserved FROM "CompanyTransfer" t WHERE t."status" IN ('submitted','approved') AND CASE WHEN TG_TABLE_NAME='InterEntityRelationshipEntry' THEN t."originalInterEntityRelationshipId"=original_id ELSE t."originalFundMovementRelationshipId"=original_id END;
 IF other_decreases+reserved+NEW."amountCents">original_amount THEN RAISE EXCEPTION 'company_transfer_original_capacity'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "InterEntityRelationshipEntry_transfer_reservation" BEFORE INSERT OR UPDATE ON "InterEntityRelationshipEntry" FOR EACH ROW EXECUTE FUNCTION guard_legacy_debt_against_transfer_reservations();
CREATE TRIGGER "FundMovementRelationshipEntry_transfer_reservation" BEFORE INSERT OR UPDATE ON "FundMovementRelationshipEntry" FOR EACH ROW EXECUTE FUNCTION guard_legacy_debt_against_transfer_reservations();


-- Inactive legal entities may only supply bank evidence for an already approved repayment.
CREATE FUNCTION company_transfer_repayment_bank_holder(request_id TEXT, company_id TEXT) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM "ContractBankVerificationRequest" r JOIN "CompanyTransfer" t ON t."kind"='repayment' AND t."status"='approved' AND
 ((t."sourceCompanyId"=r."companyEntityId" AND t."sourceProjectId" IS NOT DISTINCT FROM r."projectId" AND t."sourceAccountHash"=r."accountHash") OR
  (t."destinationCompanyId"=r."companyEntityId" AND t."destinationProjectId" IS NOT DISTINCT FROM r."projectId" AND t."destinationAccountHash"=r."accountHash"))
 WHERE r."id"=request_id AND r."companyEntityId"=company_id AND r."status"='pending_confirm');
$$;
CREATE OR REPLACE FUNCTION issue_contract_bank_holder(request_id TEXT,actor_id TEXT,holder_file_id TEXT,signature_id TEXT,account_hash TEXT) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public."ContractBankVerificationRequest"%ROWTYPE; f public."FileObject"%ROWTYPE; issued_id TEXT;
BEGIN
 PERFORM public."assertOperatingLedgerWriteContext"(actor_id);
 SELECT * INTO r FROM public."ContractBankVerificationRequest" WHERE "id"=request_id FOR UPDATE;
 IF account_hash IS DISTINCT FROM r."accountHash" THEN RAISE EXCEPTION 'bank_account_independent_check_required'; END IF;
 IF r."id" IS NULL OR r."status"<>'pending_confirm' OR r."recordedByUserId"=actor_id THEN RAISE EXCEPTION 'bank_verification_independent_review_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."HandwrittenSignatureVersion" WHERE "id"=signature_id AND "userId"=actor_id) THEN RAISE EXCEPTION 'bank_verification_signature_required'; END IF;
 SELECT * INTO f FROM public."FileObject" WHERE "id"=holder_file_id AND "uploadedByUserId"=actor_id AND "storageStatus"='active' FOR UPDATE;
 IF f."id" IS NULL OR f."contentSha256" IS NULL OR f."id"=r."evidenceFileId" THEN RAISE EXCEPTION 'bank_holder_independent_evidence_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public."CompanyEntity" WHERE "id"=r."companyEntityId" AND "name"=r."companyName" AND "unifiedSocialCreditCode"=r."companyCreditCode" AND ("isActive" OR public.company_transfer_repayment_bank_holder(r."id",r."companyEntityId"))) THEN RAISE EXCEPTION 'bank_holder_company_changed'; END IF;
 SELECT "id" INTO issued_id FROM public."jg_issue_payment_execution_payer_verification_trusted"(jsonb_build_object('reference','contract-bank-holder:'||r."id",'holderCompanyEntityId',r."companyEntityId",'holderNameSnapshot',r."companyName",'holderCreditCodeSnapshot',r."companyCreditCode",'verificationReference',r."id",'verifiedByUserId',actor_id,'verifiedAt',date_trunc('milliseconds',CURRENT_TIMESTAMP),'verificationEvidenceFileId',f."id",'verificationEvidenceContentSha256',f."contentSha256",'status','verified','sourceType','bank_account_legal_holder','sourceRecordId',r."id"));
 RETURN issued_id;
END; $$;
CREATE OR REPLACE FUNCTION guard_payment_execution_payer_verification()
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
      AND (company."isActive" = TRUE OR (NEW."sourceType"='bank_account_legal_holder' AND public.company_transfer_repayment_bank_holder(NEW."sourceRecordId",company."id")))
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
COMMIT;
