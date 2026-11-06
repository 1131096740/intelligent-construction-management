-- PREPARED WIP only, executed=false. No independent migration promotion.
-- A registered root is a consequence of one canonical payment, never another
-- payment/settlement/fund-execution line. Legacy roots and returns retain their
-- original constraints, context, attestation, capacity and reservation guards.
CREATE FUNCTION public."jg_assert_registered_payment_relationship"(entry public."InterEntityRelationshipEntry")
RETURNS VOID LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE e public."PaymentExecution"; f public."RegisteredPaymentFunding"; request public."PaymentRequest";
BEGIN
 SELECT * INTO STRICT e FROM public."PaymentExecution" WHERE "id" = entry."paymentExecutionId";
 SELECT * INTO STRICT f FROM public."RegisteredPaymentFunding" WHERE "executionId" = e."id";
 SELECT * INTO STRICT request FROM public."PaymentRequest" WHERE "id" = e."paymentRequestId";
 IF NOT coalesce(
   entry."sourceType" = 'registered_payment_execution' AND entry."sourceAggregateId" = e."id"
   AND entry."entryKind" = 'proxy_payment' AND entry."direction" = 'increase' AND entry."status" = 'confirmed'
   AND entry."adjustsEntryId" IS NULL AND entry."settlementCaseId" IS NULL
   AND entry."fundExecutionId" IS NULL AND entry."fundExecutionCaseId" IS NULL AND entry."executionAllocationLineId" IS NULL
   AND entry."evidenceFileId" IS NULL AND entry."evidenceClaimId" IS NULL AND entry."evidenceUploadedByUserId" IS NULL AND entry."evidenceContentSha256" IS NULL
   AND entry."authorizationEvidenceFileId" IS NULL AND entry."authorizationEvidenceContentSha256" IS NULL
   AND entry."reauthorizationReference" IS NULL AND entry."reauthorizedByUserId" IS NULL AND entry."reauthorizedAt" IS NULL
   AND entry."actualPayerVerificationEvidenceFileId" IS NULL AND entry."actualPayerVerificationContentSha256" IS NULL
   AND entry."projectId" = request."projectId" AND entry."contractId" = request."contractId" AND entry."contractVersionId" = request."contractVersionId"
   AND entry."originalDebtorCompanyId" = e."companyEntityIdSnapshot" AND entry."approvedPayerCompanyId" = e."companyEntityIdSnapshot"
   AND entry."creditorCompanyId" = f."actualPayerId" AND entry."creditorCompanyId" <> entry."originalDebtorCompanyId"
   AND entry."debtorSnapshot" = pg_catalog.jsonb_build_object('companyEntityId',e."companyEntityIdSnapshot",'name',e."companyEntityNameSnapshot",'creditCode',e."companyEntityCreditCodeSnapshot")
   AND entry."approvedPayerSnapshot" = entry."debtorSnapshot" AND entry."creditorSnapshot" = f."actualPayerSnapshot"
   AND entry."amountCents" = e."amountCents" AND entry."currencyCode" = 'CNY'
   AND entry."sourceAllocationCount" = 1 AND entry."sourceAllocationAmountCents" = e."amountCents"
   AND entry."idempotencyKey" = 'registered-payment:' || e."id" || ':intercompany' AND entry."payloadFingerprint" = f."payloadFingerprint"
   AND entry."createdByUserId" = e."executedByUserId" AND entry."confirmedByUserId" = e."executedByUserId" AND entry."confirmedAt" IS NOT NULL
   AND pg_catalog.length(pg_catalog.btrim(entry."reason")) > 0
   AND public."jg_registered_payment_source_matches"(e."id",request."projectId",e."amountCents",'participating_company',entry."creditorCompanyId"),FALSE)
 THEN RAISE EXCEPTION 'registered intercompany root does not match its one canonical payment and frozen container'; END IF;
END $$;
-- Commit-only completeness. Do NOT call this from source_matches or the
-- BEFORE root validator: the root/impact being inserted may not exist yet.
CREATE FUNCTION public."jg_assert_registered_payment_intercompany_complete"(execution_id TEXT)
RETURNS VOID LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE e public."PaymentExecution"; f public."RegisteredPaymentFunding"; request public."PaymentRequest";
 root public."InterEntityRelationshipEntry"; fact public."OperatingFact"; proxy public."OperatingImpactEntry"; root_count BIGINT; proxy_count BIGINT;
