BEGIN;

ALTER TABLE public."ContractEconomicReview" ADD COLUMN "directSourcePins" JSONB;

CREATE TABLE public."ContractEconomicReviewFileReference" (
  "reviewId" TEXT NOT NULL REFERENCES public."ContractEconomicReview"("id") ON UPDATE RESTRICT ON DELETE RESTRICT,
  "sourceRef" TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL CHECK ("displayOrder" BETWEEN 0 AND 19),
  "sourceContractVersionId" TEXT NOT NULL,
  "directInputProtocolVersion" INTEGER NOT NULL CHECK ("directInputProtocolVersion" = 1),
  "sourceRevision" INTEGER NOT NULL CHECK ("sourceRevision" > 0),
  "inputSha256" TEXT NOT NULL CHECK ("inputSha256" ~ '^[a-f0-9]{64}$'),
  "fileId" TEXT NOT NULL REFERENCES public."FileObject"("id") ON UPDATE RESTRICT ON DELETE RESTRICT,
  "mimeType" TEXT NOT NULL CHECK ("mimeType" IN ('application/pdf','image/jpeg','image/png')),
  "sizeBytes" INTEGER NOT NULL CHECK ("sizeBytes" > 0),
  "contentSha256" TEXT NOT NULL CHECK ("contentSha256" ~ '^[a-f0-9]{64}$'),
  "bucket" TEXT NOT NULL CHECK ("bucket" <> ''),
  "objectKey" TEXT NOT NULL CHECK ("objectKey" <> ''),
  PRIMARY KEY ("reviewId","sourceRef","displayOrder"),
  UNIQUE ("reviewId","sourceRef","fileId")
);
CREATE INDEX "ContractEconomicReviewFileReference_fileId_idx" ON public."ContractEconomicReviewFileReference" ("fileId");
CREATE INDEX "ContractEconomicReviewFileReference_objectKey_idx" ON public."ContractEconomicReviewFileReference" ("objectKey");
CREATE INDEX "FileObject_objectKey_direct_retention_idx" ON public."FileObject" ("objectKey");

-- Supplied only by a future authorized installer after actual caller and cleanup
-- qualification. This migration intentionally does not provision any row or grant.
CREATE TABLE public.jg_contract_direct_review_retention_binding_v1 (
  "protocolVersion" INTEGER PRIMARY KEY CHECK ("protocolVersion" = 1),
  "applicationRoleOid" OID NOT NULL,
  "databaseOid" OID NOT NULL,
  "anchorOwnerOid" OID NOT NULL,
  "bindings" JSONB NOT NULL CHECK (jsonb_typeof("bindings") = 'object')
);
REVOKE ALL ON TABLE public.jg_contract_direct_review_retention_binding_v1 FROM PUBLIC;
REVOKE ALL ON TABLE public."ContractEconomicReviewFileReference" FROM PUBLIC;

