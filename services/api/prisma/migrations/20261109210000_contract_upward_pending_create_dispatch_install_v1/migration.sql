BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

-- Attach only the initial upward draft insert. Match the untouched 214
-- installation, then record one separate immutable successor witness.
LOCK TABLE public."ContractVersion" IN SHARE ROW EXCLUSIVE MODE;

DO $install$
DECLARE
  pending RECORD; dispatch RECORD; f RECORD; e RECORD; old_version RECORD; attachment RECORD; v_trigger RECORD;
  current_value JSONB; version_body TEXT; app_name TEXT; dispatch_sha TEXT; legacy_body TEXT;
  schema_oid OID:=pg_catalog.to_regnamespace('public');
  db_oid OID;
  witness_oid OID:=pg_catalog.to_regclass('public.jg_contract_upward_pending_create_binding_v1');
  witness_guard_oid OID:=pg_catalog.to_regprocedure('public.jg_guard_upward_pending_create_binding_v1()');
  create_oid OID:=pg_catalog.to_regprocedure('public.jg_guard_contract_upward_pending_create_v1(public."ContractVersion")');
  version_oid OID:=pg_catalog.to_regprocedure('public.jg_contract_direct_pending_version_guard_v1()');
  attachment_oid OID:=pg_catalog.to_regprocedure('public.jg_contract_direct_pending_attachment_guard_v1()');
  version_relation OID:=pg_catalog.to_regclass('public."ContractVersion"');
  attachment_relation OID:=pg_catalog.to_regclass('public."ContractDraftAttachment"');
