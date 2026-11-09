-- Direct pending input only. SOURCE: no registration, review, activation or money write.
-- Runtime expected binding is installed only by a separately authorized migration
-- owner. It grants no rights. Missing exact R_app/file-caller supply must abort.
BEGIN;
-- Fixed creation/deparse premises, transaction-local; no runtime GUC mutation.
SET LOCAL search_path = pg_catalog, public, pg_temp;
SET LOCAL quote_all_identifiers = off;

ALTER TABLE public."ContractVersion" ADD COLUMN "originalSignedNumber" TEXT;

CREATE TABLE public.jg_contract_direct_pending_binding_v1 (
  "protocolVersion" INTEGER PRIMARY KEY CHECK ("protocolVersion" = 1),
  "recipeVersion" TEXT NOT NULL CHECK ("recipeVersion" = 'contract-direct-pending-input-v1/1'),
  "applicationRoleOid" OID NOT NULL,
  "fileCallerOids" OID[] NOT NULL CHECK (cardinality("fileCallerOids") > 0),
  "databaseOid" OID NOT NULL,
  "anchorNamespaceOid" OID NOT NULL,
  "anchorOwnerOid" OID NOT NULL,
  "bindings" JSONB NOT NULL CHECK (jsonb_typeof("bindings") = 'object')
);
REVOKE ALL ON TABLE public.jg_contract_direct_pending_binding_v1 FROM PUBLIC;

CREATE FUNCTION public.jg_contract_direct_pending_binding_guard_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $binding_guard$
BEGIN
  IF TG_OP <> 'INSERT' OR EXISTS (SELECT 1 FROM public.jg_contract_direct_pending_binding_v1) THEN
    RAISE EXCEPTION '已签合同来源安装记录不可修改或删除' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$binding_guard$;
REVOKE ALL ON FUNCTION public.jg_contract_direct_pending_binding_guard_v1() FROM PUBLIC;
CREATE TRIGGER "jg_direct_pending_binding_immutable" BEFORE INSERT OR UPDATE OR DELETE
ON public.jg_contract_direct_pending_binding_v1 FOR EACH ROW EXECUTE FUNCTION public.jg_contract_direct_pending_binding_guard_v1();

CREATE FUNCTION public.jg_contract_direct_pending_version_guard_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $version_guard$
DECLARE d JSONB; old_d JSONB; signed_day TEXT; loc JSONB; role_name TEXT; terms_id TEXT;
BEGIN
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
$version_guard$;
REVOKE ALL ON FUNCTION public.jg_contract_direct_pending_version_guard_v1() FROM PUBLIC;
CREATE TRIGGER "jg_direct_pending_version_shape" BEFORE INSERT OR UPDATE
ON public."ContractVersion" FOR EACH ROW EXECUTE FUNCTION public.jg_contract_direct_pending_version_guard_v1();

