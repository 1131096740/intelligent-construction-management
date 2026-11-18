-- Apply after the existing registered-funding installation and the project-advance migration.
CREATE FUNCTION public."jg_registered_payment_project_advance_check"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE assigned NUMERIC; allocated NUMERIC;
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM public."RegisteredPaymentFunding" funding
  JOIN public."PaymentExecution" payment ON payment.id = funding."executionId"
  JOIN public."PaymentRequest" request ON request.id = payment."paymentRequestId"
  JOIN public."RegisteredFundAccount" account ON account.id = funding."accountId"
  WHERE funding."executionId" = NEW."executionId"
    AND funding.xmin::text = (txid_current() % 4294967296)::text
    AND payment.xmin::text = (txid_current() % 4294967296)::text
    AND funding."accountId" = NEW."accountId" AND funding."openingTreatment" = 'not_included'
    AND account.kind = 'company' AND account."companyEntityId" = NEW."creditorCompanyId"
    AND payment."companyEntityIdSnapshot" = NEW."creditorCompanyId" AND payment."executedByUserId" = NEW."confirmedByUserId"
    AND request."projectId" = NEW."projectId" AND NEW."amountCents" <= payment."amountCents"
 ) THEN RAISE EXCEPTION 'project advance requires its initial registered payment and actual company'; END IF;

 IF EXISTS (
  SELECT 1 FROM jsonb_array_elements(NEW."companyAllocations") AS detail
  WHERE jsonb_typeof(detail) <> 'object'
    OR jsonb_typeof(detail->'sourceBatchId') IS DISTINCT FROM 'string'
    OR jsonb_typeof(detail->'amountCents') IS DISTINCT FROM 'string'
    OR detail->>'amountCents' !~ '^[1-9][0-9]{0,18}$'
    OR NOT EXISTS (
      SELECT 1 FROM public."RegisteredFundPaymentAllocation" allocation
      WHERE allocation."executionId" = NEW."executionId" AND allocation."accountId" = NEW."accountId"
        AND allocation."sourceBatchId" = detail->>'sourceBatchId'
        AND allocation."amountCents"::text = detail->>'amountCents')
 ) OR (SELECT count(DISTINCT detail->>'sourceBatchId') FROM jsonb_array_elements(NEW."companyAllocations") AS detail)
      <> jsonb_array_length(NEW."companyAllocations")
 OR EXISTS (
  SELECT 1 FROM jsonb_array_elements(NEW."companyAllocations") AS detail
  WHERE NOT EXISTS (
   SELECT 1 FROM public."jg_registered_fund_source_ownership"(ARRAY[detail->>'sourceBatchId']) ownership
   WHERE ownership.continuous AND ownership."companyId" = NEW."creditorCompanyId")
 ) THEN RAISE EXCEPTION 'project advance requires distinct proven company allocations from that payment'; END IF;

 SELECT sum((detail->>'amountCents')::numeric) INTO assigned
 FROM jsonb_array_elements(NEW."companyAllocations") AS detail;
 SELECT sum(allocation."amountCents") INTO allocated FROM public."RegisteredFundPaymentAllocation" allocation
 WHERE allocation."executionId" = NEW."executionId";
 IF assigned <> NEW."amountCents" OR allocated IS DISTINCT FROM
  (SELECT payment."amountCents"::numeric FROM public."PaymentExecution" payment WHERE payment.id = NEW."executionId")
 OR EXISTS (
  SELECT 1 FROM public."RegisteredFundPaymentAllocation" allocation
  JOIN public."FundAccountSourceBatch" batch ON batch.id = allocation."sourceBatchId"
  WHERE allocation."executionId" = NEW."executionId"
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(NEW."companyAllocations") AS detail WHERE detail->>'sourceBatchId' = batch.id)
   AND (batch."projectStatus" <> 'project' OR batch."projectId" IS DISTINCT FROM NEW."projectId")
 ) THEN RAISE EXCEPTION 'project advance and assigned project funds must equal the same actual payment'; END IF;
 RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "RegisteredPaymentProjectAdvance_payment"
 AFTER INSERT ON public."RegisteredPaymentProjectAdvance"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_project_advance_check"();

