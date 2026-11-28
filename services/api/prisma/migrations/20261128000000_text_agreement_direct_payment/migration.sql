BEGIN;

ALTER TABLE public."PaymentRequest" ADD COLUMN "contractDueBasis" TEXT;
ALTER TABLE public."PaymentRequest" ADD CONSTRAINT "PaymentRequest_text_agreement_shape_check"
  CHECK ("contractDueBasis" IS NULL OR (
    "contractDueBasis" = 'text_agreement_v1' AND "sourceType" = 'contract_due'
    AND "settlementId" IS NULL AND "signedSettlementId" IS NULL AND "paymentTermsStageId" IS NULL
    AND "requestedAmountCents" > 0
    AND ("approvedAmountCents" IS NULL OR "approvedAmountCents" BETWEEN 1 AND "requestedAmountCents")
    AND length(btrim(coalesce("paymentMatter", ''))) > 0
    AND length(btrim(coalesce("amountCalculationExplanation", ''))) > 0
  ));

CREATE FUNCTION public.jg_guard_payment_text_agreement_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."contractDueBasis" IS DISTINCT FROM OLD."contractDueBasis" OR (
      OLD."contractDueBasis" IS NOT NULL AND
      (NEW."id", NEW."projectId", NEW."contractId", NEW."contractVersionId", NEW."paymentTermsVersionId", NEW."paymentSubjectType")
        IS DISTINCT FROM
      (OLD."id", OLD."projectId", OLD."contractId", OLD."contractVersionId", OLD."paymentTermsVersionId", OLD."paymentSubjectType")
    ) THEN
      RAISE EXCEPTION '付款申请冻结的合同约定不可变更' USING ERRCODE = '23514';
    END IF;
    IF OLD."contractDueBasis" IS NOT NULL AND (
      (OLD."approvedAmountCents" IS NOT NULL AND
        (NEW."approvedAmountCents", NEW."requestedAmountCents")
          IS DISTINCT FROM (OLD."approvedAmountCents", OLD."requestedAmountCents"))
      OR (OLD."approvedAmountCents" IS NULL AND NEW."approvedAmountCents" IS NOT NULL
         AND NEW."status" <> 'approved_pending_payment')
    ) THEN
      RAISE EXCEPTION '付款申请的批准金额不可变更' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."contractDueBasis" IS NOT NULL THEN
    -- The same contract lock orders approval of signed changes and freezing a new request.
    PERFORM 1 FROM public."Contract" contract WHERE contract."id" = NEW."contractId" FOR UPDATE;
    IF NEW."status" <> 'approval_pending' OR NEW."approvedAmountCents" IS NOT NULL OR NEW."paidAmountCents" <> 0
       OR NOT EXISTS (
      SELECT 1 FROM public."Contract" contract
      JOIN public."ContractVersion" version ON version."contractId" = contract."id"
      JOIN public."PaymentTermsVersion" terms ON terms."contractVersionId" = version."id" AND terms."contractId" = contract."id"
      WHERE contract."id" = NEW."contractId" AND contract."projectId" = NEW."projectId"
        AND contract."contractTypeKey" = 'other' AND contract."voidedAt" IS NULL
        AND version."id" = NEW."contractVersionId" AND version."numericProtocolVersion" = 2
        AND version."status" = 'effective' AND version."effectiveAt" IS NOT NULL
        AND version."signingSubjectType" = NEW."paymentSubjectType"
        AND version."settlementMode" = 'direct_payment' AND version."settlementModeConfirmedAt" IS NOT NULL
        AND version."settlementModeConfirmedByUserId" IS NOT NULL
        AND terms."id" = NEW."paymentTermsVersionId" AND terms."status" = 'effective' AND length(btrim(terms."originalText")) > 0
        AND NOT EXISTS (SELECT 1 FROM public."PaymentTermsVersion" newer
          WHERE newer."contractVersionId" = version."id" AND newer."status" = 'effective' AND newer."versionNo" > terms."versionNo")
        AND NOT EXISTS (SELECT 1 FROM public."PaymentTermsStage" stage WHERE stage."paymentTermsVersionId" = terms."id")
    ) THEN
      RAISE EXCEPTION '付款申请未绑定已确认且无阶段的合同付款约定' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.jg_guard_payment_text_agreement_v1() FROM PUBLIC;
