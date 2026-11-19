-- PREPARED WIP only. Not a standalone migration; executed=false.
-- Pure identity checks consumed by exact canonical adapter patches. A JSON flag
-- is never a substitute for Execution -> Funding -> account -> frozen sources.
CREATE FUNCTION public."jg_registered_payment_source_matches"(
 execution_id TEXT, project_id TEXT, amount_cents BIGINT, payer_kind TEXT, payer_id TEXT
) RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS (
   SELECT 1 FROM public."PaymentExecution" e
     JOIN public."PaymentRequest" request ON request."id" = e."paymentRequestId"
     JOIN public."RegisteredPaymentFunding" f ON f."executionId" = e."id"
     JOIN public."RegisteredFundAccount" a ON a."id" = f."accountId"
     JOIN public."FundAccountBalanceRegistration" r ON r."id" = f."balanceRegistrationId" AND r."accountId" = a."id"
   WHERE e."id" = execution_id AND e."paymentSubjectType" = 'our_company'
     AND request."projectId" = project_id AND e."amountCents" = amount_cents AND amount_cents > 0
     AND f."actualPayerKind" = payer_kind AND f."actualPayerId" = payer_id
     AND r."status" = 'confirmed'
     AND ((a."kind" = 'company' AND payer_kind = 'participating_company' AND a."companyEntityId" = payer_id
           AND f."actualPayerSnapshot"->>'companyEntityId' = payer_id AND pg_catalog.length(pg_catalog.btrim(f."actualPayerSnapshot"->>'name')) > 0)
       OR (a."kind" = 'public_cash' AND a."companyEntityId" IS NULL AND payer_kind = 'public_cash' AND payer_id = 'public_cash'
           AND f."actualPayerSnapshot"->>'scopeKey' = 'public_cash'))
     AND ((f."openingTreatment" = 'included' AND NOT EXISTS(SELECT 1 FROM public."RegisteredFundPaymentAllocation" p WHERE p."executionId" = e."id"))
       OR (f."openingTreatment" = 'not_included' AND (SELECT coalesce(pg_catalog.sum(p."amountCents"),0) FROM public."RegisteredFundPaymentAllocation" p WHERE p."executionId" = e."id") = amount_cents))
     AND NOT EXISTS(SELECT 1 FROM public."RegisteredFundPaymentAllocation" p JOIN public."FundAccountSourceBatch" s ON s."id" = p."sourceBatchId" WHERE p."executionId" = e."id" AND (p."accountId" <> a."id" OR s."registrationId" <> r."id"))
     -- Permanent provenance freezes the round seen at successful insertion.
     -- Deliberately no current role/latest round/history-basis status here.
     AND EXISTS(SELECT 1 FROM public."RegisteredPaymentEvent" event
       JOIN public."ContractVersion" version ON version."id" = event."payload"->'writeAuthority'->>'contractVersionId'
       JOIN public."ApprovalInstance" approved_round ON approved_round."id" = event."payload"->'writeAuthority'->'approvalRound'->>'id'
       WHERE event."executionId" = e."id" AND event."payload"->>'executionId' = e."id"
       AND event."payload"->>'accountId' = a."id" AND event."payload"->>'balanceRegistrationId' = r."id"
       AND event."payload"->'writeAuthority'->>'schemaVersion' = '1'
       AND pg_catalog.jsonb_typeof(event."payload"->'writeAuthority'->'contractHistoryRevision') = 'string'
       AND event."payload"->'writeAuthority'->>'contractHistoryRevision' ~ '^[0-9]+$'
       AND (f."contractHistoryConfirmation" IS NULL OR f."contractHistoryConfirmation"->'basis'->>'revision' = event."payload"->'writeAuthority'->>'contractHistoryRevision')
       AND event."payload"->'writeAuthority'->>'paymentRequestId' = e."paymentRequestId"
       AND event."payload"->'writeAuthority'->>'projectId' = request."projectId"
       AND event."payload"->'writeAuthority'->>'contractId' = request."contractId"
       AND version."id" = request."contractVersionId" AND version."contractId" = request."contractId"
       AND event."payload"->'writeAuthority'->>'sourceType' = request."sourceType"
       AND event."payload"->'writeAuthority'->>'sourceType' IN ('settlement','contract_due','contract_advance')
       AND event."payload"->'writeAuthority'->>'paymentSubjectType' = 'our_company'
       AND event."payload"->'writeAuthority'->>'signingSubjectType' = 'our_company'
       AND event."payload"->'writeAuthority'->>'requestStatusBeforeExecution' IN ('approved_pending_payment','partially_paid')
       AND event."payload"->'writeAuthority'->'approvalRound'->>'businessType' = 'payment_request'
       AND event."payload"->'writeAuthority'->'approvalRound'->>'businessId' = e."paymentRequestId"
       AND event."payload"->'writeAuthority'->'approvalRound'->>'flowType' = 'payment.approve'
       AND event."payload"->'writeAuthority'->'approvalRound'->>'status' = 'approved'
       AND approved_round."businessType" = 'payment_request' AND approved_round."businessId" = e."paymentRequestId" AND approved_round."flowType" = 'payment.approve'
       AND event."payload"->'writeAuthority'->'approvalRound'->>'createdAt' = public."jg_registered_timestamp_iso"(approved_round."createdAt"))
 );
