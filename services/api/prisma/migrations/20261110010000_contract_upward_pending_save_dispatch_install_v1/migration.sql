BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;
LOCK TABLE public."ContractVersion", public."ContractDraftAttachment" IN ACCESS EXCLUSIVE MODE;

DO $install_upward_save$
DECLARE
  previous RECORD; direct RECORD; pending RECORD; f RECORD; t RECORD; entry RECORD;
  version_table OID:='public."ContractVersion"'::regclass;
  file_table OID:='public."ContractDraftAttachment"'::regclass;
  binding_table OID:='public.jg_contract_upward_pending_save_binding_v1'::regclass;
  ns OID:=pg_catalog.to_regnamespace('public');
  db OID;
  owner_id OID:=(current_user::regrole::oid);
  app OID;
  app_name TEXT;
  old_subject TEXT;
  checked_subject TEXT;
  new_subject TEXT;
  new_upward TEXT;
  predecessor_sha TEXT;
  expected JSONB; observed JSONB;
  next_version TEXT:=$version_post$
DECLARE d JSONB; old_d JSONB; signed_day TEXT; loc JSONB; role_name TEXT; terms_id TEXT;
BEGIN
  IF TG_OP = 'INSERT' AND NEW."draftData"#>>'{directSigningInput,relationship}'='upward' THEN
    RETURN public.jg_guard_contract_upward_pending_create_v1(NEW::public."ContractVersion");
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."draftData"#>>'{directSigningInput,relationship}'='upward'
      OR NEW."draftData"#>>'{directSigningInput,relationship}'='upward' THEN
      RETURN public.jg_guard_contract_upward_pending_save_v1(OLD::public."ContractVersion", NEW::public."ContractVersion");
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
$version_post$;
  next_attachment TEXT:=$attachment_post$
