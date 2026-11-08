-- SOURCE ONLY. No migration/PG/ACL execution is authorized by this file.
-- Face A only: original inside/generated archive. Direct/B/upward/inline stay closed.
BEGIN;

ALTER TABLE public."ContractArchiveFile"
  ALTER COLUMN "fileId" DROP NOT NULL,
  ADD COLUMN "archiveProtocolVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "archiveSource" TEXT,
  ADD COLUMN "approvalInstanceId" TEXT,
  ADD COLUMN "sealTaskId" TEXT,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "requestSha256" TEXT,
  ADD COLUMN "sourceRevision" INTEGER,
  ADD COLUMN "documentContentRevision" INTEGER,
  ADD COLUMN "documentContentFingerprint" TEXT,
  ADD COLUMN "authoritySnapshot" JSONB,
  ADD COLUMN "authoritySha256" TEXT,
  ADD COLUMN "fileManifestSha256" TEXT,
  ADD COLUMN "responseSnapshot" JSONB;
ALTER TABLE public."ContractArchiveFile"
  ADD CONSTRAINT "ContractArchiveFile_id_contractVersionId_key" UNIQUE ("id", "contractVersionId"),
  ADD CONSTRAINT "ContractArchiveFile_idempotencyKey_key" UNIQUE ("idempotencyKey"),
  ADD CONSTRAINT "ContractArchiveFile_v2_shape" CHECK (COALESCE(
    ("archiveProtocolVersion" = 1 AND "fileId" IS NOT NULL
      AND "archiveSource" IS NULL AND "approvalInstanceId" IS NULL AND "sealTaskId" IS NULL
      AND "idempotencyKey" IS NULL AND "requestSha256" IS NULL AND "sourceRevision" IS NULL
      AND "documentContentRevision" IS NULL AND "documentContentFingerprint" IS NULL
      AND "authoritySnapshot" IS NULL AND "authoritySha256" IS NULL
      AND "fileManifestSha256" IS NULL AND "responseSnapshot" IS NULL)
    OR ("archiveProtocolVersion" = 2 AND "fileId" IS NULL AND "status" = 'confirmed'
      AND "confirmedByUserId" IS NOT NULL AND "confirmedByUserId" = "uploadedByUserId"
      AND "confirmedAt" IS NOT NULL AND "sourceRevision" >= 1
      AND "idempotencyKey" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      AND "requestSha256" ~ '^[0-9a-f]{64}$' AND "authoritySha256" ~ '^[0-9a-f]{64}$'
      AND "fileManifestSha256" ~ '^[0-9a-f]{64}$'
      AND jsonb_typeof("authoritySnapshot") = 'object' AND jsonb_typeof("responseSnapshot") = 'object'
      AND (("archiveSource" = 'generated_approval' AND "approvalInstanceId" IS NOT NULL AND "sealTaskId" IS NOT NULL
        AND "documentContentRevision" >= 1 AND "documentContentFingerprint" ~ '^[0-9a-f]{64}$')
       OR ("archiveSource" = 'direct_signed' AND "approvalInstanceId" IS NULL AND "sealTaskId" IS NULL
        AND (("documentContentRevision" IS NULL AND "documentContentFingerprint" IS NULL)
          OR ("documentContentRevision" >= 1 AND "documentContentFingerprint" ~ '^[0-9a-f]{64}$'))))), FALSE));
CREATE UNIQUE INDEX "ContractArchiveFile_v2_one_version" ON public."ContractArchiveFile"("contractVersionId") WHERE "archiveProtocolVersion" = 2;
CREATE UNIQUE INDEX "ContractArchiveFile_v2_one_round" ON public."ContractArchiveFile"("approvalInstanceId") WHERE "archiveProtocolVersion" = 2;
CREATE UNIQUE INDEX "ContractArchiveFile_v2_one_seal_task" ON public."ContractArchiveFile"("sealTaskId") WHERE "archiveProtocolVersion" = 2;
ALTER TABLE public."ApprovalInstance" ADD CONSTRAINT "ApprovalInstance_id_businessId_key" UNIQUE ("id", "businessId");
ALTER TABLE public."ContractSealTask" ADD CONSTRAINT "ContractSealTask_id_contractVersionId_approvalInstanceId_key" UNIQUE ("id", "contractVersionId", "approvalInstanceId");
ALTER TABLE public."ContractArchiveFile"
  ADD CONSTRAINT "ContractArchiveFile_v2_round_version_fk" FOREIGN KEY ("approvalInstanceId", "contractVersionId") REFERENCES public."ApprovalInstance"("id", "businessId") ON DELETE RESTRICT,
  ADD CONSTRAINT "ContractArchiveFile_v2_task_round_version_fk" FOREIGN KEY ("sealTaskId", "contractVersionId", "approvalInstanceId") REFERENCES public."ContractSealTask"("id", "contractVersionId", "approvalInstanceId") ON DELETE RESTRICT;

CREATE TABLE public."ContractArchiveEvidenceFile" (
  "id" TEXT PRIMARY KEY,
  "archiveFileId" TEXT NOT NULL,
  "contractVersionId" TEXT NOT NULL,
  "fileId" TEXT NOT NULL UNIQUE REFERENCES public."FileObject"("id") ON DELETE RESTRICT,
  "displayOrder" INTEGER NOT NULL CHECK ("displayOrder" >= 0),
  "mimeType" TEXT NOT NULL CHECK ("mimeType" IN ('application/pdf','image/jpeg','image/png')),
  "sizeBytes" INTEGER NOT NULL CHECK ("sizeBytes" > 0),
  "contentSha256" TEXT NOT NULL CHECK ("contentSha256" ~ '^[0-9a-f]{64}$'),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContractArchiveEvidenceFile_archiveFileId_displayOrder_key" UNIQUE ("archiveFileId", "displayOrder"),
  CONSTRAINT "ContractArchiveEvidenceFile_archive_version_fk" FOREIGN KEY ("archiveFileId", "contractVersionId") REFERENCES public."ContractArchiveFile"("id", "contractVersionId") ON DELETE RESTRICT
);
CREATE INDEX "ContractArchiveEvidenceFile_contractVersionId_idx" ON public."ContractArchiveEvidenceFile"("contractVersionId");

