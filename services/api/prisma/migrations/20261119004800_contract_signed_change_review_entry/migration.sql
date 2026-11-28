BEGIN;

CREATE FUNCTION public.jg_read_contract_signed_change_review_v1(
  project_id text, contract_id text, version_id text, change_id text
) RETURNS TABLE (
  "status" text, "submittedByUserId" text, "appendixFileId" text,
  "contentSha256" text, "pageCount" integer
)
LANGUAGE plpgsql STABLE STRICT SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM public.jg_contract_signed_change_submit_witness w
    JOIN pg_database d ON d.oid=w."databaseOid" AND d.datname=current_database()
    WHERE w.singleton AND w."runtimeRoleOid"=session_user::regrole::oid
  ) OR session_user=current_user THEN
    RAISE EXCEPTION '补充协议复核读取资格缺失' USING ERRCODE='42501';
  END IF;
  RETURN QUERY
  SELECT sc."status",sc."submittedByUserId",f."fileId",f."contentSha256",f."pageCount"
  FROM public."ContractSignedChange" sc
  JOIN public."Contract" c ON c."id"=sc."contractId"
  JOIN public."ContractFormalFile" f ON f."id"=sc."appendixFormalFileId"
    AND f."contractVersionId"=sc."baseVersionId" AND f."purpose"='signed_change_appendix'
  WHERE sc."id"=change_id AND sc."baseVersionId"=version_id AND c."id"=contract_id
    AND c."projectId"=project_id AND c."voidedAt" IS NULL;
END;
$$;

CREATE FUNCTION public.jg_review_contract_signed_change_v1(
  project_id text, contract_id text, version_id text, change_id text, actor_id text,
  decision text, reason text, self_reason text, file_id text, file_sha text,
  file_size integer, page_count integer, expiry text, proof text
) RETURNS SETOF public."ContractSignedChange"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  binding public.jg_contract_signed_change_submit_witness%ROWTYPE;
  change_row public."ContractSignedChange"%ROWTYPE;
  appendix public."ContractFormalFile"%ROWTYPE;
  current_version text;
  reviewed_at timestamp(3) := clock_timestamp();
  now_seconds bigint := floor(extract(epoch FROM clock_timestamp()))::bigint;
