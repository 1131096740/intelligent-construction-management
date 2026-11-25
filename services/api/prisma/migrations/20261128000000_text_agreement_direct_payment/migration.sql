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

COMMIT;
