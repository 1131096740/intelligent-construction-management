-- Activate only through a separately authorized installer with four pre-provisioned roles.
BEGIN;
SET LOCAL search_path TO pg_catalog,pg_temp;

CREATE TABLE public.jg_contract_direct_archive_native_nonce_v1 (
  "protocolVersion" INTEGER PRIMARY KEY CHECK ("protocolVersion"=1),
  "intentBindingSha256" TEXT NOT NULL CHECK ("intentBindingSha256"~'^[a-f0-9]{64}$'),
  "nonce" UUID NOT NULL UNIQUE
);
REVOKE ALL ON public.jg_contract_direct_archive_native_nonce_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_guard_contract_direct_archive_native_nonce_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $nonce_guard$
BEGIN
  IF TG_RELID IS DISTINCT FROM 'public.jg_contract_direct_archive_native_nonce_v1'::regclass OR TG_OP<>'INSERT'
    OR current_user IS DISTINCT FROM session_user
    OR NOT EXISTS(SELECT 1 FROM public.jg_contract_direct_archive_intent_binding_v1 i WHERE i."protocolVersion"=1
      AND i."anchorOwnerOid"=current_user::regrole::oid
      AND NEW."intentBindingSha256"=encode(public.digest(convert_to(to_jsonb(i)::text,'UTF8'),'sha256'),'hex')) THEN
    RAISE EXCEPTION '直签登记安装标识只能由对应安装者写入一次' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$nonce_guard$;
REVOKE ALL ON FUNCTION public.jg_guard_contract_direct_archive_native_nonce_v1() FROM PUBLIC;
CREATE TRIGGER jg_direct_native_nonce_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.jg_contract_direct_archive_native_nonce_v1
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_contract_direct_archive_native_nonce_v1();
CREATE TRIGGER jg_direct_native_nonce_no_truncate
BEFORE TRUNCATE ON public.jg_contract_direct_archive_native_nonce_v1
FOR EACH STATEMENT EXECUTE FUNCTION public.jg_guard_contract_direct_archive_native_nonce_v1();

CREATE FUNCTION public.jg_contract_direct_archive_native_channel_v1() RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $channel$
DECLARE
  nonce UUID;
BEGIN
  SELECT w."nonce" INTO nonce FROM public.jg_contract_direct_archive_intent_binding_v1 i
  JOIN public.jg_contract_direct_archive_native_nonce_v1 w ON w."protocolVersion"=1
    AND w."intentBindingSha256"=encode(public.digest(convert_to(to_jsonb(i)::text,'UTF8'),'sha256'),'hex')
  JOIN pg_catalog.pg_database d ON d.oid=i."databaseOid" AND d.datname=pg_catalog.current_database()
  WHERE i."protocolVersion"=1 AND i."anchorOwnerOid"=current_user::regrole::oid
    AND i."namespaceOid"=pg_catalog.to_regnamespace('public')
    AND session_user::regrole::oid IN (i."issuerSessionOid",i."runtimeSessionOid")
    AND pg_catalog.current_setting('session_replication_role')='origin';
  RETURN nonce;
END;
$channel$;
REVOKE ALL ON FUNCTION public.jg_contract_direct_archive_native_channel_v1() FROM PUBLIC;

CREATE VIEW public.jg_contract_direct_archive_native_binding_v1 WITH (security_barrier=true) AS
SELECT i."databaseOid",i."namespaceOid",i."anchorOwnerOid",i."ordinaryApplicationRoleOid",i."completionRelationOid",
  i."issuerSessionOid",i."issuerOwnerOid",i."runtimeSessionOid",i."executorOwnerOid",
  encode(public.digest(convert_to(to_jsonb(i)::text,'UTF8'),'sha256'),'hex') AS "intentBindingSha256",w."nonce"
FROM public.jg_contract_direct_archive_intent_binding_v1 i
JOIN public.jg_contract_direct_archive_completion_binding_v1 c ON c.tableoid=i."completionRelationOid"
  AND c."protocolVersion"=1 AND c."databaseOid"=i."databaseOid" AND c."namespaceOid"=i."namespaceOid"
  AND c."anchorOwnerOid"=i."anchorOwnerOid" AND c."applicationRoleOid"=i."ordinaryApplicationRoleOid"
  AND encode(public.digest(convert_to(to_jsonb(c)::text,'UTF8'),'sha256'),'hex')=i."completionSha256"
JOIN public.jg_contract_direct_archive_native_nonce_v1 w ON w."protocolVersion"=1
  AND w."intentBindingSha256"=encode(public.digest(convert_to(to_jsonb(i)::text,'UTF8'),'sha256'),'hex')
