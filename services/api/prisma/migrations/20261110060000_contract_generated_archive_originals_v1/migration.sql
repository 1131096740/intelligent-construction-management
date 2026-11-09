-- Immutable fixed-version evidence for generated outside/upward archives.
-- The existing effective/operating guards remain closed for these relationships.
BEGIN;
SET LOCAL search_path TO pg_catalog, public;

CREATE TABLE public.jg_contract_generated_archive_original_v1 (
  "evidenceId" TEXT PRIMARY KEY REFERENCES public."ContractArchiveEvidenceFile"("id") ON DELETE RESTRICT,
  "archiveId" TEXT NOT NULL REFERENCES public."ContractArchiveFile"("id") ON DELETE RESTRICT,
  "bucket" TEXT NOT NULL CHECK (btrim("bucket")<>''),
  "objectKey" TEXT NOT NULL CHECK (btrim("objectKey")<>''),
  "objectGeneration" TEXT NOT NULL CHECK (length("objectGeneration") BETWEEN 1 AND 1024
    AND "objectGeneration" COLLATE "C" ~ '^[!-~]+$' AND lower("objectGeneration")<>'null'
    AND position(',' IN "objectGeneration")=0),
  "scope" JSONB NOT NULL CHECK (jsonb_typeof("scope")='object'),
  UNIQUE ("archiveId","bucket","objectKey")
);
REVOKE ALL ON TABLE public.jg_contract_generated_archive_original_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_guard_generated_archive_original_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $original$
DECLARE
  parent RECORD;
  evidence RECORD;
  file_row RECORD;
  version_row RECORD;
  owner_row RECORD;
  round_row RECORD;
  seal_row RECORD;
  relationship TEXT;
  pin JSONB;
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'jg_contract_generated_archive_original_v1' OR TG_OP<>'INSERT' THEN
    RAISE EXCEPTION '生成合同归档原件版本不可更改' USING ERRCODE='23514';
  END IF;
  -- Future runtime insertion requires a separately qualified writer. No application write is granted here.
  IF current_user IS DISTINCT FROM session_user OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=TG_RELID AND c.relowner=current_user::regrole::oid
  ) OR NEW."scope" IS NOT NULL THEN
    RAISE EXCEPTION '生成合同归档原件仅接受受控同事务写入' USING ERRCODE='55000';
  END IF;

  SELECT a.*,a.xmin::text AS row_xid INTO parent FROM public."ContractArchiveFile" a WHERE a."id"=NEW."archiveId";
  IF NOT FOUND OR parent."archiveSource" IS DISTINCT FROM 'generated_approval' OR parent."archiveProtocolVersion"<>2
    OR parent."status"<>'confirmed' OR parent."confirmedAt" IS NULL OR parent."idempotencyKey" IS NULL
    OR parent."requestSha256" IS NULL OR parent."authoritySha256" IS NULL OR parent."fileManifestSha256" IS NULL
    OR parent.row_xid<>mod(pg_catalog.txid_current(),4294967296::bigint)::text THEN
    RAISE EXCEPTION '原件版本缺少同事务原归档请求' USING ERRCODE='23514';
  END IF;

  SELECT v."id",v."contractId",v."signingSubjectType",v."status",v."documentContentRevision",v."documentContentFingerprint",v."readinessSnapshot"
    INTO version_row FROM public."ContractVersion" v WHERE v."id"=parent."contractVersionId";
  relationship:=CASE version_row."signingSubjectType" WHEN 'affiliate' THEN 'outside' WHEN 'upward' THEN 'upward' END;
  SELECT c."id",c."projectId",c."ownerUserId",c."voidedAt" INTO owner_row
    FROM public."Contract" c WHERE c."id"=version_row."contractId";
  SELECT r."id",r."businessId",r."businessType",r."flowType",r."status",r."applicantUserId",r."frozenNodes"
    INTO round_row FROM public."ApprovalInstance" r WHERE r."id"=parent."approvalInstanceId";
  SELECT t."id",t."contractVersionId",t."approvalInstanceId",t."handlerUserId",t."status",t."completedByUserId",t."completedAt"
    INTO seal_row FROM public."ContractSealTask" t WHERE t."id"=parent."sealTaskId";
  IF relationship IS NULL OR version_row."status" NOT IN ('seal_approved_pending_archive','effective')
    OR owner_row."id" IS NULL OR owner_row."voidedAt" IS NOT NULL OR owner_row."ownerUserId" IS DISTINCT FROM parent."uploadedByUserId"
    OR version_row."documentContentRevision" IS DISTINCT FROM parent."documentContentRevision"
    OR version_row."documentContentFingerprint" IS DISTINCT FROM parent."documentContentFingerprint"
    OR parent."authoritySnapshot"->>'projectId' IS DISTINCT FROM owner_row."projectId"
    OR parent."authoritySnapshot"->>'contractId' IS DISTINCT FROM owner_row."id"
    OR parent."authoritySnapshot"->>'contractVersionId' IS DISTINCT FROM version_row."id"
    OR parent."authoritySnapshot"->>'requestSha256' IS DISTINCT FROM parent."requestSha256"
    OR parent."authoritySnapshot"->>'fileManifestSha256' IS DISTINCT FROM parent."fileManifestSha256"
    OR version_row."readinessSnapshot"#>>'{signingIdentity,relationship}' IS DISTINCT FROM relationship
    OR parent."authoritySnapshot"#>'{sourceBasis,subjects,signingIdentity}' IS DISTINCT FROM version_row."readinessSnapshot"->'signingIdentity'
    OR round_row."id" IS NULL OR round_row."businessType" IS DISTINCT FROM 'contract_version'
    OR round_row."flowType" IS DISTINCT FROM 'contract.approve' OR round_row."status" IS DISTINCT FROM 'approved'
    OR round_row."businessId" IS DISTINCT FROM version_row."id" OR round_row."applicantUserId" IS DISTINCT FROM parent."uploadedByUserId"
    OR round_row."frozenNodes"->0->'submissionSnapshot' IS DISTINCT FROM version_row."readinessSnapshot"
    OR seal_row."id" IS NULL OR seal_row."contractVersionId" IS DISTINCT FROM version_row."id"
    OR seal_row."approvalInstanceId" IS DISTINCT FROM round_row."id" OR seal_row."handlerUserId" IS DISTINCT FROM parent."uploadedByUserId"
    OR seal_row."status" IS DISTINCT FROM 'completed' OR seal_row."completedByUserId" IS NULL OR seal_row."completedAt" IS NULL
    OR seal_row."completedAt">parent."confirmedAt" THEN
    RAISE EXCEPTION '归档原件版本与本轮项目及原经办不一致' USING ERRCODE='23514';
  END IF;

  SELECT e."id",e."archiveFileId",e."contractVersionId",e."fileId",e."displayOrder",e."mimeType",e."sizeBytes",e."contentSha256"
    INTO evidence FROM public."ContractArchiveEvidenceFile" e WHERE e."id"=NEW."evidenceId";
  SELECT f."id",f."bucket",f."objectKey",f."mimeType",f."sizeBytes",f."contentSha256",f."uploadedByUserId",f."storageStatus",
    f."purgeReceiptId",f."supersedesFileObjectId" INTO file_row FROM public."FileObject" f WHERE f."id"=evidence."fileId";
  pin:=jsonb_build_object('fileId',evidence."fileId",'displayOrder',evidence."displayOrder",
    'mimeType',evidence."mimeType",'sizeBytes',evidence."sizeBytes",'contentSha256',evidence."contentSha256");
  IF evidence."id" IS NULL OR evidence."archiveFileId" IS DISTINCT FROM parent."id"
    OR evidence."contractVersionId" IS DISTINCT FROM version_row."id" OR evidence."displayOrder" NOT BETWEEN 0 AND 19
    OR evidence."mimeType" IS DISTINCT FROM 'application/pdf'
    OR parent."authoritySnapshot"->'fileManifest'->evidence."displayOrder" IS DISTINCT FROM pin
    OR file_row."id" IS NULL OR file_row."storageStatus" IS DISTINCT FROM 'active' OR file_row."purgeReceiptId" IS NOT NULL
    OR file_row."supersedesFileObjectId" IS NOT NULL OR file_row."uploadedByUserId" IS DISTINCT FROM parent."uploadedByUserId"
    OR file_row."mimeType" IS DISTINCT FROM evidence."mimeType" OR file_row."sizeBytes" IS DISTINCT FROM evidence."sizeBytes"
    OR file_row."contentSha256" IS DISTINCT FROM evidence."contentSha256"
    OR file_row."bucket" IS DISTINCT FROM NEW."bucket" OR file_row."objectKey" IS DISTINCT FROM NEW."objectKey" THEN
    RAISE EXCEPTION '归档原件版本与有序原件清单不一致' USING ERRCODE='23514';
  END IF;
  NEW."scope":=jsonb_build_object('protocolVersion',1,'archiveSource','generated_approval','relationship',relationship,
    'projectId',owner_row."projectId",'contractId',owner_row."id",'contractVersionId',version_row."id",
    'approvalInstanceId',round_row."id",'sealTaskId',seal_row."id",'uploaderUserId',parent."uploadedByUserId",
    'sealConfirmerUserId',seal_row."completedByUserId",'idempotencyKey',parent."idempotencyKey",
    'requestSha256',parent."requestSha256",'authoritySha256',parent."authoritySha256",'fileManifestSha256',parent."fileManifestSha256",
    'documentContentRevision',parent."documentContentRevision",'documentContentFingerprint',parent."documentContentFingerprint");
  RETURN NEW;
