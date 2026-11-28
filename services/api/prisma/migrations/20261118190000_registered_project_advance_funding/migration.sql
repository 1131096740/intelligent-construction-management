CREATE TABLE public."RegisteredFundAdvanceReceipt" (
 "id" TEXT PRIMARY KEY,
 "accountId" TEXT NOT NULL REFERENCES public."RegisteredFundAccount"("id") ON DELETE RESTRICT,
 "registrationId" TEXT NOT NULL UNIQUE REFERENCES public."FundAccountBalanceRegistration"("id") ON DELETE RESTRICT,
 "sourceBatchId" TEXT NOT NULL UNIQUE REFERENCES public."FundAccountSourceBatch"("id") ON DELETE RESTRICT,
 "contributorKind" TEXT NOT NULL,
 "contributorId" TEXT,
 "contributorNameSnapshot" TEXT,
 "projectId" TEXT REFERENCES public."Project"("id") ON DELETE RESTRICT,
 "amountYuan" DECIMAL(24,4) NOT NULL CHECK ("amountYuan" > 0 AND "amountYuan" <> 'NaN'::numeric),
 "receivedOn" TEXT NOT NULL CHECK ("receivedOn" ~ '^\d{4}-\d{2}-\d{2}$'),
 "custodianUserId" TEXT REFERENCES public."User"("id") ON DELETE RESTRICT,
 "evidenceReference" TEXT NOT NULL CHECK (length(btrim("evidenceReference")) > 0),
 "createdByUserId" TEXT NOT NULL REFERENCES public."User"("id") ON DELETE RESTRICT,
 "idempotencyKey" TEXT NOT NULL UNIQUE,
 "payloadFingerprint" TEXT NOT NULL CHECK ("payloadFingerprint" ~ '^[a-f0-9]{64}$'),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "RegisteredFundAdvanceReceipt_contributor_check" CHECK (
  ("contributorKind" = 'unknown' AND "contributorId" IS NULL AND "contributorNameSnapshot" IS NULL)
  OR ("contributorKind" IN ('company','construction_enterprise','person','other')
   AND "contributorId" IS NOT NULL AND length(btrim("contributorId")) > 0
   AND "contributorNameSnapshot" IS NOT NULL AND length(btrim("contributorNameSnapshot")) > 0))
);

ALTER TABLE public."FundAccountBalanceRegistration"
 DROP CONSTRAINT "FundAccountBalanceRegistration_transfer_kind_check",
 ADD CONSTRAINT "FundAccountBalanceRegistration_transfer_kind_check" CHECK (
 ("kind" = 'opening' AND "transferId" IS NULL AND "approvalInstanceId" IS NULL AND "version" = 1 AND "previousRegistrationId" IS NULL AND "status" = 'confirmed')
 OR ("kind" = 'correction' AND "transferId" IS NULL AND "approvalInstanceId" IS NOT NULL AND "version" > 1 AND "previousRegistrationId" IS NOT NULL AND "status" IN ('pending_review','confirmed','returned','withdrawn'))
 OR ("kind" = 'transfer' AND "transferId" IS NOT NULL AND "approvalInstanceId" IS NULL AND "version" > 1 AND "previousRegistrationId" IS NOT NULL AND "status" = 'confirmed' AND "balanceYuan" IS NOT NULL)
 OR ("kind" = 'advance_receipt' AND "transferId" IS NULL AND "approvalInstanceId" IS NULL AND "version" > 1 AND "previousRegistrationId" IS NOT NULL AND "status" = 'confirmed' AND "balanceYuan" IS NOT NULL));