DECLARE v RECORD; f RECORD; owner_id TEXT; upward_qualified BOOLEAN := FALSE;
BEGIN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW."slotKey" <> 'direct_signed_originals_v1' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD."slotKey"<>'direct_signed_originals_v1' THEN
    RAISE EXCEPTION '既有普通资料不能通过变更槽位升格为签章原件' USING ERRCODE='23514';
  END IF;
  SELECT cv."id",cv."contractId",cv."numericProtocolVersion",cv."changeType",cv."status",cv."draftData" INTO v
    FROM public."ContractVersion" cv WHERE cv."id"=NEW."contractVersionId";
  -- Do not resolve the save binding relation for the original outside caller.
  IF v."draftData"#>>'{directSigningInput,relationship}'='upward' THEN
    SELECT EXISTS(SELECT 1 FROM public.jg_contract_upward_pending_save_binding_v1 b
      WHERE b."protocolVersion"=1 AND b."applicationRoleOid"=current_user::regrole::oid
        AND b."applicationRoleOid"=session_user::regrole::oid) INTO upward_qualified;
  END IF;
  IF v."id" IS NULL OR v."numericProtocolVersion"<>2 OR v."changeType"<>'original' OR v."status"<>'draft'
    OR v."draftData"#>>'{directSigningInput,source}' IS DISTINCT FROM 'direct_signed'
    OR NOT COALESCE((
      (v."draftData"#>>'{directSigningInput,relationship}'='outside' AND v."draftData"#>'{directSigningInput,protocolVersion}'='1'::jsonb)
      OR (v."draftData"#>>'{directSigningInput,relationship}'='upward' AND v."draftData"#>'{directSigningInput,protocolVersion}'='2'::jsonb
        AND upward_qualified)
    ),FALSE) THEN
    RAISE EXCEPTION '此原件槽仅支持真实已签合同待登记草稿' USING ERRCODE='23514';
  END IF;
  SELECT c."ownerUserId" INTO owner_id FROM public."Contract" c WHERE c."id"=v."contractId";
  -- This guard is self-sufficient for a direct SQL caller too. Reentrant G
  -- precedes a nonblocking F; never wait on F while retaining G.
  PERFORM pg_catalog.pg_advisory_xact_lock(190731,13);
  BEGIN
    SELECT fo."id",fo."mimeType",fo."sizeBytes",fo."contentSha256",fo."storageStatus",fo."purgeReceiptId",fo."supersedesFileObjectId",fo."uploadedByUserId" INTO f
      FROM public."FileObject" fo WHERE fo."id"=NEW."fileId" FOR UPDATE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION '原件正在整理，请保留填写稍后重试' USING ERRCODE='55P03';
  END;
  IF owner_id IS NULL OR NEW."createdByUserId" IS DISTINCT FROM owner_id OR f."uploadedByUserId" IS DISTINCT FROM owner_id
    OR f."id" IS NULL OR f."mimeType" NOT IN ('application/pdf','image/jpeg','image/png') OR f."sizeBytes"<=0
    OR f."storageStatus" IS DISTINCT FROM 'active' OR f."purgeReceiptId" IS NOT NULL OR f."supersedesFileObjectId" IS NOT NULL
    OR f."contentSha256" IS NULL OR f."contentSha256" !~ '^[a-f0-9]{64}$'
    OR EXISTS(SELECT 1 FROM public."FileObject" newer WHERE newer."supersedesFileObjectId"=NEW."fileId") THEN
    RAISE EXCEPTION '原件身份、归属或保留状态不允许绑定' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$attachment_post$;
  next_slot TEXT:=$slot_post$
DECLARE
  source_version TEXT; source_slot TEXT; contract_id TEXT; c RECORD; v RECORD; a RECORD;
  old_relevant BOOLEAN; new_relevant BOOLEAN; upward_qualified BOOLEAN := FALSE; witness JSONB; match_count INTEGER;
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'ContractDraftAttachment' THEN
    RAISE EXCEPTION '直签原件槽守卫接线不正确' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    source_version:=NEW."contractVersionId"; source_slot:=NEW."slotKey";
  ELSIF TG_OP='DELETE' THEN
    source_version:=OLD."contractVersionId"; source_slot:=OLD."slotKey";
  ELSIF TG_OP='UPDATE' THEN
    IF OLD."contractVersionId" IS DISTINCT FROM NEW."contractVersionId" OR OLD."slotKey" IS DISTINCT FROM NEW."slotKey" THEN
      old_relevant:=OLD."slotKey"='direct_signed_originals_v1' OR EXISTS (
        SELECT 1 FROM public."ContractVersion" o WHERE o."id"=OLD."contractVersionId" AND o."draftData"?'directSigningInput');
      new_relevant:=NEW."slotKey"='direct_signed_originals_v1' OR EXISTS (
        SELECT 1 FROM public."ContractVersion" n WHERE n."id"=NEW."contractVersionId" AND n."draftData"?'directSigningInput');
      IF old_relevant OR new_relevant THEN RAISE EXCEPTION '签章原件不能迁往其他合同版本或槽位' USING ERRCODE='23514'; END IF;
      RETURN NEW;
    END IF;
    source_version:=OLD."contractVersionId"; source_slot:=OLD."slotKey";
  ELSE
    RAISE EXCEPTION '直签原件槽守卫操作不正确' USING ERRCODE='23514';
  END IF;
  SELECT "contractId" INTO contract_id FROM public."ContractVersion" WHERE "id"=source_version
    AND ("draftData"?'directSigningInput' OR source_slot='direct_signed_originals_v1');
  IF NOT FOUND THEN
    IF source_slot='direct_signed_originals_v1' THEN RAISE EXCEPTION '签章原件槽缺少真实来源' USING ERRCODE='23514'; END IF;
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- A raw slot statement can already hold a slot-row lock. Never wait in the
  -- reverse direction for C or V while a real archive writer may hold them.
  SELECT "id","ownerUserId","voidedAt" INTO c FROM public."Contract" WHERE "id"=contract_id FOR UPDATE NOWAIT;
  SELECT "id","contractId","status","numericProtocolVersion","versionNo","changeType","draftRevision","draftData","effectiveAt","firstSubmittedAt","endedAt"
  INTO v FROM public."ContractVersion" WHERE "id"=source_version FOR UPDATE NOWAIT;
  -- Do not resolve the save binding relation for the original outside caller.
  IF v."draftData"#>>'{directSigningInput,relationship}'='upward' THEN
    SELECT EXISTS(SELECT 1 FROM public.jg_contract_upward_pending_save_binding_v1 b
      WHERE b."protocolVersion"=1 AND b."applicationRoleOid"=current_user::regrole::oid
        AND b."applicationRoleOid"=session_user::regrole::oid) INTO upward_qualified;
  END IF;
  IF c."id" IS NULL OR v."id" IS NULL OR v."contractId" IS DISTINCT FROM c."id" OR c."voidedAt" IS NOT NULL
    OR source_slot IS DISTINCT FROM 'direct_signed_originals_v1' OR v."status" IS DISTINCT FROM 'draft'
    OR v."numericProtocolVersion" IS DISTINCT FROM 2 OR v."versionNo" IS DISTINCT FROM 1 OR v."changeType" IS DISTINCT FROM 'original'
    OR v."effectiveAt" IS NOT NULL OR v."firstSubmittedAt" IS NOT NULL OR v."endedAt" IS NOT NULL
    OR v."draftData"#>>'{directSigningInput,source}' IS DISTINCT FROM 'direct_signed'
    OR NOT COALESCE((
      (v."draftData"#>>'{directSigningInput,relationship}'='outside' AND v."draftData"#>>'{contractBasics,relationship}'='outside'
        AND v."draftData"#>'{directSigningInput,protocolVersion}'='1'::jsonb)
      OR (v."draftData"#>>'{directSigningInput,relationship}'='upward' AND v."draftData"#>>'{contractBasics,relationship}'='upward'
        AND v."draftData"#>'{directSigningInput,protocolVersion}'='2'::jsonb
        AND upward_qualified)
    ),FALSE) THEN
    RAISE EXCEPTION '已结束或已登记的签章原件槽不可增删改' USING ERRCODE='23514';
  END IF;

  SELECT "id","archiveProtocolVersion","archiveSource","status","sourceRevision","uploadedByUserId",
    "confirmedByUserId","authoritySnapshot","authoritySha256","fileManifestSha256"
  INTO a FROM public."ContractArchiveFile" WHERE "contractVersionId"=v."id";
  IF NOT FOUND THEN
    -- An ordinary direct draft save still goes through the existing 205 guards.
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF v."draftData"#>>'{directSigningInput,relationship}'='upward' THEN
    RAISE EXCEPTION '对上草稿原件不能由表外归档交接' USING ERRCODE='23514';
  END IF;
  IF TG_OP<>'DELETE' THEN RAISE EXCEPTION '归档开始后不能新增、移动或更换签章原件' USING ERRCODE='23514'; END IF;
  witness:=public.jg_require_contract_direct_archive_transition_profile_v1();
  IF a."archiveProtocolVersion" IS DISTINCT FROM 2 OR a."archiveSource" IS DISTINCT FROM 'direct_signed'
    OR a."status" IS DISTINCT FROM 'confirmed' OR a."sourceRevision" IS DISTINCT FROM v."draftRevision"
    OR a."uploadedByUserId" IS DISTINCT FROM c."ownerUserId" OR a."confirmedByUserId" IS DISTINCT FROM a."uploadedByUserId"
    OR OLD."createdByUserId" IS DISTINCT FROM a."uploadedByUserId"
    OR a."authoritySnapshot"->>'contractVersionId' IS DISTINCT FROM v."id"
    OR jsonb_typeof(a."authoritySnapshot"->'fileManifest') IS DISTINCT FROM 'array'
    OR a."authoritySha256" IS DISTINCT FROM encode(public.digest(convert_to(a."authoritySnapshot"::text,'UTF8'),'sha256'),'hex')
    OR a."fileManifestSha256" IS DISTINCT FROM encode(public.digest(convert_to((a."authoritySnapshot"->'fileManifest')::text,'UTF8'),'sha256'),'hex')
    OR EXISTS (SELECT 1 FROM public."ContractArchiveFile" other_parent
      WHERE other_parent."contractVersionId"=v."id" AND other_parent."id"<>a."id")
    OR EXISTS (SELECT 1 FROM public."ContractArchiveEvidenceFile" e WHERE e."archiveFileId"=a."id") THEN
    RAISE EXCEPTION '签章原件只能从当前草稿交接到匹配归档' USING ERRCODE='23514';
  END IF;
  SELECT count(*)::integer INTO match_count
  FROM jsonb_array_elements(a."authoritySnapshot"->'fileManifest') WITH ORDINALITY AS frozen(item,position)
  WHERE frozen.item->>'fileId'=OLD."fileId" AND frozen.item->'displayOrder'=to_jsonb(OLD."displayOrder")
    AND frozen.position-1=OLD."displayOrder";
  IF match_count<>1 THEN RAISE EXCEPTION '拟移交原件不在归档的冻结位置' USING ERRCODE='23514'; END IF;
  IF witness IS DISTINCT FROM public.jg_require_contract_direct_archive_transition_profile_v1() THEN
    RAISE EXCEPTION '签章原件移交资格在同一事务内已变化' USING ERRCODE='55000';
  END IF;
  RETURN OLD;
END;
$slot_post$;
  next_version_oid OID:=pg_catalog.to_regprocedure('public.jg_contract_direct_pending_version_guard_v1()');
  next_attachment_oid OID:=pg_catalog.to_regprocedure('public.jg_contract_direct_pending_attachment_guard_v1()');
  next_slot_oid OID:=pg_catalog.to_regprocedure('public.jg_guard_contract_direct_archive_slot_v1()');
  save_oid OID:=pg_catalog.to_regprocedure('public.jg_guard_contract_upward_pending_save_v1(public."ContractVersion",public."ContractVersion")');
  after_oid OID:=pg_catalog.to_regprocedure('public.jg_check_contract_upward_pending_save_v1()');
  binding_oid OID:=pg_catalog.to_regprocedure('public.jg_guard_upward_pending_save_binding_v1()');
  read_oid OID:=pg_catalog.to_regprocedure('public.jg_contract_upward_pending_read_v1(text,text)');
BEGIN
  SELECT oid INTO STRICT db FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database();
  SELECT c.* INTO STRICT previous FROM public.jg_contract_upward_pending_create_binding_v1 c WHERE c."protocolVersion"=1;
  SELECT d.* INTO STRICT direct FROM public.jg_contract_direct_archive_dispatch_binding_v1 d WHERE d."protocolVersion"=1;
  SELECT p.* INTO STRICT pending FROM public.jg_contract_direct_pending_binding_v1 p WHERE p."protocolVersion"=1;
  app:=previous."applicationRoleOid";
  SELECT rolname INTO STRICT app_name FROM pg_catalog.pg_roles WHERE oid=app;
  predecessor_sha:=encode(public.digest(convert_to(to_jsonb(previous)::text,'UTF8'),'sha256'),'hex');
  IF app=owner_id OR previous."ownerOid" IS DISTINCT FROM owner_id OR direct."anchorOwnerOid" IS DISTINCT FROM owner_id
    OR pending."anchorOwnerOid" IS DISTINCT FROM owner_id
    OR previous."databaseOid" IS DISTINCT FROM db OR direct."databaseOid" IS DISTINCT FROM db OR pending."databaseOid" IS DISTINCT FROM db
    OR previous."namespaceOid" IS DISTINCT FROM ns OR direct."namespaceOid" IS DISTINCT FROM ns OR pending."anchorNamespaceOid" IS DISTINCT FROM ns
    OR direct."applicationRoleOid" IS DISTINCT FROM app OR pending."applicationRoleOid" IS DISTINCT FROM app
    OR previous."directDispatchSha256" IS DISTINCT FROM encode(public.digest(convert_to(to_jsonb(direct)::text,'UTF8'),'sha256'),'hex')
    OR direct."links"->>'pendingSha' IS DISTINCT FROM encode(public.digest(convert_to(to_jsonb(pending)::text,'UTF8'),'sha256'),'hex')
    OR previous."versionRoutineOid" IS DISTINCT FROM next_version_oid
    OR EXISTS (SELECT 1 FROM public.jg_contract_upward_pending_save_binding_v1)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(app,r.oid,'MEMBER')
      AND (r.rolsuper OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication OR pg_catalog.pg_has_role(r.oid,owner_id,'MEMBER')
        OR pg_catalog.has_schema_privilege(r.oid,ns,'CREATE'))) THEN
    RAISE EXCEPTION '对上草稿保存接线的既有安装身份不匹配';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=binding_table AND c.relowner=owner_id
      AND c.relnamespace=ns AND c.relkind='r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
      WHERE c.oid=binding_table AND (a.grantee<>owner_id OR a.grantor<>owner_id))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=binding_table AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL)
    OR (SELECT count(*) FROM pg_catalog.pg_trigger h WHERE h.tgrelid=binding_table AND h.tgfoid=binding_oid
      AND h.tgenabled='O' AND NOT h.tgisinternal AND NOT h.tgdeferrable AND NOT h.tginitdeferred AND h.tgqual IS NULL AND h.tgnargs=0
      AND ((h.tgname='jg_upward_pending_save_binding_immutable' AND h.tgtype=31)
        OR (h.tgname='jg_upward_pending_save_binding_no_truncate' AND h.tgtype=34)))<>2
    OR (SELECT count(*) FROM pg_catalog.pg_trigger h WHERE h.tgrelid=binding_table)<>2 THEN
    RAISE EXCEPTION '对上草稿保存见证不是原所有者专用结构';
  END IF;

  FOR entry IN SELECT * FROM (VALUES
    (save_oid,'ee7b3ccc522fa5b18f5212a54718729dd33e9a1713b3768747368a7b331efa50','v', (SELECT reltype FROM pg_catalog.pg_class WHERE oid=version_table)),
    (after_oid,'1541911b049f700fbba33ee1d973fa43aab1577fa8490a7eea1c10e57cde6059','v','pg_catalog.trigger'::regtype::oid),
    (binding_oid,'637c42531d6e58ba08d3d5ec497ccd82874cbe0d713d0e249d794a3694755028','v','pg_catalog.trigger'::regtype::oid),
    (read_oid,'5ab4d19db9a622bd04b533cb86b8868c4c19589c9b90259135069203155218d4','s','pg_catalog.jsonb'::regtype::oid)
  ) helpers(fn,body,vol,ret) LOOP
    SELECT p.* INTO STRICT f FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
      WHERE p.oid=entry.fn AND p.pronamespace=ns AND p.proowner=owner_id AND l.lanname='plpgsql'
      AND NOT p.prosecdef AND NOT p.proisstrict AND NOT p.proretset AND p.prokind='f' AND p.proparallel='u'
      AND p.proconfig=ARRAY['search_path=pg_catalog, public']::text[] AND p.prorettype=entry.ret
      AND p.provolatile::text=entry.vol AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=entry.body;
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a
        WHERE a.grantee<>owner_id OR a.grantor<>owner_id) THEN
      RAISE EXCEPTION '对上保存技术例程不是安装所有者专用';
    END IF;
  END LOOP;

  -- The prior 214 registry remains immutable. Its two dispatch routines
  -- still match, with only the already-qualified 216 version body substituted.
  IF (SELECT count(*) FROM jsonb_each(direct."bindings"->'routines'))<>2
    OR (SELECT count(*) FROM jsonb_each(direct."bindings"->'helpers'))<>6
    OR (SELECT count(*) FROM jsonb_each(direct."bindings"->'triggers'))<>5 THEN
    RAISE EXCEPTION '原表外接线见证不完整';
  END IF;
  FOR entry IN SELECT * FROM jsonb_each(direct."bindings"->'routines') LOOP
    SELECT p.*,l.lanname,r.typname INTO STRICT f FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang JOIN pg_catalog.pg_type r ON r.oid=p.prorettype
      WHERE p.oid=pg_catalog.to_regprocedure(entry.key);
    expected:=entry.value;
    IF f.oid=next_version_oid THEN expected:=expected||jsonb_build_object('bodySha256',
      '522410b9ebe38ea3e7e59861aa74dd39616cd3231615c40f02ab2d6ab1b36e93'); END IF;
    observed:=jsonb_build_object('oid',f.oid::text,'namespaceOid',f.pronamespace::text,'ownerOid',f.proowner::text,
      'bodySha256',encode(public.digest(convert_to(f.prosrc,'UTF8'),'sha256'),'hex'),'securityDefiner',f.prosecdef,
      'configuration',f.proconfig,'acl',f.proacl,'language',f.lanname,'returnType',f.typname,
      'volatility',f.provolatile,'parallel',f.proparallel,'strict',f.proisstrict,'returnsSet',f.proretset);
    IF observed IS DISTINCT FROM expected THEN RAISE EXCEPTION '原表外分派元数据已漂移'; END IF;
  END LOOP;
  FOR entry IN SELECT * FROM jsonb_each(direct."bindings"->'helpers') LOOP
    SELECT p.*,l.lanname,to_jsonb(p)-'prosrc' AS metadata INTO STRICT f FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE p.oid=pg_catalog.to_regprocedure(entry.key);
    observed:=f.metadata||jsonb_build_object('oid',f.oid::text,'proowner',f.proowner::text,'pronamespace',f.pronamespace::text,
      'prorettype',f.prorettype::text,'language',f.lanname,'bodySha256',encode(public.digest(convert_to(f.prosrc,'UTF8'),'sha256'),'hex'));
    IF observed IS DISTINCT FROM entry.value OR EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(f.proacl,pg_catalog.acldefault('f',f.proowner))) a
      WHERE a.grantee<>owner_id OR a.grantor<>owner_id) THEN RAISE EXCEPTION '原表外技术例程已漂移'; END IF;
  END LOOP;
  FOR entry IN SELECT * FROM jsonb_each(direct."bindings"->'triggers') LOOP
    SELECT to_jsonb(h)||jsonb_build_object('oid',h.oid::text,'tgrelid',h.tgrelid::text,'tgfoid',h.tgfoid::text,
      'tgattr',h.tgattr::text,'tgargs',encode(h.tgargs,'hex')) INTO STRICT observed
      FROM pg_catalog.pg_trigger h WHERE h.oid=(entry.value->>'oid')::oid AND h.tgname=entry.key;
    IF observed IS DISTINCT FROM entry.value THEN RAISE EXCEPTION '原表外触发器接线已漂移'; END IF;
  END LOOP;

  -- The new functions are invokers. Missing existing business permissions
  -- are an installation failure, never a reason to widen business grants.
  FOR entry IN SELECT * FROM (VALUES
    ('public."Project"', ARRAY['id','isActive']),
    ('public."Contract"', ARRAY['id','projectId','name','code','contractTypeKey','companyEntityId','ownerUserId','voidedAt']),
    ('public."ContractVersion"', ARRAY['id','contractId','versionNo','changeType','status','numericProtocolVersion','draftRevision',
      'signingSubjectType','supersedesVersionId','firstSubmittedAt','effectiveAt','endedAt','documentContentFingerprint','draftData',
      'originalSignedNumber','amountYuan','amountLimitType','pricingNature','amountSource','invoiceType','taxMode','defaultTaxRatePercent',
      'affiliateAssignmentId','affiliateBusinessPartyVersionId','affiliateNameSnapshot','affiliateCreditCodeSnapshot',
      'companyEntityIdSnapshot','companyEntityVersionId','companyEntityNameSnapshot','companyEntityCreditCodeSnapshot','companyEntityRegisteredAddressSnapshot']),
    ('public."ProjectAffiliateAssignment"', ARRAY['id','projectId','businessPartyId','businessPartyVersionId','affiliateNameSnapshot','affiliateCreditCodeSnapshot','effectiveFrom','endedAt']),
    ('public."BusinessParty"', ARRAY['id','status']),
    ('public."BusinessPartyVersion"', ARRAY['id','businessPartyId','snapshot']),
    ('public."ContractPartySnapshot"', ARRAY['id','contractVersionId','roleKey','displayOrder','businessPartyVersionId','snapshot']),
    ('public."CompanyEntity"', ARRAY['id','currentVersionNo','isActive','dataStatus']),
    ('public."CompanyEntityVersion"', ARRAY['id','companyEntityId','versionNo','name','unifiedSocialCreditCode','registeredAddress','isActive']),
    ('public."ProjectParticipatingCompany"', ARRAY['id','projectId','companyEntityId','companyEntityVersionId','effectiveFrom','endedAt']),
    ('public."PaymentTermsVersion"', ARRAY['id','contractId','contractVersionId','versionNo','originalText','status']),
    ('public."PaymentTermsStage"', ARRAY['paymentTermsVersionId']),
    ('public."ContractDraftAttachment"', ARRAY['contractVersionId','slotKey','fileId','displayOrder']),
    ('public."FileObject"', ARRAY['id','mimeType','sizeBytes','contentSha256','storageStatus','purgeReceiptId','supersedesFileObjectId']),
    ('public."ContractArchiveFile"', ARRAY['contractVersionId'])
  ) needed(rel,columns) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=pg_catalog.to_regclass(entry.rel)
        AND c.relnamespace=ns AND c.relowner=owner_id AND c.relkind='r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity)
      OR EXISTS(SELECT 1 FROM unnest(entry.columns) a(name)
        WHERE pg_catalog.has_column_privilege(app,pg_catalog.to_regclass(entry.rel),a.name,'SELECT') IS DISTINCT FROM TRUE) THEN
      RAISE EXCEPTION '应用角色缺少原有对上草稿读取资格';
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY['draftData','draftRevision','originalSignedNumber','signingSubjectType','companyEntityIdSnapshot',
      'companyEntityVersionId','companyEntityNameSnapshot','companyEntityCreditCodeSnapshot','companyEntityRegisteredAddressSnapshot',
      'affiliateAssignmentId','affiliateBusinessPartyVersionId','affiliateNameSnapshot','affiliateCreditCodeSnapshot','amountYuan',
      'amountCents','pricingNature','amountSource','invoiceType','taxMode','defaultTaxRatePercent','updatedAt']) a(name)
      WHERE pg_catalog.has_column_privilege(app,version_table,a.name,'UPDATE') IS DISTINCT FROM TRUE)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['public."Project"','public."CompanyEntity"','public."ProjectParticipatingCompany"']) a(rel)
      WHERE pg_catalog.has_any_column_privilege(app,pg_catalog.to_regclass(a.rel),'UPDATE') IS DISTINCT FROM TRUE) THEN
    RAISE EXCEPTION '应用角色缺少原有对上草稿写入或行锁资格';
  END IF;

  -- Verify both historical constraint semantics before replacing anything.
  SELECT pg_catalog.pg_get_expr(c.conbin,c.conrelid,false) INTO STRICT old_subject FROM pg_catalog.pg_constraint c
    WHERE c.conrelid=version_table AND c.contype='c' AND c.convalidated AND c.conname='ContractVersion_signing_subject_check';
  ALTER TABLE public."ContractVersion" ADD CONSTRAINT jg_upward_save_subject_preimage CHECK (
  (
    "signingSubjectType" = 'our_company'
    AND "affiliateAssignmentId" IS NULL
    AND "affiliateBusinessPartyVersionId" IS NULL
    AND "affiliateNameSnapshot" IS NULL
    AND "affiliateCreditCodeSnapshot" IS NULL
  ) OR (
    "signingSubjectType" = 'affiliate'
    AND "affiliateAssignmentId" IS NOT NULL
    AND "affiliateBusinessPartyVersionId" IS NOT NULL
    AND "affiliateNameSnapshot" IS NOT NULL
  ) OR (
    "signingSubjectType" = 'draft_unconfirmed'
    AND "numericProtocolVersion" = 2
    AND "status" IN ('draft', 'abandoned')
    AND "firstSubmittedAt" IS NULL
    AND "effectiveAt" IS NULL
    AND "affiliateAssignmentId" IS NULL
    AND "affiliateBusinessPartyVersionId" IS NULL
    AND "affiliateNameSnapshot" IS NULL
    AND "affiliateCreditCodeSnapshot" IS NULL
  )
  ) NOT VALID;
  SELECT pg_catalog.pg_get_expr(c.conbin,c.conrelid,false) INTO STRICT checked_subject FROM pg_catalog.pg_constraint c
    WHERE c.conrelid=version_table AND c.conname='jg_upward_save_subject_preimage';
  IF old_subject IS DISTINCT FROM checked_subject THEN RAISE EXCEPTION '原合同签约主体约束已漂移'; END IF;
  ALTER TABLE public."ContractVersion" DROP CONSTRAINT jg_upward_save_subject_preimage;
  ALTER TABLE public."ContractVersion" DROP CONSTRAINT "ContractVersion_signing_subject_check";
  EXECUTE format('ALTER TABLE public."ContractVersion" ADD CONSTRAINT "ContractVersion_signing_subject_check" CHECK ((%s) OR "signingSubjectType"=''upward'')',old_subject);
  ALTER TABLE public."ContractVersion" ADD CONSTRAINT "ContractVersion_upward_draft_source_check" CHECK (
    "signingSubjectType"<>'upward' OR (
      "numericProtocolVersion"=2 AND "versionNo"=1 AND "changeType"='original' AND "status"='draft'
      AND "effectiveAt" IS NULL AND "firstSubmittedAt" IS NULL AND "endedAt" IS NULL AND "supersedesVersionId" IS NULL
      AND "companyEntityIdSnapshot" IS NOT NULL AND "companyEntityVersionId" IS NOT NULL
      AND "companyEntityNameSnapshot" IS NOT NULL AND "companyEntityCreditCodeSnapshot" IS NOT NULL
      AND "affiliateAssignmentId" IS NOT NULL AND "affiliateBusinessPartyVersionId" IS NOT NULL AND "affiliateNameSnapshot" IS NOT NULL
      AND COALESCE("draftData"#>>'{directSigningInput,relationship}'='upward'
        AND "draftData"#>>'{directSigningInput,source}'='direct_signed'
        AND "draftData"#>'{directSigningInput,protocolVersion}'='2'::jsonb
        AND "draftData"#>>'{contractBasics,relationship}'='upward',FALSE)
    )
  );

  FOR entry IN SELECT * FROM (VALUES
    (next_version_oid, version_table, previous."versionTriggerOid", 'jg_direct_pending_version_shape', 23,
      '522410b9ebe38ea3e7e59861aa74dd39616cd3231615c40f02ab2d6ab1b36e93',
      'bbf5b477e867355798c5b99f4c7919baccfbfe7888811eaefccb9ab88a737e9f', next_version),
    (next_attachment_oid, file_table, previous."attachmentTriggerOid", 'jg_direct_pending_attachment_source', 23,
      '75824d061e5183bc3fb2fd3ec25804e2d471920d1f92b5bdd01ebc9a4cdd95d1',
      '0a0b17642f39c96064f1184fcd03e4151569136c385b2ea0d94ff67dbc5963cf', next_attachment),
    (next_slot_oid, file_table, (direct."bindings"#>>'{triggers,ContractDraftAttachment_direct_archive_transfer_v1,oid}')::oid,
      'ContractDraftAttachment_direct_archive_transfer_v1', 31,
      'cc7b0b876f7f396ed11d3b6f583af25c106b2ef967244648a93c730233efdf8b',
      '86dddd478fb66809deaae6875e46e2ed29436824497114d7c7a66e46403fe999', next_slot)
  ) bodies(fn,rel,hook,hook_name,kind,pre,post,body) LOOP
    SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT f FROM pg_catalog.pg_proc p
      WHERE p.oid=entry.fn AND p.pronamespace=ns AND p.proowner=owner_id AND NOT p.prosecdef
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=entry.pre;
    SELECT h.* INTO STRICT t FROM pg_catalog.pg_trigger h
      WHERE h.oid=entry.hook AND h.tgfoid=entry.fn AND h.tgrelid=entry.rel AND h.tgname=entry.hook_name
        AND h.tgtype=entry.kind AND h.tgenabled='O' AND NOT h.tgisinternal AND NOT h.tgdeferrable
        AND NOT h.tginitdeferred AND h.tgqual IS NULL AND h.tgnargs=0 AND h.tgattr::text='';
    IF encode(public.digest(convert_to(entry.body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM entry.post THEN
      RAISE EXCEPTION '对上保存接线源码不匹配';
    END IF;
    EXECUTE replace(pg_catalog.pg_get_functiondef(entry.fn),f.prosrc,entry.body);
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=entry.fn AND p.prosrc=entry.body
        AND to_jsonb(p)-'prosrc'=f.metadata)
      OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger h WHERE h.oid=t.oid AND to_jsonb(h)=to_jsonb(t)) THEN
      RAISE EXCEPTION '对上接线破坏原例程或触发器身份';
    END IF;
  END LOOP;

  CREATE TRIGGER jg_upward_pending_save_persistent_proof AFTER UPDATE ON public."ContractVersion"
    FOR EACH ROW EXECUTE FUNCTION public.jg_check_contract_upward_pending_save_v1();
  EXECUTE format('GRANT SELECT ON TABLE public.jg_contract_upward_pending_save_binding_v1 TO %I',app_name);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_guard_contract_upward_pending_save_v1(public."ContractVersion",public."ContractVersion") TO %I',app_name);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_contract_upward_pending_read_v1(text,text) TO %I',app_name);

  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE oid=app AND rolname=app_name)
    OR NOT pg_catalog.has_table_privilege(app,binding_table,'SELECT')
    OR NOT pg_catalog.has_function_privilege(app,save_oid,'EXECUTE')
    OR NOT pg_catalog.has_function_privilege(app,read_oid,'EXECUTE')
    OR (SELECT count(*) FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
      WHERE c.oid=binding_table AND a.grantee<>owner_id)<>1
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
      WHERE c.oid=binding_table AND (a.grantor<>owner_id OR a.grantee<>owner_id AND
        (a.grantee<>app OR a.privilege_type<>'SELECT' OR a.is_grantable)))
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
      WHERE p.oid IN (save_oid,read_oid) AND (a.grantor<>owner_id OR a.grantee<>owner_id AND
        (a.grantee<>app OR a.privilege_type<>'EXECUTE' OR a.is_grantable)))
    OR (SELECT count(*) FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
      WHERE p.oid IN (save_oid,read_oid) AND a.grantee=app)<>2
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(app,r.oid,'MEMBER')
      AND (pg_catalog.has_table_privilege(r.oid,binding_table,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=binding_table AND a.attnum>0 AND NOT a.attisdropped
          AND pg_catalog.has_column_privilege(r.oid,binding_table,a.attnum,'INSERT,UPDATE,REFERENCES')))) THEN
    RAISE EXCEPTION '对上保存技术授权不匹配';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(c.oid,false) INTO STRICT new_subject FROM pg_catalog.pg_constraint c
    WHERE c.conrelid=version_table AND c.convalidated AND c.conname='ContractVersion_signing_subject_check';
  SELECT pg_catalog.pg_get_constraintdef(c.oid,false) INTO STRICT new_upward FROM pg_catalog.pg_constraint c
    WHERE c.conrelid=version_table AND c.convalidated AND c.conname='ContractVersion_upward_draft_source_check';
  INSERT INTO public.jg_contract_upward_pending_save_binding_v1(
    "protocolVersion","applicationRoleOid","databaseOid","namespaceOid","ownerOid","createBindingSha256",
    "upwardConstraintSha256","subjectConstraintSha256","versionRoutineOid","attachmentRoutineOid","slotRoutineOid")
  VALUES(1,app,db,ns,owner_id,predecessor_sha,
    encode(public.digest(convert_to(new_upward,'UTF8'),'sha256'),'hex'),
    encode(public.digest(convert_to(new_subject,'UTF8'),'sha256'),'hex'),next_version_oid,next_attachment_oid,next_slot_oid);
END;
$install_upward_save$;

COMMIT;