BEGIN
  SELECT * INTO binding FROM public.jg_contract_signed_change_submit_witness WHERE singleton;
  IF binding."databaseOid" IS DISTINCT FROM (SELECT oid FROM pg_database WHERE datname=current_database())
    OR binding."runtimeRoleOid" IS DISTINCT FROM session_user::regrole::oid
    OR session_user=current_user OR has_schema_privilege(session_user,'public','CREATE')
    OR NOT coalesce(expiry ~ '^[0-9]{10}$',false) OR NOT coalesce(proof ~ '^[a-f0-9]{64}$',false)
  THEN
    RAISE EXCEPTION '补充协议复核资格缺失' USING ERRCODE='42501';
  END IF;
  IF expiry::bigint NOT BETWEEN now_seconds AND now_seconds + 30 OR
    encode(public.hmac(convert_to(public.jg_fund_balance_correction_fields(ARRAY[
      'contract_signed_change_review_v1',current_database()::text,session_user::text,
      pg_current_xact_id()::text,pg_backend_pid()::text,expiry,
      project_id,contract_id,version_id,change_id,actor_id,decision,reason,self_reason,
      file_id,file_sha,file_size::text,page_count::text
    ]),'UTF8'),binding."key",'sha256'),'hex') IS DISTINCT FROM proof
  THEN
    RAISE EXCEPTION '补充协议复核凭证不匹配' USING ERRCODE='42501';
  END IF;
  IF decision IS NULL OR decision NOT IN ('approve','reject')
    OR (decision='reject' AND NOT coalesce(length(btrim(reason)) BETWEEN 1 AND 1000,false))
    OR (decision='approve' AND reason IS NOT NULL)
  THEN
    RAISE EXCEPTION '补充协议复核资料不完整' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public."Contract" c
  WHERE c."id"=contract_id AND c."projectId"=project_id AND c."voidedAt" IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '合同已变化' USING ERRCODE='23514'; END IF;
  SELECT v."id" INTO current_version FROM public."ContractVersion" v
  WHERE v."contractId"=contract_id AND v."status"='effective'
  ORDER BY v."versionNo" DESC LIMIT 1 FOR UPDATE;
  IF current_version IS DISTINCT FROM version_id THEN
    RAISE EXCEPTION '当前生效合同版本已变化' USING ERRCODE='23514';
  END IF;
  PERFORM 1 FROM public."User" u
  JOIN public."UserPosition" up ON up."userId"=u."id" AND up."projectId" IS NULL
  JOIN public."Position" pos ON pos."id"=up."positionId" AND pos."key"='contract_director'
  JOIN public."Project" p ON p."id"=project_id AND p."isActive"
  WHERE u."id"=actor_id AND u."isActive" FOR SHARE OF u,up,pos,p;
  IF NOT FOUND THEN RAISE EXCEPTION '当前合同部主管资格已变化' USING ERRCODE='42501'; END IF;

  SELECT sc.* INTO change_row FROM public."ContractSignedChange" sc
  WHERE sc."id"=change_id AND sc."contractId"=contract_id AND sc."baseVersionId"=version_id FOR UPDATE;
  IF NOT FOUND OR change_row."status"<>'pending_review' THEN
    RAISE EXCEPTION '该补充协议已复核或已变化' USING ERRCODE='23514';
  END IF;
  IF (change_row."submittedByUserId"=actor_id AND NOT coalesce(length(btrim(self_reason)) BETWEEN 1 AND 1000,false))
    OR (change_row."submittedByUserId"<>actor_id AND self_reason IS NOT NULL)
  THEN
    RAISE EXCEPTION '补充协议自审凭证与经办人不一致' USING ERRCODE='42501';
  END IF;

  IF decision='approve' THEN
    SELECT f.* INTO appendix FROM public."ContractFormalFile" f
    WHERE f."id"=change_row."appendixFormalFileId" FOR UPDATE;
    IF NOT FOUND OR appendix."contractVersionId" IS DISTINCT FROM version_id
      OR appendix."purpose" IS DISTINCT FROM 'signed_change_appendix' OR appendix."status" IS DISTINCT FROM 'active'
      OR appendix."uploadedByUserId" IS DISTINCT FROM change_row."submittedByUserId"
      OR appendix."confirmedAt" IS NOT NULL OR appendix."fileId" IS DISTINCT FROM file_id
      OR appendix."contentSha256" IS DISTINCT FROM file_sha OR appendix."pageCount" IS DISTINCT FROM page_count
    THEN
      RAISE EXCEPTION '补充协议原件与待复核记录不一致' USING ERRCODE='23514';
    END IF;
    PERFORM 1 FROM public."FileObject" f
    WHERE f."id"=file_id AND f."uploadedByUserId"=change_row."submittedByUserId" AND f."storageStatus"='active'
      AND f."mimeType"='application/pdf' AND f."contentSha256"=file_sha AND f."sizeBytes"=file_size FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION '补充协议原件已变化' USING ERRCODE='23514'; END IF;
    UPDATE public."ContractFormalFile" f
    SET "confirmedByUserId"=actor_id,"confirmedAt"=reviewed_at,
      "confirmationSnapshot"=jsonb_build_object('changeId',change_id,'baseVersionId',version_id)
    WHERE f."id"=appendix."id";
  END IF;
  UPDATE public."ContractSignedChange" sc
  SET "status"=CASE WHEN decision='approve' THEN 'approved' ELSE 'rejected' END,
    "reviewedAt"=reviewed_at,"reviewedByUserId"=actor_id,"reviewReason"=reason
  WHERE sc."id"=change_id RETURNING sc.* INTO change_row;
  INSERT INTO public."AuditLog" ("id","actorUserId","action","businessType","businessId","metadata")
  VALUES(gen_random_uuid()::text,actor_id,
    CASE WHEN decision='approve' THEN 'contract.signed_change.approve' ELSE 'contract.signed_change.reject' END,
    'contract_version',version_id,
    jsonb_build_object('changeId',change_id,'contractId',contract_id)
      || CASE WHEN reason IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('reason',reason) END
      || CASE WHEN self_reason IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('selfReview',true,'selfReviewReason',self_reason) END);
  RETURN NEXT change_row;
END;
$$;

REVOKE ALL ON FUNCTION public.jg_read_contract_signed_change_review_v1(text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jg_review_contract_signed_change_v1(text,text,text,text,text,text,text,text,text,text,integer,integer,text,text) FROM PUBLIC;

COMMIT;
