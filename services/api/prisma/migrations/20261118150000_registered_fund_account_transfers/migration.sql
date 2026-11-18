CREATE TABLE public."RegisteredFundTransfer" (
 "id" TEXT PRIMARY KEY,
 "sourceAccountId" TEXT NOT NULL REFERENCES public."RegisteredFundAccount"("id") ON DELETE RESTRICT,
 "destinationAccountId" TEXT NOT NULL REFERENCES public."RegisteredFundAccount"("id") ON DELETE RESTRICT,
 "status" TEXT NOT NULL CHECK ("status" IN ('pending_receipt','rejected_held','received','returned')),
 "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
 "amountYuan" DECIMAL(24,4) NOT NULL CHECK ("amountYuan" > 0 AND "amountYuan" <> 'NaN'::numeric),
 "createdByUserId" TEXT NOT NULL REFERENCES public."User"("id") ON DELETE RESTRICT,
 "transferredOn" TEXT NOT NULL CHECK ("transferredOn" ~ '^\d{4}-\d{2}-\d{2}$'),
 "evidenceReference" TEXT NOT NULL CHECK (length(btrim("evidenceReference")) > 0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("sourceAccountId" <> "destinationAccountId")
);
CREATE INDEX "RegisteredFundTransfer_sourceAccountId_status_idx" ON public."RegisteredFundTransfer"("sourceAccountId","status");
CREATE INDEX "RegisteredFundTransfer_destinationAccountId_status_idx" ON public."RegisteredFundTransfer"("destinationAccountId","status");
CREATE TABLE public."RegisteredFundTransferLine" (
 "id" TEXT PRIMARY KEY,
 "transferId" TEXT NOT NULL REFERENCES public."RegisteredFundTransfer"("id") ON DELETE RESTRICT,
 "sourceBatchId" TEXT NOT NULL REFERENCES public."FundAccountSourceBatch"("id") ON DELETE RESTRICT,
 "amountYuan" DECIMAL(24,4) NOT NULL CHECK ("amountYuan" > 0 AND "amountYuan" <> 'NaN'::numeric),
 UNIQUE ("transferId","sourceBatchId")
);
CREATE TABLE public."RegisteredFundTransferAction" (
 "idempotencyKey" TEXT PRIMARY KEY,
 "transferId" TEXT NOT NULL REFERENCES public."RegisteredFundTransfer"("id") ON DELETE RESTRICT,
 "actorUserId" TEXT NOT NULL REFERENCES public."User"("id") ON DELETE RESTRICT,
 "revision" INTEGER NOT NULL CHECK ("revision" > 0),
 "action" TEXT NOT NULL CHECK ("action" IN ('register','confirm','reject','resubmit','return')),
 "status" TEXT NOT NULL CHECK ("status" IN ('pending_receipt','rejected_held','received','returned')),
 "evidenceReference" TEXT NOT NULL CHECK (length(btrim("evidenceReference")) > 0),
 "payloadFingerprint" TEXT NOT NULL CHECK ("payloadFingerprint" ~ '^[a-f0-9]{64}$'),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("transferId","revision")
);
ALTER TABLE public."FundAccountBalanceRegistration" ADD COLUMN "transferId" TEXT REFERENCES public."RegisteredFundTransfer"("id") ON DELETE RESTRICT,
 ADD UNIQUE ("transferId","accountId");
ALTER TABLE public."FundAccountSourceBatch" ADD COLUMN "receivedTransferLineId" TEXT UNIQUE REFERENCES public."RegisteredFundTransferLine"("id") ON DELETE RESTRICT;

-- Replace only the two checks whose closed kind sets now admit a transfer successor.
DO $$
DECLARE c record; replaced INT := 0;
BEGIN
 FOR c IN SELECT conname FROM pg_catalog.pg_constraint
   WHERE conrelid = 'public."FundAccountBalanceRegistration"'::regclass AND contype = 'c'
     AND pg_catalog.pg_get_constraintdef(oid) LIKE '%''opening''%'
     AND pg_catalog.pg_get_constraintdef(oid) LIKE '%''correction''%'
 LOOP
   EXECUTE format('ALTER TABLE public."FundAccountBalanceRegistration" DROP CONSTRAINT %I', c.conname);
   replaced := replaced + 1;
 END LOOP;
 IF replaced <> 2 THEN RAISE EXCEPTION 'fund transfer registration checks changed'; END IF;
END $$;
ALTER TABLE public."FundAccountBalanceRegistration"
 ADD CONSTRAINT "FundAccountBalanceRegistration_transfer_kind_check" CHECK (
 ("kind" = 'opening' AND "transferId" IS NULL AND "approvalInstanceId" IS NULL AND "version" = 1 AND "previousRegistrationId" IS NULL AND "status" = 'confirmed')
 OR ("kind" = 'correction' AND "transferId" IS NULL AND "approvalInstanceId" IS NOT NULL AND "version" > 1 AND "previousRegistrationId" IS NOT NULL AND "status" IN ('pending_review','confirmed','returned','withdrawn'))
 OR ("kind" = 'transfer' AND "transferId" IS NOT NULL AND "approvalInstanceId" IS NULL AND "version" > 1 AND "previousRegistrationId" IS NOT NULL AND "status" = 'confirmed' AND "balanceYuan" IS NOT NULL));

CREATE OR REPLACE FUNCTION public."jg_registered_fund_source_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent public."FundAccountBalanceRegistration";
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public."FundAccountBalanceRegistration" WHERE "id" = NEW."registrationId" AND xmin::text = (txid_current() % 4294967296)::text) THEN
   RAISE EXCEPTION 'source snapshots must be created atomically with their registration';
 END IF;
 SELECT * INTO STRICT parent FROM public."FundAccountBalanceRegistration" WHERE "id" = NEW."registrationId";
 IF parent."kind" = 'correction' AND parent."status" <> 'pending_review' THEN
   RAISE EXCEPTION 'terminal correction source snapshots are immutable';
 END IF;
 IF parent."kind" <> 'transfer' AND NEW."receivedTransferLineId" IS NOT NULL THEN
   RAISE EXCEPTION 'received transfer source requires an atomic transfer registration';
 END IF;
 IF (parent."kind" = 'opening' AND NEW."previousSourceBatchId" IS NOT NULL) OR
    (parent."kind" IN ('correction','transfer') AND NEW."receivedTransferLineId" IS NULL AND (
      (EXISTS (SELECT 1 FROM public."FundAccountSourceBatch" WHERE "registrationId" = parent."previousRegistrationId") AND
       NOT EXISTS (SELECT 1 FROM public."FundAccountSourceBatch" WHERE "id" = NEW."previousSourceBatchId" AND "registrationId" = parent."previousRegistrationId")) OR
      (NOT EXISTS (SELECT 1 FROM public."FundAccountSourceBatch" WHERE "registrationId" = parent."previousRegistrationId") AND NEW."previousSourceBatchId" IS NOT NULL))) THEN
   RAISE EXCEPTION 'source snapshot must retain the previous reconciliation lineage';
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION public."jg_registered_fund_transfer_mutation"() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog,public AS $$
DECLARE expected TEXT;
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'fund transfer history is append-only'; END IF;
 IF TG_TABLE_NAME <> 'RegisteredFundTransfer' THEN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'fund transfer evidence is immutable'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP = 'INSERT' THEN
  IF NEW."status" <> 'pending_receipt' OR NEW."revision" <> 1 THEN RAISE EXCEPTION 'fund transfer must start held'; END IF;
 ELSE
  IF (to_jsonb(NEW) - ARRAY['status','revision']) <> (to_jsonb(OLD) - ARRAY['status','revision'])
      OR NEW."revision" <> OLD."revision" + 1 THEN RAISE EXCEPTION 'fund transfer facts are immutable'; END IF;
  expected := CASE
   WHEN OLD."status" = 'pending_receipt' AND NEW."status" IN ('received','rejected_held') THEN NEW."status"
   WHEN OLD."status" = 'rejected_held' AND NEW."status" IN ('pending_receipt','returned') THEN NEW."status"
  END;
  IF expected IS NULL THEN RAISE EXCEPTION 'invalid fund transfer transition'; END IF;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
  WHERE tgrelid=to_regclass('public."RegisteredFundPaymentAllocation"')
    AND tgname='RegisteredFundPaymentAllocation_transfer_capacity' AND tgtype=5 AND tgenabled IN ('O','A')
    AND tgfoid='public.jg_registered_fund_transfer_account_trigger()'::regprocedure
    AND tgdeferrable AND tginitdeferred) THEN
   RAISE EXCEPTION 'registered payment transfer capacity fence is not installed';
 END IF;
 PERFORM 1 FROM public."RegisteredFundAccount" WHERE "id" IN (NEW."sourceAccountId",NEW."destinationAccountId") ORDER BY "id" FOR UPDATE;
 IF (SELECT count(*) FROM public."RegisteredFundAccount" a
   WHERE a."id" IN (NEW."sourceAccountId",NEW."destinationAccountId") AND a.xmin::text=(txid_current()%4294967296)::text) <> 2 THEN
   RAISE EXCEPTION 'fund transfer requires both registered account write revisions';
 END IF;
 IF (SELECT count(*) FROM public."RegisteredFundAccount" WHERE "id" IN (NEW."sourceAccountId",NEW."destinationAccountId") AND "kind" = 'public_cash') <> 1 THEN
   RAISE EXCEPTION 'fund transfer requires public cash and one company account';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "RegisteredFundTransfer_mutation" BEFORE INSERT OR UPDATE OR DELETE ON public."RegisteredFundTransfer" FOR EACH ROW EXECUTE FUNCTION public."jg_registered_fund_transfer_mutation"();
