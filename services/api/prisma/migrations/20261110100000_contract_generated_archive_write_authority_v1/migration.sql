-- The bound application may append scoped commands, not write original or completion tables.
BEGIN;
SET LOCAL search_path TO pg_catalog,public;

LOCK TABLE public."ContractArchiveFile",public.jg_contract_generated_archive_original_v1,
  public.jg_contract_generated_archive_completion_v1 IN ACCESS EXCLUSIVE MODE;

CREATE TABLE public.jg_contract_generated_archive_write_v1 (
  "archiveId" TEXT NOT NULL REFERENCES public."ContractArchiveFile"("id") ON DELETE RESTRICT,
  "phase" TEXT NOT NULL,
  "originals" JSONB NOT NULL,
  PRIMARY KEY ("archiveId","phase"),
  CHECK (CASE WHEN "phase"='originals' AND jsonb_typeof("originals")='array'
    THEN jsonb_array_length("originals") BETWEEN 1 AND 20
    ELSE "phase"='completion' AND "originals"='[]'::jsonb END)
);
REVOKE ALL ON TABLE public.jg_contract_generated_archive_write_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_apply_generated_archive_write_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $ingress$
DECLARE
  parent RECORD;
  covered BIGINT;
  xid TEXT:=mod(pg_catalog.txid_current(),4294967296::bigint)::text;
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'jg_contract_generated_archive_write_v1' OR TG_OP<>'INSERT' THEN
    RAISE EXCEPTION '生成合同归档写入命令不可更改' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.jg_contract_generated_upward_seal_binding_v1 b
    JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database()
    JOIN pg_catalog.pg_class c ON c.oid=TG_RELID AND c.relowner=b."ownerOid" AND c.relnamespace=b."namespaceOid"
    WHERE b."protocolVersion"=1 AND b."namespaceOid"=pg_catalog.to_regnamespace('public')
      AND b."ownerOid"=current_user::regrole::oid AND b."applicationRoleOid"=session_user::regrole::oid
      AND pg_catalog.current_setting('session_replication_role')='origin') THEN
    RAISE EXCEPTION '生成合同归档写入角色不匹配' USING ERRCODE='55000';
  END IF;

  SELECT a."id",a."contractVersionId",v."status",v."signingSubjectType",p."operatingLedgerEffectiveDate" INTO parent
    FROM public."ContractArchiveFile" a JOIN public."ContractVersion" v ON v."id"=a."contractVersionId"
    JOIN public."Contract" c ON c."id"=v."contractId" JOIN public."Project" p ON p."id"=c."projectId"
    WHERE a."id"=NEW."archiveId" AND a.xmin::text=xid AND a."archiveProtocolVersion"=2
      AND a."archiveSource"='generated_approval' AND a."status"='confirmed'
      AND v."signingSubjectType" IN ('affiliate','upward') AND p."isActive" AND c."voidedAt" IS NULL;
  IF NOT FOUND OR parent."operatingLedgerEffectiveDate" IS NOT NULL THEN
    RAISE EXCEPTION '生成合同归档写入须绑定同事务原归档和未启用经营的项目' USING ERRCODE='23514';
  END IF;

  IF NEW."phase"='originals' AND parent."status"='seal_approved_pending_archive' THEN
    -- The service supplies only the fixed storage coordinates of each independently verified PDF.
    IF jsonb_typeof(NEW."originals") IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION '生成合同固定版本须按原件顺序提交' USING ERRCODE='23514';
    END IF;
    IF jsonb_array_length(NEW."originals") NOT BETWEEN 1 AND 20
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW."originals") AS pin(item)
      WHERE jsonb_typeof(pin.item) IS DISTINCT FROM 'object'
        OR NOT (pin.item ?& ARRAY['evidenceId','bucket','objectKey','objectGeneration'])
        OR (pin.item-ARRAY['evidenceId','bucket','objectKey','objectGeneration'])<>'{}'::jsonb
        OR jsonb_typeof(pin.item->'evidenceId') IS DISTINCT FROM 'string'
        OR jsonb_typeof(pin.item->'bucket') IS DISTINCT FROM 'string'
        OR jsonb_typeof(pin.item->'objectKey') IS DISTINCT FROM 'string'
        OR jsonb_typeof(pin.item->'objectGeneration') IS DISTINCT FROM 'string') THEN
      RAISE EXCEPTION '生成合同固定版本坐标不完整' USING ERRCODE='23514';
    END IF;

    INSERT INTO public.jg_contract_generated_archive_original_v1
      ("evidenceId","archiveId","bucket","objectKey","objectGeneration")
    SELECT e."id",parent."id",pin.item->>'bucket',pin.item->>'objectKey',pin.item->>'objectGeneration'
    FROM jsonb_array_elements(NEW."originals") WITH ORDINALITY AS pin(item,n)
    JOIN public."ContractArchiveEvidenceFile" e ON e."id"=pin.item->>'evidenceId'
      AND e."displayOrder"=pin.n-1 AND e."archiveFileId"=parent."id" AND e."contractVersionId"=parent."contractVersionId"
      AND e.xmin::text=xid;
    GET DIAGNOSTICS covered=ROW_COUNT;
    IF covered<>jsonb_array_length(NEW."originals")
      OR covered<>(SELECT count(*) FROM public."ContractArchiveEvidenceFile" e WHERE e."archiveFileId"=parent."id") THEN
      RAISE EXCEPTION '生成合同归档写入须覆盖全部有序原件' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."phase"='completion' AND parent."status"='effective' AND NEW."originals"='[]'::jsonb
    AND EXISTS(SELECT 1 FROM public.jg_contract_generated_archive_write_v1 w WHERE w."archiveId"=parent."id"
      AND w."phase"='originals' AND w.xmin::text=xid) THEN
    INSERT INTO public.jg_contract_generated_archive_completion_v1 ("archiveId") VALUES(parent."id");
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '生成合同归档写入顺序不符合原件、生效及完成记录' USING ERRCODE='23514';
END;
$ingress$;
REVOKE ALL ON FUNCTION public.jg_apply_generated_archive_write_v1() FROM PUBLIC;
CREATE TRIGGER jg_generated_archive_write_apply
AFTER INSERT ON public.jg_contract_generated_archive_write_v1
FOR EACH ROW EXECUTE FUNCTION public.jg_apply_generated_archive_write_v1();
CREATE TRIGGER jg_generated_archive_write_immutable
BEFORE UPDATE OR DELETE ON public.jg_contract_generated_archive_write_v1
FOR EACH ROW EXECUTE FUNCTION public.jg_apply_generated_archive_write_v1();
CREATE TRIGGER jg_generated_archive_write_no_truncate
BEFORE TRUNCATE ON public.jg_contract_generated_archive_write_v1
FOR EACH STATEMENT EXECUTE FUNCTION public.jg_apply_generated_archive_write_v1();

