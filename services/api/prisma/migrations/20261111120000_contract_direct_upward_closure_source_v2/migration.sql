-- Finite Q2 source successor, preserving original object OIDs and metadata.
BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

CREATE TABLE public.jg_contract_direct_upward_closure_v2 (
  "protocolVersion" INTEGER PRIMARY KEY CHECK ("protocolVersion"=2),
  "recipeVersion" TEXT NOT NULL CHECK ("recipeVersion"='contract-upward-direct-archive-v2/1'),
  "databaseOid" OID NOT NULL,
  "namespaceOid" OID NOT NULL,
  "anchorOwnerOid" OID NOT NULL,
  "applicationRoleOid" OID NOT NULL,
  "runtimeSessionOid" OID NOT NULL,
  "issuerBindingOid" OID NOT NULL,
  "issuerBindingSha256" TEXT NOT NULL CHECK ("issuerBindingSha256"~'^[a-f0-9]{64}$'),
  "splices" JSONB NOT NULL CHECK (jsonb_typeof("splices")='array'),
  "triggers" JSONB NOT NULL CHECK (jsonb_typeof("triggers")='array'),
  "routines" JSONB NOT NULL CHECK (jsonb_typeof("routines")='array'),
  "priorConstraintOid" OID NOT NULL,
  "priorConstraintDefinition" TEXT NOT NULL,
  "constraintOid" OID NOT NULL,
  "constraintDefinition" TEXT NOT NULL
);
REVOKE ALL ON TABLE public.jg_contract_direct_upward_closure_v2 FROM PUBLIC;
CREATE FUNCTION public.jg_guard_upward_archive_closure_v2() RETURNS TRIGGER
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $closure_guard$
BEGIN
  IF TG_OP<>'INSERT' OR current_user IS DISTINCT FROM session_user OR TG_TABLE_SCHEMA<>'public'
    OR NEW."anchorOwnerOid" IS DISTINCT FROM current_user::regrole::oid
    OR EXISTS(SELECT 1 FROM public.jg_contract_direct_upward_closure_v2)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=TG_RELID AND c.relowner=current_user::regrole::oid) THEN
    RAISE EXCEPTION '对上登记后继接线只接受一次可信安装' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$closure_guard$;
CREATE TRIGGER jg_upward_archive_closure_immutable BEFORE INSERT OR UPDATE OR DELETE
ON public.jg_contract_direct_upward_closure_v2 FOR EACH ROW EXECUTE FUNCTION public.jg_guard_upward_archive_closure_v2();
CREATE TRIGGER jg_upward_archive_closure_no_truncate BEFORE TRUNCATE
ON public.jg_contract_direct_upward_closure_v2 FOR EACH STATEMENT EXECUTE FUNCTION public.jg_guard_upward_archive_closure_v2();

-- Both installer and verifier reconstruct these exact finite splices. A stored
-- arbitrary "after SHA" or capability boolean never authorizes another body.
CREATE FUNCTION public.jg_upward_archive_transform_v2(p_signature TEXT,p_before TEXT) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $transform$
DECLARE branch TEXT; permitted TEXT[]; before_sha TEXT; entry_position INTEGER; result TEXT;
BEGIN
  CASE p_signature
  WHEN 'public.jg_guard_contract_upward_pending_save_v1(public."ContractVersion",public."ContractVersion")' THEN
    permitted:=ARRAY['ee7b3ccc522fa5b18f5212a54718729dd33e9a1713b3768747368a7b331efa50'];
    branch:=$save_branch$  IF prior."status"='effective' OR candidate."status"='effective' THEN
    RETURN public.jg_guard_upward_archive_version_v2(prior,candidate);
  END IF;
$save_branch$;
  WHEN 'public.jg_check_contract_upward_pending_save_v1()' THEN
    permitted:=ARRAY['1541911b049f700fbba33ee1d973fa43aab1577fa8490a7eea1c10e57cde6059'];
    branch:=$save_after_branch$  IF NEW."status"='effective' AND NEW."draftData"#>>'{directSigningInput,relationship}'='upward' THEN
    IF OLD."status"='draft' THEN
      PERFORM public.jg_assert_upward_archive_complete_v2(upward_archive_parent_row."id") FROM public."ContractArchiveFile" upward_archive_parent_row
        WHERE upward_archive_parent_row."contractVersionId"=NEW."id" AND upward_archive_parent_row."authoritySnapshot"->>'recipeVersion'='contract-upward-direct-archive-v1/1';
    ELSE
      PERFORM 1 FROM public."ContractArchiveFile" upward_archive_parent_row WHERE upward_archive_parent_row."contractVersionId"=NEW."id"
        AND upward_archive_parent_row."authoritySnapshot"->>'recipeVersion'='contract-upward-direct-archive-v1/1'
        AND public.jg_read_upward_direct_archive_v1(upward_archive_parent_row."id") IS NOT NULL;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION '对上生效缺少原登记完整凭据' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
$save_after_branch$;
  WHEN 'public.jg_guard_generated_upward_seal_completion_v1()' THEN
    permitted:=ARRAY['ae9d017bf6f9fd6617e7a58a3908c64c76c0130b0c49aa73a316d34ffbb44449'];
    branch:=$seal_branch$  IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='ContractVersion' THEN
    IF TG_OP='UPDATE' THEN
      IF OLD."draftData"#>>'{directSigningInput,relationship}'='upward'
        AND (OLD."status"='effective' OR NEW."status"='effective') THEN
        RETURN public.jg_guard_upward_archive_version_v2(OLD::public."ContractVersion",NEW::public."ContractVersion");
      END IF;
    END IF;
  END IF;
$seal_branch$;
  WHEN 'public.jg_guard_contract_direct_archive_parent_v1(public."ContractArchiveFile")' THEN
    permitted:=ARRAY['1e9d6404ecd618617aa74dc85fc656be334f1b0d8219d7e814361866f6e4b903','b211330ea1a8e4bad49fb29fa05543c3a4a7028cc6424c48975cdfe010e0ca4b'];
    branch:=$parent_branch$  IF p_parent."authoritySnapshot"->>'recipeVersion'='contract-upward-direct-archive-v1/1' THEN
    RETURN public.jg_guard_upward_archive_parent_v2(p_parent);
  END IF;
$parent_branch$;
  WHEN 'public.jg_guard_contract_direct_archive_slot_v1()' THEN
    permitted:=ARRAY['99d80f7a4bb9105acda415aa7cedd6dba0266849cb9b945cb5e7b0aaf6885164'];
    branch:=$slot_branch$  IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='ContractDraftAttachment' AND TG_OP='DELETE' THEN
    IF EXISTS(SELECT 1 FROM public."ContractArchiveFile" upward_archive_parent_row WHERE upward_archive_parent_row."contractVersionId"=OLD."contractVersionId"
      AND upward_archive_parent_row."authoritySnapshot"->>'recipeVersion'='contract-upward-direct-archive-v1/1') THEN
      RETURN public.jg_check_upward_archive_slot_v2(OLD::public."ContractDraftAttachment");
    END IF;
  END IF;
$slot_branch$;
  WHEN 'public.jg_contract_archive_v2_complete_guard()' THEN
    permitted:=ARRAY['6b8253f544d4940ee068513d0a6c32cbad3d82b7144b664c98032c47a1f64c87','2750e0d605ebcfd1942cec9a4914a3d04c23e40d156b6e37baa6c426849e45fd'];
  WHEN 'public.jg_require_contract_direct_archive_complete_v1()' THEN
    permitted:=ARRAY['326ba01217db8a85b777ea5f416fbaf3515d4fa49c9eb3d65d4b895760bae6d5','aef44aa0aa64a86f2253d8392aa624b082a84eb98579663c3890d878245fee8a'];
  WHEN 'public.jg_require_contract_direct_archive_generations_v1()' THEN
    permitted:=ARRAY['5b6ad408598dbde8798f62fa3ed3ea94d32a96faa2b64f3473112df7e2238a35'];
  WHEN 'public.jg_contract_archive_v2_ownership_day(text)' THEN
    permitted:=ARRAY['7bfc159db4085773d9be238c257739f5c881e8f550c4efb061fed6f1a5c2ab13'];
    branch:=$day_branch$  IF EXISTS(SELECT 1 FROM public."ContractArchiveFile" upward_archive_parent_row WHERE upward_archive_parent_row."contractVersionId"=p_contract_version_id
    AND upward_archive_parent_row."authoritySnapshot"->>'recipeVersion'='contract-upward-direct-archive-v1/1') THEN
    RETURN public.jg_upward_archive_ownership_day_v2(p_contract_version_id);
  END IF;
