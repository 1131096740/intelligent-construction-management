BEGIN;

CREATE TABLE public.jg_contract_signed_change_submit_witness (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  "key" bytea NOT NULL CHECK (octet_length("key") = 32),
  "databaseOid" oid NOT NULL,
  "runtimeRoleOid" oid NOT NULL
);
REVOKE ALL ON TABLE public.jg_contract_signed_change_submit_witness FROM PUBLIC;

CREATE FUNCTION public.jg_submit_contract_signed_change_v1(
  project_id text, contract_id text, version_id text, actor_id text, file_id text,
  file_sha text, file_size integer, page_count integer, summary text, agreement text,
  delta text, expiry text, proof text
) RETURNS SETOF public."ContractSignedChange"
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  binding public.jg_contract_signed_change_submit_witness%ROWTYPE;
  version public."ContractVersion"%ROWTYPE;
  file_object public."FileObject"%ROWTYPE;
  entry record;
  has_binding boolean;
  previous_amount numeric;
  result_amount numeric;
  next_sequence integer;
  appendix_id text := gen_random_uuid()::text;
  change_row public."ContractSignedChange"%ROWTYPE;
  now_seconds bigint := floor(extract(epoch FROM clock_timestamp()))::bigint;
  declared_at timestamp(3) := clock_timestamp();
