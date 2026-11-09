-- Verify outside generated commitment from its original archive, without granting a write path.
BEGIN;
SET LOCAL search_path TO pg_catalog,public;

LOCK TABLE public."ContractArchiveFile",public.jg_contract_generated_archive_completion_v1 IN ACCESS EXCLUSIVE MODE;

CREATE FUNCTION public.jg_generated_outside_commitment_basis_v1(archive_id TEXT) RETURNS JSONB
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $basis$
DECLARE
  a RECORD;
  v RECORD;
  c RECORD;
  assignment RECORD;
  downstream_row RECORD;
  x JSONB;
  identity JSONB;
  enterprise JSONB;
  downstream JSONB;
  parties JSONB;
  party_e RECORD;
  party_d RECORD;
  n BIGINT;
  review RECORD;
  review_document JSONB;
  coverage_row JSONB;
  review_sources JSONB:='[]'::jsonb;
  seen_pairs JSONB:='[]'::jsonb;
  review_pair JSONB;
  side TEXT;
  left_yuan NUMERIC;
  right_yuan NUMERIC;
  excluded_yuan NUMERIC:=0;
  commitment_delta NUMERIC;
  expected_source JSONB;
  fact_source JSONB;
  fact_basis JSONB;
  amount_state TEXT;
  amount_nature TEXT;
  archive_day DATE;
  archive_instant TEXT;
  debtor JSONB;
  creditor JSONB;
  ledger_date DATE;
  xid TEXT:=mod(pg_catalog.txid_current(),4294967296::bigint)::text;