CREATE FUNCTION public."jg_registered_fund_advance_predecessor"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE known public."FundAccountBalanceRegistration";
BEGIN
 IF NEW."kind" <> 'advance_receipt' THEN RETURN NEW; END IF;
 IF NOT EXISTS (SELECT 1 FROM public."RegisteredFundAccount" account
  WHERE account.id = NEW."accountId" AND account.xmin::text = (txid_current() % 4294967296)::text) THEN
  RAISE EXCEPTION 'advance receipt requires a registered account write revision';
 END IF;
 SELECT * INTO known FROM public."FundAccountBalanceRegistration"
  WHERE "accountId" = NEW."accountId" AND "status" = 'confirmed' ORDER BY "version" DESC LIMIT 1;
 IF known.id IS DISTINCT FROM NEW."previousRegistrationId" OR known."balanceYuan" IS NULL
  OR known."coveredExecutionIds" IS DISTINCT FROM NEW."coveredExecutionIds"
  OR known."asOfDate" IS DISTINCT FROM NEW."asOfDate"
  OR EXISTS (SELECT 1 FROM public."FundAccountBalanceRegistration"
   WHERE "accountId" = NEW."accountId" AND ("status" = 'pending_review' OR "version" >= NEW."version")) THEN
  RAISE EXCEPTION 'advance receipt requires a current known balance with no pending reconciliation';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "FundAccountBalanceRegistration_advance_predecessor"
 BEFORE INSERT ON public."FundAccountBalanceRegistration"
 FOR EACH ROW EXECUTE FUNCTION public."jg_registered_fund_advance_predecessor"();

CREATE FUNCTION public."jg_registered_fund_advance_receipt_check"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE registration_id TEXT; registered public."FundAccountBalanceRegistration";
  receipt public."RegisteredFundAdvanceReceipt";
BEGIN
 IF TG_TABLE_NAME = 'FundAccountBalanceRegistration' THEN registration_id := NEW.id;
 ELSE registration_id := NEW."registrationId"; END IF;
 SELECT * INTO STRICT registered FROM public."FundAccountBalanceRegistration" WHERE id = registration_id;
 IF registered."kind" <> 'advance_receipt' THEN
  IF TG_TABLE_NAME = 'RegisteredFundAdvanceReceipt' THEN RAISE EXCEPTION 'advance receipt requires its own registration'; END IF;
  RETURN NULL;
 END IF;
 SELECT * INTO receipt FROM public."RegisteredFundAdvanceReceipt" WHERE "registrationId" = registration_id;
 IF receipt.id IS NULL OR receipt."accountId" <> registered."accountId"
  OR receipt."createdByUserId" <> registered."createdByUserId"
  OR receipt."createdByUserId" IS DISTINCT FROM registered."confirmedByUserId"
  OR receipt."evidenceReference" <> registered."evidenceReference"
  OR receipt."payloadFingerprint" <> registered."payloadFingerprint"
  OR NOT EXISTS (SELECT 1 FROM public."RegisteredFundAccount" account WHERE account.id = receipt."accountId"
   AND ((account.kind = 'public_cash' AND receipt."custodianUserId" = receipt."createdByUserId")
     OR (account.kind = 'company' AND receipt."custodianUserId" IS NULL)))
  OR NOT EXISTS (SELECT 1 FROM public."FundAccountSourceBatch" root
   WHERE root.id = receipt."sourceBatchId" AND root."registrationId" = registered.id
    AND root."previousSourceBatchId" IS NULL AND root."receivedTransferLineId" IS NULL
    AND root."amountYuan" = receipt."amountYuan"
    AND root."sourceName" IS NOT DISTINCT FROM receipt."contributorNameSnapshot"
    AND root."sourceStatus" = CASE WHEN receipt."contributorKind" = 'unknown' THEN 'pending' ELSE 'known' END
    AND root."projectId" IS NOT DISTINCT FROM receipt."projectId"
    AND root."projectStatus" = CASE WHEN receipt."projectId" IS NULL THEN 'pending' ELSE 'project' END) THEN
  RAISE EXCEPTION 'advance receipt and root source facts do not match';
 END IF;
 -- Compare all old rows with all carried rows, including duplicate predecessors.
 IF EXISTS (
  (SELECT previous_batch.id, previous_batch."lineNo", previous_batch."amountYuan", previous_batch."sourceStatus", previous_batch."sourceName", previous_batch."projectStatus", previous_batch."projectId"
   FROM public."FundAccountSourceBatch" previous_batch WHERE previous_batch."registrationId" = registered."previousRegistrationId"
   EXCEPT ALL
   SELECT next."previousSourceBatchId", next."lineNo", next."amountYuan", next."sourceStatus", next."sourceName", next."projectStatus", next."projectId"
   FROM public."FundAccountSourceBatch" next WHERE next."registrationId" = registered.id AND next.id <> receipt."sourceBatchId")
  UNION ALL
  (SELECT next."previousSourceBatchId", next."lineNo", next."amountYuan", next."sourceStatus", next."sourceName", next."projectStatus", next."projectId"
   FROM public."FundAccountSourceBatch" next WHERE next."registrationId" = registered.id AND next.id <> receipt."sourceBatchId"
   EXCEPT ALL
   SELECT previous_batch.id, previous_batch."lineNo", previous_batch."amountYuan", previous_batch."sourceStatus", previous_batch."sourceName", previous_batch."projectStatus", previous_batch."projectId"
   FROM public."FundAccountSourceBatch" previous_batch WHERE previous_batch."registrationId" = registered."previousRegistrationId")
 ) THEN RAISE EXCEPTION 'advance receipt must carry all previous source rows unchanged'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "FundAccountBalanceRegistration_advance_receipt" AFTER INSERT ON public."FundAccountBalanceRegistration"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public."jg_registered_fund_advance_receipt_check"();