CREATE TRIGGER "RegisteredFundTransferLine_immutable" BEFORE UPDATE OR DELETE ON public."RegisteredFundTransferLine" FOR EACH ROW EXECUTE FUNCTION public."jg_registered_fund_transfer_mutation"();
CREATE TRIGGER "RegisteredFundTransferAction_immutable" BEFORE UPDATE OR DELETE ON public."RegisteredFundTransferAction" FOR EACH ROW EXECUTE FUNCTION public."jg_registered_fund_transfer_mutation"();

CREATE FUNCTION public."jg_registered_fund_transfer_line_insert"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM public."RegisteredFundTransfer" t
  JOIN public."FundAccountBalanceRegistration" r ON r."accountId"=t."sourceAccountId" AND r."status"='confirmed'
  JOIN public."FundAccountSourceBatch" s ON s."registrationId"=r."id" AND s."id"=NEW."sourceBatchId"
  WHERE t."id"=NEW."transferId" AND t."status"='pending_receipt' AND t."revision"=1
    AND t.xmin::text=(txid_current()%4294967296)::text
    AND NOT EXISTS (SELECT 1 FROM public."FundAccountBalanceRegistration" later
      WHERE later."accountId"=r."accountId" AND later."status"='confirmed' AND later."version">r."version")
 ) THEN RAISE EXCEPTION 'fund transfer line requires its own current source'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "RegisteredFundTransferLine_source" BEFORE INSERT ON public."RegisteredFundTransferLine" FOR EACH ROW EXECUTE FUNCTION public."jg_registered_fund_transfer_line_insert"();

