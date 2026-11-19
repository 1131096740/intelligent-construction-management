BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;

-- Retention and deferred completion only. The 204 parent and 205 version
-- guards still prohibit direct registration. Trusted ACL and binding supply
-- belong to a separate qualified installation; this migration grants none.
CREATE TABLE public.jg_contract_direct_archive_retention_binding_v1 (
  "protocolVersion" INTEGER PRIMARY KEY CHECK ("protocolVersion"=1),
  "recipeVersion" TEXT NOT NULL CHECK ("recipeVersion"='contract-direct-archive-retention-v1/1'),
  "applicationRoleOid" OID NOT NULL,
  "databaseOid" OID NOT NULL,
  "anchorOwnerOid" OID NOT NULL,
  "preparationRelationOid" OID NOT NULL,
  "preparationSha256" TEXT NOT NULL CHECK ("preparationSha256"~'^[a-f0-9]{64}$'),
  "bindings" JSONB NOT NULL CHECK (jsonb_typeof("bindings")='object')
);
REVOKE ALL ON TABLE public.jg_contract_direct_archive_retention_binding_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_guard_contract_direct_archive_retention_binding_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $retention_binding_guard$
DECLARE prepared RECORD;
BEGIN
  IF TG_OP<>'INSERT' OR EXISTS (SELECT 1 FROM public.jg_contract_direct_archive_retention_binding_v1) THEN
    RAISE EXCEPTION '直签原件交接资格不可改写' USING ERRCODE='23514';
  END IF;
  SELECT p."applicationRoleOid",p."databaseOid",p."anchorOwnerOid",p."anchorNamespaceOid",
    p.tableoid AS relation_oid,encode(public.digest(convert_to(to_jsonb(p)::text,'UTF8'),'sha256'),'hex') AS sha
  INTO STRICT prepared FROM public.jg_contract_direct_archive_binding_v1 p
  WHERE p."protocolVersion"=1 AND p."recipeVersion"='contract-direct-archive-preparation-v1/1';
  IF current_user::regrole::oid IS DISTINCT FROM prepared."anchorOwnerOid"
    OR prepared."anchorNamespaceOid" IS DISTINCT FROM TG_TABLE_SCHEMA::text::regnamespace::oid
    OR NEW."applicationRoleOid" IS DISTINCT FROM prepared."applicationRoleOid"
    OR NEW."databaseOid" IS DISTINCT FROM prepared."databaseOid"
    OR NEW."databaseOid" IS DISTINCT FROM (SELECT oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database())
    OR NEW."anchorOwnerOid" IS DISTINCT FROM prepared."anchorOwnerOid"
    OR NEW."preparationRelationOid" IS DISTINCT FROM prepared.relation_oid
    OR NEW."preparationSha256" IS DISTINCT FROM prepared.sha THEN
    RAISE EXCEPTION '直签原件交接资格与准备绑定不一致' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$retention_binding_guard$;
REVOKE ALL ON FUNCTION public.jg_guard_contract_direct_archive_retention_binding_v1() FROM PUBLIC;
CREATE TRIGGER jg_direct_archive_retention_binding_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.jg_contract_direct_archive_retention_binding_v1
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_contract_direct_archive_retention_binding_v1();
CREATE TRIGGER jg_direct_archive_retention_binding_no_truncate
BEFORE TRUNCATE ON public.jg_contract_direct_archive_retention_binding_v1
FOR EACH STATEMENT EXECUTE FUNCTION public.jg_guard_contract_direct_archive_retention_binding_v1();

CREATE FUNCTION public.jg_protect_contract_direct_archive_file_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $direct_archive_file_guard$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF ROW(OLD."id",OLD."bucket",OLD."objectKey",OLD."mimeType",OLD."sizeBytes",OLD."contentSha256",OLD."storageStatus",
        OLD."purgeReceiptId",OLD."supersedesFileObjectId",OLD."uploadedByUserId") IS NOT DISTINCT FROM
      ROW(NEW."id",NEW."bucket",NEW."objectKey",NEW."mimeType",NEW."sizeBytes",NEW."contentSha256",NEW."storageStatus",
        NEW."purgeReceiptId",NEW."supersedesFileObjectId",NEW."uploadedByUserId") THEN RETURN NEW;
    END IF;
  END IF;
  -- File mutation holds F. The unchanged 206 guard serializes key changes and
  -- replacements with the same physical-key lock used by the future writer.
  IF TG_OP<>'INSERT' THEN
    IF EXISTS (
      SELECT 1 FROM public."ContractArchiveEvidenceFile" e
      JOIN public."ContractArchiveFile" a ON a."id"=e."archiveFileId" AND a."contractVersionId"=e."contractVersionId"
      WHERE e."fileId"=OLD."id" AND a."archiveProtocolVersion"=2 AND a."archiveSource"='direct_signed'
    ) THEN
      RAISE EXCEPTION '直签归档原件不可清理或改写' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF EXISTS (
    SELECT 1 FROM public."ContractArchiveEvidenceFile" e
    JOIN public."ContractArchiveFile" a ON a."id"=e."archiveFileId" AND a."contractVersionId"=e."contractVersionId"
    JOIN public."FileObject" f ON f."id"=e."fileId"
    WHERE a."archiveProtocolVersion"=2 AND a."archiveSource"='direct_signed'
      AND (f."objectKey"=NEW."objectKey" OR e."fileId"=NEW."supersedesFileObjectId")
  ) THEN
    RAISE EXCEPTION '直签归档原件不可被替换或复用存储键' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$direct_archive_file_guard$;
