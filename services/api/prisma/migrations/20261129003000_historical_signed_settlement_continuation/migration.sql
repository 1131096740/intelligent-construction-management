BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;

-- A historical Contract and a current ProjectAffiliateCompanyContract are
-- independent authorities. A confirmed takeover can supply its own immutable
-- original version, but an unresolved party cannot enter the signed workbench.
CREATE FUNCTION public.jg_historical_signed_settlement_source_v1(p_project text, p_contract text)
RETURNS TABLE(contract_id text, kind text, source jsonb)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $source$
  WITH history AS (
    SELECT c.id, c.name, c.counterparty, c."contractTypeKey", v.id AS version_id, v."versionNo",
      t.id AS takeover_id, t."signedAt"::date AS signed_day, v."draftData"->>'relationship' AS relationship,
      v."draftData"->'historicalSettlementAuthority' AS downstream,
      v."draftData"->'historicalUpwardAuthority' AS upward, f."contractFactsSnapshot" AS facts
    FROM public."Contract" c
    JOIN LATERAL (
      SELECT ver.* FROM public."ContractVersion" ver
      WHERE ver."contractId"=c.id AND ver.status='effective'
      ORDER BY ver."versionNo" DESC LIMIT 1
    ) v ON v."changeType"='historical_takeover'
    JOIN public."ContractTakeover" t ON t."projectId"=c."projectId" AND t."contractId"=c.id
      AND t."contractVersionId"=v.id AND t."takeoverLevel"='NONE' AND t."takeoverStatus"='confirmed'
      AND t."activatedAt"=v."effectiveAt" AND t."historicalBalanceConfirmedAt"=t."activatedAt"
    JOIN public."ContractTakeoverContractFacts" f ON f."takeoverId"=t.id AND f."confirmedRevision"=f.revision
      AND f."signedAt"=t."signedAt" AND f."historicalSettledCents"=t."historicalSettledCents"
    JOIN public."ContractTakeoverFinanceFacts" g ON g."takeoverId"=t.id AND g."confirmedRevision"=g.revision
      AND g."confirmedFinanceBasisRevision"=f."financeBasisRevision"
    WHERE c."projectId"=p_project AND (p_contract IS NULL OR c.id=p_contract)
      AND c.source='historical_takeover' AND c."voidedAt" IS NULL
      AND v."draftData"->>'historicalTakeover'='true'
      AND (v."draftData"->>'relationship' IN ('upward','outside')
        OR (v."draftData"->>'relationship'='inside' AND v."draftData"?'historicalSettlementAuthority'))
  ), authority AS (
    SELECT h.*,
      CASE WHEN h.relationship='upward' THEN h.upward#>>'{affiliate,assignmentId}'
        ELSE h.downstream->>'affiliateAssignmentId' END AS assignment_id,
      CASE WHEN h.relationship='upward' THEN h.upward#>>'{affiliate,businessPartyVersionId}'
        ELSE h.downstream->>'affiliateBusinessPartyVersionId' END AS affiliate_version_id,
      CASE WHEN h.relationship='upward' THEN h.upward->>'companyEntityId'
        ELSE h.downstream->>'companyEntityId' END AS company_id,
      CASE WHEN h.relationship='upward' THEN h.upward->>'companyEntityVersionId'
        WHEN h.relationship='inside' THEN h.downstream->>'payerVersionId' END AS company_version_id
    FROM history h
  )
  SELECT h.id, CASE h.relationship WHEN 'upward' THEN 'upward' WHEN 'outside' THEN 'outside_fact' ELSE 'downstream' END,
    CASE WHEN EXISTS (
      SELECT FROM public."ProjectAffiliateCompanyContract" live
      WHERE live.id=h.id AND live."projectId"=p_project AND live.status='confirmed'
    ) OR EXISTS (
      SELECT FROM public."ProjectAffiliateContractFact" live
      WHERE live."ledgerId"=h.id AND live."projectId"=p_project AND live.status='confirmed' AND live."entryKind"='original'
    ) THEN NULL
    WHEN h.relationship='upward' AND affiliate.id IS NOT NULL AND company.id IS NOT NULL
      AND h.counterparty=affiliate."affiliateNameSnapshot"
      AND h.upward#>>'{affiliate,name}'=affiliate."affiliateNameSnapshot"
      AND h.upward->>'companyName'=company."companyNameSnapshot"
    THEN jsonb_build_object(
      'relationship','upward','name',h.name,'signingParty',affiliate."affiliateNameSnapshot",
      'counterparty',company."companyNameSnapshot",'payerKind','construction_enterprise',
      'payerVersionId',h.affiliate_version_id,'counterpartyKind','participating_company',
      'counterpartyVersionId',h.company_version_id,'companyEntityId',h.company_id,
      'affiliateAssignmentId',h.assignment_id,'affiliateBusinessPartyVersionId',h.affiliate_version_id,
      'sourceRecordId',h.version_id,'sourceVersion',h."versionNo",'contractTypeKey',h."contractTypeKey",
      'historicalTakeoverId',h.takeover_id)
    WHEN h.relationship IN ('inside','outside') AND h.downstream->>'status'='verified'
      AND h.downstream->>'relationship'=h.relationship AND affiliate.id IS NOT NULL
      AND partner.snapshot->>'name'=h.counterparty AND h.facts->>'counterpartyVersionId'=partner.id
      AND h.downstream->>'counterparty'=h.counterparty AND h.downstream->>'counterpartyKind'='downstream_counterparty'
      AND (
        (h.relationship='inside' AND company.id IS NOT NULL
          AND h.downstream->>'signingParty'=company."companyNameSnapshot"
          AND h.downstream->>'payerKind'='participating_company')
        OR
        (h.relationship='outside' AND h.company_id IS NULL
          AND h.downstream->>'payerKind'='construction_enterprise'
          AND h.downstream->>'payerVersionId'=h.affiliate_version_id
          AND h.facts->>'signingPartyVersionId'=h.affiliate_version_id
          AND h.downstream->>'signingParty'=affiliate."affiliateNameSnapshot"
          AND partner."businessPartyId"<>affiliate."businessPartyId")
      )
    THEN h.downstream - 'status' || jsonb_build_object(
      'name',h.name,'sourceRecordId',h.version_id,'sourceVersion',h."versionNo",'contractTypeKey',h."contractTypeKey",
      'historicalTakeoverId',h.takeover_id)
    END
  FROM authority h
  LEFT JOIN public."ProjectAffiliateAssignment" affiliate
    ON affiliate.id=h.assignment_id AND affiliate."projectId"=p_project
      AND affiliate."businessPartyVersionId"=h.affiliate_version_id AND affiliate."effectiveFrom"<=h.signed_day
      AND (affiliate."endedAt" IS NULL OR affiliate."endedAt">h.signed_day)
  LEFT JOIN public."BusinessPartyVersion" partner ON partner.id=h.downstream->>'counterpartyVersionId'
  LEFT JOIN public."ProjectParticipatingCompany" company ON company."projectId"=p_project
    AND company."companyEntityId"=h.company_id AND company."companyEntityVersionId"=h.company_version_id
    AND company."effectiveFrom"<=h.signed_day AND (company."endedAt" IS NULL OR company."endedAt">h.signed_day)
