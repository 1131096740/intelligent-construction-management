-- Durable completion for generated outside/upward archives without an enabled operating ledger.
-- This installer adds a final-state requirement. Existing activation and original-insert restrictions still apply.
BEGIN;
SET LOCAL search_path TO pg_catalog, public;

CREATE TABLE public.jg_contract_generated_archive_completion_v1 (
  "archiveId" TEXT PRIMARY KEY REFERENCES public."ContractArchiveFile"("id") ON DELETE RESTRICT,
  "completion" JSONB NOT NULL CHECK (jsonb_typeof("completion")='object')
);
REVOKE ALL ON TABLE public.jg_contract_generated_archive_completion_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_capture_generated_archive_completion_v1(archive_id TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $capture$
DECLARE
  archive_row RECORD;
  version_row RECORD;
  contract_row RECORD;
  project_row RECORD;
  round_row RECORD;
  task_row RECORD;
  relationship TEXT;
  archived_at TEXT;
  expected_scope JSONB;
  files JSONB;
  evidence_ids JSONB;
  originals JSONB;
  manifest JSONB;
  request_files TEXT;
  request_sha TEXT;
  covered BIGINT;
  first_order INT;
  last_order INT;
  audit_rows BIGINT;
  matching_audit_rows BIGINT;
  row_xid TEXT:=mod(pg_catalog.txid_current(),4294967296::bigint)::text;
BEGIN
  SELECT a.*,a.xmin::text AS archive_xid INTO archive_row FROM public."ContractArchiveFile" a WHERE a."id"=archive_id;
  IF NOT FOUND OR archive_row.archive_xid<>row_xid OR archive_row."archiveProtocolVersion" IS DISTINCT FROM 2
    OR archive_row."archiveSource" IS DISTINCT FROM 'generated_approval' OR archive_row."status" IS DISTINCT FROM 'confirmed'
    OR archive_row."confirmedAt" IS NULL OR archive_row."fileId" IS NOT NULL
    OR archive_row."confirmedByUserId" IS DISTINCT FROM archive_row."uploadedByUserId"
    OR archive_row."idempotencyKey" IS NULL OR archive_row."requestSha256" IS NULL
    OR archive_row."authoritySha256" IS NULL OR archive_row."fileManifestSha256" IS NULL THEN
    RAISE EXCEPTION '生成合同归档完成记录缺少同事务原归档' USING ERRCODE='23514';
  END IF;

  SELECT v.*,v.xmin::text AS version_xid INTO version_row FROM public."ContractVersion" v WHERE v."id"=archive_row."contractVersionId";
  IF NOT FOUND OR version_row.version_xid<>row_xid OR version_row."status" IS DISTINCT FROM 'effective'
    OR version_row."effectiveAt" IS DISTINCT FROM archive_row."confirmedAt"
    OR version_row."taxFactsFrozenAt" IS DISTINCT FROM archive_row."confirmedAt"
    OR version_row."numericProtocolVersion" IS DISTINCT FROM 2 OR version_row."changeType" IS DISTINCT FROM 'original'
    OR version_row."supersedesVersionId" IS NOT NULL OR version_row."firstSubmittedAt" IS NULL
    OR version_row."draftRevision" IS DISTINCT FROM archive_row."sourceRevision"
    OR version_row."documentContentRevision" IS DISTINCT FROM archive_row."documentContentRevision"
    OR version_row."documentContentFingerprint" IS DISTINCT FROM archive_row."documentContentFingerprint" THEN
    RAISE EXCEPTION '生成合同归档完成记录缺少同事务生效版本' USING ERRCODE='23514';
  END IF;
  relationship:=CASE version_row."signingSubjectType" WHEN 'affiliate' THEN 'outside' WHEN 'upward' THEN 'upward' END;
  archived_at:=to_char(archive_row."confirmedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  SELECT c."id",c."projectId",c."ownerUserId",c."voidedAt" INTO contract_row
    FROM public."Contract" c WHERE c."id"=version_row."contractId" FOR SHARE;
  SELECT r."id",r."businessType",r."businessId",r."flowType",r."status",r."applicantUserId",r."frozenNodes" INTO round_row
    FROM public."ApprovalInstance" r WHERE r."id"=archive_row."approvalInstanceId" FOR SHARE;
  SELECT t."id",t."contractVersionId",t."approvalInstanceId",t."handlerUserId",t."status",t."completedByUserId",t."completedAt" INTO task_row
    FROM public."ContractSealTask" t WHERE t."id"=archive_row."sealTaskId" FOR SHARE;
  SELECT p."id",p."isActive",p."operatingLedgerEffectiveDate" INTO project_row
    FROM public."Project" p WHERE p."id"=contract_row."projectId" FOR SHARE;
  IF relationship IS NULL OR contract_row."id" IS NULL OR contract_row."voidedAt" IS NOT NULL
    OR contract_row."ownerUserId" IS DISTINCT FROM archive_row."uploadedByUserId"
    OR round_row."id" IS NULL OR round_row."businessType" IS DISTINCT FROM 'contract_version'
    OR round_row."businessId" IS DISTINCT FROM version_row."id" OR round_row."flowType" IS DISTINCT FROM 'contract.approve'
    OR round_row."status" IS DISTINCT FROM 'approved' OR round_row."applicantUserId" IS DISTINCT FROM archive_row."uploadedByUserId"
    OR jsonb_typeof(round_row."frozenNodes") IS DISTINCT FROM 'array'
    OR round_row."frozenNodes"->0->'submissionSnapshot' IS DISTINCT FROM version_row."readinessSnapshot"
    OR EXISTS (SELECT 1 FROM public."ApprovalInstance" other
      WHERE other."businessType"='contract_version' AND other."flowType"='contract.approve'
        AND other."businessId"=version_row."id" AND other."id"<>round_row."id" AND other."status" IN ('in_progress','approved'))
    OR task_row."id" IS NULL OR task_row."contractVersionId" IS DISTINCT FROM version_row."id"
    OR task_row."approvalInstanceId" IS DISTINCT FROM round_row."id" OR task_row."handlerUserId" IS DISTINCT FROM archive_row."uploadedByUserId"
    OR task_row."status" IS DISTINCT FROM 'completed' OR task_row."completedByUserId" IS NULL
    OR task_row."completedAt" IS NULL OR task_row."completedAt">archive_row."confirmedAt"
    OR version_row."readinessSnapshot"#>>'{signingIdentity,relationship}' IS DISTINCT FROM relationship
    OR archive_row."authoritySnapshot"#>'{sourceBasis,subjects,signingIdentity}' IS DISTINCT FROM version_row."readinessSnapshot"->'signingIdentity'
    OR archive_row."authoritySnapshot"->>'projectId' IS DISTINCT FROM contract_row."projectId"
    OR archive_row."authoritySnapshot"->>'contractId' IS DISTINCT FROM contract_row."id"
    OR archive_row."authoritySnapshot"->>'contractVersionId' IS DISTINCT FROM version_row."id"
    OR archive_row."authoritySnapshot"->>'approvalInstanceId' IS DISTINCT FROM round_row."id"
    OR archive_row."authoritySnapshot"->>'sealTaskId' IS DISTINCT FROM task_row."id"
    OR archive_row."authoritySnapshot"->>'archivedAt' IS DISTINCT FROM archived_at
    OR archive_row."authoritySnapshot"->>'requestSha256' IS DISTINCT FROM archive_row."requestSha256"
    OR archive_row."authoritySha256" IS DISTINCT FROM encode(public.digest(convert_to(archive_row."authoritySnapshot"::text,'UTF8'),'sha256'),'hex') THEN
    RAISE EXCEPTION '生成合同归档完成记录与原经办及审批轮次不一致' USING ERRCODE='23514';
  END IF;
  IF project_row."id" IS NULL OR project_row."isActive" IS DISTINCT FROM true OR project_row."operatingLedgerEffectiveDate" IS NOT NULL
    OR archive_row."authoritySnapshot"->'operatingConsequence' IS DISTINCT FROM
      '{"protocolVersion":1,"mode":"not_applicable","operatingLedgerEffectiveDateSnapshot":null,"expectedSource":null}'::jsonb
    OR EXISTS(SELECT 1 FROM public."OperatingFact" f WHERE f."projectId"=project_row."id"
      AND f."sourceType"='contract_version' AND f."sourceBusinessId"=version_row."id")
    OR EXISTS(SELECT 1 FROM public."OperatingImpactEntry" i WHERE i."projectId"=project_row."id"
      AND i."sourceType"='contract_version' AND i."sourceBusinessId"=version_row."id") THEN
    RAISE EXCEPTION '生成合同归档完成记录只适用于未启用经营台账的项目' USING ERRCODE='23514';
  END IF;

  expected_scope:=jsonb_build_object('protocolVersion',1,'archiveSource','generated_approval','relationship',relationship,
    'projectId',project_row."id",'contractId',contract_row."id",'contractVersionId',version_row."id",
    'approvalInstanceId',round_row."id",'sealTaskId',task_row."id",'uploaderUserId',archive_row."uploadedByUserId",
    'sealConfirmerUserId',task_row."completedByUserId",'idempotencyKey',archive_row."idempotencyKey",
    'requestSha256',archive_row."requestSha256",'authoritySha256',archive_row."authoritySha256",
    'fileManifestSha256',archive_row."fileManifestSha256",'documentContentRevision',archive_row."documentContentRevision",
    'documentContentFingerprint',archive_row."documentContentFingerprint");
  PERFORM f."id" FROM public."FileObject" f
    JOIN public."ContractArchiveEvidenceFile" e ON e."fileId"=f."id" AND e."archiveFileId"=archive_id
    ORDER BY f."id" COLLATE "C" FOR SHARE OF f;
  SELECT count(*),min(e."displayOrder"),max(e."displayOrder"),
    jsonb_agg(e."fileId" ORDER BY e."displayOrder"),jsonb_agg(e."id" ORDER BY e."displayOrder"),
    jsonb_agg(parts.manifest_row ORDER BY e."displayOrder"),
    jsonb_agg(parts.manifest_row || jsonb_build_object('bucket',p."bucket",'objectKey',p."objectKey",
      'objectGeneration',p."objectGeneration") ORDER BY e."displayOrder"),
    string_agg(to_json(e."fileId")::text,',' ORDER BY e."displayOrder")
    INTO covered,first_order,last_order,files,evidence_ids,manifest,originals,request_files
    FROM public."ContractArchiveEvidenceFile" e
    JOIN public.jg_contract_generated_archive_original_v1 p ON p."evidenceId"=e."id" AND p."archiveId"=e."archiveFileId"
      AND p."scope"=expected_scope AND p.xmin::text=row_xid
    JOIN public."FileObject" f ON f."id"=e."fileId" AND f."bucket"=p."bucket" AND f."objectKey"=p."objectKey"
      AND f."mimeType"=e."mimeType" AND f."sizeBytes"=e."sizeBytes" AND f."contentSha256"=e."contentSha256"
      AND f."uploadedByUserId"=archive_row."uploadedByUserId" AND f."storageStatus"='active'
      AND f."purgeReceiptId" IS NULL AND f."supersedesFileObjectId" IS NULL
    CROSS JOIN LATERAL (SELECT jsonb_build_object('fileId',e."fileId",'displayOrder',e."displayOrder",
      'mimeType',e."mimeType",'sizeBytes',e."sizeBytes",'contentSha256',e."contentSha256") AS manifest_row) parts
    WHERE e."archiveFileId"=archive_id AND e."contractVersionId"=version_row."id"
      AND e.xmin::text=row_xid AND e."mimeType"='application/pdf';
  IF covered NOT BETWEEN 1 AND 20 OR first_order<>0 OR last_order<>covered-1
    OR covered<>(SELECT count(*) FROM public."ContractArchiveEvidenceFile" e WHERE e."archiveFileId"=archive_id)
    OR manifest IS DISTINCT FROM archive_row."authoritySnapshot"->'fileManifest'
    OR manifest IS DISTINCT FROM archive_row."authoritySnapshot"#>'{sourceBasis,fileManifest}'
    OR archive_row."fileManifestSha256" IS DISTINCT FROM encode(public.digest(convert_to(manifest::text,'UTF8'),'sha256'),'hex')
    OR archive_row."responseSnapshot" IS DISTINCT FROM jsonb_build_object('archiveId',archive_id,
      'contractVersionId',version_row."id",'status','effective','fileIds',files) THEN
    RAISE EXCEPTION '生成合同归档完成记录缺少完整有序的同事务原件及回执' USING ERRCODE='23514';
  END IF;

  -- Keep the field order and compact serialization of the archive POST's archiveRequestSha.
  request_sha:=encode(public.digest(convert_to(format(
    '{"versionId":%s,"actor":%s,"archiveProtocolVersion":2,"archiveSource":"generated_approval","idempotencyKey":%s,"expectedApprovalInstanceId":%s,"expectedSealTaskId":%s,"documentContentRevision":%s,"documentContentFingerprint":%s,"fileIds":[%s],"confirmedMatchingSignedDocument":true}',
    to_json(version_row."id"),to_json(archive_row."uploadedByUserId"),to_json(archive_row."idempotencyKey"),
    to_json(round_row."id"),to_json(task_row."id"),archive_row."documentContentRevision",
    to_json(archive_row."documentContentFingerprint"),request_files),'UTF8'),'sha256'),'hex');
  IF request_sha IS DISTINCT FROM archive_row."requestSha256" THEN
    RAISE EXCEPTION '生成合同归档完成记录与原请求摘要不一致' USING ERRCODE='23514';
  END IF;

  SELECT count(*),count(*) FILTER (WHERE log.xmin::text=row_xid AND log."actorUserId"=archive_row."uploadedByUserId"
    AND log."metadata"->>'actingRoleKey' IN ('contract_director','contract_staff')
    AND log."metadata" - 'actingRoleKey'=jsonb_build_object('archiveId',archive_id,'approvalInstanceId',round_row."id",
      'sealTaskId',task_row."id",'fileIds',files,'authoritySha256',archive_row."authoritySha256"))
    INTO audit_rows,matching_audit_rows FROM public."AuditLog" log
    WHERE log."businessType"='contract_version' AND log."businessId"=version_row."id" AND log."action"='contract.archive.complete';
  IF audit_rows<>1 OR matching_audit_rows<>1 THEN
    RAISE EXCEPTION '生成合同归档完成记录缺少唯一同事务审计' USING ERRCODE='23514';
  END IF;
  RETURN jsonb_build_object('protocolVersion',1,'policy','operating_ledger_not_enabled','archiveId',archive_id,
    'projectId',project_row."id",'contractId',contract_row."id",'contractVersionId',version_row."id",
    'approvalInstanceId',round_row."id",'sealTaskId',task_row."id",'uploaderUserId',archive_row."uploadedByUserId",
    'idempotencyKey',archive_row."idempotencyKey",'requestSha256',request_sha,
    'authoritySha256',archive_row."authoritySha256",'fileManifestSha256',archive_row."fileManifestSha256",
    'archivedAt',archived_at,'evidenceIds',evidence_ids,'originals',originals);
END;
$capture$;
REVOKE ALL ON FUNCTION public.jg_capture_generated_archive_completion_v1(TEXT) FROM PUBLIC;

CREATE FUNCTION public.jg_guard_generated_archive_completion_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $marker$
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'jg_contract_generated_archive_completion_v1' OR TG_OP<>'INSERT' THEN
    RAISE EXCEPTION '生成合同归档完成记录不可更改' USING ERRCODE='23514';
  END IF;
  IF current_user IS DISTINCT FROM session_user OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=TG_RELID AND c.relowner=current_user::regrole::oid
  ) THEN
    RAISE EXCEPTION '生成合同归档完成记录仅接受受控同事务写入' USING ERRCODE='55000';
  END IF;
  IF TG_WHEN='BEFORE' THEN
    IF NEW."completion" IS NOT NULL THEN
      RAISE EXCEPTION '生成合同归档完成内容必须由数据库构建' USING ERRCODE='23514';
    END IF;
    NEW."completion":=public.jg_capture_generated_archive_completion_v1(NEW."archiveId");
  ELSIF NEW."completion" IS DISTINCT FROM public.jg_capture_generated_archive_completion_v1(NEW."archiveId") THEN
    RAISE EXCEPTION '生成合同归档完成记录与提交事实不一致' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$marker$;
REVOKE ALL ON FUNCTION public.jg_guard_generated_archive_completion_v1() FROM PUBLIC;
CREATE TRIGGER jg_generated_archive_completion_append BEFORE INSERT OR UPDATE OR DELETE
ON public.jg_contract_generated_archive_completion_v1 FOR EACH ROW EXECUTE FUNCTION public.jg_guard_generated_archive_completion_v1();
CREATE TRIGGER jg_generated_archive_completion_no_truncate BEFORE TRUNCATE
ON public.jg_contract_generated_archive_completion_v1 FOR EACH STATEMENT EXECUTE FUNCTION public.jg_guard_generated_archive_completion_v1();
CREATE CONSTRAINT TRIGGER jg_generated_archive_completion_verify
AFTER INSERT ON public.jg_contract_generated_archive_completion_v1 DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_generated_archive_completion_v1();

CREATE FUNCTION public.jg_require_generated_archive_completion_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $required$
DECLARE
  subject TEXT;
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'ContractArchiveFile' OR TG_OP<>'INSERT' THEN
    RAISE EXCEPTION '生成合同归档完成记录守卫作用域不匹配' USING ERRCODE='55000';
  END IF;
  IF NEW."archiveProtocolVersion" IS DISTINCT FROM 2 OR NEW."archiveSource" IS DISTINCT FROM 'generated_approval' THEN
    RETURN NEW;
  END IF;
  SELECT v."signingSubjectType" INTO subject FROM public."ContractVersion" v WHERE v."id"=NEW."contractVersionId";
  IF COALESCE(subject,'') NOT IN ('affiliate','upward')
    AND COALESCE(NEW."authoritySnapshot"#>>'{sourceBasis,subjects,signingIdentity,relationship}','') NOT IN ('outside','upward') THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.jg_contract_generated_archive_completion_v1 m
    WHERE m."archiveId"=NEW."id" AND m.xmin::text=mod(pg_catalog.txid_current(),4294967296::bigint)::text) THEN
    RAISE EXCEPTION '生成合同归档缺少同事务完成记录' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$required$;
REVOKE ALL ON FUNCTION public.jg_require_generated_archive_completion_v1() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER jg_generated_archive_completion_required
AFTER INSERT ON public."ContractArchiveFile" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.jg_require_generated_archive_completion_v1();

DO $install$
DECLARE
  anchor RECORD;
  owner_id OID:=current_user::regrole::oid;
  app_name NAME;
  completion_table OID:='public.jg_contract_generated_archive_completion_v1'::regclass;
  originals_table OID:='public.jg_contract_generated_archive_original_v1'::regclass;
  binding_table OID:='public.jg_contract_generated_upward_seal_binding_v1'::regclass;
BEGIN
  SELECT b.* INTO STRICT anchor FROM public.jg_contract_generated_upward_seal_binding_v1 b
    JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database()
    WHERE b."protocolVersion"=1 AND b."namespaceOid"=pg_catalog.to_regnamespace('public');
  SELECT rolname INTO STRICT app_name FROM pg_catalog.pg_roles WHERE oid=anchor."applicationRoleOid";
  IF current_user IS DISTINCT FROM session_user OR owner_id IS DISTINCT FROM anchor."ownerOid"
    OR owner_id=anchor."applicationRoleOid"
    OR (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.oid IN (completion_table,originals_table,binding_table)
      AND c.relowner=owner_id AND c.relnamespace=anchor."namespaceOid" AND c.relkind='r'
      AND c.relpersistence='p' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity)<>3
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(anchor."applicationRoleOid",r.oid,'MEMBER')
      AND (r.rolsuper OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication
        OR pg_catalog.pg_has_role(r.oid,owner_id,'MEMBER') OR pg_catalog.has_schema_privilege(r.oid,anchor."namespaceOid",'CREATE'))) THEN
    RAISE EXCEPTION '生成合同归档完成记录安装角色不匹配' USING ERRCODE='55000';
  END IF;
  EXECUTE format('GRANT SELECT ON TABLE public.jg_contract_generated_archive_completion_v1 TO %I',app_name);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
    WHERE c.oid=completion_table AND a.grantee=anchor."applicationRoleOid" AND a.grantor=owner_id
      AND a.privilege_type='SELECT' AND NOT a.is_grantable)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
      WHERE c.oid=completion_table AND (a.grantor<>owner_id OR a.grantee<>owner_id
        AND (a.grantee<>anchor."applicationRoleOid" OR a.privilege_type<>'SELECT' OR a.is_grantable)))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=completion_table
      AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      WHERE p.oid IN ('public.jg_capture_generated_archive_completion_v1(text)'::regprocedure,
        'public.jg_guard_generated_archive_completion_v1()'::regprocedure,
        'public.jg_require_generated_archive_completion_v1()'::regprocedure)
        AND (p.proowner<>owner_id OR a.grantee<>owner_id OR a.grantor<>owner_id)) THEN
    RAISE EXCEPTION '生成合同归档完成记录权限超出限定范围' USING ERRCODE='55000';
  END IF;
END;
$install$;

COMMIT;
