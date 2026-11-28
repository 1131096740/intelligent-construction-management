-- Keep construction-enterprise assignment intervals at their original instant for the new outside append.
BEGIN;
SET LOCAL search_path TO pg_catalog,public;
LOCK TABLE public."OperatingFact",public."OperatingImpactEntry" IN ACCESS EXCLUSIVE MODE;
DO $install$
DECLARE
  binding RECORD;
  recipe RECORD;
  prior RECORD;
  next_body TEXT;
  owner_id OID:=current_user::regrole::oid;
  fact_decl_before TEXT:=$a_fact_decl$DECLARE
$a_fact_decl$;
  fact_decl_after TEXT:=$b_fact_decl$DECLARE
  outside_original_instant TIMESTAMP(3);
$b_fact_decl$;
  fact_lookup_before TEXT:=$a_fact_lookup$  SELECT "businessPartyVersionId", "affiliateNameSnapshot", "affiliateCreditCodeSnapshot"$a_fact_lookup$;
  fact_lookup_after TEXT:=$b_fact_lookup$  IF NEW."sourceType"='contract_version' AND NEW."numericProtocolVersion"=2 THEN
    SELECT a."confirmedAt" INTO outside_original_instant FROM public."ContractArchiveFile" a
    CROSS JOIN LATERAL (SELECT NEW."sourceSnapshot" AS frozen_fact) proof
    WHERE a."contractVersionId"=NEW."sourceBusinessId" AND a."id"=frozen_fact->>'archiveAuthorityId'
      AND a."authoritySnapshot"->>'projectId'=NEW."projectId" AND a."confirmedAt"=NEW."occurredAt"
      AND a."archiveProtocolVersion"=2 AND a."archiveSource"='generated_approval' AND a."status"='confirmed'
      AND a.xmin::text=mod(pg_catalog.txid_current(),4294967296::bigint)::text
      AND a."authoritySnapshot"#>>'{sourceBasis,subjects,signingIdentity,relationship}'='outside'
      AND a."authoritySnapshot"#>>'{operatingConsequence,mode}'='projection_required'
      AND a."authoritySha256"=frozen_fact->>'archiveAuthoritySha256'
      AND a."authoritySnapshot"->>'sourceBasisSha256'=frozen_fact->>'sourceBasisSha256'
      AND a."authoritySnapshot"->'sourceBasis'=frozen_fact->'sourceBasis'