$source$;
REVOKE ALL ON FUNCTION public.jg_historical_signed_settlement_source_v1(text,text) FROM PUBLIC;

-- Apply only the exact existing bodies. No witness, role, signature, or grants
-- are changed, and drift rolls back the complete forward migration.
CREATE FUNCTION pg_temp.jg_patch_historical_signed_settlement_v1(
  routine regprocedure, old_hash text, new_hash text, replacements text[][]
) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $patch$
DECLARE
  original text;
  definition text;
  updated text;
  replacement text[];
BEGIN
  SELECT p.prosrc,pg_get_functiondef(p.oid) INTO STRICT original,definition
  FROM pg_proc p WHERE p.oid=routine::oid AND p.prosecdef;
  IF encode(sha256(convert_to(original,'UTF8')),'hex')<>old_hash THEN
    RAISE EXCEPTION 'historical signed settlement routine predecessor drift';
  END IF;
  updated := original;
  FOREACH replacement SLICE 1 IN ARRAY replacements LOOP
    IF length(updated)-length(replace(updated,replacement[1],''))<>length(replacement[1]) THEN
      RAISE EXCEPTION 'historical signed settlement routine anchor drift';
    END IF;
    updated := replace(updated,replacement[1],replacement[2]);
  END LOOP;
  IF length(definition)-length(replace(definition,original,''))<>length(original)
    OR encode(sha256(convert_to(updated,'UTF8')),'hex')<>new_hash THEN
    RAISE EXCEPTION 'historical signed settlement routine successor drift';
  END IF;
  EXECUTE replace(definition,original,updated);
