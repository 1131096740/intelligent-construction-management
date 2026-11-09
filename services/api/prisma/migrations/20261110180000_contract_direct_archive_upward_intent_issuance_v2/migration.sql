-- Private V2 issuance. No binding is installed and no execution rights are granted here.
BEGIN;
SET LOCAL search_path TO pg_catalog,pg_temp;

CREATE TABLE public.jg_contract_direct_upward_issuer_binding_v2 (
  "protocolVersion" INTEGER PRIMARY KEY CHECK ("protocolVersion"=2),
  "databaseOid" OID NOT NULL,
  "namespaceOid" OID NOT NULL,
  "anchorOwnerOid" OID NOT NULL,
  "issuerSessionOid" OID NOT NULL,
  "issuerOwnerOid" OID NOT NULL,
  "channelNonce" UUID NOT NULL,
  "outsideBindingSha256" TEXT NOT NULL CHECK ("outsideBindingSha256" ~ '^[a-f0-9]{64}$'),
  "basisRoutineOid" OID NOT NULL,
  CHECK ("issuerSessionOid"<>"issuerOwnerOid" AND "anchorOwnerOid" NOT IN ("issuerSessionOid","issuerOwnerOid"))
);
CREATE TABLE public.jg_contract_direct_upward_intent_receipt_v2 (
  "intentId" UUID PRIMARY KEY,
  "bindingSha256" TEXT NOT NULL CHECK ("bindingSha256" ~ '^[a-f0-9]{64}$'),
  "payloadSha256" TEXT NOT NULL CHECK ("payloadSha256" ~ '^[a-f0-9]{64}$'),
  "issuedAt" TIMESTAMPTZ NOT NULL CHECK (pg_catalog.isfinite("issuedAt")),
  "expiresAt" TIMESTAMPTZ NOT NULL CHECK (pg_catalog.isfinite("expiresAt")
    AND "expiresAt"="issuedAt"+interval '2 minutes')
);
REVOKE ALL ON TABLE public.jg_contract_direct_upward_issuer_binding_v2,
  public.jg_contract_direct_upward_intent_receipt_v2 FROM PUBLIC;

CREATE FUNCTION public.jg_check_contract_direct_upward_issuer_v2() RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $role$
DECLARE
  binding public.jg_contract_direct_upward_issuer_binding_v2%ROWTYPE;
  outside_binding public.jg_contract_direct_archive_intent_binding_v1%ROWTYPE;
  issuer_pair OID[];
  outside_roles OID[];
  issuer_function OID:=pg_catalog.to_regprocedure('public.jg_issue_contract_direct_upward_intent_v2(uuid,text,text,text,text,integer,text,text,jsonb)');
  basis_function OID:=pg_catalog.to_regprocedure('public.jg_contract_direct_archive_upward_intent_basis_v2(text,text,text,text,integer,text,text,jsonb)');
