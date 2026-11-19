-- Carry the qualified outside direct archive instant into existing operating
-- validators without changing the generated and ordinary source paths.
BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

CREATE FUNCTION public.jg_direct_outside_operating_reference_clock_v2(p_fact public."OperatingFact")
RETURNS TIMESTAMP
LANGUAGE plpgsql VOLATILE STRICT SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $clock$
DECLARE
  archived_at TIMESTAMP(3);
BEGIN
  SELECT archive."confirmedAt" INTO archived_at
  FROM public.jg_contract_direct_archive_intent_binding_v1 b
  JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=current_database() AND d.datdba=b."anchorOwnerOid"
  JOIN public.jg_contract_direct_archive_native_nonce_v1 n ON n."protocolVersion"=1
    AND n."intentBindingSha256"=encode(public.digest(convert_to(to_jsonb(b)::text,'UTF8'),'sha256'),'hex')
  JOIN public.jg_contract_direct_archive_completion_binding_v1 c0 ON c0.tableoid=b."completionRelationOid"
    AND c0."protocolVersion"=1 AND c0."databaseOid"=b."databaseOid" AND c0."namespaceOid"=b."namespaceOid"
    AND c0."anchorOwnerOid"=b."anchorOwnerOid" AND c0."applicationRoleOid"=b."ordinaryApplicationRoleOid"
    AND encode(public.digest(convert_to(to_jsonb(c0)::text,'UTF8'),'sha256'),'hex')=b."completionSha256"
  JOIN public.jg_contract_direct_outside_operating_use_v2 u ON u."databaseOid"=b."databaseOid"
    AND u."executorOwnerOid"=b."executorOwnerOid" AND u."runtimeSessionOid"=b."runtimeSessionOid"
    AND u."backendPid"=pg_backend_pid() AND u."transactionId"=txid_current()
    AND u.xmin::text=mod(u."transactionId",4294967296::bigint)::text
  JOIN public.jg_contract_direct_outside_operating_receipt_v2 receipt ON receipt."intentId"=u."intentId"
    AND receipt.xmin<>u.xmin AND receipt."bindingSha256"=n."intentBindingSha256"
    AND receipt."payloadSha256"=encode(public.digest(convert_to(u."payload"::text,'UTF8'),'sha256'),'hex')
    AND u."claimedAt">=receipt."issuedAt" AND u."claimedAt"<receipt."expiresAt"
  JOIN public."ContractArchiveFile" archive ON archive."id"=u."archiveId"
    AND archive."contractVersionId"=u."contractVersionId" AND archive.xmin=u.xmin
    AND archive."archiveProtocolVersion"=2 AND archive."archiveSource"='direct_signed' AND archive."status"='confirmed'
    AND archive."fileId" IS NULL AND archive."approvalInstanceId" IS NULL AND archive."sealTaskId" IS NULL
    AND archive."idempotencyKey"=u."requestKey" AND archive."requestSha256"=u."payload"->>'requestSha256'
    AND archive."uploadedByUserId"=u."payload"->>'actor' AND archive."confirmedByUserId"=archive."uploadedByUserId"
    AND archive."authoritySnapshot"->'operatingConsequence'=u."payload"->'operatingConsequence'
    AND archive."authoritySnapshot"#>>'{operatingConsequence,mode}'='projection_required'
    AND archive."authoritySnapshot"#>>'{sourceBasis,intentPayloadSha256}'=receipt."payloadSha256"
    AND archive."authoritySha256"=encode(public.digest(convert_to(archive."authoritySnapshot"::text,'UTF8'),'sha256'),'hex')
    AND pg_catalog.isfinite(archive."confirmedAt") AND archive."confirmedAt">=(u."claimedAt" AT TIME ZONE 'UTC')::timestamp(3)
    AND (archive."confirmedAt" AT TIME ZONE 'UTC')<receipt."expiresAt"
  JOIN public."ContractVersion" v ON v."id"=u."contractVersionId" AND v.xmin=u.xmin AND v."status"='effective'
    AND v."effectiveAt"=archive."confirmedAt" AND v."taxFactsFrozenAt"=v."effectiveAt" AND v."signingSubjectType"='affiliate'
    AND v."numericProtocolVersion"=2 AND v."versionNo"=1 AND v."changeType"='original'
    AND v."firstSubmittedAt" IS NULL AND v."supersedesVersionId" IS NULL
  JOIN public."Contract" c ON c."id"=v."contractId" AND c."id"=u."payload"->>'contractId'
    AND c."companyEntityId" IS NULL AND c."voidedAt" IS NULL AND c."ownerUserId"=archive."uploadedByUserId"
  JOIN public."Project" project ON project."id"=c."projectId" AND project."id"=u."payload"->>'projectId' AND project."isActive"
    AND to_jsonb(project."operatingLedgerEffectiveDate")=u."payload"#>'{operatingConsequence,operatingLedgerEffectiveDateSnapshot}'
  WHERE b."protocolVersion"=1 AND b."namespaceOid"=to_regnamespace('public')
    AND b."anchorOwnerOid"=current_user::regrole::oid AND b."runtimeSessionOid"=session_user::regrole::oid
    AND current_setting('session_replication_role')='origin'
    AND p_fact."sourceType"='contract_version' AND p_fact."numericProtocolVersion"=2 AND p_fact."entryKind"='original'
    AND p_fact."sourceBusinessId"=v."id" AND p_fact."sourceVersion"=v."versionNo" AND p_fact."projectId"=project."id"
    AND p_fact."factKind"='downstream_contract' AND p_fact."status"='confirmed'
    AND p_fact."idempotencyKey"=u."payload"#>>'{operatingConsequence,expectedSource,factIdempotencyKey}'
    AND p_fact."occurredAt"=archive."confirmedAt" AND p_fact."confirmedAt"=archive."confirmedAt"
    AND p_fact."recordedByUserId"=archive."uploadedByUserId" AND p_fact."confirmedByUserId"=archive."uploadedByUserId"
    AND p_fact."affiliateAssignmentId"=u."payload"#>>'{operatingConsequence,debtor,assignmentId}'
    AND p_fact."affiliateBusinessPartyVersionId"=u."payload"#>>'{operatingConsequence,debtor,id}'
    AND p_fact."debtorSubjectKind"='construction_enterprise' AND p_fact."debtorSubjectId"=p_fact."affiliateBusinessPartyVersionId"
    AND p_fact."creditorSubjectKind"='downstream_counterparty' AND p_fact."creditorSubjectId"=u."payload"#>>'{operatingConsequence,creditor,id}'
    AND p_fact."sourceSnapshot"->>'archiveSource'='direct_signed'
    AND p_fact."sourceSnapshot"->>'archiveAuthorityId'=archive."id"
    AND p_fact."sourceSnapshot"->>'archiveAuthoritySha256'=archive."authoritySha256"
    AND p_fact."sourceSnapshot"->>'intentPayloadSha256'=receipt."payloadSha256"
    AND p_fact."sourceSnapshot"->>'sourceBasisSha256'=archive."authoritySnapshot"->>'sourceBasisSha256'
    AND p_fact."sourceSnapshot"->'sourceBasis'=archive."authoritySnapshot"->'sourceBasis'
    AND p_fact."sourceSnapshot"->>'archiveBusinessDay'=to_char(((archive."confirmedAt" AT TIME ZONE 'UTC')
      AT TIME ZONE 'Asia/Shanghai')::date,'YYYY-MM-DD')
    AND archive."authoritySnapshot"#>>'{sourceBasis,businessTime,businessDay}'=p_fact."sourceSnapshot"->>'archiveBusinessDay';
  IF NOT FOUND THEN RAISE EXCEPTION '表外直签经营事实缺少本事务原归档时刻' USING ERRCODE='23514'; END IF;
  RETURN archived_at;
