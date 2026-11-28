-- TASK16 WORK-IN-PROGRESS, PREPARED SOURCE ONLY, executed=false.
-- Not a migration candidate: canonical Fact/Impact/InterEntity and private-file
-- guards must be composed before this is promoted into migrations. Do not run.
-- PaymentExecution remains the only payment fact; these rows reference its ID.
SET LOCAL search_path=pg_catalog,public,pg_temp;
ALTER TABLE public."RegisteredFundAccount" ADD COLUMN "writeRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public."RegisteredFundAccount" ADD CONSTRAINT "RegisteredFundAccount_write_revision_check" CHECK ("writeRevision" >= 0);
ALTER TABLE public."FundAccountBalanceRegistration" ADD COLUMN "coveredExecutionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE public."PaymentExecution" ALTER COLUMN "voucherFileId" DROP NOT NULL;

DO $$ BEGIN
 IF (SELECT pg_catalog.format_type(a.atttypid,a.atttypmod) FROM pg_catalog.pg_attribute a WHERE a.attrelid='public."Project"'::regclass AND a.attname='operatingLedgerEffectiveDate' AND NOT a.attisdropped) IS DISTINCT FROM 'date' THEN
   RAISE EXCEPTION 'task16 Project operating scope requires the reviewed native DATE';
 END IF;
END $$;

-- Narrow lock/read API; no runtime Project UPDATE grant. Installation ACL is
-- closed in the following history-revision fragment with the same runtime role.
CREATE FUNCTION public."jg_registered_operating_scope_lock"(project_id TEXT)
RETURNS TABLE("projectId" TEXT,"effectiveDate" DATE)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 RETURN QUERY SELECT p."id",p."operatingLedgerEffectiveDate" FROM public."Project" p WHERE p."id"=project_id FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'registered payment requires an existing project scope'; END IF;
END $$;
REVOKE ALL ON FUNCTION public."jg_registered_operating_scope_lock"(TEXT) FROM PUBLIC;

