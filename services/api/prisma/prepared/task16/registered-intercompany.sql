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
 root public."InterEntityRelationshipEntry"; fact public."OperatingFact"; effect public."OperatingImpactEntry";
 frozen_source_type TEXT; cross_company BOOLEAN; root_count BIGINT; fact_count BIGINT; impact_count BIGINT;
 due_count BIGINT; due_total NUMERIC; expected_payables JSONB; snapshot_payables JSONB; expected_payable_count BIGINT;
 payable_count BIGINT := 0; funds_count BIGINT := 0; proxy_count BIGINT := 0; source_id TEXT; funds_kind TEXT;
BEGIN
 SELECT * INTO STRICT e FROM public."PaymentExecution" WHERE "id" = execution_id;
 SELECT * INTO STRICT f FROM public."RegisteredPaymentFunding" WHERE "executionId" = execution_id;
 SELECT * INTO STRICT request FROM public."PaymentRequest" WHERE "id" = e."paymentRequestId";
 SELECT event."payload"->'writeAuthority'->>'sourceType' INTO STRICT frozen_source_type
 FROM public."RegisteredPaymentEvent" event WHERE event."executionId"=execution_id;
 IF frozen_source_type NOT IN ('settlement','contract_due','contract_advance') OR frozen_source_type IS NULL THEN
   RAISE EXCEPTION 'registered payment requires its frozen source applicability';
 END IF;
 cross_company := f."actualPayerKind"='participating_company' AND f."actualPayerId"<>e."companyEntityIdSnapshot";
 SELECT pg_catalog.count(*) INTO root_count FROM public."InterEntityRelationshipEntry"
 WHERE "paymentExecutionId"=execution_id AND "entryKind"='proxy_payment' AND "direction"='increase';
 IF cross_company THEN
   IF root_count<>1 THEN RAISE EXCEPTION 'registered cross-company payment requires exactly one debt root'; END IF;
   SELECT * INTO STRICT root FROM public."InterEntityRelationshipEntry"
   WHERE "paymentExecutionId"=execution_id AND "entryKind"='proxy_payment' AND "direction"='increase';
   PERFORM public."jg_assert_registered_payment_relationship"(root);
 ELSIF root_count<>0 THEN
   RAISE EXCEPTION 'same-company or public-cash payment cannot create an intercompany debt root';
 END IF;
 -- Adapter's payable basis is immutable Execution.settlementId plus positive
 -- immutable due-payment allocation rows, never a guessed zero or future request.
 SELECT pg_catalog.count(*),coalesce(pg_catalog.sum(a."amountCents"),0) INTO due_count,due_total
 FROM public."PaymentExecutionAllocation" a WHERE a."paymentExecutionId"=execution_id AND a."allocationType"='contract_due_payment';
 IF EXISTS(SELECT 1 FROM public."PaymentExecutionAllocation" a WHERE a."paymentExecutionId"=execution_id AND a."allocationType"='contract_due_payment'
   AND (a."paymentRequestId"<>e."paymentRequestId" OR a."projectId"<>request."projectId" OR a."contractId"<>request."contractId"
        OR a."amountCents"<=0 OR coalesce(pg_catalog.length(pg_catalog.btrim(coalesce(a."settlementId",a."sourceRowId"))),0)=0)) THEN
   RAISE EXCEPTION 'registered due allocation must belong to its frozen payment source';
 END IF;
 IF frozen_source_type='contract_due' AND e."settlementId" IS NULL THEN
   IF due_count=0 OR due_total<>e."amountCents" THEN RAISE EXCEPTION 'registered contract-due payment requires its full immutable payable allocation basis'; END IF;
 ELSIF due_count<>0 THEN
   RAISE EXCEPTION 'registered payment cannot add a due allocation outside its application source path';
 END IF;
 SELECT coalesce(pg_catalog.jsonb_object_agg(grouped.source_id,grouped.amount::TEXT),'{}'::JSONB) INTO expected_payables
 FROM (SELECT pg_catalog.btrim(coalesce(a."settlementId",a."sourceRowId")) AS source_id,pg_catalog.sum(a."amountCents") AS amount
       FROM public."PaymentExecutionAllocation" a WHERE a."paymentExecutionId"=execution_id AND a."allocationType"='contract_due_payment'
       GROUP BY pg_catalog.btrim(coalesce(a."settlementId",a."sourceRowId"))) grouped;
 IF due_count=0 AND e."settlementId" IS NOT NULL THEN
   IF pg_catalog.length(pg_catalog.btrim(e."settlementId"))=0 THEN RAISE EXCEPTION 'registered settlement source is empty'; END IF;
   expected_payables:=pg_catalog.jsonb_build_object(pg_catalog.btrim(e."settlementId"),e."amountCents"::TEXT);
 END IF;
 SELECT pg_catalog.count(*) INTO fact_count FROM public."OperatingFact" WHERE "sourceType"='payment_execution' AND "sourceBusinessId"=execution_id;
 SELECT pg_catalog.count(*) INTO impact_count FROM public."OperatingImpactEntry" WHERE "sourceType"='payment_execution' AND "sourceBusinessId"=execution_id;
 -- NULL frozen scope permits no projection at all. Once any projection exists,
 -- including a later legitimate append, it must be the complete same graph.
 IF f."operatingLedgerEffectiveDateAtRegistration" IS NULL AND fact_count=0 AND impact_count=0 THEN RETURN; END IF;
 IF fact_count<>1 THEN RAISE EXCEPTION 'registered projected payment requires exactly one canonical fact'; END IF;
 SELECT * INTO STRICT fact FROM public."OperatingFact" WHERE "sourceType"='payment_execution' AND "sourceBusinessId"=execution_id;
 IF NOT coalesce(fact."projectId"=request."projectId" AND fact."sourceVersion"=1 AND fact."entryKind"='original' AND fact."status"='confirmed'
   AND fact."factKind"='downstream_payment' AND fact."operatingLevel"=CASE WHEN cross_company THEN 'inter_subject' ELSE 'project' END
   AND fact."amountCents"=e."amountCents" AND fact."currencyCode"='CNY' AND fact."direction"='outflow' AND fact."evidenceLevel"='A'
   AND fact."occurredAt"=e."paidAt" AND fact."confirmedAt"=e."createdAt" AND fact."confirmedByUserId"=e."executedByUserId" AND fact."recordedByUserId"=e."executedByUserId"
   AND fact."idempotencyKey"='payment_execution:'||execution_id
   AND fact."debtorSubjectKind"='participating_company' AND fact."debtorSubjectId"=e."companyEntityIdSnapshot"
   AND fact."approvedPayerSubjectKind"='participating_company' AND fact."approvedPayerSubjectId"=e."companyEntityIdSnapshot"
   AND fact."actualPayerSubjectKind"=f."actualPayerKind" AND fact."actualPayerSubjectId"=f."actualPayerId"
   AND fact."payeeSubjectKind"='downstream_counterparty' AND pg_catalog.length(pg_catalog.btrim(fact."payeeSubjectId"))>0
   AND fact."sourceSnapshot"->>'payeeVersionId'=fact."payeeSubjectId"
   AND fact."sourceSnapshot"->>'paymentSourceType'=frozen_source_type
   AND fact."sourceSnapshot"->'settlementId'=coalesce(pg_catalog.to_jsonb(e."settlementId"),'null'::JSONB)
   AND (f."operatingLedgerEffectiveDateAtRegistration" IS NULL OR fact."operatingLedgerEffectiveDateSnapshot"=f."operatingLedgerEffectiveDateAtRegistration")
   AND public."jg_registered_payment_source_matches"(execution_id,request."projectId",e."amountCents",f."actualPayerKind",f."actualPayerId"),FALSE) THEN
   RAISE EXCEPTION 'registered canonical fact must match its exact frozen payment subjects and applicability';
 END IF;
 IF pg_catalog.jsonb_typeof(fact."sourceSnapshot"->'payableAllocations') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'registered canonical fact requires its payable source set'; END IF;
 IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(fact."sourceSnapshot"->'payableAllocations') item
   WHERE pg_catalog.jsonb_typeof(item) IS DISTINCT FROM 'object' OR pg_catalog.jsonb_typeof(item->'sourceId') IS DISTINCT FROM 'string'
     OR coalesce(pg_catalog.length(pg_catalog.btrim(item->>'sourceId')),0)=0 OR pg_catalog.jsonb_typeof(item->'amountCents') IS DISTINCT FROM 'string'
     OR NOT coalesce(item->>'amountCents' ~ '^[1-9][0-9]*$',FALSE)) THEN RAISE EXCEPTION 'registered canonical payable source is invalid'; END IF;
 SELECT coalesce(pg_catalog.jsonb_object_agg(grouped.source_id,grouped.amount::TEXT),'{}'::JSONB) INTO snapshot_payables
 FROM (SELECT pg_catalog.btrim(item->>'sourceId') AS source_id,pg_catalog.sum((item->>'amountCents')::NUMERIC) AS amount
       FROM pg_catalog.jsonb_array_elements(fact."sourceSnapshot"->'payableAllocations') item GROUP BY pg_catalog.btrim(item->>'sourceId')) grouped;
 IF snapshot_payables<>expected_payables THEN RAISE EXCEPTION 'registered canonical payable snapshot must match its immutable execution allocations'; END IF;
 funds_kind:=CASE WHEN f."actualPayerKind"='public_cash' THEN 'public_cash_funds_decrease' ELSE 'company_project_funds_decrease' END;
 FOR effect IN SELECT * FROM public."OperatingImpactEntry" WHERE "sourceType"='payment_execution' AND "sourceBusinessId"=execution_id LOOP
   IF effect."factId"<>fact."id" OR effect."projectId"<>fact."projectId" THEN RAISE EXCEPTION 'registered impact must belong to its one canonical fact'; END IF;
   IF effect."sourceImpactKey" LIKE 'payable:%' THEN
     source_id:=pg_catalog.substr(effect."sourceImpactKey",9);
     IF NOT coalesce(expected_payables ? source_id AND effect."impactKind"='payable_decrease' AND effect."direction"='decrease'
       AND effect."idempotencyKey"='payment_execution:'||execution_id||':payable:'||source_id
       AND effect."amountCents"=(expected_payables->>source_id)::BIGINT AND effect."subjectRole"='payee'
       AND effect."subjectKind"=fact."payeeSubjectKind" AND effect."subjectId"=fact."payeeSubjectId",FALSE) THEN
       RAISE EXCEPTION 'registered payable impact must match its exact immutable allocation and frozen fact payee'; END IF;
     payable_count:=payable_count+1;
   ELSIF effect."sourceImpactKey"=funds_kind THEN
     IF NOT coalesce(f."openingTreatment"='not_included' AND effect."impactKind"=funds_kind AND effect."direction"='decrease'
       AND effect."idempotencyKey"='payment_execution:'||execution_id||':funds' AND effect."amountCents"=e."amountCents"
       AND effect."subjectRole"='actual_payer' AND effect."subjectKind"=f."actualPayerKind" AND effect."subjectId"=f."actualPayerId",FALSE) THEN
       RAISE EXCEPTION 'registered funds impact must match the unpaid-in-opening frozen actual payer'; END IF;
     funds_count:=funds_count+1;
   ELSIF effect."sourceImpactKey"='inter_subject_proxy_payment' THEN
     IF NOT coalesce(cross_company AND effect."impactKind"='inter_subject_balance_increase' AND effect."direction"='increase'
       AND effect."idempotencyKey"='payment_execution:'||execution_id||':proxy' AND effect."amountCents"=e."amountCents"
       AND effect."subjectRole"='actual_payer' AND effect."subjectKind"='participating_company' AND effect."subjectId"=f."actualPayerId"
       AND effect."impactSnapshot"->'debtor'=pg_catalog.jsonb_build_object('kind','participating_company','id',e."companyEntityIdSnapshot")
       AND effect."impactSnapshot"->'approvedPayer'=pg_catalog.jsonb_build_object('kind','participating_company','id',e."companyEntityIdSnapshot")
       AND effect."impactSnapshot"->'actualPayer'=pg_catalog.jsonb_build_object('kind','participating_company','id',f."actualPayerId"),FALSE) THEN
       RAISE EXCEPTION 'registered proxy impact must match its one frozen debt root'; END IF;
     proxy_count:=proxy_count+1;
   ELSE RAISE EXCEPTION 'registered canonical graph cannot contain an extra unrecognized impact'; END IF;
 END LOOP;
 SELECT pg_catalog.count(*) INTO expected_payable_count FROM pg_catalog.jsonb_object_keys(expected_payables);
 IF payable_count<>expected_payable_count OR funds_count<>(CASE WHEN f."openingTreatment"='not_included' THEN 1 ELSE 0 END)
   OR proxy_count<>(CASE WHEN cross_company THEN 1 ELSE 0 END) THEN
   RAISE EXCEPTION 'registered canonical graph is missing an applicable payable, funds or proxy consequence';
 END IF;
END $$;
-- Existing UPDATE/DELETE immutable allocation guard is retained. This INSERT
-- hook prevents later source rows changing a committed canonical payable set.
CREATE FUNCTION public."jg_registered_payment_allocation_deferred"() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public."RegisteredPaymentFunding" f WHERE f."executionId"=NEW."paymentExecutionId") THEN
   PERFORM public."jg_assert_registered_payment_intercompany_complete"(NEW."paymentExecutionId");
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "PaymentExecutionAllocation_registered_payment_complete"
 AFTER INSERT ON public."PaymentExecutionAllocation" DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW WHEN (NEW."allocationType"='contract_due_payment')
 EXECUTE FUNCTION public."jg_registered_payment_allocation_deferred"();
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
