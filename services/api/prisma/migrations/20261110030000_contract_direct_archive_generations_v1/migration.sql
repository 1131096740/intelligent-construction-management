BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

-- The existing writer stays closed. The future executor records these rows in
-- the same transaction as the consumed 221 intent and the complete Evidence.
CREATE TABLE public.jg_contract_direct_archive_generation_v1 (
  "evidenceId" TEXT PRIMARY KEY REFERENCES public."ContractArchiveEvidenceFile"("id") ON DELETE RESTRICT,
  "intentId" UUID NOT NULL REFERENCES public.jg_contract_direct_archive_intent_use_v1("intentId") ON DELETE RESTRICT,
  "payloadSha256" TEXT NOT NULL CHECK ("payloadSha256" ~ '^[a-f0-9]{64}$'),
  "objectGeneration" TEXT NOT NULL CHECK (length("objectGeneration") BETWEEN 1 AND 1024
    AND "objectGeneration" COLLATE "C" ~ '^[!-~]+$' AND lower("objectGeneration")<>'null'
    AND position(',' IN "objectGeneration")=0)
);
REVOKE ALL ON TABLE public.jg_contract_direct_archive_generation_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_guard_contract_direct_archive_generation_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $append_guard$
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'jg_contract_direct_archive_generation_v1' OR TG_OP<>'INSERT' THEN
    RAISE EXCEPTION '直签归档原件存储版本只能在归档时固定' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.jg_contract_direct_archive_intent_use_v1 u
      JOIN public.jg_contract_direct_archive_intent_v1 i ON i."intentId"=u."intentId"
      WHERE u."intentId"=NEW."intentId" AND i."payloadSha256"=NEW."payloadSha256"
        AND u."databaseOid"=(SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database())
        AND u."runtimeSessionOid"=session_user::regrole::oid AND u."executorOwnerOid"=current_user::regrole::oid
        AND u."backendPid"=pg_catalog.pg_backend_pid() AND u."transactionId"=pg_catalog.txid_current()) THEN
    RAISE EXCEPTION '直签归档原件存储版本缺少同事务原请求' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$append_guard$;
CREATE TRIGGER jg_direct_archive_generation_append
BEFORE INSERT OR UPDATE OR DELETE ON public.jg_contract_direct_archive_generation_v1
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_contract_direct_archive_generation_v1();
CREATE TRIGGER jg_direct_archive_generation_no_truncate
BEFORE TRUNCATE ON public.jg_contract_direct_archive_generation_v1
FOR EACH STATEMENT EXECUTE FUNCTION public.jg_guard_contract_direct_archive_generation_v1();

