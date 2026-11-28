BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

-- Private source. A qualified installer must separately bind the dedicated
-- session/owner pairs, assign routine ownership and supply exact rights.
CREATE TABLE public.jg_contract_direct_archive_intent_binding_v1 (
  "protocolVersion" INTEGER PRIMARY KEY CHECK ("protocolVersion"=1),
  "databaseOid" OID NOT NULL,
  "namespaceOid" OID NOT NULL,
  "anchorOwnerOid" OID NOT NULL,
  "ordinaryApplicationRoleOid" OID NOT NULL,
  "completionRelationOid" OID NOT NULL,
  "completionSha256" TEXT NOT NULL CHECK ("completionSha256" ~ '^[a-f0-9]{64}$'),
  "issuerSessionOid" OID NOT NULL,
  "issuerOwnerOid" OID NOT NULL,
  "runtimeSessionOid" OID NOT NULL,
  "executorOwnerOid" OID NOT NULL
);
CREATE TABLE public.jg_contract_direct_archive_intent_v1 (
  "intentId" UUID PRIMARY KEY,
  "bindingSha256" TEXT NOT NULL CHECK ("bindingSha256" ~ '^[a-f0-9]{64}$'),
  "payloadSha256" TEXT NOT NULL CHECK ("payloadSha256" ~ '^[a-f0-9]{64}$'),
  "issuedAt" TIMESTAMPTZ NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL CHECK ("expiresAt"="issuedAt"+interval '2 minutes')
);
CREATE TABLE public.jg_contract_direct_archive_intent_use_v1 (
  "intentId" UUID PRIMARY KEY REFERENCES public.jg_contract_direct_archive_intent_v1("intentId") ON DELETE RESTRICT,
  "databaseOid" OID NOT NULL,
  "runtimeSessionOid" OID NOT NULL,
  "executorOwnerOid" OID NOT NULL,
  "backendPid" INTEGER NOT NULL,
  "transactionId" BIGINT NOT NULL,
  "usedAt" TIMESTAMPTZ NOT NULL
);
REVOKE ALL ON TABLE public.jg_contract_direct_archive_intent_binding_v1, public.jg_contract_direct_archive_intent_v1,
  public.jg_contract_direct_archive_intent_use_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_guard_contract_direct_archive_intent_append_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $append_guard$
DECLARE binding RECORD;
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_OP<>'INSERT' THEN
    RAISE EXCEPTION '直签登记执行依据只能追加' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='jg_contract_direct_archive_intent_binding_v1' THEN
    IF current_user::regrole::oid IS DISTINCT FROM NEW."anchorOwnerOid"
      OR NOT EXISTS(SELECT 1 FROM public.jg_contract_direct_archive_completion_binding_v1 c
        WHERE c."protocolVersion"=1 AND c."anchorOwnerOid"=NEW."anchorOwnerOid")
      OR EXISTS(SELECT 1 FROM public.jg_contract_direct_archive_intent_binding_v1) THEN
      RAISE EXCEPTION '直签登记执行绑定缺少可信安装身份' USING ERRCODE='55000';
    END IF;
  ELSE
    SELECT * INTO STRICT binding FROM public.jg_contract_direct_archive_intent_binding_v1 WHERE "protocolVersion"=1;
    IF TG_TABLE_NAME='jg_contract_direct_archive_intent_v1' THEN
      IF session_user::regrole::oid IS DISTINCT FROM binding."issuerSessionOid"
        OR current_user::regrole::oid IS DISTINCT FROM binding."issuerOwnerOid" THEN
        RAISE EXCEPTION '直签登记意图只接受可信签发人' USING ERRCODE='42501';
      END IF;
    ELSIF TG_TABLE_NAME='jg_contract_direct_archive_intent_use_v1' THEN
      IF session_user::regrole::oid IS DISTINCT FROM binding."runtimeSessionOid"
        OR current_user::regrole::oid IS DISTINCT FROM binding."executorOwnerOid"
        OR NEW."databaseOid" IS DISTINCT FROM binding."databaseOid"
        OR NEW."runtimeSessionOid" IS DISTINCT FROM binding."runtimeSessionOid"
        OR NEW."executorOwnerOid" IS DISTINCT FROM binding."executorOwnerOid"
        OR NEW."backendPid" IS DISTINCT FROM pg_catalog.pg_backend_pid()
        OR NEW."transactionId" IS DISTINCT FROM pg_catalog.txid_current() THEN
        RAISE EXCEPTION '直签登记意图只由绑定执行事务使用' USING ERRCODE='42501';
      END IF;
    ELSE
      RAISE EXCEPTION '直签登记执行依据接线错误' USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$append_guard$;