CREATE CONSTRAINT TRIGGER "RegisteredFundAdvanceReceipt_registration" AFTER INSERT ON public."RegisteredFundAdvanceReceipt"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public."jg_registered_fund_advance_receipt_check"();
CREATE TRIGGER "RegisteredFundAdvanceReceipt_immutable" BEFORE UPDATE OR DELETE ON public."RegisteredFundAdvanceReceipt"
 FOR EACH ROW EXECUTE FUNCTION public."jg_registered_fund_transfer_mutation"();

-- The payment adapter registers the shortfall on its existing execution, never a second payout.
CREATE TABLE public."RegisteredPaymentProjectAdvance" (
 "executionId" TEXT PRIMARY KEY REFERENCES public."PaymentExecution"("id") ON DELETE RESTRICT,
 "projectId" TEXT NOT NULL REFERENCES public."Project"("id") ON DELETE RESTRICT,
 "accountId" TEXT NOT NULL REFERENCES public."RegisteredFundAccount"("id") ON DELETE RESTRICT,
 "creditorCompanyId" TEXT NOT NULL REFERENCES public."CompanyEntity"("id") ON DELETE RESTRICT,
 "confirmedByUserId" TEXT NOT NULL REFERENCES public."User"("id") ON DELETE RESTRICT,
 "amountCents" BIGINT NOT NULL CHECK ("amountCents" > 0),
 "reason" TEXT NOT NULL CHECK (length(btrim("reason")) > 0),
 "evidence" TEXT NOT NULL CHECK (length(btrim("evidence")) > 0),
 "companyAllocations" JSONB NOT NULL CHECK (jsonb_typeof("companyAllocations") = 'array' AND "companyAllocations" <> '[]'::jsonb),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER "RegisteredPaymentProjectAdvance_immutable" BEFORE UPDATE OR DELETE ON public."RegisteredPaymentProjectAdvance"
 FOR EACH ROW EXECUTE FUNCTION public."jg_registered_fund_transfer_mutation"();

-- This records explicitly evidenced company principal, distinct from every project advance receipt.
CREATE TABLE public."RegisteredFundCompanyOwnedReceipt" (
 "receiptId" TEXT PRIMARY KEY REFERENCES public."RegisteredFundAdvanceReceipt"("id") ON DELETE RESTRICT,
 "companyId" TEXT NOT NULL REFERENCES public."CompanyEntity"("id") ON DELETE RESTRICT,
 "observationId" TEXT NOT NULL UNIQUE REFERENCES public."VerifiedBankTransactionObservation"("id") ON DELETE RESTRICT,
 "ownershipEvidence" TEXT NOT NULL CHECK (length(btrim("ownershipEvidence")) > 0)
);
CREATE TRIGGER "RegisteredFundCompanyOwnedReceipt_immutable" BEFORE UPDATE OR DELETE ON public."RegisteredFundCompanyOwnedReceipt"
 FOR EACH ROW EXECUTE FUNCTION public."jg_registered_fund_transfer_mutation"();

CREATE FUNCTION public."jg_registered_fund_company_owned_receipt"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE observation public."VerifiedBankTransactionObservation";
BEGIN
 SELECT * INTO STRICT observation FROM public."VerifiedBankTransactionObservation"
 WHERE id = NEW."observationId" FOR UPDATE;
 IF NOT EXISTS (
  SELECT 1 FROM public."RegisteredFundAdvanceReceipt" receipt
  JOIN public."RegisteredFundAccount" account ON account.id = receipt."accountId"
  JOIN public."ContractBankVerificationRequest" bank ON bank.id = observation."transactionSourceId"
  WHERE receipt.id = NEW."receiptId" AND receipt.xmin::text = (txid_current() % 4294967296)::text
   AND receipt."projectId" IS NULL AND receipt."contributorKind" = 'company'
   AND account.kind = 'company' AND account."companyEntityId" = NEW."companyId"
   AND receipt."contributorId" = NEW."companyId" AND observation."holderCompanyEntityId" = NEW."companyId"
   AND observation.direction = 'inflow' AND observation."currencyCode" = 'CNY'
   AND observation."amountCents" = receipt."amountYuan" * 100
   AND (observation."occurredAt" + interval '8 hours')::date::text = receipt."receivedOn"
   AND observation."transactionSourceType" = 'contract_bank_verification'
   AND bank.status = 'confirmed' AND bank."projectId" IS NULL AND bank."observationId" = observation.id
   AND bank."companyEntityId" = NEW."companyId"
   AND bank."confirmedByUserId" IS NOT NULL AND bank."confirmedByUserId" <> bank."recordedByUserId"
   AND EXISTS (SELECT 1 FROM public."UserPosition" assignment JOIN public."Position" position ON position.id = assignment."positionId"
    WHERE assignment."userId" = receipt."createdByUserId" AND assignment."projectId" IS NULL AND position.key = 'finance_director')
 ) OR EXISTS (SELECT 1 FROM public."CompanyTransferBankClaim" WHERE "observationId" = observation.id)
   OR EXISTS (SELECT 1 FROM public."BankTransactionClaim" WHERE "observationId" = observation.id)
   OR EXISTS (SELECT 1 FROM public."ContractProxyBankClaim" WHERE "observationId" = observation.id)
   OR EXISTS (SELECT 1 FROM public."ContractBankEventClaim" WHERE "observationId" = observation.id) THEN
  RAISE EXCEPTION 'company principal requires unclaimed verified bank inflow and ownership evidence';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public."jg_registered_fund_company_owned_receipt"() FROM PUBLIC;
CREATE TRIGGER "RegisteredFundCompanyOwnedReceipt_bank" BEFORE INSERT ON public."RegisteredFundCompanyOwnedReceipt"
 FOR EACH ROW EXECUTE FUNCTION public."jg_registered_fund_company_owned_receipt"();

-- Existing bank claims use this same observation lock; keep this new fact mutually exclusive.
CREATE FUNCTION public."jg_registered_fund_bank_claim_exclusion"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 PERFORM 1 FROM public."VerifiedBankTransactionObservation" WHERE id = NEW."observationId" FOR UPDATE;
 IF EXISTS (SELECT 1 FROM public."RegisteredFundCompanyOwnedReceipt" WHERE "observationId" = NEW."observationId") THEN
   RAISE EXCEPTION 'bank_transaction_already_claimed';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public."jg_registered_fund_bank_claim_exclusion"() FROM PUBLIC;
CREATE TRIGGER "CompanyTransferBankClaim_registered_principal" BEFORE INSERT ON public."CompanyTransferBankClaim"
 FOR EACH ROW EXECUTE FUNCTION public."jg_registered_fund_bank_claim_exclusion"();
CREATE TRIGGER "BankTransactionClaim_registered_principal" BEFORE INSERT ON public."BankTransactionClaim"
 FOR EACH ROW EXECUTE FUNCTION public."jg_registered_fund_bank_claim_exclusion"();
CREATE TRIGGER "ContractProxyBankClaim_registered_principal" BEFORE INSERT ON public."ContractProxyBankClaim"
 FOR EACH ROW EXECUTE FUNCTION public."jg_registered_fund_bank_claim_exclusion"();
CREATE TRIGGER "ContractBankEventClaim_registered_principal" BEFORE INSERT ON public."ContractBankEventClaim"
 FOR EACH ROW EXECUTE FUNCTION public."jg_registered_fund_bank_claim_exclusion"();


CREATE FUNCTION public."jg_registered_fund_source_ownership"(requested_sources TEXT[])
RETURNS TABLE ("sourceBatchId" TEXT, "projectAdvanceId" TEXT, "companyId" TEXT, continuous BOOLEAN)
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
    WITH RECURSIVE lineage("sourceBatchId", "batchId", visited, continuous) AS (
      SELECT batch.id, batch.id, ARRAY[batch.id], TRUE
      FROM public."FundAccountSourceBatch" batch
      WHERE batch.id = ANY(requested_sources)
      UNION ALL
      SELECT lineage."sourceBatchId", parent.id, lineage.visited || parent.id,
        lineage.continuous
        AND batch."sourceStatus" = parent."sourceStatus"
        AND batch."sourceName" IS NOT DISTINCT FROM parent."sourceName"
        AND batch."projectStatus" = parent."projectStatus"
        AND batch."projectId" IS NOT DISTINCT FROM parent."projectId"
        AND CASE WHEN registration.kind = 'correction' THEN
          batch."amountYuan" = parent."amountYuan" AND
          (SELECT count(*) FROM public."FundAccountSourceBatch" sibling
            WHERE sibling."registrationId" = batch."registrationId" AND sibling."previousSourceBatchId" = parent.id) = 1
        ELSE batch."amountYuan" <= parent."amountYuan" END
      FROM lineage
      JOIN public."FundAccountSourceBatch" batch ON batch.id = lineage."batchId"
      JOIN public."FundAccountBalanceRegistration" registration ON registration.id = batch."registrationId"
      LEFT JOIN public."RegisteredFundTransferLine" transfer ON transfer.id = batch."receivedTransferLineId"
      JOIN public."FundAccountSourceBatch" parent ON parent.id = CASE
        WHEN batch."receivedTransferLineId" IS NULL THEN batch."previousSourceBatchId"
        WHEN batch."previousSourceBatchId" IS NULL THEN transfer."sourceBatchId"
      END
      WHERE NOT parent.id = ANY(lineage.visited)
    )
    SELECT lineage."sourceBatchId", receipt.id AS "projectAdvanceId", owned."companyId", lineage.continuous
    FROM lineage
    JOIN public."RegisteredFundAdvanceReceipt" receipt ON receipt."sourceBatchId" = lineage."batchId"
    LEFT JOIN public."RegisteredFundCompanyOwnedReceipt" owned ON owned."receiptId" = receipt.id
$$;
REVOKE ALL ON FUNCTION public."jg_registered_fund_source_ownership"(TEXT[]) FROM PUBLIC;

CREATE FUNCTION public."jg_registered_fund_verified_own_candidates"(selected_company TEXT)
RETURNS TABLE (id TEXT, reference TEXT, "occurredAt" TIMESTAMP, "amountCents" BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT observation.id, observation.reference, observation."occurredAt", observation."amountCents"
 FROM public."VerifiedBankTransactionObservation" observation
 JOIN public."ContractBankVerificationRequest" bank ON bank.id = observation."transactionSourceId"
 WHERE observation."holderCompanyEntityId" = selected_company
  AND observation.direction = 'inflow' AND observation."currencyCode" = 'CNY'
  AND observation."transactionSourceType" = 'contract_bank_verification'
  AND bank."companyEntityId" = selected_company AND bank.status = 'confirmed'
  AND bank."projectId" IS NULL AND bank."observationId" = observation.id
  AND bank."confirmedByUserId" IS NOT NULL AND bank."confirmedByUserId" <> bank."recordedByUserId"
  AND NOT EXISTS (SELECT 1 FROM public."CompanyTransferBankClaim" claim WHERE claim."observationId" = observation.id)
  AND NOT EXISTS (SELECT 1 FROM public."BankTransactionClaim" claim WHERE claim."observationId" = observation.id)
  AND NOT EXISTS (SELECT 1 FROM public."ContractProxyBankClaim" claim WHERE claim."observationId" = observation.id)
  AND NOT EXISTS (SELECT 1 FROM public."ContractBankEventClaim" claim WHERE claim."observationId" = observation.id)
  AND NOT EXISTS (SELECT 1 FROM public."RegisteredFundCompanyOwnedReceipt" claim WHERE claim."observationId" = observation.id);
$$;
REVOKE ALL ON FUNCTION public."jg_registered_fund_verified_own_candidates"(TEXT) FROM PUBLIC;
