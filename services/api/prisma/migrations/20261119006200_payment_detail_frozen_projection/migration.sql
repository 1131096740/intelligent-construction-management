BEGIN;

CREATE FUNCTION public.jg_payment_detail_frozen_scope_v1(payment_id text,project_id text,contract_id text)
RETURNS boolean
LANGUAGE plpgsql STABLE STRICT SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT (
    pg_catalog.has_column_privilege(session_user,'public."PaymentRequest"','id','SELECT')
    AND pg_catalog.has_column_privilege(session_user,'public."PaymentRequest"','projectId','SELECT')
    AND pg_catalog.has_column_privilege(session_user,'public."PaymentRequest"','contractId','SELECT')
  ) THEN
    RAISE EXCEPTION '当前数据库身份无付款详情读取权限' USING ERRCODE='42501';
  END IF;
  RETURN EXISTS(SELECT FROM public."PaymentRequest" p
    WHERE p."id"=payment_id AND p."projectId"=project_id AND p."contractId"=contract_id);
END;
$$;

CREATE FUNCTION public.jg_read_payment_detail_allocations_v1(payment_id text,project_id text,contract_id text)
RETURNS TABLE (
  "id" text,"paymentExecutionId" text,"settlementId" text,"stageName" text,"stageType" text,
  "allocationType" text,"amountCents" bigint,"allocationOrder" integer
)
LANGUAGE plpgsql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT public.jg_payment_detail_frozen_scope_v1(payment_id,project_id,contract_id) THEN RETURN; END IF;
  RETURN QUERY SELECT a."id",a."paymentExecutionId",a."settlementId",a."stageName",a."stageType",
    a."allocationType",a."amountCents",a."allocationOrder"
  FROM public."PaymentExecutionAllocation" a WHERE a."paymentRequestId"=payment_id
  ORDER BY a."createdAt" ASC,a."allocationOrder" ASC;
END;
$$;

CREATE FUNCTION public.jg_read_payment_detail_pdf_v1(payment_id text,project_id text,contract_id text)
RETURNS TABLE ("id" text,"fileId" text,"templateKey" text,"createdAt" timestamp(3))
LANGUAGE plpgsql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT public.jg_payment_detail_frozen_scope_v1(payment_id,project_id,contract_id) THEN RETURN; END IF;
  RETURN QUERY SELECT p."id",p."fileId",p."templateKey",p."createdAt"
  FROM public."PdfDocument" p
  WHERE p."businessType"='payment_request' AND p."businessId"=payment_id
  ORDER BY p."createdAt" DESC;
END;
$$;

-- The application already gates its finance-history branch by the original
-- payment.finance_record permission. The finance branch is also tied to this
-- payment's actual finance rows, never a caller-supplied list of entity IDs.
CREATE FUNCTION public.jg_read_payment_detail_snapshots_v1(
  payment_id text,project_id text,contract_id text,finance_history boolean
) RETURNS TABLE (
  "sceneKey" text,"entityType" text,"entityId" text,"revision" integer,"definitionVersion" integer,
  "definitionSnapshot" jsonb,"valuesSnapshot" jsonb,"frozenAt" timestamp(3)
)
LANGUAGE plpgsql STABLE STRICT SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  IF NOT public.jg_payment_detail_frozen_scope_v1(payment_id,project_id,contract_id) THEN RETURN; END IF;
  RETURN QUERY SELECT s."sceneKey",s."entityType",s."entityId",s."revision",s."definitionVersion",
    s."definitionSnapshot",s."valuesSnapshot",s."frozenAt"
  FROM public."BusinessEntrySubmissionSnapshot" s
  WHERE s."projectId"=project_id AND (
    (NOT finance_history AND s."sceneKey" IN ('payment_request','payment_approval_amount')
      AND s."entityType"='payment_request' AND s."entityId"=payment_id)
    OR (finance_history AND s."sceneKey"='payment_finance_record' AND s."entityType"='finance_record'
      AND EXISTS(SELECT FROM public."FinanceRecord" f WHERE f."id"=s."entityId" AND f."paymentRequestId"=payment_id))
  )
  ORDER BY s."frozenAt" ASC,s."id" ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.jg_payment_detail_frozen_scope_v1(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jg_read_payment_detail_allocations_v1(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jg_read_payment_detail_pdf_v1(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jg_read_payment_detail_snapshots_v1(text,text,text,boolean) FROM PUBLIC;

COMMIT;