CREATE TRIGGER jg_guard_payment_text_agreement
  BEFORE INSERT OR UPDATE ON public."PaymentRequest"
  FOR EACH ROW EXECUTE FUNCTION public.jg_guard_payment_text_agreement_v1();

-- Read only the established agreement for the already-authorized payment selector.
CREATE FUNCTION public.jg_read_text_payment_agreement_v1(
  version_id text, terms_id text, project_id text, contract_id text
) RETURNS TABLE ("agreementText" text)
LANGUAGE plpgsql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT (
    pg_catalog.has_column_privilege(session_user, 'public."Contract"', 'id', 'SELECT')
    AND pg_catalog.has_column_privilege(session_user, 'public."Contract"', 'projectId', 'SELECT')
    AND pg_catalog.has_column_privilege(session_user, 'public."ContractVersion"', 'id', 'SELECT')
    AND pg_catalog.has_column_privilege(session_user, 'public."PaymentTermsVersion"', 'originalText', 'SELECT')
  ) THEN
    RAISE EXCEPTION '当前数据库身份无付款约定读取权限' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT coalesce(current_change."paymentAgreementText", terms."originalText")
  FROM public."Contract" contract
  JOIN public."ContractVersion" version ON version."contractId" = contract."id"
  JOIN public."PaymentTermsVersion" terms ON terms."contractVersionId" = version."id" AND terms."contractId" = contract."id"
  LEFT JOIN LATERAL (
    SELECT change."paymentAgreementText" FROM public."ContractSignedChange" change
    WHERE change."contractId" = contract."id" AND change."status" = 'approved'
      AND change."paymentAgreementText" IS NOT NULL
    ORDER BY change."sequenceNo" DESC LIMIT 1
  ) current_change ON true
  WHERE contract."id" = contract_id AND contract."projectId" = project_id AND contract."voidedAt" IS NULL
    AND version."id" = version_id AND version."status" = 'effective'
    AND terms."id" = terms_id AND terms."status" = 'effective';