END;
$patch$;

SELECT pg_temp.jg_patch_historical_signed_settlement_v1(
  'public.jg_save_signed_settlement_draft_v1(text,text,text,integer,text,text,text,text,text,text,text)'::regprocedure,
  '2ced90852bd8ef797438b5f71028c2f1141112163c8ecec02c2beada36dfc697',
  'abda6a5843cc80510e8b662a88a6f45dd4057d05221e6efb2c23ffc7b5bae0b7',
  ARRAY[
    ARRAY[$old$  version record;$old$,$new$  version record;
  historical record;$new$],
    ARRAY[$old$  IF p_kind='downstream' THEN$old$,$new$  SELECT h.kind, h.source INTO historical FROM public.jg_historical_signed_settlement_source_v1(p_project, p_contract) h;
  IF FOUND THEN
    IF historical.kind IS DISTINCT FROM p_kind OR historical.source IS NULL THEN
      RAISE EXCEPTION 'SIGNED_SETTLEMENT_DRAFT_CONTRACT' USING ERRCODE='P0002';
    END IF;
    PERFORM FROM public."Contract" c JOIN public."ContractVersion" v ON v."contractId"=c.id
      AND v.id=historical.source->>'sourceRecordId' AND v.status='effective'
      WHERE c.id=p_contract AND c."projectId"=p_project AND c."voidedAt" IS NULL FOR SHARE OF c,v;
    IF NOT FOUND THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_DRAFT_CONTRACT' USING ERRCODE='P0002'; END IF;
  END IF;

  IF historical.source IS NOT NULL THEN
    -- The activated historical version was checked and locked above.
    NULL;
  ELSIF p_kind='downstream' THEN$new$]
  ]);

SELECT pg_temp.jg_patch_historical_signed_settlement_v1(
  'public.jg_submit_signed_settlement_draft_v1(text,text,text,integer,text,text)'::regprocedure,
  '115b0f72038c40b6a115bd95dde88ef77ee2e7579dbbed9e1c07769d9b9d357c',
  '97b25a1c285f8fa1cfc0438017ba97e28b447a3236578e900ae29d187a2151ed',
  ARRAY[
    ARRAY[$old$  version record;$old$,$new$  version record;
  historical record;$new$],
    ARRAY[$old$  IF draft."contractKind"='downstream' THEN$old$,$new$  SELECT h.kind, h.source INTO historical FROM public.jg_historical_signed_settlement_source_v1(p_project, draft."contractId") h;
  IF FOUND THEN
    IF historical.kind IS DISTINCT FROM draft."contractKind" OR historical.source IS NULL THEN
      RAISE EXCEPTION 'SIGNED_SETTLEMENT_SUBMIT_CONTRACT' USING ERRCODE='P0002';
    END IF;
    PERFORM FROM public."Contract" c JOIN public."ContractVersion" v ON v."contractId"=c.id
      AND v.id=historical.source->>'sourceRecordId' AND v.status='effective'
      WHERE c.id=draft."contractId" AND c."projectId"=p_project AND c."voidedAt" IS NULL FOR SHARE OF c,v;
    IF NOT FOUND THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_SUBMIT_CONTRACT' USING ERRCODE='P0002'; END IF;
  END IF;

  IF historical.source IS NOT NULL OR draft."contractKind"='downstream' THEN
    IF historical.source IS NULL THEN$new$],
    ARRAY[$old$    THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_SUBMIT_CONTRACT' USING ERRCODE='P0002'; END IF;

    SELECT count(*),coalesce(sum(t."historicalSettledCents"),0)$old$,$new$    THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_SUBMIT_CONTRACT' USING ERRCODE='P0002'; END IF;
    END IF;

    SELECT count(*),coalesce(sum(t."historicalSettledCents"),0)$new$]
  ]);