CREATE TABLE public."RegisteredPaymentFunding" (
 "executionId" TEXT PRIMARY KEY REFERENCES public."PaymentExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "operatingLedgerEffectiveDateAtRegistration" DATE,
 "actualPayerKind" TEXT NOT NULL, "actualPayerId" TEXT NOT NULL, "actualPayerSnapshot" JSONB NOT NULL,
 "accountId" TEXT NOT NULL REFERENCES public."RegisteredFundAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "balanceRegistrationId" TEXT NOT NULL,
 "openingTreatment" TEXT NOT NULL CHECK ("openingTreatment" IN ('included','not_included')),
 "openingReason" TEXT NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim("openingReason")) > 0),
 "openingEvidence" TEXT NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim("openingEvidence")) > 0),
 "contractHistoryConfirmation" JSONB,
 "payloadFingerprint" TEXT NOT NULL CHECK ("payloadFingerprint" ~ '^[a-f0-9]{64}$'),
 UNIQUE ("executionId", "accountId"),
 FOREIGN KEY ("balanceRegistrationId","accountId") REFERENCES public."FundAccountBalanceRegistration"("id","accountId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE public."RegisteredFundPaymentAllocation" (
 "id" TEXT PRIMARY KEY,
 "executionId" TEXT NOT NULL, "accountId" TEXT NOT NULL,
 "sourceBatchId" TEXT NOT NULL REFERENCES public."FundAccountSourceBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "amountCents" BIGINT NOT NULL CHECK ("amountCents" > 0),
 FOREIGN KEY ("executionId","accountId") REFERENCES public."RegisteredPaymentFunding"("executionId","accountId") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("accountId") REFERENCES public."RegisteredFundAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 UNIQUE ("executionId","sourceBatchId")
);
CREATE INDEX "RegisteredFundPaymentAllocation_accountId_sourceBatchId_idx" ON public."RegisteredFundPaymentAllocation"("accountId","sourceBatchId");
CREATE TABLE public."RegisteredPaymentEvent" (
 "executionId" TEXT PRIMARY KEY REFERENCES public."PaymentExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "eventType" TEXT NOT NULL DEFAULT 'payment_execution.registered' CHECK ("eventType" = 'payment_execution.registered'),
 "payload" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE public."RegisteredPaymentVoucher" (
 "executionId" TEXT PRIMARY KEY REFERENCES public."PaymentExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "fileId" TEXT NOT NULL UNIQUE REFERENCES public."FileObject"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
 "uploadedByUserId" TEXT NOT NULL,
 "contentSha256" TEXT NOT NULL CHECK ("contentSha256" ~ '^[a-f0-9]{64}$'),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Keep all existing terminal registration/source snapshot guards. The only new
-- exception is an account revision increment with its identity byte-for-byte
-- unchanged. This is not a balance UPDATE and cannot edit a reconciliation.
DO $$
DECLARE body TEXT; old_guard TEXT := 'IF TG_TABLE_NAME <> ''FundAccountBalanceRegistration'' THEN';
BEGIN
 SELECT pg_catalog.pg_get_functiondef('public."jg_registered_fund_immutable"()'::regprocedure) INTO body;
 IF position(old_guard IN body) = 0 THEN RAISE EXCEPTION 'task16 immutable predecessor anchor drifted'; END IF;
 body := replace(body, old_guard,
 'IF TG_TABLE_NAME = ''RegisteredFundAccount'' THEN
   IF TG_OP = ''UPDATE'' AND
      (to_jsonb(NEW) - ''writeRevision'') IS NOT DISTINCT FROM (to_jsonb(OLD) - ''writeRevision'') AND
      NEW."writeRevision" = OLD."writeRevision" + 1 THEN RETURN NEW; END IF;
 END IF;
 IF TG_TABLE_NAME <> ''FundAccountBalanceRegistration'' THEN');
 EXECUTE body;
END $$;

CREATE FUNCTION public."jg_registered_payment_append_only"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN RAISE EXCEPTION 'registered payment evidence and postings are immutable'; END $$;
CREATE TRIGGER "RegisteredPaymentFunding_immutable" BEFORE UPDATE OR DELETE ON public."RegisteredPaymentFunding" FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_append_only"();
CREATE TRIGGER "RegisteredFundPaymentAllocation_immutable" BEFORE UPDATE OR DELETE ON public."RegisteredFundPaymentAllocation" FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_append_only"();
CREATE TRIGGER "RegisteredPaymentEvent_immutable" BEFORE UPDATE OR DELETE ON public."RegisteredPaymentEvent" FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_append_only"();
CREATE TRIGGER "RegisteredPaymentVoucher_immutable" BEFORE UPDATE OR DELETE ON public."RegisteredPaymentVoucher" FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_append_only"();

-- The explicit covered set is captured when the reconciliation starts. It must
-- contain unique facts that already belong to this account, never future IDs.
-- The original immutable trigger freezes the set through all terminal updates.
CREATE FUNCTION public."jg_registered_payment_coverage_insert"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE covered_id TEXT;
BEGIN
 IF pg_catalog.cardinality(NEW."coveredExecutionIds") <> (SELECT pg_catalog.count(DISTINCT id) FROM pg_catalog.unnest(NEW."coveredExecutionIds") id) THEN
   RAISE EXCEPTION 'covered payment identities must be unique';
 END IF;
 FOREACH covered_id IN ARRAY NEW."coveredExecutionIds" LOOP
   IF NOT EXISTS (SELECT 1 FROM public."RegisteredPaymentFunding" f WHERE f."executionId" = covered_id AND f."accountId" = NEW."accountId") THEN
     RAISE EXCEPTION 'covered payment must be an existing fact of the same account';
   END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER "FundAccountBalanceRegistration_payment_coverage" BEFORE INSERT ON public."FundAccountBalanceRegistration" FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_coverage_insert"();

-- Deferred whole-fact conservation. Directly fabricating the metadata flag or
-- a NULL voucher on a legacy payment cannot satisfy this closed identity chain.
CREATE FUNCTION public."jg_registered_payment_conservation"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE eid TEXT; f public."RegisteredPaymentFunding"; e public."PaymentExecution";
 a public."RegisteredFundAccount"; r public."FundAccountBalanceRegistration"; total NUMERIC; line_count BIGINT;
BEGIN
 eid := NEW."executionId";
 SELECT * INTO STRICT f FROM public."RegisteredPaymentFunding" WHERE "executionId" = eid;
 SELECT * INTO STRICT e FROM public."PaymentExecution" WHERE "id" = eid;
 SELECT * INTO STRICT a FROM public."RegisteredFundAccount" WHERE "id" = f."accountId";
 SELECT * INTO STRICT r FROM public."FundAccountBalanceRegistration" WHERE "id" = f."balanceRegistrationId" AND "accountId" = a."id";
 IF e."amountCents" <= 0 OR r."status" <> 'confirmed' OR
    NOT COALESCE(((a."kind" = 'company' AND f."actualPayerKind" = 'participating_company' AND f."actualPayerId" = a."companyEntityId" AND f."actualPayerSnapshot"->>'companyEntityId' = a."companyEntityId") OR
         (a."kind" = 'public_cash' AND a."companyEntityId" IS NULL AND f."actualPayerKind" = 'public_cash' AND f."actualPayerId" = 'public_cash' AND f."actualPayerSnapshot"->>'scopeKey' = 'public_cash')),FALSE) THEN
   RAISE EXCEPTION 'registered payment requires the frozen canonical account identity';
 END IF;
 SELECT coalesce(pg_catalog.sum(p."amountCents"),0),pg_catalog.count(*) INTO total,line_count FROM public."RegisteredFundPaymentAllocation" p WHERE p."executionId" = eid;
 IF (f."openingTreatment" = 'included' AND line_count <> 0) OR
    (f."openingTreatment" = 'not_included' AND (line_count = 0 OR total <> e."amountCents")) THEN
   RAISE EXCEPTION 'registered payment allocations do not conserve the canonical payment';
 END IF;
 IF EXISTS (SELECT 1 FROM public."RegisteredFundPaymentAllocation" p JOIN public."FundAccountSourceBatch" s ON s."id" = p."sourceBatchId" WHERE p."executionId" = eid AND (p."accountId" <> a."id" OR s."registrationId" <> r."id")) THEN
   RAISE EXCEPTION 'registered payment source belongs to a different frozen reconciliation';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public."RegisteredPaymentEvent" event WHERE event."executionId" = eid AND event."eventType" = 'payment_execution.registered' AND event."payload"->>'executionId' = eid AND event."payload"->>'accountId' = a."id" AND event."payload"->>'balanceRegistrationId' = r."id") THEN
   RAISE EXCEPTION 'registered payment requires its same-transaction durable event';
 END IF;
 IF (SELECT pg_catalog.count(*) FROM public."AuditLog" audit WHERE audit."action" = 'payment.execution.record'
       AND audit."businessType" = 'payment_request' AND audit."businessId" = e."paymentRequestId" AND audit."actorUserId" = e."executedByUserId"
       AND audit."metadata"->>'executionId' = e."id" AND audit."metadata"->>'idempotencyKey' = e."idempotencyKey"
       AND pg_catalog.jsonb_typeof(audit."metadata"->'amountCents') = 'string' AND audit."metadata"->>'amountCents' = e."amountCents"::TEXT
       AND audit."metadata"->'voucherFileId' = 'null'::JSONB AND audit."metadata"->'voucherPending' = 'true'::JSONB
       AND audit."metadata"->'actualPayer'->>'kind' = f."actualPayerKind" AND audit."metadata"->'actualPayer'->>'id' = f."actualPayerId"
       AND audit."metadata"->'actualPayer'->'snapshot' = f."actualPayerSnapshot"
       AND audit."metadata"->'payer'->>'paymentSubjectType' = 'our_company'
       AND audit."metadata"->'payer'->>'companyEntityIdSnapshot' = e."companyEntityIdSnapshot"
       AND audit."metadata"->'payer'->>'companyEntityNameSnapshot' = e."companyEntityNameSnapshot"
       AND audit."metadata"->'payer'->>'companyEntityCreditCodeSnapshot' = e."companyEntityCreditCodeSnapshot"
       AND audit."metadata"->>'paidAt' = pg_catalog.to_char(e."paidAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       AND audit."metadata"->'funding'->>'kind' = 'registered_fund_account'
       AND audit."metadata"->'funding'->>'openingTreatment' = f."openingTreatment"
       AND audit."metadata"->'funding'->>'accountId' = a."id" AND audit."metadata"->'funding'->>'balanceRegistrationId' = r."id"
       AND audit."metadata"->>'fromStatus' = (SELECT event."payload"->'writeAuthority'->>'requestStatusBeforeExecution' FROM public."RegisteredPaymentEvent" event WHERE event."executionId" = eid)
       AND audit."metadata"->>'toStatus' = (SELECT request."status" FROM public."PaymentRequest" request WHERE request."id" = e."paymentRequestId")) <> 1 THEN
   RAISE EXCEPTION 'registered payment requires one exact same-transaction canonical audit consequence';
 END IF;
 -- Deferred only, after all same-transaction root/fact/impact inserts.
 PERFORM public."jg_assert_registered_payment_intercompany_complete"(eid);
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "RegisteredPaymentFunding_conserve" AFTER INSERT ON public."RegisteredPaymentFunding" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_conservation"();
CREATE CONSTRAINT TRIGGER "RegisteredFundPaymentAllocation_conserve" AFTER INSERT ON public."RegisteredFundPaymentAllocation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_conservation"();
CREATE CONSTRAINT TRIGGER "RegisteredPaymentEvent_conserve" AFTER INSERT ON public."RegisteredPaymentEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_conservation"();

-- A pending voucher is permitted only for a same-transaction registered fact.
-- Legacy PaymentExecution immutable trigger is intentionally unchanged.
CREATE FUNCTION public."jg_registered_payment_pending_voucher"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW."voucherFileId" IS NULL AND NOT EXISTS (SELECT 1 FROM public."RegisteredPaymentFunding" WHERE "executionId" = NEW."id") THEN
   RAISE EXCEPTION 'legacy payment requires its original voucher';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "PaymentExecution_registered_pending_voucher" AFTER INSERT ON public."PaymentExecution" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_pending_voucher"();

CREATE FUNCTION public."jg_registered_payment_funding_insert"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE r public."FundAccountBalanceRegistration"; request_id TEXT; round_status TEXT; project_id TEXT; effective_date DATE;
BEGIN
 PERFORM 1 FROM public."RegisteredFundAccount" WHERE "id" = NEW."accountId" FOR UPDATE;
 SELECT "paymentRequestId" INTO STRICT request_id FROM public."PaymentExecution" WHERE "id" = NEW."executionId";
 SELECT "projectId" INTO STRICT project_id FROM public."PaymentRequest" WHERE "id"=request_id;
 SELECT scope."effectiveDate" INTO STRICT effective_date FROM public."jg_registered_operating_scope_lock"(project_id) scope;
 IF NEW."operatingLedgerEffectiveDateAtRegistration" IS DISTINCT FROM effective_date THEN RAISE EXCEPTION 'registered operating scope must freeze the real native project date'; END IF;
 SELECT "status" INTO round_status FROM public."ApprovalInstance" WHERE "businessType" = 'payment_request' AND "businessId" = request_id AND "flowType" = 'payment.approve' ORDER BY "createdAt" DESC LIMIT 1 FOR SHARE;
 IF round_status IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION 'registered payment latest approval round is not approved'; END IF;
 SELECT * INTO r FROM public."FundAccountBalanceRegistration" WHERE "accountId" = NEW."accountId" AND "status" = 'confirmed' ORDER BY "version" DESC LIMIT 1;
 IF r."id" IS NULL OR r."id" <> NEW."balanceRegistrationId" OR NOT EXISTS (
   SELECT 1 FROM public."RegisteredFundAccount" WHERE "id" = NEW."accountId" AND "writeRevision" > 0 AND xmin::TEXT = (pg_catalog.txid_current() % 4294967296)::TEXT
 ) OR NOT EXISTS (
   SELECT 1 FROM public."PaymentExecution" WHERE "id" = NEW."executionId" AND xmin::text = (pg_catalog.txid_current() % 4294967296)::text
 ) THEN RAISE EXCEPTION 'registered payment must atomically freeze the current same-account reconciliation'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "RegisteredPaymentFunding_insert" BEFORE INSERT ON public."RegisteredPaymentFunding" FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_funding_insert"();

-- Account capacity always subtracts exactly the uncovered canonical postings.
-- A correction does not absorb payments created after its frozen covered set.
-- Ambiguous split ancestry remains unresolved; it is never assigned twice/FIFO.
CREATE FUNCTION public."jg_registered_payment_account_capacity"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE acc_id TEXT; r public."FundAccountBalanceRegistration"; paid NUMERIC;
BEGIN
 acc_id := NEW."accountId";
 PERFORM 1 FROM public."RegisteredFundAccount" WHERE "id" = acc_id FOR UPDATE;
 SELECT * INTO r FROM public."FundAccountBalanceRegistration" WHERE "accountId" = acc_id AND "status" = 'confirmed' ORDER BY "version" DESC LIMIT 1;
 IF r."id" IS NULL THEN RAISE EXCEPTION 'registered payment account has no confirmed reconciliation'; END IF;
 SELECT coalesce(pg_catalog.sum(p."amountCents"),0) INTO paid FROM public."RegisteredFundPaymentAllocation" p
 WHERE p."accountId" = acc_id AND NOT (p."executionId" = ANY(r."coveredExecutionIds"));
 -- Unknown reconciliation remains unknown with existing uncovered payments;
 -- it is not zero or insufficient. New uncovered postings still require a
 -- known balance at INSERT below. A known negative result cannot be confirmed.
 IF r."balanceYuan" IS NOT NULL AND r."balanceYuan" * 100 < paid THEN
   RAISE EXCEPTION 'registered payment exceeds the confirmed account capacity';
 END IF;
 IF EXISTS (
   WITH RECURSIVE ancestry(current_id,node_id,path) AS (
     SELECT s."id",s."id",ARRAY[s."id"] FROM public."FundAccountSourceBatch" s WHERE s."registrationId" = r."id"
     UNION ALL
     SELECT a.current_id,s."previousSourceBatchId",a.path || s."previousSourceBatchId"
       FROM ancestry a JOIN public."FundAccountSourceBatch" s ON s."id" = a.node_id
       WHERE s."previousSourceBatchId" IS NOT NULL AND NOT(s."previousSourceBatchId" = ANY(a.path))
   ), matches AS (
     SELECT p."id" AS allocation_id,p."amountCents",a.current_id,
            pg_catalog.count(*) OVER(PARTITION BY p."id") AS candidate_count
       FROM public."RegisteredFundPaymentAllocation" p JOIN ancestry a ON a.node_id = p."sourceBatchId"
       WHERE p."accountId" = acc_id AND NOT(p."executionId" = ANY(r."coveredExecutionIds"))
   )
   SELECT 1 FROM matches m JOIN public."FundAccountSourceBatch" s ON s."id" = m.current_id
   WHERE m.candidate_count = 1 GROUP BY s."id",s."amountYuan" HAVING pg_catalog.sum(m."amountCents") > s."amountYuan" * 100
 ) THEN RAISE EXCEPTION 'registered payment exceeds its unambiguous source capacity'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "RegisteredFundPaymentAllocation_account_capacity" AFTER INSERT ON public."RegisteredFundPaymentAllocation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_account_capacity"();
CREATE CONSTRAINT TRIGGER "FundAccountBalanceRegistration_payment_capacity" AFTER INSERT OR UPDATE ON public."FundAccountBalanceRegistration" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_account_capacity"();

CREATE FUNCTION public."jg_registered_payment_allocation_insert"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE f public."RegisteredPaymentFunding"; r public."FundAccountBalanceRegistration"; s public."FundAccountSourceBatch"; project_id TEXT;
BEGIN
 SELECT * INTO STRICT f FROM public."RegisteredPaymentFunding" WHERE "executionId" = NEW."executionId" AND "accountId" = NEW."accountId";
 SELECT * INTO STRICT r FROM public."FundAccountBalanceRegistration" WHERE "id" = f."balanceRegistrationId" AND "accountId" = f."accountId";
 IF r."balanceYuan" IS NULL THEN RAISE EXCEPTION 'unknown reconciliation cannot fund a new uncovered payment'; END IF;
 SELECT * INTO STRICT s FROM public."FundAccountSourceBatch" WHERE "id" = NEW."sourceBatchId";
 IF s."registrationId" <> r."id" OR f."openingTreatment" <> 'not_included' THEN RAISE EXCEPTION 'allocation requires this payment frozen source'; END IF;
 SELECT request."projectId" INTO STRICT project_id FROM public."PaymentExecution" e JOIN public."PaymentRequest" request ON request."id" = e."paymentRequestId" WHERE e."id" = f."executionId";
 IF s."projectStatus" = 'company_daily' OR (s."projectStatus" = 'project' AND s."projectId" IS DISTINCT FROM project_id) THEN RAISE EXCEPTION 'payment project shortage cannot create an automatic advance or receipt'; END IF;
 IF EXISTS (
   WITH RECURSIVE ancestry(current_id,node_id,path) AS (
     SELECT source."id",source."id",ARRAY[source."id"] FROM public."FundAccountSourceBatch" source WHERE source."registrationId" = r."id"
     UNION ALL SELECT a.current_id,parent."previousSourceBatchId",a.path || parent."previousSourceBatchId"
       FROM ancestry a JOIN public."FundAccountSourceBatch" parent ON parent."id" = a.node_id
       WHERE parent."previousSourceBatchId" IS NOT NULL AND NOT(parent."previousSourceBatchId" = ANY(a.path))
   ), candidates AS (
     SELECT p."id",coalesce(pg_catalog.array_agg(a.current_id) FILTER(WHERE a.current_id IS NOT NULL),ARRAY[]::TEXT[]) AS candidate_ids FROM public."RegisteredFundPaymentAllocation" p
       LEFT JOIN ancestry a ON a.node_id = p."sourceBatchId"
       WHERE p."accountId" = f."accountId" AND NOT(p."executionId" = ANY(r."coveredExecutionIds"))
       GROUP BY p."id"
   ) SELECT 1 FROM candidates c WHERE pg_catalog.cardinality(c.candidate_ids) = 0 OR (pg_catalog.cardinality(c.candidate_ids) <> 1 AND NEW."sourceBatchId" = ANY(c.candidate_ids))
 ) THEN RAISE EXCEPTION 'source distribution is unresolved after reconciliation; no automatic allocation is allowed'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "RegisteredFundPaymentAllocation_insert" BEFORE INSERT ON public."RegisteredFundPaymentAllocation" FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_allocation_insert"();

-- Still not executable/promotable: compose the other task16 fragments for
-- private file binding, canonical Fact/Impact and precise InterEntity branches;
-- independently review the final chain, align Schema, then implement the real-PG
-- failure/response-loss/concurrency public driver and source-derived inventory.
-- No SQL in this directory has been executed or proved against PostgreSQL.

-- Runtime resolution for only the legacy authority functions patched above.
ALTER FUNCTION public."jg_registered_fund_immutable"() SET search_path TO pg_catalog, public, pg_temp;
