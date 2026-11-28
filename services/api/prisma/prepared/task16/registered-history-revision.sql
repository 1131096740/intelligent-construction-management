-- SOURCE_ONLY_NOT_EXECUTED. Prepared technical protocol, not a migration.
-- Apply only inside the eventual reviewed single transaction, before
-- registered-write-authority.sql. Active Prisma/application changes NOT made.
-- Installation requires explicit verified owner/runtime role separation below.
SET LOCAL search_path=pg_catalog,public,pg_temp;
LOCK TABLE public."Contract" IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE public."RegisteredContractHistoryRevision" (
 "contractId" TEXT PRIMARY KEY REFERENCES public."Contract"("id") ON DELETE CASCADE,
 "revision" BIGINT NOT NULL DEFAULT 0 CHECK ("revision" >= 0)
);
-- Installation-only prefill. A running payment never repairs a missing marker.
INSERT INTO public."RegisteredContractHistoryRevision"("contractId","revision") SELECT "id",0 FROM public."Contract";

CREATE FUNCTION public."jg_registered_history_marker_guard"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'RegisteredContractHistoryRevision' THEN RAISE EXCEPTION 'history revision guard attached to wrong relation'; END IF;
 IF TG_OP = 'INSERT' AND pg_catalog.pg_trigger_depth() >= 2 AND NEW."revision" = 0 AND EXISTS(SELECT 1 FROM public."Contract" WHERE "id" = NEW."contractId") THEN RETURN NEW; END IF;
 IF TG_OP = 'UPDATE' AND pg_catalog.pg_trigger_depth() >= 2 AND NEW."contractId" = OLD."contractId" AND NEW."revision" = OLD."revision" + 1 THEN RETURN NEW; END IF;
 -- Preserve legitimate original Contract deletion; no payment/history row is
 -- removed by this technical table's cascade. Runtime direct DELETE is denied.
 IF TG_OP = 'DELETE' AND NOT EXISTS(SELECT 1 FROM public."Contract" WHERE "id" = OLD."contractId") THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'history revision is controlled by its real parent triggers';
END $$;
CREATE TRIGGER "RegisteredContractHistoryRevision_controlled" BEFORE INSERT OR UPDATE OR DELETE ON public."RegisteredContractHistoryRevision" FOR EACH ROW EXECUTE FUNCTION public."jg_registered_history_marker_guard"();

CREATE FUNCTION public."jg_registered_history_new_contract"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'Contract' OR TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'history marker creation requires real new Contract'; END IF;
 INSERT INTO public."RegisteredContractHistoryRevision"("contractId","revision") VALUES(NEW."id",0);
 RETURN NEW;
END $$;
CREATE TRIGGER "Contract_registered_history_marker" AFTER INSERT ON public."Contract" FOR EACH ROW EXECUTE FUNCTION public."jg_registered_history_new_contract"();

-- Internal shared primitive: historical writers may use READ COMMITTED.
-- NOWAIT on BOTH paths avoids a new blocking marker -> history-row cycle.
CREATE FUNCTION public."jg_registered_history_try_lock_internal"(contract_id TEXT)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_revision BIGINT;
BEGIN
 BEGIN
   SELECT "revision" INTO current_revision FROM public."RegisteredContractHistoryRevision" WHERE "contractId" = contract_id FOR UPDATE NOWAIT;
 EXCEPTION WHEN lock_not_available THEN
   RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='contract history basis is being changed; query original result before retry';
 END;
 RETURN current_revision; -- missing marker remains NULL, never inserted here
END $$;

CREATE FUNCTION public."jg_registered_history_read_revision"(contract_id TEXT)
RETURNS BIGINT LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT "revision" FROM public."RegisteredContractHistoryRevision" WHERE "contractId" = contract_id;
$$;
CREATE FUNCTION public."jg_registered_history_lock_revision"(contract_id TEXT)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF pg_catalog.current_setting('transaction_isolation') <> 'serializable' THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='registered payment history basis requires Serializable transaction'; END IF;
 RETURN public."jg_registered_history_try_lock_internal"(contract_id);
END $$;