CREATE TRIGGER jg_direct_archive_intent_binding_append
BEFORE INSERT OR UPDATE OR DELETE ON public.jg_contract_direct_archive_intent_binding_v1
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_contract_direct_archive_intent_append_v1();
CREATE TRIGGER jg_direct_archive_intent_binding_no_truncate
BEFORE TRUNCATE ON public.jg_contract_direct_archive_intent_binding_v1
FOR EACH STATEMENT EXECUTE FUNCTION public.jg_guard_contract_direct_archive_intent_append_v1();
CREATE TRIGGER jg_direct_archive_intent_append
BEFORE INSERT OR UPDATE OR DELETE ON public.jg_contract_direct_archive_intent_v1
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_contract_direct_archive_intent_append_v1();
CREATE TRIGGER jg_direct_archive_intent_no_truncate
BEFORE TRUNCATE ON public.jg_contract_direct_archive_intent_v1
FOR EACH STATEMENT EXECUTE FUNCTION public.jg_guard_contract_direct_archive_intent_append_v1();
CREATE TRIGGER jg_direct_archive_intent_use_append
BEFORE INSERT OR UPDATE OR DELETE ON public.jg_contract_direct_archive_intent_use_v1
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_contract_direct_archive_intent_append_v1();
CREATE TRIGGER jg_direct_archive_intent_use_no_truncate
BEFORE TRUNCATE ON public.jg_contract_direct_archive_intent_use_v1
FOR EACH STATEMENT EXECUTE FUNCTION public.jg_guard_contract_direct_archive_intent_append_v1();

CREATE FUNCTION public.jg_check_contract_direct_archive_intent_roles_v1(p_issuing BOOLEAN) RETURNS TEXT
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $role_guard$
DECLARE binding public.jg_contract_direct_archive_intent_binding_v1%ROWTYPE; roles OID[];
  issue_oid OID:=pg_catalog.to_regprocedure('public.jg_issue_contract_direct_archive_intent_v1(text,text,text,text,integer,text,text,jsonb)');
  use_oid OID:=pg_catalog.to_regprocedure('public.jg_consume_contract_direct_archive_intent_v1(uuid,text,text,text,text,integer,text,text,jsonb)');
