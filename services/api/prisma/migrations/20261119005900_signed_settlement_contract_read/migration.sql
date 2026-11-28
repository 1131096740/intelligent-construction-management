BEGIN;

CREATE FUNCTION public.jg_signed_settlement_contract_read_v1(p_project text, p_actor text, p_view text, p_kind text, p_contract text, p_expiry text, p_proof text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp AS $read$
DECLARE
  key_bytes bytea;
  payload bytea;
  now_seconds bigint := floor(extract(epoch FROM clock_timestamp()))::bigint;
  position_roles record;
  membership_roles record;
  can_read_attachments boolean;
  result jsonb;
BEGIN
  IF current_setting('session_replication_role')<>'origin'
    OR NOT coalesce(p_expiry ~ '^[0-9]{10}$' AND p_proof ~ '^[0-9a-f]{64}$',false)
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_CONTRACT_READ_WITNESS' USING ERRCODE='42501'; END IF;
  IF NOT coalesce(p_view IN ('picker','overview','payment'),false)
    OR (p_view='picker' AND (p_kind IS NOT NULL OR p_contract IS NOT NULL))
    OR (p_view<>'picker' AND NOT coalesce(p_kind IN ('downstream','outside_fact','upward') AND btrim(p_contract)<>'',false))
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_CONTRACT_READ_INPUT' USING ERRCODE='22023'; END IF;
  IF p_expiry::bigint NOT BETWEEN now_seconds AND now_seconds+30
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_CONTRACT_READ_WITNESS' USING ERRCODE='42501'; END IF;
  SELECT "key" INTO key_bytes FROM public.jg_signed_settlement_attachment_witness_key WHERE singleton;
  SELECT convert_to(string_agg(coalesce(encode(convert_to(value,'UTF8'),'hex'),'-'),':' ORDER BY ordinal),'UTF8')
    INTO payload
    FROM unnest(ARRAY[
      'signed_settlement_contract_read_v1',current_database()::text,session_user::text,
      pg_current_xact_id()::text,pg_backend_pid()::text,p_expiry,p_project,p_actor,p_view,p_kind,p_contract
    ]) WITH ORDINALITY fields(value,ordinal);
  IF key_bytes IS NULL OR encode(public.hmac(payload,key_bytes,'sha256'),'hex') IS DISTINCT FROM p_proof
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_CONTRACT_READ_WITNESS' USING ERRCODE='42501'; END IF;

  PERFORM FROM public."User" actor WHERE actor.id=p_actor AND actor."isActive" FOR SHARE OF actor;
  IF NOT FOUND THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_CONTRACT_READ_DENIED' USING ERRCODE='42501'; END IF;
  SELECT count(*) AS allowed,coalesce(bool_or(scoped.role IN ('contract_director','contract_staff')),false) AS contract_role INTO position_roles
    FROM (
      SELECT pos.key AS role FROM public."UserPosition" up JOIN public."Position" pos ON pos.id=up."positionId"
      WHERE up."userId"=p_actor AND (up."projectId" IS NULL OR up."projectId"=p_project)
        AND (pos.key IN ('contract_staff','contract_director')
          OR (p_view='payment' AND up."projectId"=p_project AND pos.key='project_manager')) FOR SHARE OF up,pos
    ) scoped;
  SELECT count(*) AS allowed,coalesce(bool_or(scoped.role IN ('contract_director','contract_staff')),false) AS contract_role INTO membership_roles
    FROM (
      SELECT m."positionKey" AS role FROM public."ProjectMember" m
      WHERE m."projectId"=p_project AND m."userId"=p_actor AND (m."positionKey" IN ('contract_staff','contract_director')
          OR (p_view='payment' AND m."positionKey"='project_manager')) FOR SHARE OF m
    ) scoped;
  IF position_roles.allowed+membership_roles.allowed=0
  THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_CONTRACT_READ_DENIED' USING ERRCODE='42501'; END IF;
  PERFORM FROM public."Project" p WHERE p.id=p_project AND p."isActive" FOR SHARE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_CONTRACT_READ_PROJECT' USING ERRCODE='P0002'; END IF;
  can_read_attachments := position_roles.contract_role OR membership_roles.contract_role;

  IF p_kind='outside_fact' AND EXISTS (
    SELECT FROM public."ProjectAffiliateContractFact" c WHERE c."projectId"=p_project AND c."ledgerId"=p_contract
      AND c."entryKind"='original' AND c.status='confirmed'
  ) AND EXISTS (
    SELECT FROM public."ProjectAffiliateSettlementFact" s WHERE s."projectId"=p_project AND s."contractLedgerId"=p_contract
      AND s.status='confirmed' AND s."affiliateCompanyContractId" IS NOT NULL
  ) THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_CONTRACT_READ_ALIAS' USING ERRCODE='23514'; END IF;

  WITH source AS (
    SELECT 1 AS sort_group,'downstream' AS kind,c.id,c.name,
      CASE WHEN v."signingSubjectType"='our_company' AND (
        nullif(v."companyEntityIdSnapshot",'') IS NOT NULL OR nullif(v."companyEntityVersionId",'') IS NOT NULL
      ) THEN 'inside' WHEN v."signingSubjectType"='affiliate' AND nullif(v."affiliateAssignmentId",'') IS NOT NULL
        AND nullif(v."affiliateBusinessPartyVersionId",'') IS NOT NULL THEN 'outside' END AS relationship,
      v.id AS version_id,NULL::text AS file_id,
      CASE WHEN v."signingSubjectType"='affiliate' THEN v."affiliateNameSnapshot" ELSE v."companyEntityNameSnapshot" END AS party,
      c.counterparty
    FROM public."Contract" c JOIN LATERAL (
      SELECT v.id,v."signingSubjectType",v."companyEntityIdSnapshot",v."companyEntityVersionId",
        v."affiliateAssignmentId",v."affiliateBusinessPartyVersionId",v."affiliateNameSnapshot",v."companyEntityNameSnapshot"
      FROM public."ContractVersion" v WHERE v."contractId"=c.id AND v.status='effective'
      ORDER BY v."versionNo" DESC LIMIT 1
    ) v ON true
    WHERE c."projectId"=p_project AND c."voidedAt" IS NULL
      AND (p_view='picker' OR (p_kind='downstream' AND c.id=p_contract))
    UNION ALL
    SELECT 2,'outside_fact',c."ledgerId",c."externalContractReference",'outside',NULL,
      CASE WHEN can_read_attachments AND p_view<>'picker' THEN c."evidenceFileId" END,c."affiliateNameSnapshot",c."counterpartyName"
    FROM public."ProjectAffiliateContractFact" c
    WHERE c."projectId"=p_project AND c."entryKind"='original' AND c.status='confirmed'
      AND (p_view='picker' OR (p_kind='outside_fact' AND c."ledgerId"=p_contract))
      AND NOT EXISTS (SELECT FROM public."ProjectAffiliateSettlementFact" s
        WHERE s."projectId"=p_project AND s."contractLedgerId"=c."ledgerId" AND s.status='confirmed' AND s."affiliateCompanyContractId" IS NOT NULL)
    UNION ALL
    SELECT 3,'upward',c.id,c."contractName",'upward',NULL,
      CASE WHEN can_read_attachments AND p_view<>'picker' THEN c."fileId" END,c."affiliateNameSnapshot",c."companyEntityNameSnapshot"
    FROM public."ProjectAffiliateCompanyContract" c
    WHERE c."projectId"=p_project AND c.status='confirmed'
      AND (p_view='picker' OR (p_kind='upward' AND c.id=p_contract))
  )
  SELECT CASE WHEN p_view='picker' THEN (
    SELECT coalesce(jsonb_agg(jsonb_build_object('kind',kind,'id',id,'label',name,'relationship',relationship)
      ORDER BY sort_group,name,id),'[]'::jsonb) FROM source WHERE relationship IS NOT NULL
  ) ELSE (
    SELECT jsonb_build_object('contractVersionId',version_id,'originalFileId',file_id,'relationship',relationship,
      'name',name,'party',party,'counterparty',counterparty) FROM source WHERE relationship IS NOT NULL LIMIT 1
  ) END INTO result;
  IF result IS NULL THEN RAISE EXCEPTION 'SIGNED_SETTLEMENT_CONTRACT_READ_MISSING' USING ERRCODE='P0002'; END IF;
  RETURN result;
END;
$read$;

REVOKE ALL ON FUNCTION public.jg_signed_settlement_contract_read_v1(text,text,text,text,text,text,text) FROM PUBLIC;

COMMIT;