END;
$original$;
REVOKE ALL ON FUNCTION public.jg_guard_generated_archive_original_v1() FROM PUBLIC;
CREATE TRIGGER jg_generated_archive_original_append BEFORE INSERT OR UPDATE OR DELETE
ON public.jg_contract_generated_archive_original_v1 FOR EACH ROW EXECUTE FUNCTION public.jg_guard_generated_archive_original_v1();
CREATE TRIGGER jg_generated_archive_original_no_truncate BEFORE TRUNCATE
ON public.jg_contract_generated_archive_original_v1 FOR EACH STATEMENT EXECUTE FUNCTION public.jg_guard_generated_archive_original_v1();

CREATE FUNCTION public.jg_require_generated_archive_originals_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $complete$
DECLARE
  subject TEXT;
  manifest JSONB;
  covered BIGINT;
  scopes BIGINT;
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_TABLE_NAME<>'ContractArchiveFile' OR TG_OP<>'INSERT' THEN
    RAISE EXCEPTION '生成合同归档原件完整性守卫作用域不匹配' USING ERRCODE='55000';
  END IF;
  IF NEW."archiveProtocolVersion"<>2 OR NEW."archiveSource" IS DISTINCT FROM 'generated_approval' THEN RETURN NEW; END IF;
  SELECT v."signingSubjectType" INTO subject FROM public."ContractVersion" v WHERE v."id"=NEW."contractVersionId";
  IF subject NOT IN ('affiliate','upward')
    AND COALESCE(NEW."authoritySnapshot"#>>'{sourceBasis,subjects,signingIdentity,relationship}','') NOT IN ('outside','upward')
    THEN RETURN NEW;
  END IF;
  SELECT count(*),count(DISTINCT p."scope"),jsonb_agg(jsonb_build_object('fileId',e."fileId",'displayOrder',e."displayOrder",
    'mimeType',e."mimeType",'sizeBytes',e."sizeBytes",'contentSha256',e."contentSha256") ORDER BY e."displayOrder")
    INTO covered,scopes,manifest FROM public."ContractArchiveEvidenceFile" e
    JOIN public.jg_contract_generated_archive_original_v1 p ON p."evidenceId"=e."id" AND p."archiveId"=e."archiveFileId"
    JOIN public."FileObject" f ON f."id"=e."fileId" AND f."bucket"=p."bucket" AND f."objectKey"=p."objectKey"
      AND f."mimeType"=e."mimeType" AND f."sizeBytes"=e."sizeBytes" AND f."contentSha256"=e."contentSha256"
      AND f."uploadedByUserId"=NEW."uploadedByUserId" AND f."storageStatus"='active'
      AND f."purgeReceiptId" IS NULL AND f."supersedesFileObjectId" IS NULL
    WHERE e."archiveFileId"=NEW."id" AND e."contractVersionId"=NEW."contractVersionId";
  IF covered NOT BETWEEN 1 AND 20 OR scopes<>1 OR manifest IS DISTINCT FROM NEW."authoritySnapshot"->'fileManifest'
    OR covered<>(SELECT count(*) FROM public."ContractArchiveEvidenceFile" e WHERE e."archiveFileId"=NEW."id") THEN
    RAISE EXCEPTION '生成合同归档缺少完整有序的固定版本证据' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$complete$;
REVOKE ALL ON FUNCTION public.jg_require_generated_archive_originals_v1() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER jg_generated_archive_originals_complete
AFTER INSERT ON public."ContractArchiveFile" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.jg_require_generated_archive_originals_v1();

DO $install_generated_archive_originals$
DECLARE
  anchor RECORD;
  owner_id OID:=current_user::regrole::oid;
  app_name NAME;
  evidence_table OID:='public.jg_contract_generated_archive_original_v1'::regclass;
  binding_table OID:='public.jg_contract_generated_upward_seal_binding_v1'::regclass;
BEGIN
  SELECT b.* INTO STRICT anchor FROM public.jg_contract_generated_upward_seal_binding_v1 b
    JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database()
    WHERE b."protocolVersion"=1 AND b."namespaceOid"=pg_catalog.to_regnamespace('public');
  SELECT rolname INTO STRICT app_name FROM pg_catalog.pg_roles WHERE oid=anchor."applicationRoleOid";
  IF current_user IS DISTINCT FROM session_user OR owner_id IS DISTINCT FROM anchor."ownerOid"
    OR owner_id=anchor."applicationRoleOid"
    OR (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.oid IN (evidence_table,binding_table)
      AND c.relowner=owner_id AND c.relnamespace=anchor."namespaceOid" AND c.relkind='r'
      AND c.relpersistence='p' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity)<>2
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(anchor."applicationRoleOid",r.oid,'MEMBER')
      AND (r.rolsuper OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication
        OR pg_catalog.pg_has_role(r.oid,owner_id,'MEMBER') OR pg_catalog.has_schema_privilege(r.oid,anchor."namespaceOid",'CREATE'))) THEN
    RAISE EXCEPTION '生成合同归档原件证据的安装角色不匹配' USING ERRCODE='55000';
  END IF;
  EXECUTE format('GRANT SELECT ON TABLE public.jg_contract_generated_archive_original_v1 TO %I',app_name);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
    WHERE c.oid=evidence_table AND a.grantee=anchor."applicationRoleOid" AND a.grantor=owner_id
      AND a.privilege_type='SELECT' AND NOT a.is_grantable)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
      WHERE c.oid=evidence_table AND (a.grantor<>owner_id OR a.grantee<>owner_id
        AND (a.grantee<>anchor."applicationRoleOid" OR a.privilege_type<>'SELECT' OR a.is_grantable)))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=evidence_table
      AND a.attnum>0 AND NOT a.attisdropped AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION '生成合同归档原件证据只接受限定读取权限' USING ERRCODE='55000';
  END IF;
END;
$install_generated_archive_originals$;

COMMIT;
