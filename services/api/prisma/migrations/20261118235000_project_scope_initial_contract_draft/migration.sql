BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

-- Verify the exact existing protection before adding any guarded row hooks.
DO $before_manifest$
BEGIN
  IF current_user<>session_user OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS (SELECT FROM pg_database WHERE datname=current_database() AND datdba=current_user::regrole::oid)
    OR public.jg_require_contract_direct_upward_source_v2() IS DISTINCT FROM (
      SELECT encode(public.digest(convert_to(to_jsonb(bound)::text,'UTF8'),'sha256'),'hex')
      FROM public.jg_contract_direct_upward_closure_v2 bound
    ) THEN
    RAISE EXCEPTION 'PROJECT_SCOPE_DRAFT_INSTALL_SCOPE' USING ERRCODE='55000';
  END IF;
END;
$before_manifest$;

CREATE TABLE public.jg_project_scope_initial_contract_binding_v1 (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  database_oid oid NOT NULL,
  system_identifier text NOT NULL,
  server_port integer NOT NULL,
  runtime_role_oid oid NOT NULL,
  project_id text NOT NULL CHECK (project_id='legacy-project-business-scope'),
  actor_id text NOT NULL,
  template_version_id text NOT NULL,
  contract_id text,
  version_id text,
  creation_xid xid8,
  CHECK ((contract_id IS NULL) = (version_id IS NULL) AND (contract_id IS NULL) = (creation_xid IS NULL))
);
REVOKE ALL ON TABLE public.jg_project_scope_initial_contract_binding_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_create_project_scope_initial_contract_version_v1(
  p_temporary_code text, p_actor text, p_template_version text
)
RETURNS TABLE(contract_id text, version_id text) LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $draft$
DECLARE
  snapshot jsonb;
  inserted_contract_id text := gen_random_uuid()::text;
  inserted_version_id text := gen_random_uuid()::text;
BEGIN
  IF pg_trigger_depth()<>0
    OR p_temporary_code !~ '^草稿-[0-9]{8}-[0-9]{8}$'
    OR current_setting('session_replication_role')<>'origin'
    OR inet_client_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR NOT EXISTS (SELECT FROM pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl) THEN
    RAISE EXCEPTION 'PROJECT_SCOPE_DRAFT_SESSION' USING ERRCODE='42501';
  END IF;

  SELECT jsonb_build_object(
    'fieldSchema',v."fieldSchema",'billSchema',v."billSchema",'clauseSchema',v."clauseSchema",
    'attachmentSchema',v."attachmentSchema",'validationSchema',v."validationSchema",
    'supplementChangePolicy',v."supplementChangePolicy"
  ) INTO STRICT snapshot
  FROM public.jg_project_scope_initial_contract_binding_v1 b
  JOIN pg_database db ON db.oid=b.database_oid AND db.datname=current_database()
    AND db.datdba=current_user::regrole::oid AND db.datname ~ '^jg_task01_[a-f0-9]{32}$'
  JOIN pg_roles app ON app.oid=b.runtime_role_oid AND app.oid=session_user::regrole::oid
    AND app.rolname='project_business_scope_runtime' AND app.rolcanlogin
    AND NOT (app.rolsuper OR app.rolinherit OR app.rolcreaterole OR app.rolcreatedb OR app.rolreplication OR app.rolbypassrls)
    AND NOT EXISTS (SELECT FROM pg_auth_members m WHERE app.oid IN(m.member,m.roleid))
  JOIN public."User" actor ON actor.id=b.actor_id AND actor."isActive"
  JOIN public."Project" project ON project.id=b.project_id AND project."isActive"
  JOIN public."ContractBusinessTemplateVersion" v ON v.id=b.template_version_id AND v.status='published'
    AND v."publishedAt" IS NOT NULL AND v."fieldSchema"='[]'::jsonb AND v."billSchema"='[]'::jsonb
    AND v."clauseSchema"='[]'::jsonb AND v."attachmentSchema"='[]'::jsonb AND v."validationSchema"='[]'::jsonb
  JOIN public."ContractBusinessTemplate" t ON t.id=v."templateId" AND t."contractTypeKey"='generic_contract'
  WHERE b.singleton AND b.contract_id IS NULL AND b.actor_id=p_actor AND b.template_version_id=p_template_version
    AND b.server_port=inet_server_port() AND b.system_identifier=(SELECT system_identifier::text FROM pg_control_system())
    AND has_table_privilege(app.oid,'public."Contract"','INSERT')
    AND has_table_privilege(app.oid,'public."ContractVersion"','INSERT')
    AND NOT has_function_privilege(app.oid,'public.jg_upward_archive_constraint_v2(public."ContractVersion")','EXECUTE')
    AND NOT has_function_privilege(app.oid,'public.jg_project_owner_settlement_voucher_bound(text)','EXECUTE')
    AND EXISTS (SELECT FROM public."UserPosition" up JOIN public."Position" pos ON pos.id=up."positionId"
      WHERE up."userId"=actor.id AND up."projectId" IS NULL AND pos.key='contract_staff' FOR SHARE OF up,pos NOWAIT)

  FOR UPDATE OF b NOWAIT FOR SHARE OF actor,project,v,t NOWAIT;

  INSERT INTO public."Contract" (id,"projectId","contractTypeKey","ownerUserId",name,counterparty,"temporaryCode","updatedAt")
  VALUES (inserted_contract_id,'legacy-project-business-scope','generic_contract',p_actor,'','',p_temporary_code,CURRENT_TIMESTAMP);

  INSERT INTO public."ContractVersion" (
    id,"contractId","versionNo","changeType",status,"taxFactStatus","contractGovernanceVersion","signingSubjectType",
    "amountCents","amountLimitType","settlementMode","settlementModeSource","businessTemplateVersionId",
    "draftData","templateSnapshot","clauseSnapshot","updatedAt"
  ) VALUES (
    inserted_version_id,inserted_contract_id,1,'original','draft','draft',1,'our_company',0,'capped','direct_payment','rule',
    p_template_version,'{}'::jsonb,snapshot,'[]'::jsonb,CURRENT_TIMESTAMP
  );

  UPDATE public.jg_project_scope_initial_contract_binding_v1 b
    SET contract_id=inserted_contract_id,version_id=inserted_version_id,creation_xid=pg_current_xact_id()
    WHERE b.singleton;
  RETURN QUERY SELECT inserted_contract_id,inserted_version_id;