BEGIN
  SELECT * INTO binding FROM public.jg_contract_direct_upward_issuer_binding_v2 WHERE "protocolVersion"=2;
  IF NOT FOUND THEN
    RAISE EXCEPTION '对上直签发行资格尚未安装' USING ERRCODE='55000';
  END IF;
  SELECT * INTO outside_binding FROM public.jg_contract_direct_archive_intent_binding_v1 WHERE "protocolVersion"=1;
  issuer_pair:=ARRAY[binding."issuerSessionOid",binding."issuerOwnerOid"];
  outside_roles:=ARRAY[outside_binding."ordinaryApplicationRoleOid",outside_binding."issuerSessionOid",
    outside_binding."issuerOwnerOid",outside_binding."runtimeSessionOid",outside_binding."executorOwnerOid"];
  IF NOT FOUND OR binding."databaseOid" IS DISTINCT FROM
      (SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database())
    OR pg_catalog.current_setting('session_replication_role')<>'origin'
    OR binding."namespaceOid" IS DISTINCT FROM pg_catalog.to_regnamespace('public')::oid
    OR binding."databaseOid" IS DISTINCT FROM outside_binding."databaseOid"
    OR binding."namespaceOid" IS DISTINCT FROM outside_binding."namespaceOid"
    OR binding."anchorOwnerOid" IS DISTINCT FROM outside_binding."anchorOwnerOid"
    OR binding."outsideBindingSha256" IS DISTINCT FROM encode(public.digest(convert_to(to_jsonb(outside_binding)::text,'UTF8'),'sha256'),'hex')
    OR issuer_pair && outside_roles
    OR session_user::regrole::oid IS DISTINCT FROM binding."issuerSessionOid"
    OR current_user::regrole::oid IS DISTINCT FROM binding."issuerOwnerOid"
    OR 2<>(SELECT count(*) FROM pg_catalog.pg_roles r WHERE r.oid=ANY(issuer_pair)
      AND r.rolcanlogin=(r.oid=binding."issuerSessionOid")
      AND NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
      AND NOT pg_catalog.has_schema_privilege(r.oid,binding."namespaceOid",'CREATE')
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles other WHERE other.oid<>r.oid
        AND (pg_catalog.pg_has_role(r.oid,other.oid,'MEMBER')
          OR (NOT other.rolsuper AND pg_catalog.pg_has_role(other.oid,r.oid,'MEMBER')))))
    OR 2<>(SELECT count(*) FROM pg_catalog.pg_class c
      WHERE c.oid IN ('public.jg_contract_direct_upward_issuer_binding_v2'::regclass,
          'public.jg_contract_direct_upward_intent_receipt_v2'::regclass)
        AND c.relowner=binding."anchorOwnerOid" AND c.relnamespace=binding."namespaceOid"
        AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity)
    -- Only the pinned entry may run as this owner inside the issuer session.
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc alternate
      WHERE alternate.proowner=binding."issuerOwnerOid" AND alternate.prosecdef AND alternate.oid<>issuer_function)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
      WHERE p.oid=issuer_function AND p.prosecdef AND p.proowner=binding."issuerOwnerOid" AND p.pronamespace=binding."namespaceOid"
        AND p.prokind='f' AND NOT p.proretset AND p.proisstrict AND p.provolatile='v' AND p.proparallel='u'
        AND p.prorettype='pg_catalog.uuid'::regtype AND l.lanname='plpgsql'
        AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND p.pronargdefaults=0 AND p.provariadic=0
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='c9ff15d34905cb3628d8a95acf58c5e4a7bc5d654c40b4ec27e7990c6a0c7a0e'
        AND EXISTS(SELECT 1 FROM pg_catalog.aclexplode(p.proacl) a
          WHERE a.grantee=binding."issuerSessionOid" AND a.grantor=p.proowner AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
          WHERE a.grantor<>p.proowner OR a.grantee NOT IN (p.proowner,binding."issuerSessionOid") OR a.grantee<>p.proowner AND a.is_grantable))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles r CROSS JOIN (VALUES
        ('public.jg_contract_direct_upward_issuer_binding_v2'::regclass),
        ('public.jg_contract_direct_upward_intent_receipt_v2'::regclass)
      ) private_relation(oid)
      WHERE (r.oid=binding."issuerSessionOid" OR EXISTS(SELECT 1 FROM unnest(outside_roles) existing(role_oid)
          WHERE pg_catalog.pg_has_role(existing.role_oid,r.oid,'MEMBER')))
        AND (pg_catalog.has_table_privilege(r.oid,private_relation.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR pg_catalog.has_any_column_privilege(r.oid,private_relation.oid,'SELECT,INSERT,UPDATE,REFERENCES')))
    OR pg_catalog.has_function_privilege(binding."issuerSessionOid",basis_function,'EXECUTE')
    OR basis_function IS DISTINCT FROM binding."basisRoutineOid"
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
      WHERE p.oid=basis_function AND p.proowner=binding."anchorOwnerOid" AND p.pronamespace=binding."namespaceOid"
        AND p.prokind='f' AND NOT p.prosecdef AND NOT p.proretset AND p.proisstrict AND p.provolatile='s'
        AND p.proparallel='u' AND p.prorettype='pg_catalog.jsonb'::regtype AND l.lanname='plpgsql'
        AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp'] AND p.pronargdefaults=0 AND p.provariadic=0
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='d4a923bb0ccb2df2d38b588d5948e05791c14efe8f67bc3104a700917529314e') THEN
    RAISE EXCEPTION '对上直签发行身份或原请求来源不匹配' USING ERRCODE='55000';
  END IF;
  RETURN encode(public.digest(convert_to(to_jsonb(binding)::text,'UTF8'),'sha256'),'hex');
END;
$role$;

CREATE FUNCTION public.jg_guard_contract_direct_upward_intent_v2() RETURNS TRIGGER
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $guard$
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION '对上直签发行依据只能追加' USING ERRCODE='23514';
  END IF;
  IF TG_RELID='public.jg_contract_direct_upward_issuer_binding_v2'::regclass THEN
    IF current_user IS DISTINCT FROM session_user OR current_user::regrole::oid IS DISTINCT FROM NEW."anchorOwnerOid"
      OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=TG_RELID AND c.relowner=NEW."anchorOwnerOid"
        AND c.relnamespace=NEW."namespaceOid") THEN
      RAISE EXCEPTION '对上直签发行只能由原安装所有者绑定' USING ERRCODE='42501';
    END IF;
  ELSIF TG_RELID='public.jg_contract_direct_upward_intent_receipt_v2'::regclass THEN
    IF NEW."bindingSha256" IS DISTINCT FROM public.jg_check_contract_direct_upward_issuer_v2()
      OR NEW."issuedAt">pg_catalog.clock_timestamp() THEN
      RAISE EXCEPTION '对上直签发行收据缺少绑定身份' USING ERRCODE='42501';
    END IF;
  ELSE
    RAISE EXCEPTION '对上直签发行绑定表不匹配' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$guard$;