;
  END IF;

  SELECT "businessPartyVersionId", "affiliateNameSnapshot", "affiliateCreditCodeSnapshot"$b_fact_lookup$;
  fact_interval_before TEXT:=$a_fact_interval$      AND "effectiveFrom" <= COALESCE(public.jg_contract_review_archive_v2_ownership_day(NEW::public."OperatingFact"), public.jg_contract_archive_v2_ownership_day(CASE WHEN NEW."sourceType" = 'contract_version' THEN NEW."sourceBusinessId" ELSE NULL END), COALESCE(public.jg_contract_economic_review_ownership_date(NEW::public."OperatingFact"), public.jg_company_repayment_ownership_date(NEW."sourceType", NEW."sourceBusinessId", NEW."projectId"), NEW."occurredAt")::DATE)
      AND ("endedAt" IS NULL OR "endedAt" > COALESCE(public.jg_contract_review_archive_v2_ownership_day(NEW::public."OperatingFact"), public.jg_contract_archive_v2_ownership_day(CASE WHEN NEW."sourceType" = 'contract_version' THEN NEW."sourceBusinessId" ELSE NULL END), COALESCE(public.jg_contract_economic_review_ownership_date(NEW::public."OperatingFact"), public.jg_company_repayment_ownership_date(NEW."sourceType", NEW."sourceBusinessId", NEW."projectId"), NEW."occurredAt")::DATE))$a_fact_interval$;
  fact_interval_after TEXT:=$b_fact_interval$      AND "effectiveFrom" <= COALESCE(outside_original_instant,(COALESCE(public.jg_contract_review_archive_v2_ownership_day(NEW::public."OperatingFact"), public.jg_contract_archive_v2_ownership_day(CASE WHEN NEW."sourceType" = 'contract_version' THEN NEW."sourceBusinessId" ELSE NULL END), COALESCE(public.jg_contract_economic_review_ownership_date(NEW::public."OperatingFact"), public.jg_company_repayment_ownership_date(NEW."sourceType", NEW."sourceBusinessId", NEW."projectId"), NEW."occurredAt")::DATE))::timestamp)
      AND ("endedAt" IS NULL OR "endedAt" > COALESCE(outside_original_instant,(COALESCE(public.jg_contract_review_archive_v2_ownership_day(NEW::public."OperatingFact"), public.jg_contract_archive_v2_ownership_day(CASE WHEN NEW."sourceType" = 'contract_version' THEN NEW."sourceBusinessId" ELSE NULL END), COALESCE(public.jg_contract_economic_review_ownership_date(NEW::public."OperatingFact"), public.jg_company_repayment_ownership_date(NEW."sourceType", NEW."sourceBusinessId", NEW."projectId"), NEW."occurredAt")::DATE))::timestamp))$b_fact_interval$;
  impact_decl_before TEXT:=$a_impact_decl$  fact_new_archive_day DATE;$a_impact_decl$;
  impact_decl_after TEXT:=$b_impact_decl$  fact_new_archive_day DATE;
  outside_original_instant TIMESTAMP(3);$b_impact_decl$;
  impact_lookup_before TEXT:=$a_impact_lookup$  IF NEW."subjectKind" = 'construction_enterprise' AND NOT EXISTS ($a_impact_lookup$;
  impact_lookup_after TEXT:=$b_impact_lookup$  IF NEW."sourceType"='contract_version' AND NEW."numericProtocolVersion"=2 THEN
    SELECT a."confirmedAt" INTO outside_original_instant FROM public."OperatingFact" f
    JOIN public."ContractArchiveFile" a ON a."contractVersionId"=f."sourceBusinessId" AND a."confirmedAt"=f."occurredAt"
    CROSS JOIN LATERAL (SELECT f."sourceSnapshot" AS frozen_fact) proof
    WHERE f."id"=NEW."factId" AND f."projectId"=NEW."projectId" AND f."sourceType"=NEW."sourceType"
      AND f."sourceBusinessId"=NEW."sourceBusinessId" AND f."numericProtocolVersion"=2
      AND f.xmin::text=mod(pg_catalog.txid_current(),4294967296::bigint)::text AND a."id"=frozen_fact->>'archiveAuthorityId'
      AND a."authoritySnapshot"->>'projectId'=f."projectId"
      AND a."archiveProtocolVersion"=2 AND a."archiveSource"='generated_approval' AND a."status"='confirmed'
      AND a.xmin::text=mod(pg_catalog.txid_current(),4294967296::bigint)::text
      AND a."authoritySnapshot"#>>'{sourceBasis,subjects,signingIdentity,relationship}'='outside'
      AND a."authoritySnapshot"#>>'{operatingConsequence,mode}'='projection_required'
      AND a."authoritySha256"=frozen_fact->>'archiveAuthoritySha256'
      AND a."authoritySnapshot"->>'sourceBasisSha256'=frozen_fact->>'sourceBasisSha256'
      AND a."authoritySnapshot"->'sourceBasis'=frozen_fact->'sourceBasis'
;
  END IF;

  IF NEW."subjectKind" = 'construction_enterprise' AND NOT EXISTS ($b_impact_lookup$;
  impact_interval_before TEXT:=$a_impact_interval$       AND assignment."effectiveFrom" <= COALESCE(fact_new_archive_day, fact_occurred_at::DATE)
       AND (assignment."endedAt" IS NULL
         OR assignment."endedAt" > COALESCE(fact_new_archive_day, fact_occurred_at::DATE))$a_impact_interval$;
  impact_interval_after TEXT:=$b_impact_interval$       AND assignment."effectiveFrom" <= COALESCE(outside_original_instant,COALESCE(fact_new_archive_day, fact_occurred_at::DATE)::timestamp)
       AND (assignment."endedAt" IS NULL
         OR assignment."endedAt" > COALESCE(outside_original_instant,COALESCE(fact_new_archive_day, fact_occurred_at::DATE)::timestamp))$b_impact_interval$;
BEGIN
  SELECT b.* INTO STRICT binding FROM public.jg_contract_generated_upward_seal_binding_v1 b
    JOIN pg_catalog.pg_database d ON d.oid=b."databaseOid" AND d.datname=pg_catalog.current_database()
    WHERE b."protocolVersion"=1 AND b."namespaceOid"=pg_catalog.to_regnamespace('public');
  IF current_user IS DISTINCT FROM session_user OR binding."ownerOid"<>owner_id
    OR pg_catalog.current_setting('session_replication_role')<>'origin'
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid=pg_catalog.to_regprocedure('public."appendOperatingFactThroughService"(public."OperatingLedgerFactWritePayloadV2",text,text)')
        AND p.proowner=owner_id AND p.pronamespace=binding."namespaceOid" AND p.prosecdef
        AND p.proconfig=ARRAY['search_path=pg_catalog, public']
        AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')='a2c695903580d69b86a37bc8f697b4e344780a9a07fc4ad18fdd6b7fb42835ea') THEN
    RAISE EXCEPTION '表外派驻时刻后继须绑定原生承诺写入安装' USING ERRCODE='55000';
  END IF;
  FOR recipe IN SELECT * FROM (VALUES
    ('fact','public."validateOperatingFactReferences"()','public."OperatingFact"','OperatingFact_validate_references','e098668fa9795944775b1eff529d462d6c284aaa6cc400a2f169acd147ee2590','26a0fe0d77faa0cb21df9098d339f6350e45e9468504d1cc9d66afee4171a975'),
    ('impact','public."validateOperatingImpactEntryReferences"()','public."OperatingImpactEntry"','OperatingImpactEntry_validate_references','ae881290f233d871b20633b6b0bd01eaea779b51d112780389160814cda80ea8','d6666bbad410b5f1cacc8e40fe29dbaea990e2e101f9857cb14585d6a6a9d92b')
  ) r(key,signature,relation,hook,old_sha,new_sha) LOOP
    SELECT p.*,to_jsonb(p)-'prosrc' AS metadata INTO STRICT prior FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
    JOIN pg_catalog.pg_trigger t ON t.tgfoid=p.oid AND t.tgrelid=pg_catalog.to_regclass(recipe.relation)
      AND t.tgname=recipe.hook AND t.tgtype=7 AND t.tgenabled='O' AND NOT t.tgisinternal
      AND NOT t.tgdeferrable AND NOT t.tginitdeferred AND t.tgconstraint=0 AND t.tgqual IS NULL AND t.tgnargs=0 AND t.tgattr::text=''
    WHERE p.oid=pg_catalog.to_regprocedure(recipe.signature) AND p.proowner=owner_id
      AND p.pronamespace=binding."namespaceOid" AND NOT p.prosecdef AND p.prokind='f'
      AND p.provolatile='v' AND p.proparallel='u' AND NOT p.proisstrict AND NOT p.proretset
      AND p.prorettype='pg_catalog.trigger'::regtype AND p.proconfig IS NULL
      AND encode(public.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')=recipe.old_sha;
    next_body:=prior.prosrc;
    CASE recipe.key
      WHEN 'fact' THEN
        next_body:=replace(next_body,fact_decl_before,fact_decl_after);
        next_body:=replace(next_body,fact_lookup_before,fact_lookup_after);
        next_body:=replace(next_body,fact_interval_before,fact_interval_after);
      WHEN 'impact' THEN
        next_body:=replace(next_body,impact_decl_before,impact_decl_after);
        next_body:=replace(next_body,impact_lookup_before,impact_lookup_after);
        next_body:=replace(next_body,impact_interval_before,impact_interval_after);
    END CASE;
    IF encode(public.digest(convert_to(next_body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM recipe.new_sha THEN
      RAISE EXCEPTION '表外派驻时刻后像不一致' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(pg_catalog.pg_get_functiondef(prior.oid),prior.prosrc,next_body);
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=prior.oid AND p.prosrc=next_body
      AND to_jsonb(p)-'prosrc'=prior.metadata) THEN
      RAISE EXCEPTION '表外派驻时刻后继改变原例程或权限' USING ERRCODE='55000';
    END IF;
  END LOOP;
END;
$install$;
COMMIT;