CREATE FUNCTION public."jg_registered_fund_transfer_capacity"(account_id TEXT) RETURNS VOID LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE current_row public."FundAccountBalanceRegistration"; held NUMERIC; paid NUMERIC := 0; payments JSONB := '[]'::jsonb;
BEGIN
 SELECT coalesce(sum(l."amountYuan"),0) INTO held
 FROM public."RegisteredFundTransfer" t JOIN public."RegisteredFundTransferLine" l ON l."transferId"=t."id"
 WHERE t."sourceAccountId"=account_id AND t."status" IN ('pending_receipt','rejected_held');
 IF held=0 THEN RETURN; END IF;
 PERFORM 1 FROM public."RegisteredFundAccount" WHERE "id"=account_id FOR UPDATE;
 SELECT * INTO STRICT current_row FROM public."FundAccountBalanceRegistration"
   WHERE "accountId"=account_id AND "status"='confirmed' ORDER BY "version" DESC LIMIT 1;
 -- The old exact receipt fixture installs payment tables after migrations.
 -- Where installed, use its uncovered canonical postings as the same capacity input.
 IF to_regclass('public."RegisteredFundPaymentAllocation"') IS NOT NULL THEN
   EXECUTE 'SELECT coalesce(sum("amountCents"),0)/100.0, coalesce(jsonb_agg(jsonb_build_object(''source'', "sourceBatchId", ''amount'', "amountCents"/100.0)),''[]''::jsonb)
    FROM public."RegisteredFundPaymentAllocation" WHERE "accountId"=$1 AND NOT("executionId"=ANY($2))'
   INTO paid,payments USING account_id,current_row."coveredExecutionIds";
 END IF;
 IF current_row."balanceYuan" IS NULL OR current_row."balanceYuan" < held+paid THEN
  RAISE EXCEPTION 'pending fund transfers exceed known account capacity';
 END IF;
 IF EXISTS (
  WITH RECURSIVE ancestry(current_id,node_id,path) AS (
   SELECT b."id",b."id",ARRAY[b."id"] FROM public."FundAccountSourceBatch" b WHERE b."registrationId"=current_row."id"
   UNION ALL SELECT a.current_id,b."previousSourceBatchId",a.path||b."previousSourceBatchId"
    FROM ancestry a JOIN public."FundAccountSourceBatch" b ON b."id"=a.node_id
    WHERE b."previousSourceBatchId" IS NOT NULL AND NOT b."previousSourceBatchId"=ANY(a.path)
  ), holds AS (
   SELECT l."id",l."sourceBatchId",l."amountYuan" FROM public."RegisteredFundTransferLine" l
   JOIN public."RegisteredFundTransfer" t ON t."id"=l."transferId"
   WHERE t."sourceAccountId"=account_id AND t."status" IN ('pending_receipt','rejected_held')
  ), held_matches AS (
   SELECT h."id",h."sourceBatchId",h."amountYuan",min(a.current_id) AS current_id,count(a.current_id) AS candidates
   FROM holds h LEFT JOIN ancestry a ON a.node_id=h."sourceBatchId" GROUP BY h."id",h."sourceBatchId",h."amountYuan"
  ), payment_matches AS (
   SELECT e.ord, (e.row->>'amount')::numeric AS amount,min(a.current_id) AS current_id,count(a.current_id) AS candidates
   FROM jsonb_array_elements(payments) WITH ORDINALITY e(row,ord)
   LEFT JOIN ancestry a ON a.node_id=e.row->>'source' GROUP BY e.ord,e.row
  )
  SELECT 1 FROM held_matches d
   JOIN public."FundAccountSourceBatch" origin ON origin."id"=d."sourceBatchId"
   LEFT JOIN public."FundAccountSourceBatch" active ON active."id"=d.current_id
   WHERE d.candidates<>1 OR
    (active."sourceStatus",active."sourceName",active."projectStatus",active."projectId") IS DISTINCT FROM
    (origin."sourceStatus",origin."sourceName",origin."projectStatus",origin."projectId")
  UNION ALL SELECT 1 FROM (
   SELECT h.current_id,sum(h."amountYuan")+coalesce((SELECT sum(p.amount) FROM payment_matches p WHERE p.candidates=1 AND p.current_id=h.current_id),0) AS consumed
   FROM held_matches h WHERE h.candidates=1 GROUP BY h.current_id
  ) sums JOIN public."FundAccountSourceBatch" b ON b."id"=sums.current_id WHERE b."amountYuan"<sums.consumed
 ) THEN RAISE EXCEPTION 'pending fund transfer source capacity or lineage changed'; END IF;
