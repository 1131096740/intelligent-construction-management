BEGIN;
CREATE FUNCTION public.jg_contract_work_completion_view_v1(version_id text, actor_id text, expiry text, proof text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE
  binding public.jg_contract_work_completion_witness%ROWTYPE;
  now_seconds bigint := floor(extract(epoch FROM clock_timestamp()))::bigint;
  scope record;
BEGIN
  SELECT * INTO binding FROM public.jg_contract_work_completion_witness WHERE singleton;
  IF binding."databaseOid" IS DISTINCT FROM (SELECT oid FROM pg_database WHERE datname=current_database())
    OR binding."runtimeRoleOid" IS DISTINCT FROM session_user::regrole::oid
    OR session_user = current_user OR has_schema_privilege(session_user,'public','CREATE')
    OR NOT coalesce(expiry ~ '^[0-9]{10}$',false) OR NOT coalesce(proof ~ '^[a-f0-9]{64}$',false)
  THEN RAISE EXCEPTION '履约确认资格缺失' USING ERRCODE='42501'; END IF;
  IF expiry::bigint NOT BETWEEN now_seconds AND now_seconds+30
    OR encode(public.hmac(convert_to(public.jg_fund_balance_correction_fields(ARRAY[
      'contract_work_completion_view_v1',current_database()::text,session_user::text,
      pg_current_xact_id()::text,pg_backend_pid()::text,expiry,version_id,actor_id
    ]),'UTF8'),binding."key",'sha256'),'hex') IS DISTINCT FROM proof
  THEN RAISE EXCEPTION '履约确认凭证不匹配' USING ERRCODE='42501'; END IF;

  SELECT c."projectId" AS project_id,
    CASE WHEN v."amountLimitType"='unlimited' THEN NULL WHEN v."numericProtocolVersion"=2 THEN v."amountYuan"
      ELSE v."amountCents"::numeric/100 END AS amount
  INTO scope FROM public."ContractVersion" v JOIN public."Contract" c ON c.id=v."contractId"
  JOIN public."Project" p ON p.id=c."projectId"
  JOIN public."User" u ON u.id=actor_id AND u."isActive"
  WHERE v.id=version_id AND v.status='effective' AND c."voidedAt" IS NULL AND p."isActive"
    AND c."contractTypeKey" IN ('generic_contract','other')
    AND v.id=(SELECT newest.id FROM public."ContractVersion" newest
      WHERE newest."contractId"=c.id AND newest.status='effective' ORDER BY newest."versionNo" DESC LIMIT 1);
  IF NOT FOUND THEN RETURN NULL; END IF;

  RETURN jsonb_build_object('projectId',scope.project_id,'entries',coalesce((
    SELECT jsonb_agg(jsonb_build_object('id',d.id,'work',d.work,'amountYuan',d."amountYuan"::text,
      'exceedsContractAmount',coalesce(d."amountYuan">scope.amount,false),'status',d.status,
      'createdByUserId',d."createdByUserId",'approvalInstanceId',d."approvalInstanceId",
      'applicantUserId',r."applicantUserId",'frozenNodes',r."frozenNodes") ORDER BY d."createdAt" DESC,d.id)
    FROM public."ContractWorkCompletion" d
    LEFT JOIN public."ApprovalInstance" r ON r.id=d."approvalInstanceId" AND r."businessId"=d.id
      AND r."businessType"='contract_work_completion' AND r."flowType"='contract.work_completion.approve'
    WHERE d."contractVersionId"=version_id
  ),'[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.jg_contract_work_completion_view_v1(text,text,text,text) FROM PUBLIC;
COMMIT;
