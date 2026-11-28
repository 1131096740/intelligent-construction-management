BEGIN;

-- Authentication and business visibility are checked by the API before calling
-- these readers. Database access also requires the exact routine's EXECUTE and
-- the caller's existing permission to read the matching original records.
CREATE FUNCTION public.jg_read_payment_contract_agreement_detail_v1(
  payment_id text, project_id text, contract_id text
) RETURNS TABLE ("submittedText" text, "currentText" text)
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
  SELECT snapshot."agreementText", current_change."paymentAgreementText"
  FROM public."PaymentRequest" payment
  LEFT JOIN public."PaymentRequestAgreementSnapshot" snapshot ON snapshot."paymentRequestId" = payment."id"
  LEFT JOIN LATERAL (
    SELECT change."paymentAgreementText" FROM public."ContractSignedChange" change
    WHERE change."contractId" = payment."contractId" AND change."status" = 'approved'
      AND change."paymentAgreementText" IS NOT NULL
    ORDER BY change."sequenceNo" DESC LIMIT 1
  ) current_change ON true
  WHERE payment."id" = payment_id AND payment."projectId" = project_id AND payment."contractId" = contract_id;
END;
$$;

CREATE FUNCTION public.jg_read_effective_contract_change_amount_v1(
  version_id text, project_id text, contract_id text
) RETURNS TABLE ("effectiveAmountYuan" numeric)
LANGUAGE plpgsql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT (
    pg_catalog.has_column_privilege(session_user, 'public."Contract"', 'id', 'SELECT')
    AND pg_catalog.has_column_privilege(session_user, 'public."Contract"', 'projectId', 'SELECT')
    AND pg_catalog.has_column_privilege(session_user, 'public."ContractVersion"', 'id', 'SELECT')
    AND pg_catalog.has_column_privilege(session_user, 'public."ContractVersion"', 'contractId', 'SELECT')
    AND pg_catalog.has_column_privilege(session_user, 'public."ContractVersion"', 'status', 'SELECT')
  ) THEN
    RAISE EXCEPTION '当前数据库身份无合同版本读取权限' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT change."effectiveAmountYuan"
  FROM public."ContractSignedChange" change
  JOIN public."ContractVersion" version ON version."id" = change."baseVersionId"
  JOIN public."Contract" contract ON contract."id" = version."contractId"
  WHERE version."id" = version_id AND contract."id" = contract_id AND contract."projectId" = project_id
    AND version."status" = 'effective' AND contract."voidedAt" IS NULL AND change."status" = 'approved'
    AND NOT EXISTS (
      SELECT 1 FROM public."ContractVersion" newer
      WHERE newer."contractId" = version."contractId" AND newer."status" = 'effective'
        AND newer."versionNo" > version."versionNo"
    )
  ORDER BY change."sequenceNo" DESC LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.jg_read_payment_contract_agreement_detail_v1(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jg_read_effective_contract_change_amount_v1(text,text,text) FROM PUBLIC;

COMMIT;
