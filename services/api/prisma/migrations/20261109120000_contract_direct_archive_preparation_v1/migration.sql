BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

-- Read-side preparation only. A qualified installer must supply the immutable
-- row and precise reader grants in a controlled installation window.
CREATE TABLE public.jg_contract_direct_archive_binding_v1 (
  "protocolVersion" INTEGER PRIMARY KEY CHECK ("protocolVersion" = 1),
  "recipeVersion" TEXT NOT NULL CHECK ("recipeVersion" = 'contract-direct-archive-preparation-v1/1'),
  "applicationRoleOid" OID NOT NULL,
  "fileCallerOids" OID[] NOT NULL,
  "databaseOid" OID NOT NULL,
  "anchorNamespaceOid" OID NOT NULL,
  "anchorOwnerOid" OID NOT NULL,
  "pendingRelationOid" OID NOT NULL,
  "reviewRelationOid" OID NOT NULL,
  "pendingSha256" TEXT NOT NULL CHECK ("pendingSha256" ~ '^[a-f0-9]{64}$'),
  "reviewSha256" TEXT NOT NULL CHECK ("reviewSha256" ~ '^[a-f0-9]{64}$')
);

REVOKE ALL ON TABLE public.jg_contract_direct_archive_binding_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_contract_direct_archive_binding_guard_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $archive_binding_guard$
DECLARE
  pending record;
  review record;
BEGIN
  IF TG_OP <> 'INSERT' OR EXISTS (SELECT 1 FROM public.jg_contract_direct_archive_binding_v1) THEN
    RAISE EXCEPTION '直签登记准备绑定不可改写' USING ERRCODE = '23514';
  END IF;

  SELECT p."applicationRoleOid", p."fileCallerOids", p."databaseOid", p."anchorNamespaceOid", p."anchorOwnerOid",
    pg_catalog.encode(public.digest(pg_catalog.convert_to(pg_catalog.to_jsonb(p)::text, 'UTF8'), 'sha256'), 'hex') AS sha
  INTO STRICT pending
  FROM public.jg_contract_direct_pending_binding_v1 p
  WHERE p."protocolVersion" = 1 AND p."recipeVersion" = 'contract-direct-pending-input-v1/1';

  SELECT r."applicationRoleOid", r."databaseOid", r."anchorOwnerOid",
    pg_catalog.encode(public.digest(pg_catalog.convert_to(pg_catalog.to_jsonb(r)::text, 'UTF8'), 'sha256'), 'hex') AS sha
  INTO STRICT review
  FROM public.jg_contract_direct_review_retention_binding_v1 r WHERE r."protocolVersion" = 1;

  IF (current_user::pg_catalog.regrole)::oid IS DISTINCT FROM pending."anchorOwnerOid"
    OR NEW."applicationRoleOid" IS DISTINCT FROM pending."applicationRoleOid"
    OR NEW."applicationRoleOid" IS DISTINCT FROM review."applicationRoleOid"
    OR NEW."fileCallerOids" IS DISTINCT FROM ARRAY(SELECT caller FROM unnest(pending."fileCallerOids") AS callers(caller) ORDER BY caller)
    OR NEW."databaseOid" IS DISTINCT FROM pending."databaseOid" OR NEW."databaseOid" IS DISTINCT FROM review."databaseOid"
    OR NEW."databaseOid" IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_database WHERE datname = pg_catalog.current_database())
    OR NEW."anchorNamespaceOid" IS DISTINCT FROM pending."anchorNamespaceOid" OR NEW."anchorNamespaceOid" IS DISTINCT FROM TG_TABLE_SCHEMA::pg_catalog.regnamespace::oid
    OR NEW."anchorOwnerOid" IS DISTINCT FROM pending."anchorOwnerOid" OR NEW."anchorOwnerOid" IS DISTINCT FROM review."anchorOwnerOid"
    OR NEW."pendingRelationOid" IS DISTINCT FROM 'public.jg_contract_direct_pending_binding_v1'::pg_catalog.regclass::oid
    OR NEW."reviewRelationOid" IS DISTINCT FROM 'public.jg_contract_direct_review_retention_binding_v1'::pg_catalog.regclass::oid
    OR NEW."pendingSha256" IS DISTINCT FROM pending.sha OR NEW."reviewSha256" IS DISTINCT FROM review.sha THEN
    RAISE EXCEPTION '直签登记准备绑定与既有来源资格不一致' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$archive_binding_guard$;

REVOKE ALL ON FUNCTION public.jg_contract_direct_archive_binding_guard_v1() FROM PUBLIC;
CREATE TRIGGER jg_direct_archive_binding_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.jg_contract_direct_archive_binding_v1
FOR EACH ROW EXECUTE FUNCTION public.jg_contract_direct_archive_binding_guard_v1();
CREATE TRIGGER jg_direct_archive_binding_no_truncate
BEFORE TRUNCATE ON public.jg_contract_direct_archive_binding_v1
FOR EACH STATEMENT EXECUTE FUNCTION public.jg_contract_direct_archive_binding_guard_v1();

COMMIT;