EXCEPTION WHEN no_data_found OR too_many_rows THEN
  RAISE EXCEPTION 'PROJECT_SCOPE_DRAFT_BINDING' USING ERRCODE='55000';
END;
$draft$;
REVOKE ALL ON FUNCTION public.jg_create_project_scope_initial_contract_version_v1(text,text,text) FROM PUBLIC;

-- A scoped caller must finish the existing service draft, not commit the pair alone.
CREATE FUNCTION public.jg_require_project_scope_initial_contract_completion_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $complete$
BEGIN
  IF NEW.contract_id IS NULL OR NEW.version_id IS NULL OR OLD.contract_id IS NOT NULL OR OLD.version_id IS NOT NULL
    OR NEW.creation_xid IS DISTINCT FROM pg_current_xact_id()
    OR NOT EXISTS (
      SELECT FROM public.jg_project_scope_initial_contract_binding_v1 b
      JOIN public."Contract" c ON c.id=b.contract_id AND c."projectId"=b.project_id AND c."ownerUserId"=b.actor_id
        AND c."contractTypeKey"='generic_contract' AND c.code IS NULL AND c."temporaryCode" ~ '^草稿-[0-9]{8}-[0-9]{8}$'
      JOIN public."ContractVersion" v ON v.id=b.version_id AND v."contractId"=c.id AND v."businessTemplateVersionId"=b.template_version_id
        AND v."versionNo"=1 AND v."changeType"='original' AND v.status='draft' AND v."firstSubmittedAt" IS NULL AND v."effectiveAt" IS NULL
      WHERE b.singleton AND to_jsonb(b)=to_jsonb(NEW)
        AND b.runtime_role_oid=session_user::regrole::oid
        AND b.database_oid=(SELECT oid FROM pg_database WHERE datname=current_database())
        AND (SELECT count(*)=1 FROM public."ContractVersion" initial WHERE initial."contractId"=c.id)
        AND (SELECT count(*)=1 AND bool_and(t."contractVersionId"=v.id AND t."versionNo"=1 AND t.status='draft' AND t."originalText"='')
             FROM public."PaymentTermsVersion" t WHERE t."contractId"=c.id)
        AND NOT EXISTS (
          SELECT FROM public."PaymentTermsVersion" terms
          JOIN public."PaymentTermsStage" stage ON stage."paymentTermsVersionId"=terms.id
          WHERE terms."contractId"=c.id
        )
        AND (SELECT count(*)=1 AND bool_and(a."actorUserId"=b.actor_id AND a."businessType"='contract'
          AND a.metadata = jsonb_build_object('temporaryCode',c."temporaryCode",'projectId',b.project_id,
            'contractTypeKey','generic_contract','businessTemplateVersionId',b.template_version_id,
            'businessScenarioId',NULL::text,'scenarioTemplateMappingId',NULL::text))
          FROM public."AuditLog" a WHERE a."businessId"=c.id AND a.action='contract.draft.create')
    ) THEN
    RAISE EXCEPTION 'PROJECT_SCOPE_DRAFT_COMPLETION' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$complete$;