$day_branch$;
  WHEN 'public.jg_issue_contract_direct_upward_intent_v2(uuid,text,text,text,text,integer,text,text,jsonb)' THEN
    before_sha:=encode(public.digest(convert_to(p_before,'UTF8'),'sha256'),'hex');
    IF before_sha<>'c9ff15d34905cb3628d8a95acf58c5e4a7bc5d654c40b4ec27e7990c6a0c7a0e' THEN
      RAISE EXCEPTION '对上原发行入口前态不匹配' USING ERRCODE='55000'; END IF;
    result:=replace(p_before,'payload:=public.jg_contract_direct_archive_upward_intent_basis_v2(',
      'payload:=public.jg_read_upward_issuer_basis_v2(');
    IF result=p_before THEN RAISE EXCEPTION '对上发行依据缺少精确锚点' USING ERRCODE='55000'; END IF;
    RETURN result;
  WHEN 'public.jg_check_contract_direct_upward_issuer_v2()' THEN
    before_sha:=encode(public.digest(convert_to(p_before,'UTF8'),'sha256'),'hex');
    IF before_sha<>'11f533539673f3958a0dd01e41918baf926bf8565c66d80914cd5203d871412d' THEN RAISE EXCEPTION '对上原发行校验前态不匹配' USING ERRCODE='55000'; END IF;
    result:=replace(p_before,'FROM public.jg_contract_direct_archive_intent_binding_v1 WHERE',
      'FROM public.jg_read_upward_issuer_outside_binding_v2() WHERE');
    IF result=p_before THEN RAISE EXCEPTION '对上发行目录缺少精确锚点' USING ERRCODE='55000'; END IF;
    RETURN replace(result,$hash$encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')$hash$,
      'public.jg_upward_archive_legacy_source_sha_v2(p.oid)');
  WHEN 'public.jg_execute_direct_outside_operating_v2(uuid,uuid,text,text,text,text,integer,text,text,jsonb)' THEN
    permitted:=ARRAY['f8e43c113bcbce2327a7730e6102f0b95c20d47e1bc59f2af757f8770010acb4'];
    -- The existing outside executor pins completion/slot bodies internally.
    -- Preserve its exact comparisons through independently qualified hashes.
    before_sha:=encode(public.digest(convert_to(p_before,'UTF8'),'sha256'),'hex');
    IF NOT before_sha=ANY(permitted) THEN RAISE EXCEPTION '表外执行器后继前态不匹配' USING ERRCODE='55000'; END IF;
    result:=replace(p_before,$hash$encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')$hash$,
      'public.jg_upward_archive_legacy_source_sha_v2(p.oid)');
    IF result=p_before THEN RAISE EXCEPTION '表外执行器缺少精确目录锚点' USING ERRCODE='55000'; END IF;
    RETURN result;
  ELSE RAISE EXCEPTION '不是本次对上登记的有限后继入口' USING ERRCODE='55000';
  END CASE;
  before_sha:=encode(public.digest(convert_to(p_before,'UTF8'),'sha256'),'hex');
  IF NOT before_sha=ANY(permitted) THEN RAISE EXCEPTION '对上登记守卫后继前态不匹配' USING ERRCODE='55000'; END IF;
  IF branch IS NULL THEN
    branch:=$complete_branch$  IF (TG_TABLE_NAME='ContractArchiveFile' AND to_jsonb(NEW)#>>'{authoritySnapshot,recipeVersion}'='contract-upward-direct-archive-v1/1')
    OR (TG_TABLE_NAME='ContractArchiveEvidenceFile' AND EXISTS(SELECT 1 FROM public."ContractArchiveFile" upward_archive_parent_row
      WHERE upward_archive_parent_row."id"=to_jsonb(NEW)->>'archiveFileId' AND upward_archive_parent_row."authoritySnapshot"->>'recipeVersion'='contract-upward-direct-archive-v1/1')) THEN
    PERFORM public.jg_assert_upward_archive_complete_v2(CASE WHEN TG_TABLE_NAME='ContractArchiveFile' THEN to_jsonb(NEW)->>'id' ELSE to_jsonb(NEW)->>'archiveFileId' END);
    RETURN NULL;
  END IF;
$complete_branch$;
  END IF;
  entry_position:=strpos(p_before,E'\nBEGIN\n');
  IF entry_position<1 THEN RAISE EXCEPTION '对上登记守卫入口锚点缺失' USING ERRCODE='55000'; END IF;
  RETURN substr(p_before,1,entry_position+6)||branch||substr(p_before,entry_position+7);
END;
$transform$;

CREATE FUNCTION public.jg_require_contract_direct_upward_source_v2() RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $source$
DECLARE binding public.jg_contract_direct_upward_closure_v2%ROWTYPE; execution RECORD; issuer RECORD; outside RECORD;
  item JSONB; actual RECORD; expected JSONB; role_oid OID; allowed OID[]; result TEXT;
BEGIN
  SELECT b.* INTO STRICT binding FROM public.jg_contract_direct_upward_closure_v2 b
    JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=current_database() AND d.datdba=b."anchorOwnerOid"
    WHERE b."protocolVersion"=2 AND b."recipeVersion"='contract-upward-direct-archive-v2/1'
      AND b."namespaceOid"=to_regnamespace('public') AND b."anchorOwnerOid"=current_user::regrole::oid;
  result:=encode(public.digest(convert_to(to_jsonb(binding)::text,'UTF8'),'sha256'),'hex');
  SELECT e.* INTO STRICT execution FROM public.jg_contract_direct_upward_execution_binding_v2 e
    WHERE e."protocolVersion"=2 AND e."databaseOid"=binding."databaseOid" AND e."namespaceOid"=binding."namespaceOid"
      AND e."anchorOwnerOid"=binding."anchorOwnerOid" AND e."applicationRoleOid"=binding."applicationRoleOid"
      AND e."runtimeSessionOid"=binding."runtimeSessionOid" AND e."issuerBindingOid"=binding."issuerBindingOid"
      AND e."issuerBindingSha256"=binding."issuerBindingSha256" AND e."sourceClosureSha256"=result;
  SELECT i.* INTO STRICT issuer FROM public.jg_contract_direct_upward_issuer_binding_v2 i
    WHERE i.tableoid=binding."issuerBindingOid" AND i."protocolVersion"=2 AND i."databaseOid"=binding."databaseOid"
      AND i."namespaceOid"=binding."namespaceOid" AND i."anchorOwnerOid"=binding."anchorOwnerOid"
      AND encode(public.digest(convert_to(to_jsonb(i)::text,'UTF8'),'sha256'),'hex')=binding."issuerBindingSha256";
  SELECT * INTO STRICT outside FROM public.jg_contract_direct_archive_intent_binding_v1 WHERE "protocolVersion"=1;
  allowed:=ARRAY[binding."applicationRoleOid",binding."runtimeSessionOid",issuer."issuerSessionOid",issuer."issuerOwnerOid"];
  IF NOT session_user::regrole::oid=ANY(allowed||ARRAY[outside."runtimeSessionOid",binding."anchorOwnerOid"])
    OR current_setting('session_replication_role')<>'origin'
    OR (SELECT count(DISTINCT id) FROM unnest(allowed||ARRAY[binding."anchorOwnerOid"]) id)<>5
    OR allowed[2:4] && ARRAY[outside."ordinaryApplicationRoleOid",outside."issuerSessionOid",outside."issuerOwnerOid",outside."runtimeSessionOid",outside."executorOwnerOid"]
    OR issuer."outsideBindingSha256" IS DISTINCT FROM encode(public.digest(convert_to(to_jsonb(outside)::text,'UTF8'),'sha256'),'hex') THEN
    RAISE EXCEPTION '对上后继连接与原角色绑定不匹配' USING ERRCODE='55000';
  END IF;
  FOREACH role_oid IN ARRAY allowed LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=role_oid
      AND r.rolcanlogin=(r.oid<>issuer."issuerOwnerOid")
      AND NOT(r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
      AND NOT has_schema_privilege(r.oid,binding."namespaceOid",'CREATE')
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles other WHERE other.oid<>r.oid
        AND (pg_has_role(r.oid,other.oid,'MEMBER') OR (NOT other.rolsuper AND other.oid<>binding."anchorOwnerOid" AND pg_has_role(other.oid,r.oid,'MEMBER'))))) THEN
      RAISE EXCEPTION '对上后继角色图已变化' USING ERRCODE='55000';
    END IF;
  END LOOP;
  IF 5<>(SELECT count(*) FROM pg_catalog.pg_class c WHERE c.oid IN (
      'public.jg_contract_direct_upward_closure_v2'::regclass,'public.jg_contract_direct_upward_execution_binding_v2'::regclass,
      'public.jg_contract_direct_upward_use_v2'::regclass,'public.jg_contract_direct_upward_issuer_binding_v2'::regclass,
      'public.jg_contract_direct_upward_intent_receipt_v2'::regclass)
      AND c.relowner=binding."anchorOwnerOid" AND c.relnamespace=binding."namespaceOid" AND c.relkind='r' AND c.relpersistence='p'
      AND NOT(c.relispartition OR c.relrowsecurity OR c.relforcerowsecurity)
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_inherits h WHERE h.inhrelid=c.oid OR h.inhparent=c.oid)
      AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY[binding."applicationRoleOid",binding."runtimeSessionOid",issuer."issuerSessionOid"]) caller(id)
        WHERE has_table_privilege(caller.id,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR has_any_column_privilege(caller.id,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) THEN
    RAISE EXCEPTION '对上登记技术凭据须保持私有不可改写' USING ERRCODE='55000';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class relation_row CROSS JOIN LATERAL unnest(
      ARRAY[binding."runtimeSessionOid",issuer."issuerSessionOid",issuer."issuerOwnerOid"]) caller(id)
    WHERE relation_row.relnamespace=binding."namespaceOid" AND relation_row.relkind IN('r','p','v','m','f')
      AND (has_table_privilege(caller.id,relation_row.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_any_column_privilege(caller.id,relation_row.oid,'UPDATE,REFERENCES')
        OR ((has_table_privilege(caller.id,relation_row.oid,'SELECT') OR has_any_column_privilege(caller.id,relation_row.oid,'SELECT')) AND NOT(caller.id=issuer."issuerOwnerOid"
          AND relation_row.oid='public.jg_contract_direct_upward_issuer_binding_v2'::regclass))
        OR ((has_table_privilege(caller.id,relation_row.oid,'INSERT') OR has_any_column_privilege(caller.id,relation_row.oid,'INSERT')) AND NOT(caller.id=issuer."issuerOwnerOid"
          AND relation_row.oid='public.jg_contract_direct_upward_intent_receipt_v2'::regclass)))) THEN
    RAISE EXCEPTION '对上专用登录或发行所有者不得取得业务表权限' USING ERRCODE='55000';
  END IF;
  IF NOT has_table_privilege(issuer."issuerOwnerOid",'public.jg_contract_direct_upward_issuer_binding_v2','SELECT')
    OR NOT has_table_privilege(issuer."issuerOwnerOid",'public.jg_contract_direct_upward_intent_receipt_v2','INSERT')
    OR EXISTS(SELECT 1 FROM unnest(ARRAY[binding."runtimeSessionOid",issuer."issuerSessionOid",issuer."issuerOwnerOid"]) caller(id)
      WHERE has_function_privilege(caller.id,'public.jg_contract_upward_pending_read_v1(text,text)','EXECUTE')
        OR has_function_privilege(caller.id,'public.jg_contract_direct_archive_upward_intent_basis_v2(text,text,text,text,integer,text,text,jsonb)','EXECUTE')) THEN
    RAISE EXCEPTION '对上专用角色只能经固定发行桥接，不得直读业务来源' USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure('public.jg_upward_archive_recipe_v2()')
    AND p.proowner=binding."anchorOwnerOid" AND p.pronamespace=binding."namespaceOid" AND p.prokind='f'
    AND NOT(p.prosecdef OR p.proretset OR p.proleakproof) AND p.provolatile='i' AND p.proparallel='u'
    AND p.prorettype='pg_catalog.jsonb'::regtype AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
    AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='70cfbea26f01c95b0e4a7b5674829aae767718bad7513ba69a496b55fb4eb9c2') THEN
    RAISE EXCEPTION '对上登记有限源配方已变化' USING ERRCODE='55000';
  END IF;
  expected:=public.jg_upward_archive_recipe_v2();
  IF jsonb_array_length(binding."routines")<>jsonb_array_length(expected)
    OR (SELECT count(DISTINCT value->>'signature') FROM jsonb_array_elements(binding."routines"))<>jsonb_array_length(expected) THEN
    RAISE EXCEPTION '对上登记源码闭包不完整' USING ERRCODE='55000';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(binding."routines") LOOP
    SELECT p.*,to_jsonb(p)-'prosrc' AS metadata,l.lanname INTO STRICT actual FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE p.oid=(item->>'oid')::oid;
    SELECT value INTO STRICT expected FROM jsonb_array_elements(public.jg_upward_archive_recipe_v2())
      WHERE value->>'signature'=item->>'signature';
    IF actual.oid IS DISTINCT FROM to_regprocedure(item->>'signature')::oid
      OR actual.proowner<>binding."anchorOwnerOid" OR actual.pronamespace<>binding."namespaceOid"
      OR actual.metadata IS DISTINCT FROM item->'metadata' OR actual.lanname IS DISTINCT FROM expected->>'language'
      OR actual.prokind<>'f' OR actual.proretset IS DISTINCT FROM (expected->>'returnsSet')::boolean OR actual.proleakproof OR actual.pronargdefaults<>0 OR actual.provariadic<>0
      OR actual.prorettype IS DISTINCT FROM to_regtype(expected->>'result')::oid
      OR actual.prosecdef IS DISTINCT FROM (expected->>'definer')::boolean
      OR actual.proisstrict IS DISTINCT FROM (expected->>'strict')::boolean
      OR actual.provolatile::text IS DISTINCT FROM expected->>'volatility' OR actual.proparallel<>'u'
      OR actual.proconfig IS DISTINCT FROM ARRAY[expected->>'path']
      OR encode(public.digest(convert_to(actual.prosrc,'UTF8'),'sha256'),'hex') IS DISTINCT FROM expected->>'sha256' THEN
      RAISE EXCEPTION '对上登记已绑定源码或元数据变化' USING ERRCODE='55000';
    END IF;
    IF expected ? 'callers' AND EXISTS(
      SELECT 1 FROM aclexplode(COALESCE(actual.proacl,acldefault('f',actual.proowner))) routine_acl
      WHERE routine_acl.grantor<>actual.proowner OR routine_acl.privilege_type<>'EXECUTE'
        OR routine_acl.grantee<>actual.proowner AND (routine_acl.is_grantable OR NOT EXISTS(
          SELECT 1 FROM jsonb_array_elements_text(expected->'callers') AS expected_callers(role_name)
          WHERE routine_acl.grantee=CASE expected_callers.role_name
            WHEN 'application' THEN binding."applicationRoleOid" WHEN 'runtime' THEN binding."runtimeSessionOid"
            WHEN 'issuer' THEN issuer."issuerSessionOid" WHEN 'issuer_owner' THEN issuer."issuerOwnerOid"
            WHEN 'outside_executor' THEN outside."executorOwnerOid" END))) THEN
      RAISE EXCEPTION '对上固定源码存在配方外执行权限' USING ERRCODE='55000';
    END IF;
  END LOOP;
  IF (SELECT array_agg(splice_rows.value->>'signature' ORDER BY splice_rows.value->>'signature' COLLATE "C") FROM jsonb_array_elements(binding."splices") AS splice_rows(value))
    IS DISTINCT FROM public.jg_upward_archive_splice_signatures_v2() THEN
    RAISE EXCEPTION '对上登记守卫闭包不完整或重复' USING ERRCODE='55000';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(binding."splices") LOOP
    SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT actual FROM pg_catalog.pg_proc p
      WHERE p.oid=(item->>'oid')::oid AND p.oid=to_regprocedure(item->>'signature');
    SELECT value INTO STRICT expected FROM jsonb_array_elements(public.jg_upward_archive_splice_metadata_v2())
      WHERE value->>'signature'=item->>'signature';
    IF actual.metadata IS DISTINCT FROM item->'metadata' OR actual.prosecdef IS DISTINCT FROM (expected->>'definer')::boolean
      OR actual.proisstrict IS DISTINCT FROM (expected->>'strict')::boolean OR actual.provolatile::text IS DISTINCT FROM expected->>'volatility'
      OR actual.prorettype IS DISTINCT FROM to_regtype(expected->>'result')::oid OR actual.proconfig IS DISTINCT FROM ARRAY[expected->>'path']
      OR actual.prosrc IS DISTINCT FROM public.jg_upward_archive_transform_v2(item->>'signature',item->>'beforeBody') THEN
      RAISE EXCEPTION '对上登记精确后继与前态不一致' USING ERRCODE='55000';
    END IF;
  END LOOP;
  IF jsonb_array_length(binding."triggers")<>(SELECT count(*) FROM pg_catalog.pg_trigger t
    WHERE NOT t.tgisinternal AND t.tgrelid IN (
      'public."Contract"'::regclass,'public."ContractVersion"'::regclass,'public."Project"'::regclass,
      'public."PaymentTermsVersion"'::regclass,'public."ContractArchiveFile"'::regclass,
      'public."ContractArchiveEvidenceFile"'::regclass,'public."ContractDraftAttachment"'::regclass,'public."FileObject"'::regclass,
      'public.jg_contract_direct_upward_closure_v2'::regclass,'public.jg_contract_direct_upward_execution_binding_v2'::regclass,
      'public.jg_contract_direct_upward_use_v2'::regclass,'public.jg_contract_direct_upward_issuer_binding_v2'::regclass,
      'public.jg_contract_direct_upward_intent_receipt_v2'::regclass))
    OR (SELECT count(DISTINCT value->>'oid') FROM jsonb_array_elements(binding."triggers"))<>jsonb_array_length(binding."triggers")
    OR NOT (SELECT array_agg(value->'metadata'->>'tgname') FROM jsonb_array_elements(binding."triggers")) @> ARRAY[
      'jg_direct_pending_version_shape','jg_upward_pending_save_persistent_proof','jg_generated_upward_seal_version',
      'ContractArchiveFile_v2_immutable','ContractArchiveEvidenceFile_immutable','ContractArchiveFile_v2_complete',
      'ContractArchiveEvidenceFile_v2_complete','ContractArchiveFile_direct_complete_v1','ContractArchiveEvidenceFile_direct_complete_v1',
      'ContractArchiveFile_direct_generations_v1','ContractDraftAttachment_direct_archive_transfer_v1',
      'jg_direct_pending_file_retained','FileObject_contract_direct_archive_retention_v1'] THEN
    RAISE EXCEPTION '对上登记事务守卫集合不完整' USING ERRCODE='55000';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(binding."triggers") LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
      WHERE t.oid=(item->>'oid')::oid AND to_jsonb(t)=item->'metadata' AND t.tgenabled='O' AND NOT t.tgisinternal
        AND to_jsonb(p)-'prosrc'=item->'routineMetadata'
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=item->>'routineBodySha256') THEN
      RAISE EXCEPTION '对上登记原守卫接线或源码已变化' USING ERRCODE='55000';
    END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.oid=binding."constraintOid"
    AND c.conrelid='public."ContractVersion"'::regclass AND c.conname='ContractVersion_upward_draft_source_check'
    AND c.contype='c' AND c.convalidated AND c.conislocal
    AND pg_get_constraintdef(c.oid,false)=binding."constraintDefinition")
    OR binding."constraintOid"=binding."priorConstraintOid"
    OR NOT EXISTS(SELECT 1 FROM public.jg_contract_generated_archive_version_transition_v1 prior_binding
      WHERE prior_binding."protocolVersion"=1 AND prior_binding."upwardConstraintOid"=binding."priorConstraintOid"
        AND prior_binding."upwardConstraintSha256"=encode(public.digest(convert_to(binding."priorConstraintDefinition",'UTF8'),'sha256'),'hex')) THEN
    RAISE EXCEPTION '对上生效来源约束后继已变化' USING ERRCODE='55000';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc predicate JOIN pg_catalog.pg_language l ON l.oid=predicate.prolang
    JOIN pg_catalog.pg_class version_table ON version_table.oid='public."ContractVersion"'::regclass
    JOIN pg_catalog.pg_constraint constrained ON constrained.oid=binding."constraintOid"
    WHERE predicate.oid=to_regprocedure('public.jg_upward_archive_constraint_v2(public."ContractVersion")')
      AND predicate.proowner=binding."anchorOwnerOid" AND predicate.pronamespace=binding."namespaceOid"
      AND predicate.prokind='f' AND predicate.pronargs=1 AND predicate.proargtypes[0]=version_table.reltype
      AND predicate.prorettype='pg_catalog.bool'::regtype AND predicate.provolatile='i' AND predicate.proparallel='u'
      AND NOT(predicate.prosecdef OR predicate.proisstrict OR predicate.proretset OR predicate.proleakproof)
      AND predicate.proargnames=ARRAY['p_candidate']::text[] AND predicate.pronargdefaults=0 AND predicate.provariadic=0 AND predicate.prosupport=0 AND l.lanname='sql'
      AND predicate.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
      AND predicate.prosrc=public.jg_upward_archive_constraint_body_v2(binding."priorConstraintDefinition")
      AND constrained.conkey=ARRAY[0]::smallint[]
      AND pg_get_expr(constrained.conbin,constrained.conrelid,false) IN(
        'public.jg_upward_archive_constraint_v2("ContractVersion".*)',
        'public.jg_upward_archive_constraint_v2("ContractVersion")',
        '(public.jg_upward_archive_constraint_v2("ContractVersion".*))',
        '(public.jg_upward_archive_constraint_v2("ContractVersion"))')
      AND EXISTS(SELECT 1 FROM pg_catalog.pg_depend dep WHERE dep.classid='pg_catalog.pg_constraint'::regclass
        AND dep.objid=constrained.oid AND dep.refclassid='pg_catalog.pg_proc'::regclass
        AND dep.refobjid=predicate.oid AND dep.deptype='n')
      AND has_function_privilege(binding."applicationRoleOid",predicate.oid,'EXECUTE')
      AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(predicate.proacl,acldefault('f',predicate.proowner))) acl
        WHERE acl.grantor<>predicate.proowner OR acl.grantee NOT IN(predicate.proowner,binding."applicationRoleOid")
          OR acl.privilege_type<>'EXECUTE' OR acl.grantee<>predicate.proowner AND acl.is_grantable)) THEN
    RAISE EXCEPTION '对上来源约束必须独立重建原表达式与固定Q2后继' USING ERRCODE='55000';
  END IF;
  RETURN result;