BEGIN
  SELECT af.*,af.xmin::text AS row_xid INTO a FROM public."ContractArchiveFile" af WHERE af."id"=archive_id;
  IF NOT FOUND OR a.row_xid<>xid OR a."archiveProtocolVersion" IS DISTINCT FROM 2
    OR a."archiveSource" IS DISTINCT FROM 'generated_approval' OR a."status" IS DISTINCT FROM 'confirmed'
    OR a."fileId" IS NOT NULL OR a."confirmedAt" IS NULL OR a."confirmedByUserId" IS DISTINCT FROM a."uploadedByUserId" THEN
    RAISE EXCEPTION '表外承诺缺少同事务的正式原件归档' USING ERRCODE='23514';
  END IF;

  SELECT cv.* INTO v FROM public."ContractVersion" cv WHERE cv."id"=a."contractVersionId";
  IF NOT FOUND OR v."numericProtocolVersion" IS DISTINCT FROM 2 OR v."signingSubjectType" IS DISTINCT FROM 'affiliate'
    OR v."changeType" IS DISTINCT FROM 'original' OR v."versionNo" IS DISTINCT FROM 1
    OR v."supersedesVersionId" IS NOT NULL OR v."firstSubmittedAt" IS NULL
    OR v."status" NOT IN ('seal_approved_pending_archive','effective')
    OR jsonb_typeof(v."draftData") IS DISTINCT FROM 'object' OR v."draftData"?'directSigningInput'
    OR v."draftData"#>>'{contractBasics,relationship}' IS DISTINCT FROM 'outside'
    OR v."companyEntityIdSnapshot" IS NOT NULL OR v."companyEntityVersionId" IS NOT NULL
    OR v."companyEntityNameSnapshot" IS NOT NULL OR v."companyEntityCreditCodeSnapshot" IS NOT NULL
    OR v."companyEntityRegisteredAddressSnapshot" IS NOT NULL THEN
    RAISE EXCEPTION '表外承诺仅接受当前原表外版本的纸面关系' USING ERRCODE='23514';
  END IF;

  SELECT ct.* INTO c FROM public."Contract" ct WHERE ct."id"=v."contractId" FOR SHARE;
  IF NOT FOUND OR c."companyEntityId" IS NOT NULL OR c."voidedAt" IS NOT NULL
    OR c."ownerUserId" IS DISTINCT FROM a."uploadedByUserId" OR NULLIF(btrim(c."code"),'') IS NULL THEN
    RAISE EXCEPTION '表外承诺缺少项目和当前原经办' USING ERRCODE='23514';
  END IF;
  SELECT p."operatingLedgerEffectiveDate" INTO ledger_date FROM public."Project" p
    WHERE p."id"=c."projectId" AND p."isActive" FOR SHARE;
  IF NOT FOUND OR ledger_date IS NULL THEN
    RAISE EXCEPTION '表外承诺仅适用于已启用的同一项目经营账' USING ERRCODE='23514';
  END IF;

  x:=a."authoritySnapshot"->'sourceBasis';
  identity:=x#>'{subjects,signingIdentity}';
  enterprise:=identity->'enterprise';
  downstream:=identity->'downstream';
  parties:=x#>'{subjects,parties}';
  archive_day:=((a."confirmedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date;
  archive_instant:=to_char(a."confirmedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  IF a."authoritySnapshot"->'authorityProtocolVersion' IS DISTINCT FROM '1'::jsonb
    OR a."authoritySnapshot"->>'projectId' IS DISTINCT FROM c."projectId"
    OR a."authoritySnapshot"->>'contractId' IS DISTINCT FROM c."id"
    OR a."authoritySnapshot"->>'contractVersionId' IS DISTINCT FROM v."id"
    OR a."authoritySnapshot"->>'handlerUserId' IS DISTINCT FROM a."uploadedByUserId"
    OR a."authoritySnapshot"->>'archiveSource' IS DISTINCT FROM a."archiveSource"
    OR a."authoritySnapshot"->>'requestSha256' IS DISTINCT FROM a."requestSha256"
    OR a."authoritySnapshot"->>'approvalInstanceId' IS DISTINCT FROM a."approvalInstanceId"
    OR a."authoritySnapshot"->>'sealTaskId' IS DISTINCT FROM a."sealTaskId"
    OR a."authoritySnapshot"->>'archivedAt' IS DISTINCT FROM archive_instant
    OR a."authoritySha256" IS DISTINCT FROM encode(public.digest(convert_to(a."authoritySnapshot"::text,'UTF8'),'sha256'),'hex')
    OR a."authoritySnapshot"->>'sourceBasisSha256' IS DISTINCT FROM encode(public.digest(convert_to(x::text,'UTF8'),'sha256'),'hex')
    OR x->'basisProtocolVersion' IS DISTINCT FROM '1'::jsonb
    OR x->'sourceLocator' IS DISTINCT FROM jsonb_build_object('projectId',c."projectId",'contractId',c."id",
      'contractVersionId',v."id",'sourceType','contract_version','sourceBusinessId',v."id",'entryKind','original',
      'sourceVersion',v."versionNo",'versionNo',v."versionNo",'changeType','original','formalCode',c."code")
    OR x->'businessTime' IS DISTINCT FROM jsonb_build_object('archivedAt',archive_instant,'businessDay',archive_day,'handlerUserId',a."uploadedByUserId")
    OR x#>'{termsAndTax,paymentTerms}' IS DISTINCT FROM v."readinessSnapshot"->'paymentTerms'
    OR x#>'{termsAndTax,taxFacts}' IS DISTINCT FROM v."readinessSnapshot"->'taxFacts'
    OR identity IS DISTINCT FROM v."readinessSnapshot"->'signingIdentity'
    OR identity->'protocolVersion' IS DISTINCT FROM '1'::jsonb OR identity->>'relationship' IS DISTINCT FROM 'outside'
    OR identity->>'roleSource' IS DISTINCT FROM 'document_party_snapshots'
    OR parties IS DISTINCT FROM v."readinessSnapshot"->'parties' OR jsonb_typeof(parties) IS DISTINCT FROM 'array'
    OR NOT EXISTS (SELECT 1 FROM public."ApprovalInstance" r JOIN public."ContractSealTask" t ON t."approvalInstanceId"=r."id"
      WHERE r."id"=a."approvalInstanceId" AND r."businessId"=v."id" AND r."businessType"='contract_version'
        AND r."flowType"='contract.approve' AND r."status"='approved' AND r."applicantUserId"=c."ownerUserId"
        AND r."frozenNodes"->0->'submissionSnapshot'=v."readinessSnapshot"
        AND t."id"=a."sealTaskId" AND t."contractVersionId"=v."id" AND t."handlerUserId"=c."ownerUserId"
        AND t."status"='completed' AND t."completedByUserId" IS NOT NULL AND t."completedAt"<=a."confirmedAt"
        AND a."sourceRevision"=v."draftRevision" AND a."documentContentRevision"=v."documentContentRevision"
        AND a."documentContentFingerprint"=v."documentContentFingerprint") THEN
    RAISE EXCEPTION '表外承诺必须引用原审批、盖章、经办和真实冻结来源' USING ERRCODE='23514';
  END IF;

  IF jsonb_array_length(parties)<>2 OR enterprise->>'domain' IS DISTINCT FROM 'project_affiliate_assignment'
    OR enterprise->>'assignmentId' IS DISTINCT FROM v."affiliateAssignmentId"
    OR enterprise->>'businessPartyVersionId' IS DISTINCT FROM v."affiliateBusinessPartyVersionId"
    OR (enterprise->>'roleKey' IS DISTINCT FROM 'party_a' AND enterprise->>'roleKey' IS DISTINCT FROM 'party_b')
    OR downstream->>'roleKey' IS DISTINCT FROM (CASE WHEN enterprise->>'roleKey'='party_a' THEN 'party_b' ELSE 'party_a' END)
    OR enterprise->'displayOrder' IS DISTINCT FROM '0'::jsonb OR downstream->'displayOrder' IS DISTINCT FROM '0'::jsonb
    OR enterprise->>'partySnapshotId' IS NOT DISTINCT FROM downstream->>'partySnapshotId' THEN
    RAISE EXCEPTION '表外承诺必须区分纸面施工企业和不同下游' USING ERRCODE='23514';
  END IF;

  SELECT pa.*,bp."snapshot" AS party_snapshot INTO assignment FROM public."ProjectAffiliateAssignment" pa
    JOIN public."BusinessPartyVersion" bp ON bp."id"=pa."businessPartyVersionId" AND bp."businessPartyId"=pa."businessPartyId"
    WHERE pa."id"=v."affiliateAssignmentId" AND pa."projectId"=c."projectId"
      AND pa."businessPartyVersionId"=v."affiliateBusinessPartyVersionId" AND pa."businessPartyId"=enterprise->>'businessPartyId'
      AND pa."effectiveFrom"<=a."confirmedAt" AND (pa."endedAt" IS NULL OR pa."endedAt">a."confirmedAt");
  IF NOT FOUND OR assignment."affiliateNameSnapshot" IS DISTINCT FROM v."affiliateNameSnapshot"
    OR assignment."affiliateCreditCodeSnapshot" IS DISTINCT FROM v."affiliateCreditCodeSnapshot"
    OR enterprise->>'effectiveFrom' IS DISTINCT FROM to_char(assignment."effectiveFrom",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    OR (SELECT count(*) FROM public."ProjectAffiliateAssignment" pa WHERE pa."projectId"=c."projectId"
      AND pa."effectiveFrom"<=a."confirmedAt" AND (pa."endedAt" IS NULL OR pa."endedAt">a."confirmedAt"))<>1 THEN
    RAISE EXCEPTION '表外承诺必须引用实际有效的本项目施工企业版本' USING ERRCODE='23514';
  END IF;

  SELECT p.* INTO party_e FROM public."ContractPartySnapshot" p
    WHERE p."id"=enterprise->>'partySnapshotId' AND p."contractVersionId"=v."id";
  SELECT p.* INTO party_d FROM public."ContractPartySnapshot" p
    WHERE p."id"=downstream->>'partySnapshotId' AND p."contractVersionId"=v."id";
  IF party_e."id" IS NULL OR party_d."id" IS NULL OR party_e."displayOrder"<>0 OR party_d."displayOrder"<>0
    OR party_e."roleKey" IS DISTINCT FROM enterprise->>'roleKey' OR party_d."roleKey" IS DISTINCT FROM downstream->>'roleKey'
    OR party_e."businessPartyVersionId" IS DISTINCT FROM assignment."businessPartyVersionId"
    OR party_e."snapshot" IS DISTINCT FROM assignment.party_snapshot
    OR btrim(party_e."snapshot"->>'name') IS DISTINCT FROM v."affiliateNameSnapshot"
    OR NULLIF(btrim(party_e."snapshot"->>'unifiedSocialCreditCode'),'') IS DISTINCT FROM v."affiliateCreditCodeSnapshot"
    OR NULLIF(btrim(party_d."snapshot"->>'name'),'') IS NULL
    OR (NULLIF(upper(btrim(party_d."snapshot"->>'unifiedSocialCreditCode')),'') IS NOT NULL
      AND NULLIF(upper(btrim(party_d."snapshot"->>'unifiedSocialCreditCode')),'')=upper(btrim(v."affiliateCreditCodeSnapshot")))
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(parties) f WHERE f->>'id'=party_e."id"
      AND f->>'roleKey'=party_e."roleKey" AND f->'displayOrder'='0'::jsonb
      AND f->>'businessPartyVersionId'=party_e."businessPartyVersionId" AND f->'snapshot'=party_e."snapshot")
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(parties) f WHERE f->>'id'=party_d."id"
      AND f->>'roleKey'=party_d."roleKey" AND f->'displayOrder'='0'::jsonb
      AND (f->>'businessPartyVersionId') IS NOT DISTINCT FROM party_d."businessPartyVersionId" AND f->'snapshot'=party_d."snapshot") THEN
    RAISE EXCEPTION '表外承诺必须绑定原纸面两方及归属版本' USING ERRCODE='23514';
  END IF;
  IF downstream->>'domain'='contract_party_snapshot' THEN
    IF party_d."businessPartyVersionId" IS NOT NULL OR downstream->'businessPartyId' IS DISTINCT FROM 'null'::jsonb
      OR downstream->'businessPartyVersionId' IS DISTINCT FROM 'null'::jsonb
      OR btrim(party_d."snapshot"->>'name')=btrim(party_e."snapshot"->>'name') THEN
      RAISE EXCEPTION '纸面下游必须与施工企业可区分且无伪造受控版本' USING ERRCODE='23514';
    END IF;
    creditor:=jsonb_build_object('kind','downstream_counterparty','id','contract_party_snapshot:'||party_d."id");
  ELSE
    SELECT bp.* INTO downstream_row FROM public."BusinessPartyVersion" bp
      WHERE bp."id"=party_d."businessPartyVersionId" AND bp."id"=downstream->>'businessPartyVersionId'
        AND bp."businessPartyId"=downstream->>'businessPartyId' AND bp."businessPartyId"<>assignment."businessPartyId"
        AND bp."snapshot"=party_d."snapshot";
    IF NOT FOUND OR downstream->>'domain' IS DISTINCT FROM 'business_party_version' THEN
      RAISE EXCEPTION '表外承诺缺少真实不同的受控下游版本' USING ERRCODE='23514';
    END IF;
    creditor:=jsonb_build_object('kind','downstream_counterparty','id',downstream_row."id");
  END IF;

  -- Recompute exclusion from the same version-bound confirmed coverage rules as 204.
  IF (x #>> '{money,numericProtocolVersion}') IS DISTINCT FROM '2'
    OR (x #> '{money,amountCents}') IS DISTINCT FROM 'null'::JSONB
    OR (x #>> '{money,amountLimitType}') IS DISTINCT FROM v."amountLimitType"
    OR (x #>> '{money,pricingNature}') IS DISTINCT FROM v."pricingNature"
    OR (x #>> '{money,amountSource}') IS DISTINCT FROM v."amountSource"
    OR NOT COALESCE((x -> 'money') ? 'amountYuan', FALSE)
    OR NOT COALESCE((x -> 'money') ? 'commitmentDeltaYuan', FALSE)
    OR (x #> '{money,predecessor}') IS DISTINCT FROM 'null'::JSONB
    OR (CASE WHEN v."amountYuan" IS NULL THEN
      (x #>> '{money,amountState}') IS DISTINCT FROM 'unknown' OR (x #> '{money,amountYuan}') IS DISTINCT FROM 'null'::JSONB
      OR (x #> '{money,commitmentDeltaYuan}') IS DISTINCT FROM 'null'::JSONB
    ELSE (x #>> '{money,amountState}') IS DISTINCT FROM 'known'
      OR CASE WHEN (x #>> '{money,amountYuan}') ~ '^(0|[1-9][0-9]{0,19})(\.[0-9]{1,4})?$'
        THEN (x #>> '{money,amountYuan}')::NUMERIC IS DISTINCT FROM v."amountYuan" ELSE TRUE END END) THEN
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
    OR (CASE WHEN x #>> '{money,economicExcludedYuan}' ~ '^(0|[1-9][0-9]{0,19})(\.[0-9]{1,4})?$'
      THEN (x #>> '{money,economicExcludedYuan}')::NUMERIC IS DISTINCT FROM excluded_yuan ELSE TRUE END) THEN
    RAISE EXCEPTION '归档经济排除须与真实已确认适用复核及四位总和一致' USING ERRCODE='23514';
  END IF;
  IF v."amountYuan" IS NOT NULL AND excluded_yuan > v."amountYuan" THEN RAISE EXCEPTION '已确认重叠范围超过合同金额，不能伪造承诺余额' USING ERRCODE='23514'; END IF;
  commitment_delta := CASE WHEN v."amountYuan" IS NULL THEN NULL ELSE v."amountYuan" - excluded_yuan END;
  IF (CASE WHEN commitment_delta IS NULL THEN x #> '{money,commitmentDeltaYuan}' IS DISTINCT FROM 'null'::JSONB
      ELSE CASE WHEN jsonb_typeof(x #> '{money,commitmentDeltaYuan}') = 'string' AND x #>> '{money,commitmentDeltaYuan}' ~ '^-?(0|[1-9][0-9]{0,19})(\.[0-9]{1,4})?$'
        THEN (x #>> '{money,commitmentDeltaYuan}')::NUMERIC IS DISTINCT FROM commitment_delta ELSE TRUE END END)
    OR x #>> '{money,direction}' IS DISTINCT FROM (CASE WHEN commitment_delta IS NULL THEN 'notice' WHEN commitment_delta < 0 THEN 'decrease' ELSE 'increase' END) THEN
    RAISE EXCEPTION '承诺净额及影响方向必须保原金额减真实排除，未知不补零' USING ERRCODE='23514';
  END IF;

  expected_source:=jsonb_build_object('sourceType','contract_version','sourceBusinessId',v."id",
    'sourceVersion',v."versionNo",'entryKind','original','factIdempotencyKey','contract_version:'||v."id",
    'impactIdempotencyKey','contract_version:'||v."id"||':commitment','sourceImpactKey','contract_commitment_reference',
    'impactKind','contract_commitment_reference','numericProtocolVersion',2,
    'amountState',CASE WHEN commitment_delta IS NULL THEN 'unknown' ELSE 'known' END,
    'amountYuan',commitment_delta::numeric(24,4)::text,'sourceBasisSha256',a."authoritySnapshot"->>'sourceBasisSha256',
    'direction',CASE WHEN commitment_delta IS NULL THEN 'notice' ELSE 'increase' END);
  IF a."authoritySnapshot"->'operatingConsequence' IS DISTINCT FROM jsonb_build_object('protocolVersion',1,
    'mode','projection_required','operatingLedgerEffectiveDateSnapshot',ledger_date,'expectedSource',expected_source) THEN
    RAISE EXCEPTION '表外归档必须冻结唯一原下游承诺及经营日期' USING ERRCODE='23514';
  END IF;
  debtor:=jsonb_build_object('kind','construction_enterprise','id',assignment."businessPartyVersionId",
    'businessPartyId',assignment."businessPartyId",'businessPartyVersionId',assignment."businessPartyVersionId",
    'name',assignment."affiliateNameSnapshot",'creditCode',assignment."affiliateCreditCodeSnapshot");
  amount_state:=CASE WHEN v."amountYuan" IS NULL THEN 'unknown' ELSE 'known' END;
  amount_nature:=CASE WHEN v."amountYuan" IS NULL THEN 'uncapped' ELSE 'fixed' END;
  fact_basis:=jsonb_build_object('authority','effective_contract_version','amountNature',amount_nature);
  fact_source:=jsonb_build_object('contractId',c."id",'contractVersionId',v."id",'contractRelationship','outside',
    'signingSubjectType','affiliate','counterpartyVersionId',downstream->'businessPartyVersionId',
    'counterpartySubjectId',creditor->'id','counterpartyName',btrim(party_d."snapshot"->>'name'),'counterpartyIdentity',downstream,
    'archiveProtocolVersion',2,'archiveAuthorityId',a."id",'archiveAuthoritySha256',a."authoritySha256",
    'sourceBasisSha256',expected_source->'sourceBasisSha256','sourceBasis',x,'amountNature',amount_nature,
    'numericProtocolVersion',2,'amountYuan',v."amountYuan"::text,'amountState',amount_state,
    'sourceAmountStatus',v."amountLimitType",'currentAmount',jsonb_build_object('protocolVersion',2,'amountState',amount_state,
      'amountYuan',v."amountYuan"::text,'sourceAmountStatus',v."amountLimitType"),'priorAmount',NULL,'supersedesVersionId',NULL,
    'economicExcludedYuan',excluded_yuan::numeric(24,4)::text,'commitmentDeltaYuan',expected_source->'amountYuan',
    'occurredAt',archive_instant,'confirmedAt',archive_instant,'confirmedByUserId',a."uploadedByUserId",
    'operatingLedgerEffectiveDate',to_char(ledger_date,'YYYY-MM-DD')||'T00:00:00.000Z','archiveBusinessDay',archive_day,
    'affiliate',jsonb_build_object('assignmentId',assignment."id",'businessPartyId',assignment."businessPartyId",
      'businessPartyVersionId',assignment."businessPartyVersionId",'name',assignment."affiliateNameSnapshot",
      'creditCode',assignment."affiliateCreditCodeSnapshot"),
    'numericFacts',jsonb_build_object('protocolVersion',2,'amountState',expected_source->'amountState','amountYuan',expected_source->'amountYuan'));
  RETURN jsonb_build_object('projectId',c."projectId",'contractVersionId',v."id",'sourceBusinessCode',c."code",
    'operatingLedgerEffectiveDateSnapshot',ledger_date,'businessDay',archive_day,'archivedAt',archive_instant,
    'debtor',debtor,'creditor',creditor,'expectedSource',expected_source,'affiliateAssignmentId',assignment."id",
    'factSourceSnapshot',fact_source,'factBasisSnapshot',fact_basis);
END;
$basis$;
REVOKE ALL ON FUNCTION public.jg_generated_outside_commitment_basis_v1(TEXT) FROM PUBLIC;

CREATE FUNCTION public.jg_require_generated_outside_commitment_v1() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $complete$
DECLARE
  scope JSONB;
  expected JSONB;
  debtor JSONB;
  creditor JSONB;
  numeric_facts JSONB;
  f RECORD;
  i RECORD;
  receipt RECORD;
  expected_completion JSONB;
  originals JSONB;
  evidence_ids JSONB;
  original_count BIGINT;
  file_count BIGINT;
  file_ids JSONB;
  audit_count BIGINT;
  matching_audits BIGINT;
  xid TEXT:=mod(pg_catalog.txid_current(),4294967296::bigint)::text;
BEGIN
  IF TG_RELID<>'public."ContractArchiveFile"'::regclass OR TG_OP<>'INSERT' THEN
    RAISE EXCEPTION '表外承诺完成守卫只能接收原归档插入' USING ERRCODE='55000';
  END IF;
  IF NEW."archiveProtocolVersion" IS DISTINCT FROM 2 OR NEW."archiveSource" IS DISTINCT FROM 'generated_approval'
    OR NOT EXISTS(SELECT 1 FROM public."ContractVersion" v JOIN public."Contract" c ON c."id"=v."contractId"
      JOIN public."Project" p ON p."id"=c."projectId"
      WHERE v."id"=NEW."contractVersionId" AND (v."signingSubjectType"='affiliate'
        OR NEW."authoritySnapshot"#>>'{sourceBasis,subjects,signingIdentity,relationship}'='outside')
        AND (p."operatingLedgerEffectiveDate" IS NOT NULL
          OR NEW."authoritySnapshot"#>>'{operatingConsequence,mode}'='projection_required')) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.jg_contract_generated_upward_seal_binding_v1 b
    JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database()
    WHERE b."protocolVersion"=1 AND b."namespaceOid"=pg_catalog.to_regnamespace('public')
      AND b."ownerOid"=current_user::regrole::oid AND session_user::regrole::oid IN (b."applicationRoleOid",b."ownerOid")
      AND pg_catalog.current_setting('session_replication_role')='origin') THEN
    RAISE EXCEPTION '表外承诺完成守卫身份不匹配' USING ERRCODE='55000';
  END IF;

  scope:=public.jg_generated_outside_commitment_basis_v1(NEW."id");
  expected:=scope->'expectedSource';
  debtor:=scope->'debtor';
  creditor:=scope->'creditor';
  numeric_facts:=jsonb_build_object('protocolVersion',2,'amountState',expected->'amountState','amountYuan',expected->'amountYuan');
  IF NOT EXISTS (SELECT 1 FROM public."ContractVersion" v WHERE v."id"=NEW."contractVersionId" AND v.xmin::text=xid
    AND v."status"='effective' AND v."effectiveAt"=NEW."confirmedAt" AND v."taxFactsFrozenAt"=NEW."confirmedAt") THEN
    RAISE EXCEPTION '表外承诺必须与本事务版本生效同时提交' USING ERRCODE='23514';
  END IF;

  IF (SELECT count(*) FROM public."OperatingFact" x
    WHERE x."sourceType"='contract_version' AND x."sourceBusinessId"=NEW."contractVersionId")<>1 THEN
    RAISE EXCEPTION '表外归档只能形成一条原下游承诺事实' USING ERRCODE='23514';
  END IF;
  SELECT fct.*,fct.xmin::text AS row_xid INTO f FROM public."OperatingFact" fct
    WHERE fct."sourceType"='contract_version' AND fct."sourceBusinessId"=NEW."contractVersionId";
  IF NOT FOUND OR f.row_xid<>xid OR f."projectId" IS DISTINCT FROM scope->>'projectId'
    OR f."sourceBusinessCode" IS DISTINCT FROM scope->>'sourceBusinessCode'
    OR to_jsonb(f."sourceVersion") IS DISTINCT FROM expected->'sourceVersion'
    OR f."idempotencyKey" IS DISTINCT FROM expected->>'factIdempotencyKey'
    OR f."entryKind" IS DISTINCT FROM 'original' OR f."status" IS DISTINCT FROM 'confirmed'
    OR f."factKind" IS DISTINCT FROM 'downstream_contract' OR f."operatingLevel" IS DISTINCT FROM 'project'
    OR f."evidenceLevel" IS DISTINCT FROM 'A' OR f."currencyCode" IS DISTINCT FROM 'CNY' OR f."direction" IS DISTINCT FROM 'neutral'
    OR f."numericProtocolVersion" IS DISTINCT FROM 2 OR f."amountCents" IS NOT NULL
    OR (CASE WHEN f."amountYuan" IS NULL THEN 'null'::jsonb ELSE to_jsonb(f."amountYuan"::text) END)
      IS DISTINCT FROM expected->'amountYuan'
    OR f."occurredAt" IS DISTINCT FROM NEW."confirmedAt" OR f."confirmedAt" IS DISTINCT FROM NEW."confirmedAt"
    OR f."confirmedByUserId" IS DISTINCT FROM NEW."uploadedByUserId" OR f."recordedByUserId" IS DISTINCT FROM NEW."uploadedByUserId"
    OR to_jsonb(f."operatingLedgerEffectiveDateSnapshot") IS DISTINCT FROM scope->'operatingLedgerEffectiveDateSnapshot'
    OR f."isBeforeOperatingLedgerEffectiveDate" IS DISTINCT FROM ((scope->>'businessDay')::date<(scope->>'operatingLedgerEffectiveDateSnapshot')::date)
    OR f."affiliateAssignmentId" IS DISTINCT FROM scope->>'affiliateAssignmentId'
    OR f."affiliateBusinessPartyVersionId" IS DISTINCT FROM debtor->>'id'
    OR f."affiliateNameSnapshot" IS DISTINCT FROM debtor->>'name'
    OR f."affiliateCreditCodeSnapshot" IS DISTINCT FROM debtor->>'creditCode'
    OR f."debtorSubjectKind" IS DISTINCT FROM debtor->>'kind' OR f."debtorSubjectId" IS DISTINCT FROM debtor->>'id'
    OR f."creditorSubjectKind" IS DISTINCT FROM creditor->>'kind' OR f."creditorSubjectId" IS DISTINCT FROM creditor->>'id'
    OR f."approvedPayerSubjectKind" IS NOT NULL OR f."approvedPayerSubjectId" IS NOT NULL
    OR f."actualPayerSubjectKind" IS NOT NULL OR f."actualPayerSubjectId" IS NOT NULL
    OR f."payeeSubjectKind" IS NOT NULL OR f."payeeSubjectId" IS NOT NULL
    OR f."costBearingCompanySubjectKind" IS NOT NULL OR f."costBearingCompanySubjectId" IS NOT NULL
    OR f."adjustsFactId" IS NOT NULL OR f."historicalTakeoverBatchId" IS NOT NULL
    OR f."paymentExecutionId" IS NOT NULL OR f."fundExecutionId" IS NOT NULL OR f."fundExecutionCaseId" IS NOT NULL
    OR f."subjectSnapshot" IS DISTINCT FROM jsonb_build_object('debtor',debtor,'creditor',creditor)
    OR f."sourceSnapshot" IS DISTINCT FROM scope->'factSourceSnapshot'
    OR f."basisSnapshot" IS DISTINCT FROM scope->'factBasisSnapshot' THEN
    RAISE EXCEPTION '表外归档必须与施工企业和下游原承诺事实同时提交' USING ERRCODE='23514';
  END IF;

  IF (SELECT count(*) FROM public."OperatingImpactEntry" x WHERE x."factId"=f."id"
    OR (x."sourceType"='contract_version' AND x."sourceBusinessId"=NEW."contractVersionId"))<>1 THEN
    RAISE EXCEPTION '表外归档只能形成一条下游承诺影响' USING ERRCODE='23514';
  END IF;
  SELECT x.*,x.xmin::text AS row_xid INTO i FROM public."OperatingImpactEntry" x WHERE x."factId"=f."id";
  IF NOT FOUND OR i.row_xid<>xid OR i."projectId" IS DISTINCT FROM f."projectId"
    OR i."sourceType" IS DISTINCT FROM f."sourceType" OR i."sourceBusinessId" IS DISTINCT FROM f."sourceBusinessId"
    OR i."idempotencyKey" IS DISTINCT FROM expected->>'impactIdempotencyKey'
    OR i."sourceImpactKey" IS DISTINCT FROM expected->>'sourceImpactKey' OR i."impactKind" IS DISTINCT FROM expected->>'impactKind'
    OR i."direction" IS DISTINCT FROM expected->>'direction' OR i."numericProtocolVersion" IS DISTINCT FROM 2
    OR i."amountCents" IS NOT NULL OR i."amountYuan" IS DISTINCT FROM f."amountYuan"
    OR i."subjectRole" IS DISTINCT FROM 'debtor' OR i."subjectKind" IS DISTINCT FROM debtor->>'kind'
    OR i."subjectId" IS DISTINCT FROM debtor->>'id'
    OR i."costCategoryCode" IS NOT NULL OR i."fundPurpose" IS NOT NULL OR i."paymentExecutionId" IS NOT NULL
    OR i."fundExecutionId" IS NOT NULL OR i."fundExecutionCaseId" IS NOT NULL OR i."executionAllocationLineId" IS NOT NULL
    OR i."description" IS DISTINCT FROM '表外原合同承诺，不形成成本或应付'
    OR i."impactSnapshot" IS DISTINCT FROM jsonb_build_object('numericFacts',numeric_facts,'subjectSnapshot',debtor) THEN
    RAISE EXCEPTION '表外归档只接受原金额、原施工企业的唯一承诺影响' USING ERRCODE='23514';
  END IF;

  SELECT count(*),jsonb_agg(e."id" ORDER BY e."displayOrder"),jsonb_agg(e."fileId" ORDER BY e."displayOrder"),
    jsonb_agg(jsonb_build_object('fileId',e."fileId",'displayOrder',e."displayOrder",'mimeType',e."mimeType",
      'sizeBytes',e."sizeBytes",'contentSha256',e."contentSha256",'bucket',p."bucket",'objectKey',p."objectKey",
      'objectGeneration',p."objectGeneration") ORDER BY e."displayOrder")
    INTO original_count,evidence_ids,file_ids,originals FROM public."ContractArchiveEvidenceFile" e
    JOIN public.jg_contract_generated_archive_original_v1 p ON p."archiveId"=e."archiveFileId" AND p."evidenceId"=e."id"
    WHERE e."archiveFileId"=NEW."id" AND e."contractVersionId"=NEW."contractVersionId" AND e.xmin::text=xid AND p.xmin::text=xid;
  SELECT count(*) INTO file_count FROM public."ContractArchiveEvidenceFile" e WHERE e."archiveFileId"=NEW."id";
  IF original_count NOT BETWEEN 1 AND 20 OR original_count<>file_count THEN
    RAISE EXCEPTION '表外归档必须保留本事务全部有序原件' USING ERRCODE='23514';
  END IF;

  SELECT count(*),count(*) FILTER (WHERE log.xmin::text=xid AND log."actorUserId"=NEW."uploadedByUserId"
    AND log."metadata"->>'actingRoleKey' IN ('contract_director','contract_staff')
    AND log."metadata"-'actingRoleKey'=jsonb_build_object('archiveId',NEW."id",'approvalInstanceId',NEW."approvalInstanceId",
      'sealTaskId',NEW."sealTaskId",'fileIds',file_ids,'authoritySha256',NEW."authoritySha256"))
    INTO audit_count,matching_audits FROM public."AuditLog" log
    WHERE log."businessType"='contract_version' AND log."businessId"=NEW."contractVersionId" AND log."action"='contract.archive.complete';
  IF audit_count<>1 OR matching_audits<>1 THEN
    RAISE EXCEPTION '表外归档必须保留唯一同事务审计' USING ERRCODE='23514';
  END IF;

  expected_completion:=jsonb_build_object('protocolVersion',1,'policy','outside_downstream_commitment','archiveId',NEW."id",
    'projectId',scope->'projectId','contractId',NEW."authoritySnapshot"->'contractId','contractVersionId',NEW."contractVersionId",
    'approvalInstanceId',NEW."approvalInstanceId",'sealTaskId',NEW."sealTaskId",'uploaderUserId',NEW."uploadedByUserId",
    'idempotencyKey',NEW."idempotencyKey",'requestSha256',NEW."requestSha256",'authoritySha256',NEW."authoritySha256",
    'fileManifestSha256',NEW."fileManifestSha256",'archivedAt',scope->'archivedAt','evidenceIds',evidence_ids,'originals',originals,
    'operatingLedgerEffectiveDateSnapshot',scope->'operatingLedgerEffectiveDateSnapshot','operatingFactId',f."id",'operatingImpactId',i."id");
  SELECT m."completion",m.xmin::text AS row_xid INTO receipt FROM public.jg_contract_generated_archive_completion_v1 m
    WHERE m."archiveId"=NEW."id";
  IF NOT FOUND OR receipt.row_xid<>xid OR receipt."completion" IS DISTINCT FROM expected_completion THEN
    RAISE EXCEPTION '表外原标识完成记录必须与本事务承诺及固定原件一致' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$complete$;
REVOKE ALL ON FUNCTION public.jg_require_generated_outside_commitment_v1() FROM PUBLIC;

-- Bind the complete pre-existing profile. Its routines and ACLs are unchanged here.
DO $install$
DECLARE
  b RECORD;
  owner_id OID:=current_user::regrole::oid;
BEGIN
  SELECT s.* INTO STRICT b FROM public.jg_contract_generated_upward_seal_binding_v1 s
    JOIN pg_catalog.pg_database d ON d.oid=s."databaseOid" AND d.datname=pg_catalog.current_database()
    WHERE s."protocolVersion"=1 AND s."namespaceOid"=pg_catalog.to_regnamespace('public');
  IF current_user IS DISTINCT FROM session_user OR b."ownerOid"<>owner_id
    OR pg_catalog.current_setting('session_replication_role')<>'origin'
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_roles r WHERE pg_catalog.pg_has_role(b."applicationRoleOid",r.oid,'MEMBER')
      AND (r.rolsuper OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication OR pg_catalog.pg_has_role(r.oid,owner_id,'MEMBER')
        OR pg_catalog.has_schema_privilege(r.oid,b."namespaceOid",'CREATE')))
    OR NOT EXISTS(SELECT 1 FROM public.jg_contract_generated_archive_version_transition_v1 vt
      JOIN public.jg_contract_generated_upward_seal_binding_v1 s ON s.tableoid=vt."sealBindingOid"
        AND s."protocolVersion"=1 AND s."applicationRoleOid"=b."applicationRoleOid"
      JOIN pg_catalog.pg_constraint k ON k.oid=vt."upwardConstraintOid" AND k.conrelid='public."ContractVersion"'::regclass
        AND k.contype='c' AND k.convalidated AND k.conislocal AND k.conname='ContractVersion_upward_draft_source_check'
      WHERE vt."protocolVersion"=1 AND encode(public.digest(convert_to(to_jsonb(s)::text,'UTF8'),'sha256'),'hex')=vt."sealBindingSha256"
        AND encode(public.digest(convert_to(pg_catalog.pg_get_constraintdef(k.oid,false),'UTF8'),'sha256'),'hex')=vt."upwardConstraintSha256")
    OR (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.oid IN (
      'public."ContractArchiveFile"'::regclass,'public."ContractArchiveEvidenceFile"'::regclass,
      'public."OperatingFact"'::regclass,'public."OperatingImpactEntry"'::regclass,
      'public.jg_contract_generated_archive_original_v1'::regclass,'public.jg_contract_generated_archive_completion_v1'::regclass)
      AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
      AND c.relowner=owner_id AND c.relnamespace=b."namespaceOid")<>6
    OR (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.oid IN (
      'public."Contract"'::regclass,'public."ContractVersion"'::regclass,'public."Project"'::regclass,
      'public."ProjectAffiliateAssignment"'::regclass,'public."BusinessPartyVersion"'::regclass,'public."ContractPartySnapshot"'::regclass,
      'public."ApprovalInstance"'::regclass,'public."ContractSealTask"'::regclass,'public."ContractEconomicReview"'::regclass,'public."AuditLog"'::regclass)
      AND c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity
      AND c.relnamespace=b."namespaceOid")<>10
    OR (SELECT count(*) FROM (VALUES
      ('public.jg_contract_archive_v2_parent_guard()','cbc9b7890e3fe02c730c1fa8617eb8b13b74a401c962083506d8a3372ec7a522',NULL,FALSE,'search_path=pg_catalog, public'),
      ('public.jg_capture_generated_archive_completion_v1(text)','ebc6784cf581ecc1f53f53e1cafcaafadba6004b8a6a0ef71f4e94f3ae872f6d',NULL,FALSE,'search_path=pg_catalog, public'),
      ('public.jg_generated_archive_activation_basis_v1(text,boolean)','bd3a09f489d37ed5053ac86435053e593ffabd96aeebc9e94b30e335cbc9850f',NULL,FALSE,'search_path=pg_catalog, pg_temp'),
      ('public.jg_apply_generated_archive_write_v1()','03174cabf7b24f57ddad58ecf2c92360caa32f6d84299d3ab8ac4117d9f8465f',NULL,TRUE,'search_path=pg_catalog, pg_temp'),
      ('public.jg_guard_generated_upward_seal_completion_v1()','ae9d017bf6f9fd6617e7a58a3908c64c76c0130b0c49aa73a316d34ffbb44449',NULL,FALSE,'search_path=pg_catalog, public'),
      ('public.jg_verify_generated_upward_archive_reference_v1(text,jsonb,timestamp)','af0c0c32150eefc7710abc42ecc0a17d92fc8a7ff236a87449f58df9103a48ef',NULL,FALSE,'search_path=pg_catalog, pg_temp'),
      ('public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayloadV2",text,text)','aa00bcbe5651be1b48054e338d5881d81900eef0eb2c86880f80fa5d9d350a58',
        '1dd955715e4102b2f3a44b65e92860d457ebcc11981f06e2ca1e0c494f566c4f',TRUE,'search_path=pg_catalog, public'),
      ('public."appendOperatingImpactThroughService"(public."OperatingLedgerImpactWritePayloadV2",text,text)','c96af192e9f1711305791ebb8430f5ec888953ba40f675d9bf3c7fc3b1985d33',NULL,TRUE,'search_path=pg_catalog, public')
    ) x(signature,body_sha,conditional_sha,definer,path)
    JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(x.signature)
      AND p.proowner=owner_id AND p.pronamespace=b."namespaceOid" AND p.prosecdef=x.definer
      AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u' AND p.proconfig=ARRAY[x.path]
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex') IN (x.body_sha,x.conditional_sha)
    JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql')<>8
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
      WHERE p.oid IN (pg_catalog.to_regprocedure('public.jg_generated_outside_commitment_basis_v1(text)'),
        pg_catalog.to_regprocedure('public.jg_require_generated_outside_commitment_v1()'))
        AND (a.grantee<>owner_id OR a.grantor<>owner_id))
    OR (SELECT count(*) FROM (VALUES
      ('ContractArchiveFile_v2_immutable','public."ContractArchiveFile"','public.jg_contract_archive_v2_parent_guard()',31,FALSE),
      ('ContractArchiveFile_v2_complete','public."ContractArchiveFile"','public.jg_contract_archive_v2_complete_guard()',5,TRUE),
      ('jg_generated_archive_completion_required','public."ContractArchiveFile"','public.jg_require_generated_archive_completion_v1()',5,TRUE),
      ('jg_generated_archive_originals_complete','public."ContractArchiveFile"','public.jg_require_generated_archive_originals_v1()',5,TRUE),
      ('jg_generated_archive_write_apply','public.jg_contract_generated_archive_write_v1','public.jg_apply_generated_archive_write_v1()',5,FALSE)
    ) x(name,relation,fn,kind,deferred)
    JOIN pg_catalog.pg_trigger t ON t.tgname=x.name AND t.tgrelid=pg_catalog.to_regclass(x.relation)
      AND t.tgfoid=pg_catalog.to_regprocedure(x.fn) AND t.tgtype=x.kind AND t.tgenabled='O' AND NOT t.tgisinternal
      AND t.tgdeferrable=x.deferred AND t.tginitdeferred=x.deferred AND (t.tgconstraint<>0)=x.deferred
      AND t.tgnargs=0 AND t.tgattr::text='' AND t.tgqual IS NULL)<>5 THEN
    RAISE EXCEPTION '表外承诺安装缺少正确的归档、经营前态或角色' USING ERRCODE='55000';
  END IF;
END;
$install$;

CREATE CONSTRAINT TRIGGER jg_generated_outside_commitment_required
AFTER INSERT ON public."ContractArchiveFile" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.jg_require_generated_outside_commitment_v1();

COMMIT;
