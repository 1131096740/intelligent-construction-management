-- Detached first-registration executor. The existing installed profiles and ACLs stay closed.
BEGIN;
SET LOCAL search_path TO pg_catalog,pg_temp;

CREATE FUNCTION public.jg_contract_direct_archive_outside_profile_v1() RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $profile$
DECLARE
  binding_sha TEXT;
  identity_database OID;
  identity_runtime OID:=session_user::regrole::oid;
  identity_executor OID:=current_user::regrole::oid;
  backend INTEGER:=pg_catalog.pg_backend_pid();
  xid BIGINT:=pg_catalog.txid_current();
BEGIN
  binding_sha:=public.jg_check_contract_direct_archive_intent_roles_v1(false);
  SELECT oid INTO STRICT identity_database FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database();
  IF identity_runtime=identity_executor OR (SELECT count(*) FROM public.jg_contract_direct_archive_intent_use_v1 u
    JOIN public.jg_contract_direct_archive_intent_v1 i ON i."intentId"=u."intentId"
    WHERE i."bindingSha256"=binding_sha AND u."databaseOid"=identity_database
      AND u."runtimeSessionOid"=identity_runtime AND u."executorOwnerOid"=identity_executor
      AND u."backendPid"=backend AND u."transactionId"=xid)<>1 THEN
    RAISE EXCEPTION '直签登记缺少同事务唯一已使用的原请求' USING ERRCODE='55000';
  END IF;
  RETURN jsonb_build_object('profileProtocolVersion',1,'recipeVersion','contract-direct-archive-write-v1/1',
    'bindingSha256',binding_sha,'databaseOid',identity_database::text,'sessionRoleOid',identity_runtime::text,
    'currentRoleOid',identity_executor::text,'backendPid',backend,'transactionId',xid::text);
END;
$profile$;
REVOKE ALL ON FUNCTION public.jg_contract_direct_archive_outside_profile_v1() FROM PUBLIC;

CREATE FUNCTION public.jg_execute_contract_direct_archive_outside_v1(
  p_intent UUID,p_actor TEXT,p_project TEXT,p_contract TEXT,p_version TEXT,p_revision INTEGER,
  p_input_sha TEXT,p_key TEXT,p_evidence JSONB
) RETURNS TEXT
LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $execute$
DECLARE
  binding_sha TEXT;
  verified_payload JSONB;
  consumed_payload JSONB;
  raw_identity JSONB;
  file_ids TEXT[];
  file_count INTEGER;
  physical_key TEXT;
  archive_id TEXT;
BEGIN
  binding_sha:=public.jg_check_contract_direct_archive_intent_roles_v1(false);
  verified_payload:=public.jg_contract_direct_archive_intent_payload_v1(
    p_actor,p_project,p_contract,p_version,p_revision,p_input_sha,p_key,p_evidence);

  PERFORM c."id" FROM public."Contract" c
    WHERE c."id"=p_contract AND c."projectId"=p_project AND c."ownerUserId"=p_actor AND c."voidedAt" IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '当前经办人无权登记本合同' USING ERRCODE='42501'; END IF;
  PERFORM v."id" FROM public."ContractVersion" v
    WHERE v."id"=p_version AND v."contractId"=p_contract AND v."status"='draft' AND v."draftRevision"=p_revision
      AND v."draftData"#>'{directSigningInput,protocolVersion}'='1'::jsonb
      AND v."draftData"#>>'{directSigningInput,source}'='direct_signed'
      AND v."draftData"#>>'{directSigningInput,relationship}'='outside' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '当前表外已签草稿资料已变化' USING ERRCODE='23514'; END IF;
  PERFORM p."id" FROM public."Project" p
    WHERE p."id"=p_project AND p."isActive" AND p."operatingLedgerEffectiveDate" IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '当前项目不能办理该类直签登记' USING ERRCODE='23514'; END IF;

  SELECT array_agg(item->>'fileId' ORDER BY position), jsonb_agg(item-'objectGeneration' ORDER BY position)
    INTO file_ids,raw_identity FROM jsonb_array_elements(p_evidence) WITH ORDINALITY AS originals(item,position);
  PERFORM f."id" FROM public."FileObject" f WHERE f."id"=ANY(file_ids) ORDER BY f."id" COLLATE "C" FOR UPDATE NOWAIT;
  GET DIAGNOSTICS file_count=ROW_COUNT;
  IF file_count<>cardinality(file_ids) THEN
    RAISE EXCEPTION '直签原件不完整' USING ERRCODE='23514';
  END IF;
  IF NOT pg_catalog.pg_try_advisory_xact_lock(190731,13) THEN
    RAISE EXCEPTION '文件绑定正在办理，请稍后查询原请求' USING ERRCODE='55P03';
  END IF;
  FOR physical_key IN SELECT f."objectKey" FROM public."FileObject" f
    WHERE f."id"=ANY(file_ids) ORDER BY f."objectKey" COLLATE "C"
  LOOP
    IF physical_key IS NULL OR physical_key='' THEN
      RAISE EXCEPTION '直签原件物理身份不完整' USING ERRCODE='23514';
    END IF;
    IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('jg:contract-direct-review-object-key-v1:'||physical_key,0)) THEN
      RAISE EXCEPTION '签章原件正在办理，请稍后查询原请求' USING ERRCODE='55P03';
    END IF;
  END LOOP;

  consumed_payload:=public.jg_consume_contract_direct_archive_intent_v1(
    p_intent,p_actor,p_project,p_contract,p_version,p_revision,p_input_sha,p_key,p_evidence);
  IF consumed_payload IS DISTINCT FROM verified_payload
    OR public.jg_contract_direct_archive_outside_profile_v1()->>'bindingSha256' IS DISTINCT FROM binding_sha THEN
    RAISE EXCEPTION '直签登记原请求与当前执行资格不匹配' USING ERRCODE='55000';
  END IF;
  archive_id:=public.jg_write_contract_direct_archive_v1(p_version,p_actor,p_key,p_revision,p_input_sha,file_ids,raw_identity);
  PERFORM public.jg_record_contract_direct_archive_generations_v1(
    archive_id,p_intent,p_actor,p_project,p_contract,p_version,p_revision,p_input_sha,p_key,p_evidence);
  IF public.jg_read_contract_direct_archive_generations_v1(archive_id) IS NULL THEN
    RAISE EXCEPTION '直签登记未保留完整的固定原件' USING ERRCODE='23514';
  END IF;

  -- The dedicated login has no business-table grants. Complete deferred evidence
  -- and foreign-key checks before leaving the confined definer transaction scope.
  SET CONSTRAINTS ALL IMMEDIATE;
  IF public.jg_contract_direct_archive_outside_profile_v1()->>'bindingSha256' IS DISTINCT FROM binding_sha THEN
    RAISE EXCEPTION '直签登记资格在完成前已变化' USING ERRCODE='55000';
  END IF;
  RETURN archive_id;
END;
$execute$;
REVOKE ALL ON FUNCTION public.jg_execute_contract_direct_archive_outside_v1(UUID,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,JSONB) FROM PUBLIC;

COMMIT;