CREATE FUNCTION public."jg_registered_history_basis_member"(row_value JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT coalesce(row_value->>'takeoverStatus' = 'confirmed' AND row_value->>'historicalBalanceConfirmedAt' IS NOT NULL,FALSE);
$$;
CREATE FUNCTION public."jg_registered_history_basis_tuple"(row_value JSONB)
RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public,pg_temp AS $$
 SELECT pg_catalog.jsonb_build_array(row_value->'id',row_value->'contractId',row_value->'contractVersionId',row_value->'paymentTermsVersionId',
   row_value->'takeoverStatus',row_value->'historicalBalanceConfirmedAt',row_value->'activatedAt',row_value->'updatedAt',
   row_value->'historicalPaidCents',row_value->'historicalProxyPaidCents',row_value->'historicalAdvancePaidCents');
$$;
CREATE FUNCTION public."jg_registered_history_basis_changed"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE old_row JSONB; new_row JSONB; old_member BOOLEAN := FALSE; new_member BOOLEAN := FALSE; parent_id TEXT; revision_seen BIGINT;
BEGIN
 IF TG_TABLE_SCHEMA <> 'public' OR TG_TABLE_NAME <> 'ContractTakeover' THEN RAISE EXCEPTION 'history revision writer attached to wrong relation'; END IF;
 IF TG_OP <> 'INSERT' THEN old_row := pg_catalog.to_jsonb(OLD); old_member := public."jg_registered_history_basis_member"(old_row); END IF;
 IF TG_OP <> 'DELETE' THEN new_row := pg_catalog.to_jsonb(NEW); new_member := public."jg_registered_history_basis_member"(new_row); END IF;
 IF (old_member OR new_member) AND (TG_OP <> 'UPDATE' OR public."jg_registered_history_basis_tuple"(old_row) IS DISTINCT FROM public."jg_registered_history_basis_tuple"(new_row)) THEN
   FOR parent_id IN SELECT DISTINCT value FROM pg_catalog.unnest(ARRAY[CASE WHEN old_member THEN old_row->>'contractId' END,CASE WHEN new_member THEN new_row->>'contractId' END]) AS parent(value) WHERE value IS NOT NULL ORDER BY value LOOP
     revision_seen := public."jg_registered_history_try_lock_internal"(parent_id);
     IF revision_seen IS NULL THEN RAISE EXCEPTION 'contract history revision marker is missing'; END IF;
     UPDATE public."RegisteredContractHistoryRevision" SET "revision" = "revision" + 1 WHERE "contractId" = parent_id;
   END LOOP;
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ContractTakeover_registered_history_revision" BEFORE INSERT OR UPDATE OR DELETE ON public."ContractTakeover" FOR EACH ROW EXECUTE FUNCTION public."jg_registered_history_basis_changed"();

-- Do not guess the deployment runtime role. The controlled installation must
-- provide this parameter and fail closed otherwise. No such installation ran.
DO $$
DECLARE runtime_name TEXT := pg_catalog.current_setting('jg.task16_runtime_role',TRUE); runtime_id OID; owner_id OID; role_row RECORD; acl_row RECORD; function_row RECORD; watched_owner RECORD;
BEGIN
 SELECT relowner INTO STRICT owner_id FROM pg_catalog.pg_class WHERE oid='public."RegisteredContractHistoryRevision"'::regclass;
 SELECT * INTO role_row FROM pg_catalog.pg_roles WHERE rolname=runtime_name;
 IF runtime_name IS NULL OR runtime_name = '' OR role_row.oid IS NULL THEN RAISE EXCEPTION 'task16 installation requires explicit runtime role'; END IF;
 runtime_id := role_row.oid;
 IF runtime_id = owner_id OR role_row.rolsuper OR role_row.rolcreaterole OR role_row.rolcreatedb
    OR pg_catalog.pg_has_role(runtime_id,owner_id,'MEMBER') OR pg_catalog.has_schema_privilege(runtime_id,'public','CREATE') THEN
   RAISE EXCEPTION 'task16 runtime role must be separate from trusted owner/schema DDL';
 END IF;
 -- A runtime owner of the watched tables could disable their marker trigger
 -- even without CREATE on the schema. Treat that as an installation failure.
 FOR watched_owner IN SELECT c.relowner FROM pg_catalog.pg_class c WHERE c.oid IN ('public."Contract"'::regclass,'public."ContractTakeover"'::regclass) LOOP
   IF runtime_id = watched_owner.relowner OR pg_catalog.pg_has_role(runtime_id,watched_owner.relowner,'MEMBER') THEN
     RAISE EXCEPTION 'task16 runtime role cannot own the watched historical relations';
   END IF;
 END LOOP;
 -- Clear inherited/default table grants, not just a direct runtime grant.
 REVOKE ALL ON public."RegisteredContractHistoryRevision" FROM PUBLIC;
 FOR acl_row IN SELECT DISTINCT acl.grantee FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl WHERE c.oid='public."RegisteredContractHistoryRevision"'::regclass AND acl.grantee<>c.relowner AND acl.grantee<>0 LOOP
   EXECUTE pg_catalog.format('REVOKE ALL ON public."RegisteredContractHistoryRevision" FROM %I',(SELECT rolname FROM pg_catalog.pg_roles WHERE oid=acl_row.grantee));
 END LOOP;
 FOR function_row IN SELECT p.oid,p.proowner FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('jg_registered_operating_scope_lock','jg_registered_history_marker_guard','jg_registered_history_new_contract','jg_registered_history_try_lock_internal','jg_registered_history_read_revision','jg_registered_history_lock_revision','jg_registered_history_basis_member','jg_registered_history_basis_tuple','jg_registered_history_basis_changed') LOOP
   EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',function_row.oid::regprocedure);
   FOR acl_row IN SELECT DISTINCT acl.grantee FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl WHERE p.oid=function_row.oid AND acl.grantee<>p.proowner AND acl.grantee<>0 LOOP
     EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM %I',function_row.oid::regprocedure,(SELECT rolname FROM pg_catalog.pg_roles WHERE oid=acl_row.grantee));
   END LOOP;
 END LOOP;
 EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION public."jg_registered_history_read_revision"(TEXT), public."jg_registered_history_lock_revision"(TEXT), public."jg_registered_operating_scope_lock"(TEXT) TO %I',runtime_name);
END $$;
-- Runtime can invoke only the read/lock APIs, not marker DML/internal bump.
-- Trigger functions, owner/runtime ACL behavior, NOWAIT, snapshot failures,
-- cascade behavior and complete-set stability all remain UNEXECUTED PG gates.