BEGIN
  SELECT * INTO STRICT binding FROM public.jg_contract_direct_archive_intent_binding_v1 WHERE "protocolVersion"=1;
  roles:=ARRAY[binding."issuerSessionOid",binding."issuerOwnerOid",binding."runtimeSessionOid",binding."executorOwnerOid"];
  IF 4<>(SELECT count(DISTINCT role_oid) FROM unnest(roles) AS requested(role_oid))
    OR binding."ordinaryApplicationRoleOid"=ANY(roles) OR binding."anchorOwnerOid"=ANY(roles)
    OR current_user::regrole::oid IS DISTINCT FROM (CASE WHEN p_issuing THEN binding."issuerOwnerOid" ELSE binding."executorOwnerOid" END)
    OR session_user::regrole::oid IS DISTINCT FROM (CASE WHEN p_issuing THEN binding."issuerSessionOid" ELSE binding."runtimeSessionOid" END)
    OR pg_catalog.current_setting('session_replication_role')<>'origin'
    OR binding."databaseOid" IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database())
    OR binding."namespaceOid" IS DISTINCT FROM pg_catalog.to_regnamespace('public')::oid
    OR NOT EXISTS(SELECT 1 FROM public.jg_contract_direct_archive_completion_binding_v1 c
      WHERE c."protocolVersion"=1 AND c."recipeVersion"='contract-direct-archive-completion-dispatch-v1/1'
        AND c.tableoid=binding."completionRelationOid" AND c."databaseOid"=binding."databaseOid"
        AND c."namespaceOid"=binding."namespaceOid" AND c."anchorOwnerOid"=binding."anchorOwnerOid"
        AND c."applicationRoleOid"=binding."ordinaryApplicationRoleOid"
        AND encode(public.digest(convert_to(to_jsonb(c)::text,'UTF8'),'sha256'),'hex')=binding."completionSha256")
    OR 4<>(SELECT count(*) FROM pg_catalog.pg_roles r WHERE r.oid=ANY(roles)
      AND r.rolcanlogin=(r.oid IN (binding."issuerSessionOid",binding."runtimeSessionOid"))
      AND NOT (r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls)
      AND NOT pg_catalog.has_schema_privilege(r.oid,binding."namespaceOid",'CREATE')
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles granted_role
        WHERE granted_role.oid<>r.oid AND pg_catalog.pg_has_role(r.oid,granted_role.oid,'MEMBER')))
    OR EXISTS(SELECT 1 FROM unnest(roles) AS target(role_oid)
      WHERE pg_catalog.pg_has_role(binding."ordinaryApplicationRoleOid",target.role_oid,'MEMBER'))
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=issue_oid AND p.prosecdef AND p.proowner=binding."issuerOwnerOid")
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=use_oid AND NOT p.prosecdef AND p.proowner=binding."executorOwnerOid")
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles r
      WHERE pg_catalog.pg_has_role(binding."ordinaryApplicationRoleOid",r.oid,'MEMBER')
        AND (pg_catalog.has_function_privilege(r.oid,issue_oid,'EXECUTE') OR pg_catalog.has_function_privilege(r.oid,use_oid,'EXECUTE')))
    OR pg_catalog.has_function_privilege(binding."runtimeSessionOid",issue_oid,'EXECUTE') IS DISTINCT FROM FALSE
    OR pg_catalog.has_function_privilege(binding."runtimeSessionOid",use_oid,'EXECUTE') IS DISTINCT FROM FALSE
    OR pg_catalog.has_function_privilege(binding."issuerSessionOid",use_oid,'EXECUTE') IS DISTINCT FROM FALSE
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles r CROSS JOIN (VALUES
          ('public.jg_contract_direct_archive_intent_binding_v1'::regclass),
          ('public.jg_contract_direct_archive_intent_v1'::regclass),
          ('public.jg_contract_direct_archive_intent_use_v1'::regclass)
        ) private_relations(relation_oid)
      WHERE (r.oid IN (binding."issuerSessionOid",binding."runtimeSessionOid")
          OR pg_catalog.pg_has_role(binding."ordinaryApplicationRoleOid",r.oid,'MEMBER'))
        AND (pg_catalog.has_table_privilege(r.oid,private_relations.relation_oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
          OR pg_catalog.has_any_column_privilege(r.oid,private_relations.relation_oid,'SELECT,INSERT,UPDATE,REFERENCES')))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid IN (
      'public."Contract"'::regclass,'public."ContractVersion"'::regclass,'public."Project"'::regclass,
      'public."User"'::regclass,'public."FileObject"'::regclass,
      'public.jg_contract_direct_archive_intent_binding_v1'::regclass,
      'public.jg_contract_direct_archive_intent_v1'::regclass,'public.jg_contract_direct_archive_intent_use_v1'::regclass)
      AND (c.relkind<>'r' OR c.relrowsecurity OR c.relforcerowsecurity)) THEN
    RAISE EXCEPTION '直签登记执行身份尚未完整供应' USING ERRCODE='55000';
  END IF;
  RETURN encode(public.digest(convert_to(to_jsonb(binding)::text,'UTF8'),'sha256'),'hex');
END;
$role_guard$;

