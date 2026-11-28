BEGIN;

-- 已签补充协议附录（ContractSignedChange.appendixFormalFileId）与已签结算
-- 附件（SignedContractSettlementAttachment.fileId）都是签署原件事实：同一
-- 文件只能归属于一条签署记录，不能作为共享附件复用。两者因此以 exclusive
-- 登记进中心绑定清单，由统一触发器拒绝重复绑定与文件替换链接入。
SELECT pg_advisory_xact_lock(190731, 13);
DO $registry$
DECLARE
  old_oid oid := 'public.jg_file_business_binding_columns()'::regprocedure;
  owner_id oid;
  owner_name TEXT;
  original_acl aclitem[];
  installer TEXT := current_user;
  privilege RECORD;
BEGIN
  SELECT proowner, proacl INTO STRICT owner_id, original_acl FROM pg_proc WHERE oid = old_oid;
  SELECT rolname INTO STRICT owner_name FROM pg_roles WHERE oid = owner_id;
  IF EXISTS (SELECT 1 FROM aclexplode(coalesce(original_acl, acldefault('f', owner_id))) WHERE grantor <> owner_id) THEN
    RAISE EXCEPTION 'signed settlement attachment cannot change a third-party file registry grant';
  END IF;

  EXECUTE format('SET LOCAL ROLE %I', owner_name);
  ALTER FUNCTION public.jg_file_business_binding_columns()
    RENAME TO jg_file_business_binding_columns_before_signed_settlement;
  EXECUTE $new_registry$
    CREATE FUNCTION public.jg_file_business_binding_columns()
    RETURNS TABLE ("tableName" TEXT, "columnName" TEXT, "exclusive" BOOLEAN)
    LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public AS $body$
      SELECT * FROM public.jg_file_business_binding_columns_before_signed_settlement()
      UNION ALL
      VALUES
        ('ContractSignedChange', 'appendixFormalFileId', TRUE),
        ('SignedContractSettlementAttachment', 'fileId', TRUE);
    $body$;
  $new_registry$;
  FOR privilege IN SELECT grantee FROM aclexplode(coalesce((SELECT proacl FROM pg_proc
    WHERE oid = 'public.jg_file_business_binding_columns()'::regprocedure), acldefault('f', owner_id)))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.jg_file_business_binding_columns() FROM %s',
      CASE WHEN privilege.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(privilege.grantee)) END);
  END LOOP;
  FOR privilege IN SELECT grantee, is_grantable FROM aclexplode(coalesce(original_acl, acldefault('f', owner_id)))
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_file_business_binding_columns() TO %s%s',
      CASE WHEN privilege.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(privilege.grantee)) END,
      CASE WHEN privilege.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
  EXECUTE format('SET LOCAL ROLE %I', installer);
END;
$registry$;

-- 补充协议附录在提交时由 SECURITY DEFINER 函数写入且不可覆写；这里补齐它
-- 自己的独占绑定触发器。已签结算附件已在
-- 20261119004100_signed_contract_settlement_registration 中用
-- SignedContractSettlementAttachment_legacy_collision 以同一守卫 ('fileId',
-- 'true') 保护，且该表禁止 UPDATE，故不重复安装第二个独占触发器。
CREATE TRIGGER jg_efb_contract_signed_change_appendix
BEFORE INSERT OR UPDATE OF "appendixFormalFileId" ON public."ContractSignedChange"
FOR EACH ROW EXECUTE FUNCTION public.jg_enforce_exclusive_file_business_binding(
  'appendixFormalFileId',
  'true'
);
-- 新触发器与 registry 换代必须同步进 upward 闭包登记：闭包门
-- jg_require_contract_direct_upward_source_v2() 仍以精确接线与源码摘要校验
-- 原守卫，不能容忍漂移；这里只把本迁移产生的后继状态如实登记进去。
DO $closure$
DECLARE
  owner_oid OID := current_user::regrole::oid;
  function_oid OID := to_regprocedure('public.jg_require_contract_direct_upward_source_v2()');
  old_body TEXT;
  old_metadata JSONB;
  new_body TEXT;
  registration TEXT := $registration$  -- 07500: the signed-change appendix trigger is additionally sealed as the
  -- sixth central file-binding caller. The immutable 292 trigger array cannot
  -- be extended, so register its exact wiring here.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgrelid='public."ContractSignedChange"'::regclass
      AND t.tgname='jg_efb_contract_signed_change_appendix'
      AND t.tgenabled='O' AND NOT t.tgisinternal
      AND t.tgtype=23 AND t.tgnargs=2
      AND encode(t.tgargs,'hex')='617070656e646978466f726d616c46696c654964007472756500'
      AND t.tgattr::text=(SELECT a.attnum::text FROM pg_catalog.pg_attribute a
        WHERE a.attrelid='public."ContractSignedChange"'::regclass
          AND a.attname='appendixFormalFileId' AND a.attnum>0 AND NOT a.attisdropped)
      AND NOT(t.tgdeferrable OR t.tginitdeferred) AND t.tgconstraint=0
      AND t.tgconstrrelid=0 AND t.tgconstrindid=0 AND t.tgparentid=0
      AND t.tgqual IS NULL AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
      AND p.oid=to_regprocedure('public.jg_enforce_exclusive_file_business_binding()')
      AND p.proowner=binding."anchorOwnerOid" AND p.pronamespace=binding."namespaceOid"
      AND p.prokind='f' AND p.prorettype='pg_catalog.trigger'::regtype
      AND p.provolatile='v' AND p.proparallel='u'
      AND NOT(p.prosecdef OR p.proisstrict OR p.proleakproof OR p.proretset)
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(binding."triggers") entry
        WHERE (entry->'routineMetadata'->>'oid')::oid=p.oid
      )
  ) THEN
    RAISE EXCEPTION '对上登记原守卫接线或源码已变化' USING ERRCODE='55000';
  END IF;
