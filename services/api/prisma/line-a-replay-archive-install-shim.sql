-- Isolated-replay shim for the archive installers that production runs after
-- migration 20261111060000/20261111070000. A clean 320-migration replay cannot
-- reach 20261118221000 without their three pinned guard-body transformations;
-- this file re-applies exactly those transformations and refuses any other
-- preimage. It is fixture SQL, not a product migration.
BEGIN;
SET LOCAL search_path=pg_catalog,pg_temp;

-- direct archive version transition guard: c376d219 -> b448ae52
DO $lina_v$
DECLARE
  prior RECORD;
  new_body TEXT;
BEGIN
  SELECT p.*, to_jsonb(p)-'prosrc' AS metadata INTO STRICT prior
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
  WHERE p.oid=pg_catalog.to_regprocedure($lina_vsig$public.jg_guard_contract_direct_archive_version_transition_v1(public."ContractVersion",public."ContractVersion")$lina_vsig$);
  IF encode(pg_catalog.sha256(pg_catalog.convert_to(prior.prosrc,'UTF8')),'hex') <> $lina_vpre$c376d219b8d97e2d8e895f39fcf6af1b768fef8ae2dff9c37d356d8374086157$lina_vpre$ THEN
    RAISE EXCEPTION 'LINE_A_REPLAY_SHIM_PREIMAGE %', $lina_vlbl$direct archive version transition guard$lina_vlbl$;
  END IF;
  IF cardinality(string_to_array(prior.prosrc,$lina_vanchor$  witness:=public.jg_require_contract_direct_archive_transition_profile_v1();$lina_vanchor$))<>2
    OR cardinality(string_to_array(pg_catalog.pg_get_functiondef(prior.oid),prior.prosrc))<>2 THEN
    RAISE EXCEPTION 'LINE_A_REPLAY_SHIM_ANCHOR %', $lina_vlbl$direct archive version transition guard$lina_vlbl$;
  END IF;
  new_body:=replace(prior.prosrc,$lina_vanchor$  witness:=public.jg_require_contract_direct_archive_transition_profile_v1();$lina_vanchor$,$lina_vbranch$  IF p_old."draftData"#>>'{directSigningInput,relationship}'='outside'
    AND EXISTS(SELECT 1 FROM public."ContractArchiveFile" enabled WHERE enabled."contractVersionId"=p_old."id"
      AND enabled."archiveProtocolVersion"=2 AND enabled."archiveSource"='direct_signed'
      AND enabled."authoritySnapshot"#>>'{operatingConsequence,mode}'='projection_required') THEN
    PERFORM public.jg_guard_direct_outside_operating_version_v2(p_old,p_new);
    RETURN p_new;
  END IF;
$lina_vbranch$||$lina_vanchor$  witness:=public.jg_require_contract_direct_archive_transition_profile_v1();$lina_vanchor$);
  IF encode(pg_catalog.sha256(pg_catalog.convert_to(new_body,'UTF8')),'hex') <> $lina_vpost$b448ae524c9d9b1961b02a6a995f92df1295eae3f9d015e282660bc3bdef9b30$lina_vpost$ THEN
    RAISE EXCEPTION 'LINE_A_REPLAY_SHIM_POSTIMAGE %', $lina_vlbl$direct archive version transition guard$lina_vlbl$;
  END IF;
  EXECUTE replace(pg_catalog.pg_get_functiondef(prior.oid),prior.prosrc,new_body);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=prior.oid AND p.prosrc=new_body
      AND to_jsonb(p)-'prosrc'=prior.metadata) THEN
    RAISE EXCEPTION 'LINE_A_REPLAY_SHIM_IDENTITY %', $lina_vlbl$direct archive version transition guard$lina_vlbl$;
  END IF;
END $lina_v$;


-- active participant guard: 9b3b12c7 -> ba713bc2
DO $lina_p$
DECLARE
  prior RECORD;
  new_body TEXT;