CREATE FUNCTION public.jg_contract_direct_archive_intent_payload_v1(
  p_actor TEXT,p_project TEXT,p_contract TEXT,p_version TEXT,p_revision INTEGER,p_input_sha TEXT,p_request_key TEXT,p_evidence JSONB
) RETURNS JSONB
LANGUAGE plpgsql STABLE STRICT SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $payload$
DECLARE file_ids TEXT[]; request_sha TEXT;
  uuid_pattern CONSTANT TEXT:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
BEGIN
  IF length(p_actor) NOT BETWEEN 1 AND 128 OR length(p_project) NOT BETWEEN 1 AND 128
    OR length(p_contract) NOT BETWEEN 1 AND 128 OR length(p_version) NOT BETWEEN 1 AND 128
    OR p_revision<1 OR p_input_sha!~'^[a-f0-9]{64}$' OR p_request_key!~uuid_pattern
    OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION '直签登记意图缺少原请求坐标' USING ERRCODE='23514';
  END IF;
  IF jsonb_array_length(p_evidence) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION '直签登记意图缺少签章原件' USING ERRCODE='23514';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_evidence) WITH ORDINALITY AS evidence(item,position)
    WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
      OR NOT (item ?& ARRAY['fileId','displayOrder','mimeType','sizeBytes','contentSha256','bucket','objectKey','objectGeneration'])
      OR (item-ARRAY['fileId','displayOrder','mimeType','sizeBytes','contentSha256','bucket','objectKey','objectGeneration'])<>'{}'::jsonb
      OR jsonb_typeof(item->'fileId') IS DISTINCT FROM 'string' OR item->>'fileId'!~uuid_pattern
      OR item->'displayOrder' IS DISTINCT FROM to_jsonb(position-1)
      OR item->>'displayOrder' IS DISTINCT FROM (position-1)::text
      OR jsonb_typeof(item->'mimeType') IS DISTINCT FROM 'string'
      OR item->>'mimeType' NOT IN ('application/pdf','image/jpeg','image/png')
      OR jsonb_typeof(item->'sizeBytes') IS DISTINCT FROM 'number'
      OR item->>'sizeBytes'!~'^[1-9][0-9]{0,9}$' OR item->'sizeBytes'>'2147483647'::jsonb
      OR jsonb_typeof(item->'contentSha256') IS DISTINCT FROM 'string' OR item->>'contentSha256'!~'^[a-f0-9]{64}$'
      OR jsonb_typeof(item->'bucket') IS DISTINCT FROM 'string' OR length(item->>'bucket') NOT BETWEEN 1 AND 255
      OR jsonb_typeof(item->'objectKey') IS DISTINCT FROM 'string' OR length(item->>'objectKey') NOT BETWEEN 1 AND 2048
      OR jsonb_typeof(item->'objectGeneration') IS DISTINCT FROM 'string'
      OR length(item->>'objectGeneration') NOT BETWEEN 1 AND 1024 OR lower(btrim(item->>'objectGeneration')) IN ('','null')) THEN
    RAISE EXCEPTION '直签登记意图的原件内容或物理身份不完整' USING ERRCODE='23514';
  END IF;
  SELECT array_agg(item->>'fileId' ORDER BY position) INTO file_ids
    FROM jsonb_array_elements(p_evidence) WITH ORDINALITY AS evidence(item,position);
  IF cardinality(file_ids)<>(SELECT count(DISTINCT id) FROM unnest(file_ids) AS files(id))
    OR cardinality(file_ids)<>(SELECT count(DISTINCT ROW(item->>'bucket',item->>'objectKey')) FROM jsonb_array_elements(p_evidence) AS evidence(item)) THEN
    RAISE EXCEPTION '直签登记意图的原件身份重复' USING ERRCODE='23514';
  END IF;
  request_sha:=public.jg_contract_direct_archive_request_sha_v1(p_contract,p_version,p_actor,p_request_key,p_revision,p_input_sha,file_ids);
  IF request_sha IS NULL THEN RAISE EXCEPTION '直签登记意图无法绑定原请求' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('protocolVersion',1,'archiveSource','direct_signed','relationship','outside','actor',p_actor,
    'projectId',p_project,'contractId',p_contract,'contractVersionId',p_version,'sourceRevision',p_revision,
    'inputSha256',p_input_sha,'requestKey',p_request_key,'requestSha256',request_sha,'orderedEvidence',p_evidence);