REVOKE ALL ON FUNCTION public.jg_require_project_scope_initial_contract_completion_v1() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER jg_project_scope_initial_contract_completion
AFTER UPDATE ON public.jg_project_scope_initial_contract_binding_v1
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.jg_require_project_scope_initial_contract_completion_v1();

-- Keep the created footprint stable even when deferred completion is validated before COMMIT.
CREATE FUNCTION public.jg_guard_project_scope_initial_contract_footprint_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $footprint$
DECLARE
  binding public.jg_project_scope_initial_contract_binding_v1%ROWTYPE;
  before_row jsonb;
  after_row jsonb;
BEGIN
  SELECT * INTO binding
  FROM public.jg_project_scope_initial_contract_binding_v1
  WHERE singleton AND runtime_role_oid=session_user::regrole::oid
    AND creation_xid=pg_current_xact_id_if_assigned();
  IF NOT FOUND THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  before_row := CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END;
  after_row := CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END;
  IF (
    TG_RELID='public."Contract"'::regclass
      AND binding.contract_id IN (before_row->>'id',after_row->>'id')
  ) OR (
    TG_RELID='public."ContractVersion"'::regclass
      AND (binding.contract_id IN (before_row->>'contractId',after_row->>'contractId')
        OR binding.version_id IN (before_row->>'id',after_row->>'id'))
  ) OR (
    TG_RELID='public."PaymentTermsVersion"'::regclass
      AND (binding.contract_id IN (before_row->>'contractId',after_row->>'contractId')
        OR binding.version_id IN (before_row->>'contractVersionId',after_row->>'contractVersionId'))
      AND (TG_OP<>'INSERT' OR EXISTS (
        SELECT FROM public."PaymentTermsVersion" terms
        WHERE terms."contractId"=binding.contract_id OR terms."contractVersionId"=binding.version_id
      ))
  ) OR (
    TG_RELID='public."PaymentTermsStage"'::regclass
      AND EXISTS (
        SELECT FROM public."PaymentTermsVersion" terms
        WHERE terms.id IN (before_row->>'paymentTermsVersionId',after_row->>'paymentTermsVersionId')
          AND (terms."contractId"=binding.contract_id OR terms."contractVersionId"=binding.version_id)
      )
  ) OR (
    TG_RELID='public."AuditLog"'::regclass
      AND ((before_row->>'businessId'=binding.contract_id AND before_row->>'action'='contract.draft.create')
        OR (after_row->>'businessId'=binding.contract_id AND after_row->>'action'='contract.draft.create'))
      AND (TG_OP<>'INSERT' OR EXISTS (
        SELECT FROM public."AuditLog" audit
        WHERE audit."businessId"=binding.contract_id AND audit.action='contract.draft.create'
      ))
  ) THEN
    RAISE EXCEPTION 'PROJECT_SCOPE_DRAFT_CREATION_FOOTPRINT' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$footprint$;
REVOKE ALL ON FUNCTION public.jg_guard_project_scope_initial_contract_footprint_v1() FROM PUBLIC;