DO $install$
DECLARE
  seal RECORD;
  current_guard RECORD;
  recipe RECORD;
  app_name NAME;
  owner_id OID:=current_user::regrole::oid;
  ingress_table OID:='public.jg_contract_generated_archive_write_v1'::regclass;
  pins_table OID:='public.jg_contract_generated_archive_original_v1'::regclass;
  marker_table OID:='public.jg_contract_generated_archive_completion_v1'::regclass;
  ingress_guard OID:=pg_catalog.to_regprocedure('public.jg_apply_generated_archive_write_v1()');
  prior_auth TEXT:='current_user IS DISTINCT FROM session_user OR NOT EXISTS (';
  next_body TEXT;
  installed_path TEXT;
  installed_definer BOOLEAN;
  authorized TEXT:=$authorization$(current_user IS DISTINCT FROM session_user AND NOT EXISTS (
    SELECT 1 FROM public.jg_contract_generated_archive_write_v1 w
    JOIN public.jg_contract_generated_upward_seal_binding_v1 b ON b."protocolVersion"=1
      AND b."ownerOid"=current_user::regrole::oid AND b."applicationRoleOid"=session_user::regrole::oid
      AND b."namespaceOid"=pg_catalog.to_regnamespace('public')
    JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database()
    WHERE w."archiveId"=NEW."archiveId" AND w."phase"='WRITER_PHASE'
      AND w.xmin::text=mod(pg_catalog.txid_current(),4294967296::bigint)::text
      AND pg_catalog.current_setting('session_replication_role')='origin'
  )) OR NOT EXISTS ($authorization$;
BEGIN
  SELECT b.* INTO STRICT seal FROM public.jg_contract_generated_upward_seal_binding_v1 b
    JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database()
    WHERE b."protocolVersion"=1 AND b."namespaceOid"=pg_catalog.to_regnamespace('public');
  SELECT rolname INTO STRICT app_name FROM pg_catalog.pg_roles WHERE oid=seal."applicationRoleOid";
  IF current_user IS DISTINCT FROM session_user OR owner_id IS DISTINCT FROM seal."ownerOid"
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(seal."applicationRoleOid",r.oid,'MEMBER')
      AND (r.rolsuper OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication OR pg_catalog.pg_has_role(r.oid,owner_id,'MEMBER')
        OR pg_catalog.has_schema_privilege(r.oid,seal."namespaceOid",'CREATE')))
    OR (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.oid IN (ingress_table,pins_table,marker_table)
      AND c.relowner=owner_id AND c.relnamespace=seal."namespaceOid" AND c.relkind='r' AND c.relpersistence='p'
      AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity)<>3 THEN
    RAISE EXCEPTION '生成合同归档写入安装角色或证据关系不匹配' USING ERRCODE='55000';
  END IF;

  FOR recipe IN SELECT * FROM (VALUES
    ('public.jg_guard_generated_archive_original_v1()','originals','13b8c39ba62c7b1ffdb9c1bfd3effe7c640f1a84b00938c4a7b88a37015a3a23','8be75a5ab619a886715b1e3ac7ef39f19db1023cde6d40701ee2ab109f581b9d',FALSE),
    ('public.jg_guard_generated_archive_completion_v1()','completion','b560be4e264168b89f208299b309b76240a6d589cba5ec5bb9bd201ae8c82eea','4f76101297574acbb0bf3aefbd6c6d62b0e82a429f8a0a4a20c3b7eb1ab55722',TRUE)
  ) wanted(signature,phase,old_sha,new_sha,run_as_owner) LOOP
    SELECT p.*,to_jsonb(p)-ARRAY['prosrc','prosecdef','proconfig'] AS metadata
      INTO STRICT current_guard FROM pg_catalog.pg_proc p
      WHERE p.oid=pg_catalog.to_regprocedure(recipe.signature) AND p.proowner=owner_id
        AND p.pronamespace=seal."namespaceOid" AND p.prorettype='pg_catalog.trigger'::regtype AND p.provolatile='v'
        AND NOT p.prosecdef AND p.proconfig=ARRAY['search_path=pg_catalog, public']::text[]
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=recipe.old_sha
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
          WHERE a.grantee<>owner_id OR a.grantor<>owner_id);
    next_body:=replace(current_guard.prosrc,prior_auth,replace(authorized,'WRITER_PHASE',recipe.phase));
    IF encode(public.digest(convert_to(next_body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM recipe.new_sha THEN
      RAISE EXCEPTION '生成合同归档写入守卫接线后态不匹配' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(pg_catalog.pg_get_functiondef(current_guard.oid),current_guard.prosrc,next_body);
    IF recipe.run_as_owner THEN
      -- At COMMIT the application session can recheck without private table or lock privileges.
      ALTER FUNCTION public.jg_guard_generated_archive_completion_v1() SECURITY DEFINER;
      ALTER FUNCTION public.jg_guard_generated_archive_completion_v1() SET search_path TO pg_catalog,pg_temp;
    END IF;
    installed_path:=CASE WHEN recipe.run_as_owner THEN 'search_path=pg_catalog, pg_temp' ELSE 'search_path=pg_catalog, public' END;
    installed_definer:=recipe.run_as_owner;
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=current_guard.oid AND p.prosrc=next_body
      AND p.prosecdef=installed_definer AND p.proconfig=ARRAY[installed_path]
      AND to_jsonb(p)-ARRAY['prosrc','prosecdef','proconfig']=current_guard.metadata) THEN
      RAISE EXCEPTION '生成合同归档写入改变了原证据守卫身份' USING ERRCODE='55000';
    END IF;
  END LOOP;

  EXECUTE format('GRANT INSERT ("archiveId","phase","originals") ON TABLE public.jg_contract_generated_archive_write_v1 TO %I',app_name);
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
      WHERE c.oid=ingress_table AND (a.grantee<>owner_id OR a.grantor<>owner_id))
    OR (SELECT count(*) FROM pg_catalog.pg_attribute c CROSS JOIN LATERAL pg_catalog.aclexplode(c.attacl) a
      WHERE c.attrelid=ingress_table AND c.attnum>0 AND NOT c.attisdropped
        AND c.attname IN ('archiveId','phase','originals') AND a.grantee=seal."applicationRoleOid"
        AND a.grantor=owner_id AND a.privilege_type='INSERT' AND NOT a.is_grantable)<>3
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute c CROSS JOIN LATERAL pg_catalog.aclexplode(c.attacl) a
      WHERE c.attrelid=ingress_table AND c.attnum>0 AND NOT c.attisdropped
        AND (a.grantee<>seal."applicationRoleOid" OR a.grantor<>owner_id OR a.privilege_type<>'INSERT' OR a.is_grantable))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute c WHERE c.attrelid IN (pins_table,marker_table)
      AND c.attnum>0 AND NOT c.attisdropped AND c.attacl IS NOT NULL)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(seal."applicationRoleOid",r.oid,'MEMBER')
      AND (pg_catalog.has_table_privilege(r.oid,ingress_table,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR pg_catalog.has_table_privilege(r.oid,pins_table,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR pg_catalog.has_table_privilege(r.oid,marker_table,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR pg_catalog.has_function_privilege(r.oid,ingress_guard,'EXECUTE')))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      WHERE p.oid=ingress_guard AND (a.grantee<>owner_id OR a.grantor<>owner_id)) THEN
    RAISE EXCEPTION '生成合同归档写入权限超出限定范围' USING ERRCODE='55000';
  END IF;
END;
$install$;

COMMIT;
