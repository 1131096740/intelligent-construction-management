-- Detached upward read source. Existing 205 version and original-slot guards
-- still prevent upward insertion. This migration supplies no role or write path.
BEGIN;

CREATE FUNCTION public.jg_contract_upward_pending_read_v1(p_version_id TEXT, p_actor_id TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $upward_pending$
DECLARE
  v RECORD; a RECORD; enterprise RECORD; company RECORD; participation RECORD;
  d JSONB; q JSONB; file_row RECORD; payment RECORD; terms JSONB;
  files JSONB := '[]'::jsonb; file_ids TEXT[] := ARRAY[]::TEXT[];
  n INTEGER := 0; signed_day TEXT;
  utc_now TIMESTAMP := timezone('UTC', statement_timestamp());
  business_day DATE := timezone('Asia/Shanghai', statement_timestamp())::date;
BEGIN
  SELECT cv."id",cv."contractId",cv."versionNo",cv."changeType",cv."status",cv."numericProtocolVersion",cv."draftRevision",
    cv."signingSubjectType",cv."supersedesVersionId",cv."firstSubmittedAt",cv."effectiveAt",cv."endedAt",cv."documentContentFingerprint",
    cv."draftData",cv."originalSignedNumber",cv."amountYuan",cv."amountLimitType",cv."pricingNature",cv."amountSource",cv."invoiceType",
    cv."taxMode",cv."defaultTaxRatePercent",cv."affiliateAssignmentId",cv."affiliateBusinessPartyVersionId",cv."affiliateNameSnapshot",
    cv."affiliateCreditCodeSnapshot",cv."companyEntityIdSnapshot",cv."companyEntityVersionId",cv."companyEntityNameSnapshot",
    cv."companyEntityCreditCodeSnapshot",cv."companyEntityRegisteredAddressSnapshot",
    c."projectId",c."name" AS contract_name,c."contractTypeKey",c."companyEntityId" AS parent_company_id
    INTO v FROM public."ContractVersion" cv
    JOIN public."Contract" c ON c."id"=cv."contractId"
    JOIN public."Project" p ON p."id"=c."projectId" AND p."isActive"
    WHERE cv."id"=p_version_id AND c."ownerUserId"=p_actor_id AND c."voidedAt" IS NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;

  d := v."draftData"->'directSigningInput';
  IF v."versionNo"<>1 OR v."changeType" IS DISTINCT FROM 'original' OR v."numericProtocolVersion"<>2
    OR v."status" IS DISTINCT FROM 'draft' OR v."signingSubjectType" IS DISTINCT FROM 'upward'
    OR v."supersedesVersionId" IS NOT NULL OR v."firstSubmittedAt" IS NOT NULL OR v."effectiveAt" IS NOT NULL
    OR v."endedAt" IS NOT NULL OR v."documentContentFingerprint" IS NOT NULL
    OR jsonb_typeof(d) IS DISTINCT FROM 'object'
    OR NOT d ?& ARRAY['protocolVersion','source','relationship','signedOn','enterpriseParty','companyParty','companyParticipationId','fixedPaymentTermsVersionId']
    OR (d - ARRAY['protocolVersion','source','relationship','signedOn','enterpriseParty','companyParty','companyParticipationId','fixedPaymentTermsVersionId'])<>'{}'::jsonb
    OR d->'protocolVersion' IS DISTINCT FROM '2'::jsonb OR d->>'source' IS DISTINCT FROM 'direct_signed'
    OR d->>'relationship' IS DISTINCT FROM 'upward' OR v."draftData"#>>'{contractBasics,relationship}' IS DISTINCT FROM 'upward'
    OR v."contractTypeKey" NOT IN ('material_purchase','equipment_rental','labor_subcontract','professional_subcontract','other')
    OR v."draftData"#>>'{contractBasics,businessType}' IS DISTINCT FROM v."contractTypeKey"
    OR length(btrim(v.contract_name))=0 OR v."originalSignedNumber"='' THEN
    RETURN NULL;
  END IF;
  IF d->'signedOn'<>'null'::jsonb THEN
    signed_day := d->>'signedOn';
    IF jsonb_typeof(d->'signedOn')<>'string' OR signed_day !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR left(signed_day,4)='0000' THEN RETURN NULL; END IF;
    BEGIN
      IF to_char(make_date(left(signed_day,4)::int,substring(signed_day,6,2)::int,right(signed_day,2)::int),'YYYY-MM-DD')<>signed_day THEN RETURN NULL; END IF;
    EXCEPTION WHEN datetime_field_overflow THEN RETURN NULL;
    END;
  END IF;
  IF NOT (
    (d->'enterpriseParty' = '{"roleKey":"party_a","displayOrder":0}'::jsonb AND d->'companyParty' = '{"roleKey":"party_b","displayOrder":0}'::jsonb) OR
    (d->'enterpriseParty' = '{"roleKey":"party_b","displayOrder":0}'::jsonb AND d->'companyParty' = '{"roleKey":"party_a","displayOrder":0}'::jsonb)
  ) THEN RETURN NULL; END IF;

  SELECT aa."id",aa."businessPartyId",aa."businessPartyVersionId",aa."affiliateNameSnapshot",aa."affiliateCreditCodeSnapshot",aa."effectiveFrom",aa."endedAt" INTO a FROM public."ProjectAffiliateAssignment" aa
    WHERE aa."projectId"=v."projectId" AND aa."effectiveFrom"<=utc_now AND (aa."endedAt" IS NULL OR utc_now<aa."endedAt");
  IF NOT FOUND OR a."id" IS DISTINCT FROM v."affiliateAssignmentId"
    OR a."businessPartyVersionId" IS DISTINCT FROM v."affiliateBusinessPartyVersionId"
    OR a."affiliateNameSnapshot" IS DISTINCT FROM v."affiliateNameSnapshot"
    OR a."affiliateCreditCodeSnapshot" IS DISTINCT FROM v."affiliateCreditCodeSnapshot"
    OR (SELECT count(*) FROM public."ProjectAffiliateAssignment" aa WHERE aa."projectId"=v."projectId"
      AND aa."effectiveFrom"<=utc_now AND (aa."endedAt" IS NULL OR utc_now<aa."endedAt"))<>1 THEN RETURN NULL; END IF;
  SELECT cps."id", bpv."snapshot" INTO enterprise FROM public."ContractPartySnapshot" cps
    JOIN public."BusinessPartyVersion" bpv ON bpv."id"=cps."businessPartyVersionId"
    JOIN public."BusinessParty" bp ON bp."id"=bpv."businessPartyId" AND bp."status"='active'
    WHERE cps."contractVersionId"=v."id" AND cps."roleKey"=d#>>'{enterpriseParty,roleKey}' AND cps."displayOrder"=0
      AND bpv."id"=a."businessPartyVersionId" AND bpv."businessPartyId"=a."businessPartyId"
      AND cps."snapshot"=bpv."snapshot" AND jsonb_typeof(bpv."snapshot")='object';
  IF NOT FOUND OR (SELECT count(*) FROM public."ContractPartySnapshot" cps WHERE cps."contractVersionId"=v."id")<>1
    OR enterprise."snapshot"->>'name' IS DISTINCT FROM a."affiliateNameSnapshot"
    OR enterprise."snapshot"->>'unifiedSocialCreditCode' IS DISTINCT FROM a."affiliateCreditCodeSnapshot" THEN RETURN NULL; END IF;

  SELECT ev."id",ev."companyEntityId",ev."name",ev."unifiedSocialCreditCode",ev."registeredAddress" INTO company FROM public."CompanyEntity" e JOIN public."CompanyEntityVersion" ev
    ON ev."companyEntityId"=e."id" AND ev."versionNo"=e."currentVersionNo"
    WHERE e."id"=v."companyEntityIdSnapshot" AND e."id"=v.parent_company_id AND e."isActive" AND e."dataStatus"='complete'
      AND ev."isActive" AND ev."id"=v."companyEntityVersionId";
  IF NOT FOUND OR company."name" IS DISTINCT FROM v."companyEntityNameSnapshot"
    OR company."unifiedSocialCreditCode" IS DISTINCT FROM v."companyEntityCreditCodeSnapshot"
    OR company."registeredAddress" IS DISTINCT FROM v."companyEntityRegisteredAddressSnapshot"
    OR NULLIF(btrim(company."unifiedSocialCreditCode"),'') IS NULL
    OR upper(btrim(company."unifiedSocialCreditCode"))=upper(btrim(a."affiliateCreditCodeSnapshot")) THEN RETURN NULL; END IF;
  SELECT pc."id",pc."companyEntityVersionId",pc."effectiveFrom",pc."endedAt" INTO participation FROM public."ProjectParticipatingCompany" pc
    JOIN public."CompanyEntityVersion" joined ON joined."id"=pc."companyEntityVersionId" AND joined."companyEntityId"=pc."companyEntityId"
    WHERE pc."id"=d->>'companyParticipationId' AND pc."projectId"=v."projectId" AND pc."companyEntityId"=company."companyEntityId"
      AND pc."effectiveFrom"<=business_day AND (pc."endedAt" IS NULL OR business_day<pc."endedAt");
  IF NOT FOUND OR (SELECT count(*) FROM public."ProjectParticipatingCompany" pc WHERE pc."projectId"=v."projectId"
    AND pc."companyEntityId"=company."companyEntityId" AND pc."effectiveFrom"<=business_day AND (pc."endedAt" IS NULL OR business_day<pc."endedAt"))<>1 THEN RETURN NULL; END IF;

  IF jsonb_typeof(d->'fixedPaymentTermsVersionId') NOT IN ('string','null')
    OR jsonb_typeof(d->'companyParticipationId') IS DISTINCT FROM 'string' THEN RETURN NULL; END IF;
  IF d->'fixedPaymentTermsVersionId'='null'::jsonb THEN
    IF EXISTS (SELECT 1 FROM public."PaymentTermsVersion" pt WHERE pt."contractVersionId"=v."id") THEN RETURN NULL; END IF;
  ELSE
    SELECT pt."id",pt."versionNo",pt."originalText" INTO payment FROM public."PaymentTermsVersion" pt
      WHERE pt."id"=d->>'fixedPaymentTermsVersionId' AND pt."contractVersionId"=v."id" AND pt."contractId"=v."contractId" AND pt."status"='draft';
    IF NOT FOUND OR (SELECT count(*) FROM public."PaymentTermsVersion" pt WHERE pt."contractVersionId"=v."id")<>1
      OR EXISTS (SELECT 1 FROM public."PaymentTermsStage" ps WHERE ps."paymentTermsVersionId"=payment."id") THEN RETURN NULL; END IF;
    terms := jsonb_build_object('id',payment."id",'versionNo',payment."versionNo",'originalText',payment."originalText");
  END IF;

  FOR file_row IN SELECT da."fileId", da."displayOrder", f."mimeType", f."sizeBytes", f."contentSha256",
      f."storageStatus",f."purgeReceiptId",f."supersedesFileObjectId"
    FROM public."ContractDraftAttachment" da LEFT JOIN public."FileObject" f ON f."id"=da."fileId"
    WHERE da."contractVersionId"=v."id" AND da."slotKey"='direct_signed_originals_v1' ORDER BY da."displayOrder" LOOP
    IF file_row."displayOrder" IS DISTINCT FROM n OR n>=20 OR file_row."fileId"=ANY(file_ids)
      OR file_row."mimeType" IS NULL OR file_row."mimeType" NOT IN ('application/pdf','image/jpeg','image/png')
      OR file_row."storageStatus" IS DISTINCT FROM 'active' OR file_row."purgeReceiptId" IS NOT NULL
      OR file_row."supersedesFileObjectId" IS NOT NULL OR file_row."sizeBytes" IS NULL OR file_row."sizeBytes"<=0
      OR file_row."contentSha256" IS NULL OR file_row."contentSha256" !~ '^[a-f0-9]{64}$'
      OR EXISTS (SELECT 1 FROM public."FileObject" newer WHERE newer."supersedesFileObjectId"=file_row."fileId")
      OR (SELECT count(*) FROM public."ContractDraftAttachment" da WHERE da."fileId"=file_row."fileId")<>1 THEN RETURN NULL; END IF;
    file_ids := array_append(file_ids,file_row."fileId");
    files := files || jsonb_build_array(jsonb_build_object('fileId',file_row."fileId",'displayOrder',n,'mimeType',file_row."mimeType",'sizeBytes',file_row."sizeBytes",'contentSha256',file_row."contentSha256"));
    n := n+1;
  END LOOP;
  IF n=0 THEN RETURN NULL; END IF;

  q := jsonb_build_object('inputProtocolVersion',2,'source',jsonb_build_object('kind','direct_signed','relationship','upward'),
    'locator',jsonb_build_object('projectId',v."projectId",'contractId',v."contractId",'contractVersionId',v."id",'versionNo',1,'changeType','original','draftRevision',v."draftRevision"),
    'contract',jsonb_build_object('businessType',v."contractTypeKey",'name',v.contract_name,'originalSignedNumber',v."originalSignedNumber",'signedOn',d->'signedOn'),
    'money',jsonb_build_object('numericProtocolVersion',2,'amountYuan',v."amountYuan"::numeric(24,4)::text,'amountLimitType',v."amountLimitType",'pricingNature',v."pricingNature",'amountSource',v."amountSource"),
    'tax',jsonb_build_object('amountBasis',v."draftData"#>>'{contractBasics,amountBasis}','invoiceType',v."invoiceType",'taxMode',v."taxMode",'defaultTaxRatePercent',v."defaultTaxRatePercent"::numeric(9,6)::text),
    'terms',jsonb_build_object('settlementText',coalesce(v."draftData"#>>'{contractBasics,settlementText}',''),'paymentTerms',terms),
    'subjects',jsonb_build_object(
      'enterprise',jsonb_build_object('projectId',v."projectId",'position',d->'enterpriseParty','cpsId',enterprise."id",'assignmentId',a."id",'businessPartyId',a."businessPartyId",'businessPartyVersionId',a."businessPartyVersionId",
        'name',a."affiliateNameSnapshot",'creditCode',a."affiliateCreditCodeSnapshot",'effectiveFrom',to_char(a."effectiveFrom",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'endedAt',to_char(a."endedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
      'company',jsonb_build_object('projectId',v."projectId",'position',d->'companyParty','participationId',participation."id",'companyEntityId',company."companyEntityId",'companyEntityVersionId',company."id",'joinedCompanyEntityVersionId',participation."companyEntityVersionId",
        'name',company."name",'creditCode',company."unifiedSocialCreditCode",'address',company."registeredAddress",'effectiveFrom',to_char(participation."effectiveFrom",'YYYY-MM-DD'),'endedAt',to_char(participation."endedAt",'YYYY-MM-DD'))),
    'signedFiles',files);
  RETURN jsonb_build_object('Q',q,'qText',q::text,'inputSha256',encode(public.digest(convert_to(q::text,'UTF8'),'sha256'),'hex'));
END;
$upward_pending$;

REVOKE ALL ON FUNCTION public.jg_contract_upward_pending_read_v1(TEXT,TEXT) FROM PUBLIC;

COMMIT;