END $$;

CREATE FUNCTION public."jg_registered_fund_transfer_account_trigger"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public."jg_registered_fund_transfer_capacity"(NEW."accountId");
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "FundAccountBalanceRegistration_transfer_capacity" AFTER INSERT OR UPDATE ON public."FundAccountBalanceRegistration"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public."jg_registered_fund_transfer_account_trigger"();

DO $$ BEGIN
 IF to_regclass('public."RegisteredFundPaymentAllocation"') IS NOT NULL THEN
  CREATE CONSTRAINT TRIGGER "RegisteredFundPaymentAllocation_transfer_capacity" AFTER INSERT ON public."RegisteredFundPaymentAllocation"
   DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public."jg_registered_fund_transfer_account_trigger"();
 END IF;
END $$;

CREATE FUNCTION public."jg_registered_fund_transfer_consistency"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE transfer_id TEXT; t public."RegisteredFundTransfer"; command_receipt public."RegisteredFundTransferAction";
  receipt public."FundAccountBalanceRegistration"; previous public."FundAccountBalanceRegistration";
  outgoing public."FundAccountBalanceRegistration"; incoming public."FundAccountBalanceRegistration";
BEGIN
 IF TG_TABLE_NAME='RegisteredFundTransfer' THEN transfer_id:=NEW."id";
 ELSE transfer_id:=NEW."transferId";
 END IF;
 IF transfer_id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO STRICT t FROM public."RegisteredFundTransfer" WHERE "id"=transfer_id;
 SELECT * INTO STRICT command_receipt FROM public."RegisteredFundTransferAction" WHERE "transferId"=transfer_id AND "revision"=t."revision";
 IF command_receipt."status"<>t."status" OR command_receipt."action" IS DISTINCT FROM (CASE t."status"
  WHEN 'pending_receipt' THEN CASE WHEN t."revision"=1 THEN 'register' ELSE 'resubmit' END
  WHEN 'rejected_held' THEN 'reject' WHEN 'received' THEN 'confirm' ELSE 'return' END)
  OR (command_receipt."action" IN ('register','resubmit','return') AND command_receipt."actorUserId"<>t."createdByUserId")
  OR (SELECT count(*) FROM public."RegisteredFundTransferAction" WHERE "transferId"=transfer_id)<>t."revision"
  OR (SELECT coalesce(sum("amountYuan"),0) FROM public."RegisteredFundTransferLine" WHERE "transferId"=transfer_id)<>t."amountYuan" THEN
  RAISE EXCEPTION 'fund transfer and its lines or action evidence do not agree';
 END IF;
 IF t."status"<>'received' THEN
  IF EXISTS (SELECT 1 FROM public."FundAccountBalanceRegistration" WHERE "transferId"=transfer_id) THEN
   RAISE EXCEPTION 'fund transfer cannot post before actual receipt';
  END IF;
  PERFORM public."jg_registered_fund_transfer_capacity"(t."sourceAccountId");
  RETURN NULL;
 END IF;
 SELECT * INTO STRICT outgoing FROM public."FundAccountBalanceRegistration" WHERE "transferId"=transfer_id AND "accountId"=t."sourceAccountId";
 SELECT * INTO STRICT incoming FROM public."FundAccountBalanceRegistration" WHERE "transferId"=transfer_id AND "accountId"=t."destinationAccountId";
 IF (SELECT count(*) FROM public."FundAccountBalanceRegistration" WHERE "transferId"=transfer_id)<>2 THEN RAISE EXCEPTION 'fund transfer has one debit and one credit'; END IF;
 FOR receipt IN SELECT * FROM public."FundAccountBalanceRegistration" WHERE "transferId"=transfer_id LOOP
  SELECT * INTO STRICT previous FROM public."FundAccountBalanceRegistration" WHERE "id"=receipt."previousRegistrationId";
  IF previous."status"<>'confirmed' OR previous."balanceYuan" IS NULL OR previous."version">=receipt."version" OR EXISTS (
    SELECT 1 FROM public."FundAccountBalanceRegistration" other
    WHERE other."accountId"=receipt."accountId" AND other."status"='confirmed' AND other."version">previous."version" AND other."version"<receipt."version"
   ) OR previous."coveredExecutionIds"<>receipt."coveredExecutionIds" OR previous."asOfDate"<>receipt."asOfDate" OR
   receipt."createdByUserId"<>command_receipt."actorUserId" OR receipt."confirmedByUserId"<>command_receipt."actorUserId" OR
   receipt."balanceYuan"<>previous."balanceYuan"+(CASE WHEN receipt."accountId"=t."sourceAccountId" THEN -t."amountYuan" ELSE t."amountYuan" END)
  THEN RAISE EXCEPTION 'fund transfer receipt changes only its own conserved balance'; END IF;
  IF EXISTS (
   SELECT 1 FROM public."FundAccountSourceBatch" prior_source
   LEFT JOIN public."FundAccountSourceBatch" next
    ON next."registrationId"=receipt."id" AND next."previousSourceBatchId"=prior_source."id"
   WHERE prior_source."registrationId"=previous."id"
   GROUP BY prior_source."id" HAVING count(next."id")<>1
  ) OR EXISTS (
   SELECT 1 FROM public."FundAccountSourceBatch" next JOIN public."FundAccountSourceBatch" prior_source ON prior_source."id"=next."previousSourceBatchId"
   WHERE next."registrationId"=receipt."id" AND (
    (next."sourceStatus",next."sourceName",next."projectStatus",next."projectId") IS DISTINCT FROM
    (prior_source."sourceStatus",prior_source."sourceName",prior_source."projectStatus",prior_source."projectId")
    OR (receipt."accountId"=t."destinationAccountId" AND next."amountYuan"<>prior_source."amountYuan")
   )
  ) THEN RAISE EXCEPTION 'fund transfer changes existing source identity'; END IF;
 END LOOP;
 IF EXISTS (
  WITH RECURSIVE ancestry(current_id,node_id,path) AS (
   SELECT s."id",s."id",ARRAY[s."id"] FROM public."FundAccountSourceBatch" s WHERE s."registrationId"=outgoing."previousRegistrationId"
   UNION ALL SELECT a.current_id,s."previousSourceBatchId",a.path||s."previousSourceBatchId"
    FROM ancestry a JOIN public."FundAccountSourceBatch" s ON s."id"=a.node_id
    WHERE s."previousSourceBatchId" IS NOT NULL AND NOT s."previousSourceBatchId"=ANY(a.path)
  ), debits AS (
   SELECT l."id",l."sourceBatchId",l."amountYuan",min(a.current_id) AS current_id,count(a.current_id) AS candidates
   FROM public."RegisteredFundTransferLine" l LEFT JOIN ancestry a ON a.node_id=l."sourceBatchId"
   WHERE l."transferId"=transfer_id GROUP BY l."id",l."sourceBatchId",l."amountYuan"
  )
  SELECT 1 FROM debits d
   JOIN public."FundAccountSourceBatch" origin ON origin."id"=d."sourceBatchId"
   LEFT JOIN public."FundAccountSourceBatch" active ON active."id"=d.current_id
   WHERE d.candidates<>1 OR
    (active."sourceStatus",active."sourceName",active."projectStatus",active."projectId") IS DISTINCT FROM
    (origin."sourceStatus",origin."sourceName",origin."projectStatus",origin."projectId")
  UNION ALL SELECT 1 FROM public."FundAccountSourceBatch" next
   LEFT JOIN public."FundAccountSourceBatch" prior_source ON prior_source."id"=next."previousSourceBatchId"
   WHERE next."registrationId"=outgoing."id" AND (
    prior_source."id" IS NULL OR next."receivedTransferLineId" IS NOT NULL OR
    next."amountYuan"<>prior_source."amountYuan"-coalesce((SELECT sum(d."amountYuan") FROM debits d WHERE d.current_id=prior_source."id"),0)
   )
 ) OR EXISTS (
  SELECT 1 FROM public."RegisteredFundTransferLine" l
  JOIN public."FundAccountSourceBatch" origin ON origin."id"=l."sourceBatchId"
  LEFT JOIN public."FundAccountSourceBatch" credited ON credited."receivedTransferLineId"=l."id"
  WHERE l."transferId"=transfer_id AND (
   credited."registrationId" IS DISTINCT FROM incoming."id" OR credited."previousSourceBatchId" IS NOT NULL OR
   credited."amountYuan" IS DISTINCT FROM l."amountYuan" OR
   (credited."sourceStatus",credited."sourceName",credited."projectStatus",credited."projectId") IS DISTINCT FROM
   (origin."sourceStatus",origin."sourceName",origin."projectStatus",origin."projectId")
  )
 ) OR EXISTS (SELECT 1 FROM public."FundAccountSourceBatch" s LEFT JOIN public."RegisteredFundTransferLine" l ON l."id"=s."receivedTransferLineId"
   WHERE s."registrationId"=incoming."id" AND s."previousSourceBatchId" IS NULL AND l."transferId" IS DISTINCT FROM transfer_id)
 THEN RAISE EXCEPTION 'fund transfer source debit and credit do not match its original lines'; END IF;
 PERFORM public."jg_registered_fund_transfer_capacity"(t."sourceAccountId");
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "RegisteredFundTransfer_consistency" AFTER INSERT OR UPDATE ON public."RegisteredFundTransfer"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public."jg_registered_fund_transfer_consistency"();
CREATE CONSTRAINT TRIGGER "RegisteredFundTransferAction_consistency" AFTER INSERT ON public."RegisteredFundTransferAction"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public."jg_registered_fund_transfer_consistency"();
CREATE CONSTRAINT TRIGGER "FundAccountBalanceRegistration_transfer_consistency" AFTER INSERT ON public."FundAccountBalanceRegistration"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public."jg_registered_fund_transfer_consistency"();