CREATE TRIGGER jg_direct_upward_issuer_binding_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.jg_contract_direct_upward_issuer_binding_v2
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_contract_direct_upward_intent_v2();
CREATE TRIGGER jg_direct_upward_issuer_binding_no_truncate
BEFORE TRUNCATE ON public.jg_contract_direct_upward_issuer_binding_v2
FOR EACH STATEMENT EXECUTE FUNCTION public.jg_guard_contract_direct_upward_intent_v2();
CREATE TRIGGER jg_direct_upward_intent_receipt_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.jg_contract_direct_upward_intent_receipt_v2
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_contract_direct_upward_intent_v2();
CREATE TRIGGER jg_direct_upward_intent_receipt_no_truncate
BEFORE TRUNCATE ON public.jg_contract_direct_upward_intent_receipt_v2
FOR EACH STATEMENT EXECUTE FUNCTION public.jg_guard_contract_direct_upward_intent_v2();

CREATE FUNCTION public.jg_issue_contract_direct_upward_intent_v2(
  p_channel_nonce UUID,p_actor TEXT,p_project TEXT,p_contract TEXT,p_version TEXT,p_revision INTEGER,
  p_input_sha TEXT,p_key TEXT,p_evidence JSONB
) RETURNS UUID
LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $issue$
DECLARE
  binding_sha TEXT;
  payload JSONB;
  issued TIMESTAMPTZ;
  intent_id UUID;
BEGIN
  binding_sha:=public.jg_check_contract_direct_upward_issuer_v2();
  IF NOT EXISTS(SELECT 1 FROM public.jg_contract_direct_upward_issuer_binding_v2 binding
    WHERE binding."protocolVersion"=2 AND binding."channelNonce"=p_channel_nonce) THEN
    RAISE EXCEPTION '对上直签发行通道与当前环境不匹配' USING ERRCODE='42501';
  END IF;
  payload:=public.jg_contract_direct_archive_upward_intent_basis_v2(
    p_actor,p_project,p_contract,p_version,p_revision,p_input_sha,p_key,p_evidence);
  IF payload IS NULL THEN
    RAISE EXCEPTION '对上直签发行缺少原请求依据' USING ERRCODE='23514';
  END IF;
  issued:=pg_catalog.clock_timestamp();
  intent_id:=pg_catalog.gen_random_uuid();
  INSERT INTO public.jg_contract_direct_upward_intent_receipt_v2("intentId","bindingSha256","payloadSha256","issuedAt","expiresAt")
    VALUES(intent_id,binding_sha,encode(public.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex'),issued,issued+interval '2 minutes');
  RETURN intent_id;
END;
$issue$;

REVOKE ALL ON FUNCTION public.jg_check_contract_direct_upward_issuer_v2(),
  public.jg_guard_contract_direct_upward_intent_v2(),
  public.jg_issue_contract_direct_upward_intent_v2(UUID,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,JSONB) FROM PUBLIC;

DO $acl$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid='public.jg_contract_direct_archive_upward_intent_basis_v2(text,text,text,text,integer,text,text,jsonb)'::regprocedure
      AND p.proowner=current_user::regrole::oid AND NOT p.prosecdef AND p.provolatile='s' AND p.proisstrict
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='d4a923bb0ccb2df2d38b588d5948e05791c14efe8f67bc3104a700917529314e')
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      WHERE p.oid IN ('public.jg_check_contract_direct_upward_issuer_v2()'::regprocedure,
        'public.jg_guard_contract_direct_upward_intent_v2()'::regprocedure,
        'public.jg_issue_contract_direct_upward_intent_v2(uuid,text,text,text,text,integer,text,text,jsonb)'::regprocedure)
        AND (a.grantee<>p.proowner OR a.grantor<>p.proowner))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
      WHERE c.oid IN ('public.jg_contract_direct_upward_issuer_binding_v2'::regclass,
        'public.jg_contract_direct_upward_intent_receipt_v2'::regclass)
        AND (a.grantee<>c.relowner OR a.grantor<>c.relowner)) THEN
    RAISE EXCEPTION '对上直签发行来源或私有权限不匹配' USING ERRCODE='55000';
  END IF;
END;
$acl$;

COMMIT;
