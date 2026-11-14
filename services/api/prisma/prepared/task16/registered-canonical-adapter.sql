-- PREPARED WIP only, executed=false. Compose after funding and proof helpers.
-- Keep every current POL224/POL284/v7/20261020 function clause; patch anchors
-- fail closed instead of reinstalling a historical complete function body.
CREATE FUNCTION public."jg_registered_payment_fact_guard"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE f public."RegisteredPaymentFunding"; e public."PaymentExecution";
BEGIN
 IF coalesce(NEW."debtorSubjectKind" = 'public_cash',FALSE) OR coalesce(NEW."creditorSubjectKind" = 'public_cash',FALSE)
    OR coalesce(NEW."approvedPayerSubjectKind" = 'public_cash',FALSE) OR coalesce(NEW."payeeSubjectKind" = 'public_cash',FALSE)
    OR coalesce(NEW."costBearingCompanySubjectKind" = 'public_cash',FALSE) THEN
   RAISE EXCEPTION 'public cash is only the canonical actual payer, never another company role';
 END IF;
 IF NEW."sourceType" = 'payment_execution' THEN
   SELECT * INTO f FROM public."RegisteredPaymentFunding" WHERE "executionId" = NEW."sourceBusinessId";
 END IF;
 IF f."executionId" IS NOT NULL OR NEW."actualPayerSubjectKind" = 'public_cash' THEN
   SELECT * INTO e FROM public."PaymentExecution" WHERE "id" = f."executionId";
   IF NOT coalesce(NEW."sourceType" = 'payment_execution' AND NEW."sourceVersion" = 1
      AND NEW."factKind" = 'downstream_payment' AND NEW."entryKind" = 'original' AND NEW."direction" = 'outflow'
      AND NEW."currencyCode" = 'CNY' AND NEW."evidenceLevel" = 'A'
      AND NEW."operatingLevel" = CASE WHEN f."actualPayerKind" = 'public_cash' OR f."actualPayerId" = e."companyEntityIdSnapshot" THEN 'project' ELSE 'inter_subject' END
      AND NEW."occurredAt" = e."paidAt" AND NEW."confirmedAt" = e."createdAt"
      AND NEW."confirmedByUserId" = e."executedByUserId" AND NEW."recordedByUserId" = e."executedByUserId"
      AND NEW."sourceSnapshot"->>'paymentRequestId' = e."paymentRequestId" AND NEW."sourceSnapshot"->>'amountCents' = e."amountCents"::TEXT
      AND NEW."sourceSnapshot"->>'actualPayerId' = f."actualPayerId"
      AND NEW."sourceSnapshot"->>'actualPayerType' = CASE WHEN f."actualPayerKind" = 'public_cash' THEN 'public_cash' ELSE 'our_company' END
      AND NEW."basisSnapshot"->>'authority' = 'registered_payment_execution'
      AND NEW."basisSnapshot"->>'voucherPending' = 'true' AND NEW."basisSnapshot"->'voucherFileId' = 'null'::JSONB AND e."voucherFileId" IS NULL
      AND NEW."idempotencyKey" = 'payment_execution:' || NEW."sourceBusinessId"
      AND public."jg_registered_payment_source_matches"(NEW."sourceBusinessId",NEW."projectId",NEW."amountCents",NEW."actualPayerSubjectKind",NEW."actualPayerSubjectId")
      AND NEW."sourceSnapshot"->'registeredFunding'->>'accountId' = f."accountId"
      AND NEW."sourceSnapshot"->'registeredFunding'->>'balanceRegistrationId' = f."balanceRegistrationId"
      AND NEW."sourceSnapshot"->'registeredFunding'->>'openingTreatment' = f."openingTreatment"
      AND NEW."sourceSnapshot"->'registeredFunding'->'actualPayerSnapshot' = f."actualPayerSnapshot",FALSE) THEN
     RAISE EXCEPTION 'registered canonical fact must freeze this exact payment, source and payer';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "OperatingFact_registered_payment" BEFORE INSERT ON public."OperatingFact" FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_fact_guard"();

CREATE FUNCTION public."jg_registered_payment_cash_impact_guard"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW."subjectKind" = 'public_cash' OR NEW."impactKind" = 'public_cash_funds_decrease' THEN
   IF NOT coalesce(NEW."subjectRole" = 'actual_payer' AND NEW."subjectKind" = 'public_cash'
       AND NEW."sourceType" = 'payment_execution'
       AND public."jg_registered_payment_impact_matches"(NEW."sourceBusinessId",NEW."projectId",NEW."amountCents",NEW."subjectKind",NEW."subjectId",NEW."impactKind",NEW."sourceImpactKey",NEW."direction",NEW."idempotencyKey"),FALSE) THEN
     RAISE EXCEPTION 'public cash impact must be the exact canonical registered source posting';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "OperatingImpactEntry_registered_cash" BEFORE INSERT ON public."OperatingImpactEntry" FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_cash_impact_guard"();