CREATE TRIGGER jg_project_scope_initial_contract_stable
BEFORE UPDATE OR DELETE ON public."Contract"
FOR EACH ROW WHEN (session_user='project_business_scope_runtime')
EXECUTE FUNCTION public.jg_guard_project_scope_initial_contract_footprint_v1();

CREATE TRIGGER jg_project_scope_initial_contract_version_stable
BEFORE INSERT OR UPDATE OR DELETE ON public."ContractVersion"
FOR EACH ROW WHEN (session_user='project_business_scope_runtime')
EXECUTE FUNCTION public.jg_guard_project_scope_initial_contract_footprint_v1();

CREATE TRIGGER jg_project_scope_initial_contract_terms_stable
BEFORE INSERT OR UPDATE OR DELETE ON public."PaymentTermsVersion"
FOR EACH ROW WHEN (session_user='project_business_scope_runtime')
EXECUTE FUNCTION public.jg_guard_project_scope_initial_contract_footprint_v1();

CREATE TRIGGER jg_project_scope_initial_contract_terms_stage_empty
BEFORE INSERT OR UPDATE OR DELETE ON public."PaymentTermsStage"
FOR EACH ROW WHEN (session_user='project_business_scope_runtime')
EXECUTE FUNCTION public.jg_guard_project_scope_initial_contract_footprint_v1();

CREATE TRIGGER jg_project_scope_initial_contract_audit_stable
BEFORE INSERT OR UPDATE OR DELETE ON public."AuditLog"
FOR EACH ROW WHEN (session_user='project_business_scope_runtime')
EXECUTE FUNCTION public.jg_guard_project_scope_initial_contract_footprint_v1();

-- Append the three exact draft hooks to the archive catalog's protection.
-- The original sealed manifest, trigger OIDs, guard logic and privileges stay bound.
DO $manifest$
DECLARE
  owner_oid oid := current_user::regrole::oid;
  expected record;
  actual record;
  definition text;
  successor text;