BEGIN
  SELECT oid INTO STRICT db_oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database();
  SELECT p.* INTO STRICT pending FROM public.jg_contract_direct_pending_binding_v1 p WHERE p."protocolVersion"=1;
  SELECT d.* INTO STRICT dispatch FROM public.jg_contract_direct_archive_dispatch_binding_v1 d WHERE d."protocolVersion"=1;
  SELECT rolname INTO STRICT app_name FROM pg_catalog.pg_roles WHERE oid=pending."applicationRoleOid";
  IF pending."recipeVersion" IS DISTINCT FROM 'contract-direct-pending-input-v1/1'
    OR dispatch."recipeVersion" IS DISTINCT FROM 'contract-direct-archive-dispatch-v1/1'
    OR pending."databaseOid" IS DISTINCT FROM db_oid OR dispatch."databaseOid" IS DISTINCT FROM db_oid
    OR pending."anchorNamespaceOid" IS DISTINCT FROM schema_oid OR dispatch."namespaceOid" IS DISTINCT FROM schema_oid
    OR pending."anchorOwnerOid" IS DISTINCT FROM current_user::regrole::oid
    OR dispatch."anchorOwnerOid" IS DISTINCT FROM pending."anchorOwnerOid"
    OR dispatch."applicationRoleOid" IS DISTINCT FROM pending."applicationRoleOid"
    OR pending."applicationRoleOid"=pending."anchorOwnerOid"
    OR dispatch."links"->>'pendingOid' IS DISTINCT FROM 'public.jg_contract_direct_pending_binding_v1'::regclass::oid::text
    OR dispatch."links"->>'pendingSha' IS DISTINCT FROM encode(public.digest(convert_to(to_jsonb(pending)::text,'UTF8'),'sha256'),'hex')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(pending."applicationRoleOid",r.oid,'MEMBER')
      AND (r.rolsuper OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication
        OR pg_catalog.pg_has_role(r.oid,pending."anchorOwnerOid",'MEMBER')
        OR pg_catalog.has_schema_privilege(r.oid,schema_oid,'CREATE'))) THEN
    RAISE EXCEPTION '对上创建的既有安装身份不匹配';
  END IF;
  IF (SELECT count(*) FROM jsonb_each(dispatch."bindings"->'routines'))<>2
    OR (SELECT count(*) FROM jsonb_each(dispatch."bindings"->'helpers'))<>6
    OR (SELECT count(*) FROM jsonb_each(dispatch."bindings"->'triggers'))<>5 THEN
    RAISE EXCEPTION '原表外接线见证不完整';
  END IF;

  -- Verify the installed 214 routine metadata and owner-only helper ACLs.
  FOR e IN SELECT * FROM jsonb_each(dispatch."bindings"->'routines') LOOP
    SELECT p.*,l.lanname,t.typname INTO STRICT f
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
      JOIN pg_catalog.pg_type t ON t.oid=p.prorettype WHERE p.oid=pg_catalog.to_regprocedure(e.key);
    current_value:=jsonb_build_object('oid',f.oid::text,'namespaceOid',f.pronamespace::text,'ownerOid',f.proowner::text,
      'bodySha256',encode(public.digest(convert_to(f.prosrc,'UTF8'),'sha256'),'hex'),
      'securityDefiner',f.prosecdef,'configuration',f.proconfig,'acl',f.proacl,'language',f.lanname,
      'returnType',f.typname,'volatility',f.provolatile,'parallel',f.proparallel,'strict',f.proisstrict,'returnsSet',f.proretset);
    IF current_value IS DISTINCT FROM e.value THEN RAISE EXCEPTION '原表外分派目录已漂移'; END IF;
  END LOOP;
  FOR e IN SELECT * FROM jsonb_each(dispatch."bindings"->'helpers') LOOP
    SELECT p.*,l.lanname,to_jsonb(p)-'prosrc' AS metadata INTO STRICT f
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE p.oid=pg_catalog.to_regprocedure(e.key);
    current_value:=f.metadata||jsonb_build_object('oid',f.oid::text,'proowner',f.proowner::text,'pronamespace',f.pronamespace::text,
      'prorettype',f.prorettype::text,'language',f.lanname,'bodySha256',encode(public.digest(convert_to(f.prosrc,'UTF8'),'sha256'),'hex'));
    IF current_value IS DISTINCT FROM e.value OR EXISTS (
      SELECT 1 FROM pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) acl
      WHERE acl.grantee<>f.proowner OR acl.grantor<>f.proowner) THEN
      RAISE EXCEPTION '原表外技术例程或所有者专用权限已漂移';
    END IF;
  END LOOP;
  FOR e IN SELECT * FROM jsonb_each(dispatch."bindings"->'triggers') LOOP
    SELECT to_jsonb(t)||jsonb_build_object('oid',t.oid::text,'tgrelid',t.tgrelid::text,'tgfoid',t.tgfoid::text,
      'tgattr',t.tgattr::text,'tgargs',encode(t.tgargs,'hex')) INTO STRICT current_value
      FROM pg_catalog.pg_trigger t WHERE t.oid=(e.value->>'oid')::oid AND t.tgname=e.key;
    IF current_value IS DISTINCT FROM e.value THEN RAISE EXCEPTION '原表外触发器接线已漂移'; END IF;
  END LOOP;

  SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT old_version FROM pg_catalog.pg_proc p WHERE p.oid=version_oid;
  legacy_body:=old_version.prosrc;
  IF encode(public.digest(convert_to(legacy_body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM
    '82b74ba31f58fbec7e9365966e5551f67169ec8a8a70b26f6c96f7f3a01e550e' THEN
    RAISE EXCEPTION '原版本分派源码不是准确表外后态';
  END IF;
  SELECT t.* INTO STRICT v_trigger FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid=version_relation AND t.tgname='jg_direct_pending_version_shape' AND t.tgfoid=version_oid
      AND t.tgtype=23 AND t.tgenabled='O' AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred
      AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text='';
  SELECT t.* INTO STRICT attachment FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgrelid=attachment_relation AND t.tgname='jg_direct_pending_attachment_source' AND p.oid=attachment_oid
      AND t.tgtype=23 AND t.tgenabled='O' AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred
      AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text=''
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='75824d061e5183bc3fb2fd3ec25804e2d471920d1f92b5bdd01ebc9a4cdd95d1';
  IF v_trigger.oid::text IS DISTINCT FROM pending."bindings"#>>'{triggers,jg_direct_pending_version_shape,oid}'
    OR attachment.oid::text IS DISTINCT FROM pending."bindings"#>>'{triggers,jg_direct_pending_attachment_source,oid}'
    OR attachment_oid::text IS DISTINCT FROM pending."bindings"#>>'{triggers,jg_direct_pending_attachment_source,functionOid}'
    OR EXISTS (SELECT 1 FROM public.jg_contract_upward_pending_create_binding_v1)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=witness_oid AND c.relowner=pending."anchorOwnerOid"
      AND c.relnamespace=schema_oid AND c.relkind='r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=witness_oid AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL)
    OR (SELECT array_agg(format('%s:%s',a.attname,a.atttypid) ORDER BY a.attnum)
      FROM pg_catalog.pg_attribute a WHERE a.attrelid=witness_oid AND a.attnum>0 AND NOT a.attisdropped
        AND a.attnotnull AND a.attgenerated='' AND a.attidentity='' AND NOT a.atthasdef) IS DISTINCT FROM ARRAY['protocolVersion:23','applicationRoleOid:26','databaseOid:26','namespaceOid:26','ownerOid:26',
          'directDispatchSha256:25','versionTriggerOid:26','versionRoutineOid:26','attachmentTriggerOid:26','helperOid:26']
    OR 10<>(SELECT count(*) FROM pg_catalog.pg_attribute a WHERE a.attrelid=witness_oid AND a.attnum>0 AND NOT a.attisdropped)
    OR 2<>(SELECT count(*) FROM pg_catalog.pg_trigger t WHERE t.tgrelid=witness_oid)
    OR 1<>(SELECT count(*) FROM pg_catalog.pg_constraint c WHERE c.conrelid=witness_oid AND c.contype='p'
      AND c.conkey=ARRAY[1]::smallint[] AND c.convalidated AND NOT c.condeferrable)
    OR (SELECT count(*) FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
      WHERE t.tgrelid=witness_oid AND p.oid=witness_guard_oid AND p.proowner=pending."anchorOwnerOid" AND p.pronamespace=schema_oid
        AND NOT p.prosecdef AND NOT p.proisstrict AND p.provolatile='v' AND p.prorettype='pg_catalog.trigger'::regtype
        AND p.proconfig=ARRAY['search_path=pg_catalog, public']::text[]
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='1596a00b04dd2907b229d7ae1a4c53645d0c3f9d6837fef5c6396cda0707bd26'
        AND t.tgenabled='O' AND NOT t.tgisinternal AND NOT t.tgdeferrable AND t.tgqual IS NULL AND t.tgattr::text='' AND t.tgnargs=0
        AND ((t.tgname='jg_upward_pending_create_binding_immutable' AND t.tgtype=31)
          OR (t.tgname='jg_upward_pending_create_binding_no_truncate' AND t.tgtype=34)))<>2 THEN
    RAISE EXCEPTION '对上创建见证或原件触发器不匹配';
  END IF;

  SELECT p.* INTO STRICT f FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
    WHERE p.oid=create_oid AND p.proowner=pending."anchorOwnerOid" AND p.pronamespace=schema_oid
      AND p.prokind='f' AND NOT p.prosecdef AND NOT p.proisstrict AND NOT p.proretset
      AND p.provolatile='s' AND p.proparallel='u' AND p.pronargdefaults=0 AND p.provariadic=0
      AND p.prorettype=(SELECT reltype FROM pg_catalog.pg_class WHERE oid=version_relation)
      AND p.proconfig=ARRAY['search_path=pg_catalog, public']::text[] AND l.lanname='plpgsql'
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='367527eea9629755f1ef287c36a52a76f9b768ac86bbaa475aa0422a564944be';
  IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) acl
      WHERE acl.grantee<>f.proowner OR acl.grantor<>f.proowner)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl
      WHERE c.oid=witness_oid AND (acl.grantee<>c.relowner OR acl.grantor<>c.relowner)) THEN
    RAISE EXCEPTION '对上新对象不是安装所有者专用';
  END IF;

  -- Do not expand business reads to satisfy the new validator.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid IN
      (version_relation,'public."Contract"'::regclass,'public."Project"'::regclass)
      AND (c.relkind<>'r' OR c.relrowsecurity OR c.relforcerowsecurity))
    OR EXISTS (SELECT 1 FROM (VALUES
      ('public."Contract"','id'),('public."Contract"','projectId'),('public."Contract"','ownerUserId'),
      ('public."Contract"','contractTypeKey'),('public."Contract"','voidedAt'),('public."Contract"','code'),
      ('public."Contract"','companyEntityId'),('public."Contract"','name'),('public."Contract"','counterparty'),
      ('public."Project"','id'),('public."Project"','isActive'),('public."ContractVersion"','contractId')
    ) fields(relation_name,column_name)
    WHERE pg_catalog.has_column_privilege(pending."applicationRoleOid",pg_catalog.to_regclass(fields.relation_name),
      fields.column_name,'SELECT') IS DISTINCT FROM TRUE) THEN
    RAISE EXCEPTION '应用角色缺少原有对上来源读取资格';
  END IF;

  EXECUTE format('GRANT SELECT ON TABLE public.jg_contract_upward_pending_create_binding_v1 TO %I',app_name);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_guard_contract_upward_pending_create_v1(public."ContractVersion") TO %I',app_name);
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE oid=pending."applicationRoleOid" AND rolname=app_name)
    OR NOT pg_catalog.has_table_privilege(pending."applicationRoleOid",witness_oid,'SELECT')
    OR NOT pg_catalog.has_function_privilege(pending."applicationRoleOid",create_oid,'EXECUTE')
    OR (SELECT count(*) FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) acl
      WHERE c.oid=witness_oid AND acl.grantee<>c.relowner)<>1
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) acl
      WHERE c.oid=witness_oid AND (acl.grantor<>c.relowner OR (acl.grantee<>c.relowner AND
        (acl.grantee<>pending."applicationRoleOid" OR acl.privilege_type<>'SELECT' OR acl.is_grantable))))
    OR (SELECT count(*) FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) acl
      WHERE p.oid=create_oid AND acl.grantee<>p.proowner)<>1
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) acl
      WHERE p.oid=create_oid AND (acl.grantor<>p.proowner OR (acl.grantee<>p.proowner AND
        (acl.grantee<>pending."applicationRoleOid" OR acl.privilege_type<>'EXECUTE' OR acl.is_grantable))))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(pending."applicationRoleOid",r.oid,'MEMBER')
      AND (pg_catalog.has_table_privilege(r.oid,witness_oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=witness_oid AND a.attnum>0 AND NOT a.attisdropped
          AND pg_catalog.has_column_privilege(r.oid,witness_oid,a.attnum,'INSERT,UPDATE,REFERENCES')))) THEN
    RAISE EXCEPTION '对上创建技术授权未按精确范围安装';
  END IF;

  version_body:=$upward_dispatch$
