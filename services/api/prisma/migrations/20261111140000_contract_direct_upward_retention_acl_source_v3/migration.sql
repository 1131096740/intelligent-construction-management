BEGIN;

-- Preserve the installed retention grant. M259's unchanged catalog predicate
-- must use the same ordinary application caller as the frozen predecessor.
DO $forward$
DECLARE
  anchor_owner oid:=current_user::regrole;
  public_namespace oid:=to_regnamespace('public');
  retention public.jg_contract_direct_archive_retention_binding_v1%ROWTYPE;
  complete_oid oid:='public.jg_require_contract_direct_archive_complete_v1()'::regprocedure;
  expected record;
  original record;
  next_source text;
BEGIN
  IF current_user IS DISTINCT FROM session_user
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_database d WHERE d.datname=current_database() AND d.datdba=anchor_owner)
    OR EXISTS(SELECT 1 FROM public.jg_contract_direct_upward_closure_v2)
    OR EXISTS(SELECT 1 FROM public.jg_contract_direct_upward_execution_binding_v2) THEN
    RAISE EXCEPTION 'UPWARD_RETENTION_ACL_FORWARD_SCOPE';
  END IF;
  SELECT * INTO STRICT retention FROM public.jg_contract_direct_archive_retention_binding_v1 WHERE "protocolVersion"=1;
  IF retention."anchorOwnerOid" IS DISTINCT FROM anchor_owner
    OR retention."databaseOid" IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
    OR retention."applicationRoleOid" IS NULL OR retention."applicationRoleOid"=anchor_owner
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=retention."applicationRoleOid"
      AND r.rolcanlogin AND NOT(r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolbypassrls OR r.rolreplication)
      AND NOT has_schema_privilege(r.oid,public_namespace,'CREATE'))
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=complete_oid
      AND p.proowner=anchor_owner AND p.pronamespace=public_namespace
      AND p.oid::text=retention."bindings"#>>'{routines,jg_require_contract_direct_archive_complete_v1,oid}'
      AND to_jsonb(p.proacl)=retention."bindings"#>'{routines,jg_require_contract_direct_archive_complete_v1,acl}'
      AND (SELECT count(*)=2 AND count(*) FILTER(WHERE a.grantee=anchor_owner)=1
        AND count(*) FILTER(WHERE a.grantee=retention."applicationRoleOid")=1
        AND bool_and(a.grantor=anchor_owner AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
        FROM pg_catalog.aclexplode(p.proacl) a)) THEN
    RAISE EXCEPTION 'UPWARD_RETENTION_ACL_FORWARD_PREIMAGE';
  END IF;

  FOR expected IN SELECT * FROM (VALUES
    ('public.jg_upward_archive_splice_metadata_v2()','cbabcde24a8a4b272cf41ddc82705803776bc94d47c560e4dc731ef91cb19fb6','ffe41b8fd0fabf65e106eff42c983fa15e6d2f11e123b48503f774805fa4ba88',$prior$    'caller',CASE target.signature
$prior$,$next$    'caller',CASE target.signature
      WHEN 'public.jg_require_contract_direct_archive_complete_v1()' THEN 'app'
$next$),
    ('public.jg_upward_archive_recipe_v2()','70cfbea26f01c95b0e4a7b5674829aae767718bad7513ba69a496b55fb4eb9c2','142d3ae6b930e932042990a9b31f5ab841beff1f2d84f1517e3c05a0ed28a17f',$prior$cbabcde24a8a4b272cf41ddc82705803776bc94d47c560e4dc731ef91cb19fb6$prior$,$next$ffe41b8fd0fabf65e106eff42c983fa15e6d2f11e123b48503f774805fa4ba88$next$),
    ('public.jg_require_contract_direct_upward_source_v2()','9af4c2c58ac1adabb2580d76f90130c856dd1743f608824859a44d1bb5b3c0c4','c4ed2c5040daf5f51e372a045e06fab5aeb8f048b16146c46e96c178f2128cee',$prior$70cfbea26f01c95b0e4a7b5674829aae767718bad7513ba69a496b55fb4eb9c2$prior$,$next$142d3ae6b930e932042990a9b31f5ab841beff1f2d84f1517e3c05a0ed28a17f$next$)
  ) recipe(signature,before_sha,after_sha,before_anchor,after_anchor) LOOP
    SELECT p.oid,p.prosrc,to_jsonb(p)-'prosrc' AS metadata INTO STRICT original
    FROM pg_catalog.pg_proc p WHERE p.oid=to_regprocedure(expected.signature)
      AND p.proowner=anchor_owner AND p.pronamespace=public_namespace
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=expected.before_sha;
    IF cardinality(string_to_array(original.prosrc,expected.before_anchor))<>2
      OR cardinality(string_to_array(pg_get_functiondef(original.oid),original.prosrc))<>2 THEN
      RAISE EXCEPTION 'UPWARD_RETENTION_ACL_FORWARD_RECIPE_ANCHOR';
    END IF;
    next_source:=replace(original.prosrc,expected.before_anchor,expected.after_anchor);
    IF encode(public.digest(convert_to(next_source,'UTF8'),'sha256'),'hex') IS DISTINCT FROM expected.after_sha THEN
      RAISE EXCEPTION 'UPWARD_RETENTION_ACL_FORWARD_RECIPE_SHA';
    END IF;
    EXECUTE replace(pg_get_functiondef(original.oid),original.prosrc,next_source);
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=original.oid AND p.prosrc=next_source
      AND to_jsonb(p)-'prosrc'=original.metadata) THEN
      RAISE EXCEPTION 'UPWARD_RETENTION_ACL_FORWARD_RECIPE_POSTIMAGE';
    END IF;
  END LOOP;
END;
$forward$;

COMMIT;