END;
$$;
REVOKE ALL ON FUNCTION public.jg_read_text_payment_agreement_v1(text,text,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.jg_freeze_signed_payment_agreement_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  INSERT INTO public."PaymentRequestAgreementSnapshot" ("paymentRequestId", "agreementText")
  SELECT NEW."id", change."paymentAgreementText"
  FROM public."ContractSignedChange" AS change
  WHERE change."contractId" = NEW."contractId" AND change."status" = 'approved'
    AND change."paymentAgreementText" IS NOT NULL
  ORDER BY change."sequenceNo" DESC LIMIT 1;
  IF NOT FOUND AND NEW."contractDueBasis" = 'text_agreement_v1' THEN
    INSERT INTO public."PaymentRequestAgreementSnapshot" ("paymentRequestId", "agreementText")
    SELECT NEW."id", terms."originalText" FROM public."PaymentTermsVersion" terms
    WHERE terms."id" = NEW."paymentTermsVersionId" AND terms."contractVersionId" = NEW."contractVersionId";
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE public."PaymentExecutionAllocation"
  ALTER COLUMN "stageType" DROP NOT NULL,
  DROP CONSTRAINT "PaymentExecutionAllocation_settlement_required_check",
  ADD CONSTRAINT "PaymentExecutionAllocation_settlement_required_check" CHECK ((
    "settlementId" IS NOT NULL
    OR ("sourceType" = 'contract_due' AND "allocationType" = 'contract_due_payment'
        AND "contractVersionId" IS NOT NULL AND "stageId" IS NOT NULL
        AND "triggerAnchor" = 'contract_effective' AND "sourceEffectiveAt" IS NOT NULL)
    OR ("stageType" IS NULL AND "sourceType" = 'contract_due'
        AND "allocationType" = 'contract_due_payment' AND "contractVersionId" IS NOT NULL
        AND "stageId" IS NULL AND "stageName" IS NULL AND "triggerAnchor" IS NULL
        AND "dueDays" IS NULL AND "ratioBps" IS NULL AND "fixedAmountCents" IS NULL
        AND "sourceEffectiveAt" IS NULL AND "expectedPayableAt" IS NULL)
  ) IS TRUE);

-- Leave the retained stage/settlement validator unchanged.
DROP TRIGGER "PaymentExecutionAllocation_direct_contract_stage_guard" ON public."PaymentExecutionAllocation";
CREATE TRIGGER "PaymentExecutionAllocation_direct_contract_stage_guard"
  BEFORE INSERT ON public."PaymentExecutionAllocation"
  FOR EACH ROW WHEN (NEW."stageType" IS NOT NULL)
  EXECUTE FUNCTION public.guard_direct_contract_stage_allocation();

CREATE FUNCTION public.jg_guard_approved_request_payment_allocation_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW."settlementId" IS NOT NULL OR NEW."stageId" IS NOT NULL OR
    NEW."sourceType" <> 'contract_due' OR NEW."allocationType" <> 'contract_due_payment' OR
    NEW."allocationOrder" <> 0 OR NEW."sourceRowId" <> 'payment-request:' || NEW."paymentRequestId"
    OR NOT EXISTS (
      SELECT 1 FROM public."PaymentExecution" execution
      JOIN public."PaymentRequest" request ON request."id" = execution."paymentRequestId"
      WHERE execution."id" = NEW."paymentExecutionId" AND execution."settlementId" IS NULL
        AND execution."executedByUserId" = NEW."createdByUserId" AND execution."amountCents" = NEW."amountCents"
        AND request."id" = NEW."paymentRequestId" AND request."projectId" = NEW."projectId"
        AND request."contractId" = NEW."contractId" AND request."contractVersionId" = NEW."contractVersionId"
        AND request."paymentTermsVersionId" = NEW."paymentTermsVersionId"
        AND request."contractDueBasis" = 'text_agreement_v1'
        AND request."status" IN ('approved_pending_payment', 'partially_paid')
        AND request."approvedAmountCents" = NEW."sourcePayableAmountCents"
        AND request."paidAmountCents"::numeric + execution."amountCents" <= request."approvedAmountCents"
        AND (SELECT count(*) = 1 AND bool_and(approval."status" = 'approved')
          FROM public."ApprovalInstance" approval
          WHERE approval."businessType" = 'payment_request' AND approval."businessId" = request."id"
            AND approval."flowType" = 'payment.approve'
            AND approval."createdAt" = (SELECT max(latest."createdAt") FROM public."ApprovalInstance" latest
              WHERE latest."businessType" = approval."businessType" AND latest."businessId" = approval."businessId"
                AND latest."flowType" = approval."flowType"))
    )
  THEN
    RAISE EXCEPTION '付款分摊必须绑定本次审批已通过的合同直接付款申请' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.jg_guard_approved_request_payment_allocation_v1() FROM PUBLIC;
CREATE TRIGGER jg_guard_approved_request_payment_allocation
  BEFORE INSERT ON public."PaymentExecutionAllocation"
  FOR EACH ROW WHEN (NEW."stageType" IS NULL)
  EXECUTE FUNCTION public.jg_guard_approved_request_payment_allocation_v1();

-- Keep table writes and the execution lock inside the existing allocation guards.
CREATE FUNCTION public.jg_append_text_payment_allocation_v1(execution_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  execution public."PaymentExecution";
  transaction_xmin text := (pg_catalog.txid_current() % 4294967296)::text;
  has_funding boolean;
BEGIN
  SELECT e.* INTO execution FROM public."PaymentExecution" e
  WHERE e."id" = execution_id AND e.xmin::text = transaction_xmin
    AND e."paymentSubjectType" = 'our_company' AND e."settlementId" IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION '合同直接付款只能分摊本事务的实付' USING ERRCODE = '23514';
  END IF;

  IF execution."voucherFileId" IS NULL THEN
    SELECT EXISTS (SELECT 1 FROM public."RegisteredPaymentFunding" funding
      WHERE funding."executionId" = execution_id AND funding.xmin::text = transaction_xmin)
    INTO has_funding;
  ELSE
    SELECT coalesce(sum(funding."amountCents"), 0) = execution."amountCents"
    INTO has_funding FROM public."ProjectFundingAllocation" funding
    JOIN public."PaymentRequest" request ON request."id" = funding."businessId" AND request."projectId" = funding."projectId"
    WHERE funding."executionId" = execution_id AND funding."executionType" = 'payment_execution'
      AND funding."businessType" = 'payment_request' AND funding."businessId" = execution."paymentRequestId"
      AND funding."createdByUserId" = execution."executedByUserId" AND funding."direction" = 'debit'
      AND funding."occurredAt" = execution."paidAt" AND funding."reversalKey" = 'original'
      AND funding.xmin::text = transaction_xmin;
  END IF;
  IF NOT has_funding THEN
    RAISE EXCEPTION '合同直接付款缺少本事务的资金凭据' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public."PaymentExecutionAllocation" ("id", "paymentExecutionId", "paymentRequestId", "projectId",
    "contractId", "contractVersionId", "sourceType", "allocationType", "sourceRowId", "paymentTermsVersionId",
    "sourcePayableAmountCents", "amountCents", "allocationOrder", "createdByUserId")
  SELECT pg_catalog.gen_random_uuid()::text, execution."id", request."id", request."projectId",
    request."contractId", request."contractVersionId", 'contract_due', 'contract_due_payment',
    'payment-request:' || request."id", request."paymentTermsVersionId", request."approvedAmountCents",
    execution."amountCents", 0, execution."executedByUserId"
  FROM public."PaymentRequest" request WHERE request."id" = execution."paymentRequestId"
    AND request."contractDueBasis" = 'text_agreement_v1' AND request."approvedAmountCents" IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION '合同直接付款缺少本次批准的付款申请' USING ERRCODE = '23514';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.jg_append_text_payment_allocation_v1(text) FROM PUBLIC;


-- Keep the registered write, provenance and commit conservation rules in
-- sync with the signed settlement source admitted by PaymentRequest.
DO $$
DECLARE
  routine record;
  definition text;
  old_sources CONSTANT text := '(''settlement'',''contract_due'',''contract_advance'')';
  new_sources CONSTANT text := '(''settlement'',''signed_settlement'',''contract_due'',''contract_advance'')';
  old_payable_basis CONSTANT text := $basis$
 IF due_count=0 AND e."settlementId" IS NOT NULL THEN
   IF pg_catalog.length(pg_catalog.btrim(e."settlementId"))=0 THEN RAISE EXCEPTION 'registered settlement source is empty'; END IF;
   expected_payables:=pg_catalog.jsonb_build_object(pg_catalog.btrim(e."settlementId"),e."amountCents"::TEXT);
 END IF;$basis$;
  new_payable_basis CONSTANT text := $basis$
 IF due_count=0 AND (e."settlementId" IS NOT NULL OR frozen_source_type='signed_settlement') THEN
   source_id := CASE WHEN frozen_source_type='signed_settlement' THEN request."signedSettlementId" ELSE e."settlementId" END;
   IF source_id IS NULL OR pg_catalog.length(pg_catalog.btrim(source_id))=0 THEN RAISE EXCEPTION 'registered settlement source is empty'; END IF;
   expected_payables:=pg_catalog.jsonb_build_object(pg_catalog.btrim(source_id),e."amountCents"::TEXT);
 END IF;$basis$;
BEGIN
  FOR routine IN SELECT * FROM (VALUES
    ('public.jg_assert_registered_payment_write_authority(text,jsonb,boolean)'::regprocedure, 'request."sourceType" NOT IN ' || old_sources, 'request."sourceType" NOT IN ' || new_sources),
    ('public.jg_registered_payment_source_matches(text,text,bigint,text,text)'::regprocedure, '->>''sourceType'' IN ' || old_sources, '->>''sourceType'' IN ' || new_sources),
    ('public.jg_assert_registered_payment_intercompany_complete(text)'::regprocedure, 'frozen_source_type NOT IN ' || old_sources, 'frozen_source_type NOT IN ' || new_sources),
    ('public.jg_assert_registered_payment_intercompany_complete(text)'::regprocedure, old_payable_basis, new_payable_basis)
  ) AS expected(signature, anchor, replacement)
  LOOP
    definition := pg_catalog.pg_get_functiondef(routine.signature);
    IF (length(definition) - length(replace(definition, routine.anchor, ''))) <> length(routine.anchor)
    THEN
      RAISE EXCEPTION '实付付款来源校验的数据库前态不符合预期' USING ERRCODE = '23514';
    END IF;
    EXECUTE replace(definition, routine.anchor, routine.replacement);
  END LOOP;
END;
$$;

COMMIT;