BEGIN
  SELECT p.*, to_jsonb(p)-'prosrc' AS metadata INTO STRICT prior
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
  WHERE p.oid=pg_catalog.to_regprocedure($lina_psig$public."requireActiveProjectParticipatingCompany"()$lina_psig$);
  IF encode(pg_catalog.sha256(pg_catalog.convert_to(prior.prosrc,'UTF8')),'hex') <> $lina_ppre$9b3b12c796afc49722d8277d10705277021c89897444f1a6b192d40df2be5f9c$lina_ppre$ THEN
    RAISE EXCEPTION 'LINE_A_REPLAY_SHIM_PREIMAGE %', $lina_plbl$active participant guard$lina_plbl$;
  END IF;
  IF cardinality(string_to_array(prior.prosrc,$lina_panchor$  IF TG_TABLE_NAME = 'ContractVersion' THEN
    candidate_fact_date := COALESCE(public.jg_contract_archive_v2_ownership_day(NEW."id"), COALESCE(NEW."effectiveAt", NEW."createdAt")::DATE);
  END IF;$lina_panchor$))<>2
    OR cardinality(string_to_array(pg_catalog.pg_get_functiondef(prior.oid),prior.prosrc))<>2 THEN
    RAISE EXCEPTION 'LINE_A_REPLAY_SHIM_ANCHOR %', $lina_plbl$active participant guard$lina_plbl$;
  END IF;
  new_body:=replace(prior.prosrc,$lina_panchor$  IF TG_TABLE_NAME = 'ContractVersion' THEN
    candidate_fact_date := COALESCE(public.jg_contract_archive_v2_ownership_day(NEW."id"), COALESCE(NEW."effectiveAt", NEW."createdAt")::DATE);
  END IF;$lina_panchor$,$lina_pbranch$  IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='ContractVersion' AND TG_OP='UPDATE' THEN
    IF OLD."status"='draft' AND NEW."status"='effective'
      AND OLD."draftData"#>>'{directSigningInput,relationship}'='outside'
      AND current_user IS DISTINCT FROM session_user
      AND pg_catalog.has_function_privilege(current_user,
        'public.jg_guard_direct_outside_operating_version_v2(public."ContractVersion",public."ContractVersion")','EXECUTE') THEN
      IF EXISTS(SELECT 1 FROM public."ContractArchiveFile" enabled WHERE enabled."contractVersionId"=OLD."id"
        AND enabled."archiveProtocolVersion"=2 AND enabled."archiveSource"='direct_signed'
        AND enabled."authoritySnapshot"#>>'{operatingConsequence,mode}'='projection_required') THEN
        candidate_fact_date:=public.jg_guard_direct_outside_operating_version_v2(
          OLD::public."ContractVersion",NEW::public."ContractVersion");
        -- The exact affiliate path above binds the day and an active assignment.
        -- It has no company participant candidates.
        IF candidate_fact_date IS NULL OR primary_company_id IS NOT NULL OR secondary_company_id IS NOT NULL THEN
          RAISE EXCEPTION '表外直签归档日期或参与方不一致' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END IF;
    END IF;
  END IF;

$lina_pbranch$||$lina_panchor$  IF TG_TABLE_NAME = 'ContractVersion' THEN
    candidate_fact_date := COALESCE(public.jg_contract_archive_v2_ownership_day(NEW."id"), COALESCE(NEW."effectiveAt", NEW."createdAt")::DATE);
  END IF;$lina_panchor$);
  IF encode(pg_catalog.sha256(pg_catalog.convert_to(new_body,'UTF8')),'hex') <> $lina_ppost$ba713bc2f3d6c7faa9390f75fd9f459a7d2bd2791d62a39fa33a97b291f0ccfc$lina_ppost$ THEN
    RAISE EXCEPTION 'LINE_A_REPLAY_SHIM_POSTIMAGE %', $lina_plbl$active participant guard$lina_plbl$;
  END IF;
  EXECUTE replace(pg_catalog.pg_get_functiondef(prior.oid),prior.prosrc,new_body);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=prior.oid AND p.prosrc=new_body
      AND to_jsonb(p)-'prosrc'=prior.metadata) THEN
    RAISE EXCEPTION 'LINE_A_REPLAY_SHIM_IDENTITY %', $lina_plbl$active participant guard$lina_plbl$;
  END IF;