DECLARE d JSONB; old_d JSONB; signed_day TEXT; loc JSONB; role_name TEXT; terms_id TEXT;
BEGIN
  IF TG_OP = 'INSERT' AND NEW."draftData"#>>'{directSigningInput,relationship}'='upward' THEN
    RETURN public.jg_guard_contract_upward_pending_create_v1(NEW::public."ContractVersion");
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."draftData"#>>'{directSigningInput,relationship}'='upward'
      OR NEW."draftData"#>>'{directSigningInput,relationship}'='upward' THEN
      RAISE EXCEPTION '对上直签草稿保存资格尚未供应' USING ERRCODE='55000';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."draftData" ? 'directSigningInput' AND (OLD."status" = 'effective' OR NEW."status" = 'effective') THEN
      RETURN public.jg_guard_contract_direct_archive_version_transition_v1(OLD::public."ContractVersion", NEW::public."ContractVersion");
    END IF;
  END IF;
  d := NEW."draftData" -> 'directSigningInput';
  IF TG_OP = 'UPDATE' THEN
    old_d := OLD."draftData" -> 'directSigningInput';
    IF old_d IS NULL AND d IS NOT NULL THEN RAISE EXCEPTION '现有草稿不能通过保存变更办理来源' USING ERRCODE = '23514'; END IF;
    IF old_d IS NOT NULL AND (d IS NULL OR OLD."numericProtocolVersion" <> 2
      OR NEW."numericProtocolVersion" <> OLD."numericProtocolVersion"
      OR NEW."contractId" <> OLD."contractId" OR NEW."changeType" <> OLD."changeType"
      OR NEW."versionNo" <> OLD."versionNo"
      OR (d - ARRAY['signedOn','enterpriseParty','counterpartyParty','fixedPaymentTermsVersionId']) IS DISTINCT FROM
         (old_d - ARRAY['signedOn','enterpriseParty','counterpartyParty','fixedPaymentTermsVersionId'])) THEN
      RAISE EXCEPTION '已签合同办理来源不可替换' USING ERRCODE = '23514';
    END IF;
    IF old_d->'fixedPaymentTermsVersionId' <> 'null'::jsonb AND d->'fixedPaymentTermsVersionId' IS DISTINCT FROM old_d->'fixedPaymentTermsVersionId' THEN
      RAISE EXCEPTION '本草稿已有固定付款约定来源，不能改指另一版本' USING ERRCODE='23514';
    END IF;
    IF OLD."status" <> 'draft' AND (NEW."originalSignedNumber" IS DISTINCT FROM OLD."originalSignedNumber" OR d IS DISTINCT FROM old_d) THEN
      RAISE EXCEPTION '已结束草稿的原号及签署输入不可改写' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF d IS NULL THEN
    IF NEW."originalSignedNumber" IS NOT NULL THEN RAISE EXCEPTION '原号只能用于已签合同直接登记来源' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(CASE WHEN jsonb_typeof(d)='object' THEN d ELSE '{}'::jsonb END)) <> 7
    OR NOT d ?& ARRAY['protocolVersion','source','relationship','signedOn','enterpriseParty','counterpartyParty','fixedPaymentTermsVersionId']
    OR d->'protocolVersion' IS DISTINCT FROM '1'::jsonb OR d->>'source' IS DISTINCT FROM 'direct_signed'
    OR d->>'relationship' IS DISTINCT FROM 'outside' OR NEW."numericProtocolVersion" <> 2
    OR NEW."changeType" IS DISTINCT FROM 'original' OR NEW."supersedesVersionId" IS NOT NULL
    OR NEW."draftData"#>>'{contractBasics,relationship}' IS DISTINCT FROM 'outside'
    OR NEW."status" NOT IN ('draft','abandoned') OR NEW."firstSubmittedAt" IS NOT NULL OR NEW."effectiveAt" IS NOT NULL
    OR NEW."documentContentFingerprint" IS NOT NULL THEN
    RAISE EXCEPTION '已签合同待登记来源格式不完整或后续能力尚未开放' USING ERRCODE = '23514';
  END IF;
  -- Exact empty string alone means no original paper number. Whitespace is data.
  IF NEW."originalSignedNumber" = '' THEN NEW."originalSignedNumber" := NULL; END IF;
  IF d->'signedOn' <> 'null'::jsonb THEN
    signed_day := d->>'signedOn';
    IF jsonb_typeof(d->'signedOn') <> 'string' OR signed_day !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR substring(signed_day,1,4) = '0000' THEN RAISE EXCEPTION '签订日期须为真实年月日或留空' USING ERRCODE = '23514'; END IF;
    BEGIN
      IF to_char(make_date(substring(signed_day,1,4)::int,substring(signed_day,6,2)::int,substring(signed_day,9,2)::int),'YYYY-MM-DD') <> signed_day THEN RAISE EXCEPTION 'invalid_date'; END IF;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION '签订日期不是有效日期' USING ERRCODE = '23514'; END;
  END IF;
  FOREACH role_name IN ARRAY ARRAY['enterpriseParty','counterpartyParty'] LOOP
    loc := d->role_name;
    IF loc <> 'null'::jsonb AND (jsonb_typeof(loc) IS DISTINCT FROM 'object'
      OR (SELECT count(*) FROM jsonb_object_keys(CASE WHEN jsonb_typeof(loc)='object' THEN loc ELSE '{}'::jsonb END)) <> 2 OR NOT loc ?& ARRAY['roleKey','displayOrder']
      OR jsonb_typeof(loc->'roleKey') IS DISTINCT FROM 'string' OR loc->>'roleKey' NOT IN ('party_a','party_b','party_c','guarantor','consortium_member','other')
      OR jsonb_typeof(loc->'displayOrder') IS DISTINCT FROM 'number' OR loc->>'displayOrder' !~ '^(0|[1-9][0-9]*)$') THEN
      RAISE EXCEPTION '签约双方位置不正确' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF d->'enterpriseParty' <> 'null'::jsonb AND d->'enterpriseParty' = d->'counterpartyParty' THEN RAISE EXCEPTION '签约双方不能使用同一位置' USING ERRCODE = '23514'; END IF;
  IF d->'fixedPaymentTermsVersionId' <> 'null'::jsonb THEN
    terms_id := d->>'fixedPaymentTermsVersionId';
    IF jsonb_typeof(d->'fixedPaymentTermsVersionId') IS DISTINCT FROM 'string' OR terms_id = ''
      OR NOT EXISTS (SELECT 1 FROM public."PaymentTermsVersion" p WHERE p."id" = terms_id AND p."contractId" = NEW."contractId" AND p."contractVersionId" = NEW."id") THEN
      RAISE EXCEPTION '付款约定来源与当前合同不一致' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$upward_dispatch$;
  IF encode(public.digest(convert_to(version_body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM
    '522410b9ebe38ea3e7e59861aa74dd39616cd3231615c40f02ab2d6ab1b36e93' THEN
    RAISE EXCEPTION '对上创建分派源码不匹配';
  END IF;
  EXECUTE replace(pg_catalog.pg_get_functiondef(version_oid),legacy_body,version_body);
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=version_oid AND p.prosrc=version_body
    AND to_jsonb(p)-'prosrc'=old_version.metadata)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.oid=v_trigger.oid AND to_jsonb(t)=to_jsonb(v_trigger)) THEN
    RAISE EXCEPTION '对上接线破坏了原版本例程或触发器身份';
  END IF;
  dispatch_sha:=encode(public.digest(convert_to(to_jsonb(dispatch)::text,'UTF8'),'sha256'),'hex');
  INSERT INTO public.jg_contract_upward_pending_create_binding_v1(
    "protocolVersion","applicationRoleOid","databaseOid","namespaceOid","ownerOid","directDispatchSha256",
    "versionTriggerOid","versionRoutineOid","attachmentTriggerOid","helperOid")
  VALUES(1,pending."applicationRoleOid",db_oid,schema_oid,pending."anchorOwnerOid",dispatch_sha,
    v_trigger.oid,version_oid,attachment.oid,create_oid);
END;
$install$;

COMMIT;