END;
$source$;

CREATE FUNCTION public.jg_require_contract_direct_upward_execution_v2(p_nonce UUID) RETURNS TEXT
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $execution$
DECLARE binding RECORD; source_sha TEXT;
BEGIN
  source_sha:=public.jg_require_contract_direct_upward_source_v2();
  SELECT b.*,issuer."channelNonce" INTO STRICT binding FROM public.jg_contract_direct_upward_execution_binding_v2 b
    JOIN public.jg_contract_direct_upward_issuer_binding_v2 issuer ON issuer.tableoid=b."issuerBindingOid"
      AND encode(public.digest(convert_to(to_jsonb(issuer)::text,'UTF8'),'sha256'),'hex')=b."issuerBindingSha256"
    WHERE b."protocolVersion"=2 AND b."sourceClosureSha256"=source_sha
      AND b."anchorOwnerOid"=current_user::regrole::oid AND b."runtimeSessionOid"=session_user::regrole::oid;
  IF p_nonce IS DISTINCT FROM binding."channelNonce" OR inet_client_addr() IS NULL
    OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) THEN
    RAISE EXCEPTION '对上登记须使用当前绑定的独立TLS连接' USING ERRCODE='42501';
  END IF;
  RETURN source_sha;
END;
$execution$;

CREATE FUNCTION public.jg_upward_archive_legacy_source_sha_v2(p_routine OID) RETURNS TEXT
LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $legacy_hash$
DECLARE source_sha TEXT; before_body TEXT; actual_body TEXT;
BEGIN
  source_sha:=public.jg_require_contract_direct_upward_source_v2();
  SELECT item->>'beforeBody' INTO before_body FROM public.jg_contract_direct_upward_closure_v2 b,
    LATERAL jsonb_array_elements(b."splices") item WHERE b."protocolVersion"=2 AND (item->>'oid')::oid=p_routine;
  IF FOUND THEN RETURN encode(public.digest(convert_to(before_body,'UTF8'),'sha256'),'hex'); END IF;
  SELECT prosrc INTO STRICT actual_body FROM pg_catalog.pg_proc WHERE oid=p_routine;
  RETURN encode(public.digest(convert_to(actual_body,'UTF8'),'sha256'),'hex');