END $lina_p$;


-- construction enterprise lock guard: a83830f4 -> e651e355
DO $lina_l$
DECLARE
  prior RECORD;
  new_body TEXT;
BEGIN
  SELECT p.*, to_jsonb(p)-'prosrc' AS metadata INTO STRICT prior
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_language l ON l.oid=p.prolang AND l.lanname='plpgsql'
  WHERE p.oid=pg_catalog.to_regprocedure($lina_lsig$public."lockProjectConstructionEnterpriseFromFormalFact"()$lina_lsig$);
  IF encode(pg_catalog.sha256(pg_catalog.convert_to(prior.prosrc,'UTF8')),'hex') <> $lina_lpre$a83830f419340282908c9cc4c7d146fc8751724ea7f71fd05afb8691c990b941$lina_lpre$ THEN
    RAISE EXCEPTION 'LINE_A_REPLAY_SHIM_PREIMAGE %', $lina_llbl$construction enterprise lock guard$lina_llbl$;
  END IF;
  IF cardinality(string_to_array(prior.prosrc,$lina_lanchor$  IF TG_TABLE_NAME = 'ContractVersion' THEN$lina_lanchor$))<>2
    OR cardinality(string_to_array(pg_catalog.pg_get_functiondef(prior.oid),prior.prosrc))<>2 THEN
    RAISE EXCEPTION 'LINE_A_REPLAY_SHIM_ANCHOR %', $lina_llbl$construction enterprise lock guard$lina_llbl$;
  END IF;
  new_body:=replace(prior.prosrc,$lina_lanchor$  IF TG_TABLE_NAME = 'ContractVersion' THEN$lina_lanchor$,$lina_lbranch$  IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='ContractVersion' AND TG_OP='UPDATE' THEN
    IF OLD."status"='draft' AND NEW."status"='effective'
      AND OLD."draftData"#>>'{directSigningInput,relationship}'='outside'
      AND current_user IS DISTINCT FROM session_user
      AND pg_catalog.has_function_privilege(current_user,'public.jg_lock_direct_outside_operating_assignment_v2(text)','EXECUTE') THEN
      IF EXISTS(SELECT 1 FROM public."ContractArchiveFile" enabled WHERE enabled."contractVersionId"=NEW."id"
        AND enabled."archiveProtocolVersion"=2 AND enabled."archiveSource"='direct_signed'
        AND enabled."authoritySnapshot"#>>'{operatingConsequence,mode}'='projection_required') THEN
        PERFORM public.jg_lock_direct_outside_operating_assignment_v2(NEW."id");
        RETURN NEW;
      END IF;
    END IF;
  END IF;
$lina_lbranch$||$lina_lanchor$  IF TG_TABLE_NAME = 'ContractVersion' THEN$lina_lanchor$);
  IF encode(pg_catalog.sha256(pg_catalog.convert_to(new_body,'UTF8')),'hex') <> $lina_lpost$e651e3554e2938ebaa2c07578e109b1ad049188d4984820fe3bc017ca1879839$lina_lpost$ THEN
    RAISE EXCEPTION 'LINE_A_REPLAY_SHIM_POSTIMAGE %', $lina_llbl$construction enterprise lock guard$lina_llbl$;
  END IF;
  EXECUTE replace(pg_catalog.pg_get_functiondef(prior.oid),prior.prosrc,new_body);
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=prior.oid AND p.prosrc=new_body
      AND to_jsonb(p)-'prosrc'=prior.metadata) THEN
    RAISE EXCEPTION 'LINE_A_REPLAY_SHIM_IDENTITY %', $lina_llbl$construction enterprise lock guard$lina_llbl$;
  END IF;
END $lina_l$;

COMMIT;