REVOKE ALL ON FUNCTION public.jg_protect_contract_direct_archive_file_v1() FROM PUBLIC;
CREATE TRIGGER "FileObject_contract_direct_archive_retention_v1"
BEFORE INSERT OR UPDATE OR DELETE ON public."FileObject"
FOR EACH ROW EXECUTE FUNCTION public.jg_protect_contract_direct_archive_file_v1();

CREATE FUNCTION public.jg_require_contract_direct_archive_complete_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $direct_archive_complete_guard$
DECLARE archive_id TEXT; parent_protocol INTEGER; parent_source TEXT; source RECORD;
BEGIN
  IF TG_TABLE_SCHEMA<>'public' OR TG_OP<>'INSERT' THEN
    RAISE EXCEPTION '直签归档完整性检查接线不正确' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='ContractArchiveFile' THEN
    IF NEW."archiveProtocolVersion"<>2 OR NEW."archiveSource" IS DISTINCT FROM 'direct_signed' THEN RETURN NULL; END IF;
    archive_id:=NEW."id";
  ELSIF TG_TABLE_NAME='ContractArchiveEvidenceFile' THEN
    archive_id:=NEW."archiveFileId";
    SELECT a."archiveProtocolVersion",a."archiveSource" INTO parent_protocol,parent_source
      FROM public."ContractArchiveFile" a WHERE a."id"=archive_id;
    IF NOT FOUND THEN RAISE EXCEPTION '归档原件缺少真实归档记录' USING ERRCODE='23514'; END IF;
    IF parent_protocol<>2 OR parent_source IS DISTINCT FROM 'direct_signed' THEN RETURN NULL; END IF;
  ELSE
    RAISE EXCEPTION '直签归档完整性检查接线不正确' USING ERRCODE='23514';
  END IF;

  SELECT a."contractVersionId",a."confirmedAt",a."authoritySnapshot",
    v."affiliateAssignmentId",v."affiliateBusinessPartyVersionId",c."projectId",p."isActive",p."operatingLedgerEffectiveDate"
  INTO source FROM public."ContractArchiveFile" a
  LEFT JOIN public."ContractVersion" v ON v."id"=a."contractVersionId"
  LEFT JOIN public."Contract" c ON c."id"=v."contractId"
  LEFT JOIN public."Project" p ON p."id"=c."projectId"
  WHERE a."id"=archive_id AND a."archiveProtocolVersion"=2 AND a."archiveSource"='direct_signed';
  IF NOT FOUND THEN RAISE EXCEPTION '直签归档完整性来源缺失' USING ERRCODE='23514'; END IF;

  IF public.jg_contract_direct_archive_proof_v1(archive_id) IS NULL
    OR source."isActive" IS DISTINCT FROM TRUE OR source."operatingLedgerEffectiveDate" IS NOT NULL
    OR 1<>(SELECT count(*) FROM public."ProjectAffiliateAssignment" a
      WHERE a."projectId"=source."projectId" AND a."effectiveFrom"<=source."confirmedAt"
        AND (a."endedAt" IS NULL OR a."endedAt">source."confirmedAt"))
    OR NOT EXISTS (SELECT 1 FROM public."ProjectAffiliateAssignment" a
      WHERE a."id"=source."affiliateAssignmentId" AND a."projectId"=source."projectId"
        AND a."effectiveFrom"<=source."confirmedAt" AND (a."endedAt" IS NULL OR a."endedAt">source."confirmedAt")
        AND a."businessPartyVersionId"=source."affiliateBusinessPartyVersionId"
        AND a."businessPartyId"=source."authoritySnapshot"#>>'{sourceBasis,directInput,Q,subjects,enterprise,businessPartyId}')
    OR EXISTS (SELECT 1 FROM public."OperatingFact" f WHERE f."sourceType"='contract_version' AND f."sourceBusinessId"=source."contractVersionId")
    OR EXISTS (SELECT 1 FROM public."OperatingImpactEntry" i WHERE i."sourceType"='contract_version' AND i."sourceBusinessId"=source."contractVersionId") THEN
    RAISE EXCEPTION '直签归档、原件交接与版本生效必须同事务完整提交' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$direct_archive_complete_guard$;
REVOKE ALL ON FUNCTION public.jg_require_contract_direct_archive_complete_v1() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER "ContractArchiveFile_direct_complete_v1"
AFTER INSERT ON public."ContractArchiveFile" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.jg_require_contract_direct_archive_complete_v1();
CREATE CONSTRAINT TRIGGER "ContractArchiveEvidenceFile_direct_complete_v1"
AFTER INSERT ON public."ContractArchiveEvidenceFile" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.jg_require_contract_direct_archive_complete_v1();
COMMIT;