CREATE FUNCTION public.jg_guard_contract_direct_review_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp
AS $guard_review$
DECLARE
  direct_refs JSONB;
  checked_refs JSONB := '[]'::jsonb;
  pin JSONB;
  input JSONB;
  side JSONB;
  mixed_old_side JSONB;
  source_position BIGINT;
  sources JSONB;
  v JSONB;
  source_file JSONB;
  locked_file RECORD;
  side_count INTEGER;
  counterparty_name TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."directSourcePins" IS DISTINCT FROM OLD."directSourcePins" THEN
      RAISE EXCEPTION '已送审的直签来源坐标不可改写' USING ERRCODE='23514';
    END IF;
    IF OLD."directSourcePins" IS NULL THEN
      IF jsonb_path_exists(NEW."frozenSources", '$[*] ? (exists (@.directInput))') THEN
        RAISE EXCEPTION '直签复核来源不能由调用方写入' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(source_ref ORDER BY source_ref COLLATE "C"),'[]'::jsonb) INTO direct_refs
  FROM (SELECT DISTINCT 'contract:' || c."id" AS source_ref
        FROM public."Contract" c JOIN public."ContractVersion" cv ON cv."contractId"=c."id" AND cv."versionNo"=1
        WHERE c."projectId"=NEW."projectId" AND 'contract:' || c."id" IN (NEW."leftSourceRef", NEW."rightSourceRef")
          AND cv."draftData" ? 'directSigningInput') AS sources;
  IF NEW."directSourcePins" IS NULL THEN
    IF direct_refs <> '[]'::jsonb OR jsonb_path_exists(NEW."frozenSources", '$[*] ? (exists (@.directInput))') THEN
      RAISE EXCEPTION '直签原文书须按实际来源修订复核' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.jg_contract_direct_review_retention_binding_v1 b
                 WHERE b."protocolVersion"=1 AND b."applicationRoleOid"=current_user::regrole::oid
                   AND current_user=session_user
                   AND b."databaseOid"=(SELECT d.oid FROM pg_catalog.pg_database d WHERE d.datname=current_database())) THEN
    RAISE EXCEPTION '直签复核来源尚未具备办理资格' USING ERRCODE='42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'pending_review' OR NEW."revision" <> 1 OR NEW."frozenSources" IS NOT NULL
       OR NEW."financeRequired" OR NEW."contractReviewedById" IS NOT NULL OR NEW."financeReviewedById" IS NOT NULL
       OR NEW."confirmedAt" IS NOT NULL OR NEW."returnedAt" IS NOT NULL OR NEW."returnReason" IS NOT NULL THEN
      RAISE EXCEPTION '直签复核必须先发起再办理' USING ERRCODE='23514';
    END IF;
  ELSE
    IF OLD."status" <> 'pending_review' OR NEW."status" NOT IN ('confirmed','returned')
       OR NEW."revision" <> OLD."revision"+1 OR NEW."financeRequired" OR NEW."financeReviewedById" IS NOT NULL THEN
      RAISE EXCEPTION '直签复核当前阶段不能办理该动作' USING ERRCODE='23514';
    END IF;
    IF NEW."status" = 'returned' THEN
      IF NEW."frozenSources" IS NOT NULL OR NEW."confirmedAt" IS NOT NULL OR NEW."contractReviewedById" IS NOT NULL
         OR NEW."returnedAt" IS NULL OR length(btrim(COALESCE(NEW."returnReason",'')))=0 THEN
        RAISE EXCEPTION '直签复核退回事实不完整' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW."returnedAt" IS NOT NULL OR NEW."returnReason" IS NOT NULL THEN
      RAISE EXCEPTION '直签复核不能同时确认和退回' USING ERRCODE='23514';
    END IF;
  END IF;
  IF jsonb_typeof(NEW."directSourcePins") IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION '直签来源坐标不完整' USING ERRCODE='23514';
  END IF;
  IF jsonb_array_length(NEW."directSourcePins") NOT BETWEEN 1 AND 2
     OR (jsonb_array_length(NEW."directSourcePins")=1 AND NEW."coverage"<>'[]'::jsonb)
     OR (NEW."status" = 'confirmed' AND jsonb_typeof(NEW."frozenSources") IS DISTINCT FROM 'array')
     OR (NEW."status" <> 'confirmed' AND NEW."frozenSources" IS NOT NULL)
     OR COALESCE(jsonb_path_exists(NEW."frozenSources", '$[*] ? (exists (@.directInput))'),false) THEN
    RAISE EXCEPTION '直签来源坐标或冻结事实不完整' USING ERRCODE='23514';
  END IF;

  IF NEW."status" = 'confirmed' AND (
      jsonb_array_length(NEW."frozenSources") <> 2
      OR jsonb_typeof(NEW."frozenSources"->0) IS DISTINCT FROM 'object'
      OR jsonb_typeof(NEW."frozenSources"->1) IS DISTINCT FROM 'object'
      OR NEW."frozenSources"#>>'{0,ref}' IS DISTINCT FROM NEW."leftSourceRef"
      OR NEW."frozenSources"#>>'{1,ref}' IS DISTINCT FROM NEW."rightSourceRef") THEN
    RAISE EXCEPTION '履约复核冻结文书必须与实际左右来源一致' USING ERRCODE='23514';
  END IF;

  -- Both source observations use the same statement snapshot. The app has
  -- already acquired the complete F set before issuing a terminal update.
  SELECT jsonb_object_agg(cv."id",jsonb_build_object('contractId',c."id",'draftRevision',cv."draftRevision",'input',q.input))
    INTO sources
    FROM public."ContractVersion" cv
    JOIN public."Contract" c ON c."id"=cv."contractId"
    JOIN public."Project" p ON p."id"=c."projectId"
    CROSS JOIN LATERAL (SELECT public.jg_contract_direct_pending_input_v1(cv."id") AS input) q
    WHERE c."projectId"=NEW."projectId" AND c."voidedAt" IS NULL AND p."isActive"
      AND cv."versionNo"=1 AND cv."changeType"='original' AND cv."numericProtocolVersion"=2 AND cv."status"='draft'
      AND cv."effectiveAt" IS NULL AND cv."firstSubmittedAt" IS NULL AND cv."draftData" ? 'directSigningInput'
      AND cv."id" IN (SELECT item->>'contractVersionId' FROM jsonb_array_elements(NEW."directSourcePins") item);

  FOR pin IN SELECT value FROM jsonb_array_elements(NEW."directSourcePins") LOOP
    IF jsonb_typeof(pin) IS DISTINCT FROM 'object'
       OR NOT pin ?& ARRAY['sourceRef','contractVersionId','sourceRevision','inputSha256']
       OR (pin - ARRAY['sourceRef','contractVersionId','sourceRevision','inputSha256']) <> '{}'::jsonb
       OR jsonb_typeof(pin->'sourceRef') IS DISTINCT FROM 'string'
       OR jsonb_typeof(pin->'contractVersionId') IS DISTINCT FROM 'string'
       OR jsonb_typeof(pin->'inputSha256') IS DISTINCT FROM 'string'
       OR jsonb_typeof(pin->'sourceRevision') IS DISTINCT FROM 'number'
       OR NOT COALESCE(pin->>'inputSha256' ~ '^[a-f0-9]{64}$',false)
       OR NOT COALESCE(pin->>'sourceRevision' ~ '^[1-9][0-9]{0,9}$',false)
       OR (pin->>'sourceRef') IS NOT DISTINCT FROM NEW."targetSourceRef" THEN
      RAISE EXCEPTION '直签来源坐标不正确' USING ERRCODE='23514';
    END IF;
    v := sources->(pin->>'contractVersionId');
    IF v IS NULL OR v->'draftRevision' IS DISTINCT FROM pin->'sourceRevision'
      OR ('contract:' || (v->>'contractId')) IS DISTINCT FROM pin->>'sourceRef' THEN
      RAISE EXCEPTION '已签原文书已变化，请按当前资料复核' USING ERRCODE='23514';
    END IF;
    input := v->'input';
    IF input->>'state' IS DISTINCT FROM 'complete' OR input->'sourceRevision' IS DISTINCT FROM pin->'sourceRevision'
       OR input#>>'{Q,locator,projectId}' IS DISTINCT FROM NEW."projectId"
       OR input#>>'{Q,locator,contractId}' IS DISTINCT FROM (v->>'contractId')
       OR input#>>'{Q,locator,contractVersionId}' IS DISTINCT FROM (pin->>'contractVersionId')
       OR input#>'{Q,locator,draftRevision}' IS DISTINCT FROM pin->'sourceRevision'
       OR input->'inputSha256' IS DISTINCT FROM pin->'inputSha256'
       OR (CASE pin->>'sourceRef' WHEN NEW."leftSourceRef" THEN NEW."leftFingerprint" WHEN NEW."rightSourceRef" THEN NEW."rightFingerprint" END)
          IS DISTINCT FROM (pin->>'inputSha256') THEN
      RAISE EXCEPTION '已签原文书来源已变化，请重新核对' USING ERRCODE='23514';
    END IF;
    checked_refs := checked_refs || jsonb_build_array(pin->'sourceRef');
    IF NEW."status" = 'confirmed' THEN
      SELECT count(*) INTO side_count FROM jsonb_array_elements(NEW."frozenSources") x WHERE x->>'ref'=pin->>'sourceRef';
      IF side_count <> 1 THEN
        RAISE EXCEPTION '直签复核冻结文书缺失或重复' USING ERRCODE='23514';
      END IF;
      SELECT value, ordinality INTO side, source_position FROM jsonb_array_elements(NEW."frozenSources") WITH ORDINALITY
        WHERE value->>'ref'=pin->>'sourceRef';
      SELECT party#>>'{identity,name}' INTO counterparty_name
        FROM jsonb_array_elements(input#>'{Q,subjects,parties}') party
        WHERE party->>'cpsId'=input#>>'{Q,subjects,roles,counterpartyCpsId}';
      IF side->>'title' IS DISTINCT FROM input#>>'{Q,contract,name}'
         OR side->>'reference' IS DISTINCT FROM COALESCE(input#>>'{Q,contract,originalSignedNumber}','未注明编号')
         OR side->>'counterparty' IS DISTINCT FROM counterparty_name
         OR side->>'version' IS DISTINCT FROM (pin->>'contractVersionId') || ':direct:' || (pin->>'sourceRevision') || ':' || (pin->>'inputSha256')
         OR side->>'projectId' IS DISTINCT FROM NEW."projectId"
         OR side->>'targetVersionId' IS DISTINCT FROM (pin->>'contractVersionId')
         OR side->'numericProtocolVersion' IS DISTINCT FROM '2'::jsonb
         OR side->'amountCents' IS DISTINCT FROM 'null'::jsonb
         OR side->'formal' IS DISTINCT FROM 'false'::jsonb
         OR side->'operatingBaseline' IS DISTINCT FROM 'null'::jsonb
         OR side->'amountYuan' IS DISTINCT FROM input#>'{Q,money,amountYuan}' THEN
        RAISE EXCEPTION '直签复核冻结事实不匹配' USING ERRCODE='23514';
      END IF;
      -- Service owns ordered F acquisition. Reenter only these same F locks,
      -- without waiting on newly selected evidence or locking C/V/G under P.
      FOR source_file IN SELECT value FROM jsonb_array_elements(input#>'{Q,signedFiles}') ORDER BY (value->>'fileId') COLLATE "C" LOOP
        SELECT f."id",f."objectKey",f."storageStatus",f."purgeReceiptId",f."contentSha256",f."sizeBytes",f."mimeType"
        INTO locked_file FROM public."FileObject" f WHERE f."id"=source_file->>'fileId' FOR UPDATE NOWAIT;
        IF NOT FOUND THEN
          RAISE EXCEPTION '直签原件不存在' USING ERRCODE='23514';
        END IF;
        IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
            'jg:contract-direct-review-object-key-v1:' || locked_file."objectKey",0)) THEN
          RAISE EXCEPTION '直签原件正在办理，请稍后重试' USING ERRCODE='55P03';
        END IF;
        IF locked_file."storageStatus"<>'active' OR locked_file."purgeReceiptId" IS NOT NULL
           OR locked_file."contentSha256" IS DISTINCT FROM source_file->>'contentSha256'
           OR to_jsonb(locked_file."sizeBytes") IS DISTINCT FROM source_file->'sizeBytes'
           OR locked_file."mimeType" IS DISTINCT FROM source_file->>'mimeType'
           OR EXISTS (SELECT 1 FROM public."FileObject" alias WHERE alias."objectKey"=locked_file."objectKey" AND alias."id"<>locked_file."id") THEN
          RAISE EXCEPTION '直签原件正在清理或存储来源有歧义' USING ERRCODE='23514';
        END IF;
      END LOOP;
      NEW."frozenSources" := jsonb_set(NEW."frozenSources", ARRAY[(source_position-1)::text],
        side || jsonb_build_object('directInput',jsonb_build_object('Q',input->'Q','inputSha256',input->'inputSha256')));
    END IF;
  END LOOP;

  IF checked_refs IS DISTINCT FROM direct_refs THEN
    RAISE EXCEPTION '直签复核必须使用实际完整文书范围' USING ERRCODE='23514';
  END IF;
  IF NEW."status" = 'confirmed' AND jsonb_array_length(direct_refs)=1 THEN
    mixed_old_side := CASE WHEN NEW."leftSourceRef"=direct_refs->>0
      THEN NEW."frozenSources"->1 ELSE NEW."frozenSources"->0 END;
    IF mixed_old_side->'coverageNumericProtocolVersion' IS DISTINCT FROM '2'::jsonb
       OR mixed_old_side->'excludedDeltaYuan' IS DISTINCT FROM to_jsonb('0.0000'::text)
       OR mixed_old_side ? 'excludedDeltaCents'
       OR mixed_old_side->'operatingBaseline' IS DISTINCT FROM 'null'::jsonb THEN
      RAISE EXCEPTION '混合来源复核不能冻结既有文书金额调整' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard_review$;
REVOKE ALL ON FUNCTION public.jg_guard_contract_direct_review_v1() FROM PUBLIC;
CREATE TRIGGER "ContractEconomicReview_direct_source_guard_v1"
BEFORE INSERT OR UPDATE ON public."ContractEconomicReview"
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_contract_direct_review_v1();

CREATE FUNCTION public.jg_materialize_contract_direct_review_files_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp
AS $materialize_files$
BEGIN
  IF NEW."status"='confirmed' AND OLD."status"<>'confirmed' AND NEW."directSourcePins" IS NOT NULL THEN
    INSERT INTO public."ContractEconomicReviewFileReference" (
      "reviewId","sourceRef","displayOrder","sourceContractVersionId","directInputProtocolVersion","sourceRevision","inputSha256",
      "fileId","mimeType","sizeBytes","contentSha256","bucket","objectKey")
    SELECT NEW."id", side->>'ref', (entry->>'displayOrder')::integer, side#>>'{directInput,Q,locator,contractVersionId}', 1,
      (side#>>'{directInput,Q,locator,draftRevision}')::integer, side#>>'{directInput,inputSha256}',
      f."id", f."mimeType", f."sizeBytes", f."contentSha256", f."bucket", f."objectKey"
    FROM jsonb_array_elements(NEW."frozenSources") side
    CROSS JOIN LATERAL jsonb_array_elements(side#>'{directInput,Q,signedFiles}') entry
    JOIN public."FileObject" f ON f."id"=entry->>'fileId';
  END IF;
  RETURN NULL;
END;
$materialize_files$;
REVOKE ALL ON FUNCTION public.jg_materialize_contract_direct_review_files_v1() FROM PUBLIC;
CREATE TRIGGER "ContractEconomicReview_direct_source_files_v1"
AFTER UPDATE ON public."ContractEconomicReview"
FOR EACH ROW EXECUTE FUNCTION public.jg_materialize_contract_direct_review_files_v1();

CREATE FUNCTION public.jg_guard_contract_direct_review_file_reference_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp
AS $guard_reference$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION '已确认履约复核的原件留存引用不可改写或删除' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public."ContractEconomicReview" r
    CROSS JOIN LATERAL jsonb_array_elements(r."directSourcePins") pin
    CROSS JOIN LATERAL jsonb_array_elements(r."frozenSources") side
    CROSS JOIN LATERAL jsonb_array_elements(side#>'{directInput,Q,signedFiles}') entry
    JOIN public."FileObject" f ON f."id"=entry->>'fileId'
    WHERE r."id"=NEW."reviewId" AND r."status"='confirmed' AND r."confirmedAt" IS NOT NULL
      AND pin->>'sourceRef'=NEW."sourceRef" AND side->>'ref'=NEW."sourceRef"
      AND pin->>'contractVersionId'=NEW."sourceContractVersionId" AND pin->'sourceRevision'=to_jsonb(NEW."sourceRevision")
      AND pin->>'inputSha256'=NEW."inputSha256" AND side#>>'{directInput,inputSha256}'=NEW."inputSha256"
      AND entry=jsonb_build_object('fileId',NEW."fileId",'displayOrder',NEW."displayOrder",'mimeType',NEW."mimeType",'sizeBytes',NEW."sizeBytes",'contentSha256',NEW."contentSha256")
      AND ROW(f."id",f."mimeType",f."sizeBytes",f."contentSha256",f."bucket",f."objectKey") IS NOT DISTINCT FROM
          ROW(NEW."fileId",NEW."mimeType",NEW."sizeBytes",NEW."contentSha256",NEW."bucket",NEW."objectKey")
      AND f."storageStatus"='active' AND f."purgeReceiptId" IS NULL
  ) THEN
    RAISE EXCEPTION '履约复核原件留存引用与冻结资料不一致' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$guard_reference$;
REVOKE ALL ON FUNCTION public.jg_guard_contract_direct_review_file_reference_v1() FROM PUBLIC;
CREATE TRIGGER "ContractEconomicReviewFileReference_guard_v1"
BEFORE INSERT OR UPDATE OR DELETE ON public."ContractEconomicReviewFileReference"
FOR EACH ROW EXECUTE FUNCTION public.jg_guard_contract_direct_review_file_reference_v1();

CREATE FUNCTION public.jg_assert_contract_direct_review_files_complete_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp
AS $assert_complete$
DECLARE
  review_id TEXT;
  expected JSONB;
  actual JSONB;
BEGIN
  IF TG_TABLE_NAME='ContractEconomicReview' THEN
    IF NEW."status"<>'confirmed' OR NEW."directSourcePins" IS NULL THEN RETURN NULL; END IF;
    review_id := NEW."id";
  ELSE
    review_id := NEW."reviewId";
  END IF;
  SELECT jsonb_agg(jsonb_build_array(side->>'ref', entry->'displayOrder', entry->>'fileId',
    side#>>'{directInput,Q,locator,contractVersionId}',side#>'{directInput,Q,locator,draftRevision}',
    side#>>'{directInput,inputSha256}',entry->>'mimeType',entry->'sizeBytes',entry->>'contentSha256')
    ORDER BY (side->>'ref') COLLATE "C",(entry->>'displayOrder')::integer) INTO expected
  FROM public."ContractEconomicReview" r CROSS JOIN LATERAL jsonb_array_elements(r."frozenSources") side
  CROSS JOIN LATERAL jsonb_array_elements(side#>'{directInput,Q,signedFiles}') entry
  WHERE r."id"=review_id AND r."status"='confirmed' AND r."directSourcePins" IS NOT NULL;

  SELECT jsonb_agg(jsonb_build_array(f."sourceRef",f."displayOrder",f."fileId",f."sourceContractVersionId",
    f."sourceRevision",f."inputSha256",f."mimeType",f."sizeBytes",f."contentSha256")
    ORDER BY f."sourceRef" COLLATE "C", f."displayOrder") INTO actual
  FROM public."ContractEconomicReviewFileReference" f WHERE f."reviewId"=review_id;
  IF expected IS NULL OR expected IS DISTINCT FROM actual THEN
    RAISE EXCEPTION '履约复核签章原件留存不完整' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$assert_complete$;
REVOKE ALL ON FUNCTION public.jg_assert_contract_direct_review_files_complete_v1() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER "ContractEconomicReview_direct_source_complete_v1"
AFTER UPDATE ON public."ContractEconomicReview"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.jg_assert_contract_direct_review_files_complete_v1();
CREATE CONSTRAINT TRIGGER "ContractEconomicReviewFileReference_complete_v1"
AFTER INSERT ON public."ContractEconomicReviewFileReference"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.jg_assert_contract_direct_review_files_complete_v1();

CREATE FUNCTION public.jg_protect_contract_direct_review_file_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp
AS $protect_file$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
        'jg:contract-direct-review-object-key-v1:' || NEW."objectKey",0)) THEN
      RAISE EXCEPTION '文件正在办理，请稍后重试' USING ERRCODE='55P03';
    END IF;
    IF EXISTS (SELECT 1 FROM public."FileObject" alias WHERE alias."objectKey"=NEW."objectKey")
       OR EXISTS (SELECT 1 FROM public."ContractEconomicReviewFileReference" r
                 WHERE r."objectKey"=NEW."objectKey" OR r."fileId"=NEW."supersedesFileObjectId") THEN
      RAISE EXCEPTION '已留存的复核原件不可被替换或复用存储键' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND
     ROW(OLD."id", OLD."bucket", OLD."objectKey", OLD."mimeType", OLD."sizeBytes", OLD."contentSha256", OLD."storageStatus", OLD."purgeReceiptId", OLD."supersedesFileObjectId")
       IS NOT DISTINCT FROM
     ROW(NEW."id", NEW."bucket", NEW."objectKey", NEW."mimeType", NEW."sizeBytes", NEW."contentSha256", NEW."storageStatus", NEW."purgeReceiptId", NEW."supersedesFileObjectId") THEN
    RETURN NEW;
  END IF;
  IF NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
      'jg:contract-direct-review-object-key-v1:' || OLD."objectKey",0)) THEN
    RAISE EXCEPTION '文件正在办理，请稍后重试' USING ERRCODE='55P03';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."objectKey" IS DISTINCT FROM OLD."objectKey"
      AND NOT pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
        'jg:contract-direct-review-object-key-v1:' || NEW."objectKey",0)) THEN
    RAISE EXCEPTION '文件正在办理，请稍后重试' USING ERRCODE='55P03';
  END IF;
  IF EXISTS (SELECT 1 FROM public."ContractEconomicReviewFileReference" r WHERE r."fileId"=OLD."id" OR r."objectKey"=OLD."objectKey") THEN
    RAISE EXCEPTION '已留存的复核原件不可清理或改写' USING ERRCODE='23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF (NEW."objectKey" IS DISTINCT FROM OLD."objectKey" AND
      EXISTS (SELECT 1 FROM public."FileObject" alias WHERE alias."objectKey"=NEW."objectKey" AND alias."id"<>OLD."id"))
     OR EXISTS (SELECT 1 FROM public."ContractEconomicReviewFileReference" r WHERE r."objectKey"=NEW."objectKey" OR r."fileId"=NEW."supersedesFileObjectId") THEN
    RAISE EXCEPTION '已留存的复核原件不可被替换或复用存储键' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$protect_file$;
REVOKE ALL ON FUNCTION public.jg_protect_contract_direct_review_file_v1() FROM PUBLIC;
CREATE TRIGGER "FileObject_contract_direct_review_retention_v1"
BEFORE INSERT OR UPDATE OR DELETE ON public."FileObject"
FOR EACH ROW EXECUTE FUNCTION public.jg_protect_contract_direct_review_file_v1();

COMMIT;