DO $$
DECLARE body TEXT; anchor TEXT; replacement TEXT; constraint_name TEXT; definition TEXT; is_valid BOOLEAN;
BEGIN
 SELECT pg_catalog.pg_get_functiondef('public."validateOperatingFactReferences"()'::regprocedure) INTO body;
 anchor := 'candidate_subject->>''kind'' NOT IN (''owner'', ''construction_enterprise'', ''participating_company'', ''downstream_counterparty'', ''employee'')';
 IF position(anchor IN body) = 0 THEN RAISE EXCEPTION 'task16 fact subject predecessor drifted'; END IF;
 EXECUTE replace(body,anchor,replace(anchor,'''employee''','''employee'', ''public_cash'''));

 SELECT pg_catalog.pg_get_functiondef('public."validateOperatingImpactEntryReferences"()'::regprocedure) INTO body;
 IF position('jg_company_repayment_ownership_date' IN body) = 0 OR position('fact_source_type = ''fund_execution''' IN body) = 0 OR position('经营影响累计冲销金额超过原分录' IN body) = 0 THEN
   RAISE EXCEPTION 'task16 impact terminal semantics drifted';
 END IF;
 anchor := 'IF NOT FOUND THEN
      RAISE EXCEPTION ''影响分录引用的我方公司未在本项目事实日参与''';
 replacement := 'IF NOT FOUND AND NOT coalesce(NEW."sourceType" = ''payment_execution'' AND NEW."subjectRole" = ''actual_payer'' AND public."jg_registered_payment_impact_matches"(NEW."sourceBusinessId",NEW."projectId",NEW."amountCents",NEW."subjectKind",NEW."subjectId",NEW."impactKind",NEW."sourceImpactKey",NEW."direction",NEW."idempotencyKey"),FALSE) THEN
      RAISE EXCEPTION ''影响分录引用的我方公司未在本项目事实日参与''';
 IF position(anchor IN body) = 0 THEN RAISE EXCEPTION 'task16 impact participant anchor drifted'; END IF;
 body := replace(body,anchor,replacement);
 anchor := '''downstream_counterparty'', ''employee''
     ) THEN';
 IF position(anchor IN body) = 0 THEN RAISE EXCEPTION 'task16 impact subject anchor drifted'; END IF;
 EXECUTE replace(body,anchor,'''downstream_counterparty'', ''employee'', ''public_cash''
     ) THEN');

 -- Normalize only the actual-payer whitelist comparison, never its separate
 -- kind/id NULL-pair shape check or any other role. IN deparses as = ANY on PG16.
 FOREACH constraint_name IN ARRAY ARRAY['OperatingFact_subject_kind_check','OperatingFact_supported_subject_check'] LOOP
   SELECT pg_catalog.pg_get_constraintdef(oid) INTO STRICT definition FROM pg_catalog.pg_constraint WHERE conrelid = 'public."OperatingFact"'::regclass AND conname = constraint_name;
   IF position('"actualPayerSubjectKind" = ANY' IN definition) = 0 THEN RAISE EXCEPTION 'task16 fact constraint predecessor drifted'; END IF;
   definition := replace(definition,'"actualPayerSubjectKind" = ANY','NULLIF("actualPayerSubjectKind", ''public_cash'') = ANY');
   EXECUTE pg_catalog.format('ALTER TABLE public."OperatingFact" DROP CONSTRAINT %I, ADD CONSTRAINT %I %s',constraint_name,constraint_name,definition);
 END LOOP;
 FOREACH constraint_name IN ARRAY ARRAY['OperatingImpactEntry_subject_check','OperatingImpactEntry_supported_subject_check','OperatingImpactEntry_impact_kind_check'] LOOP
   SELECT pg_catalog.pg_get_expr(conbin,conrelid),convalidated INTO STRICT definition,is_valid FROM pg_catalog.pg_constraint WHERE conrelid = 'public."OperatingImpactEntry"'::regclass AND conname = constraint_name AND contype = 'c';
   -- Preserve the complete expression and validation state, adding only the
   -- closed cash branch checked again by the canonical identity trigger.
   EXECUTE pg_catalog.format('ALTER TABLE public."OperatingImpactEntry" DROP CONSTRAINT %I, ADD CONSTRAINT %I CHECK ((%s) OR ("subjectKind" = ''public_cash'' AND "subjectRole" = ''actual_payer'' AND "subjectId" = ''public_cash'' AND "impactKind" = ''public_cash_funds_decrease''))%s',constraint_name,constraint_name,definition,CASE WHEN is_valid THEN '' ELSE ' NOT VALID' END);
 END LOOP;
END $$;
-- The mutually exclusive InterEntity root is in registered-intercompany.sql.
-- Full-chain static review and real-PG behavior remain unverified before promotion.

-- Runtime resolution for only the legacy authority functions patched above.
ALTER FUNCTION public."validateOperatingFactReferences"() SET search_path TO pg_catalog, public, pg_temp;
ALTER FUNCTION public."validateOperatingImpactEntryReferences"() SET search_path TO pg_catalog, public, pg_temp;


-- SOURCE_ONLY_NOT_EXECUTED: later legitimate projection of a formerly
-- unenabled payment must queue whole-graph validation in its own transaction.
-- These INSERT-only hooks do not rewrite legacy immutable/reversal rules.
CREATE FUNCTION public."jg_registered_payment_projection_deferred"()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NEW."sourceType" = 'payment_execution' AND EXISTS (
   SELECT 1 FROM public."RegisteredPaymentFunding" funding WHERE funding."executionId" = NEW."sourceBusinessId"
 ) THEN
   -- Permanent graph proof only: never re-run current actor/round/history/date
   -- or the initial account CAS when a later projection is appended.
   PERFORM public."jg_assert_registered_payment_intercompany_complete"(NEW."sourceBusinessId");
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "OperatingFact_registered_payment_complete"
 AFTER INSERT ON public."OperatingFact" DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW WHEN (NEW."sourceType" = 'payment_execution')
 EXECUTE FUNCTION public."jg_registered_payment_projection_deferred"();
CREATE CONSTRAINT TRIGGER "OperatingImpactEntry_registered_payment_complete"
 AFTER INSERT ON public."OperatingImpactEntry" DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW WHEN (NEW."sourceType" = 'payment_execution')
 EXECUTE FUNCTION public."jg_registered_payment_projection_deferred"();
