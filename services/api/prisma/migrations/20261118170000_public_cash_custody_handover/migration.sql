CREATE TABLE public."PublicCashCustody" (
  "accountId" TEXT PRIMARY KEY REFERENCES public."RegisteredFundAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "currentCustodianId" TEXT NOT NULL REFERENCES public."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "initialCustodianId" TEXT NOT NULL REFERENCES public."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "initialIdempotencyKey" TEXT NOT NULL,
  "initialRevision" INTEGER NOT NULL CHECK ("initialRevision" > 0),
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PublicCashCustody_initialIdempotencyKey_key" ON public."PublicCashCustody"("initialIdempotencyKey");

CREATE TABLE public."PublicCashHandover" (
  "id" TEXT PRIMARY KEY,
  "accountId" TEXT NOT NULL REFERENCES public."RegisteredFundAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "fromCustodianId" TEXT NOT NULL REFERENCES public."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "toCustodianId" TEXT NOT NULL REFERENCES public."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "startedByUserId" TEXT NOT NULL REFERENCES public."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "startedRevision" INTEGER NOT NULL CHECK ("startedRevision" > 0),
  "deliveredYuan" DECIMAL(24,4) NOT NULL CHECK ("deliveredYuan" >= 0),
  "expectedBalanceYuan" DECIMAL(24,4),
  "evidenceReference" TEXT NOT NULL CHECK (btrim("evidenceReference") <> ''),
  "idempotencyKey" TEXT NOT NULL,
  "payloadFingerprint" TEXT NOT NULL CHECK ("payloadFingerprint" ~ '^[0-9a-f]{64}$'),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PublicCashHandover_distinct_parties" CHECK ("fromCustodianId" <> "toCustodianId")
);
CREATE UNIQUE INDEX "PublicCashHandover_idempotencyKey_key" ON public."PublicCashHandover"("idempotencyKey");
CREATE UNIQUE INDEX "PublicCashHandover_accountId_startedRevision_key" ON public."PublicCashHandover"("accountId", "startedRevision");

CREATE TABLE public."PublicCashHandoverReceipt" (
  "handoverId" TEXT PRIMARY KEY REFERENCES public."PublicCashHandover"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "confirmedByUserId" TEXT NOT NULL REFERENCES public."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "amountReceivedYuan" DECIMAL(24,4) NOT NULL CHECK ("amountReceivedYuan" >= 0),
  "discrepancyYuan" DECIMAL(25,4),
  "idempotencyKey" TEXT NOT NULL,
  "payloadFingerprint" TEXT NOT NULL CHECK ("payloadFingerprint" ~ '^[0-9a-f]{64}$'),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PublicCashHandoverReceipt_idempotencyKey_key" ON public."PublicCashHandoverReceipt"("idempotencyKey");

CREATE FUNCTION public.jg_cash_handover_readonly() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Public cash handover history is immutable' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER "PublicCashHandover_immutable"
BEFORE UPDATE OR DELETE ON public."PublicCashHandover"
FOR EACH ROW EXECUTE FUNCTION public.jg_cash_handover_readonly();
CREATE TRIGGER "PublicCashHandoverReceipt_immutable"
BEFORE UPDATE OR DELETE ON public."PublicCashHandoverReceipt"
FOR EACH ROW EXECUTE FUNCTION public.jg_cash_handover_readonly();

CREATE FUNCTION public.jg_cash_handover_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM public."RegisteredFundAccount" a
  JOIN public."PublicCashCustody" c ON c."accountId" = a."id"
  WHERE a."id" = NEW."accountId" AND a."kind" = 'public_cash'
    AND c."currentCustodianId" = NEW."fromCustodianId" AND a."writeRevision" = NEW."startedRevision"
  FOR UPDATE OF a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Public cash handover does not match current custody' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PublicCashHandover_current_custody"
BEFORE INSERT ON public."PublicCashHandover"
FOR EACH ROW EXECUTE FUNCTION public.jg_cash_handover_insert();

CREATE FUNCTION public.jg_cash_handover_receipt_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM public."PublicCashHandover" h
  JOIN public."RegisteredFundAccount" a ON a."id" = h."accountId"
  JOIN public."PublicCashCustody" c ON c."accountId" = a."id"
  WHERE h."id" = NEW."handoverId" AND a."kind" = 'public_cash'
    AND h."toCustodianId" = NEW."confirmedByUserId"
    AND c."currentCustodianId" = h."fromCustodianId" AND a."writeRevision" = h."startedRevision"
    AND NEW."discrepancyYuan" IS NOT DISTINCT FROM NEW."amountReceivedYuan" - h."expectedBalanceYuan"
  FOR UPDATE OF a;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Public cash handover receipt does not match current custody and count' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PublicCashHandoverReceipt_current_custody"
BEFORE INSERT ON public."PublicCashHandoverReceipt"
FOR EACH ROW EXECUTE FUNCTION public.jg_cash_handover_receipt_insert();

CREATE FUNCTION public.jg_cash_custodian_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Public cash custody cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM 1 FROM public."RegisteredFundAccount" a
    WHERE a."id" = NEW."accountId" AND a."kind" = 'public_cash'
      AND a."writeRevision" = NEW."initialRevision" AND NEW."currentCustodianId" = NEW."initialCustodianId"
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Custody can only be assigned to public cash' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW."accountId", NEW."initialCustodianId", NEW."initialIdempotencyKey", NEW."initialRevision", NEW."assignedAt")
    IS DISTINCT FROM (OLD."accountId", OLD."initialCustodianId", OLD."initialIdempotencyKey", OLD."initialRevision", OLD."assignedAt") OR (
    NEW."currentCustodianId" IS DISTINCT FROM OLD."currentCustodianId" AND NOT EXISTS (
      SELECT 1 FROM public."PublicCashHandover" h
      JOIN public."PublicCashHandoverReceipt" r ON r."handoverId" = h."id"
      JOIN public."RegisteredFundAccount" a ON a."id" = h."accountId"
      WHERE h."accountId" = OLD."accountId" AND a."writeRevision" = h."startedRevision" + 1
        AND h."fromCustodianId" = OLD."currentCustodianId" AND h."toCustodianId" = NEW."currentCustodianId"
    )
  ) THEN
    RAISE EXCEPTION 'Public cash custodian change requires a matching receipt' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PublicCashCustody_guard"
BEFORE INSERT OR UPDATE OR DELETE ON public."PublicCashCustody"
FOR EACH ROW EXECUTE FUNCTION public.jg_cash_custodian_change();

CREATE FUNCTION public.jg_cash_handover_receipt_completed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."PublicCashHandover" h
    JOIN public."RegisteredFundAccount" a ON a."id" = h."accountId"
    JOIN public."PublicCashCustody" c ON c."accountId" = a."id"
    WHERE h."id" = NEW."handoverId" AND c."currentCustodianId" = h."toCustodianId"
      AND a."writeRevision" = h."startedRevision" + 1
  ) THEN
    RAISE EXCEPTION 'Public cash receipt must complete the custodian change' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "PublicCashHandoverReceipt_completed"
AFTER INSERT ON public."PublicCashHandoverReceipt" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.jg_cash_handover_receipt_completed();


-- Only a current, eligible custodian can act on a departed custodian's carried hold.
CREATE FUNCTION public."jg_public_cash_held_transfer_successor"(account_id TEXT, original_actor TEXT, successor_actor TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path=pg_catalog,public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."PublicCashCustody" c
    JOIN public."User" previous ON previous."id" = original_actor AND NOT previous."isActive"
    JOIN public."User" current ON current."id" = c."currentCustodianId" AND current."isActive"
    JOIN public."UserPosition" assignment ON assignment."userId" = current."id" AND assignment."projectId" IS NULL
    JOIN public."Position" position ON position."id" = assignment."positionId" AND position."key" = 'comprehensive_director'
    JOIN public."PublicCashHandover" h ON h."accountId" = c."accountId" AND h."fromCustodianId" = previous."id"
    JOIN public."PublicCashHandoverReceipt" r ON r."handoverId" = h."id"
    WHERE c."accountId" = account_id AND c."currentCustodianId" = successor_actor
  );
$$;

CREATE OR REPLACE FUNCTION public."jg_registered_fund_transfer_consistency"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
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
  OR (command_receipt."action"='register' AND command_receipt."actorUserId"<>t."createdByUserId")
  OR (command_receipt."action" IN ('resubmit','return') AND command_receipt."actorUserId"<>t."createdByUserId"
      AND NOT public."jg_public_cash_held_transfer_successor"(t."sourceAccountId",t."createdByUserId",command_receipt."actorUserId"))
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