END;
$clock$;
REVOKE ALL ON FUNCTION public.jg_direct_outside_operating_reference_clock_v2(public."OperatingFact") FROM PUBLIC;

CREATE FUNCTION public.jg_install_direct_outside_operating_reference_clock_v2() RETURNS VOID
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path=pg_catalog, pg_temp AS $install$
DECLARE
  binding public.jg_contract_direct_archive_intent_binding_v1%ROWTYPE;
  recipe RECORD;
  prior RECORD;
  prior_trigger RECORD;
  patch RECORD;
  new_body TEXT;
  fact_decl_old TEXT:=$fact_decl_old$  outside_original_instant TIMESTAMP(3);$fact_decl_old$;
  fact_decl_new TEXT:=$fact_decl_new$  outside_original_instant TIMESTAMP(3);
  direct_original_instant TIMESTAMP(3);
  direct_business_day DATE;$fact_decl_new$;
  fact_flag_old TEXT:=$fact_flag_old$  IF NEW."operatingLedgerEffectiveDateSnapshot" IS DISTINCT FROM project_effective_date$fact_flag_old$;
  fact_flag_new TEXT:=$fact_flag_new$  IF NEW."sourceType"='contract_version' AND NEW."numericProtocolVersion"=2
    AND NEW."sourceSnapshot"->>'archiveSource'='direct_signed' THEN
    direct_original_instant:=public.jg_direct_outside_operating_reference_clock_v2(NEW::public."OperatingFact");
    direct_business_day:=((direct_original_instant AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date;
  END IF;
  IF NEW."operatingLedgerEffectiveDateSnapshot" IS DISTINCT FROM project_effective_date$fact_flag_new$;
  fact_day_old TEXT:=$fact_day_old$public.jg_contract_archive_v2_ownership_day(CASE WHEN NEW."sourceType" = 'contract_version' THEN NEW."sourceBusinessId" ELSE NULL END)$fact_day_old$;
  fact_day_new TEXT:=$fact_day_new$COALESCE(direct_business_day,public.jg_contract_archive_v2_ownership_day(CASE WHEN NEW."sourceType" = 'contract_version' THEN NEW."sourceBusinessId" ELSE NULL END))$fact_day_new$;
  fact_instant_old TEXT:=$fact_instant_old$COALESCE(outside_original_instant,$fact_instant_old$;
  fact_instant_new TEXT:=$fact_instant_new$COALESCE(direct_original_instant,outside_original_instant,$fact_instant_new$;
  impact_decl_old TEXT:=$impact_decl_old$  outside_original_instant TIMESTAMP(3);$impact_decl_old$;
  impact_decl_new TEXT:=$impact_decl_new$  outside_original_instant TIMESTAMP(3);
  direct_original_instant TIMESTAMP(3);
  direct_business_day DATE;$impact_decl_new$;
  impact_lookup_old TEXT:=$impact_lookup_old$  SELECT COALESCE(public.jg_contract_review_archive_v2_ownership_day(fact),$impact_lookup_old$;
  impact_lookup_new TEXT:=$impact_lookup_new$  IF NEW."sourceType"='contract_version' AND NEW."numericProtocolVersion"=2 THEN
    SELECT public.jg_direct_outside_operating_reference_clock_v2(fact) INTO direct_original_instant
    FROM public."OperatingFact" fact
    WHERE fact."id"=NEW."factId" AND fact."projectId"=NEW."projectId" AND fact."sourceType"=NEW."sourceType"
      AND fact."sourceBusinessId"=NEW."sourceBusinessId" AND fact.xmin::text=mod(pg_catalog.txid_current(),4294967296::bigint)::text
      AND fact."sourceSnapshot"->>'archiveSource'='direct_signed'
      AND NEW."sourceImpactKey"='contract_commitment_reference' AND NEW."impactKind"='contract_commitment_reference'
      AND NEW."idempotencyKey"=fact."idempotencyKey"||':commitment'
      AND NEW."subjectRole"='debtor' AND NEW."subjectKind"=fact."debtorSubjectKind" AND NEW."subjectId"=fact."debtorSubjectId"
      AND NEW."amountCents" IS NULL AND NEW."amountYuan" IS NOT DISTINCT FROM fact."amountYuan"
      AND NEW."direction"=(CASE WHEN fact."amountYuan" IS NULL THEN 'notice' ELSE 'increase' END);
    direct_business_day:=((direct_original_instant AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai')::date;
  END IF;
  SELECT COALESCE(public.jg_contract_review_archive_v2_ownership_day(fact),$impact_lookup_new$;
  impact_day_old TEXT:=$impact_day_old$public.jg_contract_archive_v2_ownership_day(CASE WHEN fact."sourceType"='contract_version' THEN fact."sourceBusinessId" ELSE NULL END)$impact_day_old$;
  impact_day_new TEXT:=$impact_day_new$COALESCE(direct_business_day,public.jg_contract_archive_v2_ownership_day(CASE WHEN fact."sourceType"='contract_version' THEN fact."sourceBusinessId" ELSE NULL END))$impact_day_new$;
  impact_instant_old TEXT:=$impact_instant_old$COALESCE(outside_original_instant,$impact_instant_old$;
  impact_instant_new TEXT:=$impact_instant_new$COALESCE(direct_original_instant,outside_original_instant,$impact_instant_new$;
BEGIN
  SELECT b.* INTO STRICT binding FROM public.jg_contract_direct_archive_intent_binding_v1 b
  JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=current_database() AND d.datdba=b."anchorOwnerOid"
  JOIN public.jg_contract_direct_archive_native_nonce_v1 n ON n."protocolVersion"=1
    AND n."intentBindingSha256"=encode(public.digest(convert_to(to_jsonb(b)::text,'UTF8'),'sha256'),'hex')
  WHERE b."protocolVersion"=1 AND b."namespaceOid"=to_regnamespace('public');
  IF current_user IS DISTINCT FROM session_user OR current_user::regrole::oid IS DISTINCT FROM binding."anchorOwnerOid"
    OR current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_ssl WHERE pid=pg_backend_pid() AND ssl)
    OR 2<>(SELECT count(*) FROM (VALUES
      ('public.jg_prepare_direct_outside_operating_commit_v2(text)','257724b87fbee386a585c0c97d67e6b343243cb7da1d538a170b42d0cbe64c5a','pg_catalog.jsonb'),
      ('public.jg_direct_outside_operating_reference_clock_v2(public."OperatingFact")','18ddadb0fb01ae5fa00e22d8abaef83c63c877bbafe672128544090e0d0566ff','pg_catalog.timestamp')
    ) expected(signature,body,result_type)
    JOIN pg_catalog.pg_proc p ON p.oid=to_regprocedure(expected.signature)
      AND p.proowner=binding."anchorOwnerOid" AND p.pronamespace=binding."namespaceOid"
      AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u' AND p.proisstrict AND NOT p.prosecdef AND NOT p.proretset
      AND p.prorettype=to_regtype(expected.result_type) AND p.proconfig=ARRAY['search_path=pg_catalog, pg_temp']
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=expected.body
    JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
    WHERE NOT EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.grantee<>p.proowner OR a.grantor<>p.proowner)) THEN
    RAISE EXCEPTION '表外直签经营日期接线缺少原绑定和承诺源码' USING ERRCODE='55000';
  END IF;

  FOR recipe IN SELECT * FROM (VALUES
    ('fact','public."validateOperatingFactReferences"()','public."OperatingFact"','OperatingFact_validate_references',
      '26a0fe0d77faa0cb21df9098d339f6350e45e9468504d1cc9d66afee4171a975','a9f2052a70675effdd906929c1b3490c4f4f81867b65b29ea13c9e3a935f7434'),
    ('impact','public."validateOperatingImpactEntryReferences"()','public."OperatingImpactEntry"','OperatingImpactEntry_validate_references',
      'd6666bbad410b5f1cacc8e40fe29dbaea990e2e101f9857cb14585d6a6a9d92b','e6d843c9d702ce00f88e79b1e7f83eac977df271c3962bb949b9299d78d9de3c')
  ) expected(kind,signature,relation,hook,pre,post) LOOP
    SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT prior FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
    WHERE p.oid=to_regprocedure(recipe.signature) AND p.proowner=binding."anchorOwnerOid" AND p.pronamespace=binding."namespaceOid"
      AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u' AND NOT p.proisstrict AND NOT p.prosecdef AND NOT p.proretset
      AND p.prorettype='pg_catalog.trigger'::regtype AND p.proconfig IS NULL
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=recipe.pre;
    SELECT t.* INTO STRICT prior_trigger FROM pg_catalog.pg_trigger t
    WHERE t.tgfoid=prior.oid AND t.tgrelid=to_regclass(recipe.relation) AND t.tgname=recipe.hook
      AND t.tgtype=7 AND t.tgenabled='O' AND NOT t.tgisinternal AND NOT t.tgdeferrable AND NOT t.tginitdeferred
      AND t.tgconstraint=0 AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text='';
    new_body:=prior.prosrc;
    FOR patch IN SELECT splice.* FROM (VALUES
      ('fact',1,fact_decl_old,fact_decl_new,1),('fact',2,fact_flag_old,fact_flag_new,1),
      ('fact',3,fact_day_old,fact_day_new,7),('fact',4,fact_instant_old,fact_instant_new,2),
      ('impact',1,impact_decl_old,impact_decl_new,1),('impact',2,impact_lookup_old,impact_lookup_new,1),
      ('impact',3,impact_day_old,impact_day_new,1),('impact',4,impact_instant_old,impact_instant_new,2)
    ) splice(kind,position,anchor,replacement,occurrences) WHERE splice.kind=recipe.kind ORDER BY splice.position LOOP
      IF cardinality(string_to_array(new_body,patch.anchor))<>patch.occurrences+1 THEN
        RAISE EXCEPTION '表外直签经营日期接线锚点不匹配' USING ERRCODE='55000';
      END IF;
      new_body:=replace(new_body,patch.anchor,patch.replacement);
    END LOOP;
    IF cardinality(string_to_array(pg_catalog.pg_get_functiondef(prior.oid),prior.prosrc))<>2
      OR encode(public.digest(convert_to(new_body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM recipe.post THEN
      RAISE EXCEPTION '表外直签经营日期接线精确后像不一致' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(pg_catalog.pg_get_functiondef(prior.oid),prior.prosrc,new_body);
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=prior.oid AND p.prosrc=new_body AND to_jsonb(p)-'prosrc'=prior.metadata)
      OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.oid=prior_trigger.oid AND to_jsonb(t)=to_jsonb(prior_trigger)) THEN
      RAISE EXCEPTION '表外直签经营日期接线不能改变原有例程或触发器身份' USING ERRCODE='55000';
    END IF;
  END LOOP;
END;
$install$;
REVOKE ALL ON FUNCTION public.jg_install_direct_outside_operating_reference_clock_v2() FROM PUBLIC;

DO $private$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid IN ('public.jg_direct_outside_operating_reference_clock_v2(public."OperatingFact")'::regprocedure,
      'public.jg_install_direct_outside_operating_reference_clock_v2()'::regprocedure)
      AND (a.grantee<>p.proowner OR a.grantor<>p.proowner)) THEN
    RAISE EXCEPTION '表外直签经营日期函数默认须保持私有' USING ERRCODE='55000';
  END IF;
END;
$private$;
COMMIT;