$registration$;
  definition TEXT;
BEGIN
  IF current_user<>session_user OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_database WHERE datname=current_database() AND datdba=owner_oid)
    OR function_oid IS NULL
    OR (SELECT count(*) FROM public.jg_contract_direct_upward_closure_v2)<>1 THEN
    RAISE EXCEPTION 'SIGNED_SETTLEMENT_FILE_BINDING_CLOSURE_SCOPE' USING ERRCODE='55000';
  END IF;

  LOCK TABLE public.jg_contract_direct_upward_closure_v2 IN SHARE ROW EXCLUSIVE MODE;

  SELECT p.prosrc, to_jsonb(p)-'prosrc' INTO STRICT old_body, old_metadata
  FROM pg_catalog.pg_proc p
  WHERE p.oid=function_oid AND p.proowner=owner_oid AND p.pronamespace=pg_catalog.to_regnamespace('public');
  IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(old_body,'UTF8')),'hex')
      <>'607cc42deccbb17f6de375976b5ed0ef0cbb30805c24ab6d3fb7cf6be74fc5fe' THEN
    RAISE EXCEPTION 'SIGNED_SETTLEMENT_FILE_BINDING_CLOSURE_PREIMAGE' USING ERRCODE='55000';
  END IF;
  IF pg_catalog.cardinality(pg_catalog.string_to_array(old_body,
        '6d15e2b77fe89fbfa944d26522a9bf3a5c44636ecbfc1e99201e3e676502289f'))<>2
    OR pg_catalog.cardinality(pg_catalog.string_to_array(old_body,E'  RETURN result;\nEND;'))<>2 THEN
    RAISE EXCEPTION 'SIGNED_SETTLEMENT_FILE_BINDING_CLOSURE_ANCHOR' USING ERRCODE='55000';
  END IF;

  new_body := pg_catalog.replace(old_body,
    '6d15e2b77fe89fbfa944d26522a9bf3a5c44636ecbfc1e99201e3e676502289f',
    '2a2b941651afd8763a7932f8ea110e845eb0851783ea86726b1da78ed20ded85');
  new_body := pg_catalog.replace(new_body,E'  RETURN result;\nEND;',
    registration || E'  RETURN result;\nEND;');
  IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(new_body,'UTF8')),'hex')
      <>'c86b37cc155cb5cf424dd682f9767363da264eed8630a0dee9f02acde0dc3f49' THEN
    RAISE EXCEPTION 'SIGNED_SETTLEMENT_FILE_BINDING_CLOSURE_DIGEST' USING ERRCODE='55000';
  END IF;

  definition := pg_catalog.pg_get_functiondef(function_oid);
  IF pg_catalog.cardinality(pg_catalog.string_to_array(definition, old_body))<>2 THEN
    RAISE EXCEPTION 'SIGNED_SETTLEMENT_FILE_BINDING_CLOSURE_DEFINITION' USING ERRCODE='55000';
  END IF;
  EXECUTE pg_catalog.replace(definition, old_body, new_body);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=function_oid AND p.prosrc=new_body
    AND to_jsonb(p)-'prosrc'=old_metadata) THEN
    RAISE EXCEPTION 'SIGNED_SETTLEMENT_FILE_BINDING_CLOSURE_POSTIMAGE' USING ERRCODE='55000';
  END IF;
  IF public.jg_require_contract_direct_upward_source_v2() IS NULL THEN
    RAISE EXCEPTION 'SIGNED_SETTLEMENT_FILE_BINDING_CLOSURE_REQUIRE' USING ERRCODE='55000';
  END IF;
END;
$closure$;

COMMIT;