END;
$legacy_hash$;

CREATE FUNCTION public.jg_prepare_upward_direct_archive_v1(p_version TEXT,p_actor TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $prepare$
BEGIN
  PERFORM public.jg_upward_direct_archive_admission_v1();
  IF NOT EXISTS(SELECT 1 FROM public."ContractVersion" v JOIN public."Contract" c ON c."id"=v."contractId"
    JOIN public."User" actor ON actor."id"=p_actor AND actor."isActive"
    WHERE v."id"=p_version AND c."ownerUserId"=p_actor AND c."voidedAt" IS NULL
      AND (EXISTS(SELECT 1 FROM public."ProjectMember" member WHERE member."projectId"=c."projectId"
        AND member."userId"=p_actor AND member."positionKey"='contract_staff')
        OR EXISTS(SELECT 1 FROM public."UserPosition" up JOIN public."Position" pos ON pos."id"=up."positionId"
          WHERE up."userId"=p_actor AND up."projectId" IS NULL AND pos."key"='contract_director'))) THEN
    RAISE EXCEPTION '当前经办人已无对上登记资格' USING ERRCODE='42501';
  END IF;
  RETURN public.jg_contract_upward_pending_read_v1(p_version,p_actor);
END;
$prepare$;

REVOKE ALL ON FUNCTION public.jg_guard_upward_archive_closure_v2(),public.jg_upward_archive_transform_v2(TEXT,TEXT) FROM PUBLIC;
CREATE FUNCTION public.jg_upward_archive_splice_signatures_v2() RETURNS TEXT[]
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $signatures$
  SELECT ARRAY['public.jg_check_contract_direct_upward_issuer_v2()','public.jg_check_contract_upward_pending_save_v1()','public.jg_contract_archive_v2_complete_guard()','public.jg_contract_archive_v2_ownership_day(text)','public.jg_execute_direct_outside_operating_v2(uuid,uuid,text,text,text,text,integer,text,text,jsonb)','public.jg_guard_contract_direct_archive_parent_v1(public."ContractArchiveFile")','public.jg_guard_contract_direct_archive_slot_v1()','public.jg_guard_contract_upward_pending_save_v1(public."ContractVersion",public."ContractVersion")','public.jg_guard_generated_upward_seal_completion_v1()','public.jg_issue_contract_direct_upward_intent_v2(uuid,text,text,text,text,integer,text,text,jsonb)','public.jg_require_contract_direct_archive_complete_v1()','public.jg_require_contract_direct_archive_generations_v1()']::text[];
$signatures$;
REVOKE ALL ON FUNCTION public.jg_upward_archive_splice_signatures_v2() FROM PUBLIC;

CREATE FUNCTION public.jg_upward_issuer_channel_v2(p_nonce UUID) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $issuer_channel$
BEGIN
  PERFORM public.jg_require_contract_direct_upward_source_v2();
  RETURN inet_client_addr() IS NOT NULL AND current_setting('session_replication_role')='origin'
    AND EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
    AND EXISTS(SELECT 1 FROM public.jg_contract_direct_upward_issuer_binding_v2 b
      WHERE b."protocolVersion"=2 AND b."anchorOwnerOid"=current_user::regrole::oid
        AND b."issuerSessionOid"=session_user::regrole::oid AND b."channelNonce"=p_nonce);
END;
$issuer_channel$;
REVOKE ALL ON FUNCTION public.jg_upward_issuer_channel_v2(UUID),
  public.jg_require_contract_direct_upward_source_v2(),public.jg_require_contract_direct_upward_execution_v2(UUID),
  public.jg_upward_archive_legacy_source_sha_v2(OID),public.jg_prepare_upward_direct_archive_v1(TEXT,TEXT) FROM PUBLIC;

CREATE FUNCTION public.jg_read_upward_issuer_outside_binding_v2() RETURNS SETOF public.jg_contract_direct_archive_intent_binding_v1
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $issuer_binding$
BEGIN
  PERFORM public.jg_require_contract_direct_upward_source_v2();
  IF NOT EXISTS(SELECT 1 FROM public.jg_contract_direct_upward_issuer_binding_v2 i
    WHERE i."protocolVersion"=2 AND i."anchorOwnerOid"=current_user::regrole::oid
      AND i."issuerSessionOid"=session_user::regrole::oid)
    OR inet_client_addr() IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) THEN
    RAISE EXCEPTION '对上发行目录只能经当前独立连接读取' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT outside_row.* FROM public.jg_contract_direct_archive_intent_binding_v1 outside_row
    JOIN public.jg_contract_direct_upward_issuer_binding_v2 i ON i."protocolVersion"=2
      AND i."outsideBindingSha256"=encode(public.digest(convert_to(to_jsonb(outside_row)::text,'UTF8'),'sha256'),'hex')
    WHERE outside_row."protocolVersion"=1;
END;
$issuer_binding$;

CREATE FUNCTION public.jg_read_upward_issuer_basis_v2(
  p_actor TEXT,p_project TEXT,p_contract TEXT,p_version TEXT,p_revision INTEGER,p_input_sha TEXT,p_key TEXT,p_evidence JSONB
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $issuer_basis$
BEGIN
  PERFORM public.jg_require_contract_direct_upward_source_v2();
  IF NOT EXISTS(SELECT 1 FROM public.jg_contract_direct_upward_issuer_binding_v2 i
    WHERE i."protocolVersion"=2 AND i."anchorOwnerOid"=current_user::regrole::oid
      AND i."issuerSessionOid"=session_user::regrole::oid)
    OR inet_client_addr() IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) THEN
    RAISE EXCEPTION '对上发行依据只能经当前独立连接读取' USING ERRCODE='42501';
  END IF;
  RETURN public.jg_contract_direct_archive_upward_intent_basis_v2(p_actor,p_project,p_contract,p_version,p_revision,p_input_sha,p_key,p_evidence);
END;
$issuer_basis$;
REVOKE ALL ON FUNCTION public.jg_read_upward_issuer_outside_binding_v2(),
  public.jg_read_upward_issuer_basis_v2(TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,JSONB) FROM PUBLIC;