CREATE FUNCTION public.jg_contract_direct_pending_input_v1(p_version_id TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $pending_input$
DECLARE v RECORD; d JSONB; a RECORD; p RECORD; part RECORD; parties JSONB := '[]'::jsonb;
  signed_files JSONB := '[]'::jsonb; payment JSONB := NULL; q JSONB; x RECORD; n INTEGER := 0;
  enterprise_id TEXT; counterparty_id TEXT; enterprise_version TEXT; counterparty_version TEXT; reason TEXT; invalid_input BOOLEAN := FALSE; signed_day TEXT; role_name TEXT; loc JSONB;
BEGIN
  SELECT cv."id", cv."contractId", cv."versionNo", cv."changeType", cv."numericProtocolVersion", cv."status", cv."signingSubjectType", cv."draftRevision",
    cv."originalSignedNumber", cv."draftData", cv."amountYuan", cv."amountLimitType", cv."pricingNature", cv."amountSource", cv."invoiceType", cv."taxMode", cv."defaultTaxRatePercent",
    cv."affiliateAssignmentId", cv."affiliateBusinessPartyVersionId", cv."affiliateNameSnapshot", cv."affiliateCreditCodeSnapshot",
    c."projectId", c."name", c."contractTypeKey"
  INTO v FROM public."ContractVersion" cv JOIN public."Contract" c ON c."id" = cv."contractId" WHERE cv."id" = p_version_id;
  IF NOT FOUND OR NOT (v."draftData" ? 'directSigningInput') THEN RETURN jsonb_build_object('protocolVersion',1,'sourceKind','direct_signed_pending','state','not_applicable','sourceRevision',NULL,'Q',NULL,'inputSha256',NULL,'reason',NULL); END IF;
  d := v."draftData"->'directSigningInput';
  IF v."numericProtocolVersion" <> 2 OR v."changeType" <> 'original' OR v."status" NOT IN ('draft','abandoned')
    OR jsonb_typeof(d) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(CASE WHEN jsonb_typeof(d)='object' THEN d ELSE '{}'::jsonb END))<>7 OR NOT d ?& ARRAY['protocolVersion','source','relationship','signedOn','enterpriseParty','counterpartyParty','fixedPaymentTermsVersionId'] OR d->'protocolVersion' IS DISTINCT FROM '1'::jsonb
    OR d->>'source' IS DISTINCT FROM 'direct_signed' OR d->>'relationship' IS DISTINCT FROM 'outside'
    OR v."draftData"#>>'{contractBasics,relationship}' IS DISTINCT FROM 'outside' THEN
    RETURN jsonb_build_object('protocolVersion',1,'sourceKind','direct_signed_pending','state','invalid','sourceRevision',v."draftRevision",'Q',NULL,'inputSha256',NULL,'reason','已签合同待登记来源不完整');
  END IF;
  IF d->'signedOn' <> 'null'::jsonb THEN
    signed_day := d->>'signedOn';
    BEGIN
      IF jsonb_typeof(d->'signedOn') IS DISTINCT FROM 'string' OR signed_day !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR substring(signed_day,1,4)='0000'
        OR to_char(make_date(substring(signed_day,1,4)::int,substring(signed_day,6,2)::int,substring(signed_day,9,2)::int),'YYYY-MM-DD') IS DISTINCT FROM signed_day THEN RAISE EXCEPTION 'invalid_date'; END IF;
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('protocolVersion',1,'sourceKind','direct_signed_pending','state','invalid','sourceRevision',v."draftRevision",'Q',NULL,'inputSha256',NULL,'reason','签订日期不是有效年月日'); END;
  END IF;
  FOREACH role_name IN ARRAY ARRAY['enterpriseParty','counterpartyParty'] LOOP
    loc := d->role_name;
    IF loc<>'null'::jsonb AND (jsonb_typeof(loc) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(CASE WHEN jsonb_typeof(loc)='object' THEN loc ELSE '{}'::jsonb END))<>2 OR NOT loc ?& ARRAY['roleKey','displayOrder']
      OR jsonb_typeof(loc->'roleKey') IS DISTINCT FROM 'string' OR loc->>'roleKey' NOT IN ('party_a','party_b','party_c','guarantor','consortium_member','other') OR jsonb_typeof(loc->'displayOrder') IS DISTINCT FROM 'number' OR loc->>'displayOrder' !~ '^(0|[1-9][0-9]*)$') THEN
      RETURN jsonb_build_object('protocolVersion',1,'sourceKind','direct_signed_pending','state','invalid','sourceRevision',v."draftRevision",'Q',NULL,'inputSha256',NULL,'reason','签约双方位置格式不正确');
    END IF;
  END LOOP;
  reason := CASE WHEN length(btrim(v."name")) = 0 THEN '请填写合同名称' ELSE NULL END;
  IF d->'enterpriseParty' = 'null'::jsonb OR d->'counterpartyParty' = 'null'::jsonb THEN reason := COALESCE(reason,'请选择真实签约双方位置'); END IF;
  IF d->'enterpriseParty' = d->'counterpartyParty' AND d->'enterpriseParty' <> 'null'::jsonb THEN
    RETURN jsonb_build_object('protocolVersion',1,'sourceKind','direct_signed_pending','state','invalid','sourceRevision',v."draftRevision",'Q',NULL,'inputSha256',NULL,'reason','签约双方位置重复');
  END IF;
  SELECT count(*) INTO n FROM public."ContractPartySnapshot" cps WHERE cps."contractVersionId"=v."id"
    AND cps."roleKey"=d#>>'{enterpriseParty,roleKey}' AND cps."displayOrder"::text=d#>>'{enterpriseParty,displayOrder}';
  IF n > 1 THEN reason := '签约主体位置不唯一'; invalid_input := TRUE; END IF;
  SELECT cps."id",cps."businessPartyVersionId" INTO part FROM public."ContractPartySnapshot" cps WHERE cps."contractVersionId"=v."id"
    AND cps."roleKey"=d#>>'{enterpriseParty,roleKey}' AND cps."displayOrder"::text=d#>>'{enterpriseParty,displayOrder}';
  enterprise_id := part."id"; enterprise_version := part."businessPartyVersionId";
  SELECT count(*) INTO n FROM public."ContractPartySnapshot" cps WHERE cps."contractVersionId"=v."id"
    AND cps."roleKey"=d#>>'{counterpartyParty,roleKey}' AND cps."displayOrder"::text=d#>>'{counterpartyParty,displayOrder}';
  IF n > 1 THEN reason := '相对方位置不唯一'; invalid_input := TRUE; END IF;
  SELECT cps."id",cps."businessPartyVersionId" INTO part FROM public."ContractPartySnapshot" cps WHERE cps."contractVersionId"=v."id"
    AND cps."roleKey"=d#>>'{counterpartyParty,roleKey}' AND cps."displayOrder"::text=d#>>'{counterpartyParty,displayOrder}';
  counterparty_id := part."id"; counterparty_version := part."businessPartyVersionId";
  IF enterprise_id IS NULL OR enterprise_version IS NULL OR counterparty_id IS NULL OR counterparty_version IS NULL THEN reason := COALESCE(reason,'签约双方尚未绑定受控单位版本'); END IF;
  SELECT aa."id",aa."projectId",aa."businessPartyId",aa."businessPartyVersionId",aa."affiliateNameSnapshot",aa."affiliateCreditCodeSnapshot",aa."effectiveFrom"
    INTO a FROM public."ProjectAffiliateAssignment" aa WHERE aa."id"=v."affiliateAssignmentId";
  IF a."id" IS NULL OR a."projectId" IS DISTINCT FROM v."projectId" OR a."businessPartyVersionId" IS DISTINCT FROM enterprise_version
    OR v."affiliateBusinessPartyVersionId" IS DISTINCT FROM a."businessPartyVersionId" OR v."affiliateNameSnapshot" IS DISTINCT FROM a."affiliateNameSnapshot"
    OR v."affiliateCreditCodeSnapshot" IS DISTINCT FROM a."affiliateCreditCodeSnapshot" OR enterprise_version = counterparty_version
    OR v."signingSubjectType" IS DISTINCT FROM 'affiliate' THEN reason := COALESCE(reason,'施工企业签约来源尚未完整确认'); END IF;
  FOR x IN SELECT cps."id",cps."roleKey",cps."displayOrder",cps."businessPartyVersionId",bp."snapshot",bp."businessPartyId"
    FROM public."ContractPartySnapshot" cps LEFT JOIN public."BusinessPartyVersion" bp ON bp."id"=cps."businessPartyVersionId"
    WHERE cps."contractVersionId"=v."id" ORDER BY cps."roleKey" COLLATE "C",cps."displayOrder",cps."id" COLLATE "C" LOOP
    IF x."id"=enterprise_id AND x."businessPartyId" IS DISTINCT FROM a."businessPartyId" THEN reason := COALESCE(reason,'施工企业版本与单位身份不一致'); END IF;
    IF x."id"=counterparty_id AND x."businessPartyId"=a."businessPartyId" THEN reason := COALESCE(reason,'签约相对方不能与施工企业为同一单位'); invalid_input := TRUE; END IF;
    IF x."id" IN (enterprise_id,counterparty_id) AND (x."snapshot" IS NULL OR jsonb_typeof(x."snapshot") IS DISTINCT FROM 'object') THEN reason := COALESCE(reason,'签约单位版本资料缺失'); END IF;
    parties := parties || jsonb_build_array(jsonb_build_object('cpsId',x."id",'roleKey',x."roleKey",'displayOrder',x."displayOrder",'businessPartyVersionId',x."businessPartyVersionId",'identity',jsonb_build_object(
      'name',x."snapshot"->'name','unifiedSocialCreditCode',x."snapshot"->'unifiedSocialCreditCode','legalRepresentative',x."snapshot"->'legalRepresentative','address',x."snapshot"->'address','contactName',x."snapshot"->'contactName','contactPhone',x."snapshot"->'contactPhone')));
  END LOOP;
  IF d->'fixedPaymentTermsVersionId' <> 'null'::jsonb THEN
    SELECT pt."id",pt."contractId",pt."contractVersionId",pt."versionNo",pt."originalText" INTO p FROM public."PaymentTermsVersion" pt WHERE pt."id"=d->>'fixedPaymentTermsVersionId';
    IF p."id" IS NULL OR p."contractId" IS DISTINCT FROM v."contractId" OR p."contractVersionId" IS DISTINCT FROM v."id"
      OR EXISTS (SELECT 1 FROM public."PaymentTermsStage" st WHERE st."paymentTermsVersionId"=p."id") THEN reason := COALESCE(reason,'付款约定固定来源不完整'); invalid_input := TRUE;
    ELSE payment := jsonb_build_object('id',p."id",'versionNo',p."versionNo",'originalText',p."originalText",'stages','[]'::jsonb); END IF;
  ELSE
    SELECT count(*) INTO n FROM public."PaymentTermsVersion" pt WHERE pt."contractVersionId"=v."id";
    IF n>0 THEN reason := COALESCE(reason,'付款约定来源尚未绑定'); END IF; IF n>1 THEN invalid_input := TRUE; END IF;
  END IF;
  n := 0;
  FOR x IN SELECT da."fileId",da."displayOrder",f."mimeType",f."sizeBytes",f."contentSha256",f."storageStatus",f."purgeReceiptId",f."supersedesFileObjectId"
    FROM public."ContractDraftAttachment" da LEFT JOIN public."FileObject" f ON f."id"=da."fileId"
    WHERE da."contractVersionId"=v."id" AND da."slotKey"='direct_signed_originals_v1' ORDER BY da."displayOrder" LOOP
    IF x."displayOrder" <> n OR x."mimeType" NOT IN ('application/pdf','image/jpeg','image/png') OR x."mimeType" IS NULL
      OR x."storageStatus" IS DISTINCT FROM 'active' OR x."purgeReceiptId" IS NOT NULL OR x."supersedesFileObjectId" IS NOT NULL
      OR x."sizeBytes" IS NULL OR x."sizeBytes" <= 0 OR x."contentSha256" IS NULL OR x."contentSha256" !~ '^[a-f0-9]{64}$'
      OR EXISTS (SELECT 1 FROM public."FileObject" newer WHERE newer."supersedesFileObjectId"=x."fileId") THEN reason := COALESCE(reason,'签章原件顺序或文件元数据不完整'); invalid_input := TRUE; END IF;
    signed_files := signed_files || jsonb_build_array(jsonb_build_object('fileId',x."fileId",'displayOrder',x."displayOrder",'mimeType',x."mimeType",'sizeBytes',x."sizeBytes",'contentSha256',x."contentSha256")); n := n+1;
  END LOOP;
  IF n < 1 OR n > 20 THEN reason := COALESCE(reason,'请保存一至二十份签章PDF或照片原件'); END IF;
  IF reason IS NOT NULL THEN RETURN jsonb_build_object('protocolVersion',1,'sourceKind','direct_signed_pending','state',CASE WHEN invalid_input THEN 'invalid' ELSE 'incomplete' END,'sourceRevision',v."draftRevision",'Q',NULL,'inputSha256',NULL,'reason',reason); END IF;
  q := jsonb_build_object('inputProtocolVersion',1,'source',jsonb_build_object('kind','direct_signed','relationship','outside'),
    'locator',jsonb_build_object('projectId',v."projectId",'contractId',v."contractId",'contractVersionId',v."id",'versionNo',v."versionNo",'changeType','original','draftRevision',v."draftRevision"),
    'contract',jsonb_build_object('businessType',v."contractTypeKey",'name',v."name",'originalSignedNumber',v."originalSignedNumber",'signedOn',d->'signedOn'),
    'money',jsonb_build_object('numericProtocolVersion',2,'amountYuan',CASE WHEN v."amountYuan" IS NULL THEN NULL ELSE v."amountYuan"::numeric(24,4)::text END,'amountLimitType',v."amountLimitType",'pricingNature',v."pricingNature",'amountSource',v."amountSource"),
    'tax',jsonb_build_object('amountBasis',v."draftData"#>>'{contractBasics,amountBasis}','invoiceType',v."invoiceType",'taxMode',v."taxMode",'defaultTaxRatePercent',CASE WHEN v."defaultTaxRatePercent" IS NULL THEN NULL ELSE v."defaultTaxRatePercent"::numeric(9,6)::text END),
    'subjects',jsonb_build_object('enterprise',jsonb_build_object('assignmentId',a."id",'businessPartyId',a."businessPartyId",'businessPartyVersionId',a."businessPartyVersionId",'name',a."affiliateNameSnapshot",'creditCode',a."affiliateCreditCodeSnapshot",'effectiveFrom',to_char(a."effectiveFrom",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),'roles',jsonb_build_object('enterpriseCpsId',enterprise_id,'counterpartyCpsId',counterparty_id),'parties',parties),
    'terms',jsonb_build_object('settlementText',COALESCE(v."draftData"#>>'{contractBasics,settlementText}',''),'paymentTerms',payment),'signedFiles',signed_files);
  RETURN jsonb_build_object('protocolVersion',1,'sourceKind','direct_signed_pending','state','complete','sourceRevision',v."draftRevision",'Q',q,'inputSha256',encode(public.digest(convert_to(q::text,'UTF8'),'sha256'),'hex'),'reason',NULL);
END;
$pending_input$;
REVOKE ALL ON FUNCTION public.jg_contract_direct_pending_input_v1(TEXT) FROM PUBLIC;

-- Refuse an old template's identically named slot instead of reinterpreting it.
DO $reserved_slot$
BEGIN
  IF EXISTS (SELECT 1 FROM public."ContractDraftAttachment" da JOIN public."ContractVersion" v ON v."id"=da."contractVersionId"
    WHERE da."slotKey"='direct_signed_originals_v1' AND NOT COALESCE(v."numericProtocolVersion"=2 AND v."changeType"='original'
      AND v."draftData"#>>'{directSigningInput,source}'='direct_signed'
      AND v."draftData"#>>'{directSigningInput,relationship}'='outside'
      AND v."draftData"#>'{directSigningInput,protocolVersion}'='1'::jsonb,FALSE)) THEN
    RAISE EXCEPTION '已存在同名原件槽但来源不明确，拒绝重新解释旧资料';
  END IF;
END;
$reserved_slot$;

CREATE FUNCTION public.jg_contract_direct_pending_attachment_guard_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $attachment_guard$
DECLARE v RECORD; f RECORD; owner_id TEXT;
BEGIN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF NEW."slotKey" <> 'direct_signed_originals_v1' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD."slotKey"<>'direct_signed_originals_v1' THEN
    RAISE EXCEPTION '既有普通资料不能通过变更槽位升格为签章原件' USING ERRCODE='23514';
  END IF;
  SELECT cv."id",cv."contractId",cv."numericProtocolVersion",cv."changeType",cv."status",cv."draftData" INTO v
    FROM public."ContractVersion" cv WHERE cv."id"=NEW."contractVersionId";
  IF v."id" IS NULL OR v."numericProtocolVersion"<>2 OR v."changeType"<>'original' OR v."status"<>'draft'
    OR v."draftData"#>>'{directSigningInput,source}' IS DISTINCT FROM 'direct_signed'
    OR v."draftData"#>>'{directSigningInput,relationship}' IS DISTINCT FROM 'outside'
    OR v."draftData"#>'{directSigningInput,protocolVersion}' IS DISTINCT FROM '1'::jsonb THEN
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
$attachment_guard$;
REVOKE ALL ON FUNCTION public.jg_contract_direct_pending_attachment_guard_v1() FROM PUBLIC;
CREATE TRIGGER "jg_direct_pending_attachment_source" BEFORE INSERT OR UPDATE ON public."ContractDraftAttachment"
FOR EACH ROW EXECUTE FUNCTION public.jg_contract_direct_pending_attachment_guard_v1();
-- Reuse the existing exclusive guard and global file lock. The registry stays
-- FALSE for ordinary draft attachments; only the exact new source slot is true.
CREATE TRIGGER "jg_direct_pending_attachment_exclusive" BEFORE INSERT OR UPDATE OF "fileId","slotKey" ON public."ContractDraftAttachment"
FOR EACH ROW WHEN (NEW."slotKey" OPERATOR(pg_catalog.=) 'direct_signed_originals_v1'::pg_catalog.text) EXECUTE FUNCTION public.jg_enforce_exclusive_file_business_binding('fileId','true');

CREATE FUNCTION public.jg_contract_direct_pending_file_guard_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $file_guard$
BEGIN
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=pg_catalog.to_regclass('public."ContractDraftAttachment"') AND c.relnamespace=pg_catalog.to_regnamespace('public') AND c.relkind='r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity) THEN
      RAISE EXCEPTION '原件保留资料暂时无法核对，请稍后重试' USING ERRCODE='55000';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION '原件保留资料暂时无法核对，请稍后重试' USING ERRCODE='55000';
  END;
  IF NOT EXISTS (SELECT 1 FROM public."ContractDraftAttachment" da WHERE da."fileId"=OLD."id" AND da."slotKey"='direct_signed_originals_v1') THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION '已选签章原件仍被待登记合同保留，不能删除' USING ERRCODE='23514'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."storageStatus" IS DISTINCT FROM OLD."storageStatus"
    OR NEW."purgeReceiptId" IS DISTINCT FROM OLD."purgeReceiptId" OR NEW."supersedesFileObjectId" IS DISTINCT FROM OLD."supersedesFileObjectId"
    OR NEW."bucket" IS DISTINCT FROM OLD."bucket" OR NEW."objectKey" IS DISTINCT FROM OLD."objectKey"
    OR NEW."mimeType" IS DISTINCT FROM OLD."mimeType" OR NEW."sizeBytes" IS DISTINCT FROM OLD."sizeBytes"
    OR NEW."contentSha256" IS DISTINCT FROM OLD."contentSha256" OR NEW."uploadedByUserId" IS DISTINCT FROM OLD."uploadedByUserId" THEN
    RAISE EXCEPTION '已选签章原件的内容身份和保留状态不可替换' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$file_guard$;
REVOKE ALL ON FUNCTION public.jg_contract_direct_pending_file_guard_v1() FROM PUBLIC;
CREATE TRIGGER "jg_direct_pending_file_retained" BEFORE UPDATE OR DELETE ON public."FileObject"
FOR EACH ROW EXECUTE FUNCTION public.jg_contract_direct_pending_file_guard_v1();

DO $exclusive_owner$
DECLARE target OID; old_body TEXT; new_body TEXT; anchor TEXT; before_meta JSONB; after_meta JSONB; old_state RECORD;
BEGIN
  target := to_regprocedure('public.jg_has_exclusive_file_business_binding(text)');
  SELECT p.*,l.lanname INTO old_state FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE p.oid=target;
  SELECT prosrc,to_jsonb(p)-'prosrc' INTO old_body,before_meta FROM pg_catalog.pg_proc p WHERE oid=target;
  IF target IS NULL OR old_state.prosecdef OR old_state.provolatile<>'s' OR old_state.proparallel<>'r' OR old_state.proisstrict OR old_state.proretset
    OR old_state.proconfig IS NOT NULL OR old_state.lanname<>'plpgsql' OR old_state.prorettype<>'pg_catalog.bool'::regtype
    OR old_state.proargtypes<>'25'::oidvector OR old_state.proargnames IS DISTINCT FROM ARRAY['candidate_file_id']
    OR old_state.pronargdefaults<>0 OR old_state.provariadic<>0 OR old_state.prokind<>'f'
    OR NOT pg_catalog.pg_has_role(current_user::regrole::oid,old_state.proowner,'MEMBER') THEN
    RAISE EXCEPTION '文件排他读取原接口、属性或owner资格漂移，拒绝安装';
  END IF;
  IF old_body IS NULL OR encode(public.digest(convert_to(old_body,'UTF8'),'sha256'),'hex') <> '2dd031c00d7774dc6ff29376b6bd3f1b4a23579ac19f2a2c76e40ee788deb6c7' THEN
    RAISE EXCEPTION '文件排他读取原定义漂移，拒绝安装';
  END IF;
  anchor := E'  RETURN EXISTS (\n    SELECT 1\n    FROM "ContractTakeoverCorrection"';
  IF (length(old_body)-length(replace(old_body,anchor,'')))/length(anchor) <> 1 THEN RAISE EXCEPTION '文件排他定义锚点不唯一'; END IF;
  new_body := replace(old_body,anchor,E'  BEGIN\n    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid=pg_catalog.to_regclass(''public."ContractDraftAttachment"'') AND c.relnamespace=pg_catalog.to_regnamespace(''public'') AND c.relkind=''r'' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity) THEN\n      RAISE EXCEPTION ''原件保留资料暂时无法核对，请稍后重试'' USING ERRCODE=''55000'';\n    END IF;\n  EXCEPTION WHEN insufficient_privilege THEN\n    RAISE EXCEPTION ''原件保留资料暂时无法核对，请稍后重试'' USING ERRCODE=''55000'';\n  END;\n  RETURN EXISTS (SELECT 1 FROM public."ContractDraftAttachment" WHERE "fileId"=candidate_file_id AND "slotKey"=''direct_signed_originals_v1'') OR EXISTS (\n    SELECT 1\n    FROM "ContractTakeoverCorrection"');
  -- ALTER/COPY owner, ACL, SECURITY, search_path or interface is forbidden here.
  -- CREATE OR REPLACE with the existing complete definition preserves its OID,
  -- owner and ACL; only the one exact body substring is replaced.
  EXECUTE replace(pg_catalog.pg_get_functiondef(target),old_body,new_body);
  SELECT to_jsonb(p)-'prosrc' INTO after_meta FROM pg_catalog.pg_proc p WHERE oid=target;
  IF after_meta IS DISTINCT FROM before_meta THEN RAISE EXCEPTION '文件排他函数owner、ACL或其它属性改变，拒绝安装'; END IF;
END;
$exclusive_owner$;

-- Missing source supply is an installation error, not a reason to invent roles
-- or grant new rights. Task16's real-caller NOT_IMPLEMENTED gate stays intact.
DO $binding_install$
DECLARE app_oid OID; file_oids OID[]; role_oid OID; owner_oid OID; namespace_oid OID; db_oid OID;
  source_config JSONB; recipe JSONB := $recipe${"legacyRetentionReads":{"ContractDraftAttachment":["fileId","slotKey"]},"attachmentLock":{"table":"FileObject","mode":"FOR UPDATE NOWAIT","privilege":"UPDATE:any-column","advisoryNamespace":190731,"advisoryKey":13},"catalogGuardReads":{"pg_catalog.pg_class":["oid","relnamespace","relkind","relrowsecurity","relforcerowsecurity"]},"catalogGuardFunctions":["pg_catalog.to_regclass(text)","pg_catalog.to_regnamespace(text)"],"builtinNames":["jsonb_build_object","jsonb_build_array","jsonb_object_keys","jsonb_array_elements","jsonb_array_elements_text","jsonb_each","jsonb_agg","cardinality","length","replace","count","to_char","make_date","convert_to","encode","format","array_agg","array_to_string","unnest","substring","btrim"],"operatorNames":["=","<>",">",">=","<","<=","~","!~","->","->>","#>","#>>","?","?&","||","-"],"operatorTypeNames":["jsonb","text","int4","int8","numeric","bool","timestamp","date","oid","bytea","name","_text","_oid"],"recipeVersion":"contract-direct-pending-input-v1/1","sourceReads":{"Contract":["id","projectId","name","contractTypeKey"],"ContractVersion":["id","contractId","versionNo","changeType","numericProtocolVersion","status","signingSubjectType","draftRevision","originalSignedNumber","draftData","amountYuan","amountLimitType","pricingNature","amountSource","invoiceType","taxMode","defaultTaxRatePercent","affiliateAssignmentId","affiliateBusinessPartyVersionId","affiliateNameSnapshot","affiliateCreditCodeSnapshot"],"ContractPartySnapshot":["id","contractVersionId","roleKey","displayOrder","businessPartyVersionId","snapshot"],"BusinessPartyVersion":["id","businessPartyId","snapshot"],"ProjectAffiliateAssignment":["id","projectId","businessPartyId","businessPartyVersionId","affiliateNameSnapshot","affiliateCreditCodeSnapshot","effectiveFrom"],"PaymentTermsVersion":["id","contractId","contractVersionId","versionNo","originalText"],"PaymentTermsStage":["id","paymentTermsVersionId"],"ContractDraftAttachment":["contractVersionId","slotKey","fileId","displayOrder"],"FileObject":["id","mimeType","sizeBytes","contentSha256","storageStatus","purgeReceiptId","supersedesFileObjectId"]},"attachmentReads":{"ContractVersion":["id","contractId","numericProtocolVersion","changeType","status","draftData"],"Contract":["id","ownerUserId"],"FileObject":["id","mimeType","sizeBytes","contentSha256","storageStatus","purgeReceiptId","supersedesFileObjectId","uploadedByUserId"]},"routines":[{"signature":"public.jg_contract_direct_pending_binding_guard_v1()","bodySha256":"5f8c18f1a74e20703d55edc4b2f228972902b8e217c9ba5ce0a07041e4084e8d","securityDefiner":false,"searchPath":["pg_catalog","public"],"language":"plpgsql","returnType":"trigger","volatility":"v","parallel":"u","strict":false,"returnsSet":false},{"signature":"public.jg_contract_direct_pending_version_guard_v1()","bodySha256":"5226ea72ac28bf9af8f7e8a5acff4eb97d0f4aacd8d879fe1c08d3c9cc20b400","securityDefiner":false,"searchPath":["pg_catalog","public"],"language":"plpgsql","returnType":"trigger","volatility":"v","parallel":"u","strict":false,"returnsSet":false},{"signature":"public.jg_contract_direct_pending_input_v1(pg_catalog.text)","bodySha256":"24e586804f996807e6c0d28bc5e1401551fc1c73e92eca93cec4a06c50b1f6e9","securityDefiner":false,"searchPath":["pg_catalog","public"],"language":"plpgsql","returnType":"jsonb","volatility":"s","parallel":"u","strict":false,"returnsSet":false},{"signature":"public.jg_contract_direct_pending_attachment_guard_v1()","bodySha256":"75824d061e5183bc3fb2fd3ec25804e2d471920d1f92b5bdd01ebc9a4cdd95d1","securityDefiner":false,"searchPath":["pg_catalog","public"],"language":"plpgsql","returnType":"trigger","volatility":"v","parallel":"u","strict":false,"returnsSet":false},{"signature":"public.jg_contract_direct_pending_file_guard_v1()","bodySha256":"106f9ccc402e856a5057ed0d73f7b3336bbaacdd8ed2eebe0588efef97a14aa1","securityDefiner":false,"searchPath":["pg_catalog","public"],"language":"plpgsql","returnType":"trigger","volatility":"v","parallel":"u","strict":false,"returnsSet":false},{"signature":"public.jg_has_exclusive_file_business_binding(pg_catalog.text)","bodySha256":"34c8b2cc5f110c24d67eba3491d580d0f656b6c7bbf1fced769f929b648a8f90","securityDefiner":false,"searchPath":null,"language":"plpgsql","returnType":"bool","volatility":"s","parallel":"r","strict":false,"returnsSet":false},{"signature":"public.\"appendOperatingFactThroughService\"(public.\"OperatingLedgerFactWritePayloadV2\",pg_catalog.text,pg_catalog.text)","bodySha256":"aa00bcbe5651be1b48054e338d5881d81900eef0eb2c86880f80fa5d9d350a58","securityDefiner":true,"language":"plpgsql","searchPath":["pg_catalog","public"],"returnType":"record","volatility":"v","parallel":"u","strict":false,"returnsSet":true},{"signature":"public.\"appendOperatingImpactThroughService\"(public.\"OperatingLedgerImpactWritePayloadV2\",pg_catalog.text,pg_catalog.text)","bodySha256":"c96af192e9f1711305791ebb8430f5ec888953ba40f675d9bf3c7fc3b1985d33","securityDefiner":true,"language":"plpgsql","searchPath":["pg_catalog","public"],"returnType":"text","volatility":"v","parallel":"u","strict":false,"returnsSet":true},{"signature":"public.jg_contract_archive_v2_parent_guard()","bodySha256":"cf2ec4a4f164edf43024c0569e24cd6cd67b191620c6dc6034923d84bc4948b4","securityDefiner":false,"language":"plpgsql","searchPath":["pg_catalog","public"],"returnType":"trigger","volatility":"v","parallel":"u","strict":false,"returnsSet":false},{"signature":"public.jg_file_business_binding_columns()","bodySha256":"d2a3171b76def6792d43f5cc37ede636f0f25e57b4dcf25625d3e4c91471080f","securityDefiner":false,"language":"sql","searchPath":null,"returnType":"record","volatility":"s","parallel":"s","strict":false,"returnsSet":true},{"signature":"public.jg_file_business_binding_columns_before_affiliate_company_contract()","bodySha256":"3829c2f025c6a293806249e9e6ccdf835b7e41be122dc9933b139dcff79dc7d2","securityDefiner":false,"language":"sql","searchPath":null,"returnType":"record","volatility":"i","parallel":"s","strict":false,"returnsSet":true},{"signature":"public.jg_file_business_binding_columns_before_payment_execution()","bodySha256":"fb1c1f94c2cabc5a2269bfda41c5a1cb436d34fcf51525b2819b3e84389722ce","securityDefiner":false,"language":"sql","searchPath":null,"returnType":"record","volatility":"s","parallel":"s","strict":false,"returnsSet":true},{"signature":"public.jg_file_business_binding_columns_before_project_expense_execution()","bodySha256":"2705ed0ade452177bf09d92be34cb69032b0dc17d6c08fc550c44ec8a3f26a7e","securityDefiner":false,"language":"sql","searchPath":null,"returnType":"record","volatility":"s","parallel":"s","strict":false,"returnsSet":true},{"signature":"public.jg_file_business_binding_columns_before_project_financing_quota_request()","bodySha256":"4e0c8631b174e41bad8709ea97ca3f3edb01bd77d8d9da4e66d3e6713d14f3da","securityDefiner":false,"language":"sql","searchPath":null,"returnType":"record","volatility":"s","parallel":"s","strict":false,"returnsSet":true},{"signature":"public.jg_file_business_binding_columns_before_operating_takeover()","bodySha256":"67434ace8ef58c6fb4cb0f223e194e73f6a54c9053a6f02aeab07a2142c2c60f","securityDefiner":false,"language":"sql","searchPath":null,"returnType":"record","volatility":"s","parallel":"s","strict":false,"returnsSet":true},{"signature":"public.jg_file_business_binding_columns_before_wage_statement()","bodySha256":"221c2ae6614614ede5b9ca73537a3603b1d7e249881564c4078c37c225b851f8","securityDefiner":false,"language":"sql","searchPath":null,"returnType":"record","volatility":"s","parallel":"s","strict":false,"returnsSet":true},{"signature":"public.jg_file_business_binding_columns_before_pol13b()","bodySha256":"78f95dab983cbff5c465f2608eaef8ae363a21adedd321a8c8d4bfc74fe84fd3","securityDefiner":false,"language":"sql","searchPath":null,"returnType":"record","volatility":"s","parallel":"s","strict":false,"returnsSet":true},{"signature":"public.jg_file_business_binding_columns_before_pol13b_attestation()","bodySha256":"954c64ee3c644672e92b52c116c5756c950e5e21dabe134e6b83b2e925abe66e","securityDefiner":false,"language":"sql","searchPath":null,"returnType":"record","volatility":"s","parallel":"s","strict":false,"returnsSet":true},{"signature":"public.jg_file_business_binding_columns_before_pol13b_payer_authority()","bodySha256":"9adca11635cacf6606054cbbf875e0810e19ba5a34a366f9ec801e4113583d96","securityDefiner":false,"language":"sql","searchPath":null,"returnType":"record","volatility":"s","parallel":"s","strict":false,"returnsSet":true},{"signature":"public.jg_file_business_binding_columns_before_pol13d_fund_execution()","bodySha256":"1acf8d7063f3f6eeb00c5032c479af062a2f2e654188190f624ad2099f276336","securityDefiner":false,"language":"sql","searchPath":null,"returnType":"record","volatility":"s","parallel":"s","strict":false,"returnsSet":true},{"signature":"public.jg_file_business_binding_columns_before_pol214_affiliate_clearing_authority()","bodySha256":"77a8609e78c6400c7e2307d77760c71f2fcfeb07ccf4825478cb242964b07dbe","securityDefiner":false,"language":"sql","searchPath":null,"returnType":"record","volatility":"s","parallel":"s","strict":false,"returnsSet":true},{"signature":"public.jg_file_business_binding_columns_before_pol260_invoice_evidence_repair()","bodySha256":"d5e0cf16db18893191a279b31b7c13d5ac7e6721f21d5741fc4e5cac5962c79e","securityDefiner":false,"language":"sql","searchPath":null,"returnType":"record","volatility":"s","parallel":"s","strict":false,"returnsSet":true},{"signature":"public.jg_file_business_binding_columns_before_pol279_necessary_expense_reserve()","bodySha256":"6dc038aa23a8c8b30fbc81e39d46e63740dfa39786ef41b3714b1808eff391ec","securityDefiner":false,"language":"sql","searchPath":null,"returnType":"record","volatility":"s","parallel":"s","strict":false,"returnsSet":true},{"signature":"public.jg_file_business_binding_columns_before_pol280_project_fund_dispute()","bodySha256":"fa10ee02640bfcc97289534ce6b1cc6ff525b2c23ad5f5785f9a982b195edf45","securityDefiner":false,"language":"sql","searchPath":null,"returnType":"record","volatility":"s","parallel":"s","strict":false,"returnsSet":true},{"signature":"public.jg_file_business_binding_columns_before_general_procurement()","bodySha256":"11f8bb70d002a60d9d32e65ed9432d2dabe2e807d0e616e077741acc857b45c0","securityDefiner":false,"language":"sql","searchPath":null,"returnType":"record","volatility":"s","parallel":"s","strict":false,"returnsSet":true},{"signature":"public.jg_file_business_binding_columns_before_contract_proxy()","bodySha256":"c4cfe12255775d52a074557bde16edf4b567928e2daaa198d1f4126973ecddad","securityDefiner":false,"language":"sql","searchPath":null,"returnType":"record","volatility":"s","parallel":"s","strict":false,"returnsSet":true},{"signature":"public.jg_file_business_binding_columns_before_upward_amount()","bodySha256":"72346a5ba2490a298affb2a438052098ec90d866ab83e0aba541c1ce1e71f8ce","securityDefiner":false,"language":"sql","searchPath":null,"returnType":"record","volatility":"s","parallel":"s","strict":false,"returnsSet":true},{"signature":"public.jg_file_business_binding_columns_before_bank_verification()","bodySha256":"84fe2c12bba4a725651e96cae2d8d1fcceb741b633c5b36e8c3b45b7151c00c5","securityDefiner":false,"language":"sql","searchPath":null,"returnType":"record","volatility":"s","parallel":"s","strict":false,"returnsSet":true},{"signature":"public.jg_file_business_binding_columns_before_company_transfer()","bodySha256":"f7d5ff5cc489348c171760579dc8558eb30cdcf3336a00c15416717bfe531fc3","securityDefiner":false,"language":"sql","searchPath":null,"returnType":"record","volatility":"s","parallel":"s","strict":false,"returnsSet":true},{"signature":"public.jg_file_business_binding_columns_before_contract_archive_v2()","bodySha256":"fb767ff29a7a4e2c3174ac8b97fd306b3ed7946cd1db31cb3fa6f6aba2270af3","securityDefiner":false,"language":"sql","searchPath":null,"returnType":"record","volatility":"s","parallel":"s","strict":false,"returnsSet":true},{"signature":"public.jg_file_business_collision_columns()","bodySha256":"59bcdff6d8e5026d8619a3fd7cf0d8796091e61f41ea4eb1543c9d1e0b530012","securityDefiner":false,"language":"sql","searchPath":null,"returnType":"record","volatility":"s","parallel":"s","strict":false,"returnsSet":true},{"signature":"public.jg_enforce_file_replacement_exclusive_binding()","bodySha256":"4c91d71432a110f0b491bb04da4c1f0a0e5d53d7116f5ef1e4f3e2ca7f839bda","securityDefiner":false,"language":"plpgsql","searchPath":null,"returnType":"trigger","volatility":"v","parallel":"u","strict":false,"returnsSet":false},{"signature":"public.jg_enforce_exclusive_file_business_binding()","bodySha256":"e33a10adaef82631e34bc46708c1e91295ff75cc578c36592d59bd60959f2999","securityDefiner":false,"language":"plpgsql","searchPath":null,"returnType":"trigger","volatility":"v","parallel":"u","strict":false,"returnsSet":false}],"triggers":[{"name":"jg_direct_pending_binding_immutable","table":"jg_contract_direct_pending_binding_v1","function":"public.jg_contract_direct_pending_binding_guard_v1()","type":31,"columns":[],"argumentCount":0,"arguments":"","definitions":null},{"name":"jg_direct_pending_version_shape","table":"ContractVersion","function":"public.jg_contract_direct_pending_version_guard_v1()","type":23,"columns":[],"argumentCount":0,"arguments":"","definitions":null},{"name":"jg_direct_pending_attachment_source","table":"ContractDraftAttachment","function":"public.jg_contract_direct_pending_attachment_guard_v1()","type":23,"columns":[],"argumentCount":0,"arguments":"","definitions":null},{"name":"jg_direct_pending_attachment_exclusive","table":"ContractDraftAttachment","function":"public.jg_enforce_exclusive_file_business_binding()","type":23,"columns":["fileId","slotKey"],"argumentCount":2,"arguments":"66696c654964007472756500","definitions":["CREATE TRIGGER jg_direct_pending_attachment_exclusive BEFORE INSERT OR UPDATE OF \"fileId\", \"slotKey\" ON public.\"ContractDraftAttachment\" FOR EACH ROW WHEN ((new.\"slotKey\" = 'direct_signed_originals_v1'::text)) EXECUTE FUNCTION jg_enforce_exclusive_file_business_binding('fileId', 'true')","CREATE TRIGGER jg_direct_pending_attachment_exclusive BEFORE INSERT OR UPDATE OF \"fileId\", \"slotKey\" ON public.\"ContractDraftAttachment\" FOR EACH ROW WHEN ((new.\"slotKey\" = 'direct_signed_originals_v1'::text)) EXECUTE FUNCTION public.jg_enforce_exclusive_file_business_binding('fileId', 'true')"]},{"name":"jg_direct_pending_file_retained","table":"FileObject","function":"public.jg_contract_direct_pending_file_guard_v1()","type":27,"columns":[],"argumentCount":0,"arguments":"","definitions":null}],"applicationExecSignatures":["public.jg_contract_direct_pending_version_guard_v1()","public.jg_contract_direct_pending_input_v1(pg_catalog.text)","public.jg_contract_direct_pending_attachment_guard_v1()","public.jg_contract_direct_pending_file_guard_v1()","public.jg_has_exclusive_file_business_binding(pg_catalog.text)","public.jg_file_business_binding_columns()","public.jg_file_business_binding_columns_before_affiliate_company_contract()","public.jg_file_business_binding_columns_before_payment_execution()","public.jg_file_business_binding_columns_before_project_expense_execution()","public.jg_file_business_binding_columns_before_project_financing_quota_request()","public.jg_file_business_binding_columns_before_operating_takeover()","public.jg_file_business_binding_columns_before_wage_statement()","public.jg_file_business_binding_columns_before_pol13b()","public.jg_file_business_binding_columns_before_pol13b_attestation()","public.jg_file_business_binding_columns_before_pol13b_payer_authority()","public.jg_file_business_binding_columns_before_pol13d_fund_execution()","public.jg_file_business_binding_columns_before_pol214_affiliate_clearing_authority()","public.jg_file_business_binding_columns_before_pol260_invoice_evidence_repair()","public.jg_file_business_binding_columns_before_pol279_necessary_expense_reserve()","public.jg_file_business_binding_columns_before_pol280_project_fund_dispute()","public.jg_file_business_binding_columns_before_general_procurement()","public.jg_file_business_binding_columns_before_contract_proxy()","public.jg_file_business_binding_columns_before_upward_amount()","public.jg_file_business_binding_columns_before_bank_verification()","public.jg_file_business_binding_columns_before_company_transfer()","public.jg_file_business_binding_columns_before_contract_archive_v2()","public.jg_file_business_collision_columns()","public.jg_enforce_file_replacement_exclusive_binding()","public.jg_enforce_exclusive_file_business_binding()"],"fileExecSignatures":["public.jg_contract_direct_pending_file_guard_v1()","public.jg_has_exclusive_file_business_binding(pg_catalog.text)"],"allowedSecurityDefiners":[{"signature":"public.\"appendOperatingFactThroughService\"(public.\"OperatingLedgerFactWritePayloadV2\",pg_catalog.text,pg_catalog.text)","bodySha256":"aa00bcbe5651be1b48054e338d5881d81900eef0eb2c86880f80fa5d9d350a58","securityDefiner":true,"language":"plpgsql","searchPath":["pg_catalog","public"],"returnType":"record","volatility":"v","parallel":"u","strict":false,"returnsSet":true},{"signature":"public.\"appendOperatingImpactThroughService\"(public.\"OperatingLedgerImpactWritePayloadV2\",pg_catalog.text,pg_catalog.text)","bodySha256":"c96af192e9f1711305791ebb8430f5ec888953ba40f675d9bf3c7fc3b1985d33","securityDefiner":true,"language":"plpgsql","searchPath":["pg_catalog","public"],"returnType":"text","volatility":"v","parallel":"u","strict":false,"returnsSet":true}],"applicationCatalogExecSignatures":["pg_catalog.pg_get_triggerdef(oid,boolean)","pg_catalog.current_schemas(boolean)","pg_catalog.pg_my_temp_schema()","pg_catalog.to_regtype(text)","pg_catalog.current_setting(text)"]}$recipe$::jsonb;
  table_entry RECORD; column_entry TEXT; relation_oid OID; fn_entry JSONB; function_oid OID;
  actual RECORD; member_role RECORD; existing RECORD; rels JSONB := '{}'::jsonb; routines JSONB := '{}'::jsonb;
  binding_oid OID; oid_list OID[]; role_reads JSONB; owned_signatures TEXT[] := ARRAY[
    'public.jg_contract_direct_pending_binding_guard_v1()',
    'public.jg_contract_direct_pending_version_guard_v1()',
    'public.jg_contract_direct_pending_input_v1(text)',
    'public.jg_contract_direct_pending_attachment_guard_v1()',
    'public.jg_contract_direct_pending_file_guard_v1()'];
  sig TEXT; acl_item RECORD; attribute RECORD; cols JSONB; relation_owner OID; trigger_entry JSONB; trigger_oid OID; triggers JSONB := '{}'::jsonb; actual_trigger RECORD;
BEGIN
  app_oid := NULLIF(current_setting('app.contract_archive_v2_application_role_oid',TRUE),'')::oid;
  source_config := NULLIF(current_setting('app.contract_archive_v2_file_caller_oids',TRUE),'')::jsonb;
  IF app_oid IS NULL OR jsonb_typeof(source_config) IS DISTINCT FROM 'array' OR jsonb_array_length(source_config)=0
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE oid=app_oid) THEN
    RAISE EXCEPTION '真实待登记应用与文件调用者尚未供应，拒绝安装';
  END IF;
  SELECT array_agg(DISTINCT role_value::oid ORDER BY role_value::oid) INTO file_oids
    FROM jsonb_array_elements_text(source_config) AS f(role_value);
  SELECT proowner INTO owner_oid FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayloadV2",text,text)');
  SELECT oid INTO namespace_oid FROM pg_catalog.pg_namespace WHERE nspname='public';
  SELECT oid INTO db_oid FROM pg_catalog.pg_database WHERE datname=current_database();
  IF owner_oid IS NULL OR namespace_oid IS NULL OR db_oid IS NULL OR NOT pg_catalog.pg_has_role(current_user::regrole::oid,owner_oid,'MEMBER') THEN
    RAISE EXCEPTION '待登记安装者的真实来源owner资格缺失';
  END IF;
  -- Derive the trusted installation owner from the pinned business routine,
  -- never from application current_user, a profile role name or binding JSON.
  IF NOT pg_catalog.has_schema_privilege(owner_oid,namespace_oid,'CREATE') THEN RAISE EXCEPTION '来源owner缺少新对象所有权所需的schema资格'; END IF;
  EXECUTE format('ALTER TABLE public.jg_contract_direct_pending_binding_v1 OWNER TO %I',(SELECT rolname FROM pg_catalog.pg_roles WHERE oid=owner_oid));
  FOREACH sig IN ARRAY owned_signatures LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO %I',sig,(SELECT rolname FROM pg_catalog.pg_roles WHERE oid=owner_oid));
  END LOOP;
  FOREACH role_oid IN ARRAY ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[app_oid]||file_oids) AS q(x)) LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE oid=role_oid) THEN RAISE EXCEPTION '文件调用者真实身份缺失'; END IF;
    IF role_oid=app_oid THEN
    IF pg_catalog.pg_has_role(role_oid,owner_oid,'MEMBER') THEN RAISE EXCEPTION '运行应用不能拥有或切换到来源安装owner'; END IF;
    FOR member_role IN SELECT oid,rolsuper,rolcreaterole,rolbypassrls,rolreplication FROM pg_catalog.pg_roles
      WHERE pg_catalog.pg_has_role(role_oid,oid,'MEMBER') LOOP
      IF member_role.rolsuper OR member_role.rolcreaterole OR member_role.rolbypassrls OR member_role.rolreplication
        OR pg_catalog.has_schema_privilege(member_role.oid,namespace_oid,'CREATE') THEN RAISE EXCEPTION '运行调用者具有未封闭的对象替换或提权能力'; END IF;
    END LOOP;
    END IF; -- R_file may be the trusted, source-pinned SD owner; it is not R_app.
    IF NOT pg_catalog.has_schema_privilege(role_oid,namespace_oid,'USAGE')
      OR NOT pg_catalog.has_function_privilege(role_oid,'public.digest(bytea,text)'::regprocedure,'EXECUTE') THEN RAISE EXCEPTION '运行调用者schema或摘要函数资格缺失'; END IF;
    IF NOT pg_catalog.has_schema_privilege(role_oid,'pg_catalog','USAGE') THEN RAISE EXCEPTION '原件保留目录namespace读取资格缺失'; END IF;
    FOR column_entry IN SELECT jsonb_array_elements_text(recipe#>'{catalogGuardReads,pg_catalog.pg_class}') LOOP
      IF NOT pg_catalog.has_column_privilege(role_oid,'pg_catalog.pg_class'::regclass,column_entry,'SELECT') THEN RAISE EXCEPTION '原件保留目录逐列读取资格缺失'; END IF;
    END LOOP;
    FOR sig IN SELECT jsonb_array_elements_text(recipe->'catalogGuardFunctions') LOOP
      IF NOT pg_catalog.has_function_privilege(role_oid,to_regprocedure(sig),'EXECUTE') THEN RAISE EXCEPTION '原件保留对象身份读取接口资格缺失'; END IF;
    END LOOP;
    binding_oid := 'public.jg_contract_direct_pending_binding_v1'::regclass;
    IF role_oid=app_oid THEN
    IF pg_catalog.has_table_privilege(role_oid,binding_oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN RAISE EXCEPTION '运行调用者不得改写来源安装记录'; END IF;
    FOR attribute IN SELECT attnum FROM pg_catalog.pg_attribute WHERE attrelid=binding_oid AND attnum>0 AND NOT attisdropped LOOP
      IF pg_catalog.has_column_privilege(role_oid,binding_oid,attribute.attnum,'INSERT,UPDATE,REFERENCES')
        OR NOT pg_catalog.has_column_privilege(role_oid,binding_oid,attribute.attnum,'SELECT') THEN RAISE EXCEPTION '来源安装记录逐列只读资格缺失'; END IF;
    END LOOP;
    FOR acl_item IN SELECT a.grantee,a.is_grantable FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a WHERE c.oid=binding_oid
      UNION ALL SELECT a.grantee,a.is_grantable FROM pg_catalog.pg_attribute c CROSS JOIN LATERAL pg_catalog.aclexplode(c.attacl) a WHERE c.attrelid=binding_oid AND c.attnum>0 AND NOT c.attisdropped LOOP
      IF acl_item.is_grantable AND CASE WHEN acl_item.grantee=0 THEN TRUE ELSE pg_catalog.pg_has_role(role_oid,acl_item.grantee,'MEMBER') END THEN RAISE EXCEPTION '运行调用者不得转授来源记录权限'; END IF;
    END LOOP;
    END IF; -- Unforgeability is the application-role requirement.
    role_reads := CASE WHEN role_oid=app_oid THEN recipe->'sourceReads' ELSE '{}'::jsonb END;
    FOR table_entry IN SELECT key,value FROM jsonb_each((CASE WHEN role_oid=app_oid THEN recipe->'attachmentReads' ELSE '{}'::jsonb END)||(recipe->'legacyRetentionReads')) LOOP
      SELECT COALESCE(jsonb_agg(DISTINCT value ORDER BY value),'[]'::jsonb) INTO cols FROM jsonb_array_elements(COALESCE(role_reads->table_entry.key,'[]'::jsonb)||table_entry.value);
      role_reads := jsonb_set(role_reads,ARRAY[table_entry.key],cols,TRUE);
    END LOOP;
    FOR table_entry IN SELECT key,value FROM jsonb_each(role_reads) LOOP
      relation_oid := to_regclass(format('public.%I',table_entry.key));
      IF relation_oid IS NULL OR EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid=relation_oid AND (relkind<>'r' OR relrowsecurity OR relforcerowsecurity)) THEN RAISE EXCEPTION '来源读取对象或RLS可见性未封闭'; END IF;
      FOR column_entry IN SELECT jsonb_array_elements_text(table_entry.value) LOOP
        IF NOT pg_catalog.has_column_privilege(role_oid,relation_oid,column_entry,'SELECT') THEN RAISE EXCEPTION '来源逐列读取资格缺失'; END IF;
      END LOOP;
    END LOOP;
    FOR sig IN SELECT jsonb_array_elements_text(CASE WHEN role_oid=app_oid THEN recipe->'applicationExecSignatures' ELSE recipe->'fileExecSignatures' END) LOOP
      IF NOT pg_catalog.has_function_privilege(role_oid,to_regprocedure(sig),'EXECUTE') THEN RAISE EXCEPTION '新来源例程真实EXEC资格尚未供应'; END IF;
    END LOOP;
    IF NOT pg_catalog.has_function_privilege(role_oid,'public.jg_has_exclusive_file_business_binding(text)'::regprocedure,'EXECUTE')
      OR NOT pg_catalog.has_function_privilege(role_oid,'public.jg_enforce_exclusive_file_business_binding()'::regprocedure,'EXECUTE') THEN RAISE EXCEPTION '原文件排他链调用资格缺失'; END IF;
  END LOOP;
  IF NOT pg_catalog.has_any_column_privilege(app_oid,'public."FileObject"'::regclass,'UPDATE') THEN RAISE EXCEPTION '新原件绑定守卫缺少FileObject行锁所需写资格'; END IF;
  IF NOT pg_catalog.has_function_privilege(app_oid,'pg_catalog.pg_advisory_xact_lock(integer,integer)'::regprocedure,'EXECUTE') THEN RAISE EXCEPTION '新原件绑定守卫缺少原全局锁接口资格'; END IF;
  IF NOT pg_catalog.has_column_privilege(app_oid,'public."ContractVersion"'::regclass,'originalSignedNumber','INSERT')
    OR NOT pg_catalog.has_column_privilege(app_oid,'public."ContractVersion"'::regclass,'originalSignedNumber','UPDATE') THEN RAISE EXCEPTION '原号新增列写资格尚未供应'; END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='pg_catalog' AND recipe->'builtinNames' ? p.proname AND NOT pg_catalog.has_function_privilege(app_oid,p.oid,'EXECUTE'))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(recipe->'builtinNames') required WHERE NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='pg_catalog' AND p.proname=required.value))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_operator op JOIN pg_catalog.pg_namespace n ON n.oid=op.oprnamespace LEFT JOIN pg_catalog.pg_type l ON l.oid=op.oprleft LEFT JOIN pg_catalog.pg_type r ON r.oid=op.oprright WHERE n.nspname='pg_catalog' AND recipe->'operatorNames' ? op.oprname AND recipe->'operatorTypeNames' ? l.typname AND recipe->'operatorTypeNames' ? r.typname AND NOT pg_catalog.has_function_privilege(app_oid,op.oprcode,'EXECUTE'))
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='pg_catalog' AND recipe->'operatorTypeNames' ? t.typname AND (NOT pg_catalog.has_function_privilege(app_oid,t.typinput,'EXECUTE') OR NOT pg_catalog.has_function_privilege(app_oid,t.typoutput,'EXECUTE'))) THEN
    RAISE EXCEPTION '本来源所用内建函数、运算或转换的执行资格尚未供应';
  END IF;
  FOR fn_entry IN SELECT value FROM jsonb_array_elements(recipe->'routines') LOOP
    function_oid := to_regprocedure(fn_entry->>'signature');
    SELECT p.oid,p.pronamespace,p.proowner,p.prosrc,p.prosecdef,p.proconfig,p.proacl,p.provolatile,p.proparallel,p.proisstrict,p.proretset,l.lanname,t.typname
      INTO actual FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang JOIN pg_catalog.pg_type t ON t.oid=p.prorettype WHERE p.oid=function_oid;
    IF function_oid IS NULL OR actual.pronamespace<>namespace_oid OR actual.lanname IS DISTINCT FROM fn_entry->>'language'
      OR actual.prosecdef IS DISTINCT FROM (fn_entry->>'securityDefiner')::boolean
      OR actual.typname IS DISTINCT FROM fn_entry->>'returnType' OR actual.provolatile IS DISTINCT FROM fn_entry->>'volatility'
      OR actual.proparallel IS DISTINCT FROM fn_entry->>'parallel' OR actual.proisstrict IS DISTINCT FROM (fn_entry->>'strict')::boolean
      OR actual.proretset IS DISTINCT FROM (fn_entry->>'returnsSet')::boolean
      OR CASE WHEN fn_entry->'searchPath'='null'::jsonb THEN actual.proconfig IS NOT NULL ELSE
        cardinality(actual.proconfig) IS DISTINCT FROM 1 OR left(actual.proconfig[1],12) IS DISTINCT FROM 'search_path='
        OR ARRAY(SELECT btrim(part) FROM unnest(string_to_array(substr(actual.proconfig[1],13),',')) part) IS DISTINCT FROM ARRAY(SELECT jsonb_array_elements_text(fn_entry->'searchPath')) END
      OR encode(public.digest(convert_to(actual.prosrc,'UTF8'),'sha256'),'hex') IS DISTINCT FROM fn_entry->>'bodySha256' THEN RAISE EXCEPTION '已审来源例程接口或源码漂移'; END IF;
    routines := routines || jsonb_build_object(fn_entry->>'signature',jsonb_build_object('oid',function_oid::text,'namespaceOid',actual.pronamespace::text,'ownerOid',actual.proowner::text,'bodySha256',fn_entry->>'bodySha256','securityDefiner',actual.prosecdef,'configuration',actual.proconfig,'acl',actual.proacl,'language',actual.lanname,'returnType',actual.typname,'volatility',actual.provolatile,'parallel',actual.proparallel,'strict',actual.proisstrict,'returnsSet',actual.proretset));
  END LOOP;
  FOR table_entry IN SELECT key FROM jsonb_each((recipe->'sourceReads')||(recipe->'attachmentReads')||(recipe->'legacyRetentionReads'))
    UNION ALL SELECT 'jg_contract_direct_pending_binding_v1' LOOP
    relation_oid := to_regclass(format('public.%I',table_entry.key));
    SELECT c.relowner INTO relation_owner FROM pg_catalog.pg_class c WHERE c.oid=relation_oid AND c.relnamespace=namespace_oid AND c.relkind='r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity;
    IF relation_owner IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid IN
      (to_regprocedure('public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayloadV2",text,text)'),to_regprocedure('public.jg_contract_archive_v2_parent_guard()')) AND p.proowner=relation_owner) THEN RAISE EXCEPTION '来源关系owner闭包未确认'; END IF;
    SELECT jsonb_agg(jsonb_build_object('name',attname,'number',attnum,'typeOid',atttypid::text,'notNull',attnotnull,'generated',attgenerated,'identity',attidentity) ORDER BY attnum) INTO cols
      FROM pg_catalog.pg_attribute WHERE attrelid=relation_oid AND attnum>0 AND NOT attisdropped;
    rels := rels || jsonb_build_object(table_entry.key,jsonb_build_object('oid',relation_oid::text,'namespaceOid',namespace_oid::text,'ownerOid',relation_owner::text,'columns',cols));
  END LOOP;
  FOR sig IN SELECT jsonb_array_elements_text(recipe->'applicationCatalogExecSignatures') LOOP
    IF pg_catalog.has_function_privilege(app_oid,pg_catalog.to_regprocedure(sig),'EXECUTE') IS DISTINCT FROM TRUE THEN RAISE EXCEPTION '来源目录定义接口资格尚未供应'; END IF;
  END LOOP;
  FOR trigger_entry IN SELECT value FROM jsonb_array_elements(recipe->'triggers') LOOP
    SELECT tg.oid,tg.tgrelid,tg.tgfoid,tg.tgtype,tg.tgenabled,tg.tgdeferrable,tg.tginitdeferred,tg.tgqual,tg.tgargs,tg.tgisinternal,tg.tgnargs,tg.tgattr INTO actual_trigger
      FROM pg_catalog.pg_trigger tg WHERE tg.tgrelid=to_regclass(format('public.%I',trigger_entry->>'table')) AND tg.tgname=trigger_entry->>'name';
    IF actual_trigger.oid IS NULL OR actual_trigger.tgfoid IS DISTINCT FROM to_regprocedure(trigger_entry->>'function')
      OR actual_trigger.tgtype IS DISTINCT FROM (trigger_entry->>'type')::smallint OR actual_trigger.tgenabled<>'O'
      OR actual_trigger.tgdeferrable OR actual_trigger.tginitdeferred
      OR actual_trigger.tgisinternal OR actual_trigger.tgnargs IS DISTINCT FROM (trigger_entry->>'argumentCount')::integer
      OR encode(actual_trigger.tgargs,'hex') IS DISTINCT FROM trigger_entry->>'arguments'
      OR actual_trigger.tgattr::text IS DISTINCT FROM COALESCE((SELECT string_agg(a.attnum::text,' ' ORDER BY requested.ordinality)
        FROM jsonb_array_elements_text(trigger_entry->'columns') WITH ORDINALITY requested(name,ordinality)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=actual_trigger.tgrelid AND a.attname=requested.name AND NOT a.attisdropped),'')
      OR CASE WHEN trigger_entry->'definitions'='null'::jsonb THEN actual_trigger.tgqual IS NOT NULL ELSE
        actual_trigger.tgqual IS NULL OR (trigger_entry->'definitions' ? pg_catalog.pg_get_triggerdef(actual_trigger.oid,false)) IS DISTINCT FROM TRUE END THEN
      RAISE EXCEPTION '新来源触发器接口、启用或绑定关系不一致';
    END IF;
    triggers := triggers || jsonb_build_object(trigger_entry->>'name',jsonb_build_object('oid',actual_trigger.oid::text,'relationOid',actual_trigger.tgrelid::text,'functionOid',actual_trigger.tgfoid::text,'type',actual_trigger.tgtype,'enabled',actual_trigger.tgenabled,'deferrable',actual_trigger.tgdeferrable,'initiallyDeferred',actual_trigger.tginitdeferred,'hasCondition',actual_trigger.tgqual IS NOT NULL,'definition',CASE WHEN actual_trigger.tgqual IS NULL THEN NULL ELSE pg_catalog.pg_get_triggerdef(actual_trigger.oid,false) END,'internal',actual_trigger.tgisinternal,'argumentCount',actual_trigger.tgnargs,'attributes',actual_trigger.tgattr::text,'arguments',encode(actual_trigger.tgargs,'hex')));
  END LOOP;
  -- This INSERT requires separately authorized exact ACL supply above. No
  -- default PUBLIC/owner/finance fallback and no GRANT is performed here.
  INSERT INTO public.jg_contract_direct_pending_binding_v1("protocolVersion","recipeVersion","applicationRoleOid","fileCallerOids","databaseOid","anchorNamespaceOid","anchorOwnerOid","bindings")
    VALUES(1,recipe->>'recipeVersion',app_oid,file_oids,db_oid,namespace_oid,owner_oid,jsonb_build_object('relations',rels,'routines',routines,'triggers',triggers));
END;
$binding_install$;

COMMIT;