WHERE i."protocolVersion"=1;
REVOKE ALL ON public.jg_contract_direct_archive_native_binding_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_install_contract_direct_archive_outside_v1(
  issuer_login NAME,issuer_owner NAME,executor_login NAME,executor_owner NAME
) RETURNS VOID
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path=pg_catalog,public,pg_temp AS $install$
DECLARE
  anchor RECORD;
  pending RECORD;
  selected RECORD;
  previous RECORD;
  role_ids OID[];
  anchor_owner OID:=current_user::regrole::oid;
  public_schema OID:=pg_catalog.to_regnamespace('public')::oid;
  database_id OID;
  app_name NAME;
  previous_body TEXT;
  next_body TEXT;
  old_test CONSTANT TEXT:='current_user IS DISTINCT FROM session_user OR pg_catalog.current_setting(''session_replication_role'')<>''origin''';
  next_test CONSTANT TEXT:='current_user IS NOT DISTINCT FROM session_user OR pg_catalog.current_setting(''session_replication_role'')<>''origin''';
  expected_profile CONSTANT TEXT:=E'\nBEGIN\n  RETURN public.jg_contract_direct_archive_outside_profile_v1();\nEND;\n';
  target_oid OID;
  issuer_function CONSTANT TEXT:='public.jg_issue_contract_direct_archive_intent_v1(text,text,text,text,integer,text,text,jsonb)';
  consumer_function CONSTANT TEXT:='public.jg_consume_contract_direct_archive_intent_v1(uuid,text,text,text,text,integer,text,text,jsonb)';
  executor_function CONSTANT TEXT:='public.jg_execute_contract_direct_archive_outside_v1(uuid,text,text,text,text,integer,text,text,jsonb)';
  collision RECORD;