SELECT pg_temp.jg_patch_historical_signed_settlement_v1(
  'public.jg_review_signed_settlement_draft_v1(text,text,text,integer,text,text,boolean,text,text)'::regprocedure,
  '33d529e9ff343b1e791b1ab507b39a0110f37fd82e26e895a5a98994a0ef8fb0',
  'bb255527d0454028caf034bae9f279aac799d5e1a4026423f3b6106ebcf11cf0',
  ARRAY[
    ARRAY[$old$  version record;$old$,$new$  version record;
  historical record;$new$],
    ARRAY[$old$  IF draft."contractKind"='downstream' THEN$old$,$new$  SELECT h.kind, h.source INTO historical FROM public.jg_historical_signed_settlement_source_v1(p_project, draft."contractId") h;
  IF FOUND THEN
    IF historical.kind IS DISTINCT FROM draft."contractKind" OR historical.source IS NULL THEN
      RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_CONTRACT' USING ERRCODE='P0002';
    END IF;
    PERFORM FROM public."Contract" c JOIN public."ContractVersion" v ON v."contractId"=c.id
      AND v.id=historical.source->>'sourceRecordId' AND v.status='effective'
      WHERE c.id=draft."contractId" AND c."projectId"=p_project AND c."voidedAt" IS NULL FOR SHARE OF c,v;
    IF NOT FOUND THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_CONTRACT' USING ERRCODE='P0002'; END IF;
  END IF;

  IF historical.source IS NOT NULL OR draft."contractKind"='downstream' THEN
    IF historical.source IS NULL THEN$new$],
    ARRAY[$old$    THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_CONTRACT' USING ERRCODE='P0002'; END IF;

    IF p_decision='confirm' THEN$old$,$new$    THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_REVIEW_CONTRACT' USING ERRCODE='P0002'; END IF;
    END IF;

    IF p_decision='confirm' THEN$new$],
    ARRAY[$old$    IF p_decision='confirm' THEN
      SELECT party."businessPartyVersionId"$old$,$new$    IF p_decision='confirm' THEN
      IF historical.source IS NOT NULL THEN
        frozen_source := historical.source;
      ELSE
      SELECT party."businessPartyVersionId"$new$],
    ARRAY[$old$      );
      SELECT count(*),coalesce(sum(t."historicalSettledCents"),0)$old$,$new$      );
      END IF;
      SELECT count(*),coalesce(sum(t."historicalSettledCents"),0)$new$]
  ]);

SELECT pg_temp.jg_patch_historical_signed_settlement_v1(
  'public.jg_signed_settlement_confirmed_projection_v1(text,text,text,text,text,text,text)'::regprocedure,
  '2a168f6afed9d1319254b3ab7b593abfc83eedfd4ea733037b6c6b83fe55e489',
  'a3a5d5d7404b184118ca0c033bca23a5f941897c548f985443720b57a03402c6',
  ARRAY[
    ARRAY[$old$  key_bytes bytea;$old$,$new$  key_bytes bytea;
  historical record;$new$],
    ARRAY[$old$  IF p_kind='downstream' THEN$old$,$new$  SELECT h.kind, h.source INTO historical FROM public.jg_historical_signed_settlement_source_v1(p_project, p_contract) h;
  IF FOUND AND (historical.kind<>p_kind OR historical.source IS NULL) THEN
    RAISE EXCEPTION 'SIGNED_SETTLEMENT_PROJECTION_LEGACY' USING ERRCODE='23514';
  END IF;
  IF historical.source IS NOT NULL OR p_kind='downstream' THEN$new$]
  ]);