CREATE FUNCTION public.jg_upward_archive_catalog_projection_v2() RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog, pg_temp AS $projection$
DECLARE closure_row public.jg_contract_direct_upward_closure_v2%ROWTYPE; issuer_row RECORD; closure_sha TEXT; routine_map JSONB; definers JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_database d ON d.datname=current_database()
    WHERE p.oid=to_regprocedure('public.jg_require_contract_direct_upward_source_v2()') AND p.proowner=d.datdba
      AND p.pronamespace=to_regnamespace('public') AND p.prokind='f' AND NOT p.prosecdef AND p.provolatile='v'
      AND p.prorettype='pg_catalog.text'::regtype AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='9af4c2c58ac1adabb2580d76f90130c856dd1743f608824859a44d1bb5b3c0c4') THEN
    RAISE EXCEPTION '对上登记来源核对器已变化' USING ERRCODE='55000';
  END IF;
  closure_sha:=public.jg_require_contract_direct_upward_source_v2();
  SELECT b.* INTO STRICT closure_row FROM public.jg_contract_direct_upward_closure_v2 b
    WHERE b."protocolVersion"=2 AND b."anchorOwnerOid"=current_user::regrole::oid
      AND b."applicationRoleOid"=session_user::regrole::oid;
  SELECT i.* INTO STRICT issuer_row FROM public.jg_contract_direct_upward_issuer_binding_v2 i
    WHERE i.tableoid=closure_row."issuerBindingOid" AND i."protocolVersion"=2;
  SELECT jsonb_agg(jsonb_build_object('signature',item->>'signature','oid',item->>'oid',
    'ownerOid',item->'metadata'->>'proowner','namespaceOid',item->'metadata'->>'pronamespace',
    'beforeSha256',encode(public.digest(convert_to(item->>'beforeBody','UTF8'),'sha256'),'hex'),
    'afterSha256',encode(public.digest(convert_to(public.jg_upward_archive_transform_v2(item->>'signature',item->>'beforeBody'),'UTF8'),'sha256'),'hex'))
    ORDER BY item->>'signature' COLLATE "C") INTO routine_map FROM jsonb_array_elements(closure_row."splices") item;
  SELECT jsonb_agg(jsonb_build_object('oid',p.oid::text,'signature',target.signature,
    'bodySha256',encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')) ORDER BY target.signature COLLATE "C") INTO definers
    FROM (VALUES('public.jg_upward_archive_catalog_projection_v2()'),('public.jg_read_upward_direct_archive_v1(text)'),
      ('public.jg_upward_archive_ownership_day_v2(text)')) target(signature)
    JOIN pg_catalog.pg_proc p ON p.oid=to_regprocedure(target.signature) AND p.proowner=closure_row."anchorOwnerOid"
      AND p.pronamespace=closure_row."namespaceOid" AND p.prosecdef;
  RETURN jsonb_build_object('protocolVersion',2,'recipeVersion','contract-upward-direct-archive-v2/1','sourceClosureSha256',closure_sha,
    'databaseOid',closure_row."databaseOid"::text,'namespaceOid',closure_row."namespaceOid"::text,'anchorOwnerOid',closure_row."anchorOwnerOid"::text,
    'currentRoleOid',session_user::regrole::oid::text,'sessionRoleOid',session_user::regrole::oid::text,
    'backendPid',pg_backend_pid(),'transactionId',txid_current()::text,'nonce',issuer_row."channelNonce"::text,
    'routines',routine_map,'constraint',jsonb_build_object('beforeOid',closure_row."priorConstraintOid"::text,'afterOid',closure_row."constraintOid"::text,
      'beforeSha256',encode(public.digest(convert_to(closure_row."priorConstraintDefinition",'UTF8'),'sha256'),'hex'),
      'afterSha256',encode(public.digest(convert_to(closure_row."constraintDefinition",'UTF8'),'sha256'),'hex')),'definers',definers);
END;
$projection$;
REVOKE ALL ON FUNCTION public.jg_upward_archive_catalog_projection_v2() FROM PUBLIC;

CREATE FUNCTION public.jg_upward_direct_archive_admission_v1() RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $admission$
DECLARE projected JSONB;
BEGIN
  IF current_user IS DISTINCT FROM session_user OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_database d ON d.datname=current_database()
      WHERE p.oid=to_regprocedure('public.jg_upward_archive_catalog_projection_v2()') AND p.proowner=d.datdba
        AND p.pronamespace=to_regnamespace('public') AND p.prokind='f' AND p.prosecdef AND p.provolatile='v'
        AND p.prorettype='pg_catalog.jsonb'::regtype AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='785c21ee595eb128fa0911d3f18c9718457615f1d6df1abf532bf4159659210c') THEN
    RAISE EXCEPTION '对上登记来源投影尚未完整核对' USING ERRCODE='55000';
  END IF;
  projected:=public.jg_upward_archive_catalog_projection_v2();
  RETURN jsonb_build_object('nonce',projected->>'nonce','databaseOid',projected->>'databaseOid','roleOid',current_user::regrole::oid::text,
    'backendPid',pg_backend_pid(),'transactionId',txid_current()::text);
END;
$admission$;
REVOKE ALL ON FUNCTION public.jg_upward_direct_archive_admission_v1() FROM PUBLIC;

CREATE FUNCTION public.jg_install_contract_direct_upward_v2(
  p_issuer_login TEXT,p_issuer_owner TEXT,p_runtime_login TEXT,p_channel_nonce UUID
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $install$
DECLARE
  owner_oid OID:=current_user::regrole::oid; database_oid OID; namespace_oid OID:=to_regnamespace('public');
  outside_binding public.jg_contract_direct_archive_intent_binding_v1%ROWTYPE;
  issuer_binding public.jg_contract_direct_upward_issuer_binding_v2%ROWTYPE;
  closure_row public.jg_contract_direct_upward_closure_v2%ROWTYPE;
  issuer_login_oid OID; issuer_owner_oid OID; runtime_login_oid OID;
  signature TEXT; item JSONB; entry RECORD; before_body TEXT; next_body TEXT; before_metadata JSONB;
  splice_rows JSONB:='[]'::jsonb; trigger_rows JSONB; routine_rows JSONB:='[]'::jsonb;
  old_constraint RECORD; after_constraint RECORD; old_expression TEXT; next_expression TEXT; closure_sha TEXT;
  expected_owner OID; splice_descriptor JSONB; allowed_caller OID; role_name NAME; installer_oid OID:=to_regprocedure('public.jg_install_contract_direct_upward_v2(text,text,text,uuid)');

BEGIN
  SELECT d.oid INTO STRICT database_oid FROM pg_catalog.pg_database d WHERE d.datname=current_database() AND d.datdba=owner_oid;
  IF current_user IS DISTINCT FROM session_user OR current_setting('session_replication_role')<>'origin'
    OR inet_client_addr() IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=installer_oid AND p.proowner=owner_oid AND p.pronamespace=namespace_oid)
    OR EXISTS(SELECT 1 FROM public.jg_contract_direct_upward_closure_v2)
    OR EXISTS(SELECT 1 FROM public.jg_contract_direct_upward_execution_binding_v2) THEN
    RAISE EXCEPTION '对上登记后继只能由当前所有者TLS会话一次安装' USING ERRCODE='55000';
  END IF;
  SELECT * INTO STRICT outside_binding FROM public.jg_contract_direct_archive_intent_binding_v1 WHERE "protocolVersion"=1;
  IF outside_binding."databaseOid"<>database_oid OR outside_binding."namespaceOid"<>namespace_oid OR outside_binding."anchorOwnerOid"<>owner_oid THEN
    RAISE EXCEPTION '对上登记不得更换原数据库或所有者' USING ERRCODE='55000';
  END IF;
  SELECT r.oid INTO STRICT issuer_login_oid FROM pg_catalog.pg_roles r WHERE r.rolname=p_issuer_login AND r.rolcanlogin;
  SELECT r.oid INTO STRICT issuer_owner_oid FROM pg_catalog.pg_roles r WHERE r.rolname=p_issuer_owner AND NOT r.rolcanlogin;
  SELECT r.oid INTO STRICT runtime_login_oid FROM pg_catalog.pg_roles r WHERE r.rolname=p_runtime_login AND r.rolcanlogin;
  IF (SELECT count(DISTINCT id) FROM unnest(ARRAY[issuer_login_oid,issuer_owner_oid,runtime_login_oid]) id)<>3
    OR ARRAY[issuer_login_oid,issuer_owner_oid,runtime_login_oid] && ARRAY[owner_oid,outside_binding."ordinaryApplicationRoleOid",
      outside_binding."issuerSessionOid",outside_binding."issuerOwnerOid",outside_binding."runtimeSessionOid",outside_binding."executorOwnerOid"]
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=ANY(ARRAY[issuer_login_oid,issuer_owner_oid,runtime_login_oid])
      AND (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls
        OR has_schema_privilege(r.oid,namespace_oid,'CREATE')
        OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles other WHERE other.oid<>r.oid
          AND (pg_has_role(r.oid,other.oid,'MEMBER') OR (NOT other.rolsuper AND other.oid<>owner_oid AND pg_has_role(other.oid,r.oid,'MEMBER')))))) THEN
    RAISE EXCEPTION '对上登记专用角色必须独立且无继承业务权限' USING ERRCODE='55000';
  END IF;
  LOCK TABLE public."Contract",public."ContractVersion",public."Project",public."ContractArchiveFile",
    public."ContractArchiveEvidenceFile",public."ContractDraftAttachment",public."FileObject",public."PaymentTermsVersion" IN ACCESS EXCLUSIVE MODE NOWAIT;
  LOCK TABLE public.jg_contract_direct_archive_intent_binding_v1,public.jg_contract_direct_upward_issuer_binding_v2,
    public.jg_contract_direct_upward_intent_receipt_v2 IN SHARE MODE NOWAIT;
  SELECT c.*,pg_get_constraintdef(c.oid,false) AS definition,pg_get_expr(c.conbin,c.conrelid,false) AS expression
    INTO STRICT old_constraint FROM pg_catalog.pg_constraint c
    JOIN public.jg_contract_generated_archive_version_transition_v1 previous_binding ON previous_binding."protocolVersion"=1
      AND previous_binding."upwardConstraintOid"=c.oid
      AND previous_binding."upwardConstraintSha256"=encode(public.digest(convert_to(pg_get_constraintdef(c.oid,false),'UTF8'),'sha256'),'hex')
    WHERE c.conrelid='public."ContractVersion"'::regclass AND c.conname='ContractVersion_upward_draft_source_check'
      AND c.contype='c' AND c.convalidated AND c.conislocal;

  -- Existing 234 issuer entry, roles and receipt remain the authority. Only
  -- fixed anchor-read bridges are granted, never SELECT on business tables.
  IF EXISTS(SELECT 1 FROM public.jg_contract_direct_upward_issuer_binding_v2) THEN
    SELECT * INTO STRICT issuer_binding FROM public.jg_contract_direct_upward_issuer_binding_v2 WHERE "protocolVersion"=2;
    IF issuer_binding."issuerSessionOid"<>issuer_login_oid OR issuer_binding."issuerOwnerOid"<>issuer_owner_oid
      OR issuer_binding."channelNonce"<>p_channel_nonce OR issuer_binding."databaseOid"<>database_oid
      OR issuer_binding."namespaceOid"<>namespace_oid OR issuer_binding."anchorOwnerOid"<>owner_oid
      OR issuer_binding."outsideBindingSha256"<>encode(public.digest(convert_to(to_jsonb(outside_binding)::text,'UTF8'),'sha256'),'hex') THEN
      RAISE EXCEPTION '原对上发行绑定不得替换' USING ERRCODE='55000';
    END IF;
  ELSE
    IF EXISTS(SELECT 1 FROM public.jg_contract_direct_upward_intent_receipt_v2) THEN
      RAISE EXCEPTION '对上发行收据不能失去原角色绑定' USING ERRCODE='55000';
    END IF;
    INSERT INTO public.jg_contract_direct_upward_issuer_binding_v2("protocolVersion","databaseOid","namespaceOid","anchorOwnerOid",
      "issuerSessionOid","issuerOwnerOid","channelNonce","outsideBindingSha256","basisRoutineOid")
    VALUES(2,database_oid,namespace_oid,owner_oid,issuer_login_oid,issuer_owner_oid,p_channel_nonce,
      encode(public.digest(convert_to(to_jsonb(outside_binding)::text,'UTF8'),'sha256'),'hex'),
      'public.jg_contract_direct_archive_upward_intent_basis_v2(text,text,text,text,integer,text,text,jsonb)'::regprocedure);
    SELECT * INTO STRICT issuer_binding FROM public.jg_contract_direct_upward_issuer_binding_v2 WHERE "protocolVersion"=2;
    EXECUTE format('ALTER FUNCTION public.jg_issue_contract_direct_upward_intent_v2(uuid,text,text,text,text,integer,text,text,jsonb) OWNER TO %I',p_issuer_owner);
  END IF;
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I,%I,%I',p_issuer_login,p_issuer_owner,p_runtime_login);
  EXECUTE format('GRANT SELECT ON TABLE public.jg_contract_direct_upward_issuer_binding_v2 TO %I',p_issuer_owner);
  EXECUTE format('GRANT INSERT ON TABLE public.jg_contract_direct_upward_intent_receipt_v2 TO %I',p_issuer_owner);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_check_contract_direct_upward_issuer_v2(),public.jg_guard_contract_direct_upward_intent_v2(),public.jg_read_upward_issuer_outside_binding_v2(),public.jg_read_upward_issuer_basis_v2(text,text,text,text,integer,text,text,jsonb),public.jg_upward_archive_legacy_source_sha_v2(oid) TO %I',p_issuer_owner);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_issue_contract_direct_upward_intent_v2(uuid,text,text,text,text,integer,text,text,jsonb),public.jg_upward_issuer_channel_v2(uuid) TO %I',p_issuer_login);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_execute_contract_direct_upward_v2(uuid,uuid,text,text,text,text,integer,text,text,jsonb) TO %I',p_runtime_login);
  SELECT r.rolname INTO STRICT role_name FROM pg_catalog.pg_roles r WHERE r.oid=outside_binding."ordinaryApplicationRoleOid";
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_upward_archive_catalog_projection_v2(),public.jg_upward_direct_archive_admission_v1(),public.jg_prepare_upward_direct_archive_v1(text,text),public.jg_read_upward_direct_archive_v1(text),public.jg_upward_archive_ownership_day_v2(text),public.jg_guard_upward_archive_version_v2(public."ContractVersion",public."ContractVersion"),public.jg_upward_archive_constraint_v2(public."ContractVersion") TO %I',role_name);
  SELECT r.rolname INTO STRICT role_name FROM pg_catalog.pg_roles r WHERE r.oid=outside_binding."executorOwnerOid";
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_upward_archive_legacy_source_sha_v2(oid) TO %I',role_name);

  FOREACH signature IN ARRAY public.jg_upward_archive_splice_signatures_v2() LOOP
    expected_owner:=CASE signature
      WHEN 'public.jg_issue_contract_direct_upward_intent_v2(uuid,text,text,text,text,integer,text,text,jsonb)' THEN issuer_owner_oid
      WHEN 'public.jg_execute_direct_outside_operating_v2(uuid,uuid,text,text,text,text,integer,text,text,jsonb)' THEN outside_binding."executorOwnerOid"
      ELSE owner_oid END;
    SELECT value INTO STRICT splice_descriptor FROM jsonb_array_elements(public.jg_upward_archive_splice_metadata_v2())
      WHERE value->>'signature'=signature;
    allowed_caller:=CASE splice_descriptor->>'caller' WHEN 'app' THEN outside_binding."ordinaryApplicationRoleOid"
      WHEN 'outsideOwner' THEN outside_binding."executorOwnerOid" WHEN 'outsideLogin' THEN outside_binding."runtimeSessionOid"
      WHEN 'upwardIssuerOwner' THEN issuer_owner_oid WHEN 'upwardIssuerLogin' THEN issuer_login_oid ELSE expected_owner END;
    SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT entry FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
      WHERE p.oid=to_regprocedure(signature) AND p.proowner=expected_owner AND p.pronamespace=namespace_oid
        AND p.prokind='f' AND p.proparallel='u' AND NOT(p.proleakproof OR p.proretset) AND p.pronargdefaults=0 AND p.provariadic=0 AND p.prosupport=0
        AND p.prosecdef=(splice_descriptor->>'definer')::boolean AND p.proisstrict=(splice_descriptor->>'strict')::boolean
        AND p.provolatile::text=splice_descriptor->>'volatility' AND p.prorettype=to_regtype(splice_descriptor->>'result')::oid
        AND p.proconfig=ARRAY[splice_descriptor->>'path']
        AND NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
          WHERE a.grantor<>p.proowner OR a.grantee NOT IN(p.proowner,allowed_caller) OR a.privilege_type<>'EXECUTE'
            OR a.grantee<>p.proowner AND a.is_grantable)
        AND (allowed_caller=expected_owner OR EXISTS(SELECT 1 FROM aclexplode(p.proacl) a
          WHERE a.grantor=p.proowner AND a.grantee=allowed_caller AND a.privilege_type='EXECUTE' AND NOT a.is_grantable));
    before_body:=entry.prosrc; before_metadata:=entry.metadata;
    next_body:=public.jg_upward_archive_transform_v2(signature,before_body);
    IF cardinality(string_to_array(pg_get_functiondef(entry.oid),before_body))<>2 THEN
      RAISE EXCEPTION '对上登记守卫前态正文不唯一' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(pg_get_functiondef(entry.oid),before_body,next_body);
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=entry.oid AND p.prosrc=next_body
      AND to_jsonb(p)-'prosrc'=before_metadata) THEN
      RAISE EXCEPTION '对上登记后继必须保留原对象、属性和权限' USING ERRCODE='55000';
    END IF;
    splice_rows:=splice_rows||jsonb_build_array(jsonb_build_object('signature',signature,'oid',entry.oid::text,
      'beforeBody',before_body,'metadata',before_metadata));
  END LOOP;
  old_expression:=old_constraint.expression;
  IF old_constraint.definition IS DISTINCT FROM 'CHECK ('||old_expression||')' OR old_constraint.connoinherit THEN
    RAISE EXCEPTION '对上原检查定义不能独立重建' USING ERRCODE='55000';
  END IF;
  EXECUTE format('CREATE OR REPLACE FUNCTION public.jg_upward_archive_constraint_v2(p_candidate public."ContractVersion") RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS %L',
    public.jg_upward_archive_constraint_body_v2(old_constraint.definition));
  next_expression:='public.jg_upward_archive_constraint_v2("ContractVersion".*)';
  ALTER TABLE public."ContractVersion" DROP CONSTRAINT "ContractVersion_upward_draft_source_check";
  EXECUTE format('ALTER TABLE public."ContractVersion" ADD CONSTRAINT "ContractVersion_upward_draft_source_check" CHECK (%s)',next_expression);
  SELECT c.*,pg_get_constraintdef(c.oid,false) AS definition INTO STRICT after_constraint FROM pg_catalog.pg_constraint c
    WHERE c.conrelid='public."ContractVersion"'::regclass AND c.conname='ContractVersion_upward_draft_source_check'
      AND c.contype='c' AND c.convalidated AND c.conislocal;
  FOR item IN SELECT value FROM jsonb_array_elements(public.jg_upward_archive_recipe_v2()) LOOP
    SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT entry FROM pg_catalog.pg_proc p
      WHERE p.oid=to_regprocedure(item->>'signature') AND p.proowner=owner_oid AND p.pronamespace=namespace_oid
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=item->>'sha256';
    routine_rows:=routine_rows||jsonb_build_array(jsonb_build_object('signature',item->>'signature','oid',entry.oid::text,'metadata',entry.metadata));
  END LOOP;
  SELECT jsonb_agg(jsonb_build_object('oid',t.oid::text,'metadata',to_jsonb(t),'routineMetadata',to_jsonb(p)-'prosrc',
    'routineBodySha256',encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')) ORDER BY t.oid) INTO trigger_rows
    FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
    WHERE NOT t.tgisinternal AND t.tgrelid IN(
      'public."Contract"'::regclass,'public."ContractVersion"'::regclass,'public."Project"'::regclass,
      'public."PaymentTermsVersion"'::regclass,'public."ContractArchiveFile"'::regclass,'public."ContractArchiveEvidenceFile"'::regclass,
      'public."ContractDraftAttachment"'::regclass,'public."FileObject"'::regclass,'public.jg_contract_direct_upward_closure_v2'::regclass,
      'public.jg_contract_direct_upward_execution_binding_v2'::regclass,'public.jg_contract_direct_upward_use_v2'::regclass,
      'public.jg_contract_direct_upward_issuer_binding_v2'::regclass,'public.jg_contract_direct_upward_intent_receipt_v2'::regclass);
  INSERT INTO public.jg_contract_direct_upward_closure_v2("protocolVersion","recipeVersion","databaseOid","namespaceOid","anchorOwnerOid",
    "applicationRoleOid","runtimeSessionOid","issuerBindingOid","issuerBindingSha256","splices","triggers","routines",
    "priorConstraintOid","priorConstraintDefinition","constraintOid","constraintDefinition")
  VALUES(2,'contract-upward-direct-archive-v2/1',database_oid,namespace_oid,owner_oid,outside_binding."ordinaryApplicationRoleOid",runtime_login_oid,
    'public.jg_contract_direct_upward_issuer_binding_v2'::regclass,encode(public.digest(convert_to(to_jsonb(issuer_binding)::text,'UTF8'),'sha256'),'hex'),
    splice_rows,trigger_rows,routine_rows,old_constraint.oid,old_constraint.definition,after_constraint.oid,after_constraint.definition)
  RETURNING * INTO closure_row;
  closure_sha:=encode(public.digest(convert_to(to_jsonb(closure_row)::text,'UTF8'),'sha256'),'hex');
  INSERT INTO public.jg_contract_direct_upward_execution_binding_v2("protocolVersion","databaseOid","namespaceOid","anchorOwnerOid",
    "applicationRoleOid","runtimeSessionOid","issuerBindingOid","issuerBindingSha256","sourceClosureSha256")
  VALUES(2,database_oid,namespace_oid,owner_oid,outside_binding."ordinaryApplicationRoleOid",runtime_login_oid,
    closure_row."issuerBindingOid",closure_row."issuerBindingSha256",closure_sha);
  IF public.jg_require_contract_direct_upward_source_v2() IS DISTINCT FROM closure_sha THEN
    RAISE EXCEPTION '对上登记后继未完成精确闭包' USING ERRCODE='55000';
  END IF;
  RETURN jsonb_build_object('protocolVersion',2,'sourceClosureSha256',closure_sha,'databaseOid',database_oid::text,
    'applicationRoleOid',outside_binding."ordinaryApplicationRoleOid"::text,'runtimeRoleOid',runtime_login_oid::text);
END;
$install$;
REVOKE ALL ON FUNCTION public.jg_install_contract_direct_upward_v2(TEXT,TEXT,TEXT,UUID) FROM PUBLIC;

CREATE FUNCTION public.jg_upward_archive_splice_metadata_v2() RETURNS JSONB
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $splice_metadata$
  SELECT jsonb_agg(jsonb_build_object('signature',target.signature,'strict',target.signature IN (
      'public.jg_guard_contract_direct_archive_parent_v1(public."ContractArchiveFile")',
      'public.jg_issue_contract_direct_upward_intent_v2(uuid,text,text,text,text,integer,text,text,jsonb)',
      'public.jg_execute_direct_outside_operating_v2(uuid,uuid,text,text,text,text,integer,text,text,jsonb)'),
    'definer',target.signature IN (
      'public.jg_issue_contract_direct_upward_intent_v2(uuid,text,text,text,text,integer,text,text,jsonb)',
      'public.jg_execute_direct_outside_operating_v2(uuid,uuid,text,text,text,text,integer,text,text,jsonb)'),
    'volatility',CASE WHEN target.signature='public.jg_check_contract_direct_upward_issuer_v2()' THEN 's' ELSE 'v' END,
    'result',CASE target.signature
      WHEN 'public.jg_guard_contract_upward_pending_save_v1(public."ContractVersion",public."ContractVersion")' THEN 'public."ContractVersion"'
      WHEN 'public.jg_guard_contract_direct_archive_parent_v1(public."ContractArchiveFile")' THEN 'public."ContractArchiveFile"'
      WHEN 'public.jg_check_contract_direct_upward_issuer_v2()' THEN 'pg_catalog.text'
      WHEN 'public.jg_issue_contract_direct_upward_intent_v2(uuid,text,text,text,text,integer,text,text,jsonb)' THEN 'pg_catalog.uuid'
      WHEN 'public.jg_execute_direct_outside_operating_v2(uuid,uuid,text,text,text,text,integer,text,text,jsonb)' THEN 'pg_catalog.text'
      WHEN 'public.jg_contract_archive_v2_ownership_day(text)' THEN 'pg_catalog.date' ELSE 'pg_catalog.trigger' END,
    'path',CASE WHEN target.signature IN (
      'public.jg_guard_contract_upward_pending_save_v1(public."ContractVersion",public."ContractVersion")',
      'public.jg_check_contract_upward_pending_save_v1()','public.jg_guard_generated_upward_seal_completion_v1()',
      'public.jg_contract_archive_v2_complete_guard()','public.jg_contract_archive_v2_ownership_day(text)') THEN 'search_path=pg_catalog, public'
      WHEN target.signature='public.jg_execute_direct_outside_operating_v2(uuid,uuid,text,text,text,text,integer,text,text,jsonb)' THEN 'search_path=pg_catalog, public, pg_temp'
      ELSE 'search_path=pg_catalog, pg_temp' END,
    'caller',CASE target.signature
      WHEN 'public.jg_guard_contract_upward_pending_save_v1(public."ContractVersion",public."ContractVersion")' THEN 'app'
      WHEN 'public.jg_contract_archive_v2_ownership_day(text)' THEN 'app'
      WHEN 'public.jg_guard_contract_direct_archive_parent_v1(public."ContractArchiveFile")' THEN 'outsideOwner'
      WHEN 'public.jg_execute_direct_outside_operating_v2(uuid,uuid,text,text,text,text,integer,text,text,jsonb)' THEN 'outsideLogin'
      WHEN 'public.jg_check_contract_direct_upward_issuer_v2()' THEN 'upwardIssuerOwner'
      WHEN 'public.jg_issue_contract_direct_upward_intent_v2(uuid,text,text,text,text,integer,text,text,jsonb)' THEN 'upwardIssuerLogin'
      ELSE 'private' END) ORDER BY target.signature COLLATE "C")
  FROM unnest(public.jg_upward_archive_splice_signatures_v2()) target(signature);
$splice_metadata$;
REVOKE ALL ON FUNCTION public.jg_upward_archive_splice_metadata_v2() FROM PUBLIC;

CREATE FUNCTION public.jg_upward_archive_constraint_body_v2(p_before_definition TEXT) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $constraint_body$
DECLARE prior_expression TEXT;
  qualified_new_predicate CONSTANT TEXT:=$effective_q2$
    COALESCE("numericProtocolVersion"=2 AND "signingSubjectType"='upward' AND "versionNo"=1 AND "changeType"='original'
      AND "status"='effective' AND "firstSubmittedAt" IS NULL AND "endedAt" IS NULL
      AND "effectiveAt" IS NOT NULL AND "taxFactsFrozenAt"="effectiveAt"
      AND "baseVersionId" IS NULL AND "supersedesVersionId" IS NULL AND "copiedFromContractVersionId" IS NULL
      AND "draftData"#>'{directSigningInput,protocolVersion}'='2'::jsonb
      AND "draftData"#>>'{directSigningInput,source}'='direct_signed'
      AND "draftData"#>>'{directSigningInput,relationship}'='upward'
      AND "draftData"#>>'{contractBasics,relationship}'='upward'
      AND NULLIF("affiliateAssignmentId",'') IS NOT NULL AND NULLIF("affiliateBusinessPartyVersionId",'') IS NOT NULL
      AND NULLIF("companyEntityIdSnapshot",'') IS NOT NULL AND NULLIF("companyEntityVersionId",'') IS NOT NULL,FALSE)
$effective_q2$;
BEGIN
  IF left(p_before_definition,7)<>'CHECK (' OR right(p_before_definition,1)<>')' THEN
    RAISE EXCEPTION '对上原来源约束不是预期检查表达式' USING ERRCODE='55000';
  END IF;
  prior_expression:=substr(p_before_definition,8,length(p_before_definition)-8);
  RETURN E'\n  SELECT ('||prior_expression||') OR ('||qualified_new_predicate||E') FROM (SELECT (p_candidate).*) AS source_fields;\n';
END;
$constraint_body$;
REVOKE ALL ON FUNCTION public.jg_upward_archive_constraint_body_v2(TEXT) FROM PUBLIC;
CREATE FUNCTION public.jg_upward_archive_constraint_v2(p_candidate public."ContractVersion") RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $constraint_placeholder$
  SELECT FALSE;
$constraint_placeholder$;
REVOKE ALL ON FUNCTION public.jg_upward_archive_constraint_v2(public."ContractVersion") FROM PUBLIC;


CREATE FUNCTION public.jg_upward_archive_recipe_v2() RETURNS JSONB
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $recipe$
  SELECT $recipe_json$[{"signature":"public.jg_assert_upward_archive_complete_v2(TEXT)","sha256":"ca085a27ebb87ffadec6db6fe31f375995b6ffa27581d88ea4977a165c94661f","language":"plpgsql","result":"VOID","definer":false,"strict":true,"returnsSet":false,"volatility":"v","path":"search_path=pg_catalog, pg_temp","callers":[]},{"signature":"public.jg_check_upward_archive_slot_v2(public.\"ContractDraftAttachment\")","sha256":"8321a0bacfc9698b0ba6cad24348d21caf9276c926694cabd0ab157cf38c2074","language":"plpgsql","result":"public.\"ContractDraftAttachment\"","definer":false,"strict":true,"returnsSet":false,"volatility":"v","path":"search_path=pg_catalog, pg_temp","callers":[]},{"signature":"public.jg_contract_archive_v2_evidence_guard()","sha256":"c7d506bd7647e697326e75ccaabf75d331a24df8963e51630db75d9094e39b39","language":"plpgsql","result":"pg_catalog.trigger","definer":false,"strict":false,"returnsSet":false,"volatility":"v","path":"search_path=pg_catalog, public"},{"signature":"public.jg_contract_archive_v2_parent_guard()","sha256":"cbc9b7890e3fe02c730c1fa8617eb8b13b74a401c962083506d8a3372ec7a522","language":"plpgsql","result":"pg_catalog.trigger","definer":false,"strict":false,"returnsSet":false,"volatility":"v","path":"search_path=pg_catalog, public"},{"signature":"public.jg_contract_direct_archive_intent_payload_v1(text,text,text,text,integer,text,text,jsonb)","sha256":"0ae73d99bde8ae0dc87295d5a296844e8c10fb1a70c8b8f96e1a5aa210db8ddc","language":"plpgsql","result":"pg_catalog.jsonb","definer":false,"strict":true,"returnsSet":false,"volatility":"s","path":"search_path=pg_catalog, pg_temp"},{"signature":"public.jg_contract_direct_archive_upward_intent_basis_v2(text,text,text,text,integer,text,text,jsonb)","sha256":"d4a923bb0ccb2df2d38b588d5948e05791c14efe8f67bc3104a700917529314e","language":"plpgsql","result":"pg_catalog.jsonb","definer":false,"strict":true,"returnsSet":false,"volatility":"s","path":"search_path=pg_catalog, pg_temp"},{"signature":"public.jg_contract_direct_pending_version_guard_v1()","sha256":"bbf5b477e867355798c5b99f4c7919baccfbfe7888811eaefccb9ab88a737e9f","language":"plpgsql","result":"pg_catalog.trigger","definer":false,"strict":false,"returnsSet":false,"volatility":"v","path":"search_path=pg_catalog, public"},{"signature":"public.jg_contract_upward_pending_read_v1(text,text)","sha256":"5ab4d19db9a622bd04b533cb86b8868c4c19589c9b90259135069203155218d4","language":"plpgsql","result":"pg_catalog.jsonb","definer":false,"strict":false,"returnsSet":false,"volatility":"s","path":"search_path=pg_catalog, public"},{"signature":"public.jg_execute_contract_direct_upward_v2(UUID,UUID,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,JSONB)","sha256":"c9a0a71f396a1ea5f56807e45ad42babbca8689b96401727b35fd4f94f03a13d","language":"plpgsql","result":"TEXT","definer":true,"strict":true,"returnsSet":false,"volatility":"v","path":"search_path=pg_catalog, pg_temp","callers":["runtime"]},{"signature":"public.jg_guard_contract_direct_upward_execution_v2()","sha256":"938c0507fa2c4faf58b6752e5920a9626442e1e49f6679cffed345087a2c4a65","language":"plpgsql","result":"TRIGGER","definer":false,"strict":false,"returnsSet":false,"volatility":"v","path":"search_path=pg_catalog, pg_temp","callers":[]},{"signature":"public.jg_guard_upward_archive_closure_v2()","sha256":"1cde81e4eef8401587ee41bea667f9d3d6402fdd095ec55a9563f681675cd44f","language":"plpgsql","result":"TRIGGER","definer":false,"strict":false,"returnsSet":false,"volatility":"v","path":"search_path=pg_catalog, pg_temp","callers":[]},{"signature":"public.jg_guard_upward_archive_parent_v2(public.\"ContractArchiveFile\")","sha256":"10a6bf5733b305b8ee5a80c782014677cbc21ae8ffba4ced561f4a3fc9f0b242","language":"plpgsql","result":"public.\"ContractArchiveFile\"","definer":false,"strict":true,"returnsSet":false,"volatility":"v","path":"search_path=pg_catalog, pg_temp","callers":[]},{"signature":"public.jg_guard_upward_archive_version_v2(public.\"ContractVersion\",public.\"ContractVersion\")","sha256":"39d77425108dc7d016981dafb2d9a9138309a544b3af6e1f59275433c69c3c23","language":"plpgsql","result":"public.\"ContractVersion\"","definer":false,"strict":true,"returnsSet":false,"volatility":"v","path":"search_path=pg_catalog, pg_temp","callers":["application"]},{"signature":"public.jg_install_contract_direct_upward_v2(TEXT,TEXT,TEXT,UUID)","sha256":"53d691e74321049c33b9769f433e080540058b00fd5d2ef4045b92abae354ce1","language":"plpgsql","result":"JSONB","definer":false,"strict":true,"returnsSet":false,"volatility":"v","path":"search_path=pg_catalog, pg_temp","callers":[]},{"signature":"public.jg_prepare_upward_direct_archive_v1(TEXT,TEXT)","sha256":"1bf0c7856b933093fb5db75b638e06410222c25122486576dfc8d5295e51c9d8","language":"plpgsql","result":"JSONB","definer":false,"strict":true,"returnsSet":false,"volatility":"v","path":"search_path=pg_catalog, pg_temp","callers":["application"]},{"signature":"public.jg_read_upward_direct_archive_v1(TEXT)","sha256":"cc9ce894e925cc9f9d4b5ce42215b6f7e8714e6a8c5703dc47937e5ecb6570ae","language":"plpgsql","result":"JSONB","definer":true,"strict":true,"returnsSet":false,"volatility":"v","path":"search_path=pg_catalog, pg_temp","callers":["application"]},{"signature":"public.jg_read_upward_issuer_basis_v2(TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,JSONB)","sha256":"0e13bdd3d7491277ebebade2825c83fefe68b3ffab0c62a45427c180b5d64b0e","language":"plpgsql","result":"JSONB","definer":true,"strict":true,"returnsSet":false,"volatility":"v","path":"search_path=pg_catalog, pg_temp","callers":["issuer_owner"]},{"signature":"public.jg_read_upward_issuer_outside_binding_v2()","sha256":"1cd57d97a5343addad777b1cb06d4b983437bfdbe75d66277df680234089d777","language":"plpgsql","result":"public.jg_contract_direct_archive_intent_binding_v1","definer":true,"strict":false,"returnsSet":true,"volatility":"v","path":"search_path=pg_catalog, pg_temp","callers":["issuer_owner"]},{"signature":"public.jg_require_contract_direct_upward_execution_v2(UUID)","sha256":"43d7e253b26e87a1d8a3dd28f666d24263ceee0e7159463a01f8d005c4e087a9","language":"plpgsql","result":"TEXT","definer":false,"strict":true,"returnsSet":false,"volatility":"v","path":"search_path=pg_catalog, pg_temp","callers":[]},{"signature":"public.jg_upward_archive_constraint_body_v2(TEXT)","sha256":"bf0b610bd25402782ec37e8a475da8d6033212c5b63afe3458070a647edf8829","language":"plpgsql","result":"TEXT","definer":false,"strict":true,"returnsSet":false,"volatility":"i","path":"search_path=pg_catalog, pg_temp","callers":[]},{"signature":"public.jg_upward_archive_legacy_source_sha_v2(OID)","sha256":"6cc94122d53d3492776bde299185bf360e8c0816876accf7b40223690deb7583","language":"plpgsql","result":"TEXT","definer":true,"strict":true,"returnsSet":false,"volatility":"v","path":"search_path=pg_catalog, pg_temp","callers":["issuer_owner","outside_executor"]},{"signature":"public.jg_upward_archive_ownership_day_v2(TEXT)","sha256":"05d0c34dba9bc31df166f8b67bfc6d55388d4aa58108a03bb5fbae303b729e72","language":"plpgsql","result":"DATE","definer":true,"strict":true,"returnsSet":false,"volatility":"v","path":"search_path=pg_catalog, pg_temp","callers":["application"]},{"signature":"public.jg_upward_archive_splice_metadata_v2()","sha256":"cbabcde24a8a4b272cf41ddc82705803776bc94d47c560e4dc731ef91cb19fb6","language":"sql","result":"JSONB","definer":false,"strict":false,"returnsSet":false,"volatility":"i","path":"search_path=pg_catalog, pg_temp","callers":[]},{"signature":"public.jg_upward_archive_splice_signatures_v2()","sha256":"460833a053385e7d218743ff935a4e4465d1844c110c3881f3f693e47d55a2a9","language":"sql","result":"TEXT[]","definer":false,"strict":false,"returnsSet":false,"volatility":"i","path":"search_path=pg_catalog, pg_temp","callers":[]},{"signature":"public.jg_upward_archive_transaction_v2(TEXT,TEXT)","sha256":"749e3330cde38327c96d3b38d66d1f23e1b07042d9dc440d790b217ddbd9ed0e","language":"plpgsql","result":"JSONB","definer":false,"strict":true,"returnsSet":false,"volatility":"v","path":"search_path=pg_catalog, pg_temp","callers":[]},{"signature":"public.jg_upward_archive_transform_v2(TEXT,TEXT)","sha256":"276bbe28a550eadec5efe180921ed6d9cb219b7f38553123ff31b9ea1621094d","language":"plpgsql","result":"TEXT","definer":false,"strict":true,"returnsSet":false,"volatility":"i","path":"search_path=pg_catalog, pg_temp","callers":[]},{"signature":"public.jg_upward_issuer_channel_v2(UUID)","sha256":"5df860c7bbcf57a16c8217a4f920defdef57f35e15f5018fbc6852ad38e099c3","language":"plpgsql","result":"BOOLEAN","definer":true,"strict":true,"returnsSet":false,"volatility":"v","path":"search_path=pg_catalog, pg_temp","callers":["issuer"]}]$recipe_json$::jsonb;
$recipe$;
REVOKE ALL ON FUNCTION public.jg_upward_archive_recipe_v2() FROM PUBLIC;

COMMIT;