BEGIN
  LOCK TABLE public.jg_contract_direct_archive_intent_binding_v1 IN ACCESS EXCLUSIVE MODE;
  SELECT oid INTO STRICT database_id FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database();
  SELECT c.*,c.tableoid AS relation_oid,encode(public.digest(convert_to(to_jsonb(c)::text,'UTF8'),'sha256'),'hex') AS sha
    INTO STRICT anchor FROM public.jg_contract_direct_archive_completion_binding_v1 c WHERE c."protocolVersion"=1;
  SELECT b.* INTO STRICT pending FROM public.jg_contract_direct_pending_binding_v1 b WHERE b."protocolVersion"=1;
  SELECT rolname INTO STRICT app_name FROM pg_catalog.pg_roles WHERE oid=anchor."applicationRoleOid";
  role_ids:=ARRAY[to_regrole(issuer_login::text)::oid,to_regrole(issuer_owner::text)::oid,
    to_regrole(executor_login::text)::oid,to_regrole(executor_owner::text)::oid];
  IF current_user IS DISTINCT FROM session_user OR anchor."anchorOwnerOid"<>anchor_owner OR anchor."namespaceOid"<>public_schema
    OR anchor."databaseOid"<>database_id OR anchor."recipeVersion"<>'contract-direct-archive-completion-dispatch-v1/1'
    OR pending."anchorOwnerOid"<>anchor_owner OR pending."anchorNamespaceOid"<>public_schema
    OR pending."databaseOid"<>database_id OR pending."applicationRoleOid"<>anchor."applicationRoleOid"
    OR pg_catalog.current_setting('session_replication_role')<>'origin'
    OR EXISTS(SELECT 1 FROM public.jg_contract_direct_archive_intent_binding_v1)
    OR 4<>(SELECT count(DISTINCT id) FROM unnest(role_ids) AS roles(id))
    OR anchor_owner=ANY(role_ids) OR anchor."applicationRoleOid"=ANY(role_ids) OR pending."fileCallerOids"&&role_ids
    OR NOT pg_catalog.pg_has_role(anchor_owner,role_ids[2],'USAGE')
    OR NOT pg_catalog.pg_has_role(anchor_owner,role_ids[4],'USAGE')
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE r.oid=ANY(role_ids) AND (
      r.rolcanlogin IS DISTINCT FROM (r.oid IN (role_ids[1],role_ids[3]))
      OR r.rolsuper OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
      OR pg_catalog.has_schema_privilege(r.oid,public_schema,'CREATE')
      OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles parent WHERE parent.oid<>r.oid AND pg_catalog.pg_has_role(r.oid,parent.oid,'MEMBER'))
      OR pg_catalog.pg_has_role(anchor."applicationRoleOid",r.oid,'MEMBER')))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN unnest(role_ids) AS role_id(id)
      WHERE c.relnamespace=public_schema AND c.relkind IN ('r','v','p','f','m')
      AND (pg_catalog.has_table_privilege(role_id.id,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR pg_catalog.has_any_column_privilege(role_id.id,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) THEN
    RAISE EXCEPTION '直签登记安装身份或独立角色前态不匹配' USING ERRCODE='55000';
  END IF;

  -- These sources must have been installed by the same qualified owner, with
  -- the corrected 220 role guard. A source-only uncorrected history fails here.
  FOR selected IN SELECT * FROM (VALUES
    ('public.jg_check_contract_direct_archive_intent_roles_v1(boolean)','19afa3783a3a18126af58e7e61633367ec6d745eb602e88cbe36d7c7a790cde9'),
    (issuer_function,'0a23f773a3a7d26ef01402a8b63de715bc4fed1fb829ba7425d618b9c1fab843'),
    (consumer_function,'fd818746c316d13ee04dc139e251c992787a9b212b7bd61854f8ceabcc9eb0f0'),
    (executor_function,'6cb7d9c5be655cd9c69a22027be5964e84d9b2daa1f9e58942f9449509f0ce72'),
    ('public.jg_contract_direct_archive_outside_profile_v1()','c0101a8c6d2283f6d58d2ef65a77b49ce7a00686559f45efad1e407ed96ce842'),
    ('public.jg_record_contract_direct_archive_generations_v1(text,uuid,text,text,text,text,integer,text,text,jsonb)',
      '7f383484f39d3e5b5be0cdb955a8a8910cc95dca5ee5d6d09242ce9ba94d08ed'),
    ('public.jg_guard_contract_direct_archive_version_transition_v1(public."ContractVersion",public."ContractVersion")',
      'c376d219b8d97e2d8e895f39fcf6af1b768fef8ae2dff9c37d356d8374086157')
  ) recipe(signature,sha) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid=pg_catalog.to_regprocedure(selected.signature) AND p.proowner=anchor_owner AND p.pronamespace=public_schema
        AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=selected.sha
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
          WHERE acl.grantee<>anchor_owner OR acl.grantor<>anchor_owner)) THEN
      RAISE EXCEPTION '直签登记专用函数前态不匹配' USING ERRCODE='55000';
    END IF;
  END LOOP;

  FOR selected IN SELECT * FROM (VALUES
    ('public.jg_assert_contract_direct_archive_write_profile_v1()','aefd46b1516b7905971112abbbbf795ad4560f74e975be3ee99f076f2ee93616','b418f8e2de1ae5b4607a898d8de4ca96c1e3b987c2ffbd8a8701018e76c56349','profile'),
    ('public.jg_write_contract_direct_archive_v1(text,text,text,integer,text,text[],jsonb)','5210b13d158e4a5ffea39ed42d7d3e2d07360dd72b4fa627e73cd762dd4d9269','df0c7cdab49101a1b09a4b06177918debeeb284635afd9d6e21af931274074c0','writer'),
    ('public.jg_guard_contract_direct_archive_parent_v1(public."ContractArchiveFile")','8fa9e8b88c4a9334658b05f8f0bf0e9b370df1ed0eceb3887d72c35dd95c802d','1e9d6404ecd618617aa74dc85fc656be334f1b0d8219d7e814361866f6e4b903','parent'),
    ('public.jg_require_contract_direct_archive_transition_profile_v1()','45ea86eac1ba402cfe41b007f164bb876fa3749a0c10d164abfa436b1cba1b0b','c34dead07d5837558a41e68350b21b8b2d5818f60e21eef23c43c59f68bbb23a','transition')
  ) recipe(signature,old_sha,new_sha,phase) LOOP
    target_oid:=pg_catalog.to_regprocedure(selected.signature);
    SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT previous FROM pg_catalog.pg_proc p
      WHERE p.oid=target_oid AND p.proowner=anchor_owner AND p.pronamespace=public_schema AND NOT p.prosecdef
        AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
        AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
          WHERE acl.grantee<>anchor_owner OR acl.grantor<>anchor_owner);
    previous_body:=previous.prosrc;
    next_body:=CASE WHEN selected.phase='profile' THEN expected_profile ELSE replace(previous_body,old_test,next_test) END;
    IF encode(public.digest(convert_to(previous_body,'UTF8'),'sha256'),'hex')<>selected.old_sha
      OR encode(public.digest(convert_to(next_body,'UTF8'),'sha256'),'hex')<>selected.new_sha THEN
      RAISE EXCEPTION '直签登记守卫前态或后态不匹配' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(pg_catalog.pg_get_functiondef(target_oid),previous_body,next_body);
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=target_oid AND p.prosrc=next_body
      AND to_jsonb(p)-'prosrc'=previous.metadata) THEN
      RAISE EXCEPTION '直签登记守卫不能改变既有对象身份' USING ERRCODE='55000';
    END IF;
    IF selected.phase='writer' THEN
      -- The pinned generic file trigger invokes its collision functions using
      -- unqualified names. Public precedes any temporary shadow during writes.
      EXECUTE format('ALTER FUNCTION %s SET search_path TO pg_catalog,public,pg_temp',selected.signature);
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',selected.signature,executor_owner);
  END LOOP;

  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I,%I,%I,%I',issuer_login,issuer_owner,executor_login,executor_owner);
  EXECUTE format('GRANT CREATE ON SCHEMA public TO %I,%I',issuer_owner,executor_owner);
  EXECUTE format('ALTER FUNCTION %s OWNER TO %I',issuer_function,issuer_owner);
  EXECUTE format('ALTER FUNCTION %s OWNER TO %I',consumer_function,executor_owner);
  EXECUTE format('ALTER FUNCTION %s OWNER TO %I',executor_function,executor_owner);
  EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I,%I',issuer_owner,executor_owner);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',issuer_function,issuer_login);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I',executor_function,executor_login);

  EXECUTE format('GRANT SELECT ON public.jg_contract_direct_archive_intent_binding_v1,
    public.jg_contract_direct_archive_completion_binding_v1 TO %I,%I',issuer_owner,executor_owner);
  EXECUTE format('GRANT INSERT ON public.jg_contract_direct_archive_intent_v1 TO %I',issuer_owner);
  EXECUTE format('GRANT SELECT ON public.jg_contract_direct_archive_intent_v1 TO %I',executor_owner);
  EXECUTE format('GRANT SELECT,INSERT ON public.jg_contract_direct_archive_intent_use_v1,
    public.jg_contract_direct_archive_generation_v1 TO %I',executor_owner);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_check_contract_direct_archive_intent_roles_v1(boolean),
    public.jg_contract_direct_archive_intent_payload_v1(text,text,text,text,integer,text,text,jsonb),
    public.jg_contract_direct_archive_request_sha_v1(text,text,text,text,integer,text,text[]) TO %I,%I',issuer_owner,executor_owner);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_contract_direct_archive_outside_profile_v1(),
    public.jg_guard_contract_direct_archive_version_transition_v1(public."ContractVersion",public."ContractVersion"),
    public.jg_contract_direct_pending_input_v1(text),public.jg_contract_direct_archive_proof_v1(text),
    public.jg_require_contract_direct_archive_complete_v1(),public.jg_read_contract_direct_archive_generations_v1(text),
    public.jg_record_contract_direct_archive_generations_v1(text,uuid,text,text,text,text,integer,text,text,jsonb) TO %I',executor_owner);

  EXECUTE format('GRANT SELECT ON public."Contract",public."ContractVersion",public."Project",public."FileObject",
    public."ProjectAffiliateAssignment",public."ContractPartySnapshot",public."BusinessPartyVersion",
    public."ContractDraftAttachment",public."ContractArchiveFile",public."ContractArchiveEvidenceFile",
    public."PaymentTermsVersion",public."PaymentTermsStage",public."ProjectAffiliateContractFact",
    public."ContractEconomicReview",public."OperatingFact",public."OperatingImpactEntry" TO %I',executor_owner);
  EXECUTE format('GRANT SELECT ("id","isActive") ON public."User" TO %I',executor_owner);
  EXECUTE format('GRANT SELECT ("id","key") ON public."Position" TO %I',executor_owner);
  EXECUTE format('GRANT SELECT ("positionId","userId","projectId") ON public."UserPosition" TO %I',executor_owner);
  EXECUTE format('GRANT SELECT ("userId","projectId","positionKey") ON public."ProjectMember" TO %I',executor_owner);
  EXECUTE format('GRANT UPDATE ("id") ON public."Contract",public."Project",public."FileObject",public."ContractDraftAttachment" TO %I',executor_owner);
  EXECUTE format('GRANT UPDATE ("status","effectiveAt","taxFactsFrozenAt","updatedAt") ON public."ContractVersion" TO %I',executor_owner);
  EXECUTE format('GRANT UPDATE ("status","updatedAt") ON public."PaymentTermsVersion" TO %I',executor_owner);
  EXECUTE format('GRANT DELETE ON public."ContractDraftAttachment" TO %I',executor_owner);
  EXECUTE format('GRANT INSERT ("id","contractVersionId","uploadedByUserId","confirmedByUserId","confirmedAt","status","archiveProtocolVersion",
    "archiveSource","idempotencyKey","requestSha256","sourceRevision","authoritySnapshot","authoritySha256","fileManifestSha256","responseSnapshot")
    ON public."ContractArchiveFile" TO %I',executor_owner);
  EXECUTE format('GRANT INSERT ("id","archiveFileId","contractVersionId","fileId","displayOrder","mimeType","sizeBytes","contentSha256")
    ON public."ContractArchiveEvidenceFile" TO %I',executor_owner);
  EXECUTE format('GRANT INSERT ("id","actorUserId","action","businessType","businessId","metadata") ON public."AuditLog" TO %I',executor_owner);
  -- Reuse the already installed 205 collision-function identities. This grants
  -- just the listed reference columns to the NOLOGIN executor owner.
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid=pg_catalog.to_regprocedure('public.jg_file_business_collision_columns()')
      AND p.oid::text=pending."bindings"#>>'{routines,public.jg_file_business_collision_columns(),oid}'
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='59bcdff6d8e5026d8619a3fd7cf0d8796091e61f41ea4eb1543c9d1e0b530012') THEN
    RAISE EXCEPTION '直签登记原件排他范围前态不匹配' USING ERRCODE='55000';
  END IF;
  -- Do not alter the 205 collision-chain ACLs. Every routine already visible
  -- to the new role must retain its exact registered identity and body.
  IF EXISTS(SELECT 1 FROM jsonb_each(pending."bindings"->'routines') registered
    WHERE (registered.key LIKE 'public.jg_file_business_binding_columns%'
      OR registered.key IN ('public.jg_file_business_collision_columns()','public.jg_has_exclusive_file_business_binding(pg_catalog.text)',
        'public.jg_enforce_exclusive_file_business_binding()'))
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid=pg_catalog.to_regprocedure(registered.key) AND p.oid::text=registered.value->>'oid'
          AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=registered.value->>'bodySha256'
          AND pg_catalog.has_function_privilege(role_ids[4],p.oid,'EXECUTE'))) THEN
    RAISE EXCEPTION '直签登记执行所有者不能读取已绑定的原件排他范围' USING ERRCODE='55000';
  END IF;
  FOR collision IN SELECT DISTINCT "tableName","columnName" FROM public.jg_file_business_collision_columns() LOOP
    EXECUTE format('GRANT SELECT (%I) ON public.%I TO %I',collision."columnName",collision."tableName",executor_owner);
  END LOOP;
  EXECUTE format('GRANT SELECT ("attachmentFileId","correctionType","schemaVersion") ON public."ContractTakeoverCorrection" TO %I',executor_owner);

  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN unnest(ARRAY[role_ids[1],role_ids[3]]) AS login(id)
    WHERE c.relnamespace=public_schema AND c.relkind IN ('r','v','p','f','m')
    AND (pg_catalog.has_table_privilege(login.id,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      OR pg_catalog.has_any_column_privilege(login.id,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) THEN
    RAISE EXCEPTION '直签登记独立登录不可直接访问业务表' USING ERRCODE='55000';
  END IF;
  INSERT INTO public.jg_contract_direct_archive_intent_binding_v1 VALUES
    (1,database_id,public_schema,anchor_owner,anchor."applicationRoleOid",anchor.relation_oid,anchor.sha,
      role_ids[1],role_ids[2],role_ids[3],role_ids[4]);
  INSERT INTO public.jg_contract_direct_archive_native_nonce_v1
    SELECT 1,encode(public.digest(convert_to(to_jsonb(i)::text,'UTF8'),'sha256'),'hex'),pg_catalog.gen_random_uuid()
    FROM public.jg_contract_direct_archive_intent_binding_v1 i WHERE i."protocolVersion"=1;
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_contract_direct_archive_native_channel_v1() TO %I,%I',
    issuer_login,executor_login);
  EXECUTE format('GRANT SELECT ON public.jg_contract_direct_archive_native_binding_v1 TO %I',app_name);
END;
$install$;
REVOKE ALL ON FUNCTION public.jg_install_contract_direct_archive_outside_v1(NAME,NAME,NAME,NAME) FROM PUBLIC;
COMMIT;