CREATE FUNCTION public.jg_contract_archive_v2_parent_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $parent$
DECLARE
  e JSONB; x JSONB; l JSONB; b TEXT; m TEXT; project_state RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."archiveProtocolVersion" = 2 THEN RAISE EXCEPTION '新版合同归档权威不可删除' USING ERRCODE = '23514'; END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD."archiveProtocolVersion" = 2 OR NEW."archiveProtocolVersion" = 2 THEN RAISE EXCEPTION '新版合同归档权威不可修改' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
  END IF;
  IF NEW."archiveProtocolVersion" <> 2 THEN RETURN NEW; END IF;
  -- The model can express direct_signed; its authority is not enabled in Face A.
  IF NEW."archiveSource" IS DISTINCT FROM 'generated_approval' THEN
    RAISE EXCEPTION '当前已签直接登记来源尚未闭合，请保留原文件' USING ERRCODE = '23514';
  END IF;
  e := NEW."authoritySnapshot"; x := e -> 'sourceBasis'; l := e -> 'fileManifest';
  IF jsonb_typeof(e) IS DISTINCT FROM 'object' OR jsonb_typeof(x) IS DISTINCT FROM 'object'
    OR jsonb_typeof(l) IS DISTINCT FROM 'array' OR jsonb_array_length(l) = 0
    OR (x ->> 'basisProtocolVersion') IS DISTINCT FROM '1'
    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(x) k) IS DISTINCT FROM
      ARRAY['basisProtocolVersion','businessTime','fileManifest','money','sourceLocator','subjects','termsAndTax','versionEvidence']::TEXT[]
    OR (e - ARRAY['authorityProtocolVersion','projectId','contractId','contractVersionId','archiveSource','handlerUserId','archivedAt','requestSha256','sourceRevision','documentContentRevision','documentContentFingerprint','approvalInstanceId','sealTaskId','sourceBasis','sourceBasisSha256','fileManifest','fileManifestSha256','operatingConsequence']) <> '{}'::JSONB
    OR (x -> 'fileManifest') IS DISTINCT FROM l THEN
    RAISE EXCEPTION '归档独立来源或原件清单不完整' USING ERRCODE = '23514';
  END IF;
  -- Fixed independent hash domains: no arbitrary extension slot can carry A/S.
  IF jsonb_typeof(x -> 'sourceLocator') IS DISTINCT FROM 'object'
    OR ((x -> 'sourceLocator') - ARRAY['projectId','contractId','contractVersionId','sourceType','sourceBusinessId','entryKind','sourceVersion','versionNo','changeType','formalCode']) <> '{}'::JSONB
    OR jsonb_typeof(x -> 'versionEvidence') IS DISTINCT FROM 'object'
    OR ((x -> 'versionEvidence') - ARRAY['draftRevision','documentContentRevision','documentContentFingerprint','businessTemplateVersionId','layoutTemplateVersionId','sourceSha256','generatedDocumentId','generatedDocumentFiles','approvalInstanceId','sealTaskId']) <> '{}'::JSONB
    OR jsonb_typeof(x -> 'businessTime') IS DISTINCT FROM 'object'
    OR ((x -> 'businessTime') - ARRAY['archivedAt','businessDay','handlerUserId']) <> '{}'::JSONB
    OR jsonb_typeof(x -> 'money') IS DISTINCT FROM 'object'
    OR ((x -> 'money') - ARRAY['numericProtocolVersion','amountCents','amountYuan','amountState','amountLimitType','pricingNature','amountSource','commitmentDeltaYuan','direction','economicExcludedYuan','economicReviewSources','predecessor']) <> '{}'::JSONB
    OR jsonb_typeof(x -> 'subjects') IS DISTINCT FROM 'object'
    OR ((x -> 'subjects') - ARRAY['signingIdentity','parties','participation']) <> '{}'::JSONB
    OR jsonb_typeof(x -> 'termsAndTax') IS DISTINCT FROM 'object'
    OR ((x -> 'termsAndTax') - ARRAY['paymentTerms','taxFacts']) <> '{}'::JSONB
    OR jsonb_typeof(e -> 'operatingConsequence') IS DISTINCT FROM 'object'
    OR ((e -> 'operatingConsequence') - ARRAY['protocolVersion','mode','operatingLedgerEffectiveDateSnapshot','expectedSource']) <> '{}'::JSONB THEN
    RAISE EXCEPTION '归档依据包含未定义摘要域或字段' USING ERRCODE='23514';
  END IF;
  b := encode(public.digest(convert_to(x::TEXT, 'UTF8'), 'sha256'), 'hex');
  m := encode(public.digest(convert_to(l::TEXT, 'UTF8'), 'sha256'), 'hex');
  IF (e ? 'sourceBasisSha256' AND e ->> 'sourceBasisSha256' IS DISTINCT FROM b)
    OR (e ? 'fileManifestSha256' AND e ->> 'fileManifestSha256' IS DISTINCT FROM m) THEN
    RAISE EXCEPTION '归档独立摘要与数据库规范依据不一致' USING ERRCODE = '23514';
  END IF;
  e := e || jsonb_build_object('sourceBasisSha256', b, 'fileManifestSha256', m);
  SELECT c."projectId", pr."isActive", pr."operatingLedgerEffectiveDate" INTO project_state
    FROM public."ContractVersion" v JOIN public."Contract" c ON c."id" = v."contractId"
    JOIN public."Project" pr ON pr."id" = c."projectId" WHERE v."id" = NEW."contractVersionId";
  IF NOT FOUND OR project_state."isActive" IS DISTINCT FROM TRUE OR e ->> 'projectId' IS DISTINCT FROM project_state."projectId"
    OR (e #>> '{operatingConsequence,protocolVersion}') IS DISTINCT FROM '1'
    OR NOT COALESCE((e -> 'operatingConsequence') ? 'operatingLedgerEffectiveDateSnapshot', FALSE)
    OR (e #> '{operatingConsequence,operatingLedgerEffectiveDateSnapshot}') IS DISTINCT FROM COALESCE(to_jsonb(project_state."operatingLedgerEffectiveDate"), 'null'::JSONB) THEN
    RAISE EXCEPTION '归档项目经营后果缺少真实当次依据' USING ERRCODE = '23514';
  END IF;
  IF project_state."operatingLedgerEffectiveDate" IS NULL THEN
    IF (e #>> '{operatingConsequence,mode}') IS DISTINCT FROM 'not_applicable'
      OR (e #> '{operatingConsequence,expectedSource}') IS DISTINCT FROM 'null'::JSONB THEN
      RAISE EXCEPTION '经营未启用的归档后果必须明确不适用' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF (e #>> '{operatingConsequence,mode}') IS DISTINCT FROM 'projection_required'
      OR jsonb_typeof(e #> '{operatingConsequence,expectedSource}') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION '经营已启用的归档必须冻结预期来源' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF e #>> '{operatingConsequence,mode}' = 'projection_required' THEN
    IF (e #> '{operatingConsequence,expectedSource}') ? 'sourceBasisSha256'
      AND e #>> '{operatingConsequence,expectedSource,sourceBasisSha256}' IS DISTINCT FROM b THEN
      RAISE EXCEPTION '预期来源依据摘要不一致' USING ERRCODE='23514';
    END IF;
    IF ((e #> '{operatingConsequence,expectedSource}') - ARRAY['sourceType','sourceBusinessId','sourceVersion','entryKind','factIdempotencyKey','impactIdempotencyKey','sourceImpactKey','impactKind','numericProtocolVersion','amountState','amountYuan','direction','sourceBasisSha256']) <> '{}'::JSONB THEN
      RAISE EXCEPTION '经营预期不能带入最终来源S或归档A' USING ERRCODE='23514';
    END IF;
    e := jsonb_set(e, '{operatingConsequence,expectedSource,sourceBasisSha256}', to_jsonb(b));
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(l) item WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
    OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(item) k) IS DISTINCT FROM ARRAY['contentSha256','displayOrder','fileId','mimeType','sizeBytes']::TEXT[]
    OR item ->> 'mimeType' IS DISTINCT FROM 'application/pdf') THEN
    RAISE EXCEPTION '本阶段生成审批合同只接受完整双方签章PDF原件' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public."User" u WHERE u."id" = NEW."uploadedByUserId" AND u."isActive") THEN
    RAISE EXCEPTION '归档经办账号不可用' USING ERRCODE = '23514';
  END IF;
  NEW."authoritySnapshot" := e;
  NEW."fileManifestSha256" := m;
  NEW."authoritySha256" := encode(public.digest(convert_to(e::TEXT, 'UTF8'), 'sha256'), 'hex');
  RETURN NEW;
END;
$parent$;
REVOKE ALL ON FUNCTION public.jg_contract_archive_v2_parent_guard() FROM PUBLIC;
CREATE TRIGGER "ContractArchiveFile_v2_immutable" BEFORE INSERT OR UPDATE OR DELETE ON public."ContractArchiveFile" FOR EACH ROW EXECUTE FUNCTION public.jg_contract_archive_v2_parent_guard();

CREATE FUNCTION public.jg_contract_archive_v2_evidence_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $evidence$
DECLARE a RECORD; f RECORD; item JSONB;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION '归档原件不可修改或删除' USING ERRCODE = '23514'; END IF;
  SELECT "contractVersionId", "archiveProtocolVersion", "authoritySnapshot" INTO a FROM public."ContractArchiveFile" WHERE "id" = NEW."archiveFileId";
  SELECT "id", "mimeType", "sizeBytes", "contentSha256", "storageStatus", "supersedesFileObjectId" INTO f FROM public."FileObject" WHERE "id" = NEW."fileId";
  item := jsonb_build_object('fileId', NEW."fileId", 'displayOrder', NEW."displayOrder", 'mimeType', NEW."mimeType", 'sizeBytes', NEW."sizeBytes", 'contentSha256', NEW."contentSha256");
  IF a."archiveProtocolVersion" IS DISTINCT FROM 2 OR a."contractVersionId" IS DISTINCT FROM NEW."contractVersionId"
    OR NOT COALESCE((a."authoritySnapshot" -> 'fileManifest') @> jsonb_build_array(item), FALSE)
    OR f."id" IS NULL OR f."storageStatus" IS DISTINCT FROM 'active' OR f."supersedesFileObjectId" IS NOT NULL
    OR f."mimeType" IS DISTINCT FROM NEW."mimeType" OR f."sizeBytes" IS DISTINCT FROM NEW."sizeBytes" OR f."contentSha256" IS DISTINCT FROM NEW."contentSha256" THEN
    RAISE EXCEPTION '归档原件与冻结清单或真实文件不一致' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$evidence$;
REVOKE ALL ON FUNCTION public.jg_contract_archive_v2_evidence_guard() FROM PUBLIC;
CREATE TRIGGER "ContractArchiveEvidenceFile_immutable" BEFORE INSERT OR UPDATE OR DELETE ON public."ContractArchiveEvidenceFile" FOR EACH ROW EXECUTE FUNCTION public.jg_contract_archive_v2_evidence_guard();

CREATE FUNCTION public.jg_assert_contract_archive_v2_manifest(p_archive_id TEXT) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $manifest$
DECLARE a RECORD; v RECORD; c RECORD; r RECORD; t RECORD; e JSONB; x JSONB; l JSONB; actual JSONB; s JSONB; word_ref JSONB; pdf_ref JSONB; participant RECORD; n BIGINT; review RECORD; review_document JSONB; coverage_row JSONB; review_sources JSONB := '[]'::JSONB; seen_pairs JSONB := '[]'::JSONB; review_pair JSONB; side TEXT; left_yuan NUMERIC; right_yuan NUMERIC; excluded_yuan NUMERIC := 0; commitment_delta NUMERIC;
BEGIN
  SELECT "id", "contractVersionId", "fileId", "uploadedByUserId", "confirmedByUserId", "confirmedAt", "status", "archiveProtocolVersion", "archiveSource", "approvalInstanceId", "sealTaskId", "idempotencyKey", "requestSha256", "sourceRevision", "documentContentRevision", "documentContentFingerprint", "authoritySnapshot", "authoritySha256", "fileManifestSha256", "responseSnapshot"
    INTO a FROM public."ContractArchiveFile" WHERE "id" = p_archive_id;
  IF NOT FOUND OR a."archiveProtocolVersion" IS DISTINCT FROM 2 OR a."archiveSource" IS DISTINCT FROM 'generated_approval' THEN
    RAISE EXCEPTION '未找到可用的新版合同归档权威' USING ERRCODE = '23514';
  END IF;
  SELECT "id", "contractId", "versionNo", "changeType", "numericProtocolVersion", "signingSubjectType", "documentContentRevision", "documentContentFingerprint", "companyEntityIdSnapshot", "companyEntityVersionId", "companyEntityNameSnapshot", "companyEntityCreditCodeSnapshot", "companyEntityRegisteredAddressSnapshot", "amountYuan", "amountLimitType", "pricingNature", "amountSource"
    INTO v FROM public."ContractVersion" WHERE "id" = a."contractVersionId";
  SELECT "id", "projectId", "ownerUserId", "voidedAt", "code" INTO c FROM public."Contract" WHERE "id" = v."contractId";
  SELECT "id", "businessId", "businessType", "flowType", "status", "applicantUserId", "frozenNodes" INTO r FROM public."ApprovalInstance" WHERE "id" = a."approvalInstanceId";
  SELECT "id", "contractVersionId", "approvalInstanceId", "handlerUserId", "status", "completedByUserId", "completedAt" INTO t FROM public."ContractSealTask" WHERE "id" = a."sealTaskId";
  e := a."authoritySnapshot"; x := e -> 'sourceBasis'; l := e -> 'fileManifest';
  IF v."id" IS NULL OR c."id" IS NULL OR c."voidedAt" IS NOT NULL OR v."numericProtocolVersion" IS DISTINCT FROM 2 OR v."changeType" IS DISTINCT FROM 'original' OR v."signingSubjectType" IS DISTINCT FROM 'our_company'
    OR a."status" IS DISTINCT FROM 'confirmed' OR a."fileId" IS NOT NULL OR a."confirmedAt" IS NULL OR a."confirmedByUserId" IS DISTINCT FROM a."uploadedByUserId"
    OR e ->> 'authorityProtocolVersion' IS DISTINCT FROM '1' OR e ->> 'projectId' IS DISTINCT FROM c."projectId" OR e ->> 'contractId' IS DISTINCT FROM c."id" OR e ->> 'contractVersionId' IS DISTINCT FROM v."id"
    OR e ->> 'archiveSource' IS DISTINCT FROM a."archiveSource" OR e ->> 'handlerUserId' IS DISTINCT FROM a."uploadedByUserId" OR e ->> 'requestSha256' IS DISTINCT FROM a."requestSha256"
    OR (e ->> 'sourceRevision') IS DISTINCT FROM a."sourceRevision"::TEXT OR (e ->> 'documentContentRevision') IS DISTINCT FROM a."documentContentRevision"::TEXT
    OR e ->> 'documentContentFingerprint' IS DISTINCT FROM a."documentContentFingerprint" OR e ->> 'approvalInstanceId' IS DISTINCT FROM a."approvalInstanceId" OR e ->> 'sealTaskId' IS DISTINCT FROM a."sealTaskId"
    OR (e ->> 'archivedAt')::TIMESTAMPTZ IS DISTINCT FROM (a."confirmedAt" AT TIME ZONE 'UTC')
    OR r."id" IS NULL OR r."businessId" IS DISTINCT FROM v."id" OR r."businessType" IS DISTINCT FROM 'contract_version' OR r."flowType" IS DISTINCT FROM 'contract.approve' OR r."status" IS DISTINCT FROM 'approved'
    OR t."id" IS NULL OR t."contractVersionId" IS DISTINCT FROM v."id" OR t."approvalInstanceId" IS DISTINCT FROM r."id" OR t."status" IS DISTINCT FROM 'completed' OR t."completedByUserId" IS NULL OR t."completedAt" IS NULL
    OR t."handlerUserId" IS DISTINCT FROM a."uploadedByUserId" OR r."applicantUserId" IS DISTINCT FROM a."uploadedByUserId" OR c."ownerUserId" IS DISTINCT FROM a."uploadedByUserId"
    OR v."documentContentRevision" IS DISTINCT FROM a."documentContentRevision" OR v."documentContentFingerprint" IS DISTINCT FROM a."documentContentFingerprint" THEN
    RAISE EXCEPTION '归档轮次、经办或正文来源不一致' USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(r."frozenNodes") IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '审批轮次冻结来源缺失' USING ERRCODE = '23514'; END IF;
  SELECT count(*), jsonb_agg(node -> 'submissionSnapshot') -> 0 INTO n, s FROM jsonb_array_elements(r."frozenNodes") node WHERE node ? 'submissionSnapshot';
  IF n IS DISTINCT FROM 1 OR s ->> 'submissionProtocolVersion' IS DISTINCT FROM '2' OR s ->> 'contractVersionId' IS DISTINCT FROM v."id"
    OR s ->> 'documentContentRevision' IS DISTINCT FROM a."documentContentRevision"::TEXT OR s ->> 'documentContentFingerprint' IS DISTINCT FROM a."documentContentFingerprint"
    OR s ->> 'draftRevision' IS DISTINCT FROM a."sourceRevision"::TEXT THEN
    RAISE EXCEPTION '归档必须使用唯一真实本轮提交来源' USING ERRCODE = '23514';
  END IF;
  IF x #>> '{sourceLocator,projectId}' IS DISTINCT FROM c."projectId" OR x #>> '{sourceLocator,contractId}' IS DISTINCT FROM c."id" OR x #>> '{sourceLocator,contractVersionId}' IS DISTINCT FROM v."id"
    OR x #>> '{sourceLocator,sourceType}' IS DISTINCT FROM 'contract_version' OR x #>> '{sourceLocator,sourceBusinessId}' IS DISTINCT FROM v."id" OR x #>> '{sourceLocator,entryKind}' IS DISTINCT FROM 'original'
    OR x #>> '{sourceLocator,sourceVersion}' IS DISTINCT FROM v."versionNo"::TEXT OR x #>> '{sourceLocator,versionNo}' IS DISTINCT FROM v."versionNo"::TEXT OR x #>> '{sourceLocator,changeType}' IS DISTINCT FROM 'original'
    OR x #>> '{sourceLocator,formalCode}' IS DISTINCT FROM c."code"
    OR x #>> '{versionEvidence,generatedDocumentId}' IS DISTINCT FROM s ->> 'generatedDocumentId'
    OR x #>> '{versionEvidence,documentContentRevision}' IS DISTINCT FROM s ->> 'documentContentRevision'
    OR x #>> '{versionEvidence,documentContentFingerprint}' IS DISTINCT FROM s ->> 'documentContentFingerprint'
    OR x #>> '{versionEvidence,draftRevision}' IS DISTINCT FROM s ->> 'draftRevision'
    OR x #>> '{versionEvidence,businessTemplateVersionId}' IS DISTINCT FROM s ->> 'businessTemplateVersionId'
    OR x #>> '{versionEvidence,layoutTemplateVersionId}' IS DISTINCT FROM s ->> 'layoutTemplateVersionId'
    OR x #>> '{versionEvidence,sourceSha256}' IS DISTINCT FROM s ->> 'sourceSha256'
    OR x #>> '{versionEvidence,approvalInstanceId}' IS DISTINCT FROM a."approvalInstanceId"
    OR x #>> '{versionEvidence,sealTaskId}' IS DISTINCT FROM a."sealTaskId"
    OR x #>> '{businessTime,handlerUserId}' IS DISTINCT FROM a."uploadedByUserId"
    OR x #>> '{businessTime,archivedAt}' IS DISTINCT FROM e ->> 'archivedAt'
    OR (x #> '{termsAndTax,paymentTerms}') IS DISTINCT FROM s -> 'paymentTerms'
    OR (x #> '{termsAndTax,taxFacts}') IS DISTINCT FROM s -> 'taxFacts'
    OR (x #> '{subjects,signingIdentity}') IS DISTINCT FROM s -> 'signingIdentity'
    OR (x #> '{subjects,parties}') IS DISTINCT FROM s -> 'parties'
    OR (s #>> '{versionFacts,companyEntityVersionId}') IS DISTINCT FROM v."companyEntityVersionId"
    OR (s #>> '{versionFacts,companyEntityIdSnapshot}') IS DISTINCT FROM v."companyEntityIdSnapshot"
    OR s #>> '{versionFacts,companyEntityNameSnapshot}' IS DISTINCT FROM v."companyEntityNameSnapshot"
    OR s #>> '{versionFacts,companyEntityCreditCodeSnapshot}' IS DISTINCT FROM v."companyEntityCreditCodeSnapshot"
    OR s #>> '{versionFacts,companyEntityRegisteredAddressSnapshot}' IS DISTINCT FROM v."companyEntityRegisteredAddressSnapshot" THEN
    RAISE EXCEPTION '独立业务依据必须来自原冻结版本，经营版本沿versionNo' USING ERRCODE = '23514';
  END IF;
  IF (x #>> '{money,numericProtocolVersion}') IS DISTINCT FROM '2'
    OR (x #> '{money,amountCents}') IS DISTINCT FROM 'null'::JSONB
    OR (x #>> '{money,amountLimitType}') IS DISTINCT FROM v."amountLimitType"
    OR (x #>> '{money,pricingNature}') IS DISTINCT FROM v."pricingNature"
    OR (x #>> '{money,amountSource}') IS DISTINCT FROM v."amountSource"
    OR NOT COALESCE((x -> 'money') ? 'amountYuan', FALSE)
    OR NOT COALESCE((x -> 'money') ? 'commitmentDeltaYuan', FALSE)
    OR (x #> '{money,predecessor}') IS DISTINCT FROM 'null'::JSONB
    OR CASE WHEN v."amountYuan" IS NULL THEN
      (x #>> '{money,amountState}') IS DISTINCT FROM 'unknown' OR (x #> '{money,amountYuan}') IS DISTINCT FROM 'null'::JSONB
      OR (x #> '{money,commitmentDeltaYuan}') IS DISTINCT FROM 'null'::JSONB
    ELSE (x #>> '{money,amountState}') IS DISTINCT FROM 'known'
      OR CASE WHEN (x #>> '{money,amountYuan}') ~ '^(0|[1-9][0-9]{0,19})(\.[0-9]{1,4})?$'
        THEN (x #>> '{money,amountYuan}')::NUMERIC IS DISTINCT FROM v."amountYuan" ELSE TRUE END END THEN
    RAISE EXCEPTION '独立来源金额必须保真实四位与未知，不得按分或补零' USING ERRCODE='23514';
  END IF;
  -- Original-only authority has no predecessor. Recompute exclusion from real
  -- confirmed, version-applicable reviews as of the real archive instant; never
  -- derive it from X or from another copy of the proposed operating payload.
  -- This mirrors economicExcludedYuanAt: latest per ORDERED source pair. The
  -- existing owner has no tie-break for equal instants, so new-A refuses ties.
  FOR review IN
    SELECT candidate.* FROM (
      SELECT er."id", er."revision", er."confirmedAt", er."leftSourceRef", er."rightSourceRef", er."coverage", er."frozenSources",
        max(er."confirmedAt") OVER (PARTITION BY er."leftSourceRef", er."rightSourceRef") AS latest_confirmed_at
      FROM public."ContractEconomicReview" er
      WHERE er."projectId" = c."projectId" AND er."status" = 'confirmed' AND er."confirmedAt" <= a."confirmedAt"
        AND ('contract:' || c."id") IN (er."leftSourceRef", er."rightSourceRef")
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(er."frozenSources") = 'array' THEN er."frozenSources" ELSE '[]'::JSONB END) d
          WHERE d ->> 'ref' = 'contract:' || c."id" AND d ->> 'version' = v."id" || ':' || v."documentContentRevision"::TEXT)
    ) candidate WHERE candidate."confirmedAt" = candidate.latest_confirmed_at ORDER BY candidate."id"
  LOOP
    review_pair := jsonb_build_array(review."leftSourceRef", review."rightSourceRef");
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(seen_pairs) pair WHERE pair = review_pair) THEN RAISE EXCEPTION '同一履约文书范围存在同时确认的歧义，不能任取排除金额' USING ERRCODE='23514'; END IF;
    seen_pairs := seen_pairs || jsonb_build_array(review_pair);
    IF review."revision" IS NULL OR review."leftSourceRef" IS NOT DISTINCT FROM review."rightSourceRef"
      OR jsonb_typeof(review."coverage") IS DISTINCT FROM 'array' OR jsonb_typeof(review."frozenSources") IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION '已确认履约排除来源不完整' USING ERRCODE='23514';
    END IF;
    SELECT count(*), jsonb_agg(d) -> 0 INTO n, review_document FROM jsonb_array_elements(review."frozenSources") d WHERE d ->> 'ref' = 'contract:' || c."id";
    IF n IS DISTINCT FROM 1 OR review_document ->> 'version' IS DISTINCT FROM v."id" || ':' || v."documentContentRevision"::TEXT THEN
      RAISE EXCEPTION '履约排除必须来自唯一适用版本的冻结文书' USING ERRCODE='23514';
    END IF;
    review_sources := review_sources || jsonb_build_array(jsonb_build_object('reviewId',review."id",'revision',review."revision",
      'confirmedAt',to_char(review."confirmedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'leftSourceRef',review."leftSourceRef",'rightSourceRef',review."rightSourceRef",
      'frozenDocument',review_document,'coverage',review."coverage"));
    side := CASE WHEN review."leftSourceRef" = 'contract:' || c."id" THEN 'left' ELSE 'right' END;
    FOR coverage_row IN SELECT value FROM jsonb_array_elements(review."coverage") LOOP
      IF jsonb_typeof(coverage_row) IS DISTINCT FROM 'object' OR NOT COALESCE(coverage_row ->> 'owner' IN ('left','right'),FALSE) THEN
        RAISE EXCEPTION '已确认覆盖分项缺少真实归属' USING ERRCODE='23514';
      END IF;
      IF coverage_row -> 'numericProtocolVersion' = '2'::JSONB THEN
        IF coverage_row -> 'leftAmountCents' IS DISTINCT FROM 'null'::JSONB OR coverage_row -> 'rightAmountCents' IS DISTINCT FROM 'null'::JSONB
          OR jsonb_typeof(coverage_row -> 'leftAmountYuan') IS DISTINCT FROM 'string' OR jsonb_typeof(coverage_row -> 'rightAmountYuan') IS DISTINCT FROM 'string'
          OR NOT COALESCE(coverage_row ->> 'leftAmountYuan' ~ '^(0|[1-9][0-9]{0,19})(\.[0-9]{1,4})?$',FALSE)
          OR NOT COALESCE(coverage_row ->> 'rightAmountYuan' ~ '^(0|[1-9][0-9]{0,19})(\.[0-9]{1,4})?$',FALSE) THEN
          RAISE EXCEPTION '履约覆盖四位金额协议不完整，不能按零或分补齐' USING ERRCODE='23514';
        END IF;
        left_yuan := (coverage_row ->> 'leftAmountYuan')::NUMERIC; right_yuan := (coverage_row ->> 'rightAmountYuan')::NUMERIC;
      ELSE
        IF (coverage_row ? 'numericProtocolVersion' AND coverage_row -> 'numericProtocolVersion' IS DISTINCT FROM '1'::JSONB)
          OR jsonb_typeof(coverage_row -> 'leftAmountCents') IS DISTINCT FROM 'string' OR jsonb_typeof(coverage_row -> 'rightAmountCents') IS DISTINCT FROM 'string'
          OR NOT COALESCE(coverage_row ->> 'leftAmountCents' ~ '^(0|[1-9][0-9]*)$',FALSE)
          OR NOT COALESCE(coverage_row ->> 'rightAmountCents' ~ '^(0|[1-9][0-9]*)$',FALSE) THEN
          RAISE EXCEPTION '旧履约覆盖必须保真实分金额，再精确除以一百' USING ERRCODE='23514';
        END IF;
        left_yuan := (coverage_row ->> 'leftAmountCents')::NUMERIC / 100; right_yuan := (coverage_row ->> 'rightAmountCents')::NUMERIC / 100;
      END IF;
      IF coverage_row ->> 'owner' IS DISTINCT FROM side THEN excluded_yuan := excluded_yuan + CASE WHEN side = 'left' THEN left_yuan ELSE right_yuan END; END IF;
    END LOOP;
  END LOOP;
  IF x #> '{money,economicReviewSources}' IS DISTINCT FROM review_sources
    OR jsonb_typeof(x #> '{money,economicExcludedYuan}') IS DISTINCT FROM 'string'
    OR CASE WHEN x #>> '{money,economicExcludedYuan}' ~ '^(0|[1-9][0-9]{0,19})(\.[0-9]{1,4})?$'
      THEN (x #>> '{money,economicExcludedYuan}')::NUMERIC IS DISTINCT FROM excluded_yuan ELSE TRUE END THEN
    RAISE EXCEPTION '归档经济排除须与真实已确认适用复核及四位总和一致' USING ERRCODE='23514';
  END IF;
  IF v."amountYuan" IS NOT NULL AND excluded_yuan > v."amountYuan" THEN RAISE EXCEPTION '已确认重叠范围超过合同金额，不能伪造承诺余额' USING ERRCODE='23514'; END IF;
  commitment_delta := CASE WHEN v."amountYuan" IS NULL THEN NULL ELSE v."amountYuan" - excluded_yuan END;
  IF CASE WHEN commitment_delta IS NULL THEN x #> '{money,commitmentDeltaYuan}' IS DISTINCT FROM 'null'::JSONB
      ELSE CASE WHEN jsonb_typeof(x #> '{money,commitmentDeltaYuan}') = 'string' AND x #>> '{money,commitmentDeltaYuan}' ~ '^-?(0|[1-9][0-9]{0,19})(\.[0-9]{1,4})?$'
        THEN (x #>> '{money,commitmentDeltaYuan}')::NUMERIC IS DISTINCT FROM commitment_delta ELSE TRUE END END
    OR x #>> '{money,direction}' IS DISTINCT FROM CASE WHEN commitment_delta IS NULL THEN 'notice' WHEN commitment_delta < 0 THEN 'decrease' ELSE 'increase' END THEN
    RAISE EXCEPTION '承诺净额及影响方向必须保原金额减真实排除，未知不补零' USING ERRCODE='23514';
  END IF;
  -- Joining-version history and current selected CompanyVersion are independent.
  SELECT "id", "projectId", "companyEntityId", "companyEntityVersionId", "effectiveFrom", "endedAt" INTO participant
    FROM public."ProjectParticipatingCompany" WHERE "id" = s #>> '{signingIdentity,company,projectParticipatingCompanyId}';
  IF participant."id" IS NULL OR participant."projectId" IS DISTINCT FROM c."projectId" OR participant."companyEntityId" IS DISTINCT FROM v."companyEntityIdSnapshot"
    OR (x #> '{subjects,participation}') IS DISTINCT FROM jsonb_build_object('id',participant."id",'companyEntityId',participant."companyEntityId",'companyEntityVersionId',participant."companyEntityVersionId",'effectiveFrom',participant."effectiveFrom")
    OR x #>> '{businessTime,businessDay}' IS DISTINCT FROM to_char((a."confirmedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD')
    OR participant."effectiveFrom" > (((a."confirmedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::DATE)
    OR (participant."endedAt" IS NOT NULL AND participant."endedAt" <= (((a."confirmedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::DATE)) THEN
    RAISE EXCEPTION '归档须分别保留真实加入版本与当前签约版本及北京日参与资格' USING ERRCODE='23514';
  END IF;
  IF jsonb_typeof(s -> 'files') IS DISTINCT FROM 'array' OR jsonb_array_length(s -> 'files') IS DISTINCT FROM 2 THEN RAISE EXCEPTION '当前Word/PDF双格式引用缺失' USING ERRCODE = '23514'; END IF;
  SELECT jsonb_agg(f) -> 0, count(*) INTO word_ref, n FROM jsonb_array_elements(s -> 'files') f WHERE f ->> 'mimeType' = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  IF n IS DISTINCT FROM 1 THEN RAISE EXCEPTION '当前Word引用必须唯一' USING ERRCODE = '23514'; END IF;
  SELECT jsonb_agg(f) -> 0, count(*) INTO pdf_ref, n FROM jsonb_array_elements(s -> 'files') f WHERE f ->> 'mimeType' = 'application/pdf';
  IF n IS DISTINCT FROM 1 OR word_ref ->> 'fileId' IS NOT DISTINCT FROM pdf_ref ->> 'fileId'
    OR (x #> '{versionEvidence,generatedDocumentFiles,word}') IS DISTINCT FROM word_ref OR (x #> '{versionEvidence,generatedDocumentFiles,pdf}') IS DISTINCT FROM pdf_ref THEN
    RAISE EXCEPTION '独立依据不可丢失或拼接当前Word/PDF双引用' USING ERRCODE = '23514';
  END IF;
  IF (x -> 'fileManifest') IS DISTINCT FROM l OR e ->> 'sourceBasisSha256' IS DISTINCT FROM encode(public.digest(convert_to(x::TEXT,'UTF8'),'sha256'),'hex')
    OR e ->> 'fileManifestSha256' IS DISTINCT FROM encode(public.digest(convert_to(l::TEXT,'UTF8'),'sha256'),'hex')
    OR a."fileManifestSha256" IS DISTINCT FROM e ->> 'fileManifestSha256'
    OR a."authoritySha256" IS DISTINCT FROM encode(public.digest(convert_to(e::TEXT,'UTF8'),'sha256'),'hex') THEN
    RAISE EXCEPTION '独立依据或归档摘要不一致' USING ERRCODE = '23514';
  END IF;
  SELECT count(*), jsonb_agg(jsonb_build_object('fileId', q."fileId", 'displayOrder', q."displayOrder", 'mimeType', q."mimeType", 'sizeBytes', q."sizeBytes", 'contentSha256', q."contentSha256") ORDER BY q."displayOrder") INTO n, actual FROM public."ContractArchiveEvidenceFile" q WHERE q."archiveFileId" = a."id" AND q."contractVersionId" = v."id";
  IF n = 0 OR actual IS DISTINCT FROM l OR EXISTS (SELECT 1 FROM public."ContractArchiveEvidenceFile" q LEFT JOIN public."FileObject" f ON f."id" = q."fileId" WHERE q."archiveFileId" = a."id" AND (f."id" IS NULL OR f."storageStatus" IS DISTINCT FROM 'active' OR f."supersedesFileObjectId" IS NOT NULL OR f."mimeType" IS DISTINCT FROM q."mimeType" OR f."sizeBytes" IS DISTINCT FROM q."sizeBytes" OR f."contentSha256" IS DISTINCT FROM q."contentSha256"))
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(l) WITH ORDINALITY v(item, seq) WHERE (item ->> 'displayOrder') IS DISTINCT FROM (seq - 1)::TEXT) THEN
    RAISE EXCEPTION '归档原件必须非空、连续有序且与冻结全集合等值' USING ERRCODE = '23514';
  END IF;
END;
$manifest$;
REVOKE ALL ON FUNCTION public.jg_assert_contract_archive_v2_manifest(TEXT) FROM PUBLIC;

CREATE FUNCTION public.jg_contract_archive_v2_complete_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $complete$
DECLARE aid TEXT; a RECORD; v RECORD; e JSONB; expected JSONB; f RECORD; impact RECORD;
BEGIN
  IF TG_TABLE_NAME = 'ContractArchiveFile' THEN
    IF NEW."archiveProtocolVersion" <> 2 THEN RETURN NEW; END IF;
    aid := NEW."id";
  ELSE aid := NEW."archiveFileId"; END IF;
  PERFORM public.jg_assert_contract_archive_v2_manifest(aid);
  SELECT "contractVersionId", "confirmedAt", "confirmedByUserId", "uploadedByUserId", "authoritySnapshot", "authoritySha256" INTO a FROM public."ContractArchiveFile" WHERE "id" = aid;
  SELECT "status", "effectiveAt", "taxFactsFrozenAt" INTO v FROM public."ContractVersion" WHERE "id" = a."contractVersionId";
  IF v."status" IS DISTINCT FROM 'effective' OR v."effectiveAt" IS DISTINCT FROM a."confirmedAt" OR v."taxFactsFrozenAt" IS DISTINCT FROM a."confirmedAt" THEN
    RAISE EXCEPTION '归档与真实版本生效、税事实冻结必须同事务完成' USING ERRCODE = '23514';
  END IF;
  e := a."authoritySnapshot"; expected := e #> '{operatingConsequence,expectedSource}';
  IF e #>> '{operatingConsequence,mode}' = 'not_applicable' THEN RETURN NEW; END IF;
  IF e #>> '{operatingConsequence,mode}' IS DISTINCT FROM 'projection_required' THEN RAISE EXCEPTION '归档经营后果未明确' USING ERRCODE = '23514'; END IF;
  SELECT "id", "projectId", "sourceType", "sourceBusinessId", "sourceVersion", "entryKind", "idempotencyKey", "numericProtocolVersion", "amountCents", "amountYuan", "sourceSnapshot", "confirmedByUserId", "confirmedAt", "occurredAt", "status", "debtorSubjectKind", "debtorSubjectId" INTO f FROM public."OperatingFact" WHERE "idempotencyKey" = 'contract_version:' || a."contractVersionId";
  SELECT "id", "factId", "projectId", "sourceType", "sourceBusinessId", "sourceImpactKey", "idempotencyKey", "impactKind", "numericProtocolVersion", "amountCents", "amountYuan", "direction", "subjectRole", "subjectKind", "subjectId" INTO impact FROM public."OperatingImpactEntry" WHERE "idempotencyKey" = 'contract_version:' || a."contractVersionId" || ':commitment';
  IF f."id" IS NULL OR impact."id" IS NULL OR impact."factId" IS DISTINCT FROM f."id" OR f."projectId" IS DISTINCT FROM e ->> 'projectId'
    OR f."sourceType" IS DISTINCT FROM 'contract_version' OR f."sourceBusinessId" IS DISTINCT FROM a."contractVersionId" OR f."entryKind" IS DISTINCT FROM 'original'
    OR f."sourceVersion"::TEXT IS DISTINCT FROM e #>> '{sourceBasis,sourceLocator,sourceVersion}'
    OR f."debtorSubjectKind" IS DISTINCT FROM 'participating_company'
    OR f."debtorSubjectId" IS DISTINCT FROM e #>> '{sourceBasis,subjects,signingIdentity,company,companyEntityId}'
    OR impact."subjectRole" IS DISTINCT FROM 'debtor' OR impact."subjectKind" IS DISTINCT FROM f."debtorSubjectKind" OR impact."subjectId" IS DISTINCT FROM f."debtorSubjectId"
    OR f."status" IS DISTINCT FROM 'confirmed'  OR f."numericProtocolVersion" IS DISTINCT FROM 2 OR f."amountCents" IS NOT NULL
    OR f."sourceSnapshot" ->> 'archiveAuthorityId' IS DISTINCT FROM aid OR f."sourceSnapshot" ->> 'archiveAuthoritySha256' IS DISTINCT FROM a."authoritySha256"
    OR f."sourceSnapshot" ->> 'sourceBasisSha256' IS DISTINCT FROM e ->> 'sourceBasisSha256' OR f."sourceSnapshot" -> 'sourceBasis' IS DISTINCT FROM e -> 'sourceBasis'
    OR impact."projectId" IS DISTINCT FROM f."projectId" OR impact."sourceType" IS DISTINCT FROM f."sourceType" OR impact."sourceBusinessId" IS DISTINCT FROM f."sourceBusinessId"
    OR impact."sourceImpactKey" IS DISTINCT FROM 'contract_commitment_reference' OR impact."impactKind" IS DISTINCT FROM 'contract_commitment_reference'
    OR impact."numericProtocolVersion" IS DISTINCT FROM 2 OR impact."amountCents" IS NOT NULL OR impact."amountYuan" IS DISTINCT FROM f."amountYuan"
    OR expected ->> 'sourceType' IS DISTINCT FROM 'contract_version' OR expected ->> 'sourceBusinessId' IS DISTINCT FROM a."contractVersionId" OR expected ->> 'entryKind' IS DISTINCT FROM 'original'
    OR expected ->> 'factIdempotencyKey' IS DISTINCT FROM f."idempotencyKey" OR expected ->> 'impactIdempotencyKey' IS DISTINCT FROM impact."idempotencyKey"
    OR expected ->> 'sourceVersion' IS DISTINCT FROM f."sourceVersion"::TEXT
    OR expected ->> 'numericProtocolVersion' IS DISTINCT FROM '2'
    OR expected ->> 'sourceImpactKey' IS DISTINCT FROM impact."sourceImpactKey" OR expected ->> 'impactKind' IS DISTINCT FROM impact."impactKind"
    OR expected ->> 'amountState' IS DISTINCT FROM CASE WHEN f."amountYuan" IS NULL THEN 'unknown' ELSE 'known' END
    OR expected ->> 'direction' IS DISTINCT FROM impact."direction" OR impact."direction" IS DISTINCT FROM e #>> '{sourceBasis,money,direction}'
    OR f."confirmedByUserId" IS DISTINCT FROM a."confirmedByUserId" OR f."confirmedAt" IS DISTINCT FROM a."confirmedAt" OR f."occurredAt" IS DISTINCT FROM a."confirmedAt"
    OR CASE WHEN e #> '{sourceBasis,money,commitmentDeltaYuan}' = 'null'::JSONB THEN f."amountYuan" IS NOT NULL
      WHEN (e #>> '{sourceBasis,money,commitmentDeltaYuan}') ~ '^-?(0|[1-9][0-9]{0,19})(\.[0-9]{1,4})?$' THEN f."amountYuan" IS DISTINCT FROM abs((e #>> '{sourceBasis,money,commitmentDeltaYuan}')::NUMERIC)
      ELSE TRUE END
    OR expected ->> 'sourceBasisSha256' IS DISTINCT FROM e ->> 'sourceBasisSha256'
    OR (expected -> 'amountYuan') IS DISTINCT FROM CASE WHEN f."amountYuan" IS NULL THEN 'null'::JSONB ELSE to_jsonb(f."amountYuan"::TEXT) END THEN
    RAISE EXCEPTION '已启用经营的归档缺少冻结预期的真实Fact/Impact' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$complete$;
REVOKE ALL ON FUNCTION public.jg_contract_archive_v2_complete_guard() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER "ContractArchiveFile_v2_complete" AFTER INSERT ON public."ContractArchiveFile" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.jg_contract_archive_v2_complete_guard();
CREATE CONSTRAINT TRIGGER "ContractArchiveEvidenceFile_v2_complete" AFTER INSERT ON public."ContractArchiveEvidenceFile" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.jg_contract_archive_v2_complete_guard();

-- Preserve the ACTUAL old registry contract, including owner/grant option. A
-- non-default grantor or configuration needs a separately qualified preserve plan.
-- No new helper/Evidence permissions are inferred from this old contract.
DO $registry$
DECLARE old_oid OID; owner_oid OID; owner_name TEXT; installer_name TEXT := current_user; old_acl ACLITEM[]; old_src TEXT; acl RECORD; old_security BOOLEAN; old_config TEXT[];
BEGIN
  old_oid := to_regprocedure('public.jg_file_business_binding_columns()');
  IF old_oid IS NULL OR to_regprocedure('public.jg_file_business_binding_columns_before_contract_archive_v2()') IS NOT NULL THEN RAISE EXCEPTION '归档文件registry前像不明确'; END IF;
  SELECT p.proowner, p.proacl, p.prosrc, p.prosecdef, p.proconfig INTO owner_oid, old_acl, old_src, old_security, old_config FROM pg_proc p WHERE p.oid = old_oid;
  IF old_security OR old_config IS NOT NULL OR regexp_replace(btrim(old_src), '\s+', ' ', 'g') IS DISTINCT FROM $$SELECT * FROM jg_file_business_binding_columns_before_company_transfer() UNION ALL VALUES ('CompanyTransfer','evidenceFileId',FALSE);$$ THEN
    RAISE EXCEPTION 'registry最终203定义已漂移，拒绝猜测覆盖';
  END IF;
  IF EXISTS (SELECT 1 FROM aclexplode(COALESCE(old_acl, acldefault('f',owner_oid))) WHERE grantor <> owner_oid) THEN
    RAISE EXCEPTION 'registry第三方grantor需独立精确保留方案，当前拒绝';
  END IF;
  SELECT rolname INTO owner_name FROM pg_roles WHERE oid = owner_oid;
  IF owner_name IS NULL OR NOT pg_has_role(session_user, owner_oid, 'MEMBER') THEN RAISE EXCEPTION '安装身份不足以原子保留registry owner/ACL'; END IF;
  ALTER FUNCTION public.jg_file_business_binding_columns() RENAME TO jg_file_business_binding_columns_before_contract_archive_v2;
  EXECUTE format('SET LOCAL ROLE %I', owner_name);
  EXECUTE $new_registry$CREATE FUNCTION public.jg_file_business_binding_columns() RETURNS TABLE("tableName" TEXT,"columnName" TEXT,"exclusive" BOOLEAN) LANGUAGE sql STABLE PARALLEL SAFE AS $body$ SELECT * FROM public.jg_file_business_binding_columns_before_contract_archive_v2() UNION ALL VALUES ('ContractArchiveEvidenceFile','fileId',TRUE); $body$$new_registry$;
  -- Clear every actual new-object default ACL before exact old-contract restore;
  -- creator ALTER DEFAULT PRIVILEGES must not leak additional grantees.
  FOR acl IN SELECT grantee FROM aclexplode(COALESCE((SELECT proacl FROM pg_proc WHERE oid=to_regprocedure('public.jg_file_business_binding_columns()')), acldefault('f',owner_oid))) LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.jg_file_business_binding_columns() FROM %s', CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE quote_ident((SELECT rolname FROM pg_roles WHERE oid=acl.grantee)) END);
  END LOOP;
  FOR acl IN SELECT grantee, is_grantable FROM aclexplode(COALESCE(old_acl, acldefault('f',owner_oid))) WHERE privilege_type = 'EXECUTE' LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.jg_file_business_binding_columns() TO %s%s', CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE quote_ident((SELECT rolname FROM pg_roles WHERE oid=acl.grantee)) END, CASE WHEN acl.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
  IF (SELECT proowner FROM pg_proc WHERE oid=to_regprocedure('public.jg_file_business_binding_columns()')) IS DISTINCT FROM owner_oid
    OR (SELECT proacl FROM pg_proc WHERE oid=old_oid) IS DISTINCT FROM old_acl
    OR EXISTS ((SELECT grantor,grantee,privilege_type,is_grantable FROM aclexplode(COALESCE(old_acl,acldefault('f',owner_oid)))) EXCEPT (SELECT grantor,grantee,privilege_type,is_grantable FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid=to_regprocedure('public.jg_file_business_binding_columns()'))))) THEN
    RAISE EXCEPTION 'registry owner/ACL原子保留不一致';
  END IF;
  IF EXISTS ((SELECT grantor,grantee,privilege_type,is_grantable FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid=to_regprocedure('public.jg_file_business_binding_columns()')))) EXCEPT (SELECT grantor,grantee,privilege_type,is_grantable FROM aclexplode(COALESCE(old_acl,acldefault('f',owner_oid))))) THEN
    RAISE EXCEPTION 'registry默认权限造成额外caller，拒绝扩大旧契约';
  END IF;
  EXECUTE format('SET LOCAL ROLE %I', installer_name);
END;
$registry$;
CREATE TRIGGER "jg_efb_contract_archive_v2_evidence" BEFORE INSERT OR UPDATE OF "fileId" ON public."ContractArchiveEvidenceFile" FOR EACH ROW EXECUTE FUNCTION public.jg_enforce_exclusive_file_business_binding('fileId','true');

-- Connect only a PERSISTENT archiveProtocol2 source. No blanket numeric2 cutover:
-- absence of a new authority preserves legitimate old source checks. Caller-only
-- authority markers never authorize the new branch.
DO $source_guard$
DECLARE definition TEXT; anchor TEXT; prefix TEXT; declarations TEXT;
BEGIN
  SELECT pg_get_functiondef('public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayloadV2",text,text)'::regprocedure) INTO definition;
  declarations := '  v_review public."ContractEconomicReview"%ROWTYPE;';
  IF (length(definition)-length(replace(definition,declarations,'')))/length(declarations) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'V2 Fact源声明漂移'; END IF;
  definition := replace(definition,declarations,declarations || E'\n  v_archive RECORD;');
  anchor := '  -- Validate the unbounded NUMERIC payload before the NUMERIC(24,4) column can round it.';
  IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'V2 Fact源前置guard漂移'; END IF;
  prefix := $prefix$
  IF p_payload."sourceType" = 'contract_version' THEN
    SELECT a."id", a."authoritySnapshot", a."authoritySha256" INTO v_archive FROM public."ContractArchiveFile" a WHERE a."contractVersionId" = p_payload."sourceBusinessId" AND a."archiveProtocolVersion" = 2;
    IF FOUND THEN
      PERFORM public.jg_assert_contract_archive_v2_manifest(v_archive."id");
      IF p_payload."numericProtocolVersion" IS DISTINCT FROM 2 OR p_payload."projectId" IS DISTINCT FROM v_archive."authoritySnapshot" ->> 'projectId'
        OR p_payload."sourceVersion"::TEXT IS DISTINCT FROM v_archive."authoritySnapshot" #>> '{sourceBasis,sourceLocator,sourceVersion}'
        OR p_payload."debtorSubjectKind" IS DISTINCT FROM 'participating_company'
        OR p_payload."debtorSubjectId" IS DISTINCT FROM v_archive."authoritySnapshot" #>> '{sourceBasis,subjects,signingIdentity,company,companyEntityId}'
        OR p_payload."sourceSnapshot" ->> 'companyEntityIdSnapshot' IS DISTINCT FROM p_payload."debtorSubjectId"
        OR p_payload."sourceSnapshot" ->> 'companyEntityVersionId' IS DISTINCT FROM v_archive."authoritySnapshot" #>> '{sourceBasis,subjects,signingIdentity,company,id}'
        OR p_payload."entryKind" IS DISTINCT FROM 'original' OR p_payload."factKind" IS DISTINCT FROM 'downstream_contract'
        OR p_payload."confirmedByUserId" IS DISTINCT FROM v_archive."authoritySnapshot" ->> 'handlerUserId'
        OR p_payload."confirmedAt" IS DISTINCT FROM (v_archive."authoritySnapshot" ->> 'archivedAt')::TIMESTAMPTZ
        OR p_payload."occurredAt" IS DISTINCT FROM (v_archive."authoritySnapshot" ->> 'archivedAt')::TIMESTAMPTZ
        OR CASE WHEN v_archive."authoritySnapshot" #> '{sourceBasis,money,commitmentDeltaYuan}' = 'null'::JSONB THEN p_payload."amountYuan" IS NOT NULL
          WHEN (v_archive."authoritySnapshot" #>> '{sourceBasis,money,commitmentDeltaYuan}') ~ '^-?(0|[1-9][0-9]{0,19})(\.[0-9]{1,4})?$' THEN p_payload."amountYuan" IS DISTINCT FROM abs((v_archive."authoritySnapshot" #>> '{sourceBasis,money,commitmentDeltaYuan}')::NUMERIC)
          ELSE TRUE END
        OR p_payload."idempotencyKey" IS DISTINCT FROM 'contract_version:' || p_payload."sourceBusinessId"
        OR p_payload."sourceSnapshot" ->> 'archiveAuthorityId' IS DISTINCT FROM v_archive."id"
        OR p_payload."sourceSnapshot" ->> 'archiveAuthoritySha256' IS DISTINCT FROM v_archive."authoritySha256"
        OR p_payload."sourceSnapshot" ->> 'sourceBasisSha256' IS DISTINCT FROM v_archive."authoritySnapshot" ->> 'sourceBasisSha256'
        OR p_payload."sourceSnapshot" -> 'sourceBasis' IS DISTINCT FROM v_archive."authoritySnapshot" -> 'sourceBasis'
        OR NOT COALESCE((v_archive."authoritySnapshot" #>> '{operatingConsequence,mode}') IN ('projection_required','not_applicable'), FALSE) THEN
        RAISE EXCEPTION '经营来源必须绑定真实归档A/B及自然身份' USING ERRCODE='23514';
      END IF;
    ELSIF p_payload."sourceSnapshot" ? 'archiveAuthorityId' OR p_payload."sourceSnapshot" ? 'archiveAuthoritySha256' OR p_payload."sourceSnapshot" ? 'sourceBasisSha256' THEN
      RAISE EXCEPTION '客户端来源标记不能代替持久归档权威' USING ERRCODE='23514';
    END IF;
  END IF;
$prefix$;
  EXECUTE replace(definition,anchor,prefix || E'\n' || anchor);
END;
$source_guard$;

-- New-A business-day projection only. Original fact/review instants are never
-- overwritten; non-ArchiveProtocol2 returns NULL to preserve the old fallback.
CREATE FUNCTION public.jg_contract_archive_v2_ownership_day(p_contract_version_id TEXT) RETURNS DATE
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $archive_day$
DECLARE a RECORD; result DATE;
BEGIN
  IF p_contract_version_id IS NULL THEN RETURN NULL; END IF;
  SELECT "id", "confirmedAt", "authoritySnapshot" INTO a FROM public."ContractArchiveFile" WHERE "contractVersionId"=p_contract_version_id AND "archiveProtocolVersion"=2;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM public.jg_assert_contract_archive_v2_manifest(a."id");
  result := ((a."confirmedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::DATE;
  IF result IS NULL OR a."authoritySnapshot" #>> '{sourceBasis,businessTime,businessDay}' IS DISTINCT FROM result::TEXT THEN RAISE EXCEPTION '新归档期间日必须来自真实归档时刻' USING ERRCODE='23514'; END IF;
  RETURN result;
END;
$archive_day$;
REVOKE ALL ON FUNCTION public.jg_contract_archive_v2_ownership_day(TEXT) FROM PUBLIC;

CREATE FUNCTION public.jg_contract_review_archive_v2_ownership_day(p_fact public."OperatingFact") RETURNS DATE
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,public AS $review_archive_day$
DECLARE original RECORD; a RECORD;
BEGIN
  IF p_fact."numericProtocolVersion" IS DISTINCT FROM 2 OR p_fact."sourceType" IS DISTINCT FROM 'contract_economic_review' THEN RETURN NULL; END IF;
  -- This call executes ALL unchanged203 source/baseline/amount/subject checks
  -- before any new day can be returned, even when COALESCE skips its fallback.
  PERFORM public.jg_contract_economic_review_ownership_date(p_fact);
  SELECT "id", "projectId", "sourceType", "sourceBusinessId", "numericProtocolVersion", "sourceSnapshot", "occurredAt" INTO original FROM public."OperatingFact" WHERE "id"=p_fact."sourceSnapshot" #>> '{baseline,originalOperatingFactId}';
  IF original."sourceType" IS DISTINCT FROM 'contract_version' THEN RETURN NULL; END IF;
  SELECT "id", "confirmedAt", "authoritySnapshot", "authoritySha256" INTO a FROM public."ContractArchiveFile" WHERE "contractVersionId"=original."sourceBusinessId" AND "archiveProtocolVersion"=2;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF original."projectId" IS DISTINCT FROM p_fact."projectId" OR original."numericProtocolVersion" IS DISTINCT FROM 2
    OR original."sourceSnapshot" ->> 'archiveAuthorityId' IS DISTINCT FROM a."id"
    OR original."sourceSnapshot" ->> 'archiveAuthoritySha256' IS DISTINCT FROM a."authoritySha256"
    OR original."sourceSnapshot" ->> 'sourceBasisSha256' IS DISTINCT FROM a."authoritySnapshot" ->> 'sourceBasisSha256'
    OR original."sourceSnapshot" -> 'sourceBasis' IS DISTINCT FROM a."authoritySnapshot" -> 'sourceBasis'
    OR original."occurredAt" IS DISTINCT FROM a."confirmedAt" THEN RAISE EXCEPTION '复核原Fact必须真实绑定新归档源，不能自报期间日' USING ERRCODE='23514'; END IF;
  RETURN public.jg_contract_archive_v2_ownership_day(original."sourceBusinessId");
END;
$review_archive_day$;
REVOKE ALL ON FUNCTION public.jg_contract_review_archive_v2_ownership_day(public."OperatingFact") FROM PUBLIC;

DO $archive_periods$
DECLARE definition TEXT; anchor TEXT; replacement TEXT;
BEGIN
  SELECT pg_get_functiondef('public."requireActiveProjectParticipatingCompany"()'::regprocedure) INTO definition;
  -- POL284 assigns candidate_fact_date again after the table dispatch. Replace
  -- that final ContractVersion assignment, not the earlier company-id branch.
  anchor := E'  IF TG_TABLE_NAME = ''ContractVersion'' THEN\n    candidate_fact_date := COALESCE(NEW."effectiveAt", NEW."createdAt")::DATE;\n  END IF;';
  IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'CV参与期间最终赋值定义已漂移'; END IF;
  replacement := E'  IF TG_TABLE_NAME = ''ContractVersion'' THEN\n    candidate_fact_date := COALESCE(public.jg_contract_archive_v2_ownership_day(NEW."id"), COALESCE(NEW."effectiveAt", NEW."createdAt")::DATE);\n  END IF;';
  EXECUTE replace(definition,anchor,replacement);

  SELECT pg_get_functiondef('public."validateOperatingFactReferences"()'::regprocedure) INTO definition;
  anchor := 'COALESCE(public.jg_contract_economic_review_ownership_date(NEW::public."OperatingFact"), public.jg_company_repayment_ownership_date(NEW."sourceType", NEW."sourceBusinessId", NEW."projectId"), NEW."occurredAt")::DATE';
  IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor) IS DISTINCT FROM 6 THEN RAISE EXCEPTION '新归档Fact六期间锚点漂移'; END IF;
  replacement := 'COALESCE(public.jg_contract_review_archive_v2_ownership_day(NEW::public."OperatingFact"), public.jg_contract_archive_v2_ownership_day(CASE WHEN NEW."sourceType" = ''contract_version'' THEN NEW."sourceBusinessId" ELSE NULL END), ' || anchor || ')';
  definition := replace(definition,anchor,replacement);
  -- Ownership periods use the original archive day; this flag instead uses
  -- THIS fact/review's real business instant. Never move a review's occurrence.
  anchor := 'NEW."occurredAt"::DATE < project_effective_date';
  IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor) IS DISTINCT FROM 1 THEN RAISE EXCEPTION '经营生效前标记最终日期锚点漂移'; END IF;
  replacement := $before_day$
CASE WHEN public.jg_contract_review_archive_v2_ownership_day(NEW::public."OperatingFact") IS NOT NULL
  OR public.jg_contract_archive_v2_ownership_day(CASE WHEN NEW."sourceType" = 'contract_version' THEN NEW."sourceBusinessId" ELSE NULL END) IS NOT NULL
THEN ((NEW."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::DATE
ELSE NEW."occurredAt"::DATE END < project_effective_date
$before_day$;
  EXECUTE replace(definition,anchor,replacement);

  SELECT pg_get_functiondef('public."validateOperatingImpactEntryReferences"()'::regprocedure) INTO definition;
  anchor := '  fact_occurred_at TIMESTAMP(3);';
  IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Impact真实时刻声明漂移'; END IF;
  definition := replace(definition,anchor,anchor || E'\n  fact_new_archive_day DATE;');
  anchor := '  IF fact_evidence_level = ''C'' AND NEW."impactKind" <> ''evidence_gap_notice'' THEN';
  IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Impact独立期间投影插入锚点漂移'; END IF;
  replacement := $impact_day_select$
  SELECT COALESCE(public.jg_contract_review_archive_v2_ownership_day(fact), public.jg_contract_archive_v2_ownership_day(CASE WHEN fact."sourceType"='contract_version' THEN fact."sourceBusinessId" ELSE NULL END)) INTO fact_new_archive_day FROM public."OperatingFact" fact WHERE fact."id"=NEW."factId" AND fact."projectId"=NEW."projectId" AND fact."sourceType"=NEW."sourceType" AND fact."sourceBusinessId"=NEW."sourceBusinessId";
$impact_day_select$;
  definition := replace(definition,anchor,replacement || anchor);
  anchor := 'fact_occurred_at::DATE';
  IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor) IS DISTINCT FROM 4 THEN RAISE EXCEPTION 'Impact四期间使用已漂移'; END IF;
  -- Keep the original one SELECT ownership instant and all original timestamps.
  EXECUTE replace(definition,anchor,'COALESCE(fact_new_archive_day, fact_occurred_at::DATE)');
  -- Protect the same immutable new-A Beijing day when participation is later
  -- ended. Keep the original fence/coverage and complete legacy UTC OR chain.
  SELECT pg_get_functiondef('public."protectProjectParticipatingCompanyEndDate"()'::regprocedure) INTO definition;
  anchor := E'    ELSIF EXISTS (\n      SELECT 1 FROM "Contract" contract';
  IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor) IS DISTINCT FROM 1 THEN RAISE EXCEPTION '参与停止历史保护最终锚点漂移'; END IF;
  replacement := $end_archive$
    ELSIF EXISTS (
      SELECT 1 FROM public."ContractArchiveFile" archive_row
      JOIN public."ContractVersion" archive_version ON archive_version."id" = archive_row."contractVersionId"
      JOIN public."Contract" archive_contract ON archive_contract."id" = archive_version."contractId"
      WHERE archive_row."archiveProtocolVersion" = 2 AND archive_row."status" = 'confirmed'
        AND archive_contract."projectId" = OLD."projectId"
        AND archive_version."numericProtocolVersion" = 2 AND archive_version."signingSubjectType" = 'our_company'
        AND archive_version."companyEntityIdSnapshot" = OLD."companyEntityId"
        AND archive_row."authoritySnapshot" #>> '{sourceBasis,subjects,participation,id}' = OLD."id"
        AND archive_row."authoritySnapshot" #>> '{sourceBasis,subjects,participation,companyEntityId}' = OLD."companyEntityId"
        AND archive_row."authoritySnapshot" #>> '{sourceBasis,subjects,participation,companyEntityVersionId}' = OLD."companyEntityVersionId"
        AND archive_row."authoritySnapshot" #>> '{sourceBasis,subjects,signingIdentity,company,projectParticipatingCompanyId}' = OLD."id"
        AND CASE WHEN archive_row."confirmedAt" IS NOT NULL
          AND ((archive_row."confirmedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::DATE >= NEW."endedAt"
        THEN public.jg_contract_archive_v2_ownership_day(archive_version."id") >= NEW."endedAt"
        ELSE FALSE END
    ) OR EXISTS (
      SELECT 1 FROM "Contract" contract
$end_archive$;
  EXECUTE replace(definition,anchor,replacement);
END;
$archive_periods$;

-- Installation cannot silently infer a production application role or grant it
-- new helper/table rights. A separately authorized exact ACL qualification must
-- supply this real application OID and make both invoker call paths callable.
DO $callability$
DECLARE app_oid OID; sd_owner OID; caller_roles OID[]; participant_roles OID[] := '{}'::OID[]; participant_role OID; review_roles OID[]; helper_oid OID; role_oid OID; relation_oid OID; item JSONB; col TEXT; col_num SMALLINT; file_oid OID; fn TEXT; file_callers JSONB;
  common_reads JSONB := '[
    {"table":"ContractArchiveFile","columns":["id","contractVersionId","fileId","uploadedByUserId","confirmedByUserId","confirmedAt","status","archiveProtocolVersion","archiveSource","approvalInstanceId","sealTaskId","idempotencyKey","requestSha256","sourceRevision","documentContentRevision","documentContentFingerprint","authoritySnapshot","authoritySha256","fileManifestSha256","responseSnapshot"]},
    {"table":"ContractArchiveEvidenceFile","columns":["id","archiveFileId","contractVersionId","fileId","displayOrder","mimeType","sizeBytes","contentSha256"]},
    {"table":"ContractVersion","columns":["id","contractId","versionNo","changeType","numericProtocolVersion","signingSubjectType","documentContentRevision","documentContentFingerprint","companyEntityIdSnapshot","companyEntityVersionId","companyEntityNameSnapshot","companyEntityCreditCodeSnapshot","companyEntityRegisteredAddressSnapshot","amountYuan","amountLimitType","pricingNature","amountSource"]},
    {"table":"Contract","columns":["id","projectId","ownerUserId","voidedAt","code"]},
    {"table":"ContractEconomicReview","columns":["id","projectId","status","confirmedAt","leftSourceRef","rightSourceRef","revision","coverage","frozenSources"]},
    {"table":"ApprovalInstance","columns":["id","businessId","businessType","flowType","status","applicantUserId","frozenNodes"]},
    {"table":"ContractSealTask","columns":["id","contractVersionId","approvalInstanceId","handlerUserId","status","completedByUserId","completedAt"]},
    {"table":"OperatingFact","columns":["id","projectId","sourceType","sourceBusinessId","numericProtocolVersion","sourceSnapshot","occurredAt"]},
    {"table":"ProjectParticipatingCompany","columns":["id","projectId","companyEntityId","companyEntityVersionId","effectiveFrom","endedAt"]},
    {"table":"FileObject","columns":["id","mimeType","sizeBytes","contentSha256","storageStatus","supersedesFileObjectId"]}
  ]'::JSONB;
  app_reads JSONB := '[
    {"table":"Project","columns":["id","isActive","operatingLedgerEffectiveDate"]},
    {"table":"User","columns":["id","isActive"]},
    {"table":"ContractVersion","columns":["status","effectiveAt","taxFactsFrozenAt"]},
    {"table":"OperatingFact","columns":["id","projectId","sourceType","sourceBusinessId","sourceVersion","entryKind","idempotencyKey","numericProtocolVersion","amountCents","amountYuan","sourceSnapshot","confirmedByUserId","confirmedAt","occurredAt","status","debtorSubjectKind","debtorSubjectId"]},
    {"table":"OperatingImpactEntry","columns":["id","factId","projectId","sourceType","sourceBusinessId","sourceImpactKey","idempotencyKey","impactKind","numericProtocolVersion","amountCents","amountYuan","direction","subjectRole","subjectKind","subjectId"]}
  ]'::JSONB;
BEGIN
  app_oid := NULLIF(current_setting('app.contract_archive_v2_application_role_oid',true),'')::OID;
  helper_oid := to_regprocedure('public.jg_assert_contract_archive_v2_manifest(text)');
  SELECT proowner INTO sd_owner FROM pg_proc WHERE oid=to_regprocedure('public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayloadV2",text,text)');
  IF app_oid IS NULL OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE oid=app_oid) OR sd_owner IS NULL OR helper_oid IS NULL THEN RAISE EXCEPTION '真实归档应用角色或函数资格未提供，拒绝安装'; END IF;
  SELECT array_agg(DISTINCT owner_oid) INTO caller_roles FROM (
    SELECT app_oid AS owner_oid UNION ALL
    SELECT proowner FROM pg_proc WHERE oid IN (
      'public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayload",text,text)'::regprocedure,
      'public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayloadV2",text,text)'::regprocedure,
      'public."appendOperatingImpactThroughService"(public."OperatingLedgerImpactWritePayload",text,text)'::regprocedure,
      'public."appendOperatingImpactThroughService"(public."OperatingLedgerImpactWritePayloadV2",text,text)'::regprocedure)
  ) actual_write_callers;
  SELECT array_agg(DISTINCT proowner) INTO review_roles FROM pg_proc WHERE oid IN (
    'public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayload",text,text)'::regprocedure,
    'public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayloadV2",text,text)'::regprocedure,
    'public."appendOperatingImpactThroughService"(public."OperatingLedgerImpactWritePayload",text,text)'::regprocedure,
    'public."appendOperatingImpactThroughService"(public."OperatingLedgerImpactWritePayloadV2",text,text)'::regprocedure);
  -- UPDATE alone is not proof that a role could complete the old stop chain.
  -- Its first unconditional statement calls this explicit PUBLIC-revoked SD
  -- fence. Missing EXEC is sufficient exclusion; do not demand its internal
  -- Fence DML from the invoker. Unknown old search_path/SELECT remains admitted
  -- conservatively, never guessed impossible or exempted by a role's name.
  FOR participant_role IN SELECT oid FROM pg_roles
    WHERE has_column_privilege(oid,'public."ProjectParticipatingCompany"','endedAt','UPDATE')
  LOOP
    IF NOT has_function_privilege(participant_role,'public."serializeProjectParticipatingCompanyMutation"(text)','EXECUTE') THEN
      RAISE NOTICE '参与停止潜在UPDATE角色OID % 缺旧无条件serialize EXEC，非旧成功caller', participant_role;
      CONTINUE;
    END IF;
    RAISE NOTICE '参与停止UPDATE角色OID % 可执行旧serialize，旧解析或其它资格未知仍保守保留', participant_role;
    participant_roles := array_append(participant_roles, participant_role);
  END LOOP;
  caller_roles := ARRAY(SELECT DISTINCT candidate FROM unnest(caller_roles || participant_roles) candidate);
  FOREACH role_oid IN ARRAY caller_roles LOOP
    IF NOT has_function_privilege(role_oid,'public.jg_contract_archive_v2_ownership_day(text)','EXECUTE')
      OR NOT has_function_privilege(role_oid,'public.digest(bytea,text)','EXECUTE') THEN RAISE EXCEPTION '归档实际caller业务日或canonical摘要资格未证明'; END IF;
    IF role_oid=ANY(review_roles) AND (
      NOT has_function_privilege(role_oid,'public.jg_contract_review_archive_v2_ownership_day(public."OperatingFact")','EXECUTE')
      OR NOT has_function_privilege(role_oid,'public.jg_contract_economic_review_ownership_date(public."OperatingFact")','EXECUTE')) THEN
      RAISE EXCEPTION '原Fact/Impact实际SDowner复核日期wrapper资格未证明';
    END IF;
    IF NOT has_schema_privilege(role_oid,'public','USAGE') OR NOT has_function_privilege(role_oid,helper_oid,'EXECUTE') THEN RAISE EXCEPTION '归档helper有效caller资格不足'; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(common_reads || CASE WHEN role_oid=app_oid THEN app_reads ELSE '[]'::JSONB END) LOOP
      relation_oid := to_regclass(format('public.%I',item ->> 'table'));
      IF relation_oid IS NULL THEN RAISE EXCEPTION '归档资格关系不存在'; END IF;
      IF EXISTS(SELECT 1 FROM pg_class WHERE oid=relation_oid AND (relrowsecurity OR relforcerowsecurity)) THEN RAISE EXCEPTION '归档RLS可见性需独立精确资格，当前拒绝默认通过'; END IF;
      FOR col IN SELECT jsonb_array_elements_text(item -> 'columns') LOOP
        SELECT attnum INTO col_num FROM pg_attribute WHERE attrelid=relation_oid AND attname=col AND NOT attisdropped;
        IF col_num IS NULL OR NOT has_column_privilege(role_oid,relation_oid,col_num,'SELECT') THEN RAISE EXCEPTION '归档caller缺少已声明读取列资格'; END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  FOR col IN SELECT unnest(ARRAY['id','archiveFileId','contractVersionId','fileId','displayOrder','mimeType','sizeBytes','contentSha256']) LOOP
    IF NOT has_column_privilege(app_oid,'public."ContractArchiveEvidenceFile"',col,'INSERT') THEN RAISE EXCEPTION '新归档原件必要INSERT列资格未授权'; END IF;
  END LOOP;
  -- Original outer DML locks require SELECT plus at least one real UPDATE
  -- column on each explicitly locked relation; no UPDATE grant is added here.
  FOREACH col IN ARRAY ARRAY['Contract','ContractVersion','ApprovalInstance','ContractSealTask','Project','FileObject','CompanyEntity','ProjectParticipatingCompany'] LOOP
    relation_oid := to_regclass(format('public.%I',col));
    IF relation_oid IS NULL OR NOT has_any_column_privilege(app_oid,relation_oid,'UPDATE') THEN RAISE EXCEPTION '归档实际调用者缺少原显式锁资格'; END IF;
  END LOOP;
  -- Preserve the pre-existing SD owner Review/Fact locking access independently.
  FOREACH col IN ARRAY ARRAY['ContractEconomicReview','OperatingFact'] LOOP
    IF NOT has_any_column_privilege(sd_owner,to_regclass(format('public.%I',col)),'UPDATE') THEN RAISE EXCEPTION 'V2 SD owner原锁资格未证明'; END IF;
  END LOOP;
  file_callers := NULLIF(current_setting('app.contract_archive_v2_file_caller_oids',true),'')::JSONB;
  IF jsonb_typeof(file_callers) IS DISTINCT FROM 'array' OR jsonb_array_length(file_callers)=0 THEN RAISE EXCEPTION '旧文件链实际caller闭包未提供，拒绝假定'; END IF;
  FOR file_oid IN SELECT value::TEXT::OID FROM jsonb_array_elements(file_callers) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE oid=file_oid)
      OR NOT has_function_privilege(file_oid,'public.jg_file_business_binding_columns()','EXECUTE')
      OR NOT has_column_privilege(file_oid,'public."ContractArchiveEvidenceFile"','id','SELECT')
      OR NOT has_column_privilege(file_oid,'public."ContractArchiveEvidenceFile"','fileId','SELECT') THEN
      RAISE EXCEPTION '旧文件链新增原件owner读取资格不足';
    END IF;
    FOREACH fn IN ARRAY ARRAY['jg_file_business_binding_columns_before_affiliate_company_contract','jg_file_business_binding_columns_before_bank_verification','jg_file_business_binding_columns_before_company_transfer','jg_file_business_binding_columns_before_contract_archive_v2','jg_file_business_binding_columns_before_contract_proxy','jg_file_business_binding_columns_before_general_procurement','jg_file_business_binding_columns_before_operating_takeover','jg_file_business_binding_columns_before_payment_execution','jg_file_business_binding_columns_before_pol13b','jg_file_business_binding_columns_before_pol13b_attestation','jg_file_business_binding_columns_before_pol13b_payer_authority','jg_file_business_binding_columns_before_pol13d_fund_execution','jg_file_business_binding_columns_before_pol214_affiliate_clearing_authority','jg_file_business_binding_columns_before_pol260_invoice_evidence_repair','jg_file_business_binding_columns_before_pol279_necessary_expense_reserve','jg_file_business_binding_columns_before_pol280_project_fund_dispute','jg_file_business_binding_columns_before_project_expense_execution','jg_file_business_binding_columns_before_project_financing_quota_request','jg_file_business_binding_columns_before_upward_amount','jg_file_business_binding_columns_before_wage_statement'] LOOP
      IF to_regprocedure('public.' || fn || '()') IS NULL OR NOT has_function_privilege(file_oid,to_regprocedure('public.' || fn || '()'),'EXECUTE') THEN RAISE EXCEPTION '旧registry包装链有效调用资格不足'; END IF;
    END LOOP;
  END LOOP;
  -- Existing caller/lock/registry qualification still must be separately pinned;
  -- no default production role and no GRANT to new helpers/tables are invented.
END;
$callability$;
COMMIT;