BEGIN
 SELECT * INTO STRICT e FROM public."PaymentExecution" WHERE "id" = execution_id;
 SELECT * INTO STRICT f FROM public."RegisteredPaymentFunding" WHERE "executionId" = execution_id;
 SELECT * INTO STRICT request FROM public."PaymentRequest" WHERE "id" = e."paymentRequestId";
 SELECT pg_catalog.count(*) INTO root_count FROM public."InterEntityRelationshipEntry"
   WHERE "paymentExecutionId" = execution_id AND "entryKind" = 'proxy_payment' AND "direction" = 'increase';
 SELECT pg_catalog.count(*) INTO proxy_count FROM public."OperatingImpactEntry" WHERE "sourceType" = 'payment_execution' AND "sourceBusinessId" = execution_id
   AND ("impactKind" = 'inter_subject_balance_increase' OR "sourceImpactKey" = 'inter_subject_proxy_payment' OR "idempotencyKey" = 'payment_execution:' || execution_id || ':proxy');
 IF f."actualPayerKind" = 'participating_company' AND f."actualPayerId" <> e."companyEntityIdSnapshot" THEN
   IF root_count <> 1 THEN RAISE EXCEPTION 'registered cross-company payment requires exactly one debt root'; END IF;
   SELECT * INTO STRICT root FROM public."InterEntityRelationshipEntry"
     WHERE "paymentExecutionId" = execution_id AND "entryKind" = 'proxy_payment' AND "direction" = 'increase';
   PERFORM public."jg_assert_registered_payment_relationship"(root);
   -- Frozen initial applicability is not a ban on later legitimate projection.
   -- No future Project date read here: already committed receipts stay valid.
   IF f."operatingLedgerEffectiveDateAtRegistration" IS NULL AND proxy_count=0
     AND NOT EXISTS(SELECT 1 FROM public."OperatingFact" WHERE "sourceType"='payment_execution' AND "sourceBusinessId"=execution_id) THEN RETURN; END IF;
   IF proxy_count <> 1 THEN RAISE EXCEPTION 'registered projected cross-company payment requires exactly one proxy impact'; END IF;
   SELECT * INTO STRICT fact FROM public."OperatingFact" WHERE "sourceType" = 'payment_execution' AND "sourceBusinessId" = execution_id;
   IF NOT coalesce(fact."projectId" = request."projectId" AND fact."sourceVersion" = 1 AND fact."entryKind" = 'original'
     AND fact."status" = 'confirmed' AND fact."factKind" = 'downstream_payment' AND fact."operatingLevel" = 'inter_subject'
     AND fact."amountCents" = e."amountCents" AND fact."currencyCode" = 'CNY' AND fact."direction" = 'outflow'
     AND fact."idempotencyKey" = 'payment_execution:' || execution_id
     AND fact."debtorSubjectKind" = 'participating_company' AND fact."debtorSubjectId" = e."companyEntityIdSnapshot"
     AND fact."approvedPayerSubjectKind" = 'participating_company' AND fact."approvedPayerSubjectId" = e."companyEntityIdSnapshot"
     AND fact."actualPayerSubjectKind" = 'participating_company' AND fact."actualPayerSubjectId" = f."actualPayerId",FALSE) THEN
     RAISE EXCEPTION 'registered debt root requires its exact frozen canonical A/B payment fact';
   END IF;
   SELECT * INTO STRICT proxy FROM public."OperatingImpactEntry" WHERE "sourceType" = 'payment_execution' AND "sourceBusinessId" = execution_id
     AND ("impactKind" = 'inter_subject_balance_increase' OR "sourceImpactKey" = 'inter_subject_proxy_payment' OR "idempotencyKey" = 'payment_execution:' || execution_id || ':proxy');
   IF NOT coalesce(proxy."factId" = fact."id" AND proxy."projectId" = request."projectId"
     AND proxy."sourceImpactKey" = 'inter_subject_proxy_payment' AND proxy."impactKind" = 'inter_subject_balance_increase'
     AND proxy."idempotencyKey" = 'payment_execution:' || execution_id || ':proxy'
     AND proxy."amountCents" = e."amountCents" AND proxy."direction" = 'increase'
     AND proxy."subjectRole" = 'actual_payer' AND proxy."subjectKind" = 'participating_company' AND proxy."subjectId" = f."actualPayerId"
     AND proxy."impactSnapshot"->'debtor' = pg_catalog.jsonb_build_object('kind','participating_company','id',e."companyEntityIdSnapshot")
     AND proxy."impactSnapshot"->'approvedPayer' = pg_catalog.jsonb_build_object('kind','participating_company','id',e."companyEntityIdSnapshot")
     AND proxy."impactSnapshot"->'actualPayer' = pg_catalog.jsonb_build_object('kind','participating_company','id',f."actualPayerId"),FALSE) THEN
     RAISE EXCEPTION 'registered cross-company proxy impact must match the one frozen debt root';
   END IF;
 ELSIF root_count <> 0 OR proxy_count <> 0 THEN
   RAISE EXCEPTION 'same-company or public-cash payment cannot create an intercompany debt root or proxy impact';
 END IF;
END $$;
CREATE UNIQUE INDEX "InterEntityRelationshipEntry_registered_payment_root_key"
 ON public."InterEntityRelationshipEntry"("paymentExecutionId") WHERE "sourceType" = 'registered_payment_execution' AND "entryKind" = 'proxy_payment';