$$;

CREATE FUNCTION public."jg_registered_payment_impact_matches"(
 execution_id TEXT, project_id TEXT, amount_cents BIGINT, payer_kind TEXT, payer_id TEXT,
 impact_kind TEXT, source_impact_key TEXT, direction_key TEXT, idempotency_key TEXT
) RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT public."jg_registered_payment_source_matches"(execution_id,project_id,amount_cents,payer_kind,payer_id)
 AND EXISTS (
   SELECT 1 FROM public."RegisteredPaymentFunding" f JOIN public."PaymentExecution" e ON e."id" = f."executionId"
   WHERE f."executionId" = execution_id AND (
     (f."openingTreatment" = 'not_included' AND payer_kind = 'participating_company'
       AND impact_kind = 'company_project_funds_decrease' AND source_impact_key = impact_kind
       AND direction_key = 'decrease' AND idempotency_key = 'payment_execution:' || execution_id || ':funds')
     OR (f."openingTreatment" = 'not_included' AND payer_kind = 'public_cash'
       AND impact_kind = 'public_cash_funds_decrease' AND source_impact_key = impact_kind
       AND direction_key = 'decrease' AND idempotency_key = 'payment_execution:' || execution_id || ':funds')
     OR (payer_kind = 'participating_company' AND payer_id <> e."companyEntityIdSnapshot"
       AND impact_kind = 'inter_subject_balance_increase' AND source_impact_key = 'inter_subject_proxy_payment'
       AND direction_key = 'increase' AND idempotency_key = 'payment_execution:' || execution_id || ':proxy'
       AND EXISTS(SELECT 1 FROM public."InterEntityRelationshipEntry" entry WHERE entry."paymentExecutionId" = execution_id
         AND entry."sourceType" = 'registered_payment_execution' AND entry."sourceAggregateId" = execution_id
         AND entry."status" = 'confirmed' AND entry."entryKind" = 'proxy_payment' AND entry."direction" = 'increase'
         AND entry."originalDebtorCompanyId" = e."companyEntityIdSnapshot" AND entry."creditorCompanyId" = payer_id
         AND entry."amountCents" = amount_cents))
   )
 );
$$;

-- Participant validator patch: alter only the actualPayer ARRAY element in all
-- three identical occurrences (two ordered-lock arrays and the role loop).
-- Debtor/creditor/approvedPayer/payee/cost entries remain governed by POL284.
-- Taking pg_get_functiondef preserves the later 20261020 ownership-date patch.
DO $$
DECLARE body TEXT; anchor TEXT := 'CASE WHEN NEW."actualPayerSubjectKind" = ''participating_company'' THEN NEW."actualPayerSubjectId" ELSE NULL END'; replacement TEXT;
BEGIN
 SELECT pg_catalog.pg_get_functiondef('public."validateOperatingFactReferences"()'::regprocedure) INTO body;
 IF (pg_catalog.length(body)-pg_catalog.length(replace(body,anchor,'')))/pg_catalog.length(anchor) <> 3 OR position('jg_company_repayment_ownership_date' IN body) = 0 THEN
   RAISE EXCEPTION 'task16 canonical fact predecessor drifted';
 END IF;
 replacement := 'CASE WHEN NEW."actualPayerSubjectKind" = ''participating_company'' THEN CASE WHEN NEW."sourceType" = ''payment_execution'' AND public."jg_registered_payment_source_matches"(NEW."sourceBusinessId",NEW."projectId",NEW."amountCents",NEW."actualPayerSubjectKind",NEW."actualPayerSubjectId") THEN NULL ELSE NEW."actualPayerSubjectId" END ELSE NULL END';
 EXECUTE replace(body,anchor,replacement);
END $$;
-- Cash/impact/InterEntity adaptations are composed by the following prepared
-- files; their complete final-chain behavior remains unexecuted and unproven.

-- Runtime resolution for only the legacy authority functions patched above.
ALTER FUNCTION public."validateOperatingFactReferences"() SET search_path TO pg_catalog, public, pg_temp;
