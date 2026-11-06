-- SOURCE_ONLY_NOT_EXECUTED: revision/NOWAIT composition is source-ready only.
-- Complete native/hash/ACL/lock/trigger/COMMIT behavior is unproven; not promotable.
-- SOURCE_ONLY_NOT_EXECUTED. Not a migration; no PG syntax/lock/COMMIT proof.
-- Compose after registered-funding.sql and before permanent canonical helpers.
-- Reproduce the server's fixed JSON.stringify field order, not JSONB display
-- order. public.digest already exists in the governed migration chain.
-- Native-type overloads: timestamp is Prisma's UTC wall-clock storage;
-- timestamptz must first be projected to UTC. Never depend on session TimeZone.
CREATE FUNCTION public."jg_registered_timestamp_iso"(p_value TIMESTAMP WITHOUT TIME ZONE)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF NOT pg_catalog.isfinite(p_value) OR extract(year FROM p_value) NOT BETWEEN 1 AND 9999 THEN RAISE EXCEPTION 'registered payment timestamp is outside reviewed ISO encoding'; END IF;
 RETURN pg_catalog.to_char(p_value,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
END $$;
CREATE FUNCTION public."jg_registered_timestamp_iso"(p_value TIMESTAMP WITH TIME ZONE)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE utc_value TIMESTAMP WITHOUT TIME ZONE;
BEGIN
 IF NOT pg_catalog.isfinite(p_value) THEN RAISE EXCEPTION 'registered payment timestamp is outside reviewed ISO encoding'; END IF;
 utc_value:=p_value AT TIME ZONE 'UTC';
 IF extract(year FROM utc_value) NOT BETWEEN 1 AND 9999 THEN RAISE EXCEPTION 'registered payment timestamp is outside reviewed ISO encoding'; END IF;
 RETURN pg_catalog.to_char(utc_value,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
END $$;
-- The active Prisma schema uses DateTime defaults (timestamp(3), not tz) for
-- these columns. Fail if the installed predecessor differs; do not silently
-- choose a cast or claim an unverified deployment native type.
DO $$
DECLARE coordinate RECORD; native_type TEXT;
BEGIN
 FOR coordinate IN SELECT * FROM (VALUES ('ContractTakeover','updatedAt'),('ContractTakeover','historicalBalanceConfirmedAt'),('ContractTakeover','activatedAt'),('ApprovalInstance','createdAt'),('PaymentExecution','paidAt')) AS c(table_name,column_name) LOOP
   SELECT pg_catalog.format_type(a.atttypid,a.atttypmod) INTO native_type FROM pg_catalog.pg_attribute a
   WHERE a.attrelid=pg_catalog.to_regclass(pg_catalog.format('public.%I',coordinate.table_name)) AND a.attname=coordinate.column_name AND NOT a.attisdropped;
   IF native_type IS DISTINCT FROM 'timestamp(3) without time zone' THEN RAISE EXCEPTION 'task16 installed timestamp predecessor differs from reviewed Prisma schema'; END IF;
 END LOOP;
END $$;

CREATE FUNCTION public."jg_registered_contract_history_basis"(contract_id TEXT)
RETURNS JSONB LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 WITH records AS (
   SELECT t."id", t."historicalPaidCents" <> 0 OR t."historicalProxyPaidCents" <> 0 OR t."historicalAdvancePaidCents" <> 0 AS has_paid,
     '{"id":' || pg_catalog.to_json(t."id")::TEXT || ',"contractId":' || pg_catalog.to_json(t."contractId")::TEXT ||
     ',"contractVersionId":' || pg_catalog.to_json(t."contractVersionId")::TEXT || ',"paymentTermsVersionId":' || pg_catalog.to_json(t."paymentTermsVersionId")::TEXT ||
     ',"updatedAt":' || pg_catalog.to_json(public."jg_registered_timestamp_iso"(t."updatedAt"))::TEXT ||
     ',"confirmedAt":' || pg_catalog.to_json(public."jg_registered_timestamp_iso"(t."historicalBalanceConfirmedAt"))::TEXT ||
     ',"activatedAt":' || coalesce(pg_catalog.to_json(public."jg_registered_timestamp_iso"(t."activatedAt"))::TEXT,'null') ||
     ',"historicalPaidCents":' || pg_catalog.to_json(t."historicalPaidCents"::TEXT)::TEXT ||
     ',"historicalProxyPaidCents":' || pg_catalog.to_json(t."historicalProxyPaidCents"::TEXT)::TEXT ||
     ',"historicalAdvancePaidCents":' || pg_catalog.to_json(t."historicalAdvancePaidCents"::TEXT)::TEXT || '}' AS canonical
   FROM public."ContractTakeover" t WHERE t."contractId" = contract_id AND t."takeoverStatus" = 'confirmed' AND t."historicalBalanceConfirmedAt" IS NOT NULL
 ), revision_state AS (
   SELECT public."jg_registered_history_read_revision"(contract_id) AS value
 ), grouped AS (
   SELECT coalesce(pg_catalog.bool_or(has_paid),FALSE) AS required,
     '[' || coalesce(pg_catalog.string_agg(canonical,',' ORDER BY "id"),'') || ']' AS canonical_records FROM records
 )
 SELECT pg_catalog.jsonb_build_object('required',required,'revision',revision_state.value::TEXT,'records',canonical_records::JSONB,
   'fingerprint',pg_catalog.encode(public.digest(pg_catalog.convert_to('{"contractId":' || pg_catalog.to_json(contract_id)::TEXT || ',"revision":' || pg_catalog.to_json(revision_state.value::TEXT)::TEXT || ',"records":' || canonical_records || '}','UTF8'),'sha256'),'hex'))
 FROM grouped CROSS JOIN revision_state;
$$;

CREATE FUNCTION public."jg_registered_payment_history_insert"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE contract_id TEXT; basis JSONB; proof JSONB; revision_seen BIGINT;
BEGIN
 SELECT request."contractId" INTO STRICT contract_id FROM public."PaymentExecution" e JOIN public."PaymentRequest" request ON request."id" = e."paymentRequestId" WHERE e."id" = NEW."executionId";
 revision_seen := public."jg_registered_history_lock_revision"(contract_id);
 IF revision_seen IS NULL THEN RAISE EXCEPTION 'registered contract history marker is missing'; END IF;
 -- No history-row lock after marker: writers use NOWAIT and cannot wait here.
 basis := public."jg_registered_contract_history_basis"(contract_id);
 proof := NEW."contractHistoryConfirmation";
 IF (basis->>'required')::BOOLEAN OR proof IS NOT NULL THEN
   IF NOT coalesce(pg_catalog.jsonb_typeof(proof) = 'object' AND proof->>'treatment' = 'not_included'
      AND pg_catalog.jsonb_typeof(proof->'reason') = 'string' AND pg_catalog.jsonb_typeof(proof->'evidence') = 'string'
      AND pg_catalog.length(pg_catalog.btrim(proof->>'reason')) BETWEEN 1 AND 500 AND pg_catalog.length(pg_catalog.btrim(proof->>'evidence')) BETWEEN 1 AND 1000
      AND proof->'basis' = basis,FALSE) THEN
     RAISE EXCEPTION 'registered payment requires independent exact contract history confirmation';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "RegisteredPaymentFunding_history_authority" BEFORE INSERT ON public."RegisteredPaymentFunding" FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_history_insert"();

-- Current company-wide positions, matching CompanyRoleResolverService. This
-- never elevates a project-only position, technical identity, or delegate label.
CREATE FUNCTION public."jg_registered_payment_actor_current"(actor_id TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public."User" WHERE "id" = actor_id AND "isActive")
 AND EXISTS(SELECT 1 FROM public."UserPosition" assignment JOIN public."Position" pos ON pos."id" = assignment."positionId"
   WHERE assignment."userId" = actor_id AND assignment."projectId" IS NULL AND pos."key" IN ('finance_staff','finance_director','comprehensive_director'))
 AND NOT EXISTS(SELECT 1 FROM public."UserPosition" assignment LEFT JOIN public."Position" pos ON pos."id" = assignment."positionId"
   WHERE assignment."userId" = actor_id AND assignment."projectId" IS NULL AND
   (pos."id" IS NULL OR pos."key" NOT IN ('chairman','general_manager','engineering_department_director','finance_staff','finance_director','contract_director','contract_staff','budget_director','material_director','comprehensive_director','super_admin')));
$$;

CREATE FUNCTION public."jg_assert_registered_payment_write_authority"(execution_id TEXT, authority JSONB, before_update BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE e public."PaymentExecution"; request public."PaymentRequest"; version public."ContractVersion"; round public."ApprovalInstance";
 frozen_round JSONB; newest_time TIMESTAMP(3); newest_count BIGINT; marker_revision BIGINT; history_basis JSONB; history_confirmation JSONB; company public."CompanyEntity"; frozen_company public."CompanyEntityVersion"; payer_company_id TEXT; project_effective_date DATE; frozen_effective_date DATE;
BEGIN
 IF pg_catalog.current_setting('transaction_isolation') <> 'serializable' THEN RAISE EXCEPTION 'registered payment requires Serializable authority read-set'; END IF;
 SELECT * INTO STRICT e FROM public."PaymentExecution" WHERE "id" = execution_id;
 SELECT * INTO STRICT request FROM public."PaymentRequest" WHERE "id" = e."paymentRequestId" FOR UPDATE;
 SELECT scope."effectiveDate" INTO STRICT project_effective_date FROM public."jg_registered_operating_scope_lock"(request."projectId") scope;
 SELECT "operatingLedgerEffectiveDateAtRegistration" INTO STRICT frozen_effective_date FROM public."RegisteredPaymentFunding" WHERE "executionId"=execution_id;
 IF frozen_effective_date IS DISTINCT FROM project_effective_date THEN RAISE EXCEPTION 'registered project operating scope changed before commit'; END IF;
 SELECT * INTO STRICT version FROM public."ContractVersion" WHERE "id" = request."contractVersionId" FOR SHARE;
 marker_revision := public."jg_registered_history_lock_revision"(request."contractId");
 IF marker_revision IS NULL OR pg_catalog.jsonb_typeof(authority->'contractHistoryRevision') IS DISTINCT FROM 'string'
   OR authority->>'contractHistoryRevision' IS DISTINCT FROM marker_revision::TEXT THEN
   RAISE EXCEPTION 'registered payment event has a missing or stale complete history revision';
 END IF;
 history_basis := public."jg_registered_contract_history_basis"(request."contractId");
 SELECT "contractHistoryConfirmation" INTO history_confirmation FROM public."RegisteredPaymentFunding" WHERE "executionId" = execution_id;
 IF (history_basis->>'required')::BOOLEAN OR history_confirmation IS NOT NULL THEN
   IF NOT coalesce(history_confirmation->>'treatment' = 'not_included' AND history_confirmation->'basis' = history_basis
     AND pg_catalog.jsonb_typeof(history_confirmation->'reason') = 'string' AND pg_catalog.length(pg_catalog.btrim(history_confirmation->>'reason')) BETWEEN 1 AND 500
     AND pg_catalog.jsonb_typeof(history_confirmation->'evidence') = 'string' AND pg_catalog.length(pg_catalog.btrim(history_confirmation->>'evidence')) BETWEEN 1 AND 1000,FALSE) THEN
     RAISE EXCEPTION 'registered payment history set changed before commit';
   END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public."PaymentExecution" WHERE "id" = execution_id AND xmin::TEXT = (pg_catalog.txid_current() % 4294967296)::TEXT)
 OR request."paymentSubjectType" <> 'our_company' OR e."paymentSubjectType" <> 'our_company'
 OR request."sourceType" NOT IN ('settlement','contract_due','contract_advance') OR version."contractId" <> request."contractId"
 OR version."signingSubjectType" IS DISTINCT FROM 'our_company' OR NOT public."jg_registered_payment_actor_current"(e."executedByUserId")
 OR NOT EXISTS(SELECT 1 FROM public."Contract" contract WHERE contract."id" = request."contractId" AND contract."projectId" = request."projectId")
 OR e."companyEntityIdSnapshot" IS DISTINCT FROM version."companyEntityIdSnapshot"
 OR e."companyEntityNameSnapshot" IS DISTINCT FROM version."companyEntityNameSnapshot"
 OR e."companyEntityCreditCodeSnapshot" IS DISTINCT FROM version."companyEntityCreditCodeSnapshot"
 OR EXISTS(SELECT 1 FROM public."PaymentExecution" prior JOIN public."PaymentExecutionWagePayableBinding" wage ON wage."paymentExecutionId" = prior."id" WHERE prior."paymentRequestId" = request."id")
 OR EXISTS(SELECT 1 FROM public."PaymentExecution" prior JOIN public."HistoricalWageSummaryPaymentExecutionLink" wage ON wage."paymentExecutionId" = prior."id" WHERE prior."paymentRequestId" = request."id")
 THEN RAISE EXCEPTION 'registered payment current domain or actor authority is invalid'; END IF;
 IF before_update AND request."status" NOT IN ('approved_pending_payment','partially_paid') THEN RAISE EXCEPTION 'registered payment request is not awaiting execution'; END IF;
 PERFORM 1 FROM public."User" WHERE "id" = e."executedByUserId" FOR SHARE;
 PERFORM 1 FROM public."UserPosition" WHERE "userId" = e."executedByUserId" AND "projectId" IS NULL ORDER BY "id" FOR SHARE;
 SELECT pg_catalog.max("createdAt") INTO newest_time FROM public."ApprovalInstance" WHERE "businessType" = 'payment_request' AND "businessId" = request."id" AND "flowType" = 'payment.approve';
 SELECT pg_catalog.count(*) INTO newest_count FROM public."ApprovalInstance" WHERE "businessType" = 'payment_request' AND "businessId" = request."id" AND "flowType" = 'payment.approve' AND "createdAt" = newest_time;
 IF newest_count <> 1 THEN RAISE EXCEPTION 'registered payment latest approval round is missing or ambiguous'; END IF;
 SELECT * INTO STRICT round FROM public."ApprovalInstance" WHERE "businessType" = 'payment_request' AND "businessId" = request."id" AND "flowType" = 'payment.approve' AND "createdAt" = newest_time FOR SHARE;
 frozen_round := pg_catalog.jsonb_build_object('id',round."id",'businessType',round."businessType",'businessId',round."businessId",'flowType',round."flowType",'status',round."status",'createdAt',public."jg_registered_timestamp_iso"(round."createdAt"));
 IF round."status" <> 'approved' OR NOT coalesce(pg_catalog.jsonb_typeof(authority) = 'object' AND authority->'schemaVersion' = '1'::JSONB
   AND authority->>'paymentRequestId' = request."id" AND authority->>'projectId' = request."projectId"
   AND authority->>'contractId' = request."contractId" AND authority->>'contractVersionId' = version."id"
   AND authority->>'sourceType' = request."sourceType" AND authority->>'paymentSubjectType' = 'our_company'
   AND authority->>'signingSubjectType' = 'our_company' AND authority->'approvalRound' = frozen_round
   AND authority->>'requestStatusBeforeExecution' IN ('approved_pending_payment','partially_paid'),FALSE)
 THEN RAISE EXCEPTION 'registered payment event cannot self-assert approval or domain coordinates'; END IF;
 IF before_update AND authority->>'requestStatusBeforeExecution' IS DISTINCT FROM request."status" THEN RAISE EXCEPTION 'registered payment event has a different original status'; END IF;
 IF NOT coalesce(pg_catalog.jsonb_typeof(authority->'paidAmountBeforeExecution') = 'string' AND pg_catalog.jsonb_typeof(authority->'approvedAmountCents') = 'string'
   AND authority->>'paidAmountBeforeExecution' ~ '^[0-9]+$' AND authority->>'approvedAmountCents' ~ '^[0-9]+$'
   AND authority->>'approvedAmountCents' = coalesce(request."approvedAmountCents",request."requestedAmountCents")::TEXT,FALSE) THEN
   RAISE EXCEPTION 'registered payment event requires server request capacity coordinates';
 END IF;
 IF before_update THEN
   IF authority->>'paidAmountBeforeExecution' IS DISTINCT FROM request."paidAmountCents"::TEXT OR
      request."paidAmountCents"::NUMERIC + e."amountCents" > coalesce(request."approvedAmountCents",request."requestedAmountCents")::NUMERIC THEN
     RAISE EXCEPTION 'registered payment exceeds original approved request capacity';
   END IF;
 ELSE
   IF request."paidAmountCents"::NUMERIC <> (authority->>'paidAmountBeforeExecution')::NUMERIC + e."amountCents" OR
      request."paidAmountCents" > coalesce(request."approvedAmountCents",request."requestedAmountCents") OR
      request."status" IS DISTINCT FROM CASE WHEN request."paidAmountCents" >= coalesce(request."approvedAmountCents",request."requestedAmountCents") THEN 'paid' ELSE 'partially_paid' END THEN
     RAISE EXCEPTION 'registered payment must commit exactly one matching request paid consequence';
   END IF;
 END IF;
 -- Preserve task07's frozen original inactive company continuation. A new
 -- inactive payer cannot become eligible merely by appearing in earlier rows.
 SELECT * INTO STRICT company FROM public."CompanyEntity" WHERE "id" = version."companyEntityIdSnapshot" FOR SHARE;
 IF NOT company."isActive" THEN
   SELECT * INTO frozen_company FROM public."CompanyEntityVersion" WHERE "id" = version."companyEntityVersionId" FOR SHARE;
   IF version."status" NOT IN ('effective','superseded') OR frozen_company."id" IS NULL OR NOT frozen_company."isActive"
      OR pg_catalog.length(pg_catalog.btrim(version."companyEntityNameSnapshot")) = 0 OR pg_catalog.length(pg_catalog.btrim(version."companyEntityCreditCodeSnapshot")) = 0
      OR frozen_company."companyEntityId" <> company."id" OR frozen_company."name" IS DISTINCT FROM version."companyEntityNameSnapshot"
      OR frozen_company."unifiedSocialCreditCode" IS DISTINCT FROM version."companyEntityCreditCodeSnapshot"
   THEN RAISE EXCEPTION 'registered payment inactive original company lacks frozen continuation proof'; END IF;
 END IF;
 SELECT account."companyEntityId" INTO payer_company_id FROM public."RegisteredPaymentFunding" funding JOIN public."RegisteredFundAccount" account ON account."id" = funding."accountId" WHERE funding."executionId" = execution_id;
 IF payer_company_id IS NOT NULL AND payer_company_id IS DISTINCT FROM version."companyEntityIdSnapshot" AND EXISTS(SELECT 1 FROM public."CompanyEntity" WHERE "id" = payer_company_id AND NOT "isActive") THEN
   RAISE EXCEPTION 'registered payment cannot newly choose an inactive proxy payer';
 END IF;
END $$;

CREATE FUNCTION public."jg_registered_payment_event_write"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 PERFORM public."jg_assert_registered_payment_write_authority"(NEW."executionId",NEW."payload"->'writeAuthority',TG_WHEN = 'BEFORE');
 IF TG_WHEN = 'BEFORE' THEN RETURN NEW; END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER "RegisteredPaymentEvent_write_authority" BEFORE INSERT ON public."RegisteredPaymentEvent" FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_event_write"();
CREATE CONSTRAINT TRIGGER "RegisteredPaymentEvent_commit_authority" AFTER INSERT ON public."RegisteredPaymentEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_event_write"();

-- A later wage write cannot reclassify a committed registered fact and break
-- permanent replay. Non-registered wage behavior is left with its own guards.
CREATE FUNCTION public."jg_registered_payment_excludes_wage"() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public."RegisteredPaymentFunding" WHERE "executionId" = NEW."paymentExecutionId") THEN RAISE EXCEPTION 'registered payment and wage execution ownership are mutually exclusive'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "PaymentExecutionWagePayableBinding_no_registered" BEFORE INSERT OR UPDATE ON public."PaymentExecutionWagePayableBinding" FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_excludes_wage"();
CREATE TRIGGER "HistoricalWageSummaryPaymentExecutionLink_no_registered" BEFORE INSERT OR UPDATE ON public."HistoricalWageSummaryPaymentExecutionLink" FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_excludes_wage"();