CREATE FUNCTION public.jg_record_contract_direct_archive_generations_v1(
  p_archive TEXT,p_intent UUID,p_actor TEXT,p_project TEXT,p_contract TEXT,p_version TEXT,p_revision INTEGER,
  p_input_sha TEXT,p_key TEXT,p_evidence JSONB
) RETURNS VOID
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $record_generation$
DECLARE binding_sha TEXT; payload JSONB; payload_sha TEXT; affected INTEGER; archive_row RECORD;
BEGIN
  binding_sha:=public.jg_check_contract_direct_archive_intent_roles_v1(false);
  payload:=public.jg_contract_direct_archive_intent_payload_v1(p_actor,p_project,p_contract,p_version,p_revision,p_input_sha,p_key,p_evidence);
  payload_sha:=encode(public.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex');

  IF NOT EXISTS(SELECT 1 FROM public.jg_contract_direct_archive_intent_use_v1 u
      JOIN public.jg_contract_direct_archive_intent_v1 i ON i."intentId"=u."intentId"
      WHERE u."intentId"=p_intent AND i."bindingSha256"=binding_sha AND i."payloadSha256"=payload_sha
        AND u."databaseOid"=(SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database())
        AND u."runtimeSessionOid"=session_user::regrole::oid AND u."executorOwnerOid"=current_user::regrole::oid
        AND u."backendPid"=pg_catalog.pg_backend_pid() AND u."transactionId"=pg_catalog.txid_current()) THEN
    RAISE EXCEPTION '直签归档原件存储版本与已使用的原请求不一致' USING ERRCODE='23514';
  END IF;
  SELECT a."contractVersionId",a."uploadedByUserId",a."idempotencyKey",a."requestSha256",a."sourceRevision",a."authoritySnapshot"
  INTO archive_row FROM public."ContractArchiveFile" a WHERE a."id"=p_archive AND a."archiveProtocolVersion"=2
    AND a."archiveSource"='direct_signed' AND a."status"='confirmed';
  IF NOT FOUND OR archive_row."contractVersionId" IS DISTINCT FROM p_version
    OR archive_row."uploadedByUserId" IS DISTINCT FROM p_actor OR archive_row."idempotencyKey" IS DISTINCT FROM p_key
    OR archive_row."requestSha256" IS DISTINCT FROM payload->>'requestSha256' OR archive_row."sourceRevision" IS DISTINCT FROM p_revision
    OR archive_row."authoritySnapshot"->>'contractId' IS DISTINCT FROM p_contract
    OR archive_row."authoritySnapshot"->>'projectId' IS DISTINCT FROM p_project
    OR archive_row."authoritySnapshot"#>>'{sourceBasis,directInput,inputSha256}' IS DISTINCT FROM p_input_sha
    OR (SELECT count(*) FROM public."ContractArchiveEvidenceFile" e WHERE e."archiveFileId"=p_archive)<>jsonb_array_length(p_evidence) THEN
    RAISE EXCEPTION '直签归档原件存储版本与归档父记录不一致' USING ERRCODE='23514';
  END IF;

  INSERT INTO public.jg_contract_direct_archive_generation_v1("evidenceId","intentId","payloadSha256","objectGeneration")
  SELECT e."id",p_intent,payload_sha,item->>'objectGeneration'
  FROM jsonb_array_elements(p_evidence) WITH ORDINALITY AS original(item,position)
  JOIN public."ContractArchiveEvidenceFile" e ON e."archiveFileId"=p_archive AND e."contractVersionId"=p_version
    AND e."displayOrder"=position-1 AND e."fileId"=item->>'fileId' AND e."mimeType"=item->>'mimeType'
    AND to_jsonb(e."sizeBytes")=item->'sizeBytes' AND e."contentSha256"=item->>'contentSha256'
  JOIN public."FileObject" f ON f."id"=e."fileId" AND f."bucket"=item->>'bucket' AND f."objectKey"=item->>'objectKey'
    AND f."mimeType"=e."mimeType" AND f."sizeBytes"=e."sizeBytes" AND f."contentSha256"=e."contentSha256"
    AND f."storageStatus"='active' AND f."purgeReceiptId" IS NULL AND f."supersedesFileObjectId" IS NULL;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>jsonb_array_length(p_evidence) OR binding_sha IS DISTINCT FROM public.jg_check_contract_direct_archive_intent_roles_v1(false) THEN
    RAISE EXCEPTION '直签归档原件存储版本没有完整固定' USING ERRCODE='23514';
  END IF;
END;
$record_generation$;

-- Read authority reconstructs the same exact 221 payload using the persisted
-- evidence and generations. It does not require access to the intent tables.
CREATE FUNCTION public.jg_read_contract_direct_archive_generations_v1(p_archive TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE STRICT SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $read_generation$
DECLARE prior JSONB; originals JSONB; payload JSONB; payload_sha TEXT; archive_key TEXT;
  evidence_count INTEGER; covered_count INTEGER; intent_count INTEGER; digest_count INTEGER;
BEGIN
  prior:=public.jg_contract_direct_archive_proof_v1(p_archive);
  IF prior IS NULL THEN RETURN NULL; END IF;
  archive_key:=prior->>'idempotencyKey';
  SELECT count(*)::integer,count(g."evidenceId")::integer,count(DISTINCT g."intentId")::integer,
    count(DISTINCT g."payloadSha256")::integer,min(g."payloadSha256"),
    jsonb_agg(jsonb_build_object('fileId',e."fileId",'displayOrder',e."displayOrder",
      'mimeType',e."mimeType",'sizeBytes',e."sizeBytes",'contentSha256',e."contentSha256",
      'bucket',f."bucket",'objectKey',f."objectKey",'objectGeneration',g."objectGeneration") ORDER BY e."displayOrder")
  INTO evidence_count,covered_count,intent_count,digest_count,payload_sha,originals
  FROM public."ContractArchiveEvidenceFile" e
  LEFT JOIN public.jg_contract_direct_archive_generation_v1 g ON g."evidenceId"=e."id"
  LEFT JOIN public."FileObject" f ON f."id"=e."fileId"
  WHERE e."archiveFileId"=p_archive AND e."contractVersionId"=prior->>'contractVersionId';
  IF evidence_count NOT BETWEEN 1 AND 20 OR covered_count<>evidence_count OR intent_count<>1 OR digest_count<>1
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(originals) WITH ORDINALITY AS original(item,position)
      WHERE item->>'displayOrder' IS DISTINCT FROM (position-1)::text OR item->>'bucket' IS NULL OR item->>'objectKey' IS NULL
        OR item->>'fileId' IS DISTINCT FROM (prior->'fileIds'->>((position-1)::integer))) THEN RETURN NULL; END IF;

  payload:=jsonb_build_object('protocolVersion',1,'archiveSource','direct_signed','relationship','outside','actor',prior->>'handlerUserId',
    'projectId',prior->>'projectId','contractId',prior->>'contractId','contractVersionId',prior->>'contractVersionId',
    'sourceRevision',prior->'sourceRevision','inputSha256',prior->>'inputSha256','requestKey',archive_key,
    'requestSha256',prior->>'requestSha256','orderedEvidence',originals);
  IF payload_sha IS DISTINCT FROM encode(public.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex') THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('protocolVersion',1,'archiveId',p_archive,'contractVersionId',prior->>'contractVersionId',
    'authoritySha256',prior->>'authoritySha256','originals',originals);
END;
$read_generation$;

CREATE FUNCTION public.jg_require_contract_direct_archive_generations_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $complete_generation$
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'ContractArchiveFile' OR TG_OP<>'INSERT' THEN
    RAISE EXCEPTION '直签归档原件存储版本守卫接线不正确' USING ERRCODE='23514';
  END IF;
  IF NEW."archiveProtocolVersion" IS DISTINCT FROM 2 OR NEW."archiveSource" IS DISTINCT FROM 'direct_signed' THEN
    RETURN NULL;
  END IF;
  IF public.jg_read_contract_direct_archive_generations_v1(NEW."id") IS NULL THEN
    RAISE EXCEPTION '直签归档原件的完整存储版本须同事务固定' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$complete_generation$;
CREATE CONSTRAINT TRIGGER "ContractArchiveFile_direct_generations_v1"
AFTER INSERT ON public."ContractArchiveFile" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.jg_require_contract_direct_archive_generations_v1();

REVOKE ALL ON FUNCTION public.jg_guard_contract_direct_archive_generation_v1(),
  public.jg_record_contract_direct_archive_generations_v1(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,JSONB),
  public.jg_read_contract_direct_archive_generations_v1(TEXT), public.jg_require_contract_direct_archive_generations_v1() FROM PUBLIC;

DO $generation_source$
DECLARE anchor RECORD; app_name TEXT; relation_oid OID:='public.jg_contract_direct_archive_generation_v1'::regclass;
BEGIN
  SELECT * INTO STRICT anchor FROM public.jg_contract_direct_archive_completion_binding_v1
    WHERE "protocolVersion"=1 AND "recipeVersion"='contract-direct-archive-completion-dispatch-v1/1';
  IF current_user IS DISTINCT FROM session_user OR current_user::regrole::oid IS DISTINCT FROM anchor."anchorOwnerOid"
    OR anchor."databaseOid" IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database())
    OR anchor."namespaceOid" IS DISTINCT FROM 'public'::regnamespace::oid
    OR pg_catalog.pg_has_role(anchor."applicationRoleOid",anchor."anchorOwnerOid",'MEMBER')
    OR pg_catalog.has_schema_privilege(anchor."applicationRoleOid",anchor."namespaceOid",'CREATE') THEN
    RAISE EXCEPTION '直签归档原件存储版本缺少可信安装身份';
  END IF;
  SELECT rolname INTO STRICT app_name FROM pg_catalog.pg_roles r WHERE r.oid=anchor."applicationRoleOid"
    AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolreplication);
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL
      pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) acl
    WHERE c.oid=relation_oid AND (acl.grantee<>c.relowner OR acl.grantor<>c.relowner))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL
      pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
      WHERE p.pronamespace=anchor."namespaceOid" AND p.proname IN ('jg_guard_contract_direct_archive_generation_v1',
        'jg_record_contract_direct_archive_generations_v1','jg_read_contract_direct_archive_generations_v1',
        'jg_require_contract_direct_archive_generations_v1')
        AND (acl.grantee<>p.proowner OR acl.grantor<>p.proowner)) THEN
    RAISE EXCEPTION '直签归档原件存储版本发现未经核对的默认授权';
  END IF;
  -- Only the existing bound app receives technical SELECT and read-only EXECUTE.
  EXECUTE format('GRANT SELECT ON TABLE public.jg_contract_direct_archive_generation_v1 TO %I',app_name);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_read_contract_direct_archive_generations_v1(TEXT) TO %I',app_name);
END;
$generation_source$;
COMMIT;