END;
$payload$;

CREATE FUNCTION public.jg_issue_contract_direct_archive_intent_v1(
  p_actor TEXT,p_project TEXT,p_contract TEXT,p_version TEXT,p_revision INTEGER,p_input_sha TEXT,p_request_key TEXT,p_evidence JSONB
) RETURNS UUID
LANGUAGE plpgsql VOLATILE STRICT SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $issuer$
DECLARE binding_sha TEXT; payload JSONB; issued TIMESTAMPTZ; intent_id UUID;
BEGIN
  binding_sha:=public.jg_check_contract_direct_archive_intent_roles_v1(true);
  payload:=public.jg_contract_direct_archive_intent_payload_v1(p_actor,p_project,p_contract,p_version,p_revision,p_input_sha,p_request_key,p_evidence);
  issued:=pg_catalog.clock_timestamp();
  intent_id:=pg_catalog.gen_random_uuid();
  INSERT INTO public.jg_contract_direct_archive_intent_v1("intentId","bindingSha256","payloadSha256","issuedAt","expiresAt")
    VALUES(intent_id,binding_sha,encode(public.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex'),issued,issued+interval '2 minutes');
  RETURN intent_id;
END;
$issuer$;

CREATE FUNCTION public.jg_consume_contract_direct_archive_intent_v1(
  p_intent UUID,p_actor TEXT,p_project TEXT,p_contract TEXT,p_version TEXT,p_revision INTEGER,p_input_sha TEXT,p_request_key TEXT,p_evidence JSONB
) RETURNS JSONB
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $consumer$
DECLARE binding_sha TEXT; payload JSONB; intent RECORD; actual_source JSONB; evidence_manifest JSONB; used TIMESTAMPTZ; affected INTEGER;
BEGIN
  binding_sha:=public.jg_check_contract_direct_archive_intent_roles_v1(false);
  payload:=public.jg_contract_direct_archive_intent_payload_v1(p_actor,p_project,p_contract,p_version,p_revision,p_input_sha,p_request_key,p_evidence);
  used:=pg_catalog.clock_timestamp();
  SELECT "bindingSha256","payloadSha256","issuedAt","expiresAt" INTO intent
    FROM public.jg_contract_direct_archive_intent_v1 WHERE "intentId"=p_intent;
  IF NOT FOUND OR intent."bindingSha256" IS DISTINCT FROM binding_sha
    OR intent."payloadSha256" IS DISTINCT FROM encode(public.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex')
    OR used<intent."issuedAt" OR used>=intent."expiresAt" THEN
    RAISE EXCEPTION '直签登记意图缺失、已过期或与原请求不符' USING ERRCODE='23514';
  END IF;

  -- The future confined writer holds C/V/P/F and file-binding locks before
  -- consumption. SQL re-reads the Q and physical row identity; the issuer
  -- independently attests the storage generation and verified bytes.
  SELECT public.jg_contract_direct_pending_input_v1(v."id") INTO actual_source
  FROM public."ContractVersion" v JOIN public."Contract" c ON c."id"=v."contractId"
  JOIN public."Project" p ON p."id"=c."projectId"
  WHERE v."id"=p_version AND c."id"=p_contract AND p."id"=p_project
    AND c."ownerUserId"=p_actor AND c."voidedAt" IS NULL AND p."isActive" AND p."operatingLedgerEffectiveDate" IS NULL
    AND v."status"='draft' AND v."draftRevision"=p_revision
    AND EXISTS(SELECT 1 FROM public."User" u WHERE u."id"=p_actor AND u."isActive");
  SELECT jsonb_agg(item-ARRAY['bucket','objectKey','objectGeneration'] ORDER BY position) INTO evidence_manifest
    FROM jsonb_array_elements(p_evidence) WITH ORDINALITY AS evidence(item,position);
  IF actual_source->>'state' IS DISTINCT FROM 'complete'
    OR actual_source->'sourceRevision' IS DISTINCT FROM to_jsonb(p_revision)
    OR actual_source->>'inputSha256' IS DISTINCT FROM p_input_sha
    OR actual_source#>'{Q,signedFiles}' IS DISTINCT FROM evidence_manifest
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_evidence) AS evidence(item)
      LEFT JOIN public."FileObject" f ON f."id"=item->>'fileId'
      WHERE f."id" IS NULL OR f."uploadedByUserId" IS DISTINCT FROM p_actor
        OR f."storageStatus" IS DISTINCT FROM 'active' OR f."purgeReceiptId" IS NOT NULL OR f."supersedesFileObjectId" IS NOT NULL
        OR f."bucket" IS DISTINCT FROM item->>'bucket' OR f."objectKey" IS DISTINCT FROM item->>'objectKey'
        OR f."mimeType" IS DISTINCT FROM item->>'mimeType' OR to_jsonb(f."sizeBytes") IS DISTINCT FROM item->'sizeBytes'
        OR f."contentSha256" IS DISTINCT FROM item->>'contentSha256') THEN
    RAISE EXCEPTION '直签登记意图的实际资料或原件身份已变化' USING ERRCODE='23514';
  END IF;
  INSERT INTO public.jg_contract_direct_archive_intent_use_v1
    ("intentId","databaseOid","runtimeSessionOid","executorOwnerOid","backendPid","transactionId","usedAt")
    VALUES(p_intent,(SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()),
      session_user::regrole::oid,current_user::regrole::oid,pg_catalog.pg_backend_pid(),pg_catalog.txid_current(),used)
    ON CONFLICT ("intentId") DO NOTHING;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 OR pg_catalog.clock_timestamp()>=intent."expiresAt"
    OR binding_sha IS DISTINCT FROM public.jg_check_contract_direct_archive_intent_roles_v1(false) THEN
    RAISE EXCEPTION '直签登记意图已使用、已过期或执行身份已变化' USING ERRCODE='55000';
  END IF;
  RETURN payload;
END;
$consumer$;

REVOKE ALL ON FUNCTION public.jg_guard_contract_direct_archive_intent_append_v1(),
  public.jg_check_contract_direct_archive_intent_roles_v1(BOOLEAN),
  public.jg_contract_direct_archive_intent_payload_v1(TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,JSONB),
  public.jg_issue_contract_direct_archive_intent_v1(TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,JSONB),
  public.jg_consume_contract_direct_archive_intent_v1(UUID,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,JSONB) FROM PUBLIC;

-- Abort on default non-owner grants. This source supplies neither role
-- membership, executable privileges, nor a binding row.
DO $closed_source$
BEGIN
  IF current_user IS DISTINCT FROM session_user OR pg_catalog.current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT 1 FROM public.jg_contract_direct_archive_completion_binding_v1 c
      WHERE c."protocolVersion"=1 AND c."recipeVersion"='contract-direct-archive-completion-dispatch-v1/1'
        AND c."anchorOwnerOid"=current_user::regrole::oid
        AND c."databaseOid"=(SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database())) THEN
    RAISE EXCEPTION '直签登记执行源码缺少可信安装身份';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl
    WHERE c.oid IN ('public.jg_contract_direct_archive_intent_binding_v1'::regclass,
      'public.jg_contract_direct_archive_intent_v1'::regclass,'public.jg_contract_direct_archive_intent_use_v1'::regclass)
      AND (acl.grantee<>c.relowner OR acl.grantor<>c.relowner))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
      WHERE p.pronamespace='public'::regnamespace AND p.proname IN (
        'jg_guard_contract_direct_archive_intent_append_v1','jg_check_contract_direct_archive_intent_roles_v1',
        'jg_contract_direct_archive_intent_payload_v1','jg_issue_contract_direct_archive_intent_v1',
        'jg_consume_contract_direct_archive_intent_v1')
        AND (acl.grantee<>p.proowner OR acl.grantor<>p.proowner)) THEN
    RAISE EXCEPTION '直签登记执行源码发现未经核对的默认授权';
  END IF;
END;
$closed_source$;
COMMIT;