BEGIN
  SELECT * INTO binding FROM public.jg_contract_signed_change_submit_witness WHERE singleton;
  IF binding."databaseOid" IS DISTINCT FROM (SELECT oid FROM pg_database WHERE datname=current_database())
    OR binding."runtimeRoleOid" IS DISTINCT FROM session_user::regrole::oid
    OR session_user = current_user OR has_schema_privilege(session_user, 'public', 'CREATE')
    OR NOT coalesce(expiry ~ '^[0-9]{10}$', false)
    OR NOT coalesce(proof ~ '^[a-f0-9]{64}$', false)
    OR nullif(actor_id, '') IS NULL OR nullif(file_id, '') IS NULL
    OR nullif(contract_id, '') IS NULL OR nullif(version_id, '') IS NULL OR nullif(project_id, '') IS NULL
  THEN
    RAISE EXCEPTION '补充协议提交资格缺失' USING ERRCODE = '42501';
  END IF;
  IF expiry::bigint NOT BETWEEN now_seconds AND now_seconds + 30 OR
    encode(public.hmac(convert_to(public.jg_fund_balance_correction_fields(ARRAY[
      'contract_signed_change_submit_v1', current_database()::text, session_user::text,
      pg_current_xact_id()::text, pg_backend_pid()::text, expiry,
      project_id, contract_id, version_id, actor_id, file_id, file_sha, file_size::text, page_count::text,
      summary, agreement, delta
    ]), 'UTF8'), binding."key", 'sha256'), 'hex') IS DISTINCT FROM proof
  THEN
    RAISE EXCEPTION '补充协议提交凭证不匹配' USING ERRCODE = '42501';
  END IF;
  IF NOT coalesce(file_sha ~ '^[a-f0-9]{64}$', false) OR file_size IS NULL OR file_size <= 0
    OR page_count IS NULL OR page_count <= 0
    OR summary IS NULL OR length(btrim(summary)) NOT BETWEEN 1 AND 1000
    OR (agreement IS NOT NULL AND length(btrim(agreement)) NOT BETWEEN 1 AND 5000)
    OR NOT coalesce(delta ~ '^-?(0|[1-9][0-9]{0,19})(\.[0-9]{1,4})?$', false)
  THEN
    RAISE EXCEPTION '补充协议提交资料不完整' USING ERRCODE = '23514';
  END IF;

  PERFORM 1 FROM public."Contract" c
  WHERE c."id"=contract_id AND c."projectId"=project_id AND c."voidedAt" IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '合同已变化' USING ERRCODE = '23514'; END IF;
  SELECT v.* INTO version FROM public."ContractVersion" v
  WHERE v."contractId"=contract_id AND v."status"='effective'
  ORDER BY v."versionNo" DESC LIMIT 1 FOR UPDATE;
  IF version."id" IS DISTINCT FROM version_id THEN
    RAISE EXCEPTION '当前生效合同版本已变化' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM public."User" u, public."Project" p
  WHERE u."id"=actor_id AND u."isActive" AND p."id"=project_id AND p."isActive" FOR SHARE OF u,p;
  IF NOT FOUND THEN RAISE EXCEPTION '合同经办人或项目已停用' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public."UserPosition" up JOIN public."Position" pos ON pos."id"=up."positionId"
  WHERE up."userId"=actor_id AND up."projectId" IS NULL AND pos."key"='contract_director' FOR SHARE OF up,pos;
  IF NOT FOUND THEN
    PERFORM 1 FROM public."ProjectMember" member
    WHERE member."userId"=actor_id AND member."projectId"=project_id AND member."positionKey"='contract_staff' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION '合同经办角色已变化' USING ERRCODE = '42501'; END IF;
  END IF;
  IF EXISTS (SELECT FROM public."ContractSignedChange" c WHERE c."contractId"=contract_id AND c."status"='pending_review') THEN
    RAISE EXCEPTION '该合同已有待复核的补充协议' USING ERRCODE = '23505', CONSTRAINT = 'ContractSignedChange_one_pending';
  END IF;

  PERFORM pg_advisory_xact_lock(190731, 13);
  SELECT f.* INTO file_object FROM public."FileObject" f WHERE f."id"=file_id FOR UPDATE;
  IF NOT FOUND OR file_object."uploadedByUserId" IS DISTINCT FROM actor_id
    OR file_object."mimeType" IS DISTINCT FROM 'application/pdf'
    OR file_object."storageStatus" IS DISTINCT FROM 'active'
    OR file_object."contentSha256" IS DISTINCT FROM file_sha
    OR file_object."sizeBytes" IS DISTINCT FROM file_size
    OR file_object."supersedesFileObjectId" IS NOT NULL
    OR EXISTS(SELECT FROM public."FileObject" f WHERE f."supersedesFileObjectId"=file_id)
    OR public.jg_project_owner_settlement_voucher_bound(file_id)
  THEN
    RAISE EXCEPTION '已核验的补充协议原件已变化或被占用' USING ERRCODE = '23514';
  END IF;
  FOR entry IN SELECT * FROM public.jg_file_business_collision_columns() LOOP
    EXECUTE format('SELECT EXISTS (SELECT FROM public.%I WHERE %I = $1)', entry."tableName", entry."columnName")
      INTO has_binding USING file_id;
    IF has_binding THEN
      RAISE EXCEPTION '补充协议原件已绑定其他业务' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  SELECT c."effectiveAmountYuan" INTO previous_amount FROM public."ContractSignedChange" c
  WHERE c."contractId"=contract_id AND c."baseVersionId"=version_id AND c."status"='approved'
  ORDER BY c."sequenceNo" DESC LIMIT 1;
  IF NOT FOUND THEN
    previous_amount := CASE
      WHEN version."pricingNature"='framework' AND version."amountLimitType"='unlimited' THEN NULL
      WHEN version."numericProtocolVersion"=2 THEN version."amountYuan"
      ELSE version."amountCents"::numeric / 100 END;
  END IF;
  result_amount := previous_amount + delta::numeric;
  IF result_amount < 0 OR result_amount >= 100000000000000000000::numeric THEN
    RAISE EXCEPTION '变更后的合同金额超出可保存范围' USING ERRCODE = '23514';
  END IF;
  SELECT coalesce(max(c."sequenceNo"),0)+1 INTO next_sequence FROM public."ContractSignedChange" c WHERE c."contractId"=contract_id;

  INSERT INTO public."ContractFormalFile" (
    "id","contractVersionId","purpose","fileId","contentSha256","pageCount","sourceRevision","status",
    "uploadedByUserId","declaredByUserId","declaredAt","declarationSnapshot"
  ) VALUES (
    appendix_id,version_id,'signed_change_appendix',file_id,file_sha,page_count,version."draftRevision",'active',
    actor_id,actor_id,declared_at,jsonb_build_object('includesMutualSignatures',true,'baseVersionId',version_id)
  );
  INSERT INTO public."ContractSignedChange" (
    "id","contractId","baseVersionId","appendixFormalFileId","sequenceNo","summary","paymentAgreementText",
    "amountDeltaYuan","precedingAmountYuan","effectiveAmountYuan","submittedByUserId"
  ) VALUES (
    gen_random_uuid()::text,contract_id,version_id,appendix_id,next_sequence,summary,agreement,
    delta::numeric,previous_amount,result_amount,actor_id
  ) RETURNING * INTO change_row;
  INSERT INTO public."AuditLog" ("id","actorUserId","action","businessType","businessId","metadata")
  VALUES(gen_random_uuid()::text,actor_id,'contract.signed_change.submit','contract_version',version_id,
    jsonb_build_object('changeId',change_row."id",'contractId',contract_id,'appendixFormalFileId',appendix_id));
  RETURN NEXT change_row;
END;
$$;

REVOKE ALL ON FUNCTION public.jg_submit_contract_signed_change_v1(text,text,text,text,text,text,integer,integer,text,text,text,text,text) FROM PUBLIC;

COMMIT;