BEGIN
  FOR expected IN SELECT * FROM (VALUES
    ('public.jg_require_contract_direct_upward_source_v2()','554a64629d5c4131ce4be30bf09b253a948f2244e126d0146adaf376ce0aca58','a8b68184019a527e0ab2c11ff823788608974c16a3654336a31a1dec50a575fe',$old$  IF jsonb_array_length(binding."triggers")<>(SELECT count(*) FROM pg_catalog.pg_trigger t$old$,$new$  -- The three draft guards supplement the original sealed guard set.
  IF (SELECT count(*) FROM (VALUES
      ('public."Contract"'::regclass,'jg_project_scope_initial_contract_stable',27),
      ('public."ContractVersion"'::regclass,'jg_project_scope_initial_contract_version_stable',31),
      ('public."PaymentTermsVersion"'::regclass,'jg_project_scope_initial_contract_terms_stable',31)
    ) expected(relation_oid,trigger_name,trigger_type)
    JOIN pg_catalog.pg_trigger t ON t.tgrelid=expected.relation_oid AND t.tgname=expected.trigger_name
    JOIN pg_catalog.pg_proc f ON f.oid=t.tgfoid
    JOIN pg_catalog.pg_language l ON l.oid=f.prolang
    WHERE NOT t.tgisinternal AND t.tgconstraint=0 AND NOT t.tgdeferrable AND NOT t.tginitdeferred
      AND t.tgtype=expected.trigger_type AND t.tgenabled='O' AND t.tgnargs=0 AND t.tgattr=''::int2vector
      AND t.tgparentid=0 AND t.tgoldtable IS NULL AND t.tgnewtable IS NULL
      AND substring(pg_get_triggerdef(t.oid,true) FROM ' WHEN [(](.*)[)] EXECUTE FUNCTION [^()]+[(][)]$')
        IN ('SESSION_USER = ''project_business_scope_runtime''::name',
            'SESSION_USER = ''project_business_scope_runtime''::text',
            'SESSION_USER = ''project_business_scope_runtime''')
      AND f.oid=to_regprocedure('public.jg_guard_project_scope_initial_contract_footprint_v1()')
      AND f.proowner=binding."anchorOwnerOid" AND f.pronamespace=binding."namespaceOid"
      AND l.lanname='plpgsql' AND f.prosecdef AND f.prokind='f' AND f.provolatile='v' AND f.proparallel='u'
      AND f.prorettype='pg_catalog.trigger'::regtype AND f.pronargs=0 AND f.pronargdefaults=0
      AND NOT(f.proretset OR f.proisstrict OR f.proleakproof)
      AND f.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
      AND encode(sha256(convert_to(f.prosrc,'UTF8')),'hex')='d2acc77ff836ab4e6b3573273d64c3191da92cd05a352549614e3d2d25c4d7a1'
      AND (SELECT count(*)=1 AND bool_and(a.grantee=f.proowner AND a.grantor=f.proowner
        AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
        FROM aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a))<>3 THEN
    RAISE EXCEPTION 'PROJECT_SCOPE_DRAFT_ARCHIVE_TRIGGER_MANIFEST' USING ERRCODE='55000';
  END IF;
  IF jsonb_array_length(binding."triggers")+3<>(SELECT count(*) FROM pg_catalog.pg_trigger t$new$),
    ('public.jg_upward_archive_catalog_projection_v2()','f245e2713b56b32545b5f930247481da448a7a4278824a909b5326a71fa1b6d0','2f544d1510a89f322cd747f2bc279a1c4cecd87ca5c06db336a8e00d0e472e36','554a64629d5c4131ce4be30bf09b253a948f2244e126d0146adaf376ce0aca58','a8b68184019a527e0ab2c11ff823788608974c16a3654336a31a1dec50a575fe'),
    ('public.jg_upward_direct_archive_admission_v1()','c6003492b764e96398aeecfcff241fc4dd7978350d1a89a89a538bf8bd829df9','5b7143aed3547bfd02a9ddf280139a4fc728c34e7cbacb3f6d8e420b91ea7f3d','f245e2713b56b32545b5f930247481da448a7a4278824a909b5326a71fa1b6d0','2f544d1510a89f322cd747f2bc279a1c4cecd87ca5c06db336a8e00d0e472e36')
  ) pins(signature,before_sha,after_sha,anchor,replacement)
  LOOP
    SELECT p.oid,p.prosrc,to_jsonb(p)-'prosrc' AS metadata INTO STRICT actual
      FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
      WHERE p.oid=to_regprocedure(expected.signature) AND p.proowner=owner_oid
        AND p.pronamespace=to_regnamespace('public')
        AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')=expected.before_sha;
    definition:=pg_get_functiondef(actual.oid);
    IF cardinality(string_to_array(definition,actual.prosrc))<>2
      OR cardinality(string_to_array(actual.prosrc,expected.anchor))<>2 THEN
      RAISE EXCEPTION 'PROJECT_SCOPE_DRAFT_MANIFEST_PREIMAGE' USING ERRCODE='55000';
    END IF;
    successor:=replace(actual.prosrc,expected.anchor,expected.replacement);
    IF encode(sha256(convert_to(successor,'UTF8')),'hex')<>expected.after_sha THEN
      RAISE EXCEPTION 'PROJECT_SCOPE_DRAFT_MANIFEST_DIGEST' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(definition,actual.prosrc,successor);
    IF NOT EXISTS(SELECT FROM pg_proc p WHERE p.oid=actual.oid AND p.prosrc=successor
      AND to_jsonb(p)-'prosrc'=actual.metadata) THEN
      RAISE EXCEPTION 'PROJECT_SCOPE_DRAFT_MANIFEST_POSTIMAGE' USING ERRCODE='55000';
    END IF;
  END LOOP;
END;
$manifest$;

DO $check$
BEGIN
  IF current_user<>session_user
    OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS (SELECT FROM pg_database WHERE datname=current_database() AND datdba=current_user::regrole::oid)
    OR public.jg_require_contract_direct_upward_source_v2() IS DISTINCT FROM (
      SELECT encode(public.digest(convert_to(to_jsonb(bound)::text,'UTF8'),'sha256'),'hex')
      FROM public.jg_contract_direct_upward_closure_v2 bound
    ) THEN
    RAISE EXCEPTION 'PROJECT_SCOPE_DRAFT_INSTALL_SCOPE' USING ERRCODE='55000';
  END IF;
END;
$check$;

COMMIT;
