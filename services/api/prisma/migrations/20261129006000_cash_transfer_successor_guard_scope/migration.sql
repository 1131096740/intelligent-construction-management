BEGIN;

DO $preimage$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = pg_catalog.to_regprocedure('public.jg_registered_fund_transfer_consistency()')
      AND p.prokind = 'f'
      AND NOT p.prosecdef
      AND p.prorettype = 'pg_catalog.trigger'::pg_catalog.regtype
      AND p.proconfig = ARRAY['search_path=pg_catalog, public']
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex') =
        'b0586da6b8c229d960e9a0a12fa6f7e9bce1c7f5eb7266c1f6e3446b41e33da9'
  ) THEN
    RAISE EXCEPTION 'CASH_TRANSFER_CONSISTENCY_PREIMAGE' USING ERRCODE = '55000';
  END IF;
END;
$preimage$;

-- Replacing only the body preserves the routine's identity, owner and existing grants.
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
  OR (SELECT count(*) FROM public."RegisteredFundTransferAction" WHERE "transferId"=transfer_id)<>t."revision"
  OR (SELECT coalesce(sum("amountYuan"),0) FROM public."RegisteredFundTransferLine" WHERE "transferId"=transfer_id)<>t."amountYuan" THEN
  RAISE EXCEPTION 'fund transfer and its lines or action evidence do not agree';
 END IF;
 -- Keep the restricted successor routine out of the general consistency expression.
 IF command_receipt."action" IN ('resubmit','return') AND command_receipt."actorUserId"<>t."createdByUserId" THEN
   IF NOT public."jg_public_cash_held_transfer_successor"(t."sourceAccountId",t."createdByUserId",command_receipt."actorUserId") THEN
     RAISE EXCEPTION 'fund transfer and its lines or action evidence do not agree';
   END IF;
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

COMMIT;