-- Exact INSERT-only branch; all UPDATE/DELETE/legacy/return logic stays in the
-- current original function. Each independently installed guard rechecks the
-- complete closed root proof; a sourceType label alone cannot pass any of them.
-- Returns with a non-NULL real voucher remain in the original legacy guards;
-- they never use the pending-evidence root exception or skip reserved capacity.
DO $$
DECLARE function_name TEXT; body TEXT; first_begin INTEGER;
BEGIN
 FOREACH function_name IN ARRAY ARRAY['guard_inter_entity_relationship_entry','guard_inter_entity_relationship_source_snapshot','guard_inter_entity_relationship_proxy_authorization'] LOOP
   SELECT pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(pg_catalog.format('public.%I()',function_name))) INTO body;
   IF body IS NULL OR position('inter_entity_relationship_' IN body) = 0 THEN RAISE EXCEPTION 'task16 relationship predecessor drifted'; END IF;
   first_begin := position(E'BEGIN\n' IN body);
   IF first_begin = 0 THEN RAISE EXCEPTION 'task16 relationship function shape drifted'; END IF;
   body := overlay(body placing E'BEGIN\n  IF TG_OP = ''INSERT'' AND NEW."sourceType" = ''registered_payment_execution'' AND NEW."entryKind" = ''proxy_payment'' THEN\n    PERFORM public."jg_assert_registered_payment_relationship"(NEW);\n    RETURN NEW;\n  END IF;\n' FROM first_begin FOR pg_catalog.length(E'BEGIN\n'));
   EXECUTE body;
   EXECUTE pg_catalog.format('ALTER FUNCTION public.%I() SET search_path TO pg_catalog, public, pg_temp',function_name);
 END LOOP;
END $$;

ALTER TABLE public."InterEntityRelationshipEntry" ALTER COLUMN "evidenceFileId" DROP NOT NULL;
DO $$
DECLARE constraint_name TEXT; definition TEXT; closed_shape TEXT; is_valid BOOLEAN;
BEGIN
 closed_shape := 'coalesce("sourceType" = ''registered_payment_execution'' AND "sourceAggregateId" = "paymentExecutionId" AND "paymentExecutionId" IS NOT NULL AND "entryKind" = ''proxy_payment'' AND "direction" = ''increase'' AND "status" = ''confirmed'' AND "adjustsEntryId" IS NULL AND "settlementCaseId" IS NULL AND "fundExecutionId" IS NULL AND "fundExecutionCaseId" IS NULL AND "executionAllocationLineId" IS NULL AND "evidenceFileId" IS NULL AND "sourceAllocationCount" = 1 AND "sourceAllocationAmountCents" = "amountCents" AND "confirmedByUserId" IS NOT NULL AND "confirmedAt" IS NOT NULL,FALSE)';
 FOREACH constraint_name IN ARRAY ARRAY['InterEntityRelationshipEntry_reference_check','InterEntityRelationshipEntry_shape_check','InterEntityRelationshipEntry_payer_attestation_check','InterEntityRelationshipEntry_return_evidence_claim_check','InterEntityRelationshipEntry_source_snapshot_shape_check'] LOOP
   SELECT pg_catalog.pg_get_expr(conbin,conrelid),convalidated INTO STRICT definition,is_valid FROM pg_catalog.pg_constraint WHERE conrelid = 'public."InterEntityRelationshipEntry"'::regclass AND conname = constraint_name AND contype = 'c';
   EXECUTE pg_catalog.format('ALTER TABLE public."InterEntityRelationshipEntry" DROP CONSTRAINT %I, ADD CONSTRAINT %I CHECK (((("sourceType" IS DISTINCT FROM ''registered_payment_execution'' OR "entryKind" <> ''proxy_payment'') AND "evidenceFileId" IS NOT NULL) AND (%s)) OR (%s))%s',constraint_name,constraint_name,definition,closed_shape,CASE WHEN is_valid THEN '' ELSE ' NOT VALID' END);
 END LOOP;
END $$;

CREATE FUNCTION public."jg_registered_payment_relationship_deferred"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW."sourceType" = 'registered_payment_execution' AND NEW."entryKind" = 'proxy_payment' THEN
   PERFORM public."jg_assert_registered_payment_relationship"(NEW);
   IF EXISTS(SELECT 1 FROM public."PaymentExecutionWagePayableBinding" WHERE "paymentExecutionId" = NEW."paymentExecutionId") THEN
     RAISE EXCEPTION 'registered company payment cannot bypass canonical wage allocation authority';
   END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "InterEntityRelationshipEntry_registered_payment_lineage" AFTER INSERT ON public."InterEntityRelationshipEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_relationship_deferred"();
-- Existing wage settlement lineage receives NULL settlementCaseId for this
-- mutually exclusive root and returns before legacy calculations. Its function
-- and all v7 shared-bank manifests, proxy returns and transfer reservations are
-- deliberately not replaced; registered roots get the independent proof above.
-- STILL REQUIRED before promotion: source/case-derived PG negative inventory,
-- static composition review against the full final migration chain, plus exact
-- runtime proof after separately authorized migrations. No SQL has been run.
