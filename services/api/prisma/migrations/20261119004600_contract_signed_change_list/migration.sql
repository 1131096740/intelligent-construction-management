BEGIN;

CREATE FUNCTION public.jg_list_contract_signed_changes_v1(
  version_id text, project_id text, contract_id text
) RETURNS TABLE (
  "id" text, "baseVersionId" text, "sequenceNo" integer, "status" text,
  "summary" text, "paymentAgreementText" text, "amountDeltaYuan" numeric,
  "precedingAmountYuan" numeric, "effectiveAmountYuan" numeric,
  "reviewReason" text, "reviewedAt" timestamp(3), "createdAt" timestamp(3),
  "submittedByUserId" text, "appendixFileId" text
)
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
  SELECT change."id", change."baseVersionId", change."sequenceNo", change."status",
    change."summary", change."paymentAgreementText", change."amountDeltaYuan",
    change."precedingAmountYuan", change."effectiveAmountYuan", change."reviewReason",
    change."reviewedAt", change."createdAt", change."submittedByUserId", appendix."fileId"
  FROM public."Contract" contract
  JOIN public."ContractVersion" version ON version."contractId" = contract."id"
  JOIN public."ContractSignedChange" change ON change."contractId" = contract."id"
  JOIN public."ContractFormalFile" appendix ON appendix."id" = change."appendixFormalFileId"
    AND appendix."contractVersionId" = change."baseVersionId" AND appendix."purpose" = 'signed_change_appendix'
  WHERE version."id" = version_id AND contract."id" = contract_id AND contract."projectId" = project_id
    AND version."status" = 'effective' AND contract."voidedAt" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public."ContractVersion" newer
      WHERE newer."contractId" = version."contractId" AND newer."status" = 'effective'
        AND newer."versionNo" > version."versionNo"
    )
  ORDER BY change."sequenceNo" DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.jg_list_contract_signed_changes_v1(text,text,text) FROM PUBLIC;

COMMIT;
