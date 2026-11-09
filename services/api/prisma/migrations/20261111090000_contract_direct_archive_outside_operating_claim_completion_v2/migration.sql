-- Move only the evidence reads behind the already-bound anchor routine.
BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

DO $install$
DECLARE
  guard_oid OID:=pg_catalog.to_regprocedure('public.jg_require_direct_outside_operating_completion_v2()');
  stage_oid OID:=pg_catalog.to_regprocedure('public.jg_stage_direct_outside_operating_archive_v2(uuid,uuid,text,text,text,text,integer,text,text,jsonb)');
  tls_install_oid OID:=pg_catalog.to_regprocedure('public.jg_install_direct_outside_runtime_tls_v2()');
  helper_oid OID:=pg_catalog.to_regprocedure('public.jg_assert_direct_outside_operating_completion_evidence_v2(text,text,text)');
  namespace_oid OID:=pg_catalog.to_regnamespace('public');
  anchor OID:=current_user::regrole::oid;
  old_guard TEXT;
  routine_metadata JSONB;
  new_guard TEXT:=$postimage$
DECLARE
  receipt public.jg_contract_direct_outside_operating_receipt_v2%ROWTYPE;
BEGIN
  SELECT * INTO receipt FROM public.jg_contract_direct_outside_operating_receipt_v2 r WHERE r."intentId"=NEW."intentId";
  IF TG_RELID IS DISTINCT FROM 'public.jg_contract_direct_outside_operating_use_v2'::regclass OR TG_OP<>'INSERT'
    OR NOT FOUND OR receipt."bindingSha256" IS DISTINCT FROM public.jg_check_contract_direct_archive_intent_roles_v1(FALSE)
    OR NEW."databaseOid" IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database())
    OR NEW."runtimeSessionOid" IS DISTINCT FROM session_user::regrole::oid OR NEW."executorOwnerOid" IS DISTINCT FROM current_user::regrole::oid
    OR NEW."backendPid" IS DISTINCT FROM pg_catalog.pg_backend_pid() OR NEW."transactionId" IS DISTINCT FROM pg_catalog.txid_current() THEN
    RAISE EXCEPTION '表外直签经营完成缺少同事务领取凭据' USING ERRCODE='55000';
  END IF;
  PERFORM public.jg_assert_direct_outside_operating_completion_evidence_v2(
    NEW."archiveId",NEW."contractVersionId",NULL::text);
  RETURN NULL;