DO $$
DECLARE runtime_name TEXT := nullif(current_setting('jg.task16_runtime_role', true),''); runtime_role RECORD;
BEGIN
 SELECT * INTO runtime_role FROM pg_catalog.pg_roles WHERE rolname = runtime_name;
 IF runtime_role.oid IS NULL OR NOT runtime_role.rolcanlogin OR runtime_role.rolsuper OR runtime_role.rolcreaterole
   OR runtime_role.rolcreatedb OR runtime_role.rolreplication OR runtime_role.rolbypassrls OR runtime_role.rolinherit
   OR EXISTS (
     SELECT 1 FROM unnest(ARRAY['id','executionId','accountId','sourceBatchId','amountCents']) AS expected(column_name)
     WHERE NOT has_column_privilege(runtime_name,'public."RegisteredFundPaymentAllocation"',expected.column_name,'INSERT')
   )
   OR NOT has_column_privilege(runtime_name,'public."RegisteredFundAccount"','writeRevision','UPDATE')
   OR has_any_column_privilege(runtime_name,'public."OperatingFact"','INSERT,UPDATE')
   OR has_any_column_privilege(runtime_name,'public."OperatingImpactEntry"','INSERT,UPDATE')
   OR has_table_privilege(runtime_name,'public."OperatingLedgerWriteSecret"','SELECT')
   OR NOT has_column_privilege(runtime_name,'public."FundAccountSourceBatch"','receivedTransferLineId','SELECT')
   OR NOT has_table_privilege(runtime_name,'public."PublicCashCustody"','SELECT')
   OR EXISTS (SELECT 1 FROM pg_catalog.pg_class relation
      WHERE relation.oid IN ('public."RegisteredFundAdvanceReceipt"'::regclass,
        'public."RegisteredFundCompanyOwnedReceipt"'::regclass, 'public."RegisteredPaymentProjectAdvance"'::regclass)
       AND (has_table_privilege(runtime_name,relation.oid,'UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES')
         OR has_any_column_privilege(runtime_name,relation.oid,'UPDATE, REFERENCES')))
   OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=runtime_role.oid OR roleid=runtime_role.oid)
 THEN RAISE EXCEPTION 'project advance requires the existing restricted payment runtime'; END IF;
 EXECUTE format('GRANT SELECT, INSERT ON public."RegisteredPaymentProjectAdvance" TO %I', runtime_name);
 EXECUTE format('GRANT SELECT, INSERT ON public."RegisteredFundAdvanceReceipt", public."RegisteredFundCompanyOwnedReceipt" TO %I', runtime_name);
 EXECUTE format('GRANT EXECUTE ON FUNCTION public."jg_registered_fund_source_ownership"(TEXT[]), public."jg_registered_fund_verified_own_candidates"(TEXT) TO %I', runtime_name);
 EXECUTE format('GRANT SELECT ("id","name","type","status") ON public."BusinessParty" TO %I', runtime_name);
END $$;

-- Block only the new same-company gap disguised as an otherwise complete ordinary payment.
CREATE FUNCTION public."jg_registered_payment_project_mixed_funding_check"() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE selected_project TEXT; paid BIGINT; mixed RECORD;
BEGIN
 SELECT request."projectId", payment."amountCents" INTO selected_project, paid
 FROM public."RegisteredPaymentFunding" funding
 JOIN public."PaymentExecution" payment ON payment.id = funding."executionId"
 JOIN public."PaymentRequest" request ON request.id = payment."paymentRequestId"
 JOIN public."RegisteredFundAccount" account ON account.id = funding."accountId"
 WHERE funding."executionId" = NEW."executionId" AND funding."openingTreatment" = 'not_included'
  AND account.kind = 'company' AND account."companyEntityId" = payment."companyEntityIdSnapshot";
 IF NOT FOUND OR EXISTS (SELECT 1 FROM public."RegisteredPaymentProjectAdvance" advance WHERE advance."executionId" = NEW."executionId") THEN
  RETURN NULL;
 END IF;

 SELECT sum(allocation."amountCents") AS amount,
  bool_or(source."projectStatus" = 'pending') AS unassigned,
  bool_or(source."projectStatus" = 'project' AND source."projectId" = selected_project) AS exact_project,
  bool_and(source."projectStatus" = 'pending' OR
    (source."projectStatus" = 'project' AND source."projectId" = selected_project)) AS only_project_or_unassigned
 INTO mixed
 FROM public."RegisteredFundPaymentAllocation" allocation
 JOIN public."FundAccountSourceBatch" source ON source.id = allocation."sourceBatchId"
 WHERE allocation."executionId" = NEW."executionId";
 IF mixed.amount = paid AND mixed.unassigned AND mixed.exact_project AND mixed.only_project_or_unassigned THEN
  RAISE EXCEPTION 'same company project funding gap requires a confirmed project advance';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER "RegisteredFundPaymentAllocation_project_mixed_funding"
 AFTER INSERT ON public."RegisteredFundPaymentAllocation"
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public."jg_registered_payment_project_mixed_funding_check"();