SELECT pg_temp.jg_patch_historical_signed_settlement_v1(
  'public.jg_signed_settlement_contract_read_v1(text,text,text,text,text,text,text)'::regprocedure,
  '4d88a0ad2713a468c5ff1d1f3433ef700d358ef2742df03e715642d812816a8b',
  '4cbf43821003080cfc35b9674753483951c3db3b6dc40057fc5edcbfe5c9619e',
  ARRAY[
    ARRAY[$old$  WITH source AS ($old$,$new$  WITH historical AS MATERIALIZED (
    SELECT * FROM public.jg_historical_signed_settlement_source_v1(p_project, CASE WHEN p_view='picker' THEN NULL ELSE p_contract END)
  ), source AS ($new$],
    ARRAY[$old$      c.counterparty
    FROM public."Contract" c JOIN LATERAL$old$,$new$      c.counterparty,NULL::text AS takeover_id
    FROM public."Contract" c JOIN LATERAL$new$],
    ARRAY[$old$      AND (p_view='picker' OR (p_kind='downstream' AND c.id=p_contract))$old$,$new$      AND (p_view='picker' OR (p_kind='downstream' AND c.id=p_contract))
      AND NOT EXISTS (SELECT FROM historical h WHERE h.contract_id=c.id)$new$],
    ARRAY[$old$      CASE WHEN can_read_attachments AND p_view<>'picker' THEN c."evidenceFileId" END,c."affiliateNameSnapshot",c."counterpartyName"$old$,$new$      CASE WHEN can_read_attachments AND p_view<>'picker' THEN c."evidenceFileId" END,c."affiliateNameSnapshot",c."counterpartyName",NULL::text$new$],
    ARRAY[$old$      AND (p_view='picker' OR (p_kind='outside_fact' AND c."ledgerId"=p_contract))$old$,$new$      AND (p_view='picker' OR (p_kind='outside_fact' AND c."ledgerId"=p_contract))
      AND NOT EXISTS (SELECT FROM historical h WHERE h.contract_id=c."ledgerId")$new$],
    ARRAY[$old$      CASE WHEN can_read_attachments AND p_view<>'picker' THEN c."fileId" END,c."affiliateNameSnapshot",c."companyEntityNameSnapshot"$old$,$new$      CASE WHEN can_read_attachments AND p_view<>'picker' THEN c."fileId" END,c."affiliateNameSnapshot",c."companyEntityNameSnapshot",NULL::text$new$],
    ARRAY[$old$      AND (p_view='picker' OR (p_kind='upward' AND c.id=p_contract))
  )$old$,$new$      AND (p_view='picker' OR (p_kind='upward' AND c.id=p_contract))
      AND NOT EXISTS (SELECT FROM historical h WHERE h.contract_id=c.id)
    UNION ALL
    SELECT CASE WHEN h.kind='upward' THEN 3 ELSE 1 END,h.kind,h.contract_id,h.source->>'name',h.source->>'relationship',
      h.source->>'sourceRecordId',NULL,h.source->>'signingParty',h.source->>'counterparty',h.source->>'historicalTakeoverId'
    FROM historical h WHERE h.source IS NOT NULL AND (p_view='picker' OR h.kind=p_kind)
  )$new$],
    ARRAY[$old$      'name',name,'party',party,'counterparty',counterparty) FROM source WHERE relationship IS NOT NULL LIMIT 1$old$,$new$      'name',name,'party',party,'counterparty',counterparty)
      || CASE WHEN takeover_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('historicalTakeoverId',takeover_id) END
    FROM source WHERE relationship IS NOT NULL LIMIT 1$new$]
  ]);

DROP FUNCTION pg_temp.jg_patch_historical_signed_settlement_v1(regprocedure,text,text,text[][]);
COMMIT;