END;
$postimage$;
BEGIN
  IF current_user IS DISTINCT FROM session_user
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_database d
      WHERE d.datname=pg_catalog.current_database() AND d.datdba=anchor)
    OR 4<>(SELECT count(*) FROM (VALUES
      (guard_oid,'201e27822be844d1dd011af29bb724d74e54394ce44a80b94cc70ffc94f2e7dd','pg_catalog.trigger',false,false),
      (stage_oid,'469a0638a339626b8d2ca710c7b541e984063d1915c1267c4b0fba4826b6f555','pg_catalog.text',false,true),
      (helper_oid,'34bd477aa0de10f43a18ee80f9f9ec9c52ad381b52244a119c739a37d73db51a','pg_catalog.void',true,false),
      (tls_install_oid,'523a4f2da1a121fb1ecbbcbcb05365e4990336c05c6f550ccac094b8162714a2','pg_catalog.void',false,false)
    ) expected(routine_oid,body_sha,result_type,is_definer,is_strict)
      JOIN pg_catalog.pg_proc p ON p.oid=expected.routine_oid AND p.pronamespace=namespace_oid AND p.proowner=anchor
        AND p.prokind='f' AND p.prorettype=pg_catalog.to_regtype(expected.result_type)
        AND p.provolatile='v' AND p.proparallel='u' AND p.prosecdef=expected.is_definer AND p.proisstrict=expected.is_strict
        AND NOT (p.proretset OR p.proleakproof) AND p.pronargdefaults=0 AND p.provariadic=0 AND p.prosupport=0
        AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=expected.body_sha
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
      WHERE NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        WHERE a.grantee<>anchor OR a.grantor<>anchor))
    OR 1<>(SELECT count(*) FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_trigger t ON t.tgconstraint=c.oid AND t.tgrelid=c.conrelid AND t.tgname=c.conname
      WHERE c.connamespace=namespace_oid AND c.conname='jg_direct_outside_operating_completion'
        AND c.conrelid='public.jg_contract_direct_outside_operating_use_v2'::regclass
        AND c.contype='t' AND c.condeferrable AND c.condeferred
        AND t.tgfoid=guard_oid AND t.tgtype=5 AND t.tgenabled='O' AND NOT t.tgisinternal
        AND t.tgdeferrable AND t.tginitdeferred AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text='')
    OR 1<>(SELECT count(*) FROM pg_catalog.pg_constraint c
      WHERE c.connamespace=namespace_oid AND c.conname='jg_direct_outside_operating_completion') THEN
    RAISE EXCEPTION '表外直签延期完成证据目录不匹配' USING ERRCODE='55000';
  END IF;

  SELECT p.prosrc INTO STRICT old_guard FROM pg_catalog.pg_proc p WHERE p.oid=guard_oid;
  SELECT jsonb_object_agg(p.oid::text,to_jsonb(p)-'prosrc') INTO routine_metadata
    FROM pg_catalog.pg_proc p WHERE p.oid=ANY(ARRAY[guard_oid,stage_oid,tls_install_oid]);
  IF cardinality(string_to_array(pg_catalog.pg_get_functiondef(guard_oid),old_guard))<>2
    OR cardinality(string_to_array(pg_catalog.pg_get_functiondef(stage_oid),'201e27822be844d1dd011af29bb724d74e54394ce44a80b94cc70ffc94f2e7dd'))<>2
    OR cardinality(string_to_array(pg_catalog.pg_get_functiondef(tls_install_oid),'469a0638a339626b8d2ca710c7b541e984063d1915c1267c4b0fba4826b6f555'))<>2
    OR cardinality(string_to_array(pg_catalog.pg_get_functiondef(tls_install_oid),'143a343765785198800cf359321d8a9689fdd18e22194cbe8f94fbfa56205fd4'))<>2 THEN
    RAISE EXCEPTION '表外直签延期完成证据替换位置不唯一' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(pg_catalog.pg_get_functiondef(guard_oid),old_guard,new_guard);
  EXECUTE replace(pg_catalog.pg_get_functiondef(stage_oid),'201e27822be844d1dd011af29bb724d74e54394ce44a80b94cc70ffc94f2e7dd','d67e9870c2f11a8a2cfdb53360c1b93adeaf4bd2db653a7d0dd9f12004651f70');
  EXECUTE replace(replace(pg_catalog.pg_get_functiondef(tls_install_oid),
    '469a0638a339626b8d2ca710c7b541e984063d1915c1267c4b0fba4826b6f555','3e0ef5c3c539a573c86cbf0a50d20cc2a88f8641b7825ca2ff91ee7b21a0bc36'),'143a343765785198800cf359321d8a9689fdd18e22194cbe8f94fbfa56205fd4','7196f97ce11149792f50642a0800045f9d123229ca82ec05298ace226ba28400');

  IF 3<>(SELECT count(*) FROM (VALUES
    (guard_oid,'d67e9870c2f11a8a2cfdb53360c1b93adeaf4bd2db653a7d0dd9f12004651f70'),
    (stage_oid,'3e0ef5c3c539a573c86cbf0a50d20cc2a88f8641b7825ca2ff91ee7b21a0bc36'),
    (tls_install_oid,'a6d9ae6409482eb52cf6d611558436b8bdeeb580a06f56fd6b6f0e03afa8a54f')
  ) expected(routine_oid,body_sha)
    JOIN pg_catalog.pg_proc p ON p.oid=expected.routine_oid AND p.proowner=anchor
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=expected.body_sha
      AND (to_jsonb(p)-'prosrc')=(routine_metadata->p.oid::text)
      WHERE NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
        WHERE a.grantee<>anchor OR a.grantor<>anchor))
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t
      WHERE t.tgrelid='public.jg_contract_direct_outside_operating_use_v2'::regclass
        AND t.tgname='jg_direct_outside_operating_completion' AND t.tgfoid=guard_oid) THEN
    RAISE EXCEPTION '表外直签延期完成证据未正确接线' USING ERRCODE='55000';
  END IF;
END;
$install$;

COMMIT;
