BEGIN;

-- Use the same original payment-key footprint as 04300. The API calls this
-- after its existing payment visibility and approval-participant checks.
CREATE FUNCTION public.jg_read_payment_detail_activity_v1(
  payment_id text, project_id text, contract_id text
) RETURNS TABLE (
  "kind" text, "id" text, "amountCents" bigint, "paidAt" timestamp(3), "createdAt" timestamp(3),
  "executedByUserId" text, "voucherFileId" text
)
LANGUAGE plpgsql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT (
    pg_catalog.has_column_privilege(session_user, 'public."PaymentRequest"', 'id', 'SELECT')
    AND pg_catalog.has_column_privilege(session_user, 'public."PaymentRequest"', 'projectId', 'SELECT')
    AND pg_catalog.has_column_privilege(session_user, 'public."PaymentRequest"', 'contractId', 'SELECT')
  ) THEN
    RAISE EXCEPTION '当前数据库身份无付款详情读取权限' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH payment_key AS (
    SELECT p."id" FROM public."PaymentRequest" p
    WHERE p."id"=payment_id AND p."projectId"=project_id AND p."contractId"=contract_id
  )
  SELECT activity.*
  FROM (
    SELECT 'execution'::text AS "kind", e."id", e."amountCents", e."paidAt", e."createdAt",
      e."executedByUserId", e."voucherFileId"
    FROM payment_key p JOIN public."PaymentExecution" e ON e."paymentRequestId"=p."id"
    UNION ALL
    SELECT 'finance'::text, f."id", f."amountCents", NULL::timestamp(3), NULL::timestamp(3),
      NULL::text, NULL::text
    FROM payment_key p JOIN public."FinanceRecord" f ON f."paymentRequestId"=p."id"
  ) activity
  ORDER BY activity."kind", activity."paidAt" DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.jg_read_payment_detail_activity_v1(text,text,text) FROM PUBLIC;

COMMIT;
